// IronCoach - Claude Coaching Analysis API
// Provides AI-powered workout feedback using Anthropic's Claude

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ 
      error: 'ANTHROPIC_API_KEY not configured',
      message: 'Add ANTHROPIC_API_KEY to your Vercel environment variables'
    });
  }

  try {
    const { workout, message, conversationHistory, athleteConfig, prescription } = req.body;

    // Build context about the athlete
    const athleteContext = athleteConfig ? `
Athlete Profile:
- FTP: ${athleteConfig.ftp}W
- Weight: ${athleteConfig.weight}kg
- Run threshold: ${Math.floor(athleteConfig.runThresholdPace/60)}:${(athleteConfig.runThresholdPace%60).toString().padStart(2,'0')}/km
- Swim CSS: ${Math.floor(athleteConfig.swimCSS/60)}:${(athleteConfig.swimCSS%60).toString().padStart(2,'0')}/100m
- Race: Ironman 70.3 Oman (Feb 14, 2026)
- Race targets: Swim <50min, Bike 3:45 @ ~160W, Run 2:00 @ 5:40/km
` : `
Athlete Profile:
- FTP: 190W
- Weight: 72kg
- Race: Ironman 70.3 Oman (Feb 14, 2026)
- Key constraint: 70-minute swim cutoff
`;

    // Build workout context
    let workoutContext = '';
    if (workout) {
      workoutContext = `
Workout Data:
- Sport: ${workout.sport}
- Date: ${workout.date}
- Duration: ${workout.duration}
- Distance: ${workout.distance}
`;
      
      if (workout.analysis) {
        const a = workout.analysis;
        if (a.avgHR) workoutContext += `- Avg HR: ${a.avgHR} bpm\n`;
        if (a.hrDrift !== undefined) workoutContext += `- HR Drift: ${a.hrDrift > 0 ? '+' : ''}${a.hrDrift} bpm\n`;
        if (a.avgPower) workoutContext += `- Avg Power: ${a.avgPower}W\n`;
        if (a.normalizedPower) workoutContext += `- Normalized Power: ${a.normalizedPower}W\n`;
        if (a.variabilityIndex) workoutContext += `- Variability Index: ${a.variabilityIndex}\n`;
        if (a.avgPace) workoutContext += `- Avg Pace: ${a.avgPace}\n`;
        if (a.projectedRaceSwim) workoutContext += `- Projected 1.9km swim: ${a.projectedRaceSwim} min\n`;
        
        if (a.powerDistribution) {
          workoutContext += `- Power Distribution: Z1 ${a.powerDistribution.z1}%, Z2 ${a.powerDistribution.z2}%, Z3 ${a.powerDistribution.z3}%, Z4 ${a.powerDistribution.z4}%\n`;
        }
      }

      if (prescription) {
        workoutContext += `
Coach Prescription: ${prescription.prescribed || 'Not specified'}
Athlete's Plan: ${prescription.plan || 'Not specified'}
How it felt: ${prescription.feel || 'Not specified'}
`;
      }
    }

    // Build the prompt
    const systemPrompt = `You are an elite Ironman triathlon coach analyzing workout data for an athlete preparing for Ironman 70.3 Oman.

Your coaching philosophy:
1. Be direct and specific - no generic advice
2. Always relate feedback to race-day implications
3. Prioritize: swim cutoff risk > bike pacing discipline > run HR management
4. Give ONE concrete action item per response
5. Use the athlete's actual numbers, not general ranges

Critical race context:
- 70-minute swim cutoff is the #1 risk
- 800m elevation gain on bike requires steady power discipline
- Run is off the bike - HR drift management is critical

${athleteContext}
${workoutContext}

Respond concisely (3-5 sentences max). Be encouraging but honest about gaps.`;

    let messages = [];
    
    if (conversationHistory && conversationHistory.length > 0) {
      // Continue conversation
      messages = conversationHistory.map(m => ({
        role: m.role,
        content: m.content
      }));
      if (message) {
        messages.push({ role: 'user', content: message });
      }
    } else if (workout) {
      // Initial workout analysis
      messages = [{
        role: 'user',
        content: `Analyze this ${workout.sport} workout and give me your coaching verdict. What did I do well? What's the one thing I should focus on improving?`
      }];
    } else if (message) {
      // General question
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
        max_tokens: 500,
        system: systemPrompt,
        messages: messages
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Anthropic API error:', error);
      return res.status(response.status).json({ 
        error: 'Failed to get analysis',
        details: error
      });
    }

    const data = await response.json();
    const analysis = data.content[0]?.text || 'Unable to generate analysis';

    return res.status(200).json({ analysis });

  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({ error: error.message });
  }
}
