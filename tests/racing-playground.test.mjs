import assert from "node:assert/strict";
import { test } from "node:test";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Scene } from "@babylonjs/core/scene.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { createChaseCamera } from "../app/racing/camera.ts";
import { createControllerHandoff } from "../app/racing/handoff.ts";
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
  let stars = 0;
  let strikes = 0;
  function drive(seconds, input = {}, sample = () => {}) {
    const controls = { steer: 0, accelerator: 0, brake: 0, ...input };
    for (let i = 0; i < Math.round(seconds / stepTime); i++) {
      car.step(controls, settings);
      physics.step();
      car.sync();
      if (world.checkGoals(stepTime, car.root.position)) goals++;
      const feedback = world.stepStuntToys(stepTime, car.position());
      stars += Number(feedback.collected);
      strikes += Number(feedback.knocked);
      world.sync(car.root.position, car.boost(), stepTime);
      sample(car.root.position);
    }
  }
  function place(x, z, heading = 0, y = spawn.y) {
    car.reset({ x, y, z, heading });
  }

  return { car, chassis, bodies, settings, physics, scene, drive, place, goals: () => goals, stars: () => stars, strikes: () => strikes };
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


test("lost wheels park until a neutral reconnect or keyboard takeover", () => {
  const handoff = createControllerHandoff();
  assert.equal(handoff(undefined, true, false), "controller");
  assert.equal(handoff("wheel", true, false), "controller");
  assert.equal(handoff(undefined, true, false), "park");
  assert.equal(handoff("wheel", false, false), "park");
  assert.equal(handoff("wheel", false, true), "keyboard");
  assert.equal(handoff("wheel", false, false), "keyboard");
  assert.equal(handoff("wheel", true, false), "keyboard");
  assert.equal(handoff("wheel", true, false), "controller");
  assert.equal(handoff("another pad", false, false), "park");
});

test("the lowest speed remains steerable and parking prevents automatic throttle", (t) => {
  const { chassis, car, drive, place, settings } = playground(t);
  settings.speed = 2;
  place(12, -42);
  let peak = 0;
  drive(5, { steer: .55 }, () => { peak = Math.max(peak, car.speed()); });
  assert.ok(peak > 1.15 && peak < 2.1);
  assert.ok(car.root.position.x > 14);
  drive(1, { parking: true });
  assert.ok(Math.hypot(chassis.linvel().x, chassis.linvel().z) < .22);
  const parked = car.root.position.clone();
  const revision = car.revision();
  drive(6, { parking: true });
  assert.ok(Vector3.Distance(parked, car.root.position) < .4);
  assert.equal(car.revision(), revision);
  drive(2);
  assert.ok(Vector3.Distance(parked, car.root.position) > 1.5);
});

test("slow driving reaches the stunt summit and stays controlled down the main slope", (t) => {
  const { car, drive, place, settings } = playground(t);
  settings.speed = 4;
  place(-79, 48, -Math.PI / 2);
  drive(24);
  assert.ok(car.root.position.x < -140 && car.root.position.y > 10);
  place(-151, 49, Math.PI, 11.87);
  let peak = 0;
  drive(27, {}, () => { peak = Math.max(peak, car.speed()); });
  assert.ok(car.root.position.z < -30 && car.root.position.y < 3.4);
  assert.ok(peak < 4.6);
});

test("the halfpipe has a traversable curved wall and flat open ends", (t) => {
  const { car, physics, drive, place, settings } = playground(t);
  settings.speed = 8;
  place(-116, -39, Math.PI / 2);
  let peak = 0;
  drive(5, {}, ({ y }) => { peak = Math.max(peak, y); });
  assert.ok(peak > 3 && car.root.position.x > -98);
  const height = (x, z) => {
    const ray = new RAPIER.Ray({ x, y: 20, z }, { x: 0, y: -1, z: 0 });
    return 20 - physics.castRay(ray, 24, true, RAPIER.QueryFilterFlags.ONLY_FIXED).timeOfImpact;
  };
  assert.ok(height(-106, -39) - height(-116, -39) > 2);
  assert.ok(height(-106, -13) < .15 && height(-106, -65) < .15);
});

test("the car can knock over bowling pins and revisit collectible stars", (t) => {
  const { car, scene, drive, place, stars, strikes, settings } = playground(t);
  settings.speed = 5;
  place(-96, 10, -Math.PI / 2);
  drive(5);
  assert.ok(strikes() > 0);
  place(-12, -22);
  drive(2);
  assert.equal(stars(), 1);
  drive(1);
  assert.equal(stars(), 1);
  assert.ok(scene.meshes.some((mesh) => mesh.name === "collectible star" && !mesh.isEnabled()));
  place(-30, -43);
  drive(stepTime);
  assert.ok(scene.meshes.filter((mesh) => mesh.name === "collectible star").every((mesh) => mesh.isEnabled()));
  place(-12, -22);
  drive(2);
  assert.equal(stars(), 2);
  assert.ok(car.root.position.z > -18);
});

test("a wedged car reverses away on its own", (t) => {
  const { car, physics, drive, place, settings } = playground(t);
  settings.speed = 4;
  physics.createCollider(RAPIER.ColliderDesc.cuboid(2, 1, .5).setTranslation(13, 1, -23));
  place(13, -33);
  drive(3.7);
  let backedUp = false;
  let previousZ = car.root.position.z;
  drive(7, {}, ({ z }) => { backedUp ||= z < previousZ - .012; previousZ = z; });
  assert.ok(backedUp);
  assert.ok(car.root.position.z > -22 || Math.abs(car.root.position.x - 13) > 2.4);
});


test("the chase camera pulls in before a wall and eases back when clear", (t) => {
  const { car, scene, physics, place } = playground(t);
  const wall = physics.createCollider(RAPIER.ColliderDesc.cuboid(2, 2, .3).setTranslation(8, 2, -33));
  place(8, -30);
  physics.step();
  car.sync();
  const chase = createChaseCamera(scene, physics, car, spawn);
  chase.update(stepTime);
  const close = chase.camera.position.z;
  assert.ok(close > -32.65 && close < -30.5);

  physics.removeCollider(wall, true);
  physics.step();
  chase.update(stepTime);
  assert.ok(chase.camera.position.z < close && chase.camera.position.z > close - 1);
  for (let i = 0; i < 90; i++) chase.update(stepTime);
  assert.ok(chase.camera.position.z < -36.5);
});
