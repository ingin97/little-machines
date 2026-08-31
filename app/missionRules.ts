import type { VehicleMode } from "./vehicleModes";

export type ConstructionMode = Exclude<VehicleMode, "tractor">;

export function missionStepCompleted(mode: ConstructionMode, wasLoaded: boolean) {
  return wasLoaded;
}

export function advanceMission(progress: number, mode: ConstructionMode, wasLoaded: boolean) {
  return missionStepCompleted(mode, wasLoaded) ? Math.min(3, progress + 1) : progress;
}
