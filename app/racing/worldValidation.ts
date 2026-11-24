import type { RoadVector } from "./roadSpline.ts";
import { knownSurface, sampleWorldRoads, type WorldDefinition } from "./worldDefinition.ts";
import { buildWorldTerrain, roadTerrainClearance } from "./worldTerrain.ts";

type Fields = Record<string, unknown>;
const record = (value: unknown): Fields => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Fields : {};
const validNumber = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const identifier = (value: unknown) => typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,47}$/.test(value);
const list = (value: unknown, min: number, max: number): value is unknown[] => Array.isArray(value) && value.length >= min && value.length <= max;
const xyz = (value: unknown, max = 240) => {
  const { x, y, z } = record(value);
  return validNumber(x, -max, max) && validNumber(y, -5, 95) && validNumber(z, -max, max);
};
const distance = (a: RoadVector, b: RoadVector) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function validateWorld(value: unknown): string[] {
  const world = record(value);
  const errors: string[] = [];
  const check = (condition: unknown, path: string, expectation: string) => { if (!condition) errors.push(`${path} ${expectation}`); };
  check(world.version === 1, "version", "must be 1");
  check(identifier(world.id), "id", "must be a lowercase URL identifier");
  check(typeof world.name === "string" && world.name.length > 0 && world.name.length <= 60, "name", "must contain 1–60 characters");
  if (world.generation !== undefined) {
    const gen = record(world.generation);
    check(identifier(gen.preset) && Number.isSafeInteger(gen.version) && Number(gen.version) >= 1
      && typeof gen.seed === "string" && gen.seed.length > 0 && gen.seed.length <= 64, "generation", "must include preset, version and seed");
  }

  const terrain = record(world.terrain);
  check(validNumber(terrain.halfExtent, 40, 240), "terrain.halfExtent", "must be 40–240 m");
  check(validNumber(terrain.relief, 0, 60), "terrain.relief", "must be 0–60 m");
  check(validNumber(terrain.phase, 0, 7), "terrain.phase", "must be 0–7");
  check(validNumber(terrain.flatRadius, 0, 140), "terrain.flatRadius", "must be 0–140 m");
  check(knownSurface(terrain.surface), "terrain.surface", "is unknown");
  check(terrain.shape === undefined || terrain.shape === "canyon", "terrain.shape", "must be canyon when specified");
  const extent = Number(terrain.halfExtent) - 10;
  const inside = ({ x, z }: Fields) => validNumber(x, -extent, extent) && validNumber(z, -extent, extent);
  function items(data: unknown, path: string, min: number, max: number, validate: (item: Fields, path: string) => void) {
    if (!list(data, min, max)) errors.push(`${path} must contain ${min}–${max} items`);
    else data.forEach((item, i) => validate(record(item), `${path}[${i}]`));
  }
  items(terrain.zones, "terrain.zones", 0, 16, (zone, path) =>
    check(inside(zone) && validNumber(zone.radius, 2, 80) && knownSurface(zone.surface), path, "needs an in-bounds center, radius 2–80 m and known surface"));
  items(world.junctions, "junctions", 2, 32, (node, path) =>
    check(identifier(node.id) && xyz(node.position, extent), path, "needs an id and in-bounds position"));
  items(world.roads, "roads", 1, 24, (road, path) => {
    check(identifier(road.id) && identifier(road.from) && identifier(road.to), path, "needs id, from and to identifiers");
    check(knownSurface(road.surface), `${path}.surface`, "is unknown");
    check(road.structure === undefined || road.structure === "ramp", `${path}.structure`, "must be ramp when specified");
    items(road.knots, `${path}.knots`, 2, 32, (knot, at) => {
      const tangent = record(knot.tangent);
      const strength = Math.hypot(Number(tangent.x), Number(tangent.y), Number(tangent.z));
      check(xyz(knot.position, extent), `${at}.position`, "needs finite coordinates inside the terrain");
      check([tangent.x, tangent.y, tangent.z].every((axis) => validNumber(axis, -2, 2)) && strength >= .1,
        `${at}.tangent`, "needs finite components and length of at least 0.1");
      check(validNumber(knot.halfWidth, 2, 14), `${at}.halfWidth`, "must be 2–14 m");
      check(knot.crown === undefined || validNumber(knot.crown, 0, 5), `${at}.crown`, "must be 0–5 m");
      check(knot.bank === undefined || validNumber(knot.bank, -.55, .55), `${at}.bank`, "must be -0.55 to 0.55 radians");
    });
  });
  items(world.bridges, "bridges", 0, 8, (bridge, path) =>
    check(identifier(bridge.road) && inside(bridge) && validNumber(bridge.radius, 6, 50), path, "needs a road id, in-bounds center and radius of 6–50 m"));
  items(world.tunnels, "tunnels", 0, 8, (tunnel, path) =>
    check(xyz(tunnel, extent) && validNumber(tunnel.length, 8, 50) && validNumber(tunnel.width, 7, 30)
      && validNumber(tunnel.height, 4, 12), path, "needs an in-bounds center, length 8–50 m, width 7–30 m and clearance 4–12 m"));
  const attractions = record(world.attractions);
  for (const name of ["football", "bowling"]) check(xyz(attractions[name], extent), `attractions.${name}`, "needs an in-bounds position");
  items(attractions.stars, "attractions.stars", 1, 24, (star, path) => check(xyz(star, extent), path, "needs an in-bounds position"));
  items(world.landmarks, "landmarks", 1, 24, (landmark, path) =>
    check(inside(landmark) && validNumber(landmark.height, 3, 45) && ["peak", "arch", "tower"].includes(String(landmark.kind)), path, "needs an in-bounds position, height 3–45 m and kind peak, arch or tower"));
  if (world.scenery !== undefined) {
    items(world.scenery, "scenery", 0, 48, (item, path) =>
      check(inside(item) && validNumber(item.scale, .4, 3) && ["pine", "cactus", "rock"].includes(String(item.kind)), path,
        "needs an in-bounds position, scale 0.4–3 and kind pine, cactus or rock"));
  }
  check(xyz(world.spawn, extent) && validNumber(record(world.spawn).heading, -7, 7), "spawn", "needs an in-bounds position and heading in radians");
  if (errors.length) return errors;
  return validateWorldGeometry(value as WorldDefinition);
}

export function validateWorldGeometry(world: WorldDefinition): string[] {
  const errors: string[] = [];
  const junctions = new Map(world.junctions.map(({ id, position }) => [id, position]));
  if (junctions.size !== world.junctions.length) errors.push("junctions contain duplicate ids");
  if (new Set(world.roads.map(({ id }) => id)).size !== world.roads.length) errors.push("roads contain duplicate ids");
  const visited = new Set([world.roads[0].from]);
  for (let i = 0; i < world.junctions.length; i++) {
    for (const road of world.roads) {
      if (visited.has(road.from) || visited.has(road.to)) {
        visited.add(road.from);
        visited.add(road.to);
      }
    }
  }
  for (const [id] of junctions) if (!visited.has(id)) errors.push(`Junction "${id}" is disconnected`);
  for (const road of world.roads) {
    for (const [id, knot] of [[road.from, road.knots[0]], [road.to, road.knots[road.knots.length - 1]]] as const) {
      const point = junctions.get(id);
      if (!point || distance(point, knot.position) > .001) errors.push(`Road "${road.id}" does not meet junction "${id}" at its endpoint`);
    }
  }
  if (errors.length) return errors;

  try {
    const roads = sampleWorldRoads(world);
    const terrain = buildWorldTerrain(world, roads);
    for (const { road, rows } of roads) {
      for (let i = 1; i < rows.length; i++) {
        const [a, b] = [rows[i - 1], rows[i]];
        const horizontal = Math.hypot(b.x - a.x, b.z - a.z);
        const turning = Math.abs(Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading)));
        if (horizontal < .01 || Math.abs(b.y - a.y) / horizontal > .48 || turning / horizontal > 1 / (b.halfWidth + 1)) {
          errors.push(`Road "${road.id}" has excessive grade or curvature near (${b.x.toFixed(1)}, ${b.z.toFixed(1)})`);
          break;
        }
        if (Math.max(Math.abs(b.x), Math.abs(b.z)) + b.halfWidth >= terrain.halfExtent) {
          errors.push(`Road "${road.id}" leaves the terrain at sample ${i}`);
          break;
        }
      }
    }
    const endpoints = new Map<string, { road: string; row: (typeof roads)[number]["rows"][number]; end: boolean }[]>();
    for (const { road, rows } of roads) {
      for (const [id, row, end] of [[road.from, rows[0], false], [road.to, rows[rows.length - 1], true]] as const) {
        const meetings = endpoints.get(id) ?? [];
        meetings.push({ road: road.id, row, end });
        endpoints.set(id, meetings);
      }
    }
    for (const [id, meetings] of endpoints) {
      for (const a of meetings) for (const b of meetings) {
        if (a === b) continue;
        const direction = a.end === b.end ? -1 : 1;
        const aligned = Math.cos(a.row.heading - b.row.heading) * direction > .995;
        if (!aligned) {
          if (a.row.frameUp.y < .995 || b.row.frameUp.y < .995 || a.row.crown > .1 || b.row.crown > .1) {
            errors.push(`Intersection "${id}" needs flat approaches`);
          }
          continue;
        }
        const right = { x: b.row.frameRight.x * direction, y: b.row.frameRight.y * direction, z: b.row.frameRight.z * direction };
        if (distance(a.row.frameRight, right) > .025 || distance(a.row.frameUp, b.row.frameUp) > .025
          || Math.abs(a.row.halfWidth - b.row.halfWidth) > .15 || Math.abs(a.row.crown - b.row.crown) > .15) {
          errors.push(`Junction "${id}" has a width, slope or bank discontinuity between "${a.road}" and "${b.road}"`);
        }
      }
    }
    for (let i = 0; i < roads.length; i++) {
      const first = roads[i];
      for (const second of roads.slice(i)) {
        const common = [first.road.from, first.road.to].filter((id) => id === second.road.from || id === second.road.to);
        let invalid = false;
        for (let a = 1; a < first.rows.length && !invalid; a++) {
          for (let b = first === second ? a + 2 : 1; b < second.rows.length; b++) {
            const crossing = crossingAt(first.rows[a - 1], first.rows[a], second.rows[b - 1], second.rows[b]);
            if (!crossing || crossing.clearance >= 4.5) continue;
            const junction = common.some((id) => distance(junctions.get(id)!, crossing.position) < 1.5);
            if (junction && crossing.clearance < .06) continue;
            errors.push(`Roads "${first.road.id}" and "${second.road.id}" cross near (${crossing.position.x.toFixed(1)}, ${crossing.position.z.toFixed(1)}) without a flat junction or 4.5 m of clearance`);
            invalid = true;
            break;
          }
        }
      }
    }
    const clearance = roadTerrainClearance(world, roads, terrain);
    if (clearance) errors.push(clearance);
    for (const bridge of world.bridges) {
      const span = roads.find(({ road }) => road.id === bridge.road)?.rows;
      if (!span?.some(({ x, y, z }) => Math.hypot(x - bridge.x, z - bridge.z) < bridge.radius / 2 && y - terrain.heightAt(x, z) >= 4.5)) {
        errors.push(`Bridge on "${bridge.road}" has no span with 4.5 m of clearance`);
      }
    }
    for (const tunnel of world.tunnels) {
      const covered = roads.flatMap(({ rows }) => rows.filter(({ x, z }) => Math.abs(x - tunnel.x) < 2 && Math.abs(z - tunnel.z) < tunnel.length / 2));
      if (!covered.length || covered.some((row) => Math.abs(row.x - tunnel.x) + row.halfWidth + .4 > tunnel.width / 2
        || row.y < tunnel.y - .25 || row.y - tunnel.y > tunnel.height - 3.5)) errors.push(`Tunnel at (${tunnel.x}, ${tunnel.z}) has insufficient road clearance`);
    }
    const { spawn, attractions } = world;
    const nearRoad = (point: RoadVector, extra: number, vertical: number) => roads.some(({ rows }) => rows.some((row) =>
      Math.hypot(row.x - point.x, row.z - point.z) < row.halfWidth + extra && Math.abs(row.y - point.y) <= vertical));
    const spawnRoad = roads.some(({ rows }) => rows.some((row) => {
      const elevation = spawn.y - row.y;
      return elevation >= .6 && elevation <= 1.15 && row.frameUp.y > .98
        && Math.hypot(row.x - spawn.x, row.z - spawn.z) < row.halfWidth - 1.5;
    }));
    if (!spawnRoad || spawn.y - terrain.heightAt(spawn.x, spawn.z) < .65) errors.push("spawn needs a clear road beneath the vehicle");
    for (const [label, point] of [["football", attractions.football], ["bowling", attractions.bowling],
      ...attractions.stars.map((point, i) => [`star ${i + 1}`, point] as const)] as const) {
      const ground = terrain.heightAt(point.x, point.z);
      if (!nearRoad(point, 33, 3) || (Math.abs(point.y - ground) > 3 && !nearRoad(point, 0, 2))) {
        errors.push(`Attraction "${label}" needs a reachable location near the road network`);
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return [...new Set(errors)];
}

function crossingAt(a: RoadVector, b: RoadVector, c: RoadVector, d: RoadVector) {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x)
    || Math.max(a.z, b.z) < Math.min(c.z, d.z) || Math.max(c.z, d.z) < Math.min(a.z, b.z)) return;
  const ax = b.x - a.x;
  const az = b.z - a.z;
  const bx = d.x - c.x;
  const bz = d.z - c.z;
  const x = c.x - a.x;
  const z = c.z - a.z;
  const det = ax * bz - az * bx;
  if (Math.abs(det) < 1e-9) return;
  const t = (x * bz - z * bx) / det;
  const u = (x * az - z * ax) / det;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return;
  const y = a.y + (b.y - a.y) * t;
  return { position: { x: a.x + ax * t, y, z: a.z + az * t }, clearance: Math.abs(y - c.y - (d.y - c.y) * u) };
}
