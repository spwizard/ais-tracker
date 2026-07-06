import { describe, expect, it } from "vitest";
import { nearbyCameras, nextCameraAhead } from "./nearbyCameras";
import { compassLabel, compassOrder } from "./compass";
import type { Camera } from "@/types";

// At lat 51.5: ~111 m per 0.001° of latitude.
const BUS = { lat: 51.5, lon: -0.1, bearing: 0 }; // heading due north

function cam(id: string, dLat: number, dLon: number, view: string | null, available = true): Camera {
  return {
    id,
    name: id,
    lat: BUS.lat + dLat,
    lon: BUS.lon + dLon,
    view,
    image: "",
    video: "",
    available,
  } as Camera;
}

describe("nearbyCameras", () => {
  it("filters by radius and availability, sorts nearest-first", () => {
    const cams = [
      cam("near", 0.002, 0, null), // ~220m N
      cam("nearer", 0.001, 0, null), // ~110m N
      cam("far", 0.02, 0, null), // ~2.2km — outside 900m
      cam("offline", 0.001, 0, null, false),
    ];
    const out = nearbyCameras(BUS, cams);
    expect(out.map((c) => c.camera.id)).toEqual(["nearer", "near"]);
  });

  it("prefers cameras whose view faces the bus", () => {
    // Camera north of the bus looking SOUTH faces it; a slightly nearer one
    // looking north (away) should rank below thanks to the facing weight.
    const cams = [
      cam("away", 0.002, 0, "North"),
      cam("facing", 0.0025, 0, "South"),
    ];
    const out = nearbyCameras(BUS, cams);
    expect(out[0].camera.id).toBe("facing");
    expect(out[0].facing).toBe(true);
    expect(out[1].facing).toBe(false);
  });

  it("returns [] without a position", () => {
    expect(nearbyCameras({ lat: null, lon: null }, [cam("x", 0, 0, null)])).toEqual([]);
  });
});

describe("nextCameraAhead", () => {
  it("picks the nearest camera within ±55° of the heading", () => {
    const nearby = nearbyCameras(BUS, [
      cam("behind", -0.002, 0, null), // due south — behind a northbound bus
      cam("ahead", 0.003, 0.0005, null), // roughly north
    ]);
    expect(nextCameraAhead(BUS, nearby)).toBe("ahead");
  });

  it("returns null when nothing is ahead or heading is unknown", () => {
    const nearby = nearbyCameras(BUS, [cam("behind", -0.002, 0, null)]);
    expect(nextCameraAhead(BUS, nearby)).toBeNull();
    expect(nextCameraAhead({ ...BUS, bearing: null }, nearby)).toBeNull();
  });
});

describe("compass", () => {
  it("maps view strings to labels, unknowns last in sort order", () => {
    expect(compassLabel("North East")).toBe("NE");
    expect(compassLabel("WEST-twds Blackfriars")).toBe("W");
    expect(compassLabel("Zoom - Horse Guards Avenue")).toBe("");
    expect(compassOrder("North")).toBeLessThan(compassOrder("East"));
    expect(compassOrder("Zoom - x")).toBe(99);
  });
});
