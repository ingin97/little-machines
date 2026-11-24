import assert from "node:assert/strict";
import { test } from "node:test";
import { DirectionalLight, NullEngine, Scene, ShadowGenerator, Vector3 } from "@babylonjs/core";
import RAPIER from "@dimforge/rapier3d-compat";
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

  function drive(seconds, input = {}, sample = () => {}) {
    const controls = { steer: 0, accelerator: 0, brake: 0, ...input };
    for (let i = 0; i < Math.round(seconds / stepTime); i++) {
      car.step(controls, settings);
      physics.step();
      car.sync();
      world.sync(car.root.position, car.boost());
      sample(car.root.position);
    }
  }
  function place(x, z, heading = 0) {
    car.reset({ x, y: spawn.y, z, heading });
  }

  return { car, chassis, bodies, settings, physics, drive, place };
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
