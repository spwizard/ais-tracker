"""British National Grid (OSGB36 / EPSG:27700) → WGS84 lat/lon.

Traffic Scotland publishes camera positions as OS grid eastings/northings. The
classic route back to WGS84 is: inverse Transverse Mercator on the Airy 1830
ellipsoid → geodetic → cartesian → 7-parameter Helmert → geodetic on GRS80.
Accuracy is ~5 m across GB, which is far below a map pin's footprint, so we
avoid pulling in pyproj (and its ~20 MB of PROJ data) for one lookup table.
"""
from __future__ import annotations

import math

# Airy 1830 ellipsoid + the National Grid projection constants.
_A_AIRY, _B_AIRY = 6377563.396, 6356256.909
_F0 = 0.9996012717
_LAT0, _LON0 = math.radians(49.0), math.radians(-2.0)
_N0, _E0 = -100000.0, 400000.0

# WGS84 (GRS80) ellipsoid.
_A_WGS, _B_WGS = 6378137.0, 6356752.3142

# OSGB36 → WGS84 Helmert parameters (OS "Guide to coordinate systems in GB").
_TX, _TY, _TZ = 446.448, -125.157, 542.060
_S = -20.4894e-6
_RX, _RY, _RZ = (math.radians(v / 3600.0) for v in (0.1502, 0.2470, 0.8421))


def _tm_inverse(e: float, n: float) -> tuple[float, float]:
    """Inverse Transverse Mercator: grid E/N → OSGB36 lat/lon (radians)."""
    a, b = _A_AIRY, _B_AIRY
    e2 = 1 - (b * b) / (a * a)
    nn = (a - b) / (a + b)
    nn2, nn3 = nn * nn, nn * nn * nn

    lat = _LAT0
    m = 0.0
    while True:
        lat = (n - _N0 - m) / (a * _F0) + lat
        ma = (1 + nn + 1.25 * nn2 + 1.25 * nn3) * (lat - _LAT0)
        mb = (3 * nn + 3 * nn2 + 2.625 * nn3) * math.sin(lat - _LAT0) * math.cos(lat + _LAT0)
        mc = (1.875 * nn2 + 1.875 * nn3) * math.sin(2 * (lat - _LAT0)) * math.cos(2 * (lat + _LAT0))
        md = (35 / 24) * nn3 * math.sin(3 * (lat - _LAT0)) * math.cos(3 * (lat + _LAT0))
        m = b * _F0 * (ma - mb + mc - md)
        if abs(n - _N0 - m) < 1e-5:
            break

    sin_lat, cos_lat = math.sin(lat), math.cos(lat)
    tan_lat = sin_lat / cos_lat
    nu = a * _F0 / math.sqrt(1 - e2 * sin_lat * sin_lat)
    rho = a * _F0 * (1 - e2) / (1 - e2 * sin_lat * sin_lat) ** 1.5
    eta2 = nu / rho - 1

    tan2, tan4, tan6 = tan_lat**2, tan_lat**4, tan_lat**6
    sec_lat = 1 / cos_lat
    nu3, nu5, nu7 = nu**3, nu**5, nu**7

    vii = tan_lat / (2 * rho * nu)
    viii = tan_lat / (24 * rho * nu3) * (5 + 3 * tan2 + eta2 - 9 * tan2 * eta2)
    ix = tan_lat / (720 * rho * nu5) * (61 + 90 * tan2 + 45 * tan4)
    x = sec_lat / nu
    xi = sec_lat / (6 * nu3) * (nu / rho + 2 * tan2)
    xii = sec_lat / (120 * nu5) * (5 + 28 * tan2 + 24 * tan4)
    xiia = sec_lat / (5040 * nu7) * (61 + 662 * tan2 + 1320 * tan4 + 720 * tan6)

    de = e - _E0
    de2, de3, de4, de5, de6, de7 = de**2, de**3, de**4, de**5, de**6, de**7
    lat_out = lat - vii * de2 + viii * de4 - ix * de6
    lon_out = _LON0 + x * de - xi * de3 + xii * de5 - xiia * de7
    return lat_out, lon_out


def _to_cartesian(lat: float, lon: float, a: float, b: float) -> tuple[float, float, float]:
    e2 = 1 - (b * b) / (a * a)
    sin_lat = math.sin(lat)
    nu = a / math.sqrt(1 - e2 * sin_lat * sin_lat)
    return (
        nu * math.cos(lat) * math.cos(lon),
        nu * math.cos(lat) * math.sin(lon),
        (1 - e2) * nu * sin_lat,
    )


def _to_geodetic(x: float, y: float, z: float, a: float, b: float) -> tuple[float, float]:
    e2 = 1 - (b * b) / (a * a)
    p = math.hypot(x, y)
    lat = math.atan2(z, p * (1 - e2))
    for _ in range(10):
        sin_lat = math.sin(lat)
        nu = a / math.sqrt(1 - e2 * sin_lat * sin_lat)
        lat_new = math.atan2(z + e2 * nu * sin_lat, p)
        if abs(lat_new - lat) < 1e-12:
            lat = lat_new
            break
        lat = lat_new
    return lat, math.atan2(y, x)


def bng_to_wgs84(easting: float, northing: float) -> tuple[float, float]:
    """OS National Grid (E, N) metres → (lat, lon) degrees on WGS84."""
    lat, lon = _tm_inverse(easting, northing)
    x, y, z = _to_cartesian(lat, lon, _A_AIRY, _B_AIRY)
    # 7-parameter Helmert (small-angle rotation matrix).
    x2 = _TX + (1 + _S) * x - _RZ * y + _RY * z
    y2 = _TY + _RZ * x + (1 + _S) * y - _RX * z
    z2 = _TZ - _RY * x + _RX * y + (1 + _S) * z
    lat2, lon2 = _to_geodetic(x2, y2, z2, _A_WGS, _B_WGS)
    return round(math.degrees(lat2), 6), round(math.degrees(lon2), 6)
