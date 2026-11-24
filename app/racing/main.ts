import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { createRacingAudio } from "./audio";
import { createDrivingParticles } from "./particles";
import { createChaseCamera } from "./camera";
import { createLocalMultiplayer } from "./localMultiplayer";
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
  const keyboardTab = new URLSearchParams(location.search).get("input") === "keyboard";
  const startingLane = keyboardTab ? { ...spawn, x: -3.35 } : spawn;
  const car = createVehicle(scene, physics, shadows, startingLane, playground.padAt);
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
  const chase = createChaseCamera(scene, physics, car, startingLane);
  let accumulator = 0;
  chase.update(0);
  const localPlayers = createLocalMultiplayer(scene, () => {
    const point = car.root.position;
    const rotation = car.root.rotationQuaternion!;
    return {
      position: [point.x, point.y, point.z],
      rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
      look: controls.settings.car,
      speed: controls.paused() ? 0 : car.wheelSpeed(),
      steering: car.steering(),
      reset: car.revision(),
    };
  }, document.querySelector("#local-players")!);
  window.addEventListener("pagehide", () => localPlayers.disconnect());
  window.addEventListener("pageshow", () => localPlayers.reconnect());
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
    let collected = false;
    let knocked = false;
    if (!active) {
      accumulator = 0;
    } else {
      accumulator += dt;
      while (accumulator >= stepTime) {
        car.step(input, controls.settings);
        physics.step(contacts);
        scored = playground.checkGoals(stepTime, car.root.position) || scored;
        const feedback = playground.stepStuntToys(stepTime, car.position());
        collected ||= feedback.collected;
        knocked ||= feedback.knocked;
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
      if (collected) audio.starChime();
      if (knocked) audio.bowlingChime();
      particles.update(dt, car.root.position, car.root.rotationQuaternion!, speed, grounded, boost, impact,
        playground.isGrass(car.root.position));
    }
    localPlayers.update(dt);
    chase.update(dt);
    sun.position.set(car.root.position.x + 18, 42, car.root.position.z - 16);
    scene.render();
  });
  window.addEventListener("resize", () => engine.resize());
}

void start().catch((error: unknown) => {
  console.error(error);
  document.querySelector("#status")!.textContent = "Kunne ikke starte 3D-spillet. Prøv å laste siden på nytt.";
});
