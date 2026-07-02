import { describe, it, expect } from "vitest";
import { assessRoute } from "./airRoute";
import type { Aircraft, AircraftRoute } from "@/types";

function ac(partial: Partial<Aircraft>): Aircraft {
  return {
    hex: "abc123",
    callsign: "EZY59XG",
    lat: null,
    lon: null,
    track: null,
    gs: null,
    alt_baro: null,
    baro_rate: null,
    on_ground: false,
    category: null,
    ac_type: null,
    reg: null,
    squawk: null,
    ts: 0,
    ...partial,
  };
}

// London Gatwick (EGKK) → Málaga (LEMG), the route adsbdb returns for EZY59XG.
const LGW_AGP: AircraftRoute = {
  airline: { name: "easyJet", icao: "EZY", iata: "U2" },
  origin: { name: "Gatwick", iata: "LGW", icao: "EGKK", municipality: "London", country: "UK", country_iso: "GB", lat: 51.148, lon: -0.19 },
  destination: { name: "Málaga", iata: "AGP", icao: "LEMG", municipality: "Málaga", country: "Spain", country_iso: "ES", lat: 36.675, lon: -4.499 },
};

describe("assessRoute", () => {
  it("flags a low aircraft far from both airports (the Bristol case)", () => {
    // 7,275 ft climbing over Bristol — ~100 nm from Gatwick, ~800 from Málaga.
    const r = assessRoute(ac({ lat: 51.3136, lon: -2.971, alt_baro: 7275 }), LGW_AGP);
    expect(r.plausible).toBe(false);
    expect(r.note).toMatch(/nm from the nearest airport/);
  });

  it("accepts a low aircraft near its origin (normal departure)", () => {
    // Climbing out ~10 nm from Gatwick.
    const r = assessRoute(ac({ lat: 51.05, lon: -0.05, alt_baro: 6000 }), LGW_AGP);
    expect(r.plausible).toBe(true);
    expect(r.note).toBeNull();
  });

  it("does not flag a cruising aircraft far from both airports (unverifiable)", () => {
    // FL370 over the Bay of Biscay — high, so we can't verify; treat as plausible.
    const r = assessRoute(ac({ lat: 45.0, lon: -3.0, alt_baro: 37000 }), LGW_AGP);
    expect(r.plausible).toBe(true);
  });

  it("flags an on-ground aircraft far from both airports", () => {
    const r = assessRoute(ac({ lat: 51.3136, lon: -2.971, on_ground: true }), LGW_AGP);
    expect(r.plausible).toBe(false);
  });

  it("is plausible when route data is incomplete", () => {
    expect(assessRoute(ac({ lat: 51.3, lon: -2.9, alt_baro: 7000 }), null).plausible).toBe(true);
  });
});
