# 🛰️ Maritime · Live Vessel Tracker

A polished, real-time AIS vessel tracker. The backend holds a **single** persistent
WebSocket to [AISStream.io](https://aisstream.io) and fans live updates out to every
connected browser; the frontend is a **full-screen** deck.gl + MapLibre map with
floating, glassmorphism control panels in a dark maritime theme.

![stack](https://img.shields.io/badge/FastAPI-Python-009688) ![stack](https://img.shields.io/badge/React_18-TypeScript-3178c6) ![stack](https://img.shields.io/badge/deck.gl-MapLibre-22d3ee)

---

## ✨ Features

- **One upstream connection, many clients.** The backend owns the only AISStream
  socket and re-broadcasts batched updates (~1/sec) — clients never hit AISStream
  directly, so you stay well within rate limits no matter how many tabs are open.
- **Full-screen GPU map.** deck.gl `IconLayer` renders thousands of vessels (rotated
  by heading, colored by ship type); an animated `TripsLayer` draws glowing trails.
- **Floating control panels** built with shadcn/ui — top status bar, filters, live
  stats, layer controls, and a vessel detail card with a mini track sparkline.
- **Swappable state store.** In-memory by default (zero infra); set `REDIS_URL` to
  use Redis for persistence, geo queries, and a future multi-instance fan-out path.
- **Warm starts.** New clients get a full REST/WS snapshot instantly, then live deltas.
- **Self-healing.** Upstream connection auto-reconnects with exponential backoff;
  the browser socket reconnects too. Stale vessels are evicted on a TTL.

---

## 🗂️ Project structure

```
ais-tracker/
├─ docker-compose.yml         # optional Redis (+ optional backend container)
├─ backend/                   # FastAPI
│  ├─ app/
│  │  ├─ main.py              # app, lifespan, REST + WS routes
│  │  ├─ config.py            # env settings (default UK/Channel bbox)
│  │  ├─ models.py            # Vessel + partial-update merge
│  │  ├─ ship_types.py        # AIS ship-type groups + colors
│  │  ├─ ais/                 # single AISStream client + message parser
│  │  ├─ store/               # VesselStore: memory (default) | redis
│  │  └─ ws/broadcaster.py    # batched fan-out to browser clients
│  ├─ requirements.txt
│  └─ .env.example
└─ frontend/                  # Vite + React + TS + deck.gl + MapLibre + shadcn
   ├─ src/
   │  ├─ hooks/useVesselsSocket.ts  # WS + snapshot, ref-based store
   │  ├─ map/                       # MapView, deck layers, icon atlas
   │  ├─ panels/                    # TopBar, Filter, Stats, LayerControls, Detail
   │  ├─ components/ui/             # shadcn primitives
   │  └─ lib/                       # ship types, filters, utils
   └─ .env.example
```

---

## 🚀 Quick start

### 1. Get an AISStream API key

1. Sign up at **https://aisstream.io**.
2. Create an API key from your dashboard (it's free).
3. Copy the key — you'll paste it into `backend/.env` below.

### 2. Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# edit .env and set AISSTREAM_API_KEY=<your key>

uvicorn app.main:app --reload --port 8000
```

Check it's alive:

```bash
curl localhost:8000/healthz       # {"status":"ok","ais_connected":true,...}
curl localhost:8000/api/snapshot  # {"vessels":[ ... ]}
```

> The server boots even **without** a key (empty map). Add the key to see live data.

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env              # defaults point at localhost:8000
npm run dev                       # http://localhost:5173
```

Open **http://localhost:5173** — you should see the dark map fill with vessels around
the UK and English Channel, the status pill turn green, and the vessel count climb.

---

## ⚙️ Configuration

### Backend (`backend/.env`)

| Variable | Default | Notes |
|---|---|---|
| `AISSTREAM_API_KEY` | _(empty)_ | **Required** for live data. |
| `AIS_BBOX` | `[[48.5,-8.0],[52.0,2.5]]` | Subscription box, `[[lat,lon],[lat,lon]]` = SW, NE. Multiple boxes: `[[[..],[..]],[[..],[..]]]`. |
| `REDIS_URL` | _(empty)_ | Empty → in-memory store. e.g. `redis://localhost:6379/0` to use Redis. |
| `VESSEL_TTL_SEC` | `600` | Drop a vessel after this many seconds of silence. |
| `TRAIL_LEN` | `30` | Positions kept per vessel (server side). |
| `BROADCAST_HZ` | `1` | Batched fan-out frequency to clients. |
| `CORS_ORIGINS` | `*` | Comma-separated list or `*`. |

### Frontend (`frontend/.env`)

| Variable | Default | Notes |
|---|---|---|
| `VITE_WS_URL` | `ws://localhost:8000/ws` | Backend WebSocket. |
| `VITE_API_URL` | `http://localhost:8000` | Backend REST base. |
| `VITE_MAP_STYLE` | CARTO dark-matter | Any MapLibre style URL (MapTiler etc.). |

### Changing the region

Pick a bounding box and set `AIS_BBOX`. Examples:

```bash
# Mediterranean
AIS_BBOX=[[30.0,-6.0],[46.0,37.0]]
# US East + West coasts (two boxes)
AIS_BBOX=[[[24.0,-82.0],[45.0,-66.0]],[[32.0,-125.0],[49.0,-117.0]]]
# Whole world (heavy!)
AIS_BBOX=[[-90.0,-180.0],[90.0,180.0]]
```

The map's initial view is set in `frontend/src/map/MapView.tsx` (`INITIAL_VIEW`) and
the region quick-jump buttons live in `frontend/src/panels/LayerControls.tsx`.

---

## 🧱 Using Redis (optional)

Redis isn't required, but it adds persistence (state survives a backend restart),
native geo queries, and the foundation for running multiple backend instances later.

```bash
docker compose up -d redis           # start Redis on :6379
# in backend/.env:
REDIS_URL=redis://localhost:6379/0
# restart the backend — it now persists vessel state in Redis
```

Or run **both** Redis and the backend in containers:

```bash
docker compose --profile full up --build
```

---

## 🏛️ Architecture

```
AISStream.io ──(1 persistent WS, auto-reconnect)──▶ FastAPI backend
                                                     ├─ ais/parser   normalize messages
                                                     ├─ VesselStore  memory | Redis
                                                     │   • current state per MMSI
                                                     │   • short trail history
                                                     │   • TTL / stale eviction
                                                     └─ Broadcaster  ~1Hz batched deltas
Browser ──▶ useVesselsSocket ──▶ deck.gl (IconLayer + TripsLayer) over MapLibre
                              └─▶ floating shadcn panels
REST: GET /api/snapshot · GET /api/meta · GET /api/vessel/{mmsi}/trail · GET /healthz
WS:   /ws  (snapshot on connect, then batched updates)
```

### Why it stays fast with thousands of vessels

- The backend **batches** broadcasts at `BROADCAST_HZ` and only sends vessels whose
  timestamp changed — not every upstream message.
- The frontend keeps vessels in a **ref-backed `Map`**, not React state. A render is
  scheduled at most once per animation frame, and deck.gl layer `updateTriggers` are
  keyed on a version counter so GPU attributes re-upload only when data actually changes.
- Vessel icons are a single tinted texture (one draw call via `IconLayer`).

---

## 🌍 Deployment notes

- **Backend is intentionally single-instance** today: exactly one process should hold
  the AISStream socket. Run it as one container/dyno behind your API. Scaling the
  *read* side (more browser clients) is already handled by the broadcaster.
- **To scale horizontally later**, switch the store to Redis and add a Redis pub/sub
  channel so the instance holding the AISStream socket publishes normalized updates and
  every backend instance's broadcaster subscribes. The `VesselStore` seam is where this
  goes — no frontend changes required. (A second data source or history layer would
  reuse the same seam; those are deliberately left as extension points.)
- **Frontend** is static — `npm run build` produces `dist/`; deploy to any static host
  (Vercel/Netlify/S3+CloudFront). Set the `VITE_*` vars to your public backend URLs and
  serve the backend over `wss://` in production.
- Put the backend behind TLS and restrict `CORS_ORIGINS` to your frontend origin.

---

## 📡 API reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/healthz` | Liveness + `ais_connected`, vessel/client counts. |
| `GET` | `/api/meta` | Subscription bbox, ship-type legend, trail length. |
| `GET` | `/api/snapshot` | All current vessels (REST warm-start). |
| `GET` | `/api/vessel/{mmsi}/trail` | Recent track for one vessel. |
| `WS`  | `/ws` | `{type:"snapshot",...}` on connect, then `{type:"update",...}`. |

---

## 📝 Notes & credits

- AIS data © vessels broadcasting via [AISStream.io](https://aisstream.io). Respect
  their terms of service.
- Basemap © [CARTO](https://carto.com/) / © OpenStreetMap contributors.
- Built with FastAPI, React, deck.gl, MapLibre GL, shadcn/ui, and Tailwind CSS.
