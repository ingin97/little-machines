import type { DrivingSurface } from "./drivingSurfaces.ts";
import { circuitArc, elevatedHighway, figureEight, mountainDescent, mountainSpiral, roadKnot, scenicBypass, switchback } from "./roadMotifs.ts";
import type { RoadKnot, RoadVector } from "./roadSpline.ts";
import type { RoadDefinition, WorldDefinition } from "./worldDefinition.ts";
import { seededRandom } from "./worldGeneratorV1.ts";
import { validateWorld } from "./worldValidation.ts";

export const profiles = {
  "mountain-expedition": { name: "Fjellekspedisjonen" },
  "sky-highway": { name: "Himmelveiene" },
  "canyon-adventure": { name: "Kløfteventyret" },
  "rollercoaster-park": { name: "Berg-og-dalbanen" },
} as const;

type Profile = {
  name: string;
  surface: DrivingSurface;
  relief: number;
  circuitRise: number;
  mountain: number;
  figure: number;
  highway: number;
  coaster: boolean;
};

const mountains: Profile = { name: "Fjellheimen", surface: "ice", relief: 52, circuitRise: 12, mountain: .94, figure: .28, highway: .8, coaster: false };
const canyon: Profile = { name: "Ørkenkløfta", surface: "sand", relief: 35, circuitRise: 7, mountain: .65, figure: .38, highway: .93, coaster: false };
const green: Profile = { name: "Bygda", surface: "grass", relief: 17, circuitRise: 5, mountain: .45, figure: .62, highway: .65, coaster: false };
const config = {
  alpine: mountains,
  desert: canyon,
  countryside: green,
  "mountain-expedition": { ...mountains, ...profiles["mountain-expedition"], mountain: 1, relief: 59, circuitRise: 15 },
  "sky-highway": { ...green, ...profiles["sky-highway"], figure: 1, highway: 1, circuitRise: 10 },
  "canyon-adventure": { ...canyon, ...profiles["canyon-adventure"], mountain: .86, highway: 1 },
  "rollercoaster-park": { ...green, ...profiles["rollercoaster-park"], figure: .85, coaster: true },
} satisfies Record<string, Profile>;

function buildLayout(preset: keyof typeof config, seed: string, attempt: number, omitDescent = false): WorldDefinition {
  const profile: Profile = config[preset];
  const random = seededRandom(`v2:${preset}:${attempt === 3 ? "fallback" : seed}:${attempt}`);
  const pick = (probability: number) => random() < probability;
  const fallback = attempt === 3;
  const useMountain = pick(profile.mountain) || fallback;
  const useFigure = (!fallback || preset === "sky-highway") && (pick(profile.figure) || !useMountain);
  const useHighway = pick(profile.highway) || fallback;
  const useSwitchbacks = useMountain && pick(.34) && preset !== "mountain-expedition" && !fallback;
  const useDescent = useMountain && !useSwitchbacks && !fallback && pick(.64) && !omitDescent;
  const useBypass = !fallback && pick(.43);
  const useJump = pick(.78);
  const useHalfpipe = profile.coaster || pick(.38);
  const level = .18, centerX = -36, halfX = 111 + Math.floor(random() * 9), halfZ = 130 + Math.floor(random() * 17);
  const phase = Math.round(random() * 600) / 100;
  const roads: RoadDefinition[] = [];
  const bridges: WorldDefinition["bridges"] = [];
  const points = new Map<string, RoadVector>();
  const add = (id: string, from: string, to: string, surface: DrivingSurface, knots: RoadKnot[], structure?: RoadDefinition["structure"]) => {
    points.set(from, knots[0].position);
    points.set(to, knots.at(-1)!.position);
    roads.push({ id, from, to, surface, knots, ...(structure ? { structure } : {}) });
  };
  const straight = (id: string, from: string, to: string, a: RoadVector, b: RoadVector, surface: DrivingSurface = "asphalt") => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    const heading = { x: dx / length, y: 0, z: dz / length };
    add(id, from, to, surface, [roadKnot(a, heading, 7), roadKnot(b, heading, 7)]);
  };

  const hubs = ["south", "east", "north", "west"];
  for (const [i, from] of hubs.entries()) {
    const rise = profile.circuitRise * (.6 + random() * .4);
    const knots = circuitArc(centerX, halfX, halfZ, level, i, rise, .12 + random() * .1);
    add(`circuit-${from}`, from, hubs[(i + 1) % hubs.length], "asphalt", knots);
  }
  const south = points.get("south")!, north = points.get("north")!;
  const east = points.get("east")!, west = points.get("west")!;
  const plaza = { x: centerX, y: level, z: 0 };
  straight("avenue-south", "south", "plaza", south, plaza);
  straight("avenue-north", "plaza", "north", plaza, north);

  if (useHighway) {
    const knots = elevatedHighway(centerX, level, halfX, 24 + Math.floor(random() * 7));
    add("sky-crossing", "west", "east", "asphalt", knots, "deck");
    bridges.push({ road: "sky-crossing", x: centerX, z: 0, radius: 44 });
  }
  if (useBypass) {
    add("scenic-bypass", "south", "north", profile.surface === "sand" ? "sand" : "asphalt",
      scenicBypass(centerX, halfZ, level, 43));
  }
  if (useFigure) {
    const knots = figureEight(177, level, 15 + Math.floor(random() * 3), .24);
    straight("figure-access", "east", "figure", east, knots[0].position);
    add("figure-eight", "figure", "figure", profile.surface === "ice" ? "asphalt" : profile.surface, knots, "deck");
  }
  if (useMountain) {
    const start = { x: -193, y: level, z: 0 };
    const rise = profile.relief * .8 + 12;
    const knots = useSwitchbacks
      ? switchback(start, pick(.5) ? 1 : -1, Math.min(rise, 31))
      : mountainSpiral(-236, 43, level, useDescent || !pick(.55) ? 2.25 : 2, Math.min(60, Math.max(29, rise)), useDescent || pick(.5) ? 1 : -1);
    straight("mountain-access", "west", "mountain", west, knots[0].position);
    add(useSwitchbacks ? "switchbacks" : "summit-spiral", "mountain", "summit",
      profile.surface === "ice" ? "magnetic" : "asphalt", knots, "deck");
    if (useDescent) {
      const descent = mountainDescent(knots.at(-1)!, north);
      add("summit-descent", "summit", "north", profile.surface === "ice" ? "ice" : "asphalt", descent, "deck");
      bridges.push({ road: "summit-descent", x: -246, z: 158, radius: 40 });
    }
  }
  if (useJump) {
    const end = { x: south.x, y: profile.coaster ? 10 : 7, z: south.z - 57 };
    const direction = { x: 0, y: 0, z: -1 };
    add("launch-ramp", "south", "jump", "asphalt", [roadKnot(south, direction, 7),
      roadKnot({ ...south, z: south.z - 24 }, direction, 7), roadKnot(end, { ...direction, y: .35 }, 6)], "ramp");
  }
  if (useHalfpipe && !useDescent) {
    const end = { x: north.x, y: level, z: north.z + 65 };
    const direction = { x: 0, y: 0, z: 1 };
    add("halfpipe", "north", "halfpipe", "asphalt", [roadKnot(north, direction, 7),
      { ...roadKnot({ ...north, z: north.z + 31 }, direction, 7), crown: 3.6 }, roadKnot(end, direction, 7)]);
  }
  if (profile.coaster) {
    // The lower avenue stays open beneath a ride with repeated crests.
    const knots = elevatedHighway(centerX, level, halfX, 19, 24).map((knot, i, list) => {
      const t = i / (list.length - 1);
      const wave = 1.2 * Math.sin(t * Math.PI) ** 2 * (1 - Math.cos(t * 8 * Math.PI));
      const slope = (1.2 * Math.PI * Math.sin(2 * t * Math.PI) * (1 - Math.cos(t * 8 * Math.PI))
        + 9.6 * Math.PI * Math.sin(t * Math.PI) ** 2 * Math.sin(t * 8 * Math.PI)) / (2 * halfX);
      return roadKnot({ ...knot.position, y: knot.position.y + wave }, { ...knot.tangent, y: knot.tangent.y + slope }, knot.halfWidth, knot.bank);
    });
    // Replace the expressway in this profile so the two decks never overlap.
    const index = roads.findIndex(({ id }) => id === "sky-crossing");
    if (index >= 0) roads.splice(index, 1);
    bridges.length = 0;
    add("coaster", "west", "east", "asphalt", knots, "deck");
    bridges.push({ road: "coaster", x: centerX, z: 0, radius: 37 });
  }
  const scenery: NonNullable<WorldDefinition["scenery"]> = Array.from({ length: 40 }, (_, i) => {
    const angle = random() * 2 * Math.PI, radius = 65 + random() * 220;
    return { x: Math.round(Math.cos(angle) * radius), z: Math.round(Math.sin(angle) * radius),
      scale: .75 + Math.round(random() * 7) / 10, kind: i % 5 === 0 ? "rock" : profile.surface === "sand" ? "cactus" : "pine" };
  });
  const stars = [south, north, east, west, points.get("summit"), points.get("figure")]
    .filter((point): point is RoadVector => point !== undefined).map((point) => ({ ...point, y: point.y + 1.35 }));
  return {
    version: 1, id: preset, name: profile.name, generation: { preset, version: 2, seed },
    terrain: { halfExtent: 305, relief: profile.relief, phase, flatRadius: 62, surface: profile.surface,
      ...(profile.surface === "sand" ? { shape: "canyon" } : {}),
      ...(useMountain && !useSwitchbacks ? { peaks: [{ x: -236, z: 0, radius: 51, height: 35 }] } : {}),
      zones: [{ x: centerX + 27, z: -34, radius: 16, surface: profile.surface === "grass" ? "mud" : profile.surface }] },
    junctions: Array.from(points, ([id, position]) => ({ id, position })), roads, bridges,
    tunnels: preset === "countryside" ? [{ x: centerX, z: -75, y: level, width: 16, height: 5.5, length: 24 }] : [],
    attractions: { football: { x: centerX + 21, z: 20, y: 0 }, bowling: { x: centerX - 21, z: -21, y: 0 }, stars },
    landmarks: [{ x: centerX + 25, z: 40, height: 16, kind: profile.surface === "sand" ? "arch" : "tower" },
      ...(useMountain && !useSwitchbacks ? [{ x: -236, z: 0, height: 16, kind: "peak" as const }] : []),
      ...(useFigure ? [{ x: 177, z: 75, height: 16, kind: "tower" as const }] : [])],
    scenery, spawn: { x: centerX, y: 1.05, z: -21, heading: 0 },
  };
}

export function generateV2(preset: keyof typeof config, seed: string) {
  const failures: string[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const world = buildLayout(preset, seed, attempt);
    const errors = validateWorld(world);
    if (!errors.length) return world;
    if (world.roads.some(({ id }) => id === "summit-descent") && errors.some((error) => error.includes("summit-descent"))) {
      const repaired = buildLayout(preset, seed, attempt, true);
      if (!validateWorld(repaired).length) return repaired;
    }
    failures.push(`attempt ${attempt + 1}: ${errors.join("; ")}`);
  }
  throw new Error(`No valid v2 ${preset} world for seed "${seed}": ${failures.join("\n  ")}`);
}
