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
Internet ──80/443──▶ Caddy (TLS for arguseyes.xyz) ──▶ uvicorn (127.0.0.1:8000,
                                                         API + WS + bundled frontend)
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
loopback `:8000`; Caddy — §7 — owns 80/443 and terminates TLS):

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
ExecStart=/opt/ais/ais-tracker/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips 127.0.0.1
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now ais

# check
systemctl is-active ais
curl -s http://localhost:8000/healthz
```

The app reads `backend/.env` via pydantic (CWD = `WorkingDirectory`), so no
`EnvironmentFile` is needed. Once Caddy (§7) is up, visit **https://arguseyes.xyz**
(or **http://YOUR_IP**) — the full tracker loads.

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

## 7. HTTPS — Caddy + arguseyes.xyz (live)

**arguseyes.xyz** (A records for `@` and `www` → the box IP) is fronted by
**Caddy**, which auto-provisions Let's Encrypt certs and passes the WebSocket
through. Install from Caddy's official apt repo (the Ubuntu archive one is
ancient), then:

```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
# Canonical site — auto-HTTPS.
arguseyes.xyz {
    encode zstd gzip
    # route{} preserves order: the SPA shell must revalidate every load
    # (heuristic caching once served stale deploys for hours), while the
    # hash-named build assets are immutable.
    route {
        header Cache-Control "no-cache"
        header /assets/* Cache-Control "public, max-age=31536000, immutable"
        reverse_proxy 127.0.0.1:8000
    }
}

# www → apex.
www.arguseyes.xyz {
    redir https://arguseyes.xyz{uri} permanent
}

# Raw-IP access stays on plain HTTP (no cert is possible for a bare IP).
http://140.238.76.193 {
    reverse_proxy 127.0.0.1:8000
}
EOF
sudo systemctl enable --now caddy
```

Certs are issued via HTTP-01 on :80, so issuance works even before 443 is
reachable. Remember **both** firewalls: the box iptables (§5) *and* the OCI VCN
security list need TCP 443 ingress — the VCN rule lives in the console under
Networking → VCN → Security Lists.

---

## Notes

- **Single instance.** One service, one upstream feed. Don't run two.
- **Reboots** are handled — `ais` is enabled and iptables rules are persisted.
- **Lloyd's licensing.** `ownership.sqlite` lives only on the box — never in git or
  a public image.
- **LLM cost is separate** — Anthropic + Tavily only spend when you click Generate.
- **$0** on Always Free; set the tenancy to *"Always Free resources only"* so it
  can't bill you.
