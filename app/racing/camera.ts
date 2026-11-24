import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Scene } from "@babylonjs/core/scene.js";
import RAPIER from "@dimforge/rapier3d-compat";
import type { createVehicle } from "./vehicle.ts";
import type { Spawn } from "./world.ts";

export function createChaseCamera(scene: Scene, physics: RAPIER.World, car: Pick<ReturnType<typeof createVehicle>, "root" | "revision" | "speed">, spawn: Spawn) {
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
  const cameraProbe = new RAPIER.Ball(.24);
  const cameraRotation = Quaternion.Identity();
  const chasePosition = new Vector3();
  let chaseHeight = spawn.y;
  let lookDistance = 0;
  let clearDistance = 10;
  let heading = spawn.heading;
  let lastReset = 0;

  function updateCamera(dt: number) {
    const p = car.root.position;
    const attitude = car.root.rotationQuaternion!;
    localForward.rotateByQuaternionToRef(attitude, worldForward);
    localUp.rotateByQuaternionToRef(attitude, worldUp);
    const reset = lastReset !== car.revision();
    lastReset = car.revision();
    const speed = car.speed();
    if (worldUp.y > .48 && worldForward.x ** 2 + worldForward.z ** 2 > .25) {
      const angle = Math.atan2(worldForward.x, worldForward.z);
      const delta = Math.atan2(Math.sin(angle - heading), Math.cos(angle - heading));
      heading += delta * (reset ? 1 : 1 - Math.exp(-(4.4 + Math.min(.12 * speed, 2)) * dt));
    }
    chaseHeight += (p.y - chaseHeight) * (reset ? 1 : 1 - Math.exp(-4.5 * dt));
    const y = Math.max(p.y - 1.05, Math.min(p.y + 1.6, chaseHeight));
    const x = Math.sin(heading);
    const z = Math.cos(heading);
    const followDistance = 7.3 + Math.min(speed * .11, 2.3);
    lookDistance += (1.6 + Math.min(speed * .16, 2.2) - lookDistance) * (reset ? 1 : 1 - Math.exp(-5 * dt));
    desired.set(p.x - x * followDistance, y + 4.05, p.z - z * followDistance);
    aim.set(p.x + x * lookDistance, y + .78, p.z + z * lookDistance);
    Vector3.LerpToRef(chasePosition, desired, reset ? 1 : 1 - Math.exp(-8 * dt), chasePosition);

    anchor.set(p.x, p.y + .70, p.z);
    chasePosition.subtractToRef(anchor, sightline);
    const distance = sightline.length();
    if (distance > .01) {
      sightline.scaleInPlace(1 / distance);
      const hit = physics.castShape(anchor, cameraRotation, sightline, cameraProbe, .05, distance,
        false, RAPIER.QueryFilterFlags.ONLY_FIXED);
      const limit = hit ? Math.max(.22, hit.time_of_impact - .18) : distance;
      clearDistance = reset || limit < clearDistance ? limit : clearDistance + (limit - clearDistance) * (1 - Math.exp(-5 * dt));
      sightline.scaleInPlace(clearDistance);
      anchor.addToRef(sightline, camera.position);
    }
    Vector3.LerpToRef(target, aim, reset ? 1 : 1 - Math.exp(-8 * dt), target);
    camera.setTarget(target);
  }

  return { camera, update: updateCamera };
}
