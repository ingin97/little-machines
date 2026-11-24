import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { clamp } from "../driveInput.ts";
import type { DriveInput, DrivingSettings } from "./controls.ts";
import { axleHeight, createCarVisual, restLength, wheelMounts, wheelRadius } from "./carVisual.ts";
import { boundary, type Spawn } from "./world.ts";

const localUp = new Vector3(0, 1, 0);
const localForward = new Vector3(0, 0, 1);
const up = new Vector3();
const forward = new Vector3();
const attitude = new Quaternion();
export const stepTime = 1 / 60;

export function createVehicle(scene: Scene, physics: RAPIER.World, shadows: ShadowGenerator, spawn: Spawn, padAt: (position: RAPIER.Vector) => number) {
  const body = physics.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setLinearDamping(.14).setAngularDamping(1.4).setCcdEnabled(true));
  const contactEvents = RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS;
  const chassis = physics.createCollider(RAPIER.ColliderDesc.cuboid(.85, .27, 1.5)
    .setActiveEvents(contactEvents).setContactForceEventThreshold(2800).setMass(180).setFriction(.55).setRestitution(.14), body);
  const cabin = physics.createCollider(RAPIER.ColliderDesc.cuboid(.66, .29, .68).setTranslation(0, .5, -.25)
    .setActiveEvents(contactEvents).setContactForceEventThreshold(2800).setMass(20).setFriction(.46), body);
  const controller = physics.createVehicleController(body);
  controller.indexUpAxis = 1;
  controller.setIndexForwardAxis = 2;

  const { root, setLook, wheels, animateBody } = createCarVisual(scene, shadows);
  for (const [i, { x, z }] of wheelMounts.entries()) {
    controller.addWheel({ x, y: axleHeight, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, restLength, wheelRadius);
    controller.setWheelSuspensionStiffness(i, 27);
    controller.setWheelSuspensionCompression(i, 5.1);
    controller.setWheelSuspensionRelaxation(i, 4.1);
    controller.setWheelMaxSuspensionTravel(i, .23);
    controller.setWheelMaxSuspensionForce(i, 3000);
    controller.setWheelFrictionSlip(i, 2.2);
    controller.setWheelSideFrictionStiffness(i, 1.15);
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
  const obstruction = new Vector3();
  let reversingSide = -1;
  let boostTime = 0;
  let occupiedPad = -1;
  let currentSpeed = 0;
  let previousSpeed = 0;
  let groundedWheels = 0;
  let airborneTime = 0;
  let landing = 0;
  let pitch = 0;
  let roll = 0;
  let braking = false;
  const lastPosition = new Vector3();
  const lastRotation = new Quaternion();
  const currentPosition = new Vector3();
  const currentRotation = new Quaternion();
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
    currentSpeed = previousSpeed = groundedWheels = airborneTime = landing = pitch = roll = 0;
    braking = false;
    lastPosition.set(at.x, at.y, at.z);
    lastRotation.copyFrom(Quaternion.RotationAxis(localUp, at.heading));
    revision++;
    sync();
  }

  function sync(alpha = 1, dt = stepTime) {
    const point = body.translation();
    const rotation = body.rotation();
    currentPosition.set(point.x, point.y, point.z);
    currentRotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    Vector3.LerpToRef(lastPosition, currentPosition, alpha, root.position);
    Quaternion.SlerpToRef(lastRotation, currentRotation, alpha, root.rotationQuaternion!);
    animateBody(pitch, roll, braking);
    const blend = 1 - Math.exp(-30 * dt);
    for (const [i, { pivot, spin }] of wheels.entries()) {
      const length = clamp(controller.wheelSuspensionLength(i) ?? restLength, restLength - .23, restLength + .23);
      pivot.position.y += (axleHeight - length - pivot.position.y) * blend;
      pivot.rotation.y = i < 2 ? steering : 0;
      spin.rotation.x = controller.wheelRotation(i) ?? 0;
    }
  }

  function step(input: DriveInput, settings: DrivingSettings) {
    const rotation = body.rotation();
    attitude.set(rotation.x, rotation.y, rotation.z, rotation.w);
    localUp.rotateByQuaternionToRef(attitude, up);
    localForward.rotateByQuaternionToRef(attitude, forward);
    lastRotation.copyFrom(attitude);
    const velocity = body.linvel();
    const point = body.translation();
    lastPosition.set(point.x, point.y, point.z);
    const speed = velocity.x * forward.x + velocity.z * forward.z;
    const planarSpeed = Math.hypot(velocity.x, velocity.z);
    const contacts = wheels.reduce((count, _, i) => count + Number(controller.wheelIsInContact(i)), 0);
    const grounded = contacts > 0;
    cooldown = Math.max(0, cooldown - stepTime);
    overturned = up.y < .41 && planarSpeed < 3 ? overturned + stepTime : 0;
    if (point.y < -12 || Math.hypot(point.x, point.z) > boundary) {
      if (settings.recovery) recover(Math.atan2(-point.x, -point.z));
      else reset();
      return;
    }
    if (settings.recovery && overturned > 1.15 && cooldown === 0) {
      recover();
      return;
    }

    const stable = contacts >= 3 && up.y > .95 && Math.abs(velocity.y) < .85 && speed > 1.05
      && Math.hypot(point.x, point.z) < boundary - 12;
    groundedTime = stable ? groundedTime + stepTime : 0;
    if (reverseAttempts && Math.hypot(point.x - obstruction.x, point.z - obstruction.z) > 9) reverseAttempts = 0;
    if (groundedTime > 1.1 && !reverseAttempts) {
      const candidate = { x: point.x, y: point.y + .12, z: point.z, heading: Math.atan2(forward.x, forward.z) };
      if (clearForRecovery(candidate)) checkpoint = candidate;
      groundedTime = 0;
    }

    const throttle = input.parking ? 0 : settings.automatic ? 1 : input.accelerator;
    const brake = input.parking ? .36 : input.brake > .08 ? input.brake : 0;
    braking = brake > 0;
    currentSpeed = planarSpeed;
    groundedWheels = contacts;
    pitch += (clamp((previousSpeed - speed) * .22, -.065, .065) - pitch) * .16;
    roll += (steering * clamp(planarSpeed / 9, 0, 1) * .17 - roll) * .15;
    previousSpeed = speed;
    const pad = padAt(point);
    if (pad !== occupiedPad && pad >= 0 && grounded && speed > 2 && !brake) boostTime = 1.35;
    occupiedPad = pad;
    boostTime = brake ? 0 : Math.max(0, boostTime - stepTime);
    const boosting = boostTime > 0;
    const tryingToMove = throttle > .22 && brake === 0 && up.y > .34 && (grounded || Math.abs(velocity.y) < .25);
    stuck = (settings.reverse || settings.recovery) && tryingToMove && planarSpeed < .46 && cooldown === 0 ? stuck + stepTime : 0;
    const reverseCap = Math.min(4.5, settings.speed * .73);
    if (stuck > 1.45) {
      if (settings.recovery && (!settings.reverse || reverseAttempts >= 2)) {
        recover(checkpoint.heading + reversingSide * Math.PI / 2);
        return;
      }
      if (!reverseAttempts) obstruction.set(point.x, point.y, point.z);
      reverseAttempts++;
      reversingSide *= -1;
      reverseTime = clamp(7.4 / reverseCap, 1.6, 4.4);
      cooldown = reverseTime + 1.05;
      stuck = 0;
    }
    if (!settings.reverse) reverseTime = 0;
    const backingOut = reverseTime > 0 && brake === 0;
    reverseTime = Math.max(0, reverseTime - stepTime);
    const targetAngle = (settings.gentle ? .60 : .56) / (1 + planarSpeed * (settings.gentle ? .086 : .053));
    const proportional = settings.gentle ? input.steer * (.78 + .22 * input.steer ** 2) : input.steer;
    const steer = backingOut ? reversingSide * .72 + proportional * .25 : proportional;
    steering += (steer * targetAngle - steering) * (1 - Math.exp(-(input.parking ? 14 : 10) * stepTime));
    const cap = settings.automatic && !boosting && input.accelerator < .12 ? settings.speed * .81 : settings.speed;
    const boostForce = boosting && grounded ? 3800 : 2200 * throttle;
    const approach = boosting ? Math.min(1.2, cap * .33) : Math.min(3, cap * .38);
    const drive = backingOut ? -1450 * clamp((speed + reverseCap) / 1.6, 0, 1)
      : brake ? 0 : boostForce * clamp((cap - planarSpeed) / approach, 0, 1);

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
    if (wheels.some((_, i) => controller.wheelIsInContact(i))) {
      if (airborneTime > .18 && velocity.y < -2.6) landing = clamp((-velocity.y - 2.6) / 9, .15, 1);
      airborneTime = 0;
    } else {
      airborneTime += stepTime;
    }
  }

  reset();
  return {
    root, reset, sync, step, setLook,
    position: () => body.translation(), revision: () => revision, boost: () => Math.min(1, boostTime * 2),
    steering: () => steering, wheelSpeed: () => previousSpeed,
    speed: () => currentSpeed, grounded: () => groundedWheels > 0,
    ownsCollider: (handle: number) => handle === chassis.handle || handle === cabin.handle,
    takeLanding: () => { const strength = landing; landing = 0; return strength; },
  };
}
