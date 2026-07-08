"""Bus-swarm detector — synthetic road holds (no live jam needed)."""
from app.incidents.bus_swarm import BusSwarmDetector
from app.models import Bus


def _drive_then_stall(bid, route, lat, lon, det, start=1_000_000.0):
    """Feed a bus that drives in, then sits still for >2 min."""
    inc = None
    # 6 moving samples (approaching), then 15 stalled samples at (lat,lon).
    for i in range(6):
        b = Bus(id=bid, route=route, lat=lat - (6 - i) * 0.002, lon=lon, ts=start + i * 10)
        inc = det.update([b], start + i * 10)
    for i in range(6, 21):
        b = Bus(id=bid, route=route, lat=lat, lon=lon, ts=start + i * 10)
        inc = det.update(_batch, start + i * 10) if False else inc
    return start


# The detector clusters across buses, so tests feed all buses together per tick.
def _run(routes_positions):
    det = BusSwarmDetector()
    start = 1_000_000.0
    last = []
    for i in range(21):
        buses = []
        for k, (bid, route, lat, lon) in enumerate(routes_positions):
            # approach for first 6 ticks, then hold at (lat,lon)
            la = lat - max(0, 6 - i) * 0.002
            buses.append(Bus(id=bid, route=route, lat=la, lon=lon, ts=start + i * 10))
        last = det.update(buses, start + i * 10)
    return last


def test_multi_route_stall_fires():
    # 5 buses, 5 different routes, all stalled within ~metres of the same point.
    base = (51.51, -0.13)
    fleet = [(f"b{k}", str(24 + k), base[0] + k * 0.0002, base[1]) for k in range(5)]
    incs = _run(fleet)
    assert len(incs) == 1
    inc = incs[0]
    assert inc.source == "bus-swarm" and inc.category == "congestion"
    assert inc.confidence == "inferred"


def test_same_route_bunching_ignored():
    # 6 buses but all the SAME route — bunching, not a blockage.
    fleet = [(f"b{k}", "24", 51.51 + k * 0.0002, -0.13) for k in range(6)]
    assert _run(fleet) == []


def test_too_few_ignored():
    fleet = [(f"b{k}", str(24 + k), 51.51 + k * 0.0002, -0.13) for k in range(2)]
    assert _run(fleet) == []
