// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useReplay, windowKey, type ReplayWindow } from "./useReplay";

function jsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) } as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const win: ReplayWindow = { start: 1000, end: 2000 };

describe("useReplay", () => {
  it("does not fetch and stays empty for a null window", () => {
    const { result } = renderHook(() => useReplay(null));
    expect(result.current).toEqual({ tracks: [], span: null, loading: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches and returns tracks + span", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ tracks: [{ mmsi: 1, path: [] }], span: [1000, 1800] }),
    );
    const { result } = renderHook(() => useReplay(win));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tracks).toHaveLength(1);
    expect(result.current.span).toEqual([1000, 1800]);
  });

  it("sends start, end and bbox as query params", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ tracks: [], span: null }));
    // Stable window object — a fresh literal each render would re-trigger the
    // window-keyed effect and loop (App holds this in state, so it's stable there).
    const bboxWin: ReplayWindow = { start: 1000.4, end: 2000.6, bbox: [-6, 49, 2, 51] };
    renderHook(() => useReplay(bboxWin));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("start=1000"); // floored
    expect(url).toContain("end=2001"); // ceiled
    expect(url).toContain("bbox=-6%2C49%2C2%2C51");
  });

  it("ignores a stale response when the window changes mid-flight", async () => {
    let resolveFirst!: () => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveFirst = () => res(jsonResponse({ tracks: [{ mmsi: 111 }], span: [1, 2] }));
        }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ tracks: [{ mmsi: 222 }], span: [3, 4] }));

    const { result, rerender } = renderHook(({ w }) => useReplay(w), {
      initialProps: { w: win },
    });
    rerender({ w: { start: 5000, end: 6000 } }); // supersedes the first request
    await waitFor(() => expect(result.current.tracks).toEqual([{ mmsi: 222 }]));

    resolveFirst(); // the stale first response lands late
    await Promise.resolve();
    expect(result.current.tracks).toEqual([{ mmsi: 222 }]); // not overwritten
  });

  it("does not refetch when a fresh window object has identical values", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ tracks: [], span: null }));
    // A new object literal on every render — pre-hardening this looped forever.
    const { rerender } = renderHook(() => useReplay({ start: 1000, end: 2000 }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rerender();
    rerender();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("windowKey", () => {
  it("is null for a null window", () => {
    expect(windowKey(null)).toBeNull();
  });
  it("is equal for identical values, different across changes", () => {
    expect(windowKey({ start: 1, end: 2 })).toBe(windowKey({ start: 1, end: 2 }));
    expect(windowKey({ start: 1, end: 2, bbox: [1, 2, 3, 4] })).not.toBe(
      windowKey({ start: 1, end: 2 }),
    );
    expect(windowKey({ start: 1, end: 2 })).not.toBe(windowKey({ start: 1, end: 9 }));
  });
});
