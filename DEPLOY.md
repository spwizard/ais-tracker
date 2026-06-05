# Deploying the AIS Tracker

**Backend → Fly.io** (single always-on container, WebSocket + persistent volume).
**Frontend → Vercel** (static Vite build).

The backend must run as **one instance** — it holds a single upstream AIS
connection and fans out from in-memory state. Don't autoscale or add uvicorn
workers until the Redis pub/sub fan-out is built.

---

## 1. Backend on Fly.io

Prereqs: a [Fly.io](https://fly.io) account and `flyctl` installed (`brew install flyctl`, then `fly auth login`).

From `backend/`:

```bash
cd backend

# Create the app (uses fly.toml; don't deploy yet). Pick a unique name and set
# it in fly.toml's `app = ...`.
fly apps create ais-tracker

# Persistent volume for data/ (registry + geofences + ownership.sqlite).
fly volumes create ais_data --region lhr --size 1

# Secrets — never commit these.
fly secrets set \
  AISSTREAM_API_KEY=xxxxxxxx \
  ANTHROPIC_API_KEY=sk-ant-xxxx \
  TAVILY_API_KEY=tvly-xxxx \
  CORS_ORIGINS=https://your-frontend.vercel.app

# Build + deploy (the .dockerignore keeps the 71MB ownership.sqlite out of the
# build context).
fly deploy

# Pin to a single machine.
fly scale count 1
```

### One-time data bootstrap (on the volume)

The app runs without these (those features just stay empty), but to enable
ownership + sanctions:

```bash
# Sanctions (public OFAC via OpenSanctions) — build straight onto the volume:
fly ssh console -C "python -m scripts.import_sanctions \
  https://data.opensanctions.org/datasets/latest/us_ofac_sdn/entities.ftm.json \
  /app/data/sanctions.json"

# Lloyd's ownership DB (licensed — keep it private). Upload your local build:
fly sftp shell
> put data/ownership.sqlite /app/data/ownership.sqlite
> exit

fly apps restart ais-tracker
```

`registry.sqlite` and `geofences.json` are created automatically on the volume
and persist across restarts.

Verify: `curl https://ais-tracker.fly.dev/healthz`

---

## 2. Frontend on Vercel

- Import the repo in Vercel; set **Root Directory = `frontend`**.
- Framework preset: **Vite** (build `npm run build`, output `dist`).
- Environment variables (or edit `frontend/.env.production`):
  - `VITE_API_URL = https://ais-tracker.fly.dev`
  - `VITE_WS_URL  = wss://ais-tracker.fly.dev/ws`
- Deploy. Then set the backend's `CORS_ORIGINS` secret to the Vercel URL (above)
  and `fly apps restart`.

---

## Notes & gotchas

- **Single instance.** `min_machines_running = 1`, `auto_stop_machines = false`
  (the AIS feed must stay alive). `fly scale count 1`.
- **Memory.** 1 GB is comfortable for ~5k vessels; bump in `fly.toml` if it OOMs.
- **Lloyd's licensing.** `ownership.sqlite` is gitignored and lives only on the
  private volume — never commit it or expose it on a public deploy.
- **LLM cost.** Briefings are the only paid action (Anthropic). Web search is
  off by default (`BRIEFING_WEB_SEARCH=false`); it's opt-in per briefing.
- **Region.** `lhr` (London) is closest to the default UK/Channel bbox; change
  `primary_region` + the volume region together if you move it.
