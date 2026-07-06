"""Rail domain (land) — live GB train positions.

Tier-1 approach: positions are *inferred*, not broadcast. Trains report times
at calling points (Darwin) and we interpolate along the route between them.
The prototype ships with a simulated source on real routes; the Darwin Push
Port source drops into the same seam once credentials are configured.
"""
