import assert from "node:assert/strict";
import { test } from "node:test";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Scene } from "@babylonjs/core/scene.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { createDrivingParticles } from "../app/racing/particles.ts";
import { createVehicle, stepTime } from "../app/racing/vehicle.ts";
import { boundary, createWorld, spawn } from "../app/racing/world.ts";

await RAPIER.init();

function playground(t) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const sun = new DirectionalLight("sun", new Vector3(-.45, -1, .36), scene);
  const shadows = new ShadowGenerator(1024, sun);
  const physics = new RAPIER.World({ x: 0, y: -16, z: 0 });
  t.after(() => { scene.dispose(); engine.dispose(); physics.free(); });
  physics.timestep = stepTime;
  const world = createWorld(scene, physics, shadows);
  const car = createVehicle(scene, physics, shadows, spawn, world.padAt);
  const bodies = [];
  physics.forEachRigidBody((body) => { if (body.isDynamic()) bodies.push(body); });
  const chassis = bodies.find((body) => body.mass() > 100);
  assert.ok(chassis);
  const settings = { automatic: true, gentle: true, reverse: true, recovery: true, speed: 15, dead: 8, calibration: null };

  let goals = 0;
  function drive(seconds, input = {}, sample = () => {}) {
    const controls = { steer: 0, accelerator: 0, brake: 0, ...input };
    for (let i = 0; i < Math.round(seconds / stepTime); i++) {
      car.step(controls, settings);
      physics.step();
      car.sync();
      if (world.checkGoals(stepTime, car.root.position)) goals++;
      world.sync(car.root.position, car.boost(), stepTime);
      sample(car.root.position);
    }
  }
  function place(x, z, heading = 0) {
    car.reset({ x, y: spawn.y, z, heading });
  }

  return { car, chassis, bodies, settings, physics, scene, drive, place, goals: () => goals };
}

test("boost respects the speed cap and both bridge levels and tunnel stay driveable", (t) => {
  const { car, chassis, settings, drive, place } = playground(t);
  let cruiseSpeed = 0;
  let boostSpeed = 0;
  drive(7, {}, ({ z }) => {
    if (z > 13 && z < 17) cruiseSpeed = Math.max(cruiseSpeed, chassis.linvel().z);
    if (car.boost()) boostSpeed = Math.max(boostSpeed, chassis.linvel().z);
  });
  assert.ok(boostSpeed > cruiseSpeed + 2 && boostSpeed <= settings.speed + .15);
  assert.ok(car.root.position.z > 54 && car.root.position.y < 1.5);

  place(-64, 53, Math.PI / 2);
  drive(7);
  assert.ok(car.root.position.x > 5 && car.root.position.y > 5.7);

  place(-68, 0, Math.PI / 2);
  drive(5);
  assert.ok(car.root.position.x > -17 && Math.abs(car.root.position.z) < .6);
});

test("the ramps, off-road hill and bank have physical surfaces", (t) => {
  const { car, physics, drive, place } = playground(t);
  for (const [x, z, time, rise] of [[27, 3, 4, 1.9], [-28, -65, 5, 4.8], [-30, 65, 5, 4.5]]) {
    place(x, z);
    let peak = 0;
    drive(time, {}, ({ y }) => { peak = Math.max(peak, y); });
    assert.ok(peak > rise);
    assert.ok(car.root.position.y < 1.2);
  }
  const angles = Math.SQRT1_2;
  const height = (radius) => {
    const ray = new RAPIER.Ray({ x: 54 + angles * radius, y: 5, z: 54 + angles * radius }, { x: 0, y: -1, z: 0 });
    const hit = physics.castRay(ray, 6, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
    assert.ok(hit);
    return 5 - hit.timeOfImpact;
  };
  assert.ok(height(27) - height(17) > .5);
});

test("the car moves toys and recovers near the tunnel after a rollover", (t) => {
  const { car, chassis, bodies, drive, place } = playground(t);
  const ball = bodies.find((body) => Math.abs(body.mass() - 26) < .1 && Math.abs(body.translation().x - 30) < .5);
  assert.ok(ball);
  place(30, -43);
  const originalBallZ = ball.translation().z;
  drive(2.5);
  assert.ok(ball.translation().z > originalBallZ + 4);

  place(36, 23);
  const blocks = bodies.filter((body) => Math.abs(body.mass() - 15) < .1 && Math.abs(body.translation().x - 36) < 2);
  const blockPositions = blocks.map((body) => body.translation().z);
  drive(2.8);
  assert.ok(blocks.some((body, i) => Math.abs(body.translation().z - blockPositions[i]) > 3));

  place(-68, 0, Math.PI / 2);
  drive(2.9);
  const revision = car.revision();
  chassis.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
  chassis.setLinvel(Vector3.Zero(), true);
  chassis.setAngvel(Vector3.Zero(), true);
  drive(2);
  assert.ok(car.revision() > revision);
  assert.ok(car.root.position.x > -68 && car.root.position.x < -16);
});

test("toddler mode continues driving through several minutes of fixed steering", (t) => {
  const { drive } = playground(t);
  let furthest = 0;
  drive(180, { steer: .16 }, ({ x, y, z }) => {
    assert.ok(Number.isFinite(y) && y > -12);
    furthest = Math.max(furthest, Math.hypot(x, z));
  });
  assert.ok(furthest > 80 && furthest < boundary + 1);
});


test("changing cars preserves the physics pose and landing feedback only fires once", (t) => {
  const { car, chassis, scene, drive, place } = playground(t);
  new FreeCamera("test camera", new Vector3(0, 4, -15), scene).setTarget(Vector3.Zero());
  scene.render();
  place(-28, -65);
  let landings = 0;
  drive(1.5);
  const before = chassis.translation();
  car.setLook("rocket");
  assert.deepEqual(chassis.translation(), before);
  assert.equal(scene.getTransformNodeByName("rocket fins").isEnabled(), true);
  assert.equal(scene.getTransformNodeByName("rally spoiler").isEnabled(), false);
  drive(3.5, {}, () => {
    if (car.takeLanding() > 0) landings++;
  });
  assert.equal(landings, 1);

  drive(stepTime);
  const currentPosition = car.root.position.clone();
  car.sync(0);
  const previousPosition = car.root.position.clone();
  car.sync(.5);
  assert.ok(Vector3.Distance(car.root.position, Vector3.Center(previousPosition, currentPosition)) < .00001);
});


test("driving particles reuse their pool and expire", (t) => {
  const { car, scene } = playground(t);
  const effects = createDrivingParticles(scene);
  const pool = scene.meshes.filter((mesh) => mesh.name === "driving particle");
  const update = (speed, boost, impact) => effects.update(stepTime, car.root.position, car.root.rotationQuaternion,
    speed, true, boost, impact, true);

  assert.equal(pool.length, 46);
  update(12, 1, .9);
  assert.ok(pool.some((mesh) => mesh.isEnabled() && mesh.isVisible));
  for (let i = 0; i < 60; i++) update(0, 0, 0);
  assert.ok(pool.every((mesh) => !mesh.isEnabled()));
  assert.equal(scene.meshes.filter((mesh) => mesh.name === "driving particle").length, pool.length);
});


test("the scenic loop has a high point, three entrances, and a separate jump", (t) => {
  const { physics, car, drive, place } = playground(t);
  drive(stepTime);
  function groundAt(x, z) {
    const ray = new RAPIER.Ray({ x, y: 30, z }, { x: 0, y: -1, z: 0 });
    const hit = physics.castRay(ray, 35, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
    assert.ok(hit);
    return 30 - hit.timeOfImpact;
  }
  assert.ok(groundAt(221, 0) > 9);
  for (const entry of [-40, 0, 40]) {
    place(75, entry, Math.PI / 2);
    drive(4);
    assert.ok(car.root.position.x > 100 && Math.abs(car.root.position.z - entry) < 2);
  }
  place(122, -35, Math.PI / 2);
  let peak = 0;
  drive(5, {}, ({ y }) => { peak = Math.max(peak, y); });
  assert.ok(peak > 3.7 && car.root.position.y < 1.4);
});

test("a kicked football scores once and waits to re-serve if the car blocks its spot", (t) => {
  const { bodies, chassis, scene, drive, place, goals, settings } = playground(t);
  const ball = bodies.find((body) => Math.abs(body.mass() - 26) < .1 && Math.abs(body.translation().x - 30) < .5);
  assert.ok(ball);
  place(30, -43);
  for (let i = 0; i < 420 && !goals(); i++) drive(stepTime);
  assert.equal(goals(), 1);
  assert.ok(scene.meshes.some((mesh) => mesh.name === "goal confetti" && mesh.isEnabled()));
  settings.automatic = false;
  place(30, -29);
  drive(2);
  assert.equal(goals(), 1);
  assert.ok(ball.translation().z > -13);
  chassis.setTranslation({ x: 20, y: .87, z: -40 }, true);
  drive(1);
  assert.ok(Math.abs(ball.translation().z + 29) < .15);
});
