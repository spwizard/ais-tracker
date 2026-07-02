/**
 * London traffic-camera markers (TfL JamCams) — the "land" layer. Fixed points,
 * so no dead-reckoning; only shown once zoomed into London (below that they're a
 * meaningless cluster over the whole map). Available cameras glow amber; the
 * selected one brightens and grows.
 */
import { IconLayer } from "@deck.gl/layers";
import type { Camera } from "@/types";
import { getCameraIconAtlas, CAMERA_ICON_MAPPING } from "./cameraIcons";

// Below this zoom the ~880 London cameras are just a blob — hide them.
export const CAMERA_MIN_ZOOM = 9;

export interface CameraLayerOptions {
  cameras: Camera[];
  zoom: number;
  selectedId: string | null;
  onClick: (c: Camera | null) => void;
}

export function buildCameraLayers(opts: CameraLayerOptions) {
  const { cameras, zoom, selectedId, onClick } = opts;
  if (zoom < CAMERA_MIN_ZOOM || cameras.length === 0) return [];

  return [
    new IconLayer<Camera>({
      id: "cameras",
      data: cameras,
      pickable: true,
      iconAtlas: getCameraIconAtlas(),
      iconMapping: CAMERA_ICON_MAPPING,
      getIcon: () => "cam",
      getPosition: (d) => [d.lon, d.lat],
      getColor: (d) =>
        d.id === selectedId
          ? [125, 211, 252, 255] // selected — bright cyan
          : d.available
            ? [251, 191, 36, 230] // live — amber
            : [148, 163, 184, 150], // offline — muted grey
      getSize: (d) => (d.id === selectedId ? 30 : 20),
      sizeUnits: "pixels",
      sizeMinPixels: 14,
      sizeMaxPixels: 36,
      onClick: (info) => onClick((info.object as Camera) ?? null),
      updateTriggers: {
        getColor: selectedId,
        getSize: selectedId,
      },
    }),
  ];
}
