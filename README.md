# IronCoach - Training Analysis Platform

Integrated FIT file parser with expert analysis for Ironman 70.3 training.

## Features

- **FIT File Parsing**: Automatic extraction of power, HR, pace data from Garmin/Zwift files
- **Expert Analysis**: Critical feedback on:
  - Power discipline & variability index
  - Heart rate drift & cardiovascular fitness
  - Pacing strategies
  - Sport-specific metrics
- **Calendar View**: TrainingPeaks-style interface
- **Readiness Scoring**: Per-workout performance assessment

## Deployment to Vercel

### Prerequisites
- Vercel account
- Vercel CLI: `npm i -g vercel`

### Deploy Steps

1. **Install dependencies:**
   ```bash
   cd ironcoach-app
   npm install
   ```

2. **Deploy to Vercel:**
   ```bash
   vercel
   ```

3. **Follow prompts:**
   - Link to existing project or create new
   - Accept default settings
   - Deploy!

4. **Production deployment:**
   ```bash
   vercel --prod
   ```

## Local Development

```bash
npm run dev
```

Opens on http://localhost:3000

**Note**: Python API routes work automatically in both local dev and Vercel production.

## Architecture

- **Frontend**: Next.js + React
- **Backend**: Vercel Serverless Functions (Python)
- **Parser**: Your working FIT parser integrated into `/api/parse-fit.py`

## Analysis Features

### Bike Workouts
- Power distribution across zones
- Variability index (target: <1.05)
- Heart rate drift detection
- FTP-relative effort tracking

### Run Workouts  
- Pace analysis
- Heart rate trends
- Long run volume assessment

### Swim Workouts
- Duration & distance tracking
- (More metrics coming as you add swim-specific parsing)

## Next Steps

1. Deploy to Vercel
2. Upload your 80 FIT files
3. Get immediate expert analysis on each workout
4. Build out TrainingPeaks API integration (Phase 2)
