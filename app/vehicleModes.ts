export type VehicleMode = "tractor" | "excavator" | "dumper" | "wheel-loader";

export type VehicleConfig = {
  id: VehicleMode;
  name: string;
  icon: string;
  color: string;
  scene: "field" | "construction";
  speed: number;
  description: string;
};

export const VEHICLES: readonly VehicleConfig[] = [
  { id: "tractor", name: "Traktor", icon: "🚜", color: "#ef7d32", scene: "field", speed: 8, description: "Klipp det grønne jordet" },
  { id: "excavator", name: "Gravemaskin", icon: "🏗️", color: "#f4b52f", scene: "construction", speed: 4.6, description: "Grav i den store gropa" },
  { id: "dumper", name: "Dumper", icon: "🚚", color: "#e6a52e", scene: "construction", speed: 7, description: "Frakt jord til tippeplassen" },
  { id: "wheel-loader", name: "Hjullaster", icon: "🚜", color: "#f3c33b", scene: "construction", speed: 6, description: "Flytt jord med skuffen" },
] as const;

export const vehicleConfig = (mode: VehicleMode) => VEHICLES.find((vehicle) => vehicle.id === mode) ?? VEHICLES[0];

export function isVehicleMode(value: string | null): value is VehicleMode {
  return VEHICLES.some((vehicle) => vehicle.id === value);
}
