# 🛰️ Live Satellite Tracker — START HERE

**Shows every tracked satellite in real-time on a 3D globe.**
Drag to rotate. Scroll to zoom. Click any dot to see details.
Filter by type: Space Stations, Starlink, GPS, Weather, Military, Science, Amateur, Debris.

---

## REQUIREMENTS

- Home WiFi or personal hotspot (NOT the SME corporate network)
- Python (already installed on your machine)
- A modern browser (Chrome, Edge, Firefox)

---

## HOW TO RUN IT

### Step 1 — Open a terminal in this folder

1. Open VS Code
2. File → Open Folder → select the `satellite_tracker` folder
3. Press **Ctrl + `** to open the terminal

### Step 2 — Start the server

In the terminal, type this and press Enter:

```
python server.py
```

You should see:
```
==================================================
  Satellite Tracker Server
  Running at: http://localhost:8765
  Open that URL in your browser
  Press Ctrl+C to stop
==================================================
```

### Step 3 — Open your browser

Open **Chrome** or **Edge** and go to:

```
http://localhost:8765
```

The globe will load and start pulling live satellite data from Celestrak.
It takes about 10–20 seconds to load all satellite groups.

### Step 4 — Use it

| Action | How |
|--------|-----|
| Rotate globe | Click and drag |
| Zoom in/out | Scroll wheel |
| Select a satellite | Click any dot |
| Search | Type in the search box (top left) |
| Filter by type | Click the colored buttons |
| Close satellite info | Click ✕ |

---

## WHAT YOU'LL SEE

| Color | Type |
|-------|------|
| 🟢 Teal | Space Stations (ISS, Tiangong, etc.) |
| 🔵 Blue | Starlink constellation |
| 🟡 Yellow | GPS satellites |
| 🟠 Orange | Weather satellites |
| 🔴 Red | Military satellites |
| 🟣 Purple | Science satellites |
| 🟢 Green | Amateur radio satellites |
| ⚫ Gray | Space debris |

---

## TROUBLESHOOTING

**"python is not recognized"**
→ Try `python3 server.py` instead
→ Or use the full path: `C:\Users\ADinet\.local\bin\python3.14.exe server.py`

**Globe loads but no satellites appear**
→ Check the terminal — it will show which URLs it tried
→ Make sure you're on home WiFi, not the corporate network
→ Wait 20–30 seconds — some groups take longer to load

**Browser shows "This site can't be reached"**
→ Make sure `server.py` is still running in the terminal
→ Make sure you typed `http://localhost:8765` (not https)

**Satellites are in wrong positions**
→ Make sure your computer clock is correct (the positions are calculated from current time)

---

## TO STOP THE SERVER

Press **Ctrl+C** in the terminal.

---

## FILES IN THIS FOLDER

| File | What it does |
|------|-------------|
| `server.py` | Python server — fetches TLE data from Celestrak, serves the app |
| `index.html` | The web app (3D globe, UI) |
| `app.js` | All the JavaScript (Three.js globe, satellite plotting, search/filter) |
| `find_url.py` | Diagnostic script — run this if satellites don't load to find working URLs |
