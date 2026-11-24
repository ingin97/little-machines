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
import { generateWorld, presets } from "../app/racing/worldGenerator.ts";
import { connectWorldPeer } from "../app/racing/worldPeer.ts";
import { createDefinedWorld } from "../app/racing/worldRuntime.ts";
import { buildWorldTerrain } from "../app/racing/worldTerrain.ts";
import { validateWorld } from "../app/racing/worldValidation.ts";
import { createVehicle, stepTime } from "../app/racing/vehicle.ts";

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
