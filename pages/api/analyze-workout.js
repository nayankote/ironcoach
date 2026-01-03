// =============================================================================
// IronCoach - Claude Coaching Analysis API
// Enhanced with TSS, PMC, efficiency context for smarter coaching
// =============================================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ 
      error: 'ANTHROPIC_API_KEY not configured',
      message: 'Add ANTHROPIC_API_KEY to your Vercel environment variables'
    });
  }

  try {
    const { 
      workout, 
      message, 
      conversationHistory, 
      athleteConfig, 
      prescription,
      pmc,           // NEW: PMC data from analyze-history
      readiness      // NEW: Readiness scores
    } = req.body;

    // Build athlete context
    const athleteContext = buildAthleteContext(athleteConfig);
    
    // Build workout context with all the new metrics
    const workoutContext = buildWorkoutContext(workout, prescription);
    
    // Build training load context
    const loadContext = buildLoadContext(pmc, readiness);
    
    // Build coaching insights (auto-generated from parse-fit)
    const insightsContext = workout?.coachingInsights?.length > 0
      ? `\nKey Insights:\n${workout.coachingInsights.map(i => `• ${i}`).join('\n')}`
      : '';

    const systemPrompt = `You are an elite Ironman triathlon coach. You have deep expertise in endurance training, race execution, and sport science.

ATHLETE PROFILE:
${athleteContext}

TRAINING CONTEXT:
${loadContext}

${workoutContext}
${insightsContext}

COACHING PRINCIPLES:
1. Be specific - use the athlete's actual numbers
2. Relate everything to race-day implications for Ironman 70.3 Oman
3. Priority order: swim cutoff > bike power discipline > run HR management
4. Give ONE concrete action item
5. Be encouraging but honest about gaps
6. Reference TSS, efficiency, and intervals when available

RACE SPECIFICS:
- 1.9km ocean swim with 70-minute HARD CUTOFF (priority #1)
- 90km bike with 800m elevation gain (requires power discipline)
- 21.1km run off the bike (HR drift management critical)
- Expected conditions: 22-28°C, potentially windy

Respond concisely (3-5 sentences). Be direct.`;

    let messages = [];
    
    if (conversationHistory && conversationHistory.length > 0) {
      messages = conversationHistory.map(m => ({
        role: m.role,
        content: m.content
      }));
      if (message) {
        messages.push({ role: 'user', content: message });
      }
    } else if (workout) {
      messages = [{
        role: 'user',
        content: `Analyze this ${workout.sport} workout. What's your coaching verdict? What did I execute well, and what's the #1 thing to focus on?`
      }];
    } else if (message) {
      messages = [{ role: 'user', content: message }];
    } else {
      return res.status(400).json({ error: 'No workout or message provided' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        system: systemPrompt,
        messages: messages
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Anthropic API error:', error);
      return res.status(response.status).json({ error: 'Failed to get analysis', details: error });
    }

    const data = await response.json();
    const analysis = data.content[0]?.text || 'Unable to generate analysis';

    return res.status(200).json({ analysis });

  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// =============================================================================
// CONTEXT BUILDERS
// =============================================================================

function buildAthleteContext(config) {
  if (!config) {
    return `FTP: 190W | Weight: 72kg | Race: Ironman 70.3 Oman (Feb 14, 2026)`;
  }
  
  const runPace = config.runThresholdPace 
    ? `${Math.floor(config.runThresholdPace/60)}:${(config.runThresholdPace%60).toString().padStart(2,'0')}/km`
    : '5:00/km';
  const swimCSS = config.swimCSS
    ? `${Math.floor(config.swimCSS/60)}:${(config.swimCSS%60).toString().padStart(2,'0')}/100m`
    : '3:00/100m';

  return `FTP: ${config.ftp || 190}W | Weight: ${config.weight || 72}kg
Run threshold: ${runPace} | Swim CSS: ${swimCSS}
Race: Ironman 70.3 Oman (Feb 14, 2026)
Targets: Swim <50min, Bike ~3:45 @ 160W, Run ~2:00 @ 5:40/km`;
}

function buildWorkoutContext(workout, prescription) {
  if (!workout) return '';
  
  let context = `
WORKOUT DATA:
Sport: ${workout.sport.toUpperCase()}
Date: ${workout.date}
Duration: ${workout.duration} | Distance: ${workout.distance}`;

  const a = workout.analysis || {};
  
  // Core metrics
  if (a.avgHR) context += `\nAvg HR: ${a.avgHR} bpm`;
  if (a.hrDrift !== undefined) context += ` | HR Drift: ${a.hrDrift > 0 ? '+' : ''}${a.hrDrift} bpm`;
  
  // Bike-specific
  if (workout.sport === 'bike') {
    if (a.avgPower) context += `\nAvg Power: ${a.avgPower}W`;
    if (a.normalizedPower) context += ` | NP: ${a.normalizedPower}W`;
    if (a.variabilityIndex) context += ` | VI: ${a.variabilityIndex}`;
    if (a.intensityFactor) context += ` | IF: ${a.intensityFactor}`;
    if (a.powerDistribution) {
      context += `\nPower Zones: Z1 ${a.powerDistribution.z1}%, Z2 ${a.powerDistribution.z2}%, Z3 ${a.powerDistribution.z3}%, Z4 ${a.powerDistribution.z4}%, Z5 ${a.powerDistribution.z5}%`;
    }
  }
  
  // Run-specific
  if (workout.sport === 'run') {
    if (a.avgPace) context += `\nPace: ${a.avgPace}/km`;
    if (a.projectedHalfMarathon) context += ` | Projected HM: ${Math.floor(a.projectedHalfMarathon/60)}h${a.projectedHalfMarathon%60}min`;
  }
  
  // Swim-specific
  if (workout.sport === 'swim') {
    if (a.avgPace) context += `\nPace: ${a.avgPace}/100m`;
    if (a.projectedRaceSwim) {
      const buffer = 70 - a.projectedRaceSwim;
      context += ` | Projected 1.9km: ${a.projectedRaceSwim}min (${buffer > 0 ? buffer : 'OVER'} min to cutoff)`;
    }
  }
  
  // NEW: Advanced metrics
  if (workout.tss) context += `\nTSS: ${workout.tss}`;
  if (workout.intensityFactor) context += ` | IF: ${workout.intensityFactor}`;
  
  if (workout.efficiency) {
    context += `\nEfficiency: ${workout.efficiency.status} (${workout.efficiency.aerobicDecoupling}% decoupling)`;
  }
  
  if (workout.intervals && workout.intervals.type !== 'steady') {
    context += `\nIntervals: ${workout.intervals.workIntervals} work intervals`;
    if (workout.intervals.avgWorkPower) {
      context += ` @ ${workout.intervals.avgWorkPower}W avg`;
    }
  }
  
  // Prescription context
  if (prescription) {
    context += `\n\nPRESCRIPTION:`;
    if (prescription.prescribed) context += `\nCoach prescribed: ${prescription.prescribed}`;
    if (prescription.plan) context += `\nAthlete planned: ${prescription.plan}`;
    if (prescription.feel) context += `\nHow it felt: ${prescription.feel}`;
  }

  return context;
}

function buildLoadContext(pmc, readiness) {
  let context = '';
  
  if (pmc) {
    context += `\nTRAINING LOAD:`;
    context += `\nFitness (CTL): ${pmc.ctl} | Fatigue (ATL): ${pmc.atl} | Form (TSB): ${pmc.tsb}`;
    if (pmc.formStatus) context += ` (${pmc.formStatus})`;
    if (pmc.rampRate) context += `\nRamp rate: ${pmc.rampRate > 0 ? '+' : ''}${pmc.rampRate} CTL/day`;
  }
  
  if (readiness) {
    context += `\n\nREADINESS SCORES:`;
    if (readiness.swim) context += `\nSwim: ${readiness.swim.score}/10 (${readiness.swim.status})`;
    if (readiness.bike) context += `\nBike: ${readiness.bike.score}/10 (${readiness.bike.status})`;
    if (readiness.run) context += `\nRun: ${readiness.run.score}/10 (${readiness.run.status})`;
    if (readiness.overall) context += `\nOverall: ${readiness.overall}/10`;
    if (readiness.limiter) context += ` | Limiter: ${readiness.limiter.toUpperCase()}`;
  }
  
  return context;
}
