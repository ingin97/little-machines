import type RAPIER from "@dimforge/rapier3d-compat";

export const drivingSurfaces = {
  asphalt:  { traction: 1, lateral: 1, rolling: .15, braking: 1, acceleration: 1, adhesion: 0, color: "#596477", particles: "#adb4be", interval: .30, rollHz: 780, skidHz: 2200 },
  grass:    { traction: .84, lateral: .78, rolling: .46, braking: .85, acceleration: .89, adhesion: 0, color: "#a4d467", particles: "#c8bf8a", interval: .10, rollHz: 420, skidHz: 950 },
  sand:     { traction: .72, lateral: .67, rolling: .90, braking: .79, acceleration: .73, adhesion: 0, color: "#f3ca84", particles: "#e6cc98", interval: .054, rollHz: 510, skidHz: 1200 },
  mud:      { traction: .62, lateral: .60, rolling: 1.55, braking: .72, acceleration: .59, adhesion: 0, color: "#735641", particles: "#85624a", interval: .063, rollHz: 260, skidHz: 570 },
  ice:      { traction: .29, lateral: .14, rolling: .10, braking: .32, acceleration: .77, adhesion: 0, color: "#a3dced", particles: "#d7f0ff", interval: .19, rollHz: 1100, skidHz: 3300 },
  magnetic: { traction: 1.16, lateral: 1.22, rolling: .20, braking: 1.12, acceleration: 1, adhesion: 9, color: "#537a83", particles: "#6fcadb", interval: .22, rollHz: 630, skidHz: 1650 },
};

export type DrivingSurface = keyof typeof drivingSurfaces;
type ContactSurface = DrivingSurface | ((point: RAPIER.Vector) => DrivingSurface);

const surfacesByWorld = new WeakMap<RAPIER.World, Map<number, ContactSurface>>();

export function setColliderSurface(world: RAPIER.World, collider: RAPIER.Collider, surface: ContactSurface) {
  let surfaces = surfacesByWorld.get(world);
  if (!surfaces) {
    surfaces = new Map();
    surfacesByWorld.set(world, surfaces);
  }
  surfaces.set(collider.handle, surface);
}

export function contactSurface(world: RAPIER.World, collider: RAPIER.Collider | null, point: RAPIER.Vector | null): DrivingSurface {
  const surface = collider && surfacesByWorld.get(world)?.get(collider.handle);
  return typeof surface === "function" ? (point ? surface(point) : "asphalt") : surface || "asphalt";
}
