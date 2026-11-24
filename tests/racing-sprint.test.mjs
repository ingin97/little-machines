import assert from "node:assert/strict";
import { test } from "node:test";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { createSprint } from "../app/racing/sprint.ts";
import { buildSprintLayout, createSprintCourse } from "../app/racing/sprintCourse.ts";
import { buildRidgeLayout } from "../app/racing/ridgeLayout.ts";
import { decodeRecord, gateCrossing } from "../app/racing/sprintRules.ts";
import { createVehicle, sprintHandling, sprintTopSpeed, stepTime } from "../app/racing/vehicle.ts";

test("checkpoint gates require a forward crossing within the road width", () => {
  const gate = { x: 10, z: 0, heading: Math.PI / 2, halfWidth: 5.5 };
  assert.ok(Math.abs(gateCrossing({ x: 9, z: 2 }, { x: 13, z: 2 }, gate) - .25) < 1e-9);
  assert.equal(gateCrossing({ x: 13, z: 2 }, { x: 9, z: 2 }, gate), null);
  assert.equal(gateCrossing({ x: 9, z: 6 }, { x: 13, z: 6 }, gate), null);
  assert.equal(gateCrossing({ x: 9, z: 2, y: 1 }, { x: 13, z: 2, y: 1 }, { ...gate, y: 10 }), null);
});

for (const ridge of [false, true]) {
  test(`${ridge ? "Bergsprint" : "Engsprint"} saves and reloads its own timed ghost`, (t) => testSprint(t, ridge));
}

async function testSprint(t, ridge) {
  await RAPIER.init();
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const shadows = new ShadowGenerator(128, new DirectionalLight("sun", new Vector3(-1, -2, 1), scene));
  const physics = new RAPIER.World({ x: 0, y: -16, z: 0 });
  physics.timestep = stepTime;
  const labels = new Map();
  const storage = new Map();
  const setGlobal = (key, value) => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  };
  setGlobal("document", { querySelector: (selector) => {
    if (!labels.has(selector)) labels.set(selector, { textContent: "", dataset: {} });
    return labels.get(selector);
  } });
  setGlobal("localStorage", {
    getItem: (key) => storage.get(key),
    setItem: (key, value) => storage.set(key, value),
  });
  t.after(() => { scene.dispose(); engine.dispose(); physics.free(); });
  const course = createSprintCourse(scene, physics, ridge);
  const start = course.spawn;
  const car = createVehicle(scene, physics, shadows, start, () => -1, sprintHandling);
  const sprint = createSprint(scene, course, car);
  for (let i = 0; i < 180; i++) assert.equal(sprint.beforeStep(), false);
  assert.equal(labels.get("#sprint-message").textContent, "Kjør!");
  assert.deepEqual({ ...car.position() }, { x: start.x, y: Math.fround(start.y), z: start.z });

  const { rows } = ridge ? buildRidgeLayout() : buildSprintLayout();
  const settings = { speed: sprintTopSpeed, automatic: false, gentle: false, reverse: false, recovery: false };
  let nearest = rows.findIndex((row) => row.z >= start.z);
  let crestFlight = 0;
  let crestLanding = false;
  let chassis;
  physics.forEachRigidBody((body) => { if (body.mass() > 100) chassis = body; });
  const planarSpeed = () => {
    const { x, z } = chassis.linvel();
    return Math.hypot(x, z);
  };
  for (let tick = 0; tick < 60 * 65 && sprint.beforeStep(); tick++) {
    const p = car.position();
    const distance = (row) => Math.hypot(row.x - p.x, row.z - p.z);
    while (nearest + 1 < rows.length && distance(rows[nearest + 1]) < distance(rows[nearest])) nearest++;
    const speed = car.speed();
    const lead = Math.max(6, speed * .45);
    let look = nearest;
    while (look + 1 < rows.length && distance(rows[look]) < lead) look++;
    const target = rows[look];
    const yaw = car.rotation();
    const heading = Math.atan2(2 * (yaw.w * yaw.y + yaw.x * yaw.z), 1 - 2 * (yaw.x ** 2 + yaw.y ** 2));
    const error = Math.atan2(target.x - p.x, target.z - p.z) - heading;
    const steer = Math.max(-1, Math.min(1, Math.atan2(Math.sin(error), Math.cos(error)) * 3.5));
    const upcoming = rows[Math.min(look + 8, rows.length - 1)];
    const corner = Math.abs(upcoming.heading - rows[nearest].heading) > .14;
    const targetSpeed = corner ? 16 : sprintTopSpeed - 1;
    const brake = Number(speed > targetSpeed + 1);
    const before = planarSpeed();
    car.step({ steer, accelerator: Number(speed < targetSpeed), brake }, course.isGrass(p) ? { ...settings, speed: 10 } : settings);
    const landed = ridge && p.z > -90 && p.z < -48 && nearest < 50 && !brake && car.takeLanding() > 0;
    physics.step();
    if (landed) {
      assert.ok(planarSpeed() >= before - .15, "clean touchdown should preserve planar speed");
      crestLanding = true;
    }
    sprint.afterStep();
    if (ridge && p.z > -90 && p.z < -68 && nearest < 45 && !car.grounded()) crestFlight += stepTime;
  }
  if (ridge) {
    assert.ok(crestFlight >= .18, `First crest airtime: ${crestFlight.toFixed(2)} s`);
    assert.ok(crestLanding, "the first crest should exercise a clean touchdown");
  }

  assert.match(labels.get("#sprint-message").textContent, /^Ny rekord!/, JSON.stringify({ nearest, point: car.position(), progress: labels.get("#sprint-progress").textContent }));
  for (const direction of [-1, 1]) {
    const ray = new RAPIER.Ray({ x: start.x, y: start.y, z: start.z }, { x: direction, y: 0, z: 0 });
    const wall = physics.castRay(ray, 8, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
    if (ridge) assert.ok(wall && wall.timeOfImpact > 5.5 && wall.timeOfImpact < 6);
    else assert.equal(wall, null);
  }
  const raw = storage.get(ridge ? "little-machines-ridge-v1" : "little-machines-sprint-v1");
  const record = decodeRecord(raw, course.gates.length);
  assert.ok(record);
  assert.ok(record.splits.at(-1) >= 30 && record.splits.at(-1) <= 60, `Test run took ${record.splits.at(-1)} seconds`);
  assert.equal(decodeRecord(raw, course.gates.length + 1), undefined);
  sprint.reset();
  sprint.draw(1);
  assert.equal(labels.get("#sprint-message").textContent, "3");
  assert.match(labels.get("#sprint-best").textContent, /\d+,\d\d s/);
  assert.equal(labels.get("#sprint-progress").textContent, `Port 1 av ${course.gates.length}`);
  createSprint(scene, course, car).draw(1);
  assert.equal(scene.transformNodes.filter((node) => node.name === "car" && node.isEnabled()).length, 3);

  function driveFor(ticks, accelerator, brake) {
    for (let tick = 0; tick < ticks; tick++) {
      car.step({ steer: 0, accelerator, brake }, settings);
      physics.step();
    }
  }

  driveFor(85, 1, 0);
  const movingForward = car.position().z;
  assert.ok(movingForward > start.z + 3);
  driveFor(6, 0, 1);
  assert.ok(car.position().z > movingForward, "the brake should slow forward travel before reversing");
  driveFor(180, 0, 1);
  assert.ok(car.wheelSpeed() < -1, "holding the brake after stopping should reverse the sprint car");

  car.reset({ ...start, y: start.y + .24 });
  chassis.setLinvel({ x: 0, y: -.8, z: 25 }, true);
  for (let tick = 0; tick < 30 && !car.grounded(); tick++) driveFor(1, 0, 0);
  assert.ok(car.grounded(), "the short hop should reach touchdown");
  car.step({ steer: 1, accelerator: 0, brake: 0 }, settings);
  physics.step();
  assert.ok(car.steering() < .012, "a steering tap at touchdown should apply a small wheel angle");
  driveFor(12, 0, 0);
  assert.ok(Math.abs(car.rotation().y) < .10, "a steering tap after a short hop should not snap the car sideways");
}
