"""Traffic Scotland LEV cameras: grid conversion, catalogue parsing, sweep merge."""
from __future__ import annotations

from app.land.osgb import bng_to_wgs84
from app.land.scot_cameras import (
    ScotCameraCatalog,
    parse_catalogue,
    placeholder_hashes,
    view_from_name,
)

CSV = (
    "PresentationName,ImageName,LocationX,LocationY\r\n"
    "A68N At A6094 Junction,7_1231.jpg,334710,669037\r\n"
    "A725 Raith (N),7_192.jpg,271630,658815\r\n"
    "Achavanich South,4_1193_cam1.jpg,317977,942663\r\n"
    "M8 J8 Eastbound,4_1.jpg,notanumber,1\r\n"   # bad row → skipped
)


def test_bng_to_wgs84_matches_os_worked_example():
    # OS "Guide to coordinate systems" example: Caister Water Tower.
    lat, lon = bng_to_wgs84(651409.903, 313177.270)
    assert abs(lat - 52.65798) < 1e-4
    assert abs(lon - 1.71605) < 1e-4


def test_parse_catalogue_projects_and_derives_view():
    cams = parse_catalogue(CSV)
    assert [c.id for c in cams] == ["scot-7_1231", "scot-7_192", "scot-4_1193_cam1"]
    raith = cams[1]
    assert raith.view == "North"
    assert abs(raith.lat - 55.805) < 0.01 and abs(raith.lon - (-4.05)) < 0.01
    assert cams[2].view == "South"
    row = raith.public()
    assert row["provider"] == "scot"
    assert row["image"] == "/api/cameras/scot/7_192.jpg"
    assert row["video"] is None
    assert row["attribution"]["name"] == "Traffic Scotland"


def test_view_from_name_variants():
    assert view_from_name("A9 Drumochter Northbound") == "North"
    assert view_from_name("M74 J5 (S)") == "South"
    assert view_from_name("Forth Road Bridge") is None


def test_sweep_marks_shared_placeholder_offline_and_keeps_stale_frames():
    cat = ScotCameraCatalog()
    cams = parse_catalogue(CSV)
    junk = b"currently-unavailable-graphic"
    frames = {"7_1231.jpg": b"scene-a", "7_192.jpg": junk, "4_1193_cam1.jpg": junk}
    live = cat.apply_sweep(cams, frames, now=1000.0)
    # Only two share the graphic here, so lower the threshold in the helper
    # check; the catalogue itself uses ≥4 → both read "available" this sweep.
    assert placeholder_hashes(frames, min_shared=2) == {__import__("hashlib").md5(junk).hexdigest()}
    assert live == 3

    # A frame that fails to download keeps the previous picture but stays listed.
    cams2 = parse_catalogue(CSV)
    live2 = cat.apply_sweep(cams2, {"7_192.jpg": b"scene-b"}, now=2000.0)
    a = cat.get("scot-7_1231")
    assert a is not None and a.frame == b"scene-a" and a.frame_ts == 1000.0
    b = cat.get("scot-7_192")
    assert b is not None and b.frame == b"scene-b" and b.frame_ts == 2000.0
    assert live2 == 3
    assert cat.by_file("4_1193_cam1.jpg") is not None
    assert len(cat.list()) == 3


def test_placeholder_threshold_flags_widely_shared_frame():
    cat = ScotCameraCatalog()
    csv = "PresentationName,ImageName,LocationX,LocationY\r\n" + "".join(
        f"Cam {i},{i}.jpg,300000,700000\r\n" for i in range(6)
    )
    cams = parse_catalogue(csv)
    frames = {f"{i}.jpg": (b"real-%d" % i if i < 2 else b"placeholder") for i in range(6)}
    live = cat.apply_sweep(cams, frames, now=1.0)
    assert live == 2
    assert cat.get("scot-3").available is False
    assert cat.get("scot-0").available is True
