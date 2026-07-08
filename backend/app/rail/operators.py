"""ATOC / TOC operator codes → train operating company names.

Darwin identifies operators by two-letter code (`toc` on schedule elements).
This maps the ones that run passenger services in the Push Port feed.
"""
from __future__ import annotations

OPERATORS: dict[str, str] = {
    "AW": "Transport for Wales",
    "CC": "c2c",
    "CH": "Chiltern Railways",
    "CS": "Caledonian Sleeper",
    "EM": "East Midlands Railway",
    "ES": "Eurostar",
    "GC": "Grand Central",
    "GN": "Great Northern",
    "GR": "LNER",
    "GW": "Great Western Railway",
    "GX": "Gatwick Express",
    "HT": "Hull Trains",
    "HX": "Heathrow Express",
    "IL": "Island Line",
    "LD": "Lumo",
    "LE": "Greater Anglia",
    "LM": "West Midlands Railway",
    "LO": "London Overground",
    "LT": "London Underground",
    "ME": "Merseyrail",
    "NT": "Northern",
    "SE": "Southeastern",
    "SN": "Southern",
    "SR": "ScotRail",
    "SW": "South Western Railway",
    "TL": "Thameslink",
    "TP": "TransPennine Express",
    "TW": "Tyne & Wear Metro",
    "VT": "Avanti West Coast",
    "XC": "CrossCountry",
    "XR": "Elizabeth line",
}


def operator_name(toc: str | None) -> str | None:
    if not toc:
        return None
    return OPERATORS.get(toc.upper(), toc.upper())
