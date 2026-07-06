"""Push Port parsing against a representative v16 TS frame."""
import gzip
from datetime import datetime, timezone

from app.rail.pushport import parse_pushport, maybe_gunzip

# Shape per the openraildata wiki examples: uR wrapper, TS with rid/uid/ssd,
# Location children with arr/dep/pass carrying et (estimate) or at (actual).
SAMPLE = b"""<?xml version="1.0" encoding="UTF-8"?>
<Pport xmlns="http://www.thalesgroup.com/rtti/PushPort/v16" ts="2026-07-06T10:00:00Z" version="16.0">
 <uR updateOrigin="TD">
  <TS rid="202607068004321" uid="C12345" ssd="2026-07-06" xmlns="http://www.thalesgroup.com/rtti/PushPort/Forecasts/v3">
   <Location tpl="PADTON" wtd="10:00">
    <dep at="10:02" delay="2"/>
   </Location>
   <Location tpl="RDNGSTN" wta="10:25" wtd="10:27">
    <arr et="10:29"/>
    <dep et="10:30" delay="3"/>
   </Location>
   <Location tpl="BRSTLTM" wta="11:40">
    <arr et="11:43"/>
   </Location>
  </TS>
 </uR>
</Pport>"""


def test_parse_ts_frame():
    svcs = parse_pushport(SAMPLE)
    assert len(svcs) == 1
    s = svcs[0]
    assert s.rid == "202607068004321"
    assert s.uid == "C12345"
    assert s.late_min == 3.0
    assert [l.tiploc for l in s.locations] == ["PADTON", "RDNGSTN", "BRSTLTM"]
    # PADTON dep was an actual; times resolve on the service date.
    assert s.locations[0].actual is True
    base = datetime(2026, 7, 6, tzinfo=timezone.utc).timestamp()
    assert abs(s.locations[0].t - (base + 10 * 3600 + 2 * 60)) < 1
    # Monotonic through the journey.
    ts = [l.t for l in s.locations]
    assert ts == sorted(ts)


def test_gzip_and_junk_frames():
    assert parse_pushport(gzip.compress(SAMPLE))  # gzipped frames accepted
    assert parse_pushport(b"<not-xml") == []
    assert parse_pushport(b"<Pport xmlns='x'><uR/></Pport>") == []
    assert maybe_gunzip(b"plain") == b"plain"


def test_past_midnight_rollover():
    frame = SAMPLE.replace(b'wtd="10:00"', b'wtd="23:50"') \
                  .replace(b'at="10:02"', b'at="23:52"') \
                  .replace(b'et="10:29"', b'et="00:20"') \
                  .replace(b'et="10:30"', b'et="00:21"') \
                  .replace(b'et="11:43"', b'et="01:30"')
    s = parse_pushport(frame)[0]
    ts = [l.t for l in s.locations]
    assert ts == sorted(ts)  # 00:20 resolved to the NEXT day, after 23:52


def test_departure_estimate_beats_actual_arrival_but_not_actual_departure():
    # Interpolation anchors on when the train LEAVES a stop: an estimated
    # departure outranks an actual arrival — but an estimate must never
    # replace an actual of the same kind.
    frame = SAMPLE.replace(
        b'<dep et="10:30" delay="3"/>',
        b'<arr at="10:28"/><dep at="10:29"/><dep et="10:31" delay="3"/>',
    )
    s = parse_pushport(frame)[0]
    rdg = s.locations[1]
    base = datetime(2026, 7, 6, tzinfo=timezone.utc).timestamp()
    assert rdg.actual is True  # the actual dep (10:29) survived the later estimate
    assert abs(rdg.t - (base + 10 * 3600 + 29 * 60)) < 1
