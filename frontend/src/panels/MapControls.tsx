import {
  Plus,
  Minus,
  Compass,
  Maximize2,
  Box,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface MapControlsProps {
  onZoom: (delta: number) => void;
  onPitch: (delta: number) => void;
  onResetNorth: () => void;
  onFit: () => void;
  is3D: boolean;
  onToggle3D: () => void;
}

const PITCH_STEP = 12; // degrees per tilt click

/** Fixed map zoom / tilt / orientation controls (bottom-right, not draggable). */
export function MapControls({
  onZoom,
  onPitch,
  onResetNorth,
  onFit,
  is3D,
  onToggle3D,
}: MapControlsProps) {
  return (
    <div className="pointer-events-auto absolute bottom-4 right-4 z-30 flex flex-col gap-1.5 animate-fade-in">
      <div className="glass flex flex-col overflow-hidden">
        <ControlButton label="Zoom in" onClick={() => onZoom(1)}>
          <Plus className="h-4 w-4" />
        </ControlButton>
        <div className="h-px bg-foreground/10" />
        <ControlButton label="Zoom out" onClick={() => onZoom(-1)}>
          <Minus className="h-4 w-4" />
        </ControlButton>
      </div>
      <div className="glass flex flex-col overflow-hidden">
        <ControlButton label="Tilt up (more 3D)" onClick={() => onPitch(PITCH_STEP)}>
          <ChevronUp className="h-4 w-4" />
        </ControlButton>
        <div className="h-px bg-foreground/10" />
        <ControlButton label="Tilt down (flatter)" onClick={() => onPitch(-PITCH_STEP)}>
          <ChevronDown className="h-4 w-4" />
        </ControlButton>
      </div>
      <div className="glass flex flex-col overflow-hidden">
        <ControlButton
          label={is3D ? "Switch to 2D view" : "Switch to 3D view"}
          active={is3D}
          onClick={onToggle3D}
        >
          <Box className="h-4 w-4" />
        </ControlButton>
        <div className="h-px bg-foreground/10" />
        <ControlButton label="Reset north & tilt" onClick={onResetNorth}>
          <Compass className="h-4 w-4" />
        </ControlButton>
        <div className="h-px bg-foreground/10" />
        <ControlButton label="Fit to region" onClick={onFit}>
          <Maximize2 className="h-4 w-4" />
        </ControlButton>
      </div>
    </div>
  );
}

function ControlButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Hint label={label} side="left">
      <button
        aria-label={label}
        onClick={onClick}
        className={cn(
          "grid h-9 w-9 place-items-center transition-colors active:bg-foreground/15",
          active
            ? "bg-primary/15 text-primary hover:bg-primary/20"
            : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
        )}
      >
        {children}
      </button>
    </Hint>
  );
}
