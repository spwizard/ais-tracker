// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AlertCard } from "./AlertCard";
import type { Alert } from "@/types";

afterEach(cleanup);

function alert(over: Partial<Alert>): Alert {
  return {
    id: 0, ts: 1_700_000_000, category: "risk", kind: "rendezvous", title: null,
    mmsi: 111, name: "ALPHA", mmsi_b: 222, name_b: "BRAVO", lat: 50, lon: 0,
    fence_id: null, fence_name: null, fence_category: null, detail: {}, ...over,
  };
}

describe("AlertCard", () => {
  it("renders the alert title and both rendezvous vessels", () => {
    render(
      <AlertCard
        alerts={[alert({ id: 1, detail: { dist_nm: 0.3 } })]}
        index={0}
        onIndex={vi.fn()}
        onSelectVessel={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Rendezvous")).toBeTruthy();
    expect(screen.getByText("ALPHA")).toBeTruthy();
    expect(screen.getByText("BRAVO")).toBeTruthy();
    expect(screen.getByText(/0\.3 nm apart/)).toBeTruthy();
  });

  it("calls onSelectVessel with the mmsi when a vessel row is clicked", () => {
    const onSelectVessel = vi.fn();
    render(
      <AlertCard
        alerts={[alert({ id: 1, mmsi: 111, name: "ALPHA", kind: "enter", category: "geofence", mmsi_b: null, name_b: null })]}
        index={0}
        onIndex={vi.fn()}
        onSelectVessel={onSelectVessel}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("ALPHA"));
    expect(onSelectVessel).toHaveBeenCalledWith(111);
  });

  it("pages through a cluster with the chevrons", () => {
    const onIndex = vi.fn();
    const group = [
      alert({ id: 1, kind: "enter", category: "geofence", mmsi_b: null }),
      alert({ id: 2, kind: "dwell", category: "geofence", mmsi_b: null }),
      alert({ id: 3, kind: "exit", category: "geofence", mmsi_b: null }),
    ];
    render(
      <AlertCard alerts={group} index={1} onIndex={onIndex} onSelectVessel={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText("2 of 3 here")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Next alert"));
    expect(onIndex).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByLabelText("Previous alert"));
    expect(onIndex).toHaveBeenCalledWith(0);
  });

  it("does not show paging for a single alert", () => {
    render(
      <AlertCard
        alerts={[alert({ id: 1, mmsi_b: null })]}
        index={0}
        onIndex={vi.fn()}
        onSelectVessel={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Next alert")).toBeNull();
  });

  it("calls onClose from the close button", () => {
    const onClose = vi.fn();
    render(
      <AlertCard alerts={[alert({ id: 1, mmsi_b: null })]} index={0} onIndex={vi.fn()} onSelectVessel={vi.fn()} onClose={onClose} />,
    );
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});
