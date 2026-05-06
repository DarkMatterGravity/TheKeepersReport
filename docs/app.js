// EvenTide PWA - Combined API and Renderer

// ============================================
// API MODULE
// ============================================

const STATION_ID = '8531680';
const BUOY_ID = '44065';
const BASE_URL = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const NDBC_URL = 'https://www.ndbc.noaa.gov/data/realtime2';
const SANDY_HOOK_LAT = 40.4667;
const SANDY_HOOK_LNG = -74.01;

const cache = {
  predictions: { data: null, timestamp: 0 },
  highLow: { data: null, timestamp: 0 },
  observed: { data: null, timestamp: 0 },
  waves: { data: null, timestamp: 0 },
  temps: { data: null, timestamp: 0 },
  sunTimes: { data: null, timestamp: 0 }
};

const CACHE_DURATION = {
  predictions: 60 * 60 * 1000,
  highLow: 60 * 60 * 1000,
  observed: 5 * 60 * 1000,
  waves: 10 * 60 * 1000,
  temps: 10 * 60 * 1000,
  sunTimes: 24 * 60 * 60 * 1000
};

function buildUrl(params) {
  const url = new URL(BASE_URL);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });
  return url.toString();
}

function formatDateForAPI(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

async function fetchWithCache(cacheKey, fetchFn) {
  const now = Date.now();
  const cached = cache[cacheKey];
  if (cached.data && (now - cached.timestamp) < CACHE_DURATION[cacheKey]) {
    return cached.data;
  }
  const data = await fetchFn();
  cache[cacheKey] = { data, timestamp: now };
  return data;
}

async function fetchPredictions(date = new Date()) {
  return fetchWithCache('predictions', async () => {
    const dateStr = formatDateForAPI(date);
    const url = buildUrl({
      begin_date: dateStr, end_date: dateStr, station: STATION_ID,
      product: 'predictions', datum: 'MLLW', units: 'english',
      time_zone: 'lst_ldt', format: 'json', application: 'EvenTide'
    });
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch predictions');
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.predictions.map(p => ({ time: new Date(p.t), value: parseFloat(p.v) }));
  });
}

async function fetchHighLow(date = new Date()) {
  return fetchWithCache('highLow', async () => {
    const dateStr = formatDateForAPI(date);
    const url = buildUrl({
      begin_date: dateStr, end_date: dateStr, station: STATION_ID,
      product: 'predictions', datum: 'MLLW', units: 'english',
      time_zone: 'lst_ldt', interval: 'hilo', format: 'json', application: 'EvenTide'
    });
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch high/low');
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.predictions.map(p => ({ time: new Date(p.t), value: parseFloat(p.v), type: p.type }));
  });
}

async function fetchObserved(date = new Date()) {
  return fetchWithCache('observed', async () => {
    const dateStr = formatDateForAPI(date);
    const url = buildUrl({
      begin_date: dateStr, end_date: dateStr, station: STATION_ID,
      product: 'water_level', datum: 'MLLW', units: 'english',
      time_zone: 'lst_ldt', format: 'json', application: 'EvenTide'
    });
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch observed');
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return (data.data || []).filter(d => d.v !== null && d.v !== '')
      .map(d => ({ time: new Date(d.t), value: parseFloat(d.v) }));
  });
}

async function fetchWaveData() {
  return fetchWithCache('waves', async () => {
    // Use CORS proxy for browser requests (NDBC doesn't support CORS)
    const directUrl = `${NDBC_URL}/${BUOY_ID}.spec`;
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(directUrl)}`;

    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error('Failed to fetch waves');
    const text = await response.text();
    const lines = text.trim().split('\n').filter(line => !line.startsWith('#'));
    if (lines.length === 0) return { height: null, period: null, direction: null };
    const latest = lines[0].trim().split(/\s+/);
    const wvht = parseFloat(latest[5]);
    const heightFeet = isNaN(wvht) ? null : wvht * 3.28084;
    const period = parseFloat(latest[13]);
    const direction = parseFloat(latest[14]);
    return {
      height: isNaN(heightFeet) ? null : heightFeet,
      period: isNaN(period) ? null : period,
      direction: isNaN(direction) ? null : direction,
      directionText: isNaN(direction) ? null : degreesToCardinal(direction)
    };
  });
}

async function fetchTemperatures() {
  return fetchWithCache('temps', async () => {
    // Air temp from NOAA tide station
    const airResponse = await fetch(buildUrl({ date: 'latest', station: STATION_ID,
      product: 'air_temperature', units: 'english', time_zone: 'lst_ldt',
      format: 'json', application: 'EvenTide' }));

    // Ocean water temp from NDBC buoy (more accurate than harbor water)
    const buoyUrl = `${NDBC_URL}/${BUOY_ID}.txt`;
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(buoyUrl)}`;
    const waterResponse = await fetch(proxyUrl);

    let airTemp = null, waterTemp = null;

    if (airResponse.ok) {
      const d = await airResponse.json();
      if (d.data?.length > 0) airTemp = parseFloat(d.data[0].v);
    }

    if (waterResponse.ok) {
      const text = await waterResponse.text();
      const lines = text.trim().split('\n').filter(line => !line.startsWith('#'));
      if (lines.length > 0) {
        const latest = lines[0].trim().split(/\s+/);
        // WTMP is column 14, in Celsius - convert to Fahrenheit
        const wtmpC = parseFloat(latest[14]);
        if (!isNaN(wtmpC)) {
          waterTemp = (wtmpC * 9/5) + 32;
        }
      }
    }

    return { airTemp, waterTemp };
  });
}

async function fetchSunTimes() {
  return fetchWithCache('sunTimes', async () => {
    const url = `https://api.sunrise-sunset.org/json?lat=${SANDY_HOOK_LAT}&lng=${SANDY_HOOK_LNG}&formatted=0`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch sun times');
    const data = await response.json();
    if (data.status !== 'OK') throw new Error('Invalid sun times');
    const sunrise = new Date(data.results.sunrise);
    const sunset = new Date(data.results.sunset);
    return {
      sunrise: sunrise.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
      sunset: sunset.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    };
  });
}

function degreesToCardinal(degrees) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(degrees / 22.5) % 16];
}

function getNextLowTide(highLowData) {
  const now = new Date();
  const futureLows = highLowData.filter(d => d.type === 'L' && d.time > now).sort((a, b) => a.time - b.time);
  return futureLows.length > 0 ? futureLows[0] : null;
}

function clearCache() {
  cache.predictions = { data: null, timestamp: 0 };
  cache.highLow = { data: null, timestamp: 0 };
  cache.observed = { data: null, timestamp: 0 };
  cache.waves = { data: null, timestamp: 0 };
  cache.temps = { data: null, timestamp: 0 };
}

// ============================================
// RENDERER MODULE
// ============================================

let tideChart = null;
let refreshInterval = null;
let countdownInterval = null;
let highLowData = [];
let predictionsData = [];
let observedData = [];
let currentDate = new Date().toDateString();
let maxWaveToday = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  updateCurrentTime();
  setInterval(updateCurrentTime, 1000);
  await loadTideData();
  refreshInterval = setInterval(refreshObservedData, 6 * 60 * 1000);
  setInterval(checkMidnightReload, 60 * 1000);
}

function checkMidnightReload() {
  const todayStr = new Date().toDateString();
  if (todayStr !== currentDate) {
    currentDate = todayStr;
    maxWaveToday = null;
    clearCache();
    loadTideData();
  }
}

function updateCurrentTime() {
  const now = new Date();
  document.getElementById('currentTime').textContent = now.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true
  });
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
    const [predictions, highLow, observed] = await Promise.all([
      fetchPredictions(), fetchHighLow(), fetchObserved()
    ]);
    highLowData = highLow;
    predictionsData = predictions;
    observedData = observed;
    updateHighLowDisplay(highLow);
    updateCountdown();
    updateCurrentLevels();
    createChart(predictions, observed);
    fetchAndUpdateWaves();
    fetchAndUpdateTemps();
    fetchAndUpdateSunTimes();
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
    const waveData = await fetchWaveData();
    updateWaveDisplay(waveData);
  } catch (e) {
    updateWaveDisplay({ height: null, period: null, direction: null });
  }
}

async function fetchAndUpdateTemps() {
  try {
    const temps = await fetchTemperatures();
    updateTempDisplay(temps);
  } catch (e) {
    updateTempDisplay({ airTemp: null, waterTemp: null });
  }
}

async function fetchAndUpdateSunTimes() {
  try {
    const sunTimes = await fetchSunTimes();
    updateSunDisplay(sunTimes);
  } catch (e) {
    updateSunDisplay({ sunrise: null, sunset: null });
  }
}

function updateTempDisplay(temps) {
  document.getElementById('airTemp').textContent = temps.airTemp != null ? `${Math.round(temps.airTemp)}°F` : '--°F';
  document.getElementById('waterTemp').textContent = temps.waterTemp != null ? `${Math.round(temps.waterTemp)}°F` : '--°F';
}

function updateSunDisplay(sunTimes) {
  document.getElementById('sunrise').textContent = sunTimes.sunrise || '--:--';
  document.getElementById('sunset').textContent = sunTimes.sunset || '--:--';
}

function updateWaveDisplay(waveData) {
  const heightEl = document.getElementById('waveHeight');
  const periodEl = document.getElementById('wavePeriod');
  const dirEl = document.getElementById('waveDir');
  const maxWaveEl = document.getElementById('maxWave');

  if (waveData.height !== null) {
    heightEl.textContent = `${waveData.height.toFixed(1)} ft`;
    if (maxWaveToday === null || waveData.height > maxWaveToday) maxWaveToday = waveData.height;
  } else {
    heightEl.textContent = '-- ft';
  }
  periodEl.textContent = waveData.period !== null ? waveData.period.toFixed(0) : '--';
  dirEl.textContent = waveData.directionText || '--';
  maxWaveEl.textContent = maxWaveToday !== null ? `${maxWaveToday.toFixed(1)} ft` : '-- ft';
}

async function refreshObservedData() {
  try {
    clearCache();
    const observed = await fetchObserved();
    observedData = observed;
    if (tideChart?.data.datasets[1]) {
      tideChart.data.datasets[1].data = observed.map(d => ({ x: d.time, y: d.value }));
      tideChart.update('none');
    }
    updateCurrentLevels();
    fetchAndUpdateWaves();
    fetchAndUpdateTemps();
  } catch (e) {
    console.error('Failed to refresh:', e);
  }
}

function updateCurrentLevels() {
  const now = new Date();
  let predictedLevel = '--', observedLevel = '--';
  if (predictionsData.length > 0) {
    const nearest = findNearestDataPoint(predictionsData, now);
    if (nearest) predictedLevel = nearest.value.toFixed(1);
  }
  if (observedData.length > 0) {
    observedLevel = observedData[observedData.length - 1].value.toFixed(1);
  }
  document.getElementById('predictedLevel').textContent = predictedLevel;
  document.getElementById('observedLevel').textContent = `${observedLevel} ft`;
}

function findNearestDataPoint(data, targetTime) {
  if (!data?.length) return null;
  let nearest = data[0], minDiff = Math.abs(targetTime - data[0].time);
  for (const point of data) {
    const diff = Math.abs(targetTime - point.time);
    if (diff < minDiff) { minDiff = diff; nearest = point; }
  }
  return nearest;
}

function updateHighLowDisplay(highLow) {
  const now = new Date();
  const highs = highLow.filter(d => d.type === 'H');
  const lows = highLow.filter(d => d.type === 'L');
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
  const nextLow = getNextLowTide(highLowData);
  if (nextLow) {
    document.getElementById('nextLowTime').textContent = formatTime(nextLow.time);
    const diff = nextLow.time - new Date();
    if (diff > 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      document.getElementById('countdown').textContent = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m ${seconds}s`;
    } else {
      document.getElementById('countdown').textContent = 'Now!';
    }
  } else {
    document.getElementById('nextLowTime').textContent = 'Tomorrow';
    document.getElementById('countdown').textContent = '--';
  }
}

function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function createChart(predictions, observed) {
  const ctx = document.getElementById('tideChart').getContext('2d');
  if (tideChart) tideChart.destroy();

  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);

  tideChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Predicted',
          data: predictions.map(d => ({ x: d.time, y: d.value })),
          borderColor: '#4299e1', backgroundColor: 'rgba(66, 153, 225, 0.1)',
          borderWidth: 2.5, fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 4
        },
        {
          label: 'Observed',
          data: observed.map(d => ({ x: d.time, y: d.value })),
          borderColor: '#ed8936', backgroundColor: '#ed8936',
          borderWidth: 0, pointRadius: 2, pointHoverRadius: 5, showLine: false
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(26, 26, 46, 0.95)', titleColor: '#edf2f7', bodyColor: '#a0aec0',
          borderColor: '#2d3748', borderWidth: 1, padding: 12, displayColors: true,
          callbacks: {
            title: items => items.length > 0 ? formatTime(new Date(items[0].parsed.x)) : '',
            label: item => `${item.dataset.label}: ${item.parsed.y.toFixed(2)} ft`
          }
        },
        annotation: {
          annotations: {
            nowLine: {
              type: 'line', xMin: now, xMax: now,
              borderColor: '#fc8181', borderWidth: 2, borderDash: [5, 5],
              label: {
                display: true, content: 'Now', position: 'start',
                backgroundColor: 'rgba(252, 129, 129, 0.9)', color: '#fff',
                font: { size: 10, weight: 'bold' }, padding: 4
              }
            }
          }
        }
      },
      scales: {
        x: {
          type: 'time', min: startOfDay, max: endOfDay,
          time: { unit: 'hour', displayFormats: { hour: 'ha' } },
          grid: { color: 'rgba(45, 55, 72, 0.5)', drawBorder: false },
          ticks: { color: '#718096', font: { size: 11 }, maxRotation: 0 }
        },
        y: {
          title: { display: true, text: 'Height (ft)', color: '#718096', font: { size: 11 } },
          grid: { color: 'rgba(45, 55, 72, 0.5)', drawBorder: false },
          ticks: { color: '#718096', font: { size: 11 }, callback: v => v.toFixed(1) }
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

window.TideApp = { refresh: loadTideData };
