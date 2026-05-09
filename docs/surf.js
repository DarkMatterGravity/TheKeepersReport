// Surf Forecast JavaScript

const LOCATIONS = {
  'sandy-hook': {
    name: 'Sandy Hook, NJ',
    lat: 40.4667,
    lng: -74.01,
    timezone: 'America/New_York',
    optimal: {
      swellDirs: [90, 112.5, 135], // E, ESE, SE
      windDirs: [270, 315], // W, NW (offshore)
    }
  },
  'uluwatu': {
    name: 'Uluwatu, Bali',
    lat: -8.83,
    lng: 115.08,
    timezone: 'Asia/Makassar',
    optimal: {
      swellDirs: [180, 202.5, 225], // S, SSW, SW
      windDirs: [0, 45], // N, NE (offshore)
    }
  }
};

let currentLocation = 'sandy-hook';

// Toggle hourly section expand/collapse
function toggleHourlyExpand(event) {
  // Don't toggle if clicking on the close button (it handles itself)
  if (event && event.target.closest('.close-btn')) return;

  const section = document.getElementById('hourlySection');

  // If already expanded and clicking inside list, don't collapse
  if (section.classList.contains('expanded') && event && event.target.closest('.hourly-list')) {
    return;
  }

  section.classList.toggle('expanded');
}

// Close button handler
function closeHourlyExpand(event) {
  event.stopPropagation();
  const section = document.getElementById('hourlySection');
  section.classList.remove('expanded');
}

// Get optimal conditions for current location
function getOptimal() {
  const loc = LOCATIONS[currentLocation];
  return {
    swellDirs: loc.optimal.swellDirs,
    windDirs: loc.optimal.windDirs,
    minHeight: 3,
    maxHeight: 6,
    minPeriod: 8
  };
}

let forecastChart = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Set up location dropdown
  const dropdown = document.getElementById('locationSelect');
  if (dropdown) {
    dropdown.addEventListener('change', (e) => {
      switchLocation(e.target.value);
    });
  }

  updateLocationName();
  await Promise.all([
    loadForecast(),
    loadSunTimes()
  ]);
}

function updateLocationName() {
  const loc = LOCATIONS[currentLocation];
  const nameEl = document.getElementById('locationName');
  if (nameEl) nameEl.textContent = loc.name;
}

async function switchLocation(locationId) {
  if (!LOCATIONS[locationId]) return;
  currentLocation = locationId;

  // Show loading state
  document.getElementById('currentWaveHeight').textContent = '--';
  document.getElementById('currentPeriod').textContent = '--';
  document.getElementById('currentSwellDir').textContent = '--';
  document.getElementById('currentWind').textContent = '--';

  await Promise.all([
    loadForecast(),
    loadSunTimes()
  ]);
}

async function loadSunTimes() {
  const loc = LOCATIONS[currentLocation];
  try {
    const url = `https://api.sunrise-sunset.org/json?lat=${loc.lat}&lng=${loc.lng}&formatted=0`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK') {
      const sunrise = new Date(data.results.sunrise);
      const sunset = new Date(data.results.sunset);

      document.getElementById('sunriseTime').textContent = sunrise.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      document.getElementById('sunsetTime').textContent = sunset.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    }
  } catch (error) {
    console.error('Failed to load sun times:', error);
  }
}

async function loadForecast() {
  const loc = LOCATIONS[currentLocation];
  const tz = encodeURIComponent(loc.timezone);
  try {
    // Fetch from Open-Meteo Marine API (free, no key needed)
    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${loc.lat}&longitude=${loc.lng}&hourly=wave_height,wave_direction,wave_period,wind_wave_height,swell_wave_height,swell_wave_direction,swell_wave_period&timezone=${tz}&forecast_days=3`;

    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch forecast');

    const data = await response.json();

    // Also get wind data from Open-Meteo Weather API
    const windUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lng}&hourly=wind_speed_10m,wind_direction_10m&timezone=${tz}&forecast_days=3&wind_speed_unit=mph`;

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
  const now = new Date();

  // Find the index of the current hour (or nearest future hour)
  let startIndex = 0;
  for (let i = 0; i < hours.length; i++) {
    const hourTime = new Date(hours[i]);
    if (hourTime >= now) {
      startIndex = i;
      break;
    }
  }

  for (let i = startIndex; i < Math.min(hours.length, startIndex + 48); i++) {
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
  const OPTIMAL = getOptimal();
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

  const windDirEl = document.getElementById('currentWindDir');
  if (windDirEl) {
    windDirEl.textContent = current.windDirText;
  }

  const ratingEl = document.getElementById('currentRating');
  ratingEl.textContent = current.rating.label;
  ratingEl.className = `rating rating-${current.rating.className}`;

  // Scale wave image based on wave height (6ft surfer = reference)
  updateWaveScale(current.waveHeight);
}

function updateWaveScale(waveHeightFt) {
  const waveLine = document.getElementById('waveLine');
  const surferImg = document.getElementById('surferImg');
  if (!waveLine || !surferImg) return;

  // Surfer is 6ft reference
  const SURFER_HEIGHT_FT = 6;
  const SURFER_BASE_PX = 150; // matches CSS base height

  // Wave line position: height in pixels from bottom
  // 6ft wave = top of surfer's head, 1ft wave = near feet
  let waveLinePx = (waveHeightFt / SURFER_HEIGHT_FT) * SURFER_BASE_PX;

  // Clamp between 5px (tiny ripple) and surfer height
  waveLinePx = Math.max(5, Math.min(SURFER_BASE_PX, waveLinePx));

  let surferHeightPx = SURFER_BASE_PX;

  // For giant waves (>6ft), line goes to top, surfer can shrink
  if (waveHeightFt > SURFER_HEIGHT_FT) {
    // Line stays at surfer height, show it's overhead
    waveLinePx = SURFER_BASE_PX;
  }

  // Apply position - bottom offset positions the dotted line
  waveLine.style.bottom = `${waveLinePx}px`;
  surferImg.style.height = `${surferHeightPx}px`;
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
        annotation: {
          annotations: {
            nowLine: {
              type: 'line',
              xMin: new Date(),
              xMax: new Date(),
              borderColor: '#fc8181',
              borderWidth: 2,
              label: {
                display: true,
                content: 'Now',
                position: 'start',
                backgroundColor: '#fc8181',
                color: '#fff',
                font: { size: 10, weight: 'bold' },
                padding: 3
              }
            }
          }
        },
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
