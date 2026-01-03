export const config = {
  api: {
    bodyParser: false,
  },
};

// =============================================================================
// ATHLETE DEFAULTS (overridden by frontend config)
// =============================================================================
const DEFAULT_ATHLETE = {
  ftp: 190,
  weight: 72,
  lthr: 165,
  runThresholdPace: 300,  // 5:00/km
  swimCSS: 180,           // 3:00/100m
};

// =============================================================================
// TSS CALCULATION
// =============================================================================
function calculateTSS(sport, durationMin, avgPower, normalizedPower, avgPaceSeconds, avgHR, athlete) {
  const durationSec = durationMin * 60;
  
  if (sport === 'bike' && normalizedPower) {
    const np = normalizedPower;
    const intensityFactor = np / athlete.ftp;
    const tss = (durationSec * np * intensityFactor) / (athlete.ftp * 3600) * 100;
    return { tss: Math.round(tss), intensityFactor: Math.round(intensityFactor * 100) / 100 };
  }
  
  if (sport === 'run' && avgPaceSeconds) {
    const intensityFactor = athlete.runThresholdPace / avgPaceSeconds;
    const tss = (durationSec * Math.pow(intensityFactor, 2)) / 3600 * 100;
    return { tss: Math.round(tss), intensityFactor: Math.round(intensityFactor * 100) / 100 };
  }
  
  if (sport === 'swim' && avgPaceSeconds) {
    const intensityFactor = athlete.swimCSS / avgPaceSeconds;
    const tss = (durationSec * Math.pow(intensityFactor, 2)) / 3600 * 100;
    return { tss: Math.round(tss), intensityFactor: Math.round(intensityFactor * 100) / 100 };
  }
  
  // Fallback: HR-based estimate
  if (avgHR && athlete.lthr) {
    const hrRatio = avgHR / athlete.lthr;
    const intensityFactor = Math.max(0.5, Math.min(1.2, hrRatio));
    const tss = (durationSec * Math.pow(intensityFactor, 2)) / 3600 * 100;
    return { tss: Math.round(tss), intensityFactor: Math.round(intensityFactor * 100) / 100 };
  }
  
  return null;
}

// =============================================================================
// EFFICIENCY FACTOR & AEROBIC DECOUPLING
// =============================================================================
function calculateEfficiency(records, sport) {
  if (!records || records.length < 600) return null; // Need 10+ min
  
  const validRecords = records.filter(r => 
    r.heart_rate && r.heart_rate > 60 && r.heart_rate < 220 &&
    ((sport === 'bike' && r.power && r.power > 0) ||
     (sport === 'run' && r.speed && r.speed > 0))
  );
  
  if (validRecords.length < 600) return null;
  
  const midpoint = Math.floor(validRecords.length / 2);
  const firstHalf = validRecords.slice(0, midpoint);
  const secondHalf = validRecords.slice(midpoint);
  
  const calcEF = (recs) => {
    const avgHR = recs.reduce((s, r) => s + r.heart_rate, 0) / recs.length;
    
    if (sport === 'bike') {
      const powers = recs.map(r => r.power);
      const np = calculateNP(powers);
      return { ef: np / avgHR, avgHR, metric: np };
    } else {
      const avgSpeed = recs.reduce((s, r) => s + r.speed, 0) / recs.length;
      // For run: higher pace number = slower, so invert
      const pace = avgSpeed > 0 ? (avgSpeed < 10 ? 1000 / avgSpeed : 3600 / avgSpeed) : 0;
      return { ef: pace > 0 ? avgHR / pace : 0, avgHR, metric: pace };
    }
  };
  
  const first = calcEF(firstHalf);
  const second = calcEF(secondHalf);
  
  if (first.ef === 0) return null;
  
  const decoupling = ((first.ef - second.ef) / first.ef) * 100;
  
  let status;
  if (Math.abs(decoupling) < 3) status = 'excellent';
  else if (Math.abs(decoupling) < 5) status = 'good';
  else if (Math.abs(decoupling) < 8) status = 'moderate';
  else status = 'poor';
  
  return {
    efficiencyFactor: Math.round(((first.ef + second.ef) / 2) * 100) / 100,
    aerobicDecoupling: Math.round(decoupling * 10) / 10,
    firstHalfHR: Math.round(first.avgHR),
    secondHalfHR: Math.round(second.avgHR),
    status
  };
}

function calculateNP(powers) {
  if (!powers || powers.length < 30) {
    return powers ? powers.reduce((a, b) => a + b, 0) / powers.length : 0;
  }
  
  const rolling = [];
  for (let i = 29; i < powers.length; i++) {
    const window = powers.slice(i - 29, i + 1);
    const avg = window.reduce((a, b) => a + b, 0) / 30;
    rolling.push(Math.pow(avg, 4));
  }
  
  return Math.pow(rolling.reduce((a, b) => a + b, 0) / rolling.length, 0.25);
}

// =============================================================================
// INTERVAL DETECTION
// =============================================================================
function detectIntervals(records, sport) {
  if (!records || records.length < 120) return null;
  
  const metric = sport === 'bike' ? 'power' : 'speed';
  const values = records.map(r => r[metric]).filter(v => v && v > 0);
  
  if (values.length < 120) return null;
  
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const stdDev = Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length);
  const cv = stdDev / mean;
  
  // Low variability = steady state
  if (cv < 0.15) {
    return { type: 'steady', workIntervals: 0, confidence: 'high' };
  }
  
  // Detect intervals via threshold crossing on 30s smoothed data
  const highThresh = mean + stdDev * 0.5;
  const lowThresh = mean - stdDev * 0.3;
  
  const smoothed = [];
  for (let i = 30; i < values.length; i++) {
    smoothed.push(values.slice(i - 30, i).reduce((a, b) => a + b, 0) / 30);
  }
  
  let intervals = [];
  let currentType = null;
  let currentStart = 0;
  
  smoothed.forEach((val, i) => {
    let newType = currentType;
    if (val > highThresh) newType = 'work';
    else if (val < lowThresh) newType = 'rest';
    
    if (newType !== currentType && currentType !== null) {
      const duration = i - currentStart;
      if (duration >= 30) {
        const segment = smoothed.slice(currentStart, i);
        intervals.push({
          type: currentType,
          duration,
          avgValue: Math.round(segment.reduce((a, b) => a + b, 0) / segment.length)
        });
      }
      currentStart = i;
    }
    currentType = newType || currentType;
  });
  
  const workIntervals = intervals.filter(i => i.type === 'work');
  const restIntervals = intervals.filter(i => i.type === 'rest');
  
  return {
    type: workIntervals.length >= 3 ? 'intervals' : 'mixed',
    workIntervals: workIntervals.length,
    totalWorkTime: workIntervals.reduce((s, i) => s + i.duration, 0),
    totalRestTime: restIntervals.reduce((s, i) => s + i.duration, 0),
    avgWorkPower: workIntervals.length > 0 
      ? Math.round(workIntervals.reduce((s, i) => s + i.avgValue, 0) / workIntervals.length)
      : null,
    avgRestPower: restIntervals.length > 0
      ? Math.round(restIntervals.reduce((s, i) => s + i.avgValue, 0) / restIntervals.length)
      : null,
    intervals: intervals.slice(0, 15),
    confidence: cv > 0.25 ? 'high' : 'medium'
  };
}

// =============================================================================
// COACHING INSIGHTS (for Claude context)
// =============================================================================
function generateCoachingInsights(sport, analysis, tssData, efficiency, intervals) {
  const insights = [];
  
  // TSS insights
  if (tssData) {
    if (tssData.tss > 150) {
      insights.push(`Very high training load (TSS ${tssData.tss}). Ensure 48hr recovery before next hard session.`);
    } else if (tssData.tss > 100) {
      insights.push(`Solid training load (TSS ${tssData.tss}). Good stimulus for adaptation.`);
    } else if (tssData.tss < 30) {
      insights.push(`Light session (TSS ${tssData.tss}). Recovery or technique focus.`);
    }
  }
  
  // Efficiency insights
  if (efficiency) {
    if (efficiency.status === 'poor') {
      insights.push(`Aerobic decoupling at ${efficiency.aerobicDecoupling}% indicates fitness limiter. HR rose from ${efficiency.firstHalfHR} to ${efficiency.secondHalfHR} bpm. More Z2 base work needed.`);
    } else if (efficiency.status === 'excellent') {
      insights.push(`Excellent aerobic efficiency (${efficiency.aerobicDecoupling}% decoupling). Ready for race-intensity work.`);
    }
  }
  
  // Sport-specific
  if (sport === 'bike') {
    if (analysis.variabilityIndex > 1.08) {
      insights.push(`Power discipline issue (VI ${analysis.variabilityIndex}). For Oman's 800m climbing, steady power prevents blowing up. Practice holding target ±5W.`);
    }
    if (analysis.powerDistribution?.z5 > 10) {
      insights.push(`${analysis.powerDistribution.z5}% time above FTP is too high for 70.3. Keep supra-threshold under 5%.`);
    }
  }
  
  if (sport === 'run') {
    if (analysis.hrDrift > 15) {
      insights.push(`HR drift of ${analysis.hrDrift} bpm suggests pacing or fueling issue. For off-the-bike run, start 10-15 sec/km slower than target.`);
    }
  }
  
  if (sport === 'swim') {
    if (analysis.projectedRaceSwim > 60) {
      insights.push(`CRITICAL: ${analysis.projectedRaceSwim} min projected swim leaves only ${70 - analysis.projectedRaceSwim} min buffer to cutoff. Priority #1.`);
    }
  }
  
  // Interval insights
  if (intervals && intervals.type === 'intervals') {
    insights.push(`Detected ${intervals.workIntervals} work intervals averaging ${intervals.avgWorkPower}${sport === 'bike' ? 'W' : ' pace'}.`);
  }
  
  return insights;
}

// =============================================================================
// MAIN ANALYSIS FUNCTION
// =============================================================================
function analyzeWorkout(fitData, athleteConfig = {}) {
  if (!fitData.sessions || fitData.sessions.length === 0) {
    return null;
  }

  const athlete = { ...DEFAULT_ATHLETE, ...athleteConfig };
  const session = fitData.sessions[0];
  const records = fitData.records || [];
  
  const analysis = {
    readiness: 'good',
    feedback: [],
  };

  // Sport detection
  let sport = session.sport || 'unknown';
  if (sport === 'cycling' || sport === 'biking') sport = 'bike';
  else if (sport === 'running') sport = 'run';
  else if (sport === 'swimming' || sport === 'lap_swimming' || sport === 'open_water') sport = 'swim';

  // Duration
  const durationSec = session.total_timer_time || session.total_elapsed_time || 0;
  const durationMin = durationSec / 60;
  
  // Distance
  let distanceKm = session.total_distance || 0;
  if (distanceKm > 1000) distanceKm = distanceKm / 1000;

  analysis.duration = `${Math.round(durationMin)}min`;
  analysis.durationMinutes = Math.round(durationMin);
  analysis.distance = `${distanceKm.toFixed(1)}km`;
  analysis.distanceKm = distanceKm;

  // ==================== HR ANALYSIS ====================
  const avgHR = session.avg_heart_rate;
  if (avgHR) {
    analysis.avgHR = avgHR;
    analysis.maxHR = session.max_heart_rate || 0;

    const hrs = records.map(r => r.heart_rate).filter(hr => hr && hr > 0 && hr < 255);

    if (hrs.length > 100) {
      const quarter = Math.floor(hrs.length / 4);
      const firstQ = hrs.slice(0, quarter);
      const lastQ = hrs.slice(-quarter);
      const avgFirst = firstQ.reduce((a, b) => a + b, 0) / firstQ.length;
      const avgLast = lastQ.reduce((a, b) => a + b, 0) / lastQ.length;
      const drift = avgLast - avgFirst;

      analysis.hrDrift = Math.round(drift);

      const driftFeedback = {
        title: '❤️ Heart Rate Analysis',
        type: Math.abs(drift) > 15 ? 'warning' : Math.abs(drift) > 10 ? 'caution' : 'good',
        items: [
          `Average HR: ${avgHR} bpm`,
          `HR Drift: <strong>${drift > 0 ? '+' : ''}${Math.round(drift)} bpm</strong>`,
        ],
      };

      if (Math.abs(drift) > 15) {
        driftFeedback.items.push('<strong>⚠️ Significant drift.</strong> Likely fueling issue or started too hard.');
        analysis.readiness = 'warning';
      } else if (Math.abs(drift) > 10) {
        driftFeedback.items.push('Moderate drift - monitor on longer efforts.');
      } else {
        driftFeedback.items.push('✓ Excellent HR stability.');
      }

      analysis.feedback.push(driftFeedback);
    }
  }

  // ==================== BIKE ANALYSIS ====================
  if (sport === 'bike' && session.avg_power) {
    analysis.avgPower = session.avg_power;
    analysis.maxPower = session.max_power || 0;

    const powers = records.map(r => r.power).filter(p => p && p > 0 && p < 3000);

    if (powers.length > 0) {
      const ftp = athlete.ftp;
      const z1Max = ftp * 0.55, z2Max = ftp * 0.75, z3Max = ftp * 0.90, z4Max = ftp * 1.05;

      analysis.powerDistribution = {
        z1: Math.round((powers.filter(p => p < z1Max).length / powers.length) * 1000) / 10,
        z2: Math.round((powers.filter(p => p >= z1Max && p < z2Max).length / powers.length) * 1000) / 10,
        z3: Math.round((powers.filter(p => p >= z2Max && p < z3Max).length / powers.length) * 1000) / 10,
        z4: Math.round((powers.filter(p => p >= z3Max && p < z4Max).length / powers.length) * 1000) / 10,
        z5: Math.round((powers.filter(p => p >= z4Max).length / powers.length) * 1000) / 10,
      };

      analysis.powerZoneBoundaries = { z1: Math.round(z1Max), z2: Math.round(z2Max), z3: Math.round(z3Max), z4: Math.round(z4Max), ftp };

      // NP calculation
      const np = calculateNP(powers);
      analysis.normalizedPower = Math.round(np);
      const vi = analysis.avgPower > 0 ? np / analysis.avgPower : 1.0;
      analysis.variabilityIndex = Math.round(vi * 100) / 100;
      
      // Intensity Factor
      analysis.intensityFactor = Math.round((np / ftp) * 100) / 100;

      const powerFeedback = {
        title: '⚡ Power Analysis',
        type: vi > 1.10 ? 'warning' : vi > 1.05 ? 'caution' : 'good',
        items: [
          `Average: ${analysis.avgPower}W (${Math.round(analysis.avgPower / ftp * 100)}% FTP)`,
          `Normalized: ${analysis.normalizedPower}W (IF ${analysis.intensityFactor})`,
          `Variability Index: <strong>${vi.toFixed(2)}</strong>`,
        ],
      };

      if (vi > 1.10) {
        powerFeedback.items.push('<strong>⚠️ Poor power discipline.</strong> Practice steady efforts.');
        analysis.readiness = 'warning';
      } else if (vi > 1.05) {
        powerFeedback.items.push('Work on smoothing power output.');
      } else {
        powerFeedback.items.push('✓ Excellent power discipline.');
      }

      if (analysis.powerDistribution.z5 > 10) {
        powerFeedback.items.push(`<strong>⚠️ ${analysis.powerDistribution.z5.toFixed(0)}% above FTP</strong> - too much for 70.3.`);
      }

      analysis.feedback.push(powerFeedback);
    }
  }

  // ==================== RUN ANALYSIS ====================
  if (sport === 'run') {
    let paceSeconds = null;
    
    if (session.avg_speed && session.avg_speed > 0) {
      paceSeconds = 3600 / session.avg_speed;
    } else if (distanceKm > 0 && durationMin > 0) {
      paceSeconds = (durationMin * 60) / distanceKm;
    }

    if (paceSeconds && paceSeconds > 0 && paceSeconds < 1200) {
      const paceMin = Math.floor(paceSeconds / 60);
      const paceSecs = Math.floor(paceSeconds % 60);
      analysis.avgPace = `${paceMin}:${paceSecs.toString().padStart(2, '0')}`;
      analysis.avgPaceSeconds = paceSeconds;

      // Projected half marathon time
      const projectedHM = (paceSeconds / 60) * 21.1;
      analysis.projectedHalfMarathon = Math.round(projectedHM);

      const runFeedback = {
        title: '🏃 Run Analysis',
        type: 'good',
        items: [
          `Pace: ${analysis.avgPace} /km`,
          `Distance: ${distanceKm.toFixed(2)} km`,
          `Projected HM: ${Math.floor(projectedHM / 60)}h${Math.round(projectedHM % 60)}min`,
        ],
      };

      if (durationMin > 75) {
        runFeedback.items.push('✓ Good long run volume.');
        if (analysis.hrDrift && analysis.hrDrift > 15) {
          runFeedback.type = 'warning';
          runFeedback.items.push(`<strong>⚠️ ${analysis.hrDrift} bpm drift on long run.</strong>`);
        }
      }

      analysis.feedback.push(runFeedback);
    }
  }

  // ==================== SWIM ANALYSIS ====================
  if (sport === 'swim') {
    const distanceM = distanceKm * 1000;
    let paceSeconds = null;
    
    if (distanceM > 0 && durationMin > 0) {
      paceSeconds = (durationMin * 60) / (distanceM / 100);
    }

    if (paceSeconds && paceSeconds > 0 && paceSeconds < 600) {
      const paceMin = Math.floor(paceSeconds / 60);
      const paceSecs = Math.floor(paceSeconds % 60);
      analysis.avgPace = `${paceMin}:${paceSecs.toString().padStart(2, '0')}`;
      analysis.avgPaceSeconds = paceSeconds;

      const projectedTime = (paceSeconds / 100) * 1900 / 60;
      analysis.projectedRaceSwim = Math.round(projectedTime);

      const cutoffBuffer = 70 - projectedTime;
      
      const swimFeedback = {
        title: '🏊 Swim Analysis',
        type: cutoffBuffer < 5 ? 'critical' : cutoffBuffer < 15 ? 'warning' : 'good',
        items: [
          `Pace: ${analysis.avgPace} /100m`,
          `Distance: ${distanceM.toFixed(0)}m`,
          `Projected 1.9km: <strong>${Math.round(projectedTime)} min</strong>`,
        ],
      };

      if (cutoffBuffer < 5) {
        swimFeedback.items.push(`<strong>🚨 CRITICAL: Only ${Math.round(cutoffBuffer)} min to cutoff!</strong>`);
        analysis.readiness = 'critical';
      } else if (cutoffBuffer < 15) {
        swimFeedback.items.push(`⚠️ ${Math.round(cutoffBuffer)} min buffer - needs improvement.`);
        analysis.readiness = 'warning';
      } else {
        swimFeedback.items.push(`✓ ${Math.round(cutoffBuffer)} min buffer.`);
      }

      analysis.feedback.push(swimFeedback);
    }
  }

  // ==================== ADVANCED METRICS ====================
  
  // TSS
  const tssData = calculateTSS(
    sport, 
    durationMin, 
    analysis.avgPower, 
    analysis.normalizedPower, 
    analysis.avgPaceSeconds, 
    analysis.avgHR, 
    athlete
  );
  
  // Efficiency (bike/run only, needs records)
  let efficiency = null;
  if ((sport === 'bike' || sport === 'run') && records.length > 600) {
    efficiency = calculateEfficiency(records, sport);
  }
  
  // Intervals
  let intervals = null;
  if ((sport === 'bike' || sport === 'run') && records.length > 120) {
    intervals = detectIntervals(records, sport);
  }
  
  // Coaching insights for Claude
  const coachingInsights = generateCoachingInsights(sport, analysis, tssData, efficiency, intervals);

  // ==================== BUILD RESULT ====================
  let workoutDate = new Date();
  if (session.start_time) workoutDate = new Date(session.start_time);
  else if (session.timestamp) workoutDate = new Date(session.timestamp);

  const result = {
    sport,
    date: workoutDate.toISOString().split('T')[0],
    duration: analysis.duration,
    durationMinutes: analysis.durationMinutes,
    distance: analysis.distance,
    distanceKm: analysis.distanceKm,
    analysis,
    // NEW: Advanced metrics
    tss: tssData?.tss || null,
    intensityFactor: tssData?.intensityFactor || analysis.intensityFactor || null,
    efficiency: efficiency,
    intervals: intervals,
    coachingInsights: coachingInsights,
  };

  return result;
}

// =============================================================================
// API HANDLER
// =============================================================================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: `Method ${req.method} not allowed` });

  try {
    const busboy = require('busboy');
    const FitParser = require('fit-file-parser').default;
    
    const { fitBuffer, athleteConfig } = await new Promise((resolve, reject) => {
      const bb = busboy({ headers: req.headers });
      let fileBuffer = null;
      let config = {};

      bb.on('file', (name, file, info) => {
        const chunks = [];
        file.on('data', (data) => chunks.push(data));
        file.on('end', () => { fileBuffer = Buffer.concat(chunks); });
      });

      bb.on('field', (name, val) => {
        if (name === 'athleteConfig') {
          try { config = JSON.parse(val); } catch (e) {}
        }
      });

      bb.on('finish', () => resolve({ fitBuffer: fileBuffer, athleteConfig: config }));
      bb.on('error', reject);
      req.pipe(bb);
    });

    if (!fitBuffer || fitBuffer.length < 14) {
      return res.status(400).json({ error: 'No valid FIT file uploaded' });
    }

    const fitParser = new FitParser({
      force: true,
      speedUnit: 'km/h',
      lengthUnit: 'km',
      elapsedRecordField: true,
      mode: 'list',
    });

    const fitData = await new Promise((resolve, reject) => {
      fitParser.parse(fitBuffer, (error, data) => {
        if (error) reject(new Error(error));
        else resolve(data);
      });
    });

    const result = analyzeWorkout(fitData, athleteConfig);

    if (!result) {
      return res.status(400).json({ error: 'Could not analyze FIT file' });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Parse error:', error);
    return res.status(500).json({ error: error.message });
  }
}
