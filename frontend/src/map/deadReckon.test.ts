import { describe, expect, it } from "vitest";
import { deadReckon, DR_SCRATCH } from "./deadReckon";

const LAT = 50.0;
const LON = -1.0;

describe("deadReckon", () => {
  it("holds position without course or speed", () => {
    expect(deadReckon(LAT, LON, null, 12, 60)).toEqual([LON, LAT]);
    expect(deadReckon(LAT, LON, 90, null, 60)).toEqual([LON, LAT]);
  });

  it("treats near-zero speed as stationary", () => {
    expect(deadReckon(LAT, LON, 90, 0.1, 600)).toEqual([LON, LAT]);
  });

  it("projects north along course 0", () => {
    const [lon, lat] = deadReckon(LAT, LON, 0, 10, 30);
    expect(lat).toBeGreaterThan(LAT);
    expect(Math.abs(lon - LON)).toBeLessThan(1e-6);
    // 10 kn for 30 s ≈ 154 m ≈ 0.00139° of latitude.
    expect(lat - LAT).toBeCloseTo(154.3 / 111_320, 4);
  });

  it("projects east along course 90", () => {
    const [lon, lat] = deadReckon(LAT, LON, 90, 10, 30);
    expect(lon).toBeGreaterThan(LON);
    expect(Math.abs(lat - LAT)).toBeLessThan(1e-5);
  });

  it("caps speculation for stale fixes (dark vessels stop, not sail inland)", () => {
    const atCap = deadReckon(LAT, LON, 0, 10, 60);
    const wayPast = deadReckon(LAT, LON, 0, 10, 3600);
    expect(wayPast).toEqual(atCap);
  });

  it("ignores negative elapsed time (clock skew)", () => {
    expect(deadReckon(LAT, LON, 0, 10, -30)).toEqual([LON, LAT]);
  });

  it("writes into the provided scratch array without allocating", () => {
    const out = deadReckon(LAT, LON, 0, 10, 30, DR_SCRATCH);
    expect(out).toBe(DR_SCRATCH);
    const [lon1, lat1] = [out[0], out[1]];
    // A second call reuses the same array — values are consumed synchronously.
    const out2 = deadReckon(LAT + 1, LON + 1, 180, 10, 30, DR_SCRATCH);
    expect(out2).toBe(DR_SCRATCH);
    expect(out2[1]).not.toBeCloseTo(lat1, 6);
    void lon1;
  });
});
