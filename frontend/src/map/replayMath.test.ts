import { describe, it, expect } from "vitest";
import { speedColor, interpolate, bearing, SPEED_RAMP, SPEED_MAX_KN } from "./replayMath";
import type { ReplayTrack } from "@/types";

describe("speedColor", () => {
  it("returns the first stop at/below zero", () => {
    expect(speedColor(0)).toEqual(SPEED_RAMP[0][1]);
    expect(speedColor(null)).toEqual(SPEED_RAMP[0][1]);
    expect(speedColor(-5)).toEqual(SPEED_RAMP[0][1]);
  });

  it("clamps above the max knot to the last stop", () => {
    const last = SPEED_RAMP[SPEED_RAMP.length - 1][1];
    expect(speedColor(SPEED_MAX_KN)).toEqual(last);
    expect(speedColor(999)).toEqual(last);
  });

  it("interpolates between stops (midpoint of 0→2 kn)", () => {
    const [a, b] = [SPEED_RAMP[0][1], SPEED_RAMP[1][1]];
    const mid = speedColor(1); // halfway between the 0 and 2 kn stops
    expect(mid[0]).toBe(Math.round((a[0] + b[0]) / 2));
    expect(mid[1]).toBe(Math.round((a[1] + b[1]) / 2));
    expect(mid[2]).toBe(Math.round((a[2] + b[2]) / 2));
  });
});

function track(path: ReplayTrack["path"]): ReplayTrack {
  return { mmsi: 1, name: null, ship_type: 70, path };
}

describe("interpolate", () => {
  const t = track([
    [0, 50, 100, 10, 90, 90],
    [1, 50, 200, 10, 90, 90],
  ]);

  it("returns null before the track starts and after it ends", () => {
    expect(interpolate(t, 50)).toBeNull();
    expect(interpolate(t, 250)).toBeNull();
  });

  it("lerps position to the midpoint in time", () => {
    const h = interpolate(t, 150)!;
    expect(h).not.toBeNull();
    expect(h.position[0]).toBeCloseTo(0.5, 6);
    expect(h.position[1]).toBeCloseTo(50, 6);
  });

  it("marks vessels under way as moving and uses course for the angle", () => {
    const h = interpolate(t, 150)!;
    expect(h.moving).toBe(true);
    expect(h.angle).toBe(90); // cog from the bracketing fix
  });

  it("treats a slow vessel as stationary and falls back to segment bearing", () => {
    const slow = track([
      [0, 0, 100, 0, null, null],
      [0, 1, 200, 0, null, null], // due north
    ]);
    const h = interpolate(slow, 150)!;
    expect(h.moving).toBe(false);
    expect(h.angle).toBeCloseTo(0, 1); // northward
  });

  it("binary-searches the correct segment in a multi-point track", () => {
    const multi = track([
      [0, 0, 0, 5, 90, 90],
      [10, 0, 100, 5, 90, 90],
      [20, 0, 200, 5, 90, 90],
      [30, 0, 300, 5, 90, 90],
    ]);
    const h = interpolate(multi, 250)!; // between the 3rd and 4th points
    expect(h.position[0]).toBeCloseTo(25, 6);
  });
});

describe("bearing", () => {
  it("is ~90° due east and ~0° due north", () => {
    expect(bearing(0, 0, 1, 0)).toBeCloseTo(90, 1);
    expect(bearing(0, 0, 0, 1)).toBeCloseTo(0, 1);
  });
});
