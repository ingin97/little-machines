import assert from "node:assert/strict";
import { test } from "node:test";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Scene } from "@babylonjs/core/scene.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { drivingSurfaces, setColliderSurface } from "../app/racing/drivingSurfaces.ts";
import { createVehicle, stepTime } from "../app/racing/vehicle.ts";

await RAPIER.init();

function surfaceRun(t, left, right = left, gentle = false) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const sun = new DirectionalLight("sun", new Vector3(-.45, -1, .36), scene);
  const shadows = new ShadowGenerator(64, sun);
  const physics = new RAPIER.World({ x: 0, y: -16, z: 0 });
  t.after(() => { scene.dispose(); engine.dispose(); physics.free(); });
  physics.timestep = stepTime;
  for (const [x, surface] of [[-50, left], [50, right]]) {
    const ground = physics.createCollider(RAPIER.ColliderDesc.cuboid(50, .5, 100).setTranslation(x, -.5, 0));
    setColliderSurface(physics, ground, surface);
  }
  const car = createVehicle(scene, physics, shadows, { x: 0, y: .87, z: 0, heading: 0 }, () => -1);
  let body;
  physics.forEachRigidBody((item) => { body = item; });
  const settings = { automatic: false, gentle, reverse: true, recovery: true, speed: 30, dead: 8, calibration: null };
  function drive(seconds, input = {}) {
    const controls = { steer: 0, accelerator: 0, brake: 0, ...input };
    for (let i = 0; i < Math.round(seconds / stepTime); i++) {
      car.step(controls, settings);
      physics.step();
    }
    return car.speed();
  }
  drive(.5);
  return { car, body, drive };
}

test("sand and mud reduce acceleration, while ice lengthens braking", (t) => {
  const asphalt = surfaceRun(t, "asphalt");
  const sand = surfaceRun(t, "sand");
  const mud = surfaceRun(t, "mud");
  const ice = surfaceRun(t, "ice");
  const speeds = [asphalt, sand, mud].map(({ drive }) => drive(1, { accelerator: 1 }));
  assert.ok(speeds[0] > speeds[1] + 1 && speeds[1] > speeds[2] + 1, speeds.join(", "));
  asphalt.body.setLinvel({ x: 0, y: 0, z: 15 }, true);
  ice.body.setLinvel({ x: 0, y: 0, z: 15 }, true);
  assert.ok(ice.drive(.4, { brake: 1 }) > asphalt.drive(.4, { brake: 1 }) + 1);
});

test("each wheel reads its own collider and toddler mode moderates loose surfaces", (t) => {
  const mixed = surfaceRun(t, "grass", "ice");
  assert.deepEqual(mixed.car.wheelSurfaces().sort(), ["grass", "grass", "ice", "ice"]);
  const adult = surfaceRun(t, "mud");
  const toddler = surfaceRun(t, "mud", "mud", true);
  assert.ok(toddler.drive(1, { accelerator: 1 }) > adult.drive(1, { accelerator: 1 }) + 1);
});

test("toddler recovery works on all six driving surfaces", (t) => {
  for (const surface of Object.keys(drivingSurfaces)) {
    const { car, body, drive } = surfaceRun(t, surface, surface, true);
    assert.deepEqual(car.wheelSurfaces(), Array(4).fill(surface));
    const revision = car.revision();
    body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
    drive(3);
    assert.ok(car.revision() > revision, surface);
    assert.ok(drive(1, { accelerator: 1 }) > 1, surface);
  }
});
