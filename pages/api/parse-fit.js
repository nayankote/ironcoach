export const config = {
  api: {
    bodyParser: false,
  },
};

// Athlete config - will be configurable from frontend later
const ATHLETE_FTP = 190;

function analyzeWorkout(fitData) {
  // fitData comes from fit-file-parser in cascade mode
  // Structure: { sessions: [...], laps: [...], records: [...], activity: {...} }
  
  if (!fitData.sessions || fitData.sessions.length === 0) {
    return null;
  }

  const session = fitData.sessions[0];
  const records = fitData.records || [];
  
  const analysis = {
    readiness: 'good',
    feedback: [],
  };

  // Sport detection - fit-file-parser returns string like 'cycling', 'running', 'swimming'
  let sport = session.sport || 'unknown';
  
  // Normalize sport names
  if (sport === 'cycling' || sport === 'biking') {
    sport = 'bike';
  } else if (sport === 'running') {
    sport = 'run';
  } else if (sport === 'swimming' || sport === 'lap_swimming' || sport === 'open_water') {
    sport = 'swim';
  }

  // Duration - fit-file-parser returns seconds directly
  const durationSec = session.total_timer_time || session.total_elapsed_time || 0;
  const durationMin = durationSec / 60;
  
  // Distance - fit-file-parser returns in the unit specified (we use km)
  // But some files return meters, so check magnitude
  let distanceKm = session.total_distance || 0;
  if (distanceKm > 1000) {
    // Probably in meters
    distanceKm = distanceKm / 1000;
  }

  analysis.duration = `${Math.round(durationMin)}min`;
  analysis.durationMinutes = Math.round(durationMin);
  analysis.distance = `${distanceKm.toFixed(1)}km`;
  analysis.distanceKm = distanceKm;

  // HR Analysis
  const avgHR = session.avg_heart_rate;
  if (avgHR) {
    analysis.avgHR = avgHR;
    analysis.maxHR = session.max_heart_rate || 0;

    // Calculate HR drift from records
    const hrs = records
      .map(r => r.heart_rate)
      .filter(hr => hr && hr > 0 && hr < 255);

    if (hrs.length > 100) {
      const quarter = Math.floor(hrs.length / 4);
      const firstQuarter = hrs.slice(0, quarter);
      const lastQuarter = hrs.slice(-quarter);

      const avgFirst = firstQuarter.reduce((a, b) => a + b, 0) / firstQuarter.length;
      const avgLast = lastQuarter.reduce((a, b) => a + b, 0) / lastQuarter.length;
      const drift = avgLast - avgFirst;

      analysis.hrDrift = Math.round(drift);

      const driftFeedback = {
        title: '❤️ Heart Rate Analysis',
        type: Math.abs(drift) > 15 ? 'warning' : Math.abs(drift) > 10 ? 'caution' : 'good',
        items: [
          `Average HR: ${avgHR} bpm`,
          `HR Drift: <strong>${drift > 0 ? '+' : ''}${Math.round(drift)} bpm</strong> (first 25% vs last 25%)`,
        ],
      };

      if (Math.abs(drift) > 15) {
        driftFeedback.items.push('<strong>⚠️ Significant drift detected.</strong> This indicates cardiovascular fatigue - likely fueling issue. Aim for 60-90g carbs/hour on efforts >90min.');
        analysis.readiness = 'warning';
      } else if (Math.abs(drift) > 10) {
        driftFeedback.items.push('Moderate drift - acceptable but monitor nutrition on longer efforts.');
      } else {
        driftFeedback.items.push('✓ Excellent HR stability throughout workout.');
      }

      analysis.feedback.push(driftFeedback);
    }
  }

  // BIKE Analysis with FTP-based zones
  if (sport === 'bike' && session.avg_power) {
    analysis.avgPower = session.avg_power;
    analysis.maxPower = session.max_power || 0;

    const powers = records
      .map(r => r.power)
      .filter(p => p && p > 0 && p < 3000);

    if (powers.length > 0) {
      const total = powers.length;
      const ftp = ATHLETE_FTP;

      // Calculate power zones based on % of FTP
      const z1Max = ftp * 0.55;  // 105W
      const z2Max = ftp * 0.75;  // 143W
      const z3Max = ftp * 0.90;  // 171W
      const z4Max = ftp * 1.05;  // 200W

      analysis.powerDistribution = {
        z1: Math.round((powers.filter(p => p < z1Max).length / total) * 1000) / 10,
        z2: Math.round((powers.filter(p => p >= z1Max && p < z2Max).length / total) * 1000) / 10,
        z3: Math.round((powers.filter(p => p >= z2Max && p < z3Max).length / total) * 1000) / 10,
        z4: Math.round((powers.filter(p => p >= z3Max && p < z4Max).length / total) * 1000) / 10,
        z5: Math.round((powers.filter(p => p >= z4Max).length / total) * 1000) / 10,
      };

      // Store zone boundaries for frontend display
      analysis.powerZoneBoundaries = {
        z1: Math.round(z1Max),
        z2: Math.round(z2Max),
        z3: Math.round(z3Max),
        z4: Math.round(z4Max),
        ftp: ftp
      };

      // Normalized Power calculation (proper 30s rolling average)
      let np = analysis.avgPower;
      if (powers.length >= 30) {
        const rollingAvgs = [];
        for (let i = 29; i < powers.length; i++) {
          const window = powers.slice(i - 29, i + 1);
          const avg = window.reduce((a, b) => a + b, 0) / 30;
          rollingAvgs.push(Math.pow(avg, 4));
        }
        np = Math.pow(rollingAvgs.reduce((a, b) => a + b, 0) / rollingAvgs.length, 0.25);
      }
      
      analysis.normalizedPower = Math.round(np);
      const vi = analysis.avgPower > 0 ? np / analysis.avgPower : 1.0;
      analysis.variabilityIndex = Math.round(vi * 100) / 100;

      const powerFeedback = {
        title: '⚡ Power Analysis',
        type: vi > 1.10 ? 'warning' : vi > 1.05 ? 'caution' : 'good',
        items: [
          `Average Power: ${analysis.avgPower}W (${Math.round(analysis.avgPower / ftp * 100)}% FTP)`,
          `Normalized Power: ${analysis.normalizedPower}W`,
          `Variability Index: <strong>${vi.toFixed(2)}</strong> (target: <1.05 for triathlon)`,
        ],
      };

      if (vi > 1.10) {
        powerFeedback.items.push('<strong>⚠️ Poor power discipline.</strong> Excessive surging - practice holding steady power.');
        analysis.readiness = 'warning';
      } else if (vi > 1.05) {
        powerFeedback.items.push('Moderate variability - work on smoothing out power.');
      } else {
        powerFeedback.items.push('✓ Excellent power discipline - race-ready pacing.');
      }

      // Check time above FTP
      if (analysis.powerDistribution.z5 > 10) {
        powerFeedback.items.push(`<strong>⚠️ ${analysis.powerDistribution.z5.toFixed(0)}% above FTP.</strong> For 70.3, keep supra-threshold under 5%.`);
      }

      analysis.feedback.push(powerFeedback);
    }
  }

  // RUN Analysis
  if (sport === 'run') {
    // fit-file-parser returns avg_speed in km/h when configured
    let paceSeconds = null;
    
    if (session.avg_speed && session.avg_speed > 0) {
      // Convert km/h to min/km
      paceSeconds = 3600 / session.avg_speed;
    } else if (distanceKm > 0 && durationMin > 0) {
      paceSeconds = (durationMin * 60) / distanceKm;
    }

    if (paceSeconds && paceSeconds > 0 && paceSeconds < 1200) {
      const paceMin = Math.floor(paceSeconds / 60);
      const paceSecs = Math.floor(paceSeconds % 60);
      analysis.avgPace = `${paceMin}:${paceSecs.toString().padStart(2, '0')}`;
      analysis.avgPaceSeconds = paceSeconds;

      const runFeedback = {
        title: '🏃 Run Analysis',
        type: 'good',
        items: [
          `Average Pace: ${analysis.avgPace} /km`,
          `Distance: ${distanceKm.toFixed(2)} km`,
        ],
      };

      if (durationMin > 75) {
        runFeedback.items.push('✓ Good long run volume for half marathon prep.');
        if (analysis.hrDrift && analysis.hrDrift > 15) {
          runFeedback.type = 'warning';
          runFeedback.items.push(`<strong>⚠️ HR drift of ${analysis.hrDrift} bpm on long run.</strong> Likely underfueled.`);
        }
      }

      analysis.feedback.push(runFeedback);
    }
  }

  // SWIM Analysis
  if (sport === 'swim') {
    let paceSeconds = null;
    
    // Convert distance to meters for swim
    const distanceM = distanceKm * 1000;
    
    if (distanceM > 0 && durationMin > 0) {
      // Pace per 100m
      paceSeconds = (durationMin * 60) / (distanceM / 100);
    }

    if (paceSeconds && paceSeconds > 0 && paceSeconds < 600) {
      const paceMin = Math.floor(paceSeconds / 60);
      const paceSecs = Math.floor(paceSeconds % 60);
      analysis.avgPace = `${paceMin}:${paceSecs.toString().padStart(2, '0')}`;
      analysis.avgPaceSeconds = paceSeconds;

      const projectedTime = (paceSeconds / 100) * 1900 / 60;
      analysis.projectedRaceSwim = Math.round(projectedTime);

      const swimFeedback = {
        title: '🏊 Swim Analysis',
        type: projectedTime > 65 ? 'warning' : projectedTime > 55 ? 'caution' : 'good',
        items: [
          `Average Pace: ${analysis.avgPace} /100m`,
          `Distance: ${distanceM.toFixed(0)}m`,
          `Projected 1.9km time: <strong>${Math.round(projectedTime)} min</strong> (cutoff: 70min)`,
        ],
      };

      const cutoffBuffer = 70 - projectedTime;
      if (cutoffBuffer < 5) {
        swimFeedback.items.push(`<strong>🚨 CRITICAL: Only ${Math.round(cutoffBuffer)} min buffer to cutoff!</strong>`);
        analysis.readiness = 'critical';
      } else if (cutoffBuffer < 15) {
        swimFeedback.items.push(`⚠️ ${Math.round(cutoffBuffer)} min buffer - build more consistency.`);
        analysis.readiness = 'warning';
      } else {
        swimFeedback.items.push(`✓ ${Math.round(cutoffBuffer)} min buffer to cutoff - well positioned.`);
      }

      analysis.feedback.push(swimFeedback);
    }
  }

  if (analysis.feedback.length === 0) {
    analysis.readiness = 'good';
  }

  // Extract workout date
  let workoutDate = new Date();
  if (session.start_time) {
    workoutDate = new Date(session.start_time);
  } else if (session.timestamp) {
    workoutDate = new Date(session.timestamp);
  }

  return {
    sport,
    date: workoutDate.toISOString().split('T')[0],
    duration: analysis.duration,
    durationMinutes: analysis.durationMinutes,
    distance: analysis.distance,
    distanceKm: analysis.distanceKm,
    analysis,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const busboy = require('busboy');
    const FitParser = require('fit-file-parser').default;
    
    const fitBuffer = await new Promise((resolve, reject) => {
      const bb = busboy({ headers: req.headers });
      let fileBuffer = null;

      bb.on('file', (name, file, info) => {
        const chunks = [];
        file.on('data', (data) => chunks.push(data));
        file.on('end', () => {
          fileBuffer = Buffer.concat(chunks);
        });
      });

      bb.on('finish', () => {
        resolve(fileBuffer);
      });

      bb.on('error', reject);

      req.pipe(bb);
    });

    if (!fitBuffer || fitBuffer.length < 14) {
      return res.status(400).json({ error: 'No valid FIT file uploaded' });
    }

    // Use fit-file-parser library
    const fitParser = new FitParser({
      force: true,
      speedUnit: 'km/h',
      lengthUnit: 'km',
      elapsedRecordField: true,
      mode: 'list',  // Get flat lists of sessions, records, etc.
    });

    const fitData = await new Promise((resolve, reject) => {
      fitParser.parse(fitBuffer, (error, data) => {
        if (error) {
          reject(new Error(error));
        } else {
          resolve(data);
        }
      });
    });

    const result = analyzeWorkout(fitData);

    if (!result) {
      return res.status(400).json({ error: 'Could not analyze FIT file - no session data found' });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Parse error:', error);
    return res.status(500).json({ error: error.message });
  }
}
