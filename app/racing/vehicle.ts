import { MeshBuilder, Quaternion, Scene, ShadowGenerator, TransformNode, Vector3 } from "@babylonjs/core";
import RAPIER from "@dimforge/rapier3d-compat";
import { clamp } from "../driveInput.ts";
import type { DriveInput, DrivingSettings } from "./controls.ts";
import { paint } from "./surfaces.ts";
import { boundary, type Spawn } from "./world.ts";

const wheelRadius = .4;
const axleHeight = -.09;
const restLength = .35;
const localUp = new Vector3(0, 1, 0);
const localForward = new Vector3(0, 0, 1);
const up = new Vector3();
const forward = new Vector3();
const attitude = new Quaternion();
export const stepTime = 1 / 60;

export function createVehicle(scene: Scene, physics: RAPIER.World, shadows: ShadowGenerator, spawn: Spawn, padAt: (position: RAPIER.Vector) => number) {
  const body = physics.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setLinearDamping(.14).setAngularDamping(1.4).setCcdEnabled(true));
  physics.createCollider(RAPIER.ColliderDesc.cuboid(.85, .27, 1.5)
    .setMass(180).setFriction(.55).setRestitution(.14), body);
  physics.createCollider(RAPIER.ColliderDesc.cuboid(.66, .29, .68).setTranslation(0, .5, -.25)
    .setMass(20).setFriction(.46), body);
  const controller = physics.createVehicleController(body);
  controller.indexUpAxis = 1;
  controller.setIndexForwardAxis = 2;

  const root = new TransformNode("car", scene);
  root.rotationQuaternion = Quaternion.Identity();
  const orange = paint(scene, "#ff6538");
  const cream = paint(scene, "#fff0bd");
  const black = paint(scene, "#26363e");
  const glass = paint(scene, "#376d82");
  const red = paint(scene, "#b52f37");
  function box(name: string, width: number, height: number, depth: number, x: number, y: number, z: number, material: typeof orange) {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    mesh.parent = root;
    mesh.position.set(x, y, z);
    mesh.material = material;
    shadows.addShadowCaster(mesh);
  }
  box("chassis", 1.78, .47, 3.02, 0, 0, 0, orange);
  box("hood", 1.66, .18, 1.12, 0, .24, .85, orange);
  box("cab", 1.37, .6, 1.32, 0, .47, -.24, glass);
  box("roof", 1.46, .14, 1.44, 0, .8, -.24, orange);
  box("front bumper", 1.79, .17, .19, 0, -.16, 1.51, cream);
  box("rear bumper", 1.79, .17, .19, 0, -.16, -1.51, black);
  for (const side of [-1, 1]) {
    box("headlight", .34, .18, .08, side * .54, .15, 1.52, cream);
    box("tail light", .32, .18, .08, side * .54, .13, -1.52, red);
  }

  const wheels: { pivot: TransformNode; spin: TransformNode }[] = [];
  for (const z of [1.05, -1.05]) {
    for (const x of [-.89, .89]) {
      const i = wheels.length;
      controller.addWheel({ x, y: axleHeight, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, restLength, wheelRadius);
      controller.setWheelSuspensionStiffness(i, 28);
      controller.setWheelSuspensionCompression(i, 4.6);
      controller.setWheelSuspensionRelaxation(i, 3.8);
      controller.setWheelMaxSuspensionTravel(i, .23);
      controller.setWheelMaxSuspensionForce(i, 3000);
      controller.setWheelFrictionSlip(i, 2.2);
      controller.setWheelSideFrictionStiffness(i, 1.15);
      const pivot = new TransformNode("steering knuckle", scene);
      pivot.parent = root;
      pivot.position.set(x, axleHeight - restLength, z);
      const spin = new TransformNode("wheel axle", scene);
      spin.parent = pivot;
      for (const [name, diameter, width, material] of [["tire", .8, .34, black], ["hub", .46, .355, cream]] as const) {
        const mesh = MeshBuilder.CreateCylinder(name, { diameter, height: width, tessellation: 16 }, scene);
        mesh.rotation.z = Math.PI / 2;
        mesh.parent = spin;
        mesh.material = material;
        shadows.addShadowCaster(mesh);
      }
      // An offset hub marker makes wheel rotation readable even at low speed.
      const marker = MeshBuilder.CreateBox("hub marker", { width: .02, height: .10, depth: .08 }, scene);
      marker.parent = spin;
      marker.position.set(Math.sign(x) * .181, .12, 0);
      marker.material = orange;
      wheels.push({ pivot, spin });
    }
  }

  let steering = 0;
  let stuck = 0;
  let overturned = 0;
  let reverseTime = 0;
  let cooldown = 0;
  let checkpoint = { ...spawn };
  let groundedTime = 0;
  let revision = 0;
  let reverseAttempts = 0;
  let reversingSide = -1;
  let boostTime = 0;
  let occupiedPad = -1;
  const recoverySpace = new RAPIER.Cuboid(1.09, .48, 1.7);

  function clearForRecovery(at: Spawn) {
    return !physics.intersectionWithShape({ x: at.x, y: at.y + .24, z: at.z },
      Quaternion.RotationAxis(localUp, at.heading), recoverySpace,
      undefined, undefined, undefined, body);
  }

  function recover(heading = checkpoint.heading) {
    const candidate = { ...checkpoint, heading };
    reset(clearForRecovery(candidate) ? candidate : spawn);
  }

  function reset(at: Spawn = spawn) {
    body.setTranslation({ x: at.x, y: at.y, z: at.z }, true);
    body.setRotation(Quaternion.RotationAxis(localUp, at.heading), true);
    body.setLinvel(Vector3.Zero(), true);
    body.setAngvel(Vector3.Zero(), true);
    steering = stuck = overturned = reverseTime = groundedTime = 0;
    cooldown = 2.4;
    reverseAttempts = 0;
    boostTime = 0;
    occupiedPad = -1;
    checkpoint = { ...at };
    revision++;
    sync();
  }

  function sync() {
    const point = body.translation();
    const rotation = body.rotation();
    root.position.set(point.x, point.y, point.z);
    root.rotationQuaternion!.set(rotation.x, rotation.y, rotation.z, rotation.w);
    for (const [i, { pivot, spin }] of wheels.entries()) {
      pivot.position.y = axleHeight - (controller.wheelSuspensionLength(i) ?? restLength);
      pivot.rotation.y = i < 2 ? steering : 0;
      spin.rotation.x = controller.wheelRotation(i) ?? 0;
    }
  }

  function step(input: DriveInput, settings: DrivingSettings) {
    const rotation = body.rotation();
    attitude.set(rotation.x, rotation.y, rotation.z, rotation.w);
    localUp.rotateByQuaternionToRef(attitude, up);
    localForward.rotateByQuaternionToRef(attitude, forward);
    const velocity = body.linvel();
    const point = body.translation();
    const speed = velocity.x * forward.x + velocity.z * forward.z;
    const planarSpeed = Math.hypot(velocity.x, velocity.z);
    const contacts = wheels.reduce((count, _, i) => count + Number(controller.wheelIsInContact(i)), 0);
    const grounded = contacts > 0;
    cooldown = Math.max(0, cooldown - stepTime);
    overturned = up.y < .32 && planarSpeed < 3 ? overturned + stepTime : 0;
    if (point.y < -12 || Math.hypot(point.x, point.z) > boundary) {
      if (settings.recovery) recover(Math.atan2(-point.x, -point.z));
      else reset();
      return;
    }
    if (settings.recovery && overturned > 1.15 && cooldown === 0) {
      recover();
      return;
    }

    const stable = contacts >= 3 && up.y > .97 && Math.abs(velocity.y) < .65 && speed > 3
      && Math.hypot(point.x, point.z) < boundary - 12;
    groundedTime = stable ? groundedTime + stepTime : 0;
    if (groundedTime > 1.1) {
      const candidate = { x: point.x, y: point.y + .12, z: point.z, heading: Math.atan2(forward.x, forward.z) };
      if (clearForRecovery(candidate)) checkpoint = candidate;
      groundedTime = 0;
      reverseAttempts = 0;
    }

    const throttle = settings.automatic ? 1 : input.accelerator;
    const brake = input.brake > .08 ? input.brake : 0;
    const pad = padAt(point);
    if (pad !== occupiedPad && pad >= 0 && grounded && speed > 2 && !brake) boostTime = 1.35;
    occupiedPad = pad;
    boostTime = brake ? 0 : Math.max(0, boostTime - stepTime);
    const boosting = boostTime > 0;
    const tryingToMove = throttle > .45 && brake === 0 && up.y > .4 && (grounded || Math.abs(velocity.y) < .3);
    stuck = settings.reverse && tryingToMove && planarSpeed < .65 && cooldown === 0 ? stuck + stepTime : 0;
    if (stuck > 1.45) {
      if (reverseAttempts >= 2 && settings.recovery) {
        recover();
        return;
      }
      reverseAttempts++;
      reversingSide *= -1;
      reverseTime = 1.35;
      cooldown = 3.4;
      stuck = 0;
    }
    if (!settings.reverse) reverseTime = 0;
    const backingOut = reverseTime > 0 && brake === 0;
    reverseTime = Math.max(0, reverseTime - stepTime);
    const targetAngle = .54 / (1 + planarSpeed * (settings.gentle ? .085 : .055));
    const steer = backingOut && Math.abs(input.steer) < .15 ? reversingSide * .9 : input.steer;
    steering += (steer * targetAngle - steering) * (1 - Math.exp(-12 * stepTime));
    const cap = settings.automatic && !boosting && input.accelerator < .12 ? settings.speed * .81 : settings.speed;
    const boostForce = boosting && grounded ? 3800 : 2200 * throttle;
    const drive = backingOut ? -1450 * clamp((speed + 4.5) / 2, 0, 1)
      : brake ? 0 : boostForce * clamp((cap - planarSpeed) / (boosting ? 1.2 : 3), 0, 1);

    const speedBraking = clamp((planarSpeed - settings.speed + .25) * 7, 0, 22);
    for (let i = 0; i < wheels.length; i++) {
      controller.setWheelSteering(i, i < 2 ? steering : 0);
      controller.setWheelEngineForce(i, drive / wheels.length);
      controller.setWheelBrake(i, Math.max(brake * 30, speedBraking, .15));
    }
    if (!grounded && up.y > -.6) {
      const angular = body.angvel();
      const strength = settings.gentle ? 280 : 135;
      body.applyTorqueImpulse({
        x: (-up.z * strength - angular.x * 50) * stepTime,
        y: input.steer * (settings.gentle ? 12 : 62) * stepTime,
        z: (up.x * strength - angular.z * 50) * stepTime,
      }, true);
    }
    controller.updateVehicle(stepTime, undefined, undefined, (collider) => collider.parent()?.handle !== body.handle);
  }

  reset();
  return { root, reset, sync, step, revision: () => revision, boost: () => Math.min(1, boostTime * 2) };
}
