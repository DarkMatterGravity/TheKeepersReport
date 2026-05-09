# The Keepers Report - Project Memory

## Current State
- Surf forecast app for Sandy Hook, NJ
- Uses Open-Meteo Marine + Weather APIs, Sunrise-Sunset.org
- Uncommitted work: sunrise/sunset display (mobile only), flat rating color tweak, updated Surfer.png

## Planned Feature: Multi-Location Support

### Overview
Users can search any coastal location worldwide, automatically detect beach orientation, get accurate surf ratings, and save up to 5 favorite spots.

### Components to Build

1. **Location Search**
   - Nominatim (OpenStreetMap geocoding) for text → lat/lng
   - Display results for user to select
   - Validate selection is near coastline

2. **Beach Orientation Detection**
   - Query Overpass API for coastline geometry within 500m-1km
   - Find closest coastline segment
   - Calculate perpendicular angle (OSM convention: water on right side)
   - Fallback: manual compass selector if no coastline data

3. **Dynamic Optimal Conditions**
   - Calculate from beach orientation:
     - `swellDirs`: facing direction ± 22.5°
     - `windDirs`: opposite direction ± 45° (offshore)
   - Keep `minHeight`, `maxHeight`, `minPeriod` as defaults

4. **Favorites System (localStorage, max 5)**
   ```javascript
   {
     id: "uuid",
     name: "Pipeline, Oahu",
     lat: 21.665,
     lng: -158.053,
     orientation: 315,  // cached
     timezone: "Pacific/Honolulu"
   }
   ```

5. **UI Changes**
   - Header: tappable location name + search icon
   - Location sheet/modal with search + favorites list
   - Add/remove favorites (star icons)
   - Manual orientation fallback (compass picker)

### User Flow

**First Launch:**
1. App shows location search modal
2. User searches, selects location
3. "Detecting beach orientation..." loading
4. Forecast loads → "Save as favorite?" prompt
5. Saved location becomes default

**Returning User:**
1. App loads first favorite immediately
2. Tap header → location sheet slides up
3. Switch between favorites or search new

**Location Sheet UI:**
```
┌─────────────────────────────────┐
│  🔍 Search locations...         │
├─────────────────────────────────┤
│  ★ Pipeline, Oahu        ← current
│  ★ Huntington Beach, CA         │
│  ★ Sandy Hook, NJ               │
│  ☆ Snapper Rocks, AUS           │
│  [+ Add current location]       │
└─────────────────────────────────┘
```

### API Licensing Notes

**Current APIs:**
| API | Free Tier | Commercial Use |
|-----|-----------|----------------|
| Open-Meteo | 10k req/day, non-commercial | Paid (~€15-50/mo) |
| Sunrise-Sunset.org | No limit stated | No SLA |
| Nominatim | 1 req/sec max | Not for commercial - need alternative |
| Overpass | Shared resource | OK with attribution |

**For 200k users on free app:** Would exceed Open-Meteo free tier, need paid or self-host

**Cost-optimized approach (<$50/month for paid app):**
1. Open-Meteo commercial (~€15-30/mo) with aggressive caching
2. Replace sunrise-sunset.org with `suncalc` JS library (free, client-side math)
3. LocationIQ for geocoding (5k/day free) + cache results forever
4. Overpass for coastline + cache forever per location
5. Cache forecasts per location for 1-2 hours (reduces API calls by 90-95%)

**With caching:** 200k users hitting 50 popular spots = ~600 actual API calls/day

### Implementation Order
1. Coastline orientation detection (core new logic)
2. Location search with Nominatim
3. Favorites in localStorage
4. UI components (sheet, search, favorites list)
5. Caching layer

### Edge Cases to Handle
- No coastline found → manual compass picker
- Inland location → "Not near coast" error
- API errors → graceful fallback with retry
- 5 favorites limit → must remove one to add new
