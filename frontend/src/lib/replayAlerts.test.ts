import { describe, it, expect } from "vitest";
import { alertsAt } from "./replayAlerts";
import type { Alert } from "@/types";

function alert(over: Partial<Alert>): Alert {
  return {
    id: 0,
    ts: 100,
    category: "geofence",
    kind: "enter",
    title: null,
    mmsi: 1,
    name: null,
    mmsi_b: null,
    name_b: null,
    lat: 50,
    lon: 0,
    fence_id: null,
    fence_name: null,
    fence_category: null,
    detail: {},
    ...over,
  };
}

describe("alertsAt", () => {
  const a = alert({ id: 1, lat: 50, lon: 0, ts: 100 });
  const sameSpot = alert({ id: 2, lat: 50.005, lon: 0.005, ts: 90 });
  const farAway = alert({ id: 3, lat: 51, lon: 2, ts: 90 });
  const future = alert({ id: 4, lat: 50, lon: 0, ts: 200 });
  const all = [a, sameSpot, farAway, future];

  it("groups alerts at the same spot and finds the target index", () => {
    const { group, index } = alertsAt(all, a, 150);
    const ids = group.map((x) => x.id).sort();
    expect(ids).toEqual([1, 2]); // a + sameSpot; farAway excluded, future excluded by ts
    expect(group[index].id).toBe(1);
  });

  it("excludes alerts that haven't fired yet (ts > maxTs)", () => {
    const { group } = alertsAt(all, a, 150);
    expect(group.some((x) => x.id === 4)).toBe(false);
  });

  it("includes a future alert once the scrub time passes it", () => {
    const { group } = alertsAt(all, a, 250);
    expect(group.map((x) => x.id).sort()).toEqual([1, 2, 4]);
  });

  it("respects the radius (far alert never groups)", () => {
    const { group } = alertsAt(all, a, 1000);
    expect(group.some((x) => x.id === 3)).toBe(false);
  });

  it("falls back to just the target when it has no coordinates", () => {
    const noCoords = alert({ id: 5, lat: null, lon: null });
    const { group, index } = alertsAt(all, noCoords, 1000);
    expect(group).toEqual([noCoords]);
    expect(index).toBe(0);
  });
});
