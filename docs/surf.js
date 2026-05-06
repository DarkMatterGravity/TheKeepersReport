// Surf Forecast JavaScript

const SANDY_HOOK_LAT = 40.4667;
const SANDY_HOOK_LNG = -74.01;

// Sandy Hook optimal conditions
const OPTIMAL = {
  swellDirs: [90, 112.5, 135], // E, ESE, SE
  windDirs: [270, 315], // W, NW (offshore)
  minHeight: 3,
  maxHeight: 6,
  minPeriod: 8
};

let forecastChart = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadForecast();
}

async function loadForecast() {
  try {
    // Fetch from Open-Meteo Marine API (free, no key needed)
    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${SANDY_HOOK_LAT}&longitude=${SANDY_HOOK_LNG}&hourly=wave_height,wave_direction,wave_period,wind_wave_height,swell_wave_height,swell_wave_direction,swell_wave_period&timezone=America%2FNew_York&forecast_days=3`;

    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch forecast');

    const data = await response.json();

    // Also get wind data from Open-Meteo Weather API
    const windUrl = `https://api.open-meteo.com/v1/forecast?latitude=${SANDY_HOOK_LAT}&longitude=${SANDY_HOOK_LNG}&hourly=wind_speed_10m,wind_direction_10m&timezone=America%2FNew_York&forecast_days=3&wind_speed_unit=mph`;

    const windResponse = await fetch(windUrl);
    const windData = await windResponse.json();

    // Process and display
    const forecast = processForecast(data, windData);
    displayCurrentConditions(forecast[0]);
    displayHourlyForecast(forecast);
    createChart(forecast);

  } catch (error) {
    console.error('Failed to load forecast:', error);
    document.getElementById('hourlyList').innerHTML = '<div class="loading">Failed to load forecast. Please try again.</div>';
  }
}

function processForecast(marineData, windData) {
  const forecast = [];
  const hours = marineData.hourly.time;

  for (let i = 0; i < Math.min(hours.length, 48); i++) {
    const time = new Date(hours[i]);

    // Use swell height if available, otherwise total wave height
    const swellHeight = marineData.hourly.swell_wave_height?.[i];
    const totalHeight = marineData.hourly.wave_height?.[i];
    const waveHeightM = swellHeight || totalHeight || 0;
    const waveHeightFt = waveHeightM * 3.28084;

    const swellDir = marineData.hourly.swell_wave_direction?.[i] || marineData.hourly.wave_direction?.[i] || 0;
    const swellPeriod = marineData.hourly.swell_wave_period?.[i] || marineData.hourly.wave_period?.[i] || 0;

    const windSpeed = windData.hourly?.wind_speed_10m?.[i] || 0;
    const windDir = windData.hourly?.wind_direction_10m?.[i] || 0;

    const rating = calculateRating(waveHeightFt, swellPeriod, swellDir, windSpeed, windDir);

    forecast.push({
      time,
      waveHeight: waveHeightFt,
      period: swellPeriod,
      swellDir,
      swellDirText: degreesToCardinal(swellDir),
      windSpeed,
      windDir,
      windDirText: degreesToCardinal(windDir),
      rating,
      score: rating.score
    });
  }

  return forecast;
}

function calculateRating(height, period, swellDir, windSpeed, windDir) {
  let score = 50; // Start at fair

  // Wave height scoring (0-30 points)
  if (height < 1) {
    score -= 40; // Flat
  } else if (height >= OPTIMAL.minHeight && height <= OPTIMAL.maxHeight) {
    score += 25; // Ideal height
  } else if (height > OPTIMAL.maxHeight && height <= 8) {
    score += 15; // Good but big
  } else if (height > 8) {
    score += 5; // Too big for most
  } else if (height >= 2) {
    score += 10; // Rideable
  }

  // Period scoring (0-25 points)
  if (period >= 12) {
    score += 25; // Long period ground swell
  } else if (period >= OPTIMAL.minPeriod) {
    score += 20; // Good period
  } else if (period >= 6) {
    score += 10; // Short period
  } else {
    score -= 10; // Wind chop
  }

  // Swell direction scoring (0-20 points)
  const swellDirDiff = Math.min(
    ...OPTIMAL.swellDirs.map(d => Math.abs(angleDiff(swellDir, d)))
  );
  if (swellDirDiff <= 15) {
    score += 20; // Perfect direction
  } else if (swellDirDiff <= 30) {
    score += 15; // Good direction
  } else if (swellDirDiff <= 45) {
    score += 10; // OK direction
  } else if (swellDirDiff <= 60) {
    score += 5; // Marginal
  }

  // Wind scoring (0-25 points)
  const windDirDiff = Math.min(
    ...OPTIMAL.windDirs.map(d => Math.abs(angleDiff(windDir, d)))
  );

  if (windSpeed < 5) {
    score += 20; // Glass
  } else if (windSpeed < 10 && windDirDiff <= 45) {
    score += 25; // Light offshore
  } else if (windSpeed < 15 && windDirDiff <= 45) {
    score += 15; // Offshore but breezy
  } else if (windSpeed < 10) {
    score += 10; // Light onshore
  } else if (windSpeed >= 20) {
    score -= 15; // Too windy
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  // Determine rating label
  let label, className;
  if (height < 1) {
    label = 'FLAT';
    className = 'flat';
  } else if (score >= 85) {
    label = 'EPIC';
    className = 'epic';
  } else if (score >= 70) {
    label = 'GOOD';
    className = 'good';
  } else if (score >= 50) {
    label = 'FAIR';
    className = 'fair';
  } else {
    label = 'POOR';
    className = 'poor';
  }

  return { score, label, className };
}

function angleDiff(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function degreesToCardinal(degrees) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(degrees / 22.5) % 16];
}

function displayCurrentConditions(current) {
  document.getElementById('currentWaveHeight').textContent = current.waveHeight.toFixed(1);
  document.getElementById('currentPeriod').textContent = current.period.toFixed(0);
  document.getElementById('currentSwellDir').textContent = current.swellDirText;
  document.getElementById('currentWind').textContent = Math.round(current.windSpeed);

  const ratingEl = document.getElementById('currentRating');
  ratingEl.textContent = current.rating.label;
  ratingEl.className = `rating rating-${current.rating.className}`;
}

function displayHourlyForecast(forecast) {
  const container = document.getElementById('hourlyList');

  const html = forecast.map(hour => {
    const timeStr = hour.time.toLocaleTimeString('en-US', {
      hour: 'numeric',
      hour12: true
    });
    const dayStr = hour.time.toLocaleDateString('en-US', { weekday: 'short' });
    const isNewDay = hour.time.getHours() === 0;

    return `
      <div class="hourly-item">
        <div class="hourly-time">${isNewDay ? dayStr : ''} ${timeStr}</div>
        <div class="hourly-bar-container">
          <div class="hourly-bar ${hour.rating.className}" style="width: ${hour.score}%"></div>
        </div>
        <div class="hourly-height">${hour.waveHeight.toFixed(1)} ft</div>
        <div class="hourly-period">${hour.period.toFixed(0)}s ${hour.swellDirText}</div>
        <div class="hourly-wind">${Math.round(hour.windSpeed)} ${hour.windDirText}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

function createChart(forecast) {
  const ctx = document.getElementById('forecastChart').getContext('2d');

  if (forecastChart) forecastChart.destroy();

  // Create gradient based on ratings
  const gradient = ctx.createLinearGradient(0, 0, 0, 200);
  gradient.addColorStop(0, 'rgba(66, 153, 225, 0.3)');
  gradient.addColorStop(1, 'rgba(66, 153, 225, 0.05)');

  forecastChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Wave Height',
          data: forecast.map(f => ({ x: f.time, y: f.waveHeight })),
          borderColor: '#4299e1',
          backgroundColor: gradient,
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 4
        },
        {
          label: 'Period',
          data: forecast.map(f => ({ x: f.time, y: f.period })),
          borderColor: '#48bb78',
          borderWidth: 1.5,
          borderDash: [5, 5],
          fill: false,
          tension: 0.4,
          pointRadius: 0,
          yAxisID: 'y2'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#718096',
            font: { size: 10 },
            boxWidth: 20,
            padding: 10
          }
        },
        tooltip: {
          backgroundColor: 'rgba(26, 26, 46, 0.95)',
          titleColor: '#edf2f7',
          bodyColor: '#a0aec0',
          callbacks: {
            title: items => {
              const d = new Date(items[0].parsed.x);
              return d.toLocaleString('en-US', {
                weekday: 'short', hour: 'numeric', hour12: true
              });
            },
            label: item => {
              if (item.datasetIndex === 0) {
                return `Waves: ${item.parsed.y.toFixed(1)} ft`;
              }
              return `Period: ${item.parsed.y.toFixed(0)}s`;
            }
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'hour', displayFormats: { hour: 'ha' }, stepSize: 6 },
          grid: { color: 'rgba(45, 55, 72, 0.5)' },
          ticks: { color: '#718096', font: { size: 10 }, maxRotation: 0 }
        },
        y: {
          title: { display: true, text: 'Height (ft)', color: '#718096', font: { size: 10 } },
          grid: { color: 'rgba(45, 55, 72, 0.5)' },
          ticks: { color: '#718096', font: { size: 10 } },
          min: 0
        },
        y2: {
          position: 'right',
          title: { display: true, text: 'Period (s)', color: '#718096', font: { size: 10 } },
          grid: { display: false },
          ticks: { color: '#718096', font: { size: 10 } },
          min: 0
        }
      }
    }
  });
}
