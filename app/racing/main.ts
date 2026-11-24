import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { createRacingAudio } from "./audio";
import { createDrivingParticles } from "./particles";
import { createControls } from "./controls";
import { createVehicle, stepTime } from "./vehicle";
import { createWorld, spawn } from "./world";
import "./racing.css";

async function start() {
  const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
  await RAPIER.init();
  const engine = new Engine(canvas, true);
  engine.renderEvenInBackground = false;
  const preferredScale = 1 / Math.min(window.devicePixelRatio || 1, 1.35);
  engine.setHardwareScalingLevel(preferredScale);
  let qualitySamples = 0;
  let totalFrameTime = 0;
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
  const audio = createRacingAudio();
  audio.update(controls.settings.sound, true, 0, true, 0);
  const particles = createDrivingParticles(scene);
  const contacts = new RAPIER.EventQueue(true);
  let impact = 0;
  const collectImpact = (event: RAPIER.TempContactForceEvent) => {
    if (car.ownsCollider(event.collider1()) || car.ownsCollider(event.collider2())) {
      impact = Math.max(impact, Math.min(1, (event.totalForceMagnitude() - 2800) / 8500));
    }
  };
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
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) audio.update(controls.settings.sound, false, 0, true, 0);
  });
  engine.runRenderLoop(() => {
    const rawFrameTime = engine.getDeltaTime();
    const dt = Math.min(rawFrameTime / 1000, .075);
    const input = controls.read();
    const active = !controls.paused();
    impact = 0;
    let scored = false;
    if (!active) {
      accumulator = 0;
    } else {
      accumulator += dt;
      while (accumulator >= stepTime) {
        car.step(input, controls.settings);
        physics.step(contacts);
        scored = playground.checkGoals(stepTime, car.root.position) || scored;
        contacts.drainContactForceEvents(collectImpact);
        impact = Math.max(impact, car.takeLanding());
        accumulator -= stepTime;
      }
      const renderScale = engine.getHardwareScalingLevel();
      if (renderScale < 1.5 && rawFrameTime > 0 && rawFrameTime < 150) {
        totalFrameTime += rawFrameTime;
        if (++qualitySamples === 120) {
          if (totalFrameTime / qualitySamples > 23) {
            engine.setHardwareScalingLevel(Math.min(1.5, renderScale * 1.15));
          }
          qualitySamples = totalFrameTime = 0;
        }
      }
    }
    car.setLook(controls.settings.car);
    car.sync(active ? accumulator / stepTime : 1, dt);
    const speed = car.speed();
    const grounded = car.grounded();
    const boost = car.boost();
    playground.sync(car.root.position, boost, active ? dt : 0);
    audio.update(controls.settings.sound, active, speed, grounded, boost);
    if (active) {
      audio.impact(impact);
      if (scored) audio.goalChime();
      particles.update(dt, car.root.position, car.root.rotationQuaternion!, speed, grounded, boost, impact,
        playground.isGrass(car.root.position));
    }
    updateCamera(dt);
    scene.render();
  });
  window.addEventListener("resize", () => engine.resize());
}

void start().catch((error: unknown) => {
  console.error(error);
  document.querySelector("#status")!.textContent = "Kunne ikke starte 3D-spillet. Prøv å laste siden på nytt.";
});
