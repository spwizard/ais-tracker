# Deploying the AIS Tracker (all on Fly.io)

**One Fly app** serves both the API/WebSocket and the built frontend (same origin,
no CORS). A multi-stage Docker build compiles the Vite frontend and bundles it
into the FastAPI image, which serves it as static files.

The app must run as **one always-on instance** — it holds a single upstream AIS
connection and fans out from in-memory state. Don't autoscale or add uvicorn
workers until the Redis pub/sub fan-out is built.

Prereqs: a [Fly.io](https://fly.io) account and `flyctl` (`brew install flyctl`,
then `fly auth login`).

---

## 1. Name the app

Pick a unique name and set it in **two** places so the frontend talks to itself:
- `fly.toml` → `app = "your-name"`
- `frontend/.env.production` → `VITE_API_URL=https://your-name.fly.dev` and
  `VITE_WS_URL=wss://your-name.fly.dev/ws`

## 2. Create app, volume, secrets

From the **repo root** (the Dockerfile + fly.toml live here):

```bash
fly apps create your-name

# Persistent volume for data/ (registry + geofences + ownership.sqlite).
fly volumes create ais_data --region lhr --size 1

# Secrets — never committed. AISSTREAM_API_KEY is **required** for the UK/Channel
# feed; without it the AISStream source stays idle (amber in the UI).
fly secrets set \
  AISSTREAM_API_KEY=xxxxxxxx \
  ANTHROPIC_API_KEY=sk-ant-xxxx \
  TAVILY_API_KEY=tvly-xxxx
```

## 3. Deploy

```bash
fly deploy          # builds frontend + backend, bundles, ships
fly scale count 1   # pin to a single machine
```

Open it: `fly open` → the full UI loads from `https://your-name.fly.dev`, with the
API at `/api/*` and the live feed at `/ws` on the same origin.

## 4. One-time data bootstrap (on the volume)

The app runs without these (those features just stay empty). To enable
ownership + sanctions:

```bash
# Sanctions (public OFAC via OpenSanctions) — build straight onto the volume:
fly ssh console -C "python -m scripts.import_sanctions \
  https://data.opensanctions.org/datasets/latest/us_ofac_sdn/entities.ftm.json \
  /app/data/sanctions.json"

# Lloyd's ownership DB (licensed — keep private). Upload your local build:
fly sftp shell
> put data/ownership.sqlite /app/data/ownership.sqlite
> exit

fly apps restart your-name
```

`registry.sqlite` and `geofences.json` are created automatically on the volume
and persist across restarts.

---

## Notes & gotchas

- **AISStream not starting (amber “API key not set”).** The UK/Channel feed needs
  `AISSTREAM_API_KEY` as a Fly secret — it is not in `fly.toml`. After setting it,
  `fly apps restart your-name`. Check `fly logs` for `aisstream connected` or
  `AISSTREAM_API_KEY not set`.
- **Risk features empty.** Sanctions screening auto-downloads on first boot (OFAC via
  OpenSanctions). Lloyd's **ownership** still requires uploading
  `ownership.sqlite` to the volume (licensed data). The AI briefing needs
  `ANTHROPIC_API_KEY`. `GET /healthz` reports `data.sanctions_loaded`,
  `data.ownership_loaded`, and `data.briefing_ready`.
- **Port alignment.** Fly's proxy only reaches the app when `http_service.internal_port`,
  `[env] PORT`, and the uvicorn `--port` all match (default **8000**). A `[PC01]` /
  `[PR03]` error naming `0.0.0.0:8080` means the live Fly config still expects 8080
  (common after `fly launch`) while the container listens elsewhere — run
  `fly config show` and redeploy, or set `internal_port`, `PORT`, and the Dockerfile
  to the same value.
- **Single instance.** `min_machines_running = 1`, `auto_stop_machines = false`
  (the AIS feed must stay alive). `fly scale count 1`.
- **Memory.** 1 GB is comfortable for ~5k vessels; bump in `fly.toml` if it OOMs.
- **Lloyd's licensing.** `ownership.sqlite` is gitignored and lives only on the
  private volume — never commit it or expose it on a public deploy.
- **LLM cost.** Briefings are the only paid action (Anthropic). Web search is off
  by default (`BRIEFING_WEB_SEARCH=false`); it's opt-in per briefing.
- **Region.** `lhr` (London) is closest to the default UK/Channel bbox; change
  `primary_region` + the volume region together if you move it.
- **Local dev is unchanged**: `uvicorn app.main:app` (backend) + `npm run dev`
  (frontend) on separate ports. The bundled-static path only activates in the
  image (when `/app/static` exists).
- **Optional Redis** (`docker-compose.yml`) isn't needed for this single-instance
  deploy.
