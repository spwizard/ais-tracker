// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useReplayAlerts } from "./useReplayAlerts";
import type { ReplayWindow } from "./useReplay";
import type { Alert } from "@/types";

function jsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) } as Response;
}

function alert(over: Partial<Alert>): Alert {
  return {
    id: 0, ts: 100, category: "geofence", kind: "enter", title: null,
    mmsi: 1, name: null, mmsi_b: null, name_b: null, lat: 50, lon: 0,
    fence_id: null, fence_name: null, fence_category: null, detail: {}, ...over,
  };
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("useReplayAlerts", () => {
  it("returns [] and does not fetch for a null window", () => {
    const { result } = renderHook(() => useReplayAlerts(null));
    expect(result.current).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps only alerts within the time window and bbox", async () => {
    const within = alert({ id: 1, ts: 1500, lat: 50, lon: 0 });
    const afterEnd = alert({ id: 2, ts: 2500, lat: 50, lon: 0 }); // ts > end
    const outsideBox = alert({ id: 3, ts: 1500, lat: 60, lon: 20 }); // outside bbox
    const noCoords = alert({ id: 4, ts: 1500, lat: null, lon: null });
    fetchMock.mockResolvedValue(
      jsonResponse({ alerts: [within, afterEnd, outsideBox, noCoords] }),
    );

    const win: ReplayWindow = { start: 1000, end: 2000, bbox: [-6, 49, 2, 51] };
    const { result } = renderHook(() => useReplayAlerts(win));
    await waitFor(() => expect(result.current.length).toBeGreaterThan(0));
    expect(result.current.map((a) => a.id)).toEqual([1]);
  });

  it("requests since=start", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ alerts: [] }));
    const sinceWin: ReplayWindow = { start: 1234.7, end: 2000 };
    renderHook(() => useReplayAlerts(sinceWin));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toContain("since=1234");
  });
});
