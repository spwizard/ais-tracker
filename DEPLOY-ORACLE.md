# Deploying on Oracle Cloud — Always Free (24/7, $0)

Oracle Cloud's **Always Free** tier includes an **Ampere A1 (ARM)** VM — up to
4 cores / 24 GB RAM, free forever. That's far more than this app needs, so it can
run **always-on** (feed always connected, registry always growing) at **no cost** —
unlike Fly's scale-to-zero. The trade-off is more setup and the ARM capacity quirk
below.

The app still runs as **one instance** (single upstream AIS feed + in-memory
fan-out). Don't run two.

Architecture: one VM running the app in Docker (the repo's multi-stage image
builds the frontend + backend), with **Caddy** in front for automatic HTTPS.

```
Internet ──443──▶ Caddy (auto Let's Encrypt) ──▶ localhost:8000 (app container)
                                                       └─ /app/data volume (registry, geofences, ownership.sqlite)
```

---

## 1. Create the VM

In the [Oracle Cloud console](https://cloud.oracle.com): **Compute → Instances → Create**.

- **Image:** Canonical **Ubuntu 24.04** (or 22.04).
- **Shape:** change to **Ampere → VM.Standard.A1.Flex**, set **2 OCPU / 8 GB**
  (well within Always Free). Confirm the shape shows **"Always Free-eligible."**
- **SSH:** upload your public key (`~/.ssh/id_ed25519.pub`).
- Create. Note the **public IP**.

> ⚠️ **ARM capacity.** Popular regions often return *"Out of capacity"* for A1.
> If so: try a different **Availability Domain**, retry over a few hours, or pick
> a less busy region (your tenancy's **home region** usually works best). A small
> script that retries the create call is a known workaround.

---

## 2. Open the firewall (two layers — both required)

Oracle blocks ports at **two** levels; you must open both or 80/443 stay closed.

**a) Cloud security list** — VCN → your subnet → Security List → add **Ingress**
rules (Source `0.0.0.0/0`): TCP **80** and TCP **443**. (22 is already open.)

**b) The instance's own iptables** — Oracle's Ubuntu image ships with a
restrictive firewall. SSH in and open 80/443:

```bash
ssh ubuntu@YOUR_IP

sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save          # persist across reboots
```

---

## 3. Install Docker + Caddy

```bash
# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && newgrp docker

# Caddy (arm64 package, auto-HTTPS reverse proxy)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

---

## 4. Get the app + data + secrets onto the box

```bash
sudo mkdir -p /opt/ais/data && sudo chown -R ubuntu:ubuntu /opt/ais
cd /opt/ais

# Code (private repo → use a GitHub PAT or deploy key):
git clone https://github.com/spwizard/ais-tracker.git
# (or: scp -r from your laptop, excluding node_modules/.venv/data)
```

**Secrets** — create `/opt/ais/ais-tracker/backend/.env` (never committed):

```bash
cat > /opt/ais/ais-tracker/backend/.env <<'EOF'
AISSTREAM_API_KEY=xxxxxxxx
ANTHROPIC_API_KEY=sk-ant-xxxx
TAVILY_API_KEY=tvly-xxxx
BRIEFING_WEB_SEARCH=false
EOF
```

**Data** — copy your licensed Lloyd's DB up from your laptop (sanctions.json
auto-downloads on first boot; registry + geofences self-create):

```bash
# from your laptop:
scp backend/data/ownership.sqlite ubuntu@YOUR_IP:/opt/ais/data/ownership.sqlite
```

The container's data paths default to `/app/data/*`, which is the mounted volume —
no path env vars needed.

---

## 5. Build + run (always-on)

The multi-stage image builds cleanly on ARM (all Python deps have aarch64 wheels):

```bash
cd /opt/ais/ais-tracker
docker build -t ais-tracker .

docker run -d --name ais --restart unless-stopped \
  -p 127.0.0.1:8000:8000 \
  --env-file backend/.env \
  -v /opt/ais/data:/app/data \
  ais-tracker
```

- `-p 127.0.0.1:8000:8000` keeps the app private; **Caddy** is the public face.
- `--restart unless-stopped` survives reboots/crashes.
- Check it: `docker logs -f ais` → look for `aisstream connected`, then
  `curl localhost:8000/healthz`.

---

## 6. HTTPS with Caddy

HTTPS matters here: when the page is served over `https`, the frontend opens the
WebSocket over `wss://` (same origin) — so TLS makes the live feed work.

Point a domain's **A record** at `YOUR_IP`. No domain? A free
[DuckDNS](https://www.duckdns.org) subdomain works (`yourname.duckdns.org`).

```bash
sudo tee /etc/caddy/Caddyfile <<'EOF'
yourname.duckdns.org {
    reverse_proxy localhost:8000
}
EOF
sudo systemctl restart caddy
```

Caddy auto-provisions a Let's Encrypt cert and **passes WebSocket upgrades
through** to `/ws`. Visit `https://yourname.duckdns.org` — the full app loads,
API + live feed on the same origin.

---

## 7. Updating / ops

```bash
cd /opt/ais/ais-tracker && git pull
docker build -t ais-tracker . && docker rm -f ais
docker run -d --name ais --restart unless-stopped \
  -p 127.0.0.1:8000:8000 --env-file backend/.env -v /opt/ais/data:/app/data ais-tracker

docker logs -f ais          # logs
docker stats ais            # memory/CPU (expect a few hundred MB)
```

---

## Notes

- **Single instance.** One container, one upstream AIS feed. Don't run two.
- **Memory.** With 8 GB there's no OOM concern (vs the 512 MB Fly squeeze) — the
  in-memory registry mirror + ~5k vessels sit comfortably.
- **Lloyd's licensing.** `ownership.sqlite` lives only on the box's volume — never
  in git or a public image. (You chose a private deploy for this reason.)
- **Egress.** Always Free includes 10 TB/mo outbound — irrelevant for this.
- **Cost.** $0 on Always Free. Set the tenancy to **"Always Free resources only"**
  (or just don't create paid resources) so it can never bill you.
- **LLM cost is separate** — Anthropic + Tavily only spend when you click Generate;
  unrelated to hosting.
