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
export const sprintTopSpeed = 38;

const playgroundHandling = { engineForce: 2200, brakeForce: 30, grip: 2.2, sideGrip: 1.15, highSpeedSteerRate: 10, powerTaper: 3, crestLift: 0, keepLandingSpeed: false, smoothLandingSteer: false, manualReverseSpeed: 0 };
export const sprintHandling = { engineForce: 2350, brakeForce: 9, grip: 2.7, sideGrip: 1.35, highSpeedSteerRate: 4.8, powerTaper: 7, crestLift: 2.1, keepLandingSpeed: true, smoothLandingSteer: true, manualReverseSpeed: 6 };

export function createVehicle(scene: Scene, physics: RAPIER.World, shadows: ShadowGenerator, spawn: Spawn, padAt: (position: RAPIER.Vector) => number, handling = playgroundHandling) {
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
    controller.setWheelFrictionSlip(i, handling.grip);
    controller.setWheelSideFrictionStiffness(i, handling.sideGrip);
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
  let launchCooldown = 0;
  let steeringGrip = 1;
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
    currentSpeed = previousSpeed = groundedWheels = airborneTime = landing = launchCooldown = pitch = roll = 0;
    braking = false;
    steeringGrip = 1;
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
      pivot.rotation.y = i < 2 ? steering * steeringGrip : 0;
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
    const reversing = Boolean(handling.manualReverseSpeed && !input.parking && input.brake > .08
      && input.accelerator <= .08 && speed < .55 && (speed < -.1 || planarSpeed < 1));
    const brake = reversing ? 0 : input.parking ? .36 : input.brake > .08 ? input.brake : 0;
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
    const targetSteering = steer * targetAngle;
    const buildingSteer = Math.sign(targetSteering) !== Math.sign(steering) || Math.abs(targetSteering) > Math.abs(steering);
    const steerRate = buildingSteer && steer !== 0
      ? 10 + (handling.highSpeedSteerRate - 10) * clamp((planarSpeed - 8) / 22, 0, 1)
      : 10;
    steering += (targetSteering - steering) * (1 - Math.exp(-(input.parking ? 14 : steerRate) * stepTime));
    const cap = settings.automatic && !boosting && input.accelerator < .12 ? settings.speed * .81 : settings.speed;
    const boostForce = boosting && grounded ? 3800 : handling.engineForce * throttle;
    const approach = boosting ? Math.min(1.2, cap * .33) : Math.min(handling.powerTaper, cap * .38);
    const manualReverseForce = -handling.engineForce * .55 * input.brake
      * clamp((speed + handling.manualReverseSpeed) / 1.6, 0, 1);
    const drive = reversing ? manualReverseForce
      : backingOut ? -1450 * clamp((speed + reverseCap) / 1.6, 0, 1)
        : brake ? 0 : boostForce * clamp((cap - planarSpeed) / approach, 0, 1);

    if (handling.smoothLandingSteer) {
      // Restore steering as the suspension loads again so a tap can't yank one loaded tire.
      steeringGrip = contacts < 2 && planarSpeed > 9
        ? .28
        : Math.min(1, steeringGrip + stepTime / .24);
    }
    const speedBraking = clamp((planarSpeed - settings.speed + .25) * 7, 0, Math.min(22, handling.brakeForce));
    for (let i = 0; i < wheels.length; i++) {
      controller.setWheelSteering(i, i < 2 ? steering * steeringGrip : 0);
      if (handling.smoothLandingSteer) {
        controller.setWheelSideFrictionStiffness(i, handling.sideGrip * (.5 + .5 * steeringGrip));
      }
      controller.setWheelEngineForce(i, drive / wheels.length);
      controller.setWheelBrake(i, Math.max(brake * handling.brakeForce, speedBraking, .15));
    }
    const frontOnRoad = controller.wheelIsInContact(0) || controller.wheelIsInContact(1);
    if (!grounded && up.y > -.6) {
      const angular = body.angvel();
      const strength = settings.gentle || handling.crestLift ? 280 : 135;
      body.applyTorqueImpulse({
        x: (-up.z * strength - angular.x * 50) * stepTime,
        y: input.steer * (settings.gentle ? 12 : handling.smoothLandingSteer ? 22 : 62) * stepTime,
        z: (up.x * strength - angular.z * 50) * stepTime,
      }, true);
    }
    controller.updateVehicle(stepTime, undefined, undefined, (collider) => collider.parent()?.handle !== body.handle);
    launchCooldown = Math.max(0, launchCooldown - stepTime);
    // At a fast crest, lift the chassis as the front tires clear the road so the tail follows them.
    if (handling.crestLift && !launchCooldown && frontOnRoad
      && !controller.wheelIsInContact(0) && !controller.wheelIsInContact(1)
      && speed > 19 && velocity.y > .55 && forward.y > .035 && up.y > .8) {
      body.applyImpulse({ x: 0, y: body.mass() * handling.crestLift, z: 0 }, true);
      const angular = body.angvel();
      body.applyTorqueImpulse({ x: clamp(-angular.x * 110, 0, 85), y: 0, z: 0 }, true);
      launchCooldown = 1.1;
    }
    if (wheels.some((_, i) => controller.wheelIsInContact(i))) {
      if (airborneTime > .18 && velocity.y < -2.6) landing = clamp((-velocity.y - 2.6) / 9, .15, 1);
      if (handling.keepLandingSpeed && airborneTime > .12 && velocity.y < -.8
        && up.y > .78 && !input.parking && input.brake <= .08 && settings.speed >= 15) {
        // The suspension can sap forward speed on its first contact. Preserve speed in the
        // direction the tires are already moving and let Rapier resolve any chassis collisions.
        const touchdown = body.linvel();
        const touchdownSpeed = Math.hypot(touchdown.x, touchdown.z);
        const alignment = touchdown.x * velocity.x + touchdown.z * velocity.z;
        if (touchdownSpeed > 1 && touchdownSpeed < planarSpeed
          && alignment > .94 * touchdownSpeed * planarSpeed) {
          const scale = planarSpeed / touchdownSpeed;
          body.setLinvel({ x: touchdown.x * scale, y: touchdown.y, z: touchdown.z * scale }, true);
        }
      }
      airborneTime = 0;
    } else {
      airborneTime += stepTime;
    }
  }

  reset();
  return {
    root, reset, sync, step, setLook,
    position: () => body.translation(), rotation: () => body.rotation(), revision: () => revision, boost: () => Math.min(1, boostTime * 2),
    steering: () => steering * steeringGrip, wheelRotation: () => controller.wheelRotation(0) ?? 0, wheelSpeed: () => previousSpeed,
    speed: () => currentSpeed, grounded: () => groundedWheels > 0,
    ownsCollider: (handle: number) => handle === chassis.handle || handle === cabin.handle,
    takeLanding: () => { const strength = landing; landing = 0; return strength; },
  };
}
