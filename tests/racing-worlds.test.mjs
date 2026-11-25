import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Scene } from "@babylonjs/core/scene.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { canonicalWorldDefinition, definitionIdentity, sampleWorldRoads } from "../app/racing/worldDefinition.ts";
import { generateWorld as generateCurrentWorld, presets as currentPresets } from "../app/racing/worldGenerator.ts";
import { connectWorldPeer } from "../app/racing/worldPeer.ts";
import { createDefinedWorld } from "../app/racing/worldRuntime.ts";
import { buildWorldTerrain, roadShoulders } from "../app/racing/worldTerrain.ts";
import { validateWorld } from "../app/racing/worldValidation.ts";
import { createVehicle, sprintHandling, sprintTopSpeed, stepTime } from "../app/racing/vehicle.ts";

import { buildProceduralSprint, buildProceduralSprints } from "../app/racing/proceduralSprint.ts";
import { gateCrossing } from "../app/racing/sprintRules.ts";

const presets = { alpine: currentPresets.alpine, desert: currentPresets.desert, countryside: currentPresets.countryside };
const generateWorld = (preset, seed) => generateCurrentWorld(preset, seed, 1);

await RAPIER.init();

test("all presets produce deterministic and valid worlds across different seeds", async () => {
  const allHashes = new Set();
  for (const preset of Object.keys(presets)) {
    for (const seed of ["2026", "Fjell og fjord", "a", "0", "4277689328", "Sommer", "🐣", "1"]) {
      const world = generateWorld(preset, seed);
      const again = generateWorld(preset, seed);
      assert.deepEqual(again, world, `${preset}/${seed}`);
      assert.deepEqual(validateWorld(world), [], `${preset}/${seed}`);
      const identity = await definitionIdentity(world);
      assert.deepEqual(await definitionIdentity(again), identity);
      assert.equal(allHashes.has(identity.hash), false);
      allHashes.add(identity.hash);
    }
  }
  assert.equal(canonicalWorldDefinition({ b: 1, a: [2, { y: 3, x: 4 }] }),
    canonicalWorldDefinition({ a: [2, { x: 4, y: 3 }], b: 1 }));
  assert.notDeepEqual(generateWorld("alpine", "one").roads, generateWorld("alpine", "two").roads);
  assert.ok(generateWorld("alpine", "one").roads.some((road) => road.id === "spiral-pass"));
  assert.ok(generateWorld("desert", "one").terrain.shape === "canyon");
  assert.ok(generateWorld("countryside", "one").roads.some((road) => road.id === "halfpipe"));
});

test("the authored world loads and validation identifies disconnected roads and bad spawns", () => {
  const authored = JSON.parse(readFileSync(new URL("../app/racing/worlds/sommerlia.json", import.meta.url), "utf8"));
  assert.deepEqual(validateWorld(authored), []);
  const disconnected = structuredClone(authored);
  disconnected.junctions.push({ id: "orphan", position: { x: 5, y: 6, z: 7 } });
  assert.match(validateWorld(disconnected).join("\n"), /Junction "orphan" is disconnected/);
  const badSpawn = structuredClone(authored);
  badSpawn.spawn.y = 57;
  assert.match(validateWorld(badSpawn).join("\n"), /spawn needs a clear road/);
  const broken = structuredClone(authored);
  broken.roads[0].knots[1].tangent = null;
  assert.match(validateWorld(broken).join("\n"), /roads\[0\].knots\[1\].tangent/);
});

test("aligned route segments share their complete cross-section at surface transitions", () => {
  const roads = sampleWorldRoads(generateWorld("alpine", "2026"));
  const ends = roads.find(({ road }) => road.id === "west-climb").rows.at(-1);
  const starts = roads.find(({ road }) => road.id === "west-descent").rows[0];
  assert.deepEqual([ends.x, ends.y, ends.z, ends.halfWidth, ends.crown],
    [starts.x, starts.y, starts.z, starts.halfWidth, starts.crown]);
  for (const axis of ["x", "y", "z"]) {
    assert.ok(Math.abs(ends.frameUp[axis] - starts.frameUp[axis]) < 1e-8);
    assert.ok(Math.abs(ends.frameRight[axis] - starts.frameRight[axis]) < 1e-8);
  }
});

test("generated terrain matches Rapier heights and the spawn reaches the end of the avenue", (t) => {
  for (const [preset, seed] of [["alpine", "192"], ["desert", "223"], ["countryside", "7"]]) {
    const world = generateWorld(preset, seed);
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const sun = new DirectionalLight("sun", new Vector3(-.45, -1, .36), scene);
    const shadows = new ShadowGenerator(64, sun);
    const physics = new RAPIER.World({ x: 0, y: -16, z: 0 });
    t.after(() => { scene.dispose(); engine.dispose(); physics.free(); });
    physics.timestep = stepTime;
    const park = createDefinedWorld(scene, physics, shadows, world);
    const car = createVehicle(scene, physics, shadows, world.spawn, park.padAt);
    const settings = { speed: 13, gentle: true, automatic: true, reverse: true, recovery: true };
    const terrain = buildWorldTerrain(world);
    physics.step();
    for (const [x, z] of [[-24.7, -36.6], [23.2, 112.4], [-164.1, 20.8]]) {
      const hit = physics.castRay(new RAPIER.Ray({ x, y: 75, z }, { x: 0, y: -1, z: 0 }), 150, true);
      assert.ok(hit, `${preset} ground at ${x}, ${z}`);
      assert.ok(Math.abs(75 - hit.timeOfImpact - terrain.heightAt(x, z)) < .001);
    }
    const reset = car.revision();
    for (let i = 0; i < 570; i++) {
      car.step({ steer: 0, accelerator: 0, brake: 0 }, settings);
      physics.step();
    }
    assert.ok(car.position().z > 58, preset);
    assert.ok(Math.abs(car.position().x) < 2, preset);
    assert.equal(car.revision(), reset, preset);
    assert.ok(car.wheelSurfaces().includes("asphalt"), preset);
  }
});

test("each procedural time trial can be completed using the adult vehicle and generated road colliders", async (t) => {
  for (const preset of Object.keys(presets)) {
    await t.test(preset, async () => {
      const world = generateWorld(preset, "2026");
      const { hash } = await definitionIdentity(world);
      const layout = buildProceduralSprint(world, hash);
      assert.deepEqual(layout, buildProceduralSprint(generateWorld(preset, "2026"), hash));
      const other = generateWorld(preset, "7");
      assert.notEqual(layout.recordKey, buildProceduralSprint(other, (await definitionIdentity(other)).hash).recordKey);

      driveRace(world, layout, preset === "alpine" ? 12 : 16);
    });
  }
});

function withDrivingWorld(world, run) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const sun = new DirectionalLight("sun", new Vector3(-.45, -1, .36), scene);
  const shadows = new ShadowGenerator(64, sun);
  const physics = new RAPIER.World({ x: 0, y: -16, z: 0 });
  physics.timestep = stepTime;
  try {
    const park = createDefinedWorld(scene, physics, shadows, world, false);
    run({ scene, shadows, physics, park });
  } finally {
    scene.dispose();
    engine.dispose();
    physics.free();
  }
}

function driveRace(world, layout, cruiseSpeed) {
  withDrivingWorld(world, ({ scene, physics, shadows, park }) => {
    const car = createVehicle(scene, physics, shadows, layout.spawn, park.padAt, sprintHandling, world.terrain.halfExtent);
    const settings = { speed: sprintTopSpeed, gentle: false, automatic: false, reverse: false, recovery: false };
    const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    let row = layout.rows.findIndex((point) => distance(point, layout.spawn) < .001);
    let gate = 0;
    const revision = car.revision();
    for (let tick = 0; tick < 115 / stepTime && gate < layout.gates.length; tick++) {
      const point = car.position();
      const { x, y, z, w } = car.rotation();
      while (row + 1 < layout.rows.length && distance(layout.rows[row + 1], point) < distance(layout.rows[row], point)) row++;
      const target = layout.rows[Math.min(row + 4, layout.rows.length - 1)];
      const heading = Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y));
      const error = Math.atan2(target.x - point.x, target.z - point.z) - heading;
      const speed = car.speed();
      car.step({
        steer: Math.max(-1, Math.min(1, Math.atan2(Math.sin(error), Math.cos(error)) * 2.8)),
        accelerator: Math.max(0, Math.min(1, (cruiseSpeed - speed) * .4)),
        brake: speed > cruiseSpeed + 2 ? .3 : 0,
      }, settings);
      physics.step();
      assert.equal(car.revision(), revision, `reset after checkpoint ${gate} on ${layout.id}`);
      if (gateCrossing(point, car.position(), layout.gates[gate]) !== null) gate++;
    }
    assert.equal(gate, layout.gates.length, `${layout.id} at row ${row}, position ${JSON.stringify(car.position())}, next checkpoint ${JSON.stringify(layout.gates[gate])}`);
  });
}

test("v2 varies graph structure and preserves deterministic versions and route identities", async () => {
  assert.equal((await definitionIdentity(generateWorld("alpine", "2026"))).hash,
    "03bbde2ba44c1a7ca47690ea8bfb6a31fbc4d243120f7f7fdbacf72dc2fd0d48");
  const topology = (world) => {
    const degree = new Map(world.junctions.map(({ id }) => [id, 0]));
    for (const { from, to } of world.roads) {
      degree.set(from, degree.get(from) + 1);
      degree.set(to, degree.get(to) + 1);
    }
    return {
      // Loop count and degrees are independent of node names, geometry and degree-two subdivisions.
      cycles: world.roads.length - degree.size + 1,
      branches: [...degree.values()].filter((value) => value !== 2).sort((a, b) => a - b),
    };
  };
  for (const preset of Object.keys(currentPresets)) {
    const graphs = new Set();
    const loops = new Set();
    for (let seed = 0; seed < 8; seed++) {
      const world = generateCurrentWorld(preset, String(seed));
      const signature = topology(world);
      graphs.add(JSON.stringify(signature));
      loops.add(signature.cycles);
    }
    assert.ok(graphs.size >= 3 && loops.size >= 2, preset);
    const world = generateCurrentWorld(preset, "2026");
    const hash = (await definitionIdentity(world)).hash;
    const races = buildProceduralSprints(world, hash);
    assert.equal(canonicalWorldDefinition(world), canonicalWorldDefinition(generateCurrentWorld(preset, "2026", 2)));
    assert.ok(races.length >= 2);
    assert.equal(new Set(races.map((race) => race.recordKey)).size, races.length);
    assert.deepEqual(races, buildProceduralSprints(generateCurrentWorld(preset, "2026"), hash));
  }
});

test("v2 races drive through curves, junctions, stacked roads and long descents", async (t) => {
  for (const [preset, motif, speed, seed = "2026"] of [
    ["sky-highway", "figure-eight", 10],
    ["sky-highway", "sky-crossing", 14],
    ["sky-highway", "circuit-north", 18],
    ["mountain-expedition", "summit-spiral", 13],
    ["alpine", "switchbacks", 8],
    ["mountain-expedition", "summit-descent", 13, "0"],
    ["rollercoaster-park", "coaster", 14],
  ]) {
    await t.test(motif, () => {
      const world = generateCurrentWorld(preset, seed);
      const race = buildProceduralSprints(world, "test").find(({ id }) => id.includes(motif));
      assert.ok(race, motif);
      driveRace(world, race, speed);
    });
  }
});

test("crossing checks reject a flattened figure-eight and the lower road stays clear of bridge piers", () => {
  const world = generateCurrentWorld("sky-highway", "2026");
  const invalid = structuredClone(world);
  const figure = invalid.roads.find(({ id }) => id === "figure-eight");
  for (const knot of figure.knots) {
    knot.position.y = .18;
    knot.tangent.y = 0;
  }
  assert.ok(validateWorld(invalid).some((error) => error.includes("figure-eight") && error.includes("clearance")));
  withDrivingWorld(world, ({ physics }) => {
    physics.step();
    const down = { x: 0, y: -1, z: 0 };
    for (const z of [-9, 0, 9]) {
      const hit = physics.castRay(new RAPIER.Ray({ x: -36, y: 5, z }, down), 6, true);
      assert.ok(hit && Math.abs(5 - hit.timeOfImpact - .18) < .04, `lower deck at ${z}`);
    }
    const upper = physics.castRay(new RAPIER.Ray({ x: -36, y: 45, z: 0 }, down), 45, true);
    assert.ok(upper && 45 - upper.timeOfImpact > 20);
  });
});

test("a toddler car can rejoin a grounded banked road from its shoulder", () => {
  const world = generateCurrentWorld("mountain-expedition", "2026");
  const rows = sampleWorldRoads(world).find(({ road }) => road.id === "circuit-south").rows;
  const terrain = buildWorldTerrain(world);
  const shoulders = roadShoulders(rows, terrain, 1, () => false)[0];
  const section = shoulders[Math.floor(shoulders.length / 2)];
  const row = rows[Math.floor(rows.length / 2)];
  const outward = { x: Math.cos(row.heading), z: -Math.sin(row.heading) };
  const x = section.x + outward.x * (section.halfWidth + 1.4);
  const z = section.z + outward.z * (section.halfWidth + 1.4);
  withDrivingWorld(world, ({ scene, physics, shadows, park }) => {
    const car = createVehicle(scene, physics, shadows,
      { x, y: terrain.heightAt(x, z) + .9, z, heading: row.heading - Math.PI / 2 }, park.padAt);
    const settings = { speed: 11, gentle: true, automatic: true, reverse: true, recovery: true };
    const revision = car.revision();
    for (let tick = 0; tick < 360; tick++) {
      car.step({ accelerator: 1, steer: 0, brake: 0 }, settings);
      physics.step();
      if (car.wheelSurfaces().includes("asphalt")) break;
    }
    assert.ok(car.wheelSurfaces().includes("asphalt"), JSON.stringify({ x, z, position: car.position(), surfaces: car.wheelSurfaces(), section, row }));
    assert.equal(car.revision(), revision);
  });
});

test("data-channel poses are gated on both the world id and canonical hash", async () => {
  class Channel extends EventTarget {
    readyState = "open";
    bufferedAmount = 0;
    sent = [];
    send(message) { this.sent.push(JSON.parse(message)); }
    close() { this.readyState = "closed"; }
    receive(message) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) })); }
  }
  const identity = await definitionIdentity(generateWorld("desert", "same"));
  const pose = { position: [0, .8, 0], rotation: [0, 0, 0, 1], look: "rally", speed: 0, steering: 0, reset: 1 };
  const channel = new Channel();
  const poses = [];
  let rejected = 0;
  const link = connectWorldPeer(channel, identity, (item) => poses.push(item), () => rejected++);
  assert.deepEqual(channel.sent, [{ v: 1, type: "world", world: identity }]);
  channel.receive({ v: 1, type: "pose", pose });
  link.send(pose);
  assert.equal(poses.length, 0);
  assert.equal(channel.sent.length, 1);
  channel.receive({ v: 1, type: "world", world: identity });
  channel.receive({ v: 1, type: "pose", pose });
  link.send(pose);
  assert.deepEqual(poses, [pose]);
  assert.deepEqual(channel.sent[1], { v: 1, type: "pose", pose });
  channel.receive({ v: 1, type: "world", world: { ...identity, hash: "different" } });
  assert.equal(rejected, 1);
  assert.equal(channel.readyState, "closed");
  link.dispose();
});
