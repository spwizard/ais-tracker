# Deploying on Oracle Cloud — Always Free (24/7, $0)

Oracle Cloud's **Always Free** tier runs this app **always-on for $0** — the feed
stays connected, the registry keeps growing, background detection keeps running.

This guide reflects the **native** deployment that's actually running (uvicorn +
systemd), not Docker. The free VMs are small (the AMD micro is **1 GB RAM**), and
a Docker image build — which runs `npm`/Vite in-box — OOMs on that. So we build
the frontend **on your laptop** and run the backend natively on the box; `pip
install` is light and fast. (On a big ARM A1 instance, the Docker path in the root
`Dockerfile` works too — but native is simplest and proven.)

The app runs as **one instance** (single upstream AIS feed + in-memory fan-out).
Don't run two.

```
Internet ──80/443──▶ uvicorn (:80, serves API + WS + bundled frontend)
                          └─ backend/data/  (registry, geofences, sanctions, ownership.sqlite)
```

---

## 1. Create the VM

[OCI console](https://cloud.oracle.com) → **Compute → Instances → Create**:

- **Image:** Canonical **Ubuntu 22.04**.
- **Shape:** the Always-Free **`VM.Standard.E2.1.Micro`** (AMD, 1 GB) works.
  Prefer **Ampere A1 (ARM)** for more headroom if you can get capacity.
- **SSH:** upload your public key (`~/.ssh/id_ed25519.pub`).
- **Networking:** *Create new VCN* + *Create new public subnet*, and tick
  **"Assign a public IPv4 address."**

> ⚠️ **ARM "out of capacity":** A1 is often unavailable — retry, switch
> availability domain, or just use the AMD micro (this guide's path).

---

## 2. Make it reachable (the parts that trip everyone up)

A public IP needs **three** things, and there are **two firewalls**.

**a) Public IP** — if the instance shows no public IP: instance → **Networking** →
primary VNIC → **IPv4 Addresses** → edit the private-IP row → assign an
**ephemeral public IPv4 address**.

**b) Internet gateway + route** — on the instance's networking quick-actions, run
**"Connect public subnet to internet"** (creates the gateway + a `0.0.0.0/0`
route). Verify under VCN → Routing → Default Route Table that
`0.0.0.0/0 → Internet Gateway` exists.

**c) OCI Security List ingress** — VCN → **Security** (or Subnets → your subnet) →
**Default Security List → Add Ingress Rules**: Source `0.0.0.0/0`, TCP, ports
**22**, **80**, **443**. (22 is usually pre-added; 80/443 are not.)

**d) In-VM iptables** — Oracle's Ubuntu image has a `REJECT` rule that blocks
everything after SSH. The catch: **your ACCEPT rules must go ABOVE that REJECT.**
`sudo iptables -I INPUT 6 …` lands *below* it and silently does nothing. After SSH
(step 3), see the iptables block in step 5.

---

## 3. From your laptop: build + ship

In the repo root, build the frontend and push code + build + secrets + data to the
box (replace the IP with yours):

```bash
IP=140.238.76.193

# 1. build the frontend locally (fast on your machine)
( cd frontend && npm run build )

# 2. prep the box
ssh ubuntu@$IP 'sudo apt-get update -qq && sudo apt-get install -y -qq python3-venv python3-pip rsync && sudo mkdir -p /opt/ais/ais-tracker/{backend/data,frontend/dist} && sudo chown -R ubuntu:ubuntu /opt/ais'

# 3. push code (incl. backend/.env with your keys), built UI, and the licensed DB
rsync -az --delete --exclude '.venv' --exclude '__pycache__' --exclude 'data' --exclude '*.pyc' \
  backend/ ubuntu@$IP:/opt/ais/ais-tracker/backend/
rsync -az --delete frontend/dist/ ubuntu@$IP:/opt/ais/ais-tracker/frontend/dist/
scp backend/data/ownership.sqlite ubuntu@$IP:/opt/ais/ais-tracker/backend/data/ownership.sqlite
```

> `backend/.env` (your `AISSTREAM_API_KEY`, `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`)
> is gitignored but present locally, so rsync ships it to the box. **sanctions.json
> auto-downloads on first boot**; registry + geofences self-create.

---

## 4. On the box: venv + deps

```bash
ssh ubuntu@$IP
cd /opt/ais/ais-tracker
python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r backend/requirements.txt
```

(`shapely`, `pydantic-core`, etc. all install from x86_64 wheels — quick, low memory.)

---

## 5. Firewall (iptables) + systemd service

Open 80/443 **above** the REJECT rule, then install the service (uvicorn binds
:80 directly via `CAP_NET_BIND_SERVICE` — no Caddy needed for HTTP):

```bash
# open 80/443 ABOVE the REJECT (find its line: `sudo iptables -L INPUT --line-numbers`)
sudo iptables -I INPUT 5 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
echo "iptables-persistent iptables-persistent/autosave_v4 boolean true" | sudo debconf-set-selections
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent
sudo netfilter-persistent save

# systemd unit
sudo tee /etc/systemd/system/ais.service >/dev/null <<'EOF'
[Unit]
Description=AIS Tracker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/ais/ais-tracker/backend
Environment=STATIC_DIR=/opt/ais/ais-tracker/frontend/dist
ExecStart=/opt/ais/ais-tracker/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 80
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now ais

# check
systemctl is-active ais
curl -s http://localhost/healthz
```

The app reads `backend/.env` via pydantic (CWD = `WorkingDirectory`), so no
`EnvironmentFile` is needed. Visit **http://YOUR_IP** — the full tracker loads.

---

## 6. Updating (day-to-day) — `deploy.sh`

From the repo root on your laptop:

```bash
./deploy.sh                    # default host
./deploy.sh ubuntu@1.2.3.4     # override
```

It rebuilds the frontend, rsyncs **code + build only** (never your `.env` or
`data/`), refreshes deps, and restarts the service — then prints the live vessel
count. One command, ~15s.

---

## 7. HTTPS (optional)

HTTP is fully functional (the live feed runs over same-origin `ws://`), but for a
padlock + a real URL, point a domain — or a free
[DuckDNS](https://www.duckdns.org) subdomain — at the IP, then put **Caddy** in
front (move uvicorn back to `:8000` first — drop `--port 80` to `--port 8000` and
the `CAP_NET_BIND_SERVICE` line):

```bash
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
yourname.duckdns.org {
    reverse_proxy localhost:8000
}
EOF
sudo systemctl restart caddy
```

Caddy auto-provisions a Let's Encrypt cert and passes the WebSocket through.

---

## Notes

- **Single instance.** One service, one upstream feed. Don't run two.
- **Reboots** are handled — `ais` is enabled and iptables rules are persisted.
- **Lloyd's licensing.** `ownership.sqlite` lives only on the box — never in git or
  a public image.
- **LLM cost is separate** — Anthropic + Tavily only spend when you click Generate.
- **$0** on Always Free; set the tenancy to *"Always Free resources only"* so it
  can't bill you.
