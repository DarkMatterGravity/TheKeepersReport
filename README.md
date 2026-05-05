# EvenTide

Real-time tide information display for Sandy Hook, NJ.

## Features

- Live tide curve with predicted vs observed water levels
- High/low tide times and countdown to next low tide
- Wave height, period, and direction from NDBC buoy
- Air and water temperature
- Sunrise and sunset times
- Auto-refresh every 6 minutes
- Midnight auto-reload for new day's data

## Data Sources

- **Tides**: NOAA CO-OPS Station 8531680 (Sandy Hook, NJ)
- **Waves**: NDBC Buoy 44065 (NY Harbor Entrance)
- **Sun Times**: sunrise-sunset.org API

## Two Versions

### Desktop (Electron)

Windows executable with native window.

```bash
# Install dependencies
npm install

# Run in development
npm start

# Build Windows EXE
npm run build
```

The portable EXE will be at `dist/EvenTide.exe`

### Web (PWA)

Progressive Web App that works on any device including iPhone.

The `docs/` folder contains everything needed. Host it on any static server.

**GitHub Pages**: Enable Pages from the `docs` folder in repo settings.

**Live site**: https://darkmattergravity.github.io/EvenTide/

**Local testing**:
```bash
cd web
npx serve .
```

**Install on iPhone**:
1. Open the hosted URL in Safari
2. Tap Share button
3. Tap "Add to Home Screen"

## Project Structure

```
EvenTide/
├── package.json        # Electron dependencies
├── main.js             # Electron main process
├── preload.js          # Electron preload
├── src/                # Electron renderer files
│   ├── index.html
│   ├── styles.css
│   ├── api.js
│   └── renderer.js
├── docs/               # PWA version (for GitHub Pages)
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── manifest.json
│   ├── sw.js
│   └── icons/
└── dist/               # Built EXE (gitignored)
```

## License

MIT
