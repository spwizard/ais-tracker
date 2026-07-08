"""Darwin Push Port source — live GB rail via the Rail Data Marketplace.

Consumes the marketplace's Kafka topic (Confluent, SASL/PLAIN). RDM serves
Push Port as JSON-converted messages (topic name ends `-JSON`), so this source
extracts TS (train status) forecasts from JSON rather than the raw gzipped XML
(app/rail/pushport.py handles the XML shape if we ever consume it directly).

The JSON schema isn't published on the product page ("Schema: No data"), so
the extractor is tolerant: it walks each message for TS-shaped objects (rid +
locations with TIPLOC + times) and dumps the first few raw messages to the
data/ directory for schema discovery on first run.

Positions come from the same interpolation engine the simulator uses — once a
service's TIPLOCs resolve to coordinates. TIPLOC→location comes from the
Darwin Timetable reference file (see rail/tiplocs.py); services whose stops
can't be resolved yet are counted but not placed.
"""
from __future__ import annotations

import json
import ssl
import time
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import Any

import httpx

from ..config import Settings
from ..models import Train, TrainStop
from ..rail.interpolate import CallingPoint, position_at
from ..rail.operators import operator_name
from ..rail.reasons import reason_text
from ..rail.geometry import snap as rail_snap
from ..rail.tiplocs import tiploc_map
from ..store.train import TrainStore
from .base import Source, log

SAMPLE_DIR = Path("data/darwin-samples")
MAX_SAMPLES = 8
UPSERT_EVERY_SEC = 5.0  # re-interpolate + publish positions on this cadence
SERVICE_TTL_SEC = 3 * 3600  # forget services with no update for 3h


def _walk(obj: Any, key_match: str):
    """Yield every dict value under any key containing `key_match` (case-insensitive)."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if key_match in k.lower():
                if isinstance(v, list):
                    yield from (x for x in v if isinstance(x, dict))
                elif isinstance(v, dict):
                    yield v
            yield from _walk(v, key_match)
    elif isinstance(obj, list):
        for item in obj:
            yield from _walk(item, key_match)


def _attr(d: dict, *names: str):
    """Fetch an attribute that may be plain, @-prefixed, or namespaced."""
    for n in names:
        for k in (n, f"@{n}", f"ns5:{n}"):
            if k in d:
                return d[k]
    lower = {k.lower().lstrip("@"): v for k, v in d.items()}
    for n in names:
        if n.lower() in lower:
            return lower[n.lower()]
    return None


_LONDON = ZoneInfo("Europe/London")


def _parse_time(base_date: str, s: str, prev: float | None) -> float | None:
    """Darwin times are HH:MM[:SS] in UK LOCAL time (BST in summer!) on the
    service date; roll past midnight. Parsing them as UTC froze every train an
    hour before departure."""
    try:
        parts = [int(x) for x in str(s).split(":")]
        base = datetime.fromisoformat(base_date).replace(tzinfo=_LONDON)
    except (ValueError, TypeError):
        return None
    if len(parts) == 2:
        h, m, sec = parts[0], parts[1], 0
    elif len(parts) == 3:
        h, m, sec = parts
    else:
        return None
    t = base.timestamp() + h * 3600 + m * 60 + sec
    if prev is not None and t < prev - 12 * 3600:
        t += 24 * 3600
    return t


class DarwinSource(Source):
    name = "darwin"

    def __init__(self, store: TrainStore, settings: Settings) -> None:
        super().__init__(store)  # type: ignore[arg-type]
        self._snapshot_url = settings.darwin_snapshot_url
        self._apikey = settings.darwin_apikey
        self._bootstrap = settings.darwin_bootstrap
        self._topic = settings.darwin_topic
        self._group = settings.darwin_group
        self._user = settings.darwin_user
        self._password = settings.darwin_pass
        # rid -> {"ssd": str, "late": float|None, "locs": [...], "seen": epoch}
        self._services: dict[str, dict] = {}
        # rid -> (toc_code, headcode), learned from schedule (SC) messages
        self._schedules: dict[str, tuple[str | None, str | None]] = {}
        self._samples = 0
        self._last_upsert = 0.0
        self._unresolved: set[str] = set()  # TIPLOCs we couldn't place (for logging)

    @property
    def configured(self) -> bool:
        return bool(self._bootstrap and self._topic and self._user and self._password)

    # --- message handling ---------------------------------------------------

    def _save_sample(self, raw: bytes) -> None:
        if self._samples >= MAX_SAMPLES:
            return
        SAMPLE_DIR.mkdir(parents=True, exist_ok=True)
        (SAMPLE_DIR / f"msg-{self._samples:02d}.json").write_bytes(raw[:200_000])
        self._samples += 1
        if self._samples == MAX_SAMPLES:
            log.info("[darwin] wrote %d schema samples to %s", MAX_SAMPLES, SAMPLE_DIR)

    def _ingest(self, raw: bytes, now: float) -> int:
        """Extract TS forecasts from one message; returns services updated."""
        self._save_sample(raw)
        try:
            obj = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            return 0

        # RDM wraps each Push Port message in an ActiveMQ envelope with the
        # actual pPort JSON stringified inside `bytes` (sometimes `text`).
        if isinstance(obj, dict):
            inner = obj.get("bytes") or obj.get("text")
            if isinstance(inner, str) and inner.lstrip().startswith("{"):
                try:
                    obj = json.loads(inner)
                except ValueError:
                    return 0

        # Schedule (SC) messages carry the operator (toc) + signalling
        # headcode (trainId), keyed by rid — cache them to name services.
        for sched in _walk(obj, "schedule"):
            rid = _attr(sched, "rid")
            if rid:
                self._schedules[str(rid)] = (
                    _attr(sched, "toc"),
                    _attr(sched, "trainId", "trainid"),
                )

        updated = 0
        for ts in _walk(obj, "ts"):
            rid = _attr(ts, "rid")
            ssd = _attr(ts, "ssd")
            if not rid or not ssd:
                continue
            reason_code = _attr(ts, "LateReason", "latereason") or _attr(ts, "CancelReason", "cancelreason")
            locs: list[tuple[str, float, bool]] = []
            late: float | None = None
            late_at: float = 0.0  # time of the location the lateness came from
            prev_t: float | None = None
            for loc in _walk(ts, "location"):
                tpl = _attr(loc, "tpl", "tiploc")
                if not tpl:
                    continue
                # Scheduled ("working") time at this location — lateness is
                # forecast minus schedule; Darwin rarely sends `delay` itself.
                wt = None
                for w in ("wtd", "wta", "wtp"):
                    v = _attr(loc, w)
                    if v is not None:
                        wt = _parse_time(str(ssd), v, prev_t)
                        if wt is not None:
                            break
                best: tuple[float, bool, bool] | None = None
                for kind, is_dep in (("arr", False), ("dep", True), ("pass", False)):
                    ev = _attr(loc, kind)
                    if not isinstance(ev, dict):
                        continue
                    for attr, actual in (("at", True), ("et", False)):
                        v = _attr(ev, attr)
                        if v is None:
                            continue
                        t = _parse_time(str(ssd), v, prev_t)
                        if t is None:
                            continue
                        if best is None:
                            best = (t, actual, is_dep)
                        else:
                            _, b_act, b_dep = best
                            if (is_dep and not b_dep) or (is_dep == b_dep and actual and not b_act):
                                best = (t, actual, is_dep)
                    d = _attr(ev, "delay") if isinstance(ev, dict) else None
                    if d is not None:
                        try:
                            late = float(d)
                        except (TypeError, ValueError):
                            pass
                if best is not None:
                    prev_t = best[0]
                    locs.append((str(tpl), best[0], best[1]))
                    if wt is not None and best[0] >= late_at:
                        late_at = best[0]
                        late = max(-30.0, (best[0] - wt) / 60.0)
            if locs:
                entry = self._services.setdefault(str(rid), {})
                entry["ssd"] = str(ssd)
                entry["seen"] = now
                if late is not None:
                    entry["late"] = late
                if reason_code is not None:
                    # LateReason can be a bare code or a {"value": code} dict.
                    rc = reason_code.get("value") if isinstance(reason_code, dict) else reason_code
                    entry["reason"] = str(rc)
                # Merge: newer forecasts replace by TIPLOC, keep route order by time.
                merged = {t[0]: t for t in entry.get("locs", [])}
                for l in locs:
                    merged[l[0]] = l
                entry["locs"] = sorted(merged.values(), key=lambda x: x[1])
                updated += 1
        return updated

    async def _publish(self, now: float) -> None:
        """Interpolate + upsert every tracked service with resolvable stops."""
        tmap = tiploc_map()
        placed = 0
        for rid, svc in list(self._services.items()):
            if now - svc.get("seen", 0) > SERVICE_TTL_SEC:
                del self._services[rid]
                continue
            points: list[CallingPoint] = []
            for tpl, t, _actual in svc.get("locs", []):
                st = tmap.get(tpl)
                if st is None:
                    self._unresolved.add(tpl)
                    continue
                points.append(CallingPoint(st.crs or tpl, st.name, st.lat, st.lon, t))
            if len(points) < 2 or now > points[-1].t + 300:
                continue
            fix = position_at(points, now)
            if fix is None:
                continue
            # Tier-2: pull the straight-line position onto the real rails and
            # take the local track bearing, so trains follow the route instead
            # of cutting across country. Falls back to the raw fix off-network.
            lat, lon, bearing = fix.lat, fix.lon, fix.bearing
            snapped = rail_snap(fix.lat, fix.lon, fix.bearing)
            if snapped:
                lat, lon, bearing = snapped
            late = float(svc.get("late") or 0.0)
            toc, headcode = self._schedules.get(rid, (None, None))
            await self._store.upsert(Train(
                id=rid,
                headcode=headcode,
                operator=operator_name(toc),
                origin=points[0].name,
                destination=points[-1].name,
                lat=lat,
                lon=lon,
                bearing=bearing,
                speed_kn=round(fix.speed_kn, 1),
                delay_min=late,
                delay_reason=reason_text(svc.get("reason")),
                next_name=points[min(fix.next_idx, len(points) - 1)].name,
                stops=[TrainStop(crs=p.crs, name=p.name, lat=p.lat, lon=p.lon, t=p.t) for p in points],
                sim=False,
                ts=now,
            ))
            placed += 1
        await self._store.evict_stale(120)
        if placed:
            log.debug("[darwin] placed %d services (%d unresolved TIPLOCs)", placed, len(self._unresolved))

    async def _warm_start(self) -> None:
        """Load the hourly snapshot so the picture is full on boot instead of
        accumulating from live updates over ~10 minutes. Best-effort: any
        failure (401 while the key propagates, rate limit) just logs and the
        stream fills the picture the slow way."""
        if not (self._snapshot_url and self._apikey):
            return
        try:
            async with httpx.AsyncClient(timeout=180.0) as client:
                r = await client.post(self._snapshot_url, headers={"x-apikey": self._apikey})
                if r.status_code != 200:
                    log.warning("[darwin] snapshot warm-start skipped (HTTP %s)", r.status_code)
                    return
                raw = r.content
        except httpx.HTTPError as exc:
            log.warning("[darwin] snapshot warm-start failed: %s", exc)
            return

        import gzip as _gzip
        if raw[:2] == b"\x1f\x8b":
            raw = _gzip.decompress(raw)
        now = time.time()
        n = 0
        stripped = raw.lstrip()[:1]
        if stripped == b"<":
            # Raw pPort XML snapshot — reuse the tested XML parser.
            from ..rail.pushport import parse_pushport
            for svc in parse_pushport(raw):
                entry = self._services.setdefault(svc.rid, {})
                entry["ssd"] = ""  # times already absolute from the parser
                entry["seen"] = now
                entry["late"] = svc.late_min
                entry["locs"] = [(l.tiploc, l.t, l.actual) for l in svc.locations]
                n += 1
        else:
            # JSON: either one document or JSON-lines of enveloped messages.
            for line in raw.splitlines() or [raw]:
                line = line.strip()
                if line:
                    n += self._ingest(line, now)
        log.info("[darwin] warm-start loaded %d services", n)
        await self._publish(now)

    # --- consume loop ---------------------------------------------------------

    async def _consume(self) -> None:
        if not self.configured:
            await self._stop.wait()  # no credentials → idle (amber in the UI)
            return

        from aiokafka import AIOKafkaConsumer
        import certifi

        ctx = ssl.create_default_context(cafile=certifi.where())
        consumer = AIOKafkaConsumer(
            self._topic,
            bootstrap_servers=self._bootstrap,
            group_id=self._group,
            security_protocol="SASL_SSL",
            sasl_mechanism="PLAIN",
            sasl_plain_username=self._user,
            sasl_plain_password=self._password,
            ssl_context=ctx,
            auto_offset_reset="latest",
            enable_auto_commit=True,
        )
        await self._warm_start()
        await consumer.start()
        log.info("[darwin] connected to %s (%s)", self._bootstrap, self._topic)
        try:
            self.connected = True
            async for msg in consumer:
                now = time.time()
                if msg.value:
                    n = self._ingest(msg.value, now)
                    if n:
                        self.messages_seen += n
                        self.last_msg_ts = now
                if now - self._last_upsert >= UPSERT_EVERY_SEC:
                    self._last_upsert = now
                    await self._publish(now)
        finally:
            await consumer.stop()
            self.connected = False
