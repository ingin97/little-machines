import { drivingSurfaces, type DrivingSurface } from "./drivingSurfaces.ts";
import { sampleRoadSpline, type RoadKnot, type RoadVector } from "./roadSpline.ts";

export type WorldPoint = { x: number; z: number };
export type RoadDefinition = {
  id: string;
  knots: RoadKnot[];
  surface: DrivingSurface;
  from: string;
  to: string;
  structure?: "ramp";
};

export type WorldDefinition = {
  version: 1;
  id: string;
  name: string;
  generation?: { preset: string; version: number; seed: string };
  terrain: {
    halfExtent: number;
    shape?: "canyon";
    relief: number;
    phase: number;
    surface: DrivingSurface;
    flatRadius: number;
    zones: { x: number; z: number; radius: number; surface: DrivingSurface }[];
  };
  junctions: { id: string; position: RoadVector }[];
  roads: RoadDefinition[];
  bridges: { road: string; x: number; z: number; radius: number }[];
  tunnels: { x: number; y: number; z: number; length: number; width: number; height: number }[];
  attractions: {
    football: RoadVector;
    bowling: RoadVector;
    stars: RoadVector[];
  };
  landmarks: { x: number; z: number; height: number; kind: "peak" | "tower" | "arch" }[];
  scenery?: (WorldPoint & { kind: "pine" | "cactus" | "rock"; scale: number })[];
  spawn: RoadVector & { heading: number };
};

export const minimumRoadClearance = .04;
export const roadSpacing = 1.5;
export const roadBands = [-1, -.75, -.5, -.25, 0, .25, .5, .75, 1] as const;
export const knownSurface = (value: unknown): value is DrivingSurface =>
  typeof value === "string" && Object.hasOwn(drivingSurfaces, value);

export function sampleWorldRoads(world: WorldDefinition) {
  let count = 0;
  return world.roads.map((road) => {
    const rows = sampleRoadSpline(road.knots, roadSpacing, true);
    count += rows.length;
    if (count > 3_500) throw new Error(`Road "${road.id}" exceeds the world budget of 3,500 road samples`);
    return { road, rows };
  });
}

export function terrainSurface(world: WorldDefinition, { x, z }: WorldPoint) {
  return world.terrain.zones.find((zone) => (x - zone.x) ** 2 + (z - zone.z) ** 2 <= zone.radius ** 2)?.surface
    ?? world.terrain.surface;
}

export function canonicalWorldDefinition(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalWorldDefinition).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalWorldDefinition(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export type WorldIdentity = { id: string; hash: string };
// SHA-256 of the canonical legacy world reference {"id":"classic","version":1}.
export const classicWorldIdentity: WorldIdentity = {
  id: "classic@1", hash: "08b9cbd60f9c22ef0dc2e2eb4716c541abaf227d50e5392f797054546b3a88a2",
};

export async function definitionIdentity(world: WorldDefinition): Promise<WorldIdentity> {
  const generation = world.generation;
  const id = generation ? `${generation.preset}@${generation.version}:${generation.seed}` : `${world.id}@${world.version}`;
  const bytes = new TextEncoder().encode(canonicalWorldDefinition(world));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return { id, hash: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") };
}

export function sameWorld(expected: WorldIdentity, candidate: unknown): boolean {
  if (!candidate || typeof candidate !== "object") return false;
  const { id, hash } = candidate as Partial<WorldIdentity>;
  return id === expected.id && hash === expected.hash;
}
