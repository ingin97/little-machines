import type { DrivingSurface } from "./drivingSurfaces.ts";
import type { RoadKnot, RoadVector } from "./roadSpline.ts";
import type { RoadDefinition, WorldDefinition } from "./worldDefinition.ts";
import { validateWorldGeometry } from "./worldValidation.ts";

export const generatorVersion = 1;
export const defaultSeed = "2026";

export const presets = {
  alpine: { name: "Fjellheimen", relief: 29, rise: 27, spread: 108, bend: .29, ramp: 4, surface: "ice", pass: "magnetic", west: "asphalt", landmark: "peak" },
  desert: { name: "Ørkenkløfta", relief: 18, rise: 16, spread: 123, bend: .34, ramp: 7, surface: "sand", pass: "sand", west: "sand", landmark: "arch" },
  countryside: { name: "Bygda", relief: 9, rise: 9, spread: 94, bend: .12, ramp: 3, surface: "grass", pass: "asphalt", west: "asphalt", landmark: "tower" },
} as const;

export type Preset = keyof typeof presets;
export function isPreset(value: string): value is Preset {
  return Object.hasOwn(presets, value);
}

export function normalizeSeed(seed: string) {
  return seed.normalize("NFC").trim().slice(0, 64).toWellFormed() || defaultSeed;
}

export function seededRandom(seed: string) {
  let state = 2166136261;
  for (const character of seed) state = Math.imul(state ^ character.codePointAt(0)!, 16777619);
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function knot(x: number, y: number, z: number, tx: number, ty: number, tz: number, halfWidth = 5.4, bank = 0): RoadKnot {
  const round = (number: number) => Math.round(number * 1e5) / 1e5;
  return { position: { x: round(x), y: round(y), z: round(z) }, tangent: { x: round(tx), y: round(ty), z: round(tz) }, halfWidth, bank: round(bank) };
}

function layout(preset: Preset, seed: string, variation: number): WorldDefinition {
  const config = presets[preset];
  const random = seededRandom(seed);
  const spread = Math.round(config.spread + (random() - .5) * 18 * variation);
  const rise = Math.round(config.rise + (random() - .5) * 8 * variation);
  const north = 79 + Math.round(random() * 10 * variation);
  const bank = config.bend;
  const level = .18;
  const southPoint = { x: 0, y: level, z: -82 };
  const northPoint = { x: 0, y: level, z: north };
  const plaza = { x: 0, y: level, z: 0 };
  const roads: RoadDefinition[] = [];
  const junctions: WorldDefinition["junctions"] = [];
  function junction(id: string, position: RoadVector) { junctions.push({ id, position }); }
  function route(id: string, from: string, to: string, surface: DrivingSurface, knots: RoadKnot[], structure?: "ramp") {
    roads.push({ id, from, to, surface, knots, ...(structure ? { structure } : {}) });
  }
  junction("south", southPoint);
  junction("north", northPoint);
  junction("plaza", plaza);
  route("avenue-south", "south", "plaza", "asphalt", [knot(0, level, -82, 0, 0, 1, 7), knot(0, level, 0, 0, 0, 1, 7)]);
  const hasHalfpipe = preset === "countryside";
  const playZ = hasHalfpipe ? 63 : north;
  if (hasHalfpipe) junction("north-play", { x: 0, y: level, z: playZ });
  route("avenue-north", "plaza", hasHalfpipe ? "north-play" : "north", "asphalt",
    [knot(0, level, 0, 0, 0, 1, 7), knot(0, level, playZ, 0, 0, 1, 7)]);
  if (hasHalfpipe) {
    route("avenue-link", "north-play", "north", "asphalt", [knot(0, level, playZ, 0, 0, 1, 7), knot(0, level, north, 0, 0, 1, 7)]);
    junction("halfpipe", { x: 51, y: level, z: playZ });
    route("halfpipe", "north-play", "halfpipe", "asphalt", [
      knot(0, level, playZ, 1, 0, 0, 6), { ...knot(24, level, playZ, 1, 0, 0, 7), crown: 3.5 },
      knot(51, level, playZ, 1, 0, 0, 6),
    ]);
  }
  const westMid = { x: -spread, y: rise * .65, z: 4 };
  junction("west", westMid);
  route("west-climb", "south", "west", config.west, [
    knot(0, level, -82, -1, 0, 0), knot(-61, rise * .26, -83, -1, .15, 0, 5.4, bank),
    knot(-spread + 14, rise * .53, -54, -.49, .10, .88, 6.1, bank),
    knot(westMid.x, westMid.y, westMid.z, 0, 0, 1, 6.1),
  ]);
  route("west-descent", "west", "north", preset === "alpine" ? "ice" : config.west, [
    knot(westMid.x, westMid.y, westMid.z, 0, 0, 1, 6.1),
    knot(-spread + 10, rise, 57, .43, 0, .9, 6.1, bank),
    knot(-61, rise * .51, north + 19, .93, -.28, .20, 5.4, bank * .55),
    knot(0, level, north, 1, 0, 0),
  ]);

  const eastMid = { x: spread, y: rise * .49, z: -8 };
  junction("east", eastMid);
  route("east-cliff", "south", "east", "asphalt", [
    knot(0, level, -82, 1, 0, 0), knot(44, rise * .35, -96, .98, .13, 0, 5.4, -bank * .5),
    knot(spread - 32, rise * .62, -76, .7, 0, .7, 5.4, -bank),
    knot(eastMid.x, eastMid.y, eastMid.z, 0, 0, 1, 6),
  ]);
  route("east-return", "east", "north", "asphalt", [
    knot(eastMid.x, eastMid.y, eastMid.z, 0, 0, 1, 6),
    knot(spread - 17, rise * .38, 62, -.56, -.13, .82, 6, -bank),
    knot(46, rise * .08, north + 11, -.97, -.07, .2, 5.4, -bank * .5), knot(0, level, north, -1, 0, 0),
  ]);

  if (preset === "alpine") {
    const radius = 31;
    const centerX = spread + 53;
    const centerZ = eastMid.z - radius;
    const spiral = [knot(eastMid.x, eastMid.y, eastMid.z, 1, 0, 0, 6),
      knot(centerX, eastMid.y + 3, eastMid.z, 1, .09, 0, 6)];
    for (let i = 1; i <= 6; i++) {
      const angle = i * Math.PI / 4;
      spiral.push(knot(centerX + radius * Math.sin(angle), eastMid.y + 3 + i * 2.5, centerZ + radius * Math.cos(angle),
        Math.cos(angle), i === 6 ? 0 : .10, -Math.sin(angle), 6, -.21 * Math.sin(i * Math.PI / 6)));
    }
    junction("lookout", spiral[spiral.length - 1].position);
    route("spiral-pass", "east", "lookout", config.pass, spiral);
  }

  for (const [id, side, lift, length] of [["small-jump", -1, 1.45, 29], ["large-jump", 1, config.ramp, 40]] as const) {
    const end = { x: side * length, y: lift, z: 0 };
    junction(id, end);
    route(id, "plaza", id, side < 0 ? "asphalt" : config.pass, [
      knot(0, level, 0, side, 0, 0, 5),
      knot(side * 17, level, 0, side, 0, 0, 5),
      knot(end.x, end.y, end.z, side, side < 0 ? .25 : .40, 0, 5),
    ], "ramp");
  }

  const football = { x: 28, y: 0, z: 45 };
  const bowling = { x: -27, y: 0, z: 28 };
  const terrain = {
    ...(preset === "desert" ? { shape: "canyon" as const } : {}),
    halfExtent: 220, relief: config.relief, phase: variation === 0 ? 1.25 : Math.round(random() * 600) / 100,
    surface: config.surface, flatRadius: 63,
    zones: [
      { x: -48, z: -38, radius: 16, surface: preset === "countryside" ? "mud" : config.surface },
      { x: 30, z: 36, radius: 18, surface: "grass" },
      { x: -29, z: 28, radius: 13, surface: "asphalt" },
      { x: 48, z: -43, radius: 18, surface: preset === "alpine" ? "ice" : preset === "desert" ? "sand" : "grass" },
    ] satisfies WorldDefinition["terrain"]["zones"],
  };
  const scenery: NonNullable<WorldDefinition["scenery"]> = [];
  for (let i = 0; i < 40; i++) {
    const angle = random() * 2 * Math.PI;
    const distance = 118 + random() * 76;
    const x = Math.round(Math.cos(angle) * distance);
    const z = Math.round(Math.sin(angle) * distance);
    if (roads.some(({ knots }) => knots.some(({ position }) => Math.hypot(x - position.x, z - position.z) < 18))) continue;
    scenery.push({ x, z, scale: .7 + Math.round(random() * 10) / 10, kind: preset === "desert" ? i % 2 ? "rock" : "cactus" : i % 4 ? "pine" : "rock" });
  }
  for (const [x, z] of [[-14, 18], [15, 23], [-18, -45], [18, -31]]) {
    scenery.push({ x, z, scale: 1.15, kind: preset === "desert" ? "cactus" : "pine" });
  }
  return {
    version: 1, id: preset, name: config.name, generation: { preset, seed, version: generatorVersion },
    terrain, junctions, roads, scenery,
    bridges: [{ road: "east-cliff", x: spread - 32, z: -76, radius: 30 }],
    tunnels: preset === "countryside" ? [{ x: 0, y: level, z: -40, length: 21, width: 15.4, height: 5.5 }] : [],
    attractions: {
      football, bowling,
      stars: [{ x: -25, y: 1.4, z: 19 }, { x: 0, y: 1.53, z: 32 },
        { x: westMid.x, y: westMid.y + 1.35, z: westMid.z }, { x: eastMid.x, y: eastMid.y + 1.35, z: eastMid.z }],
    },
    landmarks: [
      { x: -spread - 21, z: 51, height: preset === "alpine" ? 24 : 15, kind: config.landmark },
      { x: -25, z: 53, height: 11, kind: "tower" },
      { x: 42, z: -55, height: 9, kind: preset === "desert" ? "arch" : "tower" },
    ],
    spawn: { x: 0, y: level + .87, z: -18, heading: 0 },
  };
}

export function generateWorld(preset: Preset, input: string): WorldDefinition {
  const seed = normalizeSeed(input);
  let errors: string[] = [];
  for (const variation of [1, .5, 0]) {
    const world = layout(preset, seed, variation);
    errors = validateWorldGeometry(world);
    if (!errors.length) return world;
  }
  throw new Error(`No valid ${preset} world for seed "${seed}": ${errors.join("; ")}`);
}
