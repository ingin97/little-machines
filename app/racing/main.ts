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
import { createVehicle, sprintHandling, sprintTopSpeed, stepTime } from "./vehicle";
import { createWorld, spawn } from "./world";
import { createSprintCourse } from "./sprintCourse";
import { addProceduralSprintGates, buildProceduralSprints } from "./proceduralSprint.ts";
import { createSprint } from "./sprint";
import { classicWorldIdentity, definitionIdentity } from "./worldDefinition.ts";
import { createDefinedWorld } from "./worldRuntime.ts";
import { readWorldChoice, resolveWorld, worldURL } from "./worldSelection.ts";
import { setupWorldPicker } from "./worldPicker.ts";
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
  const params = new URLSearchParams(location.search);
  const racing = params.get("mode") === "sprint";
  const ridge = params.get("track") === "ridge";
  let choice: ReturnType<typeof readWorldChoice> = { id: "classic" };
  try {
    choice = readWorldChoice(params);
  } catch (error) {
    const status = document.querySelector("#status")!;
    const returnLink = document.createElement("a");
    returnLink.href = worldURL(choice, location.href).href;
    returnLink.textContent = "Åpne Kjøreparken";
    status.replaceChildren(error instanceof Error ? error.message + " " : "", returnLink);
    engine.dispose();
    physics.free();
    return;
  }
  const selectedWorld = resolveWorld(choice);
  const definition = racing && (!selectedWorld?.generation || params.has("track")) ? undefined : selectedWorld;
  if (definition) {
    ambient.intensity = .70;
    sun.intensity = .85;
  }
  const identity = definition ? await definitionIdentity(definition) : classicWorldIdentity;
  const raceLayouts = racing && selectedWorld?.generation
    ? buildProceduralSprints(selectedWorld, definition ? identity.hash : "") : [];
  const layout = definition && (raceLayouts.find(({ id }) => id === params.get("route")) ?? raceLayouts[0]);
  const proceduralCourse = layout && addProceduralSprintGates(scene, layout);
  const classicCourse = racing && !proceduralCourse ? createSprintCourse(scene, physics, ridge) : undefined;
  const course = proceduralCourse ?? classicCourse;
  const worldDialog = racing ? undefined : setupWorldPicker(choice);
  const playground = definition ? createDefinedWorld(scene, physics, shadows, definition, !racing)
    : racing ? undefined : createWorld(scene, physics, shadows);
  const startingLane = course?.spawn ?? definition?.spawn ?? (params.get("input") === "keyboard" ? { ...spawn, x: -3.35 } : spawn);
  const car = createVehicle(scene, physics, shadows, startingLane, playground?.padAt ?? (() => -1),
    racing ? sprintHandling : undefined, definition?.terrain.halfExtent);
  const sprint = course && createSprint(scene, course, car);
  const controls = createControls(sprint?.reset ?? car.reset, racing, worldDialog);
  if (racing) {
    document.body.dataset.mode = "sprint";
    const title = layout?.name ?? "Tidkjøring";
    document.title = `${title} · Kjøreparken`;
    document.querySelector("h1")!.textContent = title;
    document.querySelector("canvas")!.setAttribute("aria-label", "Tidkjøring");
    document.querySelector<HTMLElement>("#sprint-hud")!.hidden = false;
    document.querySelector<HTMLButtonElement>("#sprint-retry")!.hidden = false;
    document.querySelector<HTMLButtonElement>("#sprint-retry")!.onclick = sprint!.reset;
    document.querySelector<HTMLAnchorElement>("#sprint-mode")!.hidden = true;
    const parkLink = document.querySelector<HTMLAnchorElement>("#park-mode")!;
    for (const [index, race] of raceLayouts.entries()) {
      const link = document.createElement("a");
      const url = worldURL(choice, location.href);
      url.searchParams.set("mode", "sprint");
      if (race.id !== "legacy") url.searchParams.set("route", race.id);
      link.href = url.href;
      link.textContent = race.id === "legacy" ? selectedWorld!.name : race.name;
      if (layout?.id === race.id) link.setAttribute("aria-current", "page");
      const tracks = document.querySelector(".sprint-tracks")!;
      tracks.insertBefore(link, tracks.children[index]);
    }
    for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-track]")) {
      const trackParams = new URLSearchParams(params);
      trackParams.delete("route");
      if (link.dataset.track === "ridge" || selectedWorld?.generation) trackParams.set("track", link.dataset.track!);
      else trackParams.delete("track");
      link.href = `?${trackParams}`;
      if (!proceduralCourse && (link.dataset.track === "ridge") === ridge) link.setAttribute("aria-current", "page");
    }
    if (selectedWorld?.generation) parkLink.textContent = "Fri kjøring";
    params.delete("mode");
    params.delete("track");
    params.delete("route");
    parkLink.href = params.size ? `?${params}` : "./racing.html";
    parkLink.hidden = false;
  } else {
    const sprintLink = worldURL(choice, location.href);
    sprintLink.searchParams.set("mode", "sprint");
    document.querySelector<HTMLAnchorElement>("#sprint-mode")!.href = sprintLink.href;
  }
  const raceSettings = { ...controls.settings, speed: sprintTopSpeed, automatic: false, gentle: false, reverse: false, recovery: false };
  const offRoadSettings = { ...raceSettings, speed: 10 };
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
  const localPlayers = !racing ? createLocalMultiplayer(scene, () => {
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
  }, document.querySelector("#local-players")!, identity) : undefined;
  window.addEventListener("pagehide", () => localPlayers?.disconnect());
  window.addEventListener("pageshow", () => localPlayers?.reconnect());
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
        if (!sprint || sprint.beforeStep()) {
          const position = car.position();
          const offRoad = proceduralCourse?.isOffRoad(position) ?? classicCourse?.isGrass(position);
          car.step(input, course ? (offRoad ? offRoadSettings : raceSettings) : controls.settings);
          physics.step(contacts);
          sprint?.afterStep();
          if (playground) {
            scored = playground.checkGoals(stepTime, car.root.position) || scored;
            const feedback = playground.stepStuntToys(stepTime, car.position());
            collected ||= feedback.collected;
            knocked ||= feedback.knocked;
          }
          contacts.drainContactForceEvents(collectImpact);
          impact = Math.max(impact, car.takeLanding());
        }
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
    car.sync(active && (!sprint || sprint.driving()) ? accumulator / stepTime : 1, dt);
    const speed = car.speed();
    const grounded = car.grounded();
    const boost = car.boost();
    const surface = classicCourse?.isGrass(car.root.position) ? "grass" : car.surface();
    playground?.sync(car.root.position, boost, active ? dt : 0);
    audio.update(controls.settings.sound, active, sprint && !sprint.driving() ? 0 : speed, grounded, boost, surface, car.skid());
    sprint?.draw(active ? accumulator / stepTime : 1);
    if (active && (!sprint || sprint.driving())) {
      audio.impact(impact);
      if (scored) audio.goalChime();
      if (collected) audio.starChime();
      if (knocked) audio.bowlingChime();
      particles.update(dt, car.root.position, car.root.rotationQuaternion!, speed, grounded, boost, impact,
        surface, car.skid());
    }
    localPlayers?.update(dt);
    chase.update(dt);
    sun.position.set(car.root.position.x + 18, Math.max(42, car.root.position.y + 32), car.root.position.z - 16);
    scene.render();
  });
  window.addEventListener("resize", () => engine.resize());
}

void start().catch((error: unknown) => {
  console.error(error);
  document.querySelector("#status")!.textContent = "Kunne ikke starte 3D-spillet. Prøv å laste siden på nytt.";
});
