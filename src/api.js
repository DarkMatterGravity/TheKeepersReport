// NOAA CO-OPS API Module for Sandy Hook, NJ (Station 8531680)
// NDBC Buoy 44065 for wave data (NY Harbor Entrance)

const STATION_ID = '8531680';
const BUOY_ID = '44065';
const BASE_URL = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const NDBC_URL = 'https://www.ndbc.noaa.gov/data/realtime2';

// Sandy Hook coordinates for sunrise/sunset
const SANDY_HOOK_LAT = 40.4667;
const SANDY_HOOK_LNG = -74.01;

// Cache to avoid excessive API calls
const cache = {
  predictions: { data: null, timestamp: 0 },
  highLow: { data: null, timestamp: 0 },
  observed: { data: null, timestamp: 0 },
  waves: { data: null, timestamp: 0 },
  temps: { data: null, timestamp: 0 },
  sunTimes: { data: null, timestamp: 0 }
};

const CACHE_DURATION = {
  predictions: 60 * 60 * 1000,  // 1 hour for predictions (they don't change)
  highLow: 60 * 60 * 1000,      // 1 hour for high/low
  observed: 5 * 60 * 1000,      // 5 minutes for observed data
  waves: 10 * 60 * 1000,        // 10 minutes for wave data (updates every 30 min)
  temps: 10 * 60 * 1000,        // 10 minutes for temperature data
  sunTimes: 24 * 60 * 60 * 1000 // 24 hours for sunrise/sunset (once per day)
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

// Fetch 6-minute predictions for smooth tide curve
async function fetchPredictions(date = new Date()) {
  return fetchWithCache('predictions', async () => {
    const dateStr = formatDateForAPI(date);
    const url = buildUrl({
      begin_date: dateStr,
      end_date: dateStr,
      station: STATION_ID,
      product: 'predictions',
      datum: 'MLLW',
      units: 'english',
      time_zone: 'lst_ldt',
      format: 'json',
      application: 'EvenTide'
    });

    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch predictions');

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    return data.predictions.map(p => ({
      time: new Date(p.t),
      value: parseFloat(p.v)
    }));
  });
}

// Fetch high/low tide times
async function fetchHighLow(date = new Date()) {
  return fetchWithCache('highLow', async () => {
    const dateStr = formatDateForAPI(date);
    const url = buildUrl({
      begin_date: dateStr,
      end_date: dateStr,
      station: STATION_ID,
      product: 'predictions',
      datum: 'MLLW',
      units: 'english',
      time_zone: 'lst_ldt',
      interval: 'hilo',
      format: 'json',
      application: 'EvenTide'
    });

    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch high/low data');

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    return data.predictions.map(p => ({
      time: new Date(p.t),
      value: parseFloat(p.v),
      type: p.type // 'H' for high, 'L' for low
    }));
  });
}

// Fetch real-time observed water levels
async function fetchObserved(date = new Date()) {
  return fetchWithCache('observed', async () => {
    const dateStr = formatDateForAPI(date);
    const url = buildUrl({
      begin_date: dateStr,
      end_date: dateStr,
      station: STATION_ID,
      product: 'water_level',
      datum: 'MLLW',
      units: 'english',
      time_zone: 'lst_ldt',
      format: 'json',
      application: 'EvenTide'
    });

    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch observed data');

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    // Filter out any null or invalid values
    return (data.data || [])
      .filter(d => d.v !== null && d.v !== '')
      .map(d => ({
        time: new Date(d.t),
        value: parseFloat(d.v)
      }));
  });
}

// Get the next low tide from now
function getNextLowTide(highLowData) {
  const now = new Date();
  const futureLows = highLowData
    .filter(d => d.type === 'L' && d.time > now)
    .sort((a, b) => a.time - b.time);

  return futureLows.length > 0 ? futureLows[0] : null;
}

// Get the next high tide from now
function getNextHighTide(highLowData) {
  const now = new Date();
  const futureHighs = highLowData
    .filter(d => d.type === 'H' && d.time > now)
    .sort((a, b) => a.time - b.time);

  return futureHighs.length > 0 ? futureHighs[0] : null;
}

// Fetch wave data from NDBC buoy
async function fetchWaveData() {
  return fetchWithCache('waves', async () => {
    const url = `${NDBC_URL}/${BUOY_ID}.spec`;

    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch wave data');

    const text = await response.text();
    const lines = text.trim().split('\n');

    // Skip header lines (start with #)
    const dataLines = lines.filter(line => !line.startsWith('#'));

    if (dataLines.length === 0) {
      return { height: null, period: null, direction: null };
    }

    // Parse the most recent data line (first data line)
    const latest = dataLines[0].trim().split(/\s+/);

    // Columns: YY MM DD hh mm WVHT SwH SwP WWH WWP SwD WWD STEEPNESS APD MWD
    // Index:   0  1  2  3  4  5    6   7   8   9   10  11  12        13  14
    const wvht = latest[5];  // Wave height in meters
    const apd = latest[13];  // Average period in seconds
    const mwd = latest[14];  // Mean wave direction in degrees

    // Convert meters to feet (1m = 3.28084ft)
    const heightMeters = parseFloat(wvht);
    const heightFeet = isNaN(heightMeters) ? null : heightMeters * 3.28084;

    const period = parseFloat(apd);
    const direction = parseFloat(mwd);

    return {
      height: isNaN(heightFeet) ? null : heightFeet,
      period: isNaN(period) ? null : period,
      direction: isNaN(direction) ? null : direction,
      directionText: isNaN(direction) ? null : degreesToCardinal(direction)
    };
  });
}

// Convert degrees to cardinal direction
function degreesToCardinal(degrees) {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                      'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
}

// Fetch air and water temperature from NOAA
async function fetchTemperatures() {
  return fetchWithCache('temps', async () => {
    // Fetch both temperatures in parallel
    const [airResponse, waterResponse] = await Promise.all([
      fetch(buildUrl({
        date: 'latest',
        station: STATION_ID,
        product: 'air_temperature',
        units: 'english',
        time_zone: 'lst_ldt',
        format: 'json',
        application: 'EvenTide'
      })),
      fetch(buildUrl({
        date: 'latest',
        station: STATION_ID,
        product: 'water_temperature',
        units: 'english',
        time_zone: 'lst_ldt',
        format: 'json',
        application: 'EvenTide'
      }))
    ]);

    let airTemp = null;
    let waterTemp = null;

    if (airResponse.ok) {
      const airData = await airResponse.json();
      if (airData.data && airData.data.length > 0) {
        airTemp = parseFloat(airData.data[0].v);
      }
    }

    if (waterResponse.ok) {
      const waterData = await waterResponse.json();
      if (waterData.data && waterData.data.length > 0) {
        waterTemp = parseFloat(waterData.data[0].v);
      }
    }

    return { airTemp, waterTemp };
  });
}

// Fetch sunrise and sunset times
async function fetchSunTimes() {
  return fetchWithCache('sunTimes', async () => {
    const url = `https://api.sunrise-sunset.org/json?lat=${SANDY_HOOK_LAT}&lng=${SANDY_HOOK_LNG}&formatted=0`;

    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch sun times');

    const data = await response.json();
    if (data.status !== 'OK') throw new Error('Invalid sun times response');

    // Parse UTC times and convert to local
    const sunrise = new Date(data.results.sunrise);
    const sunset = new Date(data.results.sunset);

    return {
      sunrise: sunrise.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
      sunset: sunset.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    };
  });
}

// Clear cache (useful for manual refresh)
function clearCache() {
  cache.predictions = { data: null, timestamp: 0 };
  cache.highLow = { data: null, timestamp: 0 };
  cache.observed = { data: null, timestamp: 0 };
  cache.waves = { data: null, timestamp: 0 };
  cache.temps = { data: null, timestamp: 0 };
  // Don't clear sunTimes - they're good for 24 hours
}

// Export for use in renderer
window.TideAPI = {
  fetchPredictions,
  fetchHighLow,
  fetchObserved,
  fetchWaveData,
  fetchTemperatures,
  fetchSunTimes,
  getNextLowTide,
  getNextHighTide,
  clearCache,
  STATION_ID,
  BUOY_ID
};
