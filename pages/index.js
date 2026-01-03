import React, { useState, useEffect } from 'react';

export default function IronCoach() {
  const [workouts, setWorkouts] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedWorkout, setSelectedWorkout] = useState(null);
  const [countdown, setCountdown] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [viewMode, setViewMode] = useState('timeline'); // 'timeline' or 'calendar'
  const [feedbackExpanded, setFeedbackExpanded] = useState({});
  const [readiness, setReadiness] = useState({
    swim: null,
    bike: null,
    run: null
  });
  
  // PMC (Performance Management Chart) data from analyze-history API
  const [pmc, setPmc] = useState(null);
  const [fullReadiness, setFullReadiness] = useState(null);
  
  // Claude chat state
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [claudeAnalysis, setClaudeAnalysis] = useState(null);
  
  // NEW: Athlete configuration
  const [athleteConfig, setAthleteConfig] = useState({
    ftp: 190,
    weight: 72,
    runThresholdPace: 300, // 5:00/km in seconds
    swimCSS: 180, // 3:00/100m in seconds
    raceTargets: {
      swimCutoff: 70,
      swimTarget: 50,
      bikeTarget: 225, // 3:45
      bikePower: 160,
      runTarget: 120,
      runPace: 340 // 5:40/km
    }
  });
  const [showSettings, setShowSettings] = useState(false);
  
  // NEW: Prescription context modal
  const [prescriptionModal, setPrescriptionModal] = useState({
    open: false,
    workout: null,
    queue: []
  });
  
  const raceDate = new Date(Date.UTC(2026, 1, 14, 6, 0, 0));

// Calculate readiness scores from API (uses TSS, PMC, efficiency)
  useEffect(() => {
    if (workouts.length === 0) return;
    
    fetch('/api/analyze-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workouts, athleteConfig })
    })
    .then(r => r.json())
    .then(data => {
      setPmc(data.pmc);
      setFullReadiness(data.readiness);
      // Map to existing readiness format for backward compatibility
      setReadiness({
        swim: data.readiness?.swim?.score || null,
        bike: data.readiness?.bike?.score || null,
        run: data.readiness?.run?.score || null
      });
    })
    .catch(err => console.error('History analysis failed:', err));
  }, [workouts, athleteConfig]);

  // Countdown timer
  useEffect(() => {
    updateCountdown();
    const interval = setInterval(updateCountdown, 60000);
    return () => clearInterval(interval);
  }, []);

  const updateCountdown = () => {
    const now = new Date();
    const diff = raceDate - now;
    
    if (diff < 0) {
      setCountdown({ days: 0, hours: 0, minutes: 0 });
      return;
    }
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    setCountdown({ days, hours, minutes });
  };

  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    setUploading(true);
    setUploadProgress('Preparing files...');

    const newWorkouts = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadProgress(`Reading ${file.name}...`);
      
      const formData = new FormData();
      formData.append('file', file);
      formData.append('athleteConfig', JSON.stringify(athleteConfig));

      try {
        setUploadProgress(`Analyzing ${file.name}...`);
        
        const response = await fetch('/api/parse-fit', {
          method: 'POST',
          body: formData,
        });

        if (response.ok) {
          const data = await response.json();
          newWorkouts.push({
            id: Date.now() + Math.random(),
            filename: file.name,
            ...data
          });
          setUploadProgress(`✓ Analyzed ${file.name}`);
        }
      } catch (error) {
        console.error('Error parsing file:', error);
        setUploadProgress(`✗ Failed to analyze ${file.name}`);
      }
      
      // Brief pause to show progress
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Show prescription modal for new workouts
    if (newWorkouts.length > 0) {
      setPrescriptionModal({
        open: true,
        workout: newWorkouts[0],
        queue: newWorkouts.slice(1)
      });
    }

    setUploading(false);
    setUploadProgress('');
    event.target.value = '';
  };

  // NEW: Handle prescription save
  const savePrescription = (prescription) => {
    const workoutWithPrescription = {
      ...prescriptionModal.workout,
      prescription
    };
    
    const updated = [...workouts, workoutWithPrescription].sort((a, b) => 
      new Date(b.date) - new Date(a.date)
    );
    setWorkouts(updated);
    setSelectedWorkout(workoutWithPrescription);
    
    // Process queue
    if (prescriptionModal.queue.length > 0) {
      setPrescriptionModal({
        open: true,
        workout: prescriptionModal.queue[0],
        queue: prescriptionModal.queue.slice(1)
      });
    } else {
      setPrescriptionModal({ open: false, workout: null, queue: [] });
      // Get Claude analysis after prescription is saved
      setTimeout(() => getClaudeAnalysis(workoutWithPrescription), 300);
    }
  };

  const skipPrescription = () => {
    const workout = prescriptionModal.workout;
    const updated = [...workouts, workout].sort((a, b) => 
      new Date(b.date) - new Date(a.date)
    );
    setWorkouts(updated);
    setSelectedWorkout(workout);
    
    if (prescriptionModal.queue.length > 0) {
      setPrescriptionModal({
        open: true,
        workout: prescriptionModal.queue[0],
        queue: prescriptionModal.queue.slice(1)
      });
    } else {
      setPrescriptionModal({ open: false, workout: null, queue: [] });
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.fit'));
    if (files.length > 0) {
      // Simulate file input event
      handleFileUpload({ target: { files } });
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const getClaudeAnalysis = async (workout) => {
    if (!workout) return;
    
    setIsAnalyzing(true);
    setChatMessages([]);
    setClaudeAnalysis(null);
    
    try {
      const response = await fetch('/api/analyze-workout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          workout,
          athleteConfig,
          prescription: workout.prescription,
          pmc,
          readiness: fullReadiness
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Analysis failed');
      }
      
      const data = await response.json();
      setClaudeAnalysis(data.analysis);
      
      // Add to chat history
      setChatMessages([{
        role: 'assistant',
        content: data.analysis
      }]);
      
    } catch (error) {
      console.error('Claude analysis error:', error);
      setClaudeAnalysis(`Error: ${error.message}\n\nMake sure ANTHROPIC_API_KEY is set in Vercel environment variables.`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || isAnalyzing) return;
    
    const userMessage = chatInput.trim();
    setChatInput('');
    
    // Add user message to chat
    const newMessages = [...chatMessages, { role: 'user', content: userMessage }];
    setChatMessages(newMessages);
    setIsAnalyzing(true);
    
    try {
      const response = await fetch('/api/analyze-workout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: userMessage,
          conversationHistory: newMessages,
          workout: selectedWorkout,
          athleteConfig,
          pmc,
          readiness: fullReadiness
        })
      });
      
      if (!response.ok) {
        throw new Error('Chat request failed');
      }
      
      const data = await response.json();
      
      setChatMessages([...newMessages, {
        role: 'assistant',
        content: data.analysis
      }]);
      
    } catch (error) {
      console.error('Chat error:', error);
      setChatMessages([...newMessages, {
        role: 'assistant',
        content: `Error: ${error.message}`
      }]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const renderTimeline = () => {
    if (workouts.length === 0) {
      return (
        <div className="timeline-empty">
          <div className="timeline-empty-icon">📊</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem', color: '#666' }}>
            No workouts yet
          </div>
          <div style={{ fontSize: '0.9rem' }}>
            Upload FIT files to start tracking your training progress
          </div>
        </div>
      );
    }

    return (
      <div className="timeline-container">
        {workouts.map(workout => {
          const sportIcons = { swim: '🏊‍♂️', bike: '🚴‍♂️', run: '🏃‍♂️' };
          const workoutDate = new Date(workout.date);
          const dateStr = workoutDate.toLocaleDateString('en-US', { 
            weekday: 'short',
            month: 'short', 
            day: 'numeric',
            year: 'numeric'
          });

          // Extract key feedback
          let feedbackPreview = '';
          let badgeType = 'good';
          if (workout.analysis?.feedback && workout.analysis.feedback.length > 0) {
            const firstFeedback = workout.analysis.feedback[0];
            badgeType = firstFeedback.type || 'warning';
            const firstItem = firstFeedback.items[0]?.replace(/<[^>]*>/g, '') || '';
            feedbackPreview = firstItem.length > 120 ? firstItem.substring(0, 120) + '...' : firstItem;
          }

          return (
            <div
              key={workout.id}
              className={`workout-card ${selectedWorkout?.id === workout.id ? 'active' : ''}`}
              onClick={() => setSelectedWorkout(workout)}
            >
              <div className="workout-card-top">
                <div className="workout-card-left">
                  <div className="workout-card-icon">{sportIcons[workout.sport] || '💪'}</div>
                  <div className="workout-card-title">
                    <span className={`workout-card-sport ${workout.sport}`}>
                      {workout.sport?.toUpperCase() || 'WORKOUT'}
                    </span>
                    <span className="workout-card-date">{dateStr}</span>
                  </div>
                </div>
              </div>

              <div className="workout-card-metrics">
                <div className="workout-metric">
                  <div className="workout-metric-label">Duration</div>
                  <div className="workout-metric-value">{workout.duration || '—'}</div>
                </div>
                <div className="workout-metric">
                  <div className="workout-metric-label">Distance</div>
                  <div className="workout-metric-value">{workout.distance || '—'}</div>
                </div>
                {workout.analysis?.avgHR && (
                  <div className="workout-metric">
                    <div className="workout-metric-label">Avg HR</div>
                    <div className="workout-metric-value">{workout.analysis.avgHR}</div>
                  </div>
                )}
                {workout.analysis?.avgPower && (
                  <div className="workout-metric">
                    <div className="workout-metric-label">Avg Power</div>
                    <div className="workout-metric-value">{workout.analysis.avgPower}W</div>
                  </div>
                )}
                {workout.analysis?.avgPace && (
                  <div className="workout-metric">
                    <div className="workout-metric-label">Pace</div>
                    <div className="workout-metric-value">{workout.analysis.avgPace}</div>
                  </div>
                )}
              </div>

              {feedbackPreview && (
                <>
                  <div className="workout-card-preview">{feedbackPreview}</div>
                  <div className="workout-card-badges">
                    <span className={`workout-card-badge ${badgeType}`}>
                      {badgeType === 'good' ? '✓ Good Performance' : 
                       badgeType === 'critical' ? '⚠ Critical Issues' : '⚠ Needs Review'}
                    </span>
                  </div>
                </>
              )}

              <div className="workout-card-arrow">→</div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderHRChart = (workout) => {
    const avgHR = workout.analysis.avgHR || 140;
    const driftAmount = workout.analysis.hrDrift || 0; // Use actual drift from parser
    
    return (
      <div className="chart-container">
        <div className="chart-title">
          Heart Rate Over Time
          {driftAmount > 10 && (
            <span className="chart-annotation">⚠ HR climbing throughout workout</span>
          )}
        </div>
        <canvas 
          id={`hr-chart-${workout.id}`}
          className="chart-canvas"
          ref={(canvas) => {
            if (canvas && !canvas.dataset.rendered) {
              canvas.dataset.rendered = 'true';
              const ctx = canvas.getContext('2d');
              canvas.width = canvas.offsetWidth * 2;
              canvas.height = 400;
              ctx.scale(2, 2);
              
              const points = 50;
              const hrData = Array.from({ length: points }, (_, i) => {
                const drift = (i / points) * driftAmount;
                return avgHR - 10 + Math.random() * 20 + drift;
              });
              
              const width = canvas.offsetWidth;
              const height = 200;
              const padding = 40;
              
              ctx.strokeStyle = '#f0f0f0';
              ctx.lineWidth = 1;
              for (let i = 0; i <= 4; i++) {
                const y = padding + (height - 2 * padding) * i / 4;
                ctx.beginPath();
                ctx.moveTo(padding, y);
                ctx.lineTo(width - padding, y);
                ctx.stroke();
              }
              
              ctx.strokeStyle = '#e74c3c';
              ctx.lineWidth = 2;
              ctx.beginPath();
              
              hrData.forEach((hr, i) => {
                const x = padding + (width - 2 * padding) * i / (points - 1);
                const minHR = Math.min(...hrData) - 5;
                const maxHR = Math.max(...hrData) + 5;
                const y = height - padding - ((hr - minHR) / (maxHR - minHR)) * (height - 2 * padding);
                
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              });
              ctx.stroke();
              
              ctx.fillStyle = '#666';
              ctx.font = '11px sans-serif';
              ctx.textAlign = 'right';
              const minHR = Math.min(...hrData);
              const maxHR = Math.max(...hrData);
              ctx.fillText(`${Math.round(maxHR)} bpm`, padding - 5, padding + 5);
              ctx.fillText(`${Math.round(minHR)} bpm`, padding - 5, height - padding + 5);
            }
          }}
        />
        <div className="chart-insight" dangerouslySetInnerHTML={{ 
          __html: driftAmount > 10 
            ? `Your HR started at ${Math.round(avgHR - 6)} and climbed to ${Math.round(avgHR + 6)} by the end. This means your body is working harder to maintain the same pace - you're getting tired. <strong>Fix:</strong> On your next long workout, slow down by 30 seconds per km. You should be able to hold a conversation.`
            : `HR stayed steady throughout - your body handled this effort comfortably.`
        }} />
      </div>
    );
  };

  const renderPowerDistribution = (workout) => {
    const dist = workout.analysis.powerDistribution;
    if (!dist) return null;

    const avgPower = workout.analysis.avgPower || 0;
    const targetPower = athleteConfig.raceTargets.bikePower; // Race target power
    const ftp = athleteConfig.ftp;
    
    // Calculate zone boundaries from FTP
    const z1Max = Math.round(ftp * 0.55);
    const z2Max = Math.round(ftp * 0.75);
    const z3Max = Math.round(ftp * 0.90);
    const z4Max = Math.round(ftp * 1.05);
    
    // Use boundaries from API if available, otherwise calculate
    const bounds = workout.analysis.powerZoneBoundaries || {
      z1: z1Max, z2: z2Max, z3: z3Max, z4: z4Max
    };
    
    return (
      <div className="chart-container">
        <div className="chart-title">
          Where You Spent Your Energy
          {(dist.z5 || 0) + (dist.z6 || 0) > 10 && <span className="chart-annotation">⚠ Too much time above FTP</span>}
        </div>
        <div className="power-zones-chart">
          <div className="power-zone-bar">
            <div className="power-zone-label">&lt;{bounds.z1}W (Recovery)</div>
            <div className="power-zone-track">
              <div className="power-zone-fill" style={{ width: `${Math.min(dist.z1, 100)}%`, background: 'linear-gradient(90deg, #95a5a6, #7f8c8d)' }}>
                {dist.z1 > 5 && <span className="power-zone-value">{dist.z1.toFixed(1)}%</span>}
              </div>
            </div>
          </div>
          <div className="power-zone-bar">
            <div className="power-zone-label">{bounds.z1}-{bounds.z2}W (Endurance)</div>
            <div className="power-zone-track">
              <div className="power-zone-fill" style={{ width: `${Math.min(dist.z2, 100)}%`, background: 'linear-gradient(90deg, #2ecc71, #27ae60)' }}>
                {dist.z2 > 5 && <span className="power-zone-value">{dist.z2.toFixed(1)}%</span>}
              </div>
            </div>
          </div>
          <div className="power-zone-bar">
            <div className="power-zone-label">{bounds.z2}-{bounds.z3}W (Tempo)</div>
            <div className="power-zone-track">
              <div className="power-zone-fill" style={{ width: `${Math.min(dist.z3, 100)}%`, background: 'linear-gradient(90deg, #f39c12, #e67e22)' }}>
                {dist.z3 > 5 && <span className="power-zone-value">{dist.z3.toFixed(1)}%</span>}
              </div>
            </div>
          </div>
          <div className="power-zone-bar">
            <div className="power-zone-label">{bounds.z3}-{bounds.z4}W (Threshold)</div>
            <div className="power-zone-track">
              <div className="power-zone-fill" style={{ width: `${Math.min(dist.z4, 100)}%`, background: 'linear-gradient(90deg, #e74c3c, #c0392b)' }}>
                {dist.z4 > 5 && <span className="power-zone-value">{dist.z4.toFixed(1)}%</span>}
              </div>
            </div>
          </div>
          <div className="power-zone-bar">
            <div className="power-zone-label">&gt;{bounds.z4}W (Above FTP)</div>
            <div className="power-zone-track">
              <div className="power-zone-fill" style={{ width: `${Math.min((dist.z5 || 0) + (dist.z6 || 0), 100)}%`, background: 'linear-gradient(90deg, #9b59b6, #8e44ad)' }}>
                {((dist.z5 || 0) + (dist.z6 || 0)) > 5 && <span className="power-zone-value">{((dist.z5 || 0) + (dist.z6 || 0)).toFixed(1)}%</span>}
              </div>
            </div>
          </div>
        </div>
        <div className="chart-insight" dangerouslySetInnerHTML={{
          __html: ((dist.z5 || 0) + (dist.z6 || 0)) > 10 
            ? `You spent ${((dist.z5 || 0) + (dist.z6 || 0)).toFixed(0)}% above FTP (>${ftp}W). For a 90km race, this burns matches you need for the run. <strong>Fix:</strong> Set your bike computer to alert above ${bounds.z4}W. Practice holding ${targetPower}W steady on climbs.`
            : dist.z1 + dist.z2 > 70
            ? `${(dist.z1 + dist.z2).toFixed(0)}% in Z1-Z2 - fine for recovery/easy rides. For race-specific work, aim for more time at ${targetPower}W.`
            : `Good power distribution for triathlon. Spending time in Z2-Z3 (${bounds.z1}-${bounds.z3}W) builds the aerobic engine you need.`
        }} />
      </div>
    );
  };

  const renderCriticalFeedback = (workout) => {
    if (!workout.analysis?.feedback) return null;
    
    const criticalItems = workout.analysis.feedback.filter(f => 
      f.type === 'warning' || f.type === 'critical'
    );
    
    if (criticalItems.length === 0) return null;

    return criticalItems.map((feedback, idx) => {
      const isExpanded = feedbackExpanded[`${workout.id}-${idx}`];
      
      return (
        <div key={idx} className={`critical-feedback ${feedback.type}`}>
          <div 
            className="critical-feedback-header"
            onClick={() => setFeedbackExpanded({
              ...feedbackExpanded,
              [`${workout.id}-${idx}`]: !isExpanded
            })}
          >
            <div className="critical-feedback-title">
              {feedback.type === 'critical' ? '🔴' : '⚠️'} {feedback.title}
            </div>
            <div className="critical-feedback-toggle">
              {isExpanded ? '−' : '+'}
            </div>
          </div>
          {isExpanded && (
            <div className="critical-feedback-content">
              {feedback.items.map((item, i) => (
                <div key={i} className="critical-feedback-item" dangerouslySetInnerHTML={{ __html: item }} />
              ))}
            </div>
          )}
        </div>
      );
    });
  };

  const calculateTrend = (currentWorkout, metricType) => {
    // Get last 5 workouts of the same sport (excluding current)
    const sameSportWorkouts = workouts
      .filter(w => w.sport === currentWorkout.sport && w.id !== currentWorkout.id)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5);

    if (sameSportWorkouts.length === 0) return null;

    // Extract metric values
    let currentValue, historicalValues;
    
    if (metricType === 'power') {
      currentValue = currentWorkout.analysis?.avgPower;
      historicalValues = sameSportWorkouts
        .map(w => w.analysis?.avgPower)
        .filter(v => v != null);
    } else if (metricType === 'hr') {
      currentValue = currentWorkout.analysis?.avgHR;
      historicalValues = sameSportWorkouts
        .map(w => w.analysis?.avgHR)
        .filter(v => v != null);
    } else if (metricType === 'pace') {
      // Convert pace string to seconds for comparison
      const paceToSeconds = (paceStr) => {
        if (!paceStr) return null;
        const [min, sec] = paceStr.split(':').map(Number);
        return min * 60 + sec;
      };
      currentValue = paceToSeconds(currentWorkout.analysis?.avgPace);
      historicalValues = sameSportWorkouts
        .map(w => paceToSeconds(w.analysis?.avgPace))
        .filter(v => v != null);
    }

    if (!currentValue || historicalValues.length === 0) return null;

    // Calculate average of historical values
    const avgHistorical = historicalValues.reduce((a, b) => a + b, 0) / historicalValues.length;
    const change = currentValue - avgHistorical;
    const percentChange = (change / avgHistorical) * 100;

    return {
      current: currentValue,
      historical: [...historicalValues, currentValue].slice(-6), // Last 6 including current
      change: change,
      percentChange: percentChange,
      improving: metricType === 'pace' ? change < 0 : change > 0 // For pace, lower is better
    };
  };

  const renderSparkline = (values, improving) => {
    return (
      <canvas 
        className="metric-sparkline"
        ref={(canvas) => {
          if (canvas && values && values.length > 1) {
            const ctx = canvas.getContext('2d');
            canvas.width = 120;
            canvas.height = 40;
            
            const padding = 4;
            const width = 120;
            const height = 40;
            
            const min = Math.min(...values);
            const max = Math.max(...values);
            const range = max - min || 1;
            
            ctx.clearRect(0, 0, width, height);
            ctx.strokeStyle = improving ? '#27ae60' : '#e74c3c';
            ctx.lineWidth = 2;
            ctx.beginPath();
            
            values.forEach((val, i) => {
              const x = padding + (width - 2 * padding) * i / (values.length - 1);
              const y = height - padding - ((val - min) / range) * (height - 2 * padding);
              
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            });
            
            ctx.stroke();
          }
        }}
      />
    );
  };

  const renderCalendar = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    
    const today = new Date();
    const isCurrentMonth = today.getMonth() === month && today.getFullYear() === year;
    
    const days = [];
    
    for (let i = firstDay - 1; i >= 0; i--) {
      days.push({ day: daysInPrevMonth - i, otherMonth: true });
    }
    
    for (let day = 1; day <= daysInMonth; day++) {
      const isToday = isCurrentMonth && day === today.getDate();
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayWorkouts = workouts.filter(w => w.date === dateStr);
      
      days.push({ 
        day, 
        otherMonth: false, 
        isToday, 
        workouts: dayWorkouts,
        dateStr 
      });
    }
    
    const remainingCells = 42 - days.length;
    for (let day = 1; day <= remainingCells; day++) {
      days.push({ day, otherMonth: true });
    }

    return (
      <div className="calendar-container">
        <div className="calendar-header">
          <div className="calendar-nav">
            <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}>
              ‹ Prev
            </button>
            <span className="calendar-title">{monthNames[month]} {year}</span>
            <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}>
              Next ›
            </button>
            <button onClick={() => setCurrentMonth(new Date())}>Today</button>
          </div>
        </div>

        <div className="calendar-grid">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="calendar-day-header">{day}</div>
          ))}
          
          {days.map((dayInfo, idx) => (
            <div 
              key={idx} 
              className={`calendar-day ${dayInfo.otherMonth ? 'other-month' : ''} ${dayInfo.isToday ? 'today' : ''}`}
            >
              <div className="day-number">{dayInfo.day}</div>
              {dayInfo.workouts && dayInfo.workouts.length > 0 && (
                <div className="day-workouts">
                  {dayInfo.workouts.map(workout => (
                    <div 
                      key={workout.id}
                      className={`day-workout ${workout.sport}`}
                      onClick={() => setSelectedWorkout(workout)}
                    >
                      {workout.sport?.toUpperCase()} {workout.duration}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      <style jsx global>{`
        :root {
          /* Brand Colors - Ocean Blue/Cyan Palette */
          --primary: #3498DB;
          --primary-dark: #2980B9;
          --primary-light: #5DADE2;
          --secondary: #1ABC9C;
          --secondary-dark: #16A085;
          --accent: #34495E;
          
          /* Text Colors */
          --text-primary: #2C3E50;
          --text-secondary: #7F8C8D;
          --text-light: #95A5A6;
          
          /* Background Colors */
          --bg-primary: #FFFFFF;
          --bg-secondary: #F8F9FA;
          --bg-tertiary: #ECF0F1;
          
          /* Status Colors */
          --success: #27AE60;
          --warning: #F39C12;
          --danger: #E74C3C;
          
          /* Sport Colors */
          --swim: #3498DB;
          --bike: #E67E22;
          --run: #E74C3C;
          
          /* UI Elements */
          --border: #E0E0E0;
          --border-light: #EFEFEF;
          --shadow-sm: 0 2px 4px rgba(52, 152, 219, 0.08);
          --shadow-md: 0 4px 8px rgba(52, 152, 219, 0.12);
          --shadow-lg: 0 8px 16px rgba(52, 152, 219, 0.16);
          --shadow-hover: 0 12px 24px rgba(52, 152, 219, 0.2);
        }

        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          background: var(--bg-secondary);
          color: var(--text-primary);
        }

        /* Smooth transitions for interactive elements */
        button, a, .card, .workout-card, .metric-card {
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .header {
          background: linear-gradient(135deg, var(--primary-dark) 0%, var(--primary) 100%);
          color: white;
          padding: 1.25rem 2rem;
          box-shadow: var(--shadow-md);
          position: relative;
        }

        .header h1 {
          font-size: 1.5rem;
          font-weight: 700;
          margin: 0;
          letter-spacing: -0.02em;
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .header h1::before {
          content: "🏊‍♂️";
          font-size: 1.75rem;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.15));
        }

        .hero-section {
          background: #f5f5f5;
          padding: 1.5rem 2rem;
          text-align: center;
          border-bottom: 3px solid #e0e0e0;
        }

        .hero-content {
          position: relative;
          z-index: 1;
        }

        .race-title {
          font-size: 0.75rem;
          color: #666;
          margin-bottom: 0.75rem;
          letter-spacing: 2px;
          text-transform: uppercase;
          font-weight: 600;
        }

        .countdown-container {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 1.5rem;
          margin: 0.75rem 0 1rem;
        }

        .countdown-separator {
          font-size: 2rem;
          color: var(--text-secondary);
          font-weight: 300;
          opacity: 0.6;
        }

        .countdown-unit {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .countdown-number {
          font-size: 3rem;
          font-weight: 800;
          line-height: 1;
          background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          font-family: 'JetBrains Mono', 'Courier New', monospace;
        }

        .countdown-label-small {
          font-size: 0.65rem;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-top: 0.25rem;
          font-weight: 700;
        }

        .readiness-grid {
          display: inline-flex;
          gap: 1rem;
          justify-content: center;
        }

        .readiness-card {
          background: var(--bg-primary);
          border: 2px solid var(--border);
          border-radius: 12px;
          padding: 1rem 1.25rem;
          min-width: 120px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: var(--shadow-sm);
        }

        .readiness-card:hover {
          transform: translateY(-4px);
          box-shadow: var(--shadow-lg);
          border-color: var(--primary);
        }

        .readiness-icon {
          font-size: 1.75rem;
          margin-bottom: 0.5rem;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
        }

        .readiness-sport {
          font-size: 0.7rem;
          color: var(--text-secondary);
          margin-bottom: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          font-weight: 700;
        }

        .readiness-score {
          font-size: 2rem;
          font-weight: 800;
          margin-bottom: 0.5rem;
          color: var(--text-primary);
          font-family: 'JetBrains Mono', 'Courier New', monospace;
        }

        .readiness-bar {
          height: 6px;
          background: var(--bg-tertiary);
          border-radius: 3px;
          overflow: hidden;
          margin-bottom: 0.5rem;
        }

        .readiness-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--primary) 0%, var(--secondary) 100%);
          border-radius: 3px;
          transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 0 8px rgba(52, 152, 219, 0.4);
        }

        .readiness-label {
          font-size: 0.7rem;
          color: var(--text-secondary);
          font-weight: 600;
        }

        .main-container {
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
        }

        .container {
          display: grid;
          grid-template-columns: 250px 1fr 50%;
          flex: 1;
          gap: 0;
          overflow: hidden;
          min-height: 0;
        }

        .sidebar {
          background: white;
          border-right: 1px solid #ddd;
          overflow-y: auto;
          padding: 1.5rem;
        }

        .sidebar h2 {
          font-size: 1.1rem;
          margin-bottom: 1rem;
          color: #333;
        }

        .upload-section {
          margin-bottom: 2rem;
        }

        .upload-section h2 {
          font-size: 1rem;
          margin-bottom: 1rem;
          font-weight: 600;
        }

        .upload-dropzone {
          border: 2px dashed var(--border);
          border-radius: 12px;
          padding: 2rem 1rem;
          text-align: center;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          background: var(--bg-primary);
        }

        .upload-dropzone:hover {
          border-color: var(--primary);
          background: var(--bg-tertiary);
          transform: scale(1.01);
        }

        .upload-dropzone.drag-over {
          border-color: var(--primary);
          background: linear-gradient(135deg, rgba(52, 152, 219, 0.05) 0%, rgba(26, 188, 156, 0.05) 100%);
          border-width: 3px;
          box-shadow: var(--shadow-md);
        }

        .upload-dropzone-icon {
          font-size: 2.5rem;
          margin-bottom: 0.5rem;
          opacity: 0.6;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .upload-dropzone:hover .upload-dropzone-icon {
          opacity: 0.9;
          transform: scale(1.1);
        }

        .upload-dropzone.drag-over .upload-dropzone-icon {
          opacity: 1;
          transform: scale(1.2);
          filter: drop-shadow(0 4px 8px rgba(52, 152, 219, 0.3));
        }

        .upload-dropzone-text {
          font-size: 0.9rem;
          color: #666;
          margin-bottom: 0.25rem;
          font-weight: 600;
        }

        .upload-dropzone-subtext {
          font-size: 0.75rem;
          color: #999;
        }

        .upload-progress {
          margin-top: 1rem;
          padding: 1rem;
          background: #e3f2fd;
          border-radius: 6px;
          font-size: 0.85rem;
          color: #1976d2;
          font-weight: 500;
        }

        .upload-progress-bar {
          height: 4px;
          background: #ddd;
          border-radius: 2px;
          overflow: hidden;
          margin-top: 0.5rem;
        }

        .upload-progress-fill {
          height: 100%;
          background: #3498db;
          transition: width 0.3s;
          animation: progress-pulse 1.5s ease-in-out infinite;
        }

        @keyframes progress-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }

        .upload-btn {
          width: 100%;
          padding: 0.75rem;
          background: var(--primary);
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          margin-bottom: 0.5rem;
          font-size: 1rem;
          box-shadow: var(--shadow-sm);
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .upload-btn:hover:not(:disabled) {
          background: var(--primary-dark);
          transform: translateY(-1px);
          box-shadow: var(--shadow-md);
        }

        .upload-btn:active:not(:disabled) {
          transform: translateY(0);
          box-shadow: var(--shadow-sm);
        }

        .upload-btn:disabled {
          background: var(--text-light);
          cursor: not-allowed;
          transform: none;
        }

        .upload-help {
          font-size: 0.8rem;
          color: #666;
          margin-top: 0.5rem;
        }

        .workout-list {
          margin-top: 1rem;
        }

        .workout-item {
          padding: 0.75rem;
          margin-bottom: 0.5rem;
          background: var(--bg-primary);
          border-radius: 8px;
          cursor: pointer;
          border-left: 4px solid transparent;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: var(--shadow-sm);
        }

        .workout-item:hover {
          background: var(--bg-tertiary);
          transform: translateX(4px);
          box-shadow: var(--shadow-md);
        }

        .workout-item.active {
          background: var(--bg-primary);
          box-shadow: var(--shadow-lg);
          transform: translateX(4px);
        }

        .workout-item.swim { 
          border-left-color: var(--swim);
        }
        .workout-item.swim.active {
          background: linear-gradient(90deg, rgba(52, 152, 219, 0.05) 0%, transparent 100%);
        }

        .workout-item.bike { 
          border-left-color: var(--bike);
        }
        .workout-item.bike.active {
          background: linear-gradient(90deg, rgba(230, 126, 34, 0.05) 0%, transparent 100%);
        }

        .workout-item.run { 
          border-left-color: var(--run);
        }
        .workout-item.run.active {
          background: linear-gradient(90deg, rgba(231, 76, 60, 0.05) 0%, transparent 100%);
        }

        .workout-sport {
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          margin-bottom: 0.25rem;
          letter-spacing: 0.05em;
        }

        .workout-sport.swim { color: var(--swim); }
        .workout-sport.bike { color: var(--bike); }
        .workout-sport.run { color: var(--run); }

        .workout-date {
          font-size: 0.85rem;
          color: var(--text-secondary);
          margin-bottom: 0.25rem;
          font-weight: 500;
        }

        .workout-details {
          font-size: 0.8rem;
          color: var(--text-light);
        }

        .calendar-section {
          background: white;
          padding: 2rem;
          overflow-y: auto;
        }

        .view-toggle {
          display: flex;
          gap: 0.25rem;
          justify-content: center;
          margin-bottom: 2rem;
          background: #f5f5f5;
          padding: 0.25rem;
          border-radius: 8px;
          width: fit-content;
          margin-left: auto;
          margin-right: auto;
        }

        .view-toggle button {
          padding: 0.5rem 1rem;
          background: transparent;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.8rem;
          font-weight: 600;
          color: #999;
          transition: all 0.2s;
        }

        .view-toggle button.active {
          background: white;
          color: #333;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .view-toggle button:hover {
          color: #333;
        }

        .timeline-container {
          max-width: 700px;
          margin: 0 auto;
        }

        .timeline-empty {
          text-align: center;
          padding: 4rem 2rem;
          color: #999;
        }

        .timeline-empty-icon {
          font-size: 4rem;
          margin-bottom: 1rem;
          opacity: 0.5;
        }

        .workout-card {
          background: white;
          border: 2px solid #e0e0e0;
          border-radius: 12px;
          padding: 1.5rem;
          margin-bottom: 1rem;
          cursor: pointer;
          transition: all 0.15s;
          position: relative;
        }

        .workout-card:hover {
          border-color: #333;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        }

        .workout-card.active {
          border-color: #333;
          background: #fafafa;
          box-shadow: 0 4px 12px rgba(0,0,0,0.12);
        }

        .workout-card-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 1rem;
        }

        .workout-card-left {
          display: flex;
          gap: 1rem;
          align-items: center;
        }

        .workout-card-icon {
          font-size: 2rem;
          flex-shrink: 0;
        }

        .workout-card-title {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .workout-card-sport {
          font-size: 0.85rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .workout-card-sport.swim { color: #3498db; }
        .workout-card-sport.bike { color: #e67e22; }
        .workout-card-sport.run { color: #e74c3c; }

        .workout-card-date {
          font-size: 0.75rem;
          color: #999;
          font-weight: 500;
        }

        .workout-card-metrics {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
          gap: 1rem;
          margin-bottom: 1rem;
          padding: 1rem;
          background: #f8f8f8;
          border-radius: 8px;
        }

        .workout-metric {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .workout-metric-label {
          font-size: 0.7rem;
          color: #999;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-weight: 600;
        }

        .workout-metric-value {
          font-size: 1.25rem;
          font-weight: 700;
          color: #333;
          font-family: 'Courier New', monospace;
        }

        .workout-card-preview {
          font-size: 0.85rem;
          color: #666;
          line-height: 1.5;
          margin-bottom: 0.75rem;
        }

        .workout-card-badges {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .workout-card-badge {
          padding: 0.35rem 0.75rem;
          border-radius: 6px;
          font-size: 0.7rem;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
        }

        .workout-card-badge.good {
          background: #d4edda;
          color: #155724;
        }

        .workout-card-badge.warning {
          background: #fff3cd;
          color: #856404;
        }

        .workout-card-badge.critical {
          background: #f8d7da;
          color: #721c24;
        }

        .workout-card-arrow {
          position: absolute;
          right: 1.5rem;
          top: 50%;
          transform: translateY(-50%);
          font-size: 1.5rem;
          color: #ccc;
          transition: all 0.2s;
        }

        .workout-card:hover .workout-card-arrow {
          color: #333;
          transform: translateY(-50%) translateX(4px);
        }

        .workout-card.active .workout-card-arrow {
          color: #333;
        }

        .calendar-container {
          max-width: 1200px;
          margin: 0 auto;
        }

        .calendar-header {
          margin-bottom: 2rem;
        }

        .calendar-nav {
          display: flex;
          gap: 1rem;
          align-items: center;
          justify-content: center;
        }

        .calendar-nav button {
          padding: 0.5rem 1rem;
          background: white;
          border: 1px solid #ddd;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.9rem;
        }

        .calendar-nav button:hover {
          background: #f5f5f5;
        }

        .calendar-title {
          font-size: 1.3rem;
          font-weight: 600;
          min-width: 200px;
          text-align: center;
        }

        .calendar-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 1px;
          background: #ddd;
          border: 1px solid #ddd;
        }

        .calendar-day-header {
          background: #f8f9fa;
          padding: 0.75rem;
          text-align: center;
          font-weight: 600;
          font-size: 0.85rem;
          color: #666;
        }

        .calendar-day {
          background: white;
          min-height: 100px;
          padding: 0.5rem;
          position: relative;
        }

        .calendar-day.other-month {
          background: #fafafa;
          color: #ccc;
        }

        .calendar-day.today {
          background: #fff3cd;
        }

        .day-number {
          font-size: 0.9rem;
          font-weight: 600;
          margin-bottom: 0.5rem;
        }

        .day-workouts {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .day-workout {
          font-size: 0.75rem;
          padding: 0.25rem 0.5rem;
          border-radius: 3px;
          cursor: pointer;
          transition: opacity 0.2s;
        }

        .day-workout:hover {
          opacity: 0.8;
        }

        .day-workout.swim {
          background: #3498db;
          color: white;
        }

        .day-workout.bike {
          background: #e67e22;
          color: white;
        }

        .day-workout.run {
          background: #e74c3c;
          color: white;
        }

        .analysis-panel {
          background: white;
          border-left: 1px solid #ddd;
          overflow-y: auto;
          padding: 2rem;
          transform: translateX(100%);
          transition: transform 0.3s ease;
        }

        .analysis-panel.visible {
          transform: translateX(0);
        }

        .analysis-panel.empty {
          display: flex;
          align-items: center;
          justify-content: center;
          color: #999;
          flex-direction: column;
          transform: translateX(0);
        }

        .analysis-header {
          margin-bottom: 2rem;
          border-bottom: 2px solid #eee;
          padding-bottom: 1rem;
        }

        .analysis-title {
          font-size: 1.2rem;
          font-weight: 600;
          margin-bottom: 0.5rem;
        }

        .analysis-meta {
          font-size: 0.9rem;
          color: #666;
          margin-top: 0.5rem;
        }

        .metric-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
          margin-bottom: 2rem;
        }

        .metric-card {
          background: var(--bg-primary);
          padding: 1rem;
          border-radius: 12px;
          position: relative;
          border: 1px solid var(--border-light);
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .metric-card:hover {
          border-color: var(--primary);
          box-shadow: var(--shadow-md);
          transform: translateY(-2px);
        }

        .metric-card-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.5rem;
        }

        .metric-label {
          font-size: 0.8rem;
          color: var(--text-secondary);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .metric-sparkline {
          width: 60px;
          height: 20px;
        }

        .metric-value {
          font-size: 1.75rem;
          font-weight: 700;
          color: var(--text-primary);
          font-family: 'JetBrains Mono', 'Courier New', monospace;
        }

        .metric-unit {
          font-size: 0.9rem;
          font-weight: 500;
          color: var(--text-secondary);
          margin-left: 0.25rem;
        }

        .metric-trend {
          font-size: 0.75rem;
          margin-top: 0.5rem;
          display: flex;
          align-items: center;
          gap: 0.25rem;
          font-weight: 600;
        }

        .metric-trend.up {
          color: var(--success);
        }

        .metric-trend.down {
          color: var(--danger);
        }

        .metric-trend.neutral {
          color: var(--text-light);
        }
          color: #e74c3c;
        }

        .metric-trend.neutral {
          color: #999;
        }

        .claude-analysis-section {
          background: white;
          border-radius: 8px;
          padding: 1.5rem;
          margin-bottom: 2rem;
        }

        .claude-analysis-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 1rem;
          font-weight: 600;
          color: #333;
        }

        .claude-analysis-content {
          line-height: 1.6;
          color: #444;
          white-space: pre-wrap;
        }

        .claude-analyzing {
          color: #999;
          font-style: italic;
        }

        .chat-section {
          background: #f8f9fa;
          border-radius: 8px;
          padding: 1rem;
          margin-top: 2rem;
        }

        .chat-header {
          font-weight: 600;
          margin-bottom: 1rem;
          color: #333;
        }

        .chat-messages {
          max-height: 300px;
          overflow-y: auto;
          margin-bottom: 1rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .chat-message {
          padding: 0.875rem 1rem;
          border-radius: 12px;
          line-height: 1.6;
          transition: all 0.2s ease;
        }

        .chat-message.user {
          background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
          color: white;
          align-self: flex-end;
          max-width: 80%;
          box-shadow: var(--shadow-sm);
        }

        .chat-message.assistant {
          background: var(--bg-primary);
          border: 1px solid var(--border);
          color: var(--text-primary);
          align-self: flex-start;
          max-width: 90%;
          white-space: pre-wrap;
          box-shadow: var(--shadow-sm);
        }

        .chat-input-container {
          display: flex;
          gap: 0.5rem;
        }

        .chat-input {
          flex: 1;
          padding: 0.875rem 1rem;
          border: 2px solid var(--border);
          border-radius: 12px;
          font-size: 0.9rem;
          transition: all 0.2s ease;
          background: var(--bg-primary);
        }

        .chat-input:focus {
          outline: none;
          border-color: var(--primary);
          box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.1);
        }

        .chat-send-btn {
          padding: 0.875rem 1.75rem;
          background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
          color: white;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          font-weight: 700;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: var(--shadow-sm);
        }

        .chat-send-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
        }

        .chat-send-btn:active:not(:disabled) {
          transform: translateY(0);
        }

        .chat-send-btn:disabled {
          background: var(--text-light);
          cursor: not-allowed;
          transform: none;
        }

        .metric-unit {
          font-size: 0.9rem;
          color: #888;
        }

        .readiness-badge {
          display: inline-block;
          padding: 0.5rem 1rem;
          border-radius: 20px;
          font-weight: 600;
          font-size: 0.9rem;
          margin-bottom: 1rem;
        }

        .readiness-badge.good {
          background: #d4edda;
          color: #155724;
        }

        .readiness-badge.warning {
          background: #fff3cd;
          color: #856404;
        }

        .readiness-badge.critical {
          background: #f8d7da;
          color: #721c24;
        }

        .chart-container {
          background: white;
          padding: 1.5rem;
          border-radius: 8px;
          margin-bottom: 1.5rem;
          border: 2px solid #e0e0e0;
        }

        .chart-insight {
          margin-top: 1rem;
          padding: 0.75rem;
          background: #f8f9fa;
          border-radius: 6px;
          font-size: 0.85rem;
          color: #666;
          line-height: 1.5;
        }

        .chart-insight strong {
          color: #333;
          font-weight: 600;
        }

        .chart-title {
          font-size: 0.85rem;
          font-weight: 700;
          margin-bottom: 1rem;
          color: #666;
          text-transform: uppercase;
          letter-spacing: 1px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .chart-annotation {
          font-size: 0.75rem;
          color: #e74c3c;
          font-weight: 600;
        }

        .chart-canvas {
          width: 100%;
          height: 200px;
        }

        .power-zones-chart {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .power-zone-bar {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .power-zone-label {
          font-size: 0.75rem;
          color: #666;
          min-width: 140px;
          font-weight: 600;
        }

        .power-zone-track {
          flex: 1;
          height: 32px;
          background: #f0f0f0;
          border-radius: 4px;
          position: relative;
          overflow: hidden;
        }

        .power-zone-fill {
          height: 100%;
          background: linear-gradient(90deg, #3498db, #2980b9);
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding-right: 0.5rem;
          transition: width 0.6s ease;
          position: absolute;
          left: 0;
        }

        .power-zone-value {
          font-size: 0.8rem;
          font-weight: 700;
          color: white;
          text-shadow: 0 1px 2px rgba(0,0,0,0.3);
        }

        .critical-feedback {
          background: #fff3cd;
          border: 2px solid #ffc107;
          border-radius: 8px;
          padding: 1rem;
          margin-top: 1.5rem;
        }

        .critical-feedback-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          cursor: pointer;
          user-select: none;
        }

        .critical-feedback-title {
          font-size: 0.9rem;
          font-weight: 700;
          color: #856404;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .critical-feedback-toggle {
          font-size: 0.9rem;
          color: #856404;
        }

        .critical-feedback-content {
          margin-top: 1rem;
          padding-top: 1rem;
          border-top: 1px solid #ffc107;
        }

        .critical-feedback-item {
          margin-bottom: 0.75rem;
          font-size: 0.85rem;
          line-height: 1.5;
          color: #856404;
        }

        .critical-feedback-item strong {
          font-weight: 700;
        }

        .critical-feedback.critical {
          background: #f8d7da;
          border-color: #dc3545;
        }

        .critical-feedback.critical .critical-feedback-title,
        .critical-feedback.critical .critical-feedback-toggle,
        .critical-feedback.critical .critical-feedback-item {
          color: #721c24;
        }

        .critical-feedback.critical .critical-feedback-content {
          border-top-color: #dc3545;
        }

        .empty-state {
          font-size: 3rem;
          margin-bottom: 1rem;
        }

        .power-zones {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0.5rem;
          margin-top: 1rem;
        }

        .power-zone {
          font-size: 0.85rem;
          padding: 0.5rem;
          background: white;
          border-radius: 4px;
        }

        .zone-label {
          font-weight: 600;
          margin-bottom: 0.25rem;
        }

        /* Settings button */
        .settings-btn {
          position: absolute;
          right: 2rem;
          top: 50%;
          transform: translateY(-50%);
          background: rgba(255,255,255,0.15);
          border: none;
          padding: 0.5rem 0.75rem;
          border-radius: 8px;
          font-size: 1.25rem;
          cursor: pointer;
          transition: all 0.2s;
        }
        .settings-btn:hover {
          background: rgba(255,255,255,0.25);
        }

        /* Modal styles */
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(4px);
        }
        
        .modal-content {
          background: white;
          border-radius: 16px;
          padding: 2rem;
          max-width: 500px;
          width: 90%;
          max-height: 90vh;
          overflow-y: auto;
          box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25);
        }
        
        .modal-content h2 {
          font-size: 1.5rem;
          margin-bottom: 0.5rem;
        }
        
        .modal-subtitle {
          color: #666;
          margin-bottom: 1.5rem;
          font-size: 0.9rem;
        }
        
        .settings-section {
          margin-bottom: 1.5rem;
          padding-bottom: 1.5rem;
          border-bottom: 1px solid #eee;
        }
        
        .settings-section:last-of-type {
          border-bottom: none;
        }
        
        .settings-section h3 {
          font-size: 0.85rem;
          color: #666;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 1rem;
        }
        
        .settings-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.75rem;
        }
        
        .settings-row label {
          font-size: 0.9rem;
        }
        
        .settings-input-group {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        
        .settings-input-group input {
          width: 80px;
          padding: 0.5rem;
          border: 1px solid #ddd;
          border-radius: 6px;
          text-align: right;
          font-size: 0.9rem;
        }
        
        .settings-input-group input:focus {
          outline: none;
          border-color: var(--primary);
          box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.1);
        }
        
        .settings-input-group span {
          color: #666;
          font-size: 0.85rem;
          width: 40px;
        }
        
        .workout-preview {
          display: flex;
          gap: 1rem;
          padding: 1rem;
          background: #f5f5f5;
          border-radius: 8px;
          margin-bottom: 1.5rem;
          font-size: 0.9rem;
        }
        
        .prescription-form .form-group {
          margin-bottom: 1rem;
        }
        
        .prescription-form label {
          display: block;
          font-size: 0.85rem;
          color: #666;
          margin-bottom: 0.5rem;
        }
        
        .prescription-form input {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid #ddd;
          border-radius: 8px;
          font-size: 0.9rem;
        }
        
        .prescription-form input:focus {
          outline: none;
          border-color: var(--primary);
          box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.1);
        }
        
        .queue-indicator {
          text-align: center;
          color: #666;
          font-size: 0.85rem;
          margin-bottom: 1rem;
          padding: 0.5rem;
          background: #f0f0f0;
          border-radius: 6px;
        }
        
        .modal-actions {
          display: flex;
          gap: 1rem;
          margin-top: 1.5rem;
        }
        
        .btn-primary {
          flex: 1;
          padding: 0.75rem 1.5rem;
          background: var(--primary);
          color: white;
          border: none;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .btn-primary:hover {
          background: var(--primary-dark);
          transform: translateY(-1px);
        }
        
        .btn-secondary {
          padding: 0.75rem 1.5rem;
          background: transparent;
          color: #666;
          border: 1px solid #ddd;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .btn-secondary:hover {
          background: #f5f5f5;
        }
      `}</style>

      <div className="main-container">
        <div className="header">
          <h1>🏊‍♂️ IronCoach</h1>
          <button 
            className="settings-btn"
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            ⚙️
          </button>
        </div>

        <div className="hero-section">
          <div className="hero-content">
            <div className="race-title">Ironman 70.3 Oman • February 14, 2026</div>
            
            <div className="countdown-container">
              <div className="countdown-unit">
                <div className="countdown-number">{countdown.days !== undefined ? countdown.days : '—'}</div>
                <div className="countdown-label-small">Days</div>
              </div>
              <div className="countdown-separator">:</div>
              <div className="countdown-unit">
                <div className="countdown-number">{countdown.hours !== undefined ? String(countdown.hours).padStart(2, '0') : '—'}</div>
                <div className="countdown-label-small">Hours</div>
              </div>
              <div className="countdown-separator">:</div>
              <div className="countdown-unit">
                <div className="countdown-number">{countdown.minutes !== undefined ? String(countdown.minutes).padStart(2, '0') : '—'}</div>
                <div className="countdown-label-small">Minutes</div>
              </div>
            </div>

            <div className="readiness-grid">
              <div className="readiness-card">
                <div className="readiness-icon">🏊‍♂️</div>
                <div className="readiness-sport">Swim</div>
                <div className="readiness-score">{readiness.swim !== null ? `${readiness.swim}/10` : '—'}</div>
                <div className="readiness-bar">
                  <div className="readiness-fill" style={{ width: `${(readiness.swim || 0) * 10}%` }}></div>
                </div>
                <div className="readiness-label">
                  {readiness.swim === null ? 'No Data' : readiness.swim < 5 ? 'Needs Work' : readiness.swim < 7 ? 'Progressing' : 'Race Ready'}
                </div>
              </div>

              <div className="readiness-card">
                <div className="readiness-icon">🚴‍♂️</div>
                <div className="readiness-sport">Bike</div>
                <div className="readiness-score">{readiness.bike !== null ? `${readiness.bike}/10` : '—'}</div>
                <div className="readiness-bar">
                  <div className="readiness-fill" style={{ width: `${(readiness.bike || 0) * 10}%` }}></div>
                </div>
                <div className="readiness-label">
                  {readiness.bike === null ? 'No Data' : readiness.bike < 5 ? 'Needs Work' : readiness.bike < 7 ? 'Progressing' : 'Race Ready'}
                </div>
              </div>

              <div className="readiness-card">
                <div className="readiness-icon">🏃‍♂️</div>
                <div className="readiness-sport">Run</div>
                <div className="readiness-score">{readiness.run !== null ? `${readiness.run}/10` : '—'}</div>
                <div className="readiness-bar">
                  <div className="readiness-fill" style={{ width: `${(readiness.run || 0) * 10}%` }}></div>
                </div>
                <div className="readiness-label">
                  {readiness.run === null ? 'No Data' : readiness.run < 5 ? 'Needs Work' : readiness.run < 7 ? 'Progressing' : 'Race Ready'}
                </div>
              </div>
            </div>
          </div>
        </div>

      <div className="container">
        <div className="sidebar">
          <div className="upload-section">
            <h2>Upload Workouts</h2>
            <div 
              className={`upload-dropzone ${dragOver ? 'drag-over' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => !uploading && document.getElementById('fitUpload').click()}
            >
              <div className="upload-dropzone-icon">
                {uploading ? '⏳' : dragOver ? '📥' : '📁'}
              </div>
              <div className="upload-dropzone-text">
                {uploading ? 'Processing...' : dragOver ? 'Drop files here' : 'Click or drag files'}
              </div>
              <div className="upload-dropzone-subtext">
                Supported: .fit files from Garmin, Zwift, etc.
              </div>
            </div>
            
            <input 
              type="file" 
              id="fitUpload" 
              multiple 
              accept=".fit"
              onChange={handleFileUpload}
              disabled={uploading}
              style={{ display: 'none' }}
            />
            
            {uploadProgress && (
              <div className="upload-progress">
                {uploadProgress}
                <div className="upload-progress-bar">
                  <div className="upload-progress-fill" style={{ width: '100%' }}></div>
                </div>
              </div>
            )}
          </div>

          <div className="workout-list">
            <h2>Recent Workouts ({workouts.length})</h2>
            {workouts.length === 0 ? (
              <div style={{ color: '#999', fontSize: '0.9rem', padding: '1rem 0' }}>
                No workouts uploaded yet. Upload FIT files to begin analysis.
              </div>
            ) : (
              workouts.map(workout => (
                <div 
                  key={workout.id}
                  className={`workout-item ${workout.sport} ${selectedWorkout?.id === workout.id ? 'active' : ''}`}
                  onClick={() => setSelectedWorkout(workout)}
                >
                  <div className={`workout-sport ${workout.sport}`}>{workout.sport}</div>
                  <div className="workout-date">
                    {new Date(workout.date).toLocaleDateString('en-US', { 
                      month: 'short', 
                      day: 'numeric', 
                      year: 'numeric' 
                    })}
                  </div>
                  <div className="workout-details">{workout.duration} · {workout.distance}</div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="calendar-section">
          <div className="view-toggle">
            <button 
              className={viewMode === 'timeline' ? 'active' : ''}
              onClick={() => setViewMode('timeline')}
            >
              Timeline
            </button>
            <button 
              className={viewMode === 'calendar' ? 'active' : ''}
              onClick={() => setViewMode('calendar')}
            >
              Calendar
            </button>
          </div>

          {viewMode === 'timeline' ? renderTimeline() : renderCalendar()}
        </div>

        <div className={`analysis-panel ${!selectedWorkout ? 'empty' : 'visible'}`}>
          {!selectedWorkout ? (
            <>
              <div className="empty-state">📊</div>
              <div>Select a workout to view detailed analysis</div>
            </>
          ) : (
            <>
              <div className="analysis-header">
                <div className="analysis-title">{selectedWorkout.sport?.toUpperCase()} Workout</div>
                <div className="analysis-meta">
                  {new Date(selectedWorkout.date).toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    month: 'long', 
                    day: 'numeric', 
                    year: 'numeric' 
                  })}
                </div>
                <div className="analysis-meta">{selectedWorkout.filename}</div>
              </div>

              {selectedWorkout.analysis && (
                <>
                  <div className={`readiness-badge ${selectedWorkout.analysis.readiness}`}>
                    {selectedWorkout.analysis.readiness === 'good' ? '✓ Good Performance' : 
                     selectedWorkout.analysis.readiness === 'warning' ? '⚠️ Needs Improvement' : 
                     '❌ Critical Issues'}
                  </div>

                  <div className="metric-grid">
                    <div className="metric-card">
                      <div className="metric-label">Duration</div>
                      <div className="metric-value">
                        {selectedWorkout.duration}
                      </div>
                    </div>
                    <div className="metric-card">
                      <div className="metric-label">Distance</div>
                      <div className="metric-value">
                        {selectedWorkout.distance}
                      </div>
                    </div>
                    {selectedWorkout.analysis.avgHR && (
                      <div className="metric-card">
                        <div className="metric-card-top">
                          <div className="metric-label">Avg Heart Rate</div>
                          {(() => {
                            const trend = calculateTrend(selectedWorkout, 'hr');
                            return trend && renderSparkline(trend.historical, !trend.improving);
                          })()}
                        </div>
                        <div className="metric-value">
                          {selectedWorkout.analysis.avgHR} <span className="metric-unit">bpm</span>
                        </div>
                        {(() => {
                          const trend = calculateTrend(selectedWorkout, 'hr');
                          if (!trend) return null;
                          return (
                            <div className={`metric-trend ${trend.improving ? 'down' : 'up'}`}>
                              {trend.improving ? '↓' : '↑'} {Math.abs(trend.change).toFixed(0)} bpm vs last 5 rides
                            </div>
                          );
                        })()}
                      </div>
                    )}
                    {selectedWorkout.analysis.avgPower && (
                      <div className="metric-card">
                        <div className="metric-card-top">
                          <div className="metric-label">Avg Power</div>
                          {(() => {
                            const trend = calculateTrend(selectedWorkout, 'power');
                            return trend && renderSparkline(trend.historical, trend.improving);
                          })()}
                        </div>
                        <div className="metric-value">
                          {selectedWorkout.analysis.avgPower} <span className="metric-unit">W</span>
                        </div>
                        {(() => {
                          const trend = calculateTrend(selectedWorkout, 'power');
                          if (!trend) return null;
                          return (
                            <div className={`metric-trend ${trend.improving ? 'up' : 'down'}`}>
                              {trend.improving ? '↑' : '↓'} {Math.abs(trend.change).toFixed(0)}W vs last 5 rides
                            </div>
                          );
                        })()}
                      </div>
                    )}
                    {selectedWorkout.analysis.avgPace && (
                      <div className="metric-card">
                        <div className="metric-card-top">
                          <div className="metric-label">Avg Pace</div>
                          {(() => {
                            const trend = calculateTrend(selectedWorkout, 'pace');
                            return trend && renderSparkline(trend.historical, trend.improving);
                          })()}
                        </div>
                        <div className="metric-value">
                          {selectedWorkout.analysis.avgPace} <span className="metric-unit">/km</span>
                        </div>
                        {(() => {
                          const trend = calculateTrend(selectedWorkout, 'pace');
                          if (!trend) return null;
                          const changeSeconds = Math.abs(trend.change);
                          const changeMins = Math.floor(changeSeconds / 60);
                          const changeSecs = Math.round(changeSeconds % 60);
                          return (
                            <div className={`metric-trend ${trend.improving ? 'up' : 'down'}`}>
                              {trend.improving ? '↑' : '↓'} {changeMins}:{changeSecs.toString().padStart(2, '0')}/km faster vs last 5 runs
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>

                  {/* Claude Coach Analysis */}
                  <div className="claude-analysis-section">
                    <div className="claude-analysis-header">
                      🧠 Coach Analysis
                      {isAnalyzing && <span className="claude-analyzing">(analyzing...)</span>}
                    </div>
                    {claudeAnalysis ? (
                      <div className="claude-analysis-content">{claudeAnalysis}</div>
                    ) : (
                      <div className="claude-analyzing">
                        {isAnalyzing ? 'Claude is analyzing your workout...' : 'Click "Get Analysis" to analyze this workout with Claude'}
                      </div>
                    )}
                    {!claudeAnalysis && !isAnalyzing && (
                      <button 
                        onClick={() => getClaudeAnalysis(selectedWorkout)}
                        className="upload-btn"
                        style={{ marginTop: '1rem' }}
                      >
                        Get Claude Analysis
                      </button>
                    )}
                  </div>

                  {/* Chat with Coach */}
                  {claudeAnalysis && (
                    <div className="chat-section">
                      <div className="chat-header">💬 Ask Your Coach</div>
                      {chatMessages.length > 1 && (
                        <div className="chat-messages">
                          {chatMessages.slice(1).map((msg, idx) => (
                            <div key={idx} className={`chat-message ${msg.role}`}>
                              {msg.content}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="chat-input-container">
                        <input
                          type="text"
                          className="chat-input"
                          placeholder="Ask about nutrition, pacing, drills, etc..."
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
                          disabled={isAnalyzing}
                        />
                        <button 
                          className="chat-send-btn"
                          onClick={sendChatMessage}
                          disabled={isAnalyzing || !chatInput.trim()}
                        >
                          {isAnalyzing ? '...' : 'Send'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Charts first */}
                  {selectedWorkout.analysis.avgHR && renderHRChart(selectedWorkout)}
                  {selectedWorkout.analysis.powerDistribution && renderPowerDistribution(selectedWorkout)}

                  {/* Critical feedback only (collapsible) */}
                  {renderCriticalFeedback(selectedWorkout)}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>

    {/* Settings Modal */}
    {showSettings && (
      <div className="modal-overlay" onClick={() => setShowSettings(false)}>
        <div className="modal-content settings-modal" onClick={e => e.stopPropagation()}>
          <h2>⚙️ Athlete Settings</h2>
          
          <div className="settings-section">
            <h3>Power & Fitness</h3>
            <div className="settings-row">
              <label>FTP (Functional Threshold Power)</label>
              <div className="settings-input-group">
                <input 
                  type="number" 
                  value={athleteConfig.ftp}
                  onChange={e => setAthleteConfig({...athleteConfig, ftp: parseInt(e.target.value) || 190})}
                />
                <span>W</span>
              </div>
            </div>
            <div className="settings-row">
              <label>Weight</label>
              <div className="settings-input-group">
                <input 
                  type="number" 
                  value={athleteConfig.weight}
                  onChange={e => setAthleteConfig({...athleteConfig, weight: parseInt(e.target.value) || 72})}
                />
                <span>kg</span>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h3>Race Targets (Oman 70.3)</h3>
            <div className="settings-row">
              <label>Bike Power Target</label>
              <div className="settings-input-group">
                <input 
                  type="number" 
                  value={athleteConfig.raceTargets.bikePower}
                  onChange={e => setAthleteConfig({
                    ...athleteConfig, 
                    raceTargets: {...athleteConfig.raceTargets, bikePower: parseInt(e.target.value) || 160}
                  })}
                />
                <span>W</span>
              </div>
            </div>
            <div className="settings-row">
              <label>Run Pace Target</label>
              <div className="settings-input-group">
                <input 
                  type="text" 
                  value={`${Math.floor(athleteConfig.raceTargets.runPace/60)}:${(athleteConfig.raceTargets.runPace%60).toString().padStart(2,'0')}`}
                  onChange={e => {
                    const parts = e.target.value.split(':');
                    const min = parseInt(parts[0]) || 0;
                    const sec = parseInt(parts[1]) || 0;
                    setAthleteConfig({
                      ...athleteConfig,
                      raceTargets: {...athleteConfig.raceTargets, runPace: min * 60 + sec}
                    });
                  }}
                />
                <span>/km</span>
              </div>
            </div>
            <div className="settings-row">
              <label>Swim CSS</label>
              <div className="settings-input-group">
                <input 
                  type="text" 
                  value={`${Math.floor(athleteConfig.swimCSS/60)}:${(athleteConfig.swimCSS%60).toString().padStart(2,'0')}`}
                  onChange={e => {
                    const parts = e.target.value.split(':');
                    const min = parseInt(parts[0]) || 0;
                    const sec = parseInt(parts[1]) || 0;
                    setAthleteConfig({...athleteConfig, swimCSS: min * 60 + sec});
                  }}
                />
                <span>/100m</span>
              </div>
            </div>
          </div>

          <div className="modal-actions">
            <button className="btn-primary" onClick={() => setShowSettings(false)}>
              Save Settings
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Prescription Context Modal */}
    {prescriptionModal.open && prescriptionModal.workout && (
      <div className="modal-overlay">
        <div className="modal-content prescription-modal">
          <h2>
            {prescriptionModal.workout.sport === 'swim' ? '🏊‍♂️' : 
             prescriptionModal.workout.sport === 'bike' ? '🚴‍♂️' : '🏃‍♂️'} 
            Workout Context
          </h2>
          <p className="modal-subtitle">
            Professional analysis requires context. What was prescribed for this {prescriptionModal.workout.sport} session?
          </p>
          
          <div className="workout-preview">
            <span>{prescriptionModal.workout.date}</span>
            <span>{prescriptionModal.workout.duration}</span>
            <span>{prescriptionModal.workout.distance}</span>
          </div>

          <div className="prescription-form">
            <div className="form-group">
              <label>Coach's Prescription</label>
              <input 
                type="text" 
                id="prescription-prescribed"
                placeholder="e.g., Easy Z2, 60 min / Intervals 5x3min @ threshold"
              />
            </div>
            <div className="form-group">
              <label>Your Execution Plan</label>
              <input 
                type="text" 
                id="prescription-plan"
                placeholder="e.g., Warmup 15min, then 140W steady"
              />
            </div>
            <div className="form-group">
              <label>How did it feel? (optional)</label>
              <input 
                type="text" 
                id="prescription-feel"
                placeholder="e.g., Legs felt heavy from yesterday"
              />
            </div>
          </div>

          {prescriptionModal.queue.length > 0 && (
            <div className="queue-indicator">
              +{prescriptionModal.queue.length} more workout{prescriptionModal.queue.length > 1 ? 's' : ''} to process
            </div>
          )}

          <div className="modal-actions">
            <button 
              className="btn-primary"
              onClick={() => {
                const prescribed = document.getElementById('prescription-prescribed').value;
                const plan = document.getElementById('prescription-plan').value;
                const feel = document.getElementById('prescription-feel').value;
                savePrescription({ prescribed, plan, feel });
              }}
            >
              Analyze Workout
            </button>
            <button className="btn-secondary" onClick={skipPrescription}>
              Skip
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
