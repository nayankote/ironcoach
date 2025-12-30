export const config = {
  api: {
    bodyParser: false,
  },
};

class FITParser {
  constructor(buffer) {
    this.data = new Uint8Array(buffer);
    this.pos = 0;
    this.definitions = {};
    this.sessions = [];
    this.laps = [];
    this.records = [];
  }

  parse() {
    const headerSize = this.data[0];
    this.pos = headerSize;

    while (this.pos < this.data.length - 2) {
      if (!this.parseMessage()) break;
    }

    return {
      sessions: this.sessions,
      laps: this.laps,
      records: this.records,
    };
  }

  parseMessage() {
    if (this.pos >= this.data.length) return false;

    const header = this.data[this.pos++];

    if (header & 0x40) {
      return this.parseDefinition(header);
    } else {
      return this.parseData(header);
    }
  }

  parseDefinition(header) {
    const localMsg = header & 0x0f;

    if (this.pos + 5 > this.data.length) return false;

    const reserved = this.data[this.pos];
    const arch = this.data[this.pos + 1];
    const globalMsg = this.readUint16(this.pos + 2, arch === 0);
    const numFields = this.data[this.pos + 4];
    this.pos += 5;

    const fields = [];
    for (let i = 0; i < numFields; i++) {
      if (this.pos + 3 > this.data.length) return false;
      const fieldDef = this.data[this.pos];
      const fieldSize = this.data[this.pos + 1];
      const baseType = this.data[this.pos + 2];
      fields.push([fieldDef, fieldSize, baseType]);
      this.pos += 3;
    }

    this.definitions[localMsg] = {
      global: globalMsg,
      arch: arch,
      fields: fields,
    };

    return true;
  }

  parseData(header) {
    const localMsg = header & 0x0f;

    if (!this.definitions[localMsg]) {
      this.pos += 20;
      return true;
    }

    const defn = this.definitions[localMsg];
    const msgData = {};
    const littleEndian = defn.arch === 0;

    for (const [fieldNum, size, baseType] of defn.fields) {
      if (this.pos + size > this.data.length) return false;

      let value = null;
      if (size === 1) {
        value = this.data[this.pos];
        if (value === 0xff) value = null;
      } else if (size === 2) {
        value = this.readUint16(this.pos, littleEndian);
        if (value === 0xffff) value = null;
      } else if (size === 4) {
        value = this.readUint32(this.pos, littleEndian);
        if (value === 0xffffffff) value = null;
      }

      this.pos += size;

      if (value !== null) {
        msgData[fieldNum] = value;
      }
    }

    const globalMsg = defn.global;
    if (globalMsg === 18) {
      this.sessions.push(msgData);
    } else if (globalMsg === 19) {
      this.laps.push(msgData);
    } else if (globalMsg === 20) {
      this.records.push(msgData);
    }

    return true;
  }

  readUint16(pos, littleEndian) {
    if (littleEndian) {
      return this.data[pos] | (this.data[pos + 1] << 8);
    } else {
      return (this.data[pos] << 8) | this.data[pos + 1];
    }
  }

  readUint32(pos, littleEndian) {
    if (littleEndian) {
      return (
        this.data[pos] |
        (this.data[pos + 1] << 8) |
        (this.data[pos + 2] << 16) |
        (this.data[pos + 3] << 24)
      ) >>> 0;
    } else {
      return (
        (this.data[pos] << 24) |
        (this.data[pos + 1] << 16) |
        (this.data[pos + 2] << 8) |
        this.data[pos + 3]
      ) >>> 0;
    }
  }
}

function analyzeWorkout(parsed) {
  const { sessions, laps, records } = parsed;

  if (!sessions || sessions.length === 0) {
    return null;
  }

  const session = sessions[0];
  const analysis = {
    readiness: 'warning',
    feedback: [],
  };

  // Correct FIT sport codes from Garmin SDK
  const sportMap = { 
    0: 'generic',
    1: 'run',      // Running
    2: 'bike',     // Cycling
    5: 'swim'      // Swimming
  };
  
  let sport = sportMap[session[5]];
  
  // If sport field is missing or unrecognized, try to infer
  if (!sport || sport === 'generic') {
    // Check for power data + low cadence = cycling
    // Note: Field 20 (power) can be present for both bike AND run (running power estimates)
    // Field 4 (cadence) invalid values: 0xFF (uint8), 0xFFFF (uint16), 0x7FFFFFFF or 0xFFFFFFFF (uint32)
    const hasPower = session[20] != null && session[20] > 0 && session[20] !== 0xFFFF && session[20] !== 65535;
    const avgCadence = session[4];
    const validCadence = avgCadence != null && avgCadence !== 0xFF && avgCadence !== 0xFFFF && 
                        avgCadence !== 0x7FFFFFFF && avgCadence !== 2147483647 && avgCadence !== 0xFFFFFFFF;
    
    // Cycling cadence is typically 60-120 RPM
    // Running cadence is typically 150-180 SPM (stored as RPM, so 75-90 in FIT)
    if (validCadence) {
      if (avgCadence < 120) {
        sport = 'bike'; // Low cadence = cycling
      } else {
        sport = 'run';  // High cadence = running
      }
    } else if (hasPower && session[20] > 100) {
      // High power without cadence = likely cycling (running power is usually <100W)
      sport = 'bike';
    } else {
      sport = 'bike'; // Default fallback
    }
  }

  const durationMs = session[8] || session[7] || 0;
  const durationMin = durationMs / 1000 / 60;
  const distanceM = (session[9] || 0) / 100000;

  analysis.duration = `${Math.round(durationMin)}min`;
  analysis.distance = `${distanceM.toFixed(1)}km`;

  if (session[16]) {
    analysis.avgHR = session[16];
    analysis.maxHR = session[17] || 0;

    const hrs = records.map(r => r[3]).filter(hr => hr && hr !== 255);

    if (hrs.length > 100) {
      const quarter = Math.floor(hrs.length / 4);
      const firstQuarter = hrs.slice(0, quarter);
      const lastQuarter = hrs.slice(-quarter);

      const avgFirst = firstQuarter.reduce((a, b) => a + b, 0) / firstQuarter.length;
      const avgLast = lastQuarter.reduce((a, b) => a + b, 0) / lastQuarter.length;
      const drift = avgLast - avgFirst;

      const driftFeedback = {
        title: '❤️ Heart Rate Analysis',
        type: Math.abs(drift) > 10 ? 'warning' : 'good',
        items: [
          `Average HR: ${analysis.avgHR} bpm`,
          `HR Drift: <strong>${drift > 0 ? '+' : ''}${Math.round(drift)} bpm</strong> (first 25% vs last 25%)`,
        ],
      };

      if (Math.abs(drift) > 10) {
        driftFeedback.items.push('<strong>⚠️ Significant drift detected.</strong> This suggests cardiovascular fatigue. Focus on aerobic base building.');
        analysis.readiness = 'warning';
      } else {
        driftFeedback.items.push('✓ Good HR stability maintained throughout workout.');
      }

      analysis.feedback.push(driftFeedback);
    }
  }

  if (sport === 'bike' && session[20]) {
    analysis.avgPower = session[20];
    analysis.maxPower = session[21] || 0;

    const powers = records.map(r => r[7]).filter(p => p && p !== 65535);

    if (powers.length > 0) {
      const total = powers.length;
      analysis.powerDistribution = {
        z1: Math.round((powers.filter(p => p < 120).length / total) * 1000) / 10,
        z2: Math.round((powers.filter(p => p >= 120 && p < 150).length / total) * 1000) / 10,
        z3: Math.round((powers.filter(p => p >= 150 && p < 190).length / total) * 1000) / 10,
        z4: Math.round((powers.filter(p => p >= 190).length / total) * 1000) / 10,
      };

      const sortedPowers = [...powers].sort((a, b) => b - a);
      const top20Pct = sortedPowers.slice(0, Math.floor(powers.length / 5));
      const npEstimate = top20Pct.reduce((a, b) => a + b, 0) / top20Pct.length;
      const vi = analysis.avgPower > 0 ? npEstimate / analysis.avgPower : 1.0;

      const powerFeedback = {
        title: '⚡ Power Analysis',
        type: vi > 1.05 ? 'warning' : 'good',
        items: [
          `Average Power: ${analysis.avgPower}W`,
          `Variability Index: <strong>${vi.toFixed(2)}</strong> (target: <1.05)`,
        ],
      };

      if (vi > 1.05) {
        powerFeedback.items.push('<strong>⚠️ Poor power discipline.</strong> Too much variation indicates surging. Practice steady-state efforts.');
        analysis.readiness = 'warning';
      } else {
        powerFeedback.items.push('✓ Excellent power discipline maintained.');
      }

      if (analysis.powerDistribution.z4 > 15) {
        powerFeedback.items.push(`<strong>⚠️ ${analysis.powerDistribution.z4}% above FTP.</strong> For Ironman, keep >190W efforts under 10%.`);
      }

      analysis.feedback.push(powerFeedback);
    }
  }

  if (sport === 'run' && session[14] && session[14] > 0) {
    const paceSec = 1000 / (session[14] / 1000);
    const paceMin = Math.floor(paceSec / 60);
    const paceSecs = Math.floor(paceSec % 60);
    analysis.avgPace = `${paceMin}:${paceSecs.toString().padStart(2, '0')}`;

    const runFeedback = {
      title: '🏃 Run Analysis',
      type: 'good',
      items: [
        `Average Pace: ${analysis.avgPace} /km`,
        `Distance: ${distanceM.toFixed(2)} km`,
      ],
    };

    if (durationMin > 60) {
      runFeedback.items.push('✓ Good long run volume for half marathon training.');
    }

    analysis.feedback.push(runFeedback);
  }

  if (analysis.feedback.length === 0) {
    analysis.readiness = 'good';
  }

  // Extract workout date from FIT file
  const FIT_EPOCH = new Date(Date.UTC(1989, 11, 31, 0, 0, 0)); // FIT epoch: Dec 31, 1989
  let workoutDate = new Date();
  
  if (session[253]) {
    // Field 253 is timestamp in seconds since FIT epoch
    const timestamp = session[253];
    workoutDate = new Date(FIT_EPOCH.getTime() + timestamp * 1000);
  } else if (session[2]) {
    // Field 2 is also sometimes used for timestamp
    const timestamp = session[2];
    workoutDate = new Date(FIT_EPOCH.getTime() + timestamp * 1000);
  }

  return {
    sport,
    date: workoutDate.toISOString().split('T')[0],
    duration: analysis.duration,
    distance: analysis.distance,
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
    
    const fitData = await new Promise((resolve, reject) => {
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

    if (!fitData || fitData.length < 14) {
      return res.status(400).json({ error: 'No valid FIT file uploaded' });
    }

    const parser = new FITParser(fitData);
    const parsed = parser.parse();
    const result = analyzeWorkout(parsed);

    if (!result) {
      return res.status(400).json({ error: 'Could not analyze FIT file' });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
