"""Tests for the fire domain: FIRMS CSV parsing (app/sources/fire.py), the
complex clustering + trend/industrial heuristics (app/fire/cluster.py), and the
detection store (app/store/fire.py)."""
from __future__ import annotations

import asyncio
import time

from app.fire.cluster import (
    MIN_TOTAL_FRP,
    cluster_detections,
    compass,
    destination,
)
from app.models import FireDetection
from app.sources.fire import parse_detection
from app.store.fire import FireStore

NOW = 1_753_600_000.0  # fixed "now" so age buckets are deterministic
H = 3600.0


# ---------------------------------------------------------------- parsing ----

def test_parse_viirs_row():
    det = parse_detection(
        {
            "latitude": "39.9184",
            "longitude": "-0.2426",
            "bright_ti4": "367.1",
            "acq_date": "2026-07-27",
            "acq_time": "1342",
            "satellite": "N20",
            "instrument": "VIIRS",
            "confidence": "h",
            "frp": "45.72",
            "daynight": "D",
        },
        "VIIRS_NOAA20_NRT",
    )
    assert det is not None
    assert det.lat == 39.9184 and det.lon == -0.2426
    assert det.frp == 45.7
    assert det.brightness == 367.1
    assert det.confidence == "high"
    assert det.satellite == "NOAA-20" and det.instrument == "VIIRS"
    # 2026-07-27 13:42 UTC
    assert det.acq == 1_785_159_720.0
    assert det.ts == det.acq


def test_parse_modis_row_numeric_confidence():
    det = parse_detection(
        {
            "latitude": "41.2",
            "longitude": "1.1",
            "brightness": "330.5",
            "acq_date": "2026-07-27",
            "acq_time": "23",  # FIRMS leaves early-morning times unpadded
            "satellite": "A",
            "instrument": "MODIS",
            "confidence": "85",
            "frp": "12.3",
            "daynight": "N",
        },
        "MODIS_NRT",
    )
    assert det is not None
    assert det.brightness == 330.5
    assert det.confidence == "high"  # 85 ≥ 80
    assert det.satellite == "Aqua" and det.instrument == "MODIS"
    assert det.daynight == "N"
    assert det.acq == 1_785_111_780.0  # 00:23 UTC


def test_parse_confidence_bands_and_bad_rows():
    def conf(raw: str) -> str:
        d = parse_detection(
            {"latitude": "40", "longitude": "0", "frp": "5", "confidence": raw,
             "acq_date": "2026-07-27", "acq_time": "0100"},
            "VIIRS_SNPP_NRT",
        )
        assert d is not None
        return d.confidence

    assert conf("l") == "low" and conf("n") == "nominal" and conf("h") == "high"
    assert conf("20") == "low" and conf("55") == "nominal" and conf("garbage") == "nominal"
    # Rows without a usable position are rejected, not defaulted.
    assert parse_detection({"latitude": "oops", "longitude": "0"}, "X") is None
    assert parse_detection({}, "X") is None


def test_parse_is_idempotent():
    row = {"latitude": "40.5", "longitude": "-3.2", "frp": "30",
           "acq_date": "2026-07-27", "acq_time": "0512", "satellite": "N21"}
    a = parse_detection(row, "VIIRS_NOAA21_NRT")
    b = parse_detection(dict(row), "VIIRS_NOAA21_NRT")
    assert a is not None and b is not None
    assert a.id == b.id  # re-polling the same window re-upserts, never duplicates


# ------------------------------------------------------------- clustering ----

def _det(lat: float, lon: float, frp: float = 20.0, age_h: float = 1.0,
         daynight: str = "D", confidence: str = "nominal") -> FireDetection:
    acq = NOW - age_h * H
    return FireDetection(
        id=f"{lat:.4f},{lon:.4f},{acq}", lat=lat, lon=lon, frp=frp,
        confidence=confidence, satellite="NOAA-20", instrument="VIIRS",
        daynight=daynight, acq=acq, ts=acq,
    )


def test_cluster_drops_lone_pixels_and_weak_clusters():
    lone = [_det(40.0, 0.0), _det(40.0, 0.01)]  # 2 < MIN_COUNT
    assert cluster_detections(lone, NOW) == []
    # Enough pixels but too faint overall (transient agricultural burn).
    weak = [_det(42.0, 2.0, frp=3.0, age_h=a) for a in (1.0, 2.0, 3.0)]
    assert sum(d.frp for d in weak) < MIN_TOTAL_FRP
    assert cluster_detections(weak, NOW) == []


def test_cluster_groups_adjacent_and_splits_distant():
    near = [_det(39.9, -0.24, frp=50, age_h=a) for a in (1.0, 3.0, 5.0)]
    far = [_det(43.5, 5.0, frp=20, age_h=a) for a in (2.0, 4.0, 6.0)]
    out = cluster_detections(near + far, NOW)
    assert len(out) == 2
    # Sorted by intensity: the 150 MW complex leads.
    assert out[0].total_frp == 150.0 and out[1].total_frp == 60.0
    assert out[0].count == 3 and out[0].peak_frp == 50.0
    assert abs(out[0].lat - 39.9) < 0.01 and abs(out[0].lon - -0.24) < 0.01
    assert out[0].high_conf == 0
    assert out[0].last_satellite == "NOAA-20"


def test_status_trend_buckets():
    # Brand-new fire: activity now, nothing yesterday → spreading.
    new = [_det(40.0, 0.0, age_h=a) for a in (1.0, 2.0, 3.0)]
    assert cluster_detections(new, NOW)[0].status == "spreading"
    # Declining: 3 yesterday → 2 today (ratio 0.67 ≤ 0.7) → easing.
    easing = ([_det(41.0, 1.0, age_h=a) for a in (1.0, 2.0)]
              + [_det(41.0, 1.0, age_h=a) for a in (26.0, 30.0, 34.0)])
    assert cluster_detections(easing, NOW)[0].status == "easing"
    # Gone quiet: nothing in the last 24 h → cooling.
    cold = [_det(42.0, 2.0, age_h=a) for a in (26.0, 30.0, 34.0)]
    assert cluster_detections(cold, NOW)[0].status == "cooling"
    # Steady (ratio 1.0) but spread over a >4 km front — a real fire holding
    # its ground, not a fixed point source → active.
    steady = ([_det(43.0 + i * 0.025, 3.0, age_h=a) for i, a in enumerate((1.0, 12.0, 20.0))]
              + [_det(43.0 + i * 0.025, 3.0, age_h=a) for i, a in enumerate((26.0, 36.0, 44.0))])
    assert cluster_detections(steady, NOW)[0].status == "active"


def test_industrial_point_source_labelled_even_when_faint():
    # One spot, burning day AND night across >20 h at a steady rate: a flare or
    # power station. Faint (total 8 MW < MIN_TOTAL_FRP) yet still surfaced —
    # labelled industrial rather than dropped or shown as a wildfire.
    pts = [
        _det(41.5, 2.2, frp=2.0, age_h=2.0, daynight="D"),
        _det(41.5, 2.2, frp=2.0, age_h=10.0, daynight="N"),
        _det(41.5, 2.2, frp=2.0, age_h=26.0, daynight="D"),
        _det(41.5, 2.2, frp=2.0, age_h=30.0, daynight="N"),
    ]
    out = cluster_detections(pts, NOW)
    assert len(out) == 1
    assert out[0].kind == "industrial"
    # The same signature spread over a wide front is a real fire, not a plant.
    spread = [
        _det(41.5, 2.2, frp=20.0, age_h=2.0, daynight="D"),
        _det(41.55, 2.25, frp=20.0, age_h=10.0, daynight="N"),
        _det(41.6, 2.3, frp=20.0, age_h=26.0, daynight="D"),
        _det(41.65, 2.35, frp=20.0, age_h=30.0, daynight="N"),
    ]
    assert cluster_detections(spread, NOW)[0].kind == "wildfire"


def test_night_only_flare_is_industrial_not_wildfire():
    # Fawley-refinery regression: faint flares are visible ONLY on night passes
    # (too dim against sunlit ground by day). Two nights of the same pinpoint
    # source must read industrial — never a spreading wildfire.
    pts = [
        _det(50.83, -1.37, frp=2.0, age_h=3.0, daynight="N"),
        _det(50.83, -1.37, frp=1.5, age_h=5.0, daynight="N"),
        _det(50.83, -1.37, frp=2.0, age_h=27.0, daynight="N"),
        _det(50.83, -1.37, frp=1.5, age_h=29.0, daynight="N"),
    ]
    out = cluster_detections(pts, NOW)
    assert len(out) == 1 and out[0].kind == "industrial"


def test_complex_carries_its_grid_cells():
    pts = [_det(39.9, -0.24, frp=50, age_h=a) for a in (1.0, 3.0, 5.0)]
    fc = cluster_detections(pts, NOW)[0]
    # Cells use the same round(coord / CELL_DEG) mapping the client replicates.
    assert fc.cells == [(round(39.9 / 0.15), round(-0.24 / 0.15))]


def test_compass_and_destination():
    assert compass(0) == "N" and compass(45) == "NE" and compass(225) == "SW"
    assert compass(359) == "N"
    # ~12 km due north ≈ +0.108° latitude, longitude unchanged.
    lat, lon = destination(40.0, 0.0, 0.0, 12.0)
    assert abs(lat - 40.108) < 0.005 and abs(lon) < 1e-6


def test_source_stale_threshold_matches_poll_cadence():
    # FIRMS polls every 15 min; the health check must not flag a healthy feed as
    # stale between polls (the streaming default is 60 s).
    from app.config import Settings
    from app.sources.fire import FireSource

    src = FireSource(FireStore(), Settings(_env_file=None))
    src.connected = True
    src.last_msg_ts = time.time() - 600  # 10 min since the last poll — normal
    assert src.stale_after > 600
    assert src.receiving is True
    src.last_msg_ts = time.time() - src.stale_after - 1  # two missed polls
    assert src.receiving is False


# ------------------------------------------------------------------ store ----

def test_store_upsert_idempotent_and_evict():
    # evict_stale measures age against the real clock, so build detections
    # relative to time.time() rather than the fixed NOW used above.
    def live_det(lat: float, lon: float, age_h: float) -> FireDetection:
        acq = time.time() - age_h * H
        return FireDetection(id=f"{lat},{lon},{age_h}", lat=lat, lon=lon,
                             frp=10.0, acq=acq, ts=acq)

    async def run():
        store = FireStore()
        d = live_det(40.0, 0.0, age_h=1.0)
        await store.upsert(d)
        await store.upsert(d)  # re-poll of the same window
        assert await store.count() == 1
        old = live_det(41.0, 1.0, age_h=80.0)
        await store.upsert(old)
        # 48 h TTL sweeps the cold detection, keeps the fresh one.
        removed = await store.evict_stale(48 * 3600)
        assert removed == 1
        assert [f.id for f in await store.snapshot()] == [d.id]

    asyncio.run(run())
