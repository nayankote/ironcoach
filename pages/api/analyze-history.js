// =============================================================================
// IronCoach - Analyze History API
// Calculates PMC (fitness/fatigue/form) and readiness scores across all workouts
// =============================================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { workouts, athleteConfig } = req.body;

    if (!workouts || !Array.isArray(workouts) || workouts.length === 0) {
      return res.status(400).json({ error: 'No workouts provided' });
    }

    const athlete = {
      ftp: 190,
      weight: 72,
      lthr: 165,
      runThresholdPace: 300,
      swimCSS: 180,
      ...athleteConfig
    };

    // Calculate PMC
    const pmc = calculatePMC(workouts);
    
    // Calculate readiness
    const readiness = calculateReadiness(workouts, athlete);
    
    // Sport stats
    const sportStats = calculateSportStats(workouts);
    
    // Weekly volume
    const weeklyVolume = calculateWeeklyVolume(workouts);

    return res.status(200).json({
      pmc,
      readiness,
      sportStats,
      weeklyVolume,
      totalWorkouts: workouts.length
    });

  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// =============================================================================
// PMC CALCULATION
// =============================================================================
function calculatePMC(workouts) {
  const sorted = workouts
    .filter(w => w.tss && w.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (sorted.length === 0) {
    return { atl: 0, ctl: 0, tsb: 0, rampRate: 0, history: [] };
  }

  // Build daily TSS map
  const tssMap = new Map();
  sorted.forEach(w => {
    const dateKey = w.date.split('T')[0];
    tssMap.set(dateKey, (tssMap.get(dateKey) || 0) + w.tss);
  });

  // Calculate from first workout to today
  const startDate = new Date(sorted[0].date);
  const endDate = new Date();
  
  let atl = 0, ctl = 0;
  const atlDecay = Math.exp(-1 / 7);
  const ctlDecay = Math.exp(-1 / 42);
  
  const history = [];
  const currentDate = new Date(startDate);
  
  while (currentDate <= endDate) {
    const dateKey = currentDate.toISOString().split('T')[0];
    const dailyTSS = tssMap.get(dateKey) || 0;
    
    atl = atl * atlDecay + dailyTSS * (1 - atlDecay);
    ctl = ctl * ctlDecay + dailyTSS * (1 - ctlDecay);
    
    history.push({
      date: dateKey,
      atl: Math.round(atl),
      ctl: Math.round(ctl),
      tsb: Math.round(ctl - atl),
      tss: dailyTSS
    });
    
    currentDate.setDate(currentDate.getDate() + 1);
  }

  const latest = history[history.length - 1];
  
  // Ramp rate
  let rampRate = 0;
  if (history.length >= 7) {
    const weekAgo = history[history.length - 7];
    rampRate = (latest.ctl - weekAgo.ctl) / 7;
  }

  // Form status
  let formStatus;
  if (latest.tsb < -20) formStatus = 'overreaching';
  else if (latest.tsb < -10) formStatus = 'tired';
  else if (latest.tsb < 5) formStatus = 'neutral';
  else if (latest.tsb < 15) formStatus = 'fresh';
  else formStatus = 'detraining';

  // Fitness level
  let fitnessLevel;
  if (latest.ctl < 25) fitnessLevel = 'building';
  else if (latest.ctl < 50) fitnessLevel = 'moderate';
  else if (latest.ctl < 75) fitnessLevel = 'trained';
  else fitnessLevel = 'well-trained';

  return {
    atl: latest.atl,
    ctl: latest.ctl,
    tsb: latest.tsb,
    rampRate: Math.round(rampRate * 10) / 10,
    formStatus,
    fitnessLevel,
    history: history.slice(-60) // Last 60 days
  };
}

// =============================================================================
// READINESS CALCULATION
// =============================================================================
function calculateReadiness(workouts, athlete) {
  const now = new Date();
  const sixWeeksAgo = new Date(now);
  sixWeeksAgo.setDate(now.getDate() - 42);
  
  const recent = workouts.filter(w => new Date(w.date) > sixWeeksAgo);

  const readiness = {
    swim: null,
    bike: null,
    run: null,
    overall: null,
    limiter: null
  };

  // ==================== SWIM ====================
  const swims = recent.filter(w => w.sport === 'swim');
  if (swims.length > 0) {
    let score = 0;
    const factors = [];

    // Pace vs cutoff (50%)
    const projections = swims.map(w => w.analysis?.projectedRaceSwim).filter(t => t > 0 && t < 120);
    if (projections.length > 0) {
      const avgProjected = projections.reduce((a, b) => a + b, 0) / projections.length;
      const buffer = 70 - avgProjected;
      
      let paceScore;
      if (buffer > 20) paceScore = 10;
      else if (buffer > 15) paceScore = 8;
      else if (buffer > 10) paceScore = 6;
      else if (buffer > 5) paceScore = 4;
      else if (buffer > 0) paceScore = 2;
      else paceScore = 1;
      
      score += paceScore * 0.5;
      factors.push({ name: 'Pace', value: `${Math.round(avgProjected)}min proj`, score: paceScore, critical: buffer < 5 });
    }

    // Volume (25%)
    const volumeScore = Math.min(10, Math.round(swims.length * 1.5));
    score += volumeScore * 0.25;
    factors.push({ name: 'Frequency', value: `${swims.length} sessions`, score: volumeScore });

    // Distance coverage (25%)
    const longestM = Math.max(...swims.map(w => (w.distanceKm || 0) * 1000));
    let distScore;
    if (longestM >= 2000) distScore = 10;
    else if (longestM >= 1500) distScore = 7;
    else if (longestM >= 1000) distScore = 4;
    else distScore = 2;
    
    score += distScore * 0.25;
    factors.push({ name: 'Long Swim', value: `${longestM}m`, score: distScore });

    readiness.swim = {
      score: Math.round(score),
      factors,
      status: score >= 8 ? 'ready' : score >= 4 ? 'building' : 'critical'
    };
  }

  // ==================== BIKE ====================
  const bikes = recent.filter(w => w.sport === 'bike');
  if (bikes.length > 0) {
    let score = 0;
    const factors = [];

    // Power discipline (40%)
    const vis = bikes.map(w => w.analysis?.variabilityIndex).filter(v => v > 0);
    if (vis.length > 0) {
      const avgVI = vis.reduce((a, b) => a + b, 0) / vis.length;
      let viScore;
      if (avgVI <= 1.03) viScore = 10;
      else if (avgVI <= 1.05) viScore = 8;
      else if (avgVI <= 1.08) viScore = 6;
      else if (avgVI <= 1.10) viScore = 4;
      else viScore = 2;
      
      score += viScore * 0.4;
      factors.push({ name: 'Power Discipline', value: `VI ${avgVI.toFixed(2)}`, score: viScore, critical: avgVI > 1.10 });
    }

    // Weekly load (30%)
    const totalTSS = bikes.reduce((s, w) => s + (w.tss || 0), 0);
    const weeklyTSS = totalTSS / 6;
    let loadScore;
    if (weeklyTSS >= 200) loadScore = 10;
    else if (weeklyTSS >= 150) loadScore = 8;
    else if (weeklyTSS >= 100) loadScore = 6;
    else if (weeklyTSS >= 50) loadScore = 4;
    else loadScore = 2;
    
    score += loadScore * 0.3;
    factors.push({ name: 'Weekly Load', value: `${Math.round(weeklyTSS)} TSS/wk`, score: loadScore });

    // Long ride (30%)
    const longestMin = Math.max(...bikes.map(w => w.durationMinutes || 0));
    let longScore;
    if (longestMin >= 180) longScore = 10;
    else if (longestMin >= 150) longScore = 8;
    else if (longestMin >= 120) longScore = 6;
    else if (longestMin >= 90) longScore = 4;
    else longScore = 2;
    
    score += longScore * 0.3;
    factors.push({ name: 'Long Ride', value: `${longestMin}min`, score: longScore });

    readiness.bike = {
      score: Math.round(score),
      factors,
      status: score >= 8 ? 'ready' : score >= 4 ? 'building' : 'needs_work'
    };
  }

  // ==================== RUN ====================
  const runs = recent.filter(w => w.sport === 'run');
  if (runs.length > 0) {
    let score = 0;
    const factors = [];

    // HR stability (40%)
    const drifts = runs.map(w => w.analysis?.hrDrift).filter(d => d !== undefined);
    if (drifts.length > 0) {
      const avgDrift = drifts.reduce((a, b) => a + Math.abs(b), 0) / drifts.length;
      let driftScore;
      if (avgDrift <= 8) driftScore = 10;
      else if (avgDrift <= 12) driftScore = 8;
      else if (avgDrift <= 15) driftScore = 6;
      else if (avgDrift <= 20) driftScore = 4;
      else driftScore = 2;
      
      score += driftScore * 0.4;
      factors.push({ name: 'HR Stability', value: `${Math.round(avgDrift)}bpm drift`, score: driftScore, critical: avgDrift > 20 });
    }

    // Volume (30%)
    const totalKm = runs.reduce((s, w) => s + (w.distanceKm || 0), 0);
    const weeklyKm = totalKm / 6;
    let volScore;
    if (weeklyKm >= 30) volScore = 10;
    else if (weeklyKm >= 25) volScore = 8;
    else if (weeklyKm >= 20) volScore = 6;
    else if (weeklyKm >= 15) volScore = 4;
    else volScore = 2;
    
    score += volScore * 0.3;
    factors.push({ name: 'Weekly Volume', value: `${Math.round(weeklyKm)}km/wk`, score: volScore });

    // Long run (30%)
    const longestKm = Math.max(...runs.map(w => w.distanceKm || 0));
    let longScore;
    if (longestKm >= 18) longScore = 10;
    else if (longestKm >= 15) longScore = 8;
    else if (longestKm >= 12) longScore = 6;
    else if (longestKm >= 10) longScore = 4;
    else longScore = 2;
    
    score += longScore * 0.3;
    factors.push({ name: 'Long Run', value: `${longestKm.toFixed(1)}km`, score: longScore });

    readiness.run = {
      score: Math.round(score),
      factors,
      status: score >= 8 ? 'ready' : score >= 4 ? 'building' : 'needs_work'
    };
  }

  // ==================== OVERALL ====================
  const scores = [
    readiness.swim?.score,
    readiness.bike?.score,
    readiness.run?.score
  ].filter(s => s !== null && s !== undefined);

  if (scores.length > 0) {
    // Weighted: swim matters most due to cutoff
    let weightedSum = 0, totalWeight = 0;
    if (readiness.swim) { weightedSum += readiness.swim.score * 0.4; totalWeight += 0.4; }
    if (readiness.bike) { weightedSum += readiness.bike.score * 0.35; totalWeight += 0.35; }
    if (readiness.run) { weightedSum += readiness.run.score * 0.25; totalWeight += 0.25; }
    
    readiness.overall = Math.round(weightedSum / totalWeight);
    
    // Find limiter
    const sportScores = [
      { sport: 'swim', score: readiness.swim?.score || 0 },
      { sport: 'bike', score: readiness.bike?.score || 0 },
      { sport: 'run', score: readiness.run?.score || 0 }
    ].filter(s => s.score > 0).sort((a, b) => a.score - b.score);
    
    if (sportScores.length > 0) {
      readiness.limiter = sportScores[0].sport;
    }
  }

  return readiness;
}

// =============================================================================
// SPORT STATS
// =============================================================================
function calculateSportStats(workouts) {
  const stats = {};
  
  ['swim', 'bike', 'run'].forEach(sport => {
    const sportWorkouts = workouts.filter(w => w.sport === sport);
    if (sportWorkouts.length === 0) {
      stats[sport] = null;
      return;
    }

    const totalDuration = sportWorkouts.reduce((s, w) => s + (w.durationMinutes || 0), 0);
    const totalDistance = sportWorkouts.reduce((s, w) => s + (w.distanceKm || 0), 0);
    const totalTSS = sportWorkouts.reduce((s, w) => s + (w.tss || 0), 0);

    stats[sport] = {
      count: sportWorkouts.length,
      totalDuration,
      totalDistance: Math.round(totalDistance * 10) / 10,
      totalTSS,
      avgDuration: Math.round(totalDuration / sportWorkouts.length),
      avgDistance: Math.round((totalDistance / sportWorkouts.length) * 10) / 10,
      avgTSS: Math.round(totalTSS / sportWorkouts.length),
    };

    // Sport-specific stats
    if (sport === 'bike') {
      const vis = sportWorkouts.map(w => w.analysis?.variabilityIndex).filter(v => v > 0);
      if (vis.length > 0) {
        stats[sport].avgVI = Math.round(vis.reduce((a, b) => a + b, 0) / vis.length * 100) / 100;
      }
    }

    if (sport === 'run') {
      const paces = sportWorkouts.map(w => w.analysis?.avgPaceSeconds).filter(p => p > 0);
      if (paces.length > 0) {
        const avgPace = paces.reduce((a, b) => a + b, 0) / paces.length;
        const min = Math.floor(avgPace / 60);
        const sec = Math.floor(avgPace % 60);
        stats[sport].avgPace = `${min}:${sec.toString().padStart(2, '0')}`;
      }
    }

    if (sport === 'swim') {
      const paces = sportWorkouts.map(w => w.analysis?.avgPaceSeconds).filter(p => p > 0);
      if (paces.length > 0) {
        const avgPace = paces.reduce((a, b) => a + b, 0) / paces.length;
        const min = Math.floor(avgPace / 60);
        const sec = Math.floor(avgPace % 60);
        stats[sport].avgPace = `${min}:${sec.toString().padStart(2, '0')}`;
      }
    }
  });

  return stats;
}

// =============================================================================
// WEEKLY VOLUME
// =============================================================================
function calculateWeeklyVolume(workouts) {
  const weeks = new Map();
  
  workouts.forEach(w => {
    if (!w.date) return;
    
    const date = new Date(w.date);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const weekKey = weekStart.toISOString().split('T')[0];
    
    if (!weeks.has(weekKey)) {
      weeks.set(weekKey, {
        week: weekKey,
        swim: { count: 0, duration: 0, distance: 0, tss: 0 },
        bike: { count: 0, duration: 0, distance: 0, tss: 0 },
        run: { count: 0, duration: 0, distance: 0, tss: 0 },
        total: { count: 0, duration: 0, distance: 0, tss: 0 }
      });
    }
    
    const week = weeks.get(weekKey);
    const sport = w.sport;
    
    if (week[sport]) {
      week[sport].count += 1;
      week[sport].duration += w.durationMinutes || 0;
      week[sport].distance += w.distanceKm || 0;
      week[sport].tss += w.tss || 0;
    }
    
    week.total.count += 1;
    week.total.duration += w.durationMinutes || 0;
    week.total.distance += w.distanceKm || 0;
    week.total.tss += w.tss || 0;
  });

  return Array.from(weeks.values())
    .sort((a, b) => a.week.localeCompare(b.week))
    .slice(-12); // Last 12 weeks
}
