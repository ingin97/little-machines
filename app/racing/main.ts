import { Color3, Color4, DirectionalLight, Engine, FreeCamera, HemisphericLight, Scene, ShadowGenerator, Vector3 } from "@babylonjs/core";
import RAPIER from "@dimforge/rapier3d-compat";
import { createControls } from "./controls";
import { createVehicle, stepTime } from "./vehicle";
import { createWorld, spawn } from "./world";
import "./racing.css";

async function start() {
  const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
  await RAPIER.init();
  const engine = new Engine(canvas, true);
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
  const scene = new Scene(engine);
  scene.clearColor = Color4.FromHexString("#A6E0EBFF");
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = Color3.FromHexString("#A6E0EB");
  scene.fogStart = 93;
  scene.fogEnd = 272;

  const ambient = new HemisphericLight("sky", new Vector3(0, 1, 0), scene);
  ambient.intensity = .84;
  ambient.groundColor = Color3.FromHexString("#B4BC93");
  const sun = new DirectionalLight("sun", new Vector3(-.45, -1, .36), scene);
  sun.intensity = 1.18;
  sun.shadowFrustumSize = 44;
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = 95;
  const shadows = new ShadowGenerator(1024, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.bias = .001;
  shadows.normalBias = .07;

  const physics = new RAPIER.World({ x: 0, y: -16, z: 0 });
  physics.timestep = stepTime;
  const playground = createWorld(scene, physics, shadows);
  const car = createVehicle(scene, physics, shadows, spawn, playground.padAt);
  const controls = createControls(car.reset);
  const camera = new FreeCamera("chase", Vector3.Zero(), scene);
  camera.minZ = .14;
  camera.maxZ = 300;
  camera.fov = .93;
  const target = new Vector3();
  const desired = new Vector3();
  const aim = new Vector3();
  const worldForward = new Vector3();
  const localForward = new Vector3(0, 0, 1);
  const localUp = new Vector3(0, 1, 0);
  const worldUp = new Vector3();
  const anchor = new Vector3();
  const sightline = new Vector3();
  const cameraRay = new RAPIER.Ray(anchor, sightline);
  let heading = spawn.heading;
  let lastReset = 0;
  let accumulator = 0;

  function updateCamera(dt: number) {
    const p = car.root.position;
    const attitude = car.root.rotationQuaternion!;
    localForward.rotateByQuaternionToRef(attitude, worldForward);
    localUp.rotateByQuaternionToRef(attitude, worldUp);
    const reset = lastReset !== car.revision();
    lastReset = car.revision();
    if (worldUp.y > .42 && worldForward.x ** 2 + worldForward.z ** 2 > .22) {
      const angle = Math.atan2(worldForward.x, worldForward.z);
      const delta = Math.atan2(Math.sin(angle - heading), Math.cos(angle - heading));
      heading += delta * (reset ? 1 : 1 - Math.exp(-4.4 * dt));
    }
    const x = Math.sin(heading);
    const z = Math.cos(heading);
    desired.set(p.x - x * 8.9, p.y + 4.55, p.z - z * 8.9);
    aim.set(p.x + x * 3.4, p.y + .54, p.z + z * 3.4);
    Vector3.LerpToRef(camera.position, desired, reset ? 1 : 1 - Math.exp(-8 * dt), camera.position);
    // Clamp after smoothing so the camera cannot cross a tunnel roof or bridge deck.
    anchor.set(p.x, p.y + .58, p.z);
    camera.position.subtractToRef(anchor, sightline);
    const distance = sightline.length();
    if (distance > .01) {
      sightline.scaleInPlace(1 / distance);
      const hit = physics.castRay(cameraRay, distance, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
      if (hit) {
        sightline.scaleInPlace(Math.max(.24, hit.timeOfImpact - .45));
        anchor.addToRef(sightline, camera.position);
      }
    }
    Vector3.LerpToRef(target, aim, reset ? 1 : 1 - Math.exp(-7 * dt), target);
    camera.setTarget(target);
    sun.position.set(p.x + 18, 42, p.z - 16);
  }

  updateCamera(0);
  engine.runRenderLoop(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, .075);
    const input = controls.read();
    if (controls.paused()) {
      accumulator = 0;
    } else {
      accumulator += dt;
      while (accumulator >= stepTime) {
        car.step(input, controls.settings);
        physics.step();
        accumulator -= stepTime;
      }
    }
    car.sync();
    playground.sync(car.root.position, car.boost());
    updateCamera(dt);
    scene.render();
  });
  window.addEventListener("resize", () => engine.resize());
}

void start().catch((error: unknown) => {
  console.error(error);
  document.querySelector("#status")!.textContent = "Kunne ikke starte 3D-spillet. Prøv å laste siden på nytt.";
});
