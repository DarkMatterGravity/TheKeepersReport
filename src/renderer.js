// EvenTide - Renderer Logic

// Wait for DOM and dependencies
document.addEventListener('DOMContentLoaded', init);

let tideChart = null;
let refreshInterval = null;
let countdownInterval = null;
let highLowData = [];
let predictionsData = [];
let observedData = [];
let currentDate = new Date().toDateString();
let maxWaveToday = null;

async function init() {
  updateCurrentTime();
  setInterval(updateCurrentTime, 1000);

  await loadTideData();

  // Refresh observed data every 6 minutes
  refreshInterval = setInterval(refreshObservedData, 6 * 60 * 1000);

  // Check for midnight reload every minute
  setInterval(checkMidnightReload, 60 * 1000);
}

function checkMidnightReload() {
  const now = new Date();
  const todayStr = now.toDateString();

  if (todayStr !== currentDate) {
    console.log('Date changed, reloading data...');
    currentDate = todayStr;
    maxWaveToday = null; // Reset max wave for new day
    window.TideAPI.clearCache();
    loadTideData();
  }
}

function updateCurrentTime() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
  document.getElementById('currentTime').textContent = timeStr;

  // Update "now" line on chart
  if (tideChart) {
    tideChart.options.plugins.annotation.annotations.nowLine.xMin = now;
    tideChart.options.plugins.annotation.annotations.nowLine.xMax = now;
    tideChart.update('none');
  }
}

async function loadTideData() {
  showLoading(true);
  hideError();

  try {
    // Fetch all data in parallel (wave data separate as it's from different source)
    const [predictions, highLow, observed] = await Promise.all([
      window.TideAPI.fetchPredictions(),
      window.TideAPI.fetchHighLow(),
      window.TideAPI.fetchObserved()
    ]);

    highLowData = highLow;
    predictionsData = predictions;
    observedData = observed;

    // Update UI
    updateHighLowDisplay(highLow);
    updateCountdown();
    updateCurrentLevels();
    createChart(predictions, observed);

    // Fetch additional data (don't block on these)
    fetchAndUpdateWaves();
    fetchAndUpdateTemps();
    fetchAndUpdateSunTimes();

    // Start countdown timer
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(updateCountdown, 1000);

    showLoading(false);
  } catch (error) {
    console.error('Failed to load tide data:', error);
    showError(error.message);
  }
}

async function fetchAndUpdateWaves() {
  try {
    const waveData = await window.TideAPI.fetchWaveData();
    updateWaveDisplay(waveData);
  } catch (error) {
    console.error('Failed to fetch wave data:', error);
    updateWaveDisplay({ height: null, period: null, direction: null });
  }
}

async function fetchAndUpdateTemps() {
  try {
    const temps = await window.TideAPI.fetchTemperatures();
    updateTempDisplay(temps);
  } catch (error) {
    console.error('Failed to fetch temperatures:', error);
    updateTempDisplay({ airTemp: null, waterTemp: null });
  }
}

async function fetchAndUpdateSunTimes() {
  try {
    const sunTimes = await window.TideAPI.fetchSunTimes();
    updateSunDisplay(sunTimes);
  } catch (error) {
    console.error('Failed to fetch sun times:', error);
    updateSunDisplay({ sunrise: null, sunset: null });
  }
}

function updateTempDisplay(temps) {
  const airEl = document.getElementById('airTemp');
  const waterEl = document.getElementById('waterTemp');

  if (temps.airTemp !== null && !isNaN(temps.airTemp)) {
    airEl.textContent = `${Math.round(temps.airTemp)}°F`;
  } else {
    airEl.textContent = '--°F';
  }

  if (temps.waterTemp !== null && !isNaN(temps.waterTemp)) {
    waterEl.textContent = `${Math.round(temps.waterTemp)}°F`;
  } else {
    waterEl.textContent = '--°F';
  }
}

function updateSunDisplay(sunTimes) {
  const sunriseEl = document.getElementById('sunrise');
  const sunsetEl = document.getElementById('sunset');

  sunriseEl.textContent = sunTimes.sunrise || '--:--';
  sunsetEl.textContent = sunTimes.sunset || '--:--';
}

function updateWaveDisplay(waveData) {
  const heightEl = document.getElementById('waveHeight');
  const periodEl = document.getElementById('wavePeriod');
  const dirEl = document.getElementById('waveDir');
  const maxWaveEl = document.getElementById('maxWave');

  if (waveData.height !== null) {
    heightEl.textContent = `${waveData.height.toFixed(1)} ft`;

    // Track max wave for today
    if (maxWaveToday === null || waveData.height > maxWaveToday) {
      maxWaveToday = waveData.height;
    }
  } else {
    heightEl.textContent = '-- ft';
  }

  if (waveData.period !== null) {
    periodEl.textContent = waveData.period.toFixed(0);
  } else {
    periodEl.textContent = '--';
  }

  if (waveData.directionText !== null) {
    dirEl.textContent = waveData.directionText;
  } else {
    dirEl.textContent = '--';
  }

  // Update max wave display
  if (maxWaveToday !== null) {
    maxWaveEl.textContent = `${maxWaveToday.toFixed(1)} ft`;
  } else {
    maxWaveEl.textContent = '-- ft';
  }
}

async function refreshObservedData() {
  try {
    window.TideAPI.clearCache();
    const observed = await window.TideAPI.fetchObserved();
    observedData = observed;

    if (tideChart && tideChart.data.datasets[1]) {
      tideChart.data.datasets[1].data = observed.map(d => ({
        x: d.time,
        y: d.value
      }));
      tideChart.update('none');
    }

    updateCurrentLevels();

    // Also refresh wave and temp data
    fetchAndUpdateWaves();
    fetchAndUpdateTemps();
  } catch (error) {
    console.error('Failed to refresh observed data:', error);
  }
}

function updateCurrentLevels() {
  const now = new Date();

  // Get current predicted level (interpolate between nearest points)
  let predictedLevel = '--';
  if (predictionsData.length > 0) {
    const nearest = findNearestDataPoint(predictionsData, now);
    if (nearest) {
      predictedLevel = nearest.value.toFixed(1);
    }
  }

  // Get latest observed level
  let observedLevel = '--';
  if (observedData.length > 0) {
    // Get the most recent observation
    const latest = observedData[observedData.length - 1];
    observedLevel = latest.value.toFixed(1);
  }

  document.getElementById('predictedLevel').textContent = predictedLevel;
  document.getElementById('observedLevel').textContent = `${observedLevel} ft`;
}

function findNearestDataPoint(data, targetTime) {
  if (!data || data.length === 0) return null;

  let nearest = data[0];
  let minDiff = Math.abs(targetTime - data[0].time);

  for (const point of data) {
    const diff = Math.abs(targetTime - point.time);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = point;
    }
  }

  return nearest;
}

function updateHighLowDisplay(highLow) {
  // Find next high and low tides
  const now = new Date();

  // Get all highs and lows for today
  const highs = highLow.filter(d => d.type === 'H');
  const lows = highLow.filter(d => d.type === 'L');

  // Find the next high tide (or most recent if all past)
  const nextHigh = highs.find(d => d.time > now) || highs[highs.length - 1];
  const nextLow = lows.find(d => d.time > now) || lows[lows.length - 1];

  if (nextHigh) {
    document.getElementById('highTideTime').textContent = formatTime(nextHigh.time);
    document.getElementById('highTideValue').textContent = `${nextHigh.value.toFixed(1)} ft`;
  }

  if (nextLow) {
    document.getElementById('lowTideTime').textContent = formatTime(nextLow.time);
    document.getElementById('lowTideValue').textContent = `${nextLow.value.toFixed(1)} ft`;
  }
}

function updateCountdown() {
  const nextLow = window.TideAPI.getNextLowTide(highLowData);

  if (nextLow) {
    document.getElementById('nextLowTime').textContent = formatTime(nextLow.time);

    const now = new Date();
    const diff = nextLow.time - now;

    if (diff > 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      if (hours > 0) {
        document.getElementById('countdown').textContent = `${hours}h ${minutes}m`;
      } else {
        document.getElementById('countdown').textContent = `${minutes}m ${seconds}s`;
      }
    } else {
      document.getElementById('countdown').textContent = 'Now!';
    }
  } else {
    document.getElementById('nextLowTime').textContent = 'Tomorrow';
    document.getElementById('countdown').textContent = '--';
  }
}

function formatTime(date) {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function createChart(predictions, observed) {
  const ctx = document.getElementById('tideChart').getContext('2d');

  // Destroy existing chart if any
  if (tideChart) {
    tideChart.destroy();
  }

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  tideChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Predicted',
          data: predictions.map(d => ({ x: d.time, y: d.value })),
          borderColor: '#4299e1',
          backgroundColor: 'rgba(66, 153, 225, 0.1)',
          borderWidth: 2.5,
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 4
        },
        {
          label: 'Observed',
          data: observed.map(d => ({ x: d.time, y: d.value })),
          borderColor: '#ed8936',
          backgroundColor: '#ed8936',
          borderWidth: 0,
          pointRadius: 2,
          pointHoverRadius: 5,
          showLine: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index'
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(26, 26, 46, 0.95)',
          titleColor: '#edf2f7',
          bodyColor: '#a0aec0',
          borderColor: '#2d3748',
          borderWidth: 1,
          padding: 12,
          displayColors: true,
          callbacks: {
            title: (items) => {
              if (items.length > 0) {
                return formatTime(new Date(items[0].parsed.x));
              }
              return '';
            },
            label: (item) => {
              return `${item.dataset.label}: ${item.parsed.y.toFixed(2)} ft`;
            }
          }
        },
        annotation: {
          annotations: {
            nowLine: {
              type: 'line',
              xMin: now,
              xMax: now,
              borderColor: '#fc8181',
              borderWidth: 2,
              borderDash: [5, 5],
              label: {
                display: true,
                content: 'Now',
                position: 'start',
                backgroundColor: 'rgba(252, 129, 129, 0.9)',
                color: '#fff',
                font: {
                  size: 10,
                  weight: 'bold'
                },
                padding: 4
              }
            }
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          min: startOfDay,
          max: endOfDay,
          time: {
            unit: 'hour',
            displayFormats: {
              hour: 'ha'
            }
          },
          grid: {
            color: 'rgba(45, 55, 72, 0.5)',
            drawBorder: false
          },
          ticks: {
            color: '#718096',
            font: {
              size: 11
            },
            maxRotation: 0
          }
        },
        y: {
          title: {
            display: true,
            text: 'Height (ft)',
            color: '#718096',
            font: {
              size: 11
            }
          },
          grid: {
            color: 'rgba(45, 55, 72, 0.5)',
            drawBorder: false
          },
          ticks: {
            color: '#718096',
            font: {
              size: 11
            },
            callback: (value) => `${value.toFixed(1)}`
          }
        }
      }
    }
  });
}

function showLoading(show) {
  document.getElementById('loading').style.display = show ? 'flex' : 'none';
}

function showError(message) {
  document.getElementById('error').style.display = 'flex';
  document.getElementById('errorMessage').textContent = message;
  showLoading(false);
}

function hideError() {
  document.getElementById('error').style.display = 'none';
}

// Expose refresh function for error button
window.TideApp = {
  refresh: loadTideData
};
