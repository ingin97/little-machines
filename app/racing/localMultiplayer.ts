import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { createCarVisual, wheelRadius } from "./carVisual.ts";
import { connectLocalCars, type LocalPose } from "./localRoom.ts";
import { paint } from "./surfaces.ts";

import { classicWorldIdentity, type WorldIdentity } from "./worldDefinition.ts";
import { connectWorldPeer } from "./worldPeer.ts";

export function createLocalMultiplayer(scene: Scene, readPose: () => LocalPose, status: HTMLElement, identity: WorldIdentity = classicWorldIdentity) {
  let room = connectLocalCars(readPose, undefined, identity);
  const markerPaint = paint(scene, "#48d9e8");
  markerPaint.emissiveColor.set(.16, .50, .58);
  const cars = new Map<string, ReturnType<typeof createRemoteCar>>();
  const position = new Vector3();
  const rotation = new Quaternion();
  let count = 0;
  const webPeers = new Map<string, { pose: LocalPose; seen: number }>();
  const connections = new Set<() => void>();
  const webLinks = new Set<ReturnType<typeof connectWorldPeer>>();
  let nextSend = 0;
  let incompatible = false;

  function createRemoteCar() {
    const car = createCarVisual(scene);
    const marker = CreateBox("local player marker", { size: .38 }, scene);
    marker.material = markerPaint;
    // Keep the marker above the car even while the car rolls over.
    marker.rotation.z = Math.PI / 4;
    return { car, marker, reset: -1 };
  }

  return {
    update(dt: number) {
      if (webLinks.size) {
        nextSend -= dt;
        if (nextSend <= 0) {
          nextSend = .055;
          const pose = readPose();
          for (const link of webLinks) link.send(pose);
        }
      }
      const local = room?.peers();
      if (!local && !webPeers.size && !cars.size && !incompatible) return;
      const peers = webPeers.size ? new Map([...(local ?? []), ...webPeers]) : local ?? webPeers;
      for (const [id, additional] of cars) {
        if (peers.has(id)) continue;
        additional.car.dispose();
        additional.marker.dispose();
        cars.delete(id);
      }
      for (const [id, { pose }] of peers) {
        let remote = cars.get(id);
        if (!remote) {
          remote = createRemoteCar();
          cars.set(id, remote);
        }
        position.set(...pose.position);
        rotation.set(...pose.rotation).normalize();
        const snap = pose.reset !== remote.reset || Vector3.DistanceSquared(remote.car.root.position, position) > 20 ** 2;
        const blend = snap ? 1 : 1 - Math.exp(-18 * dt);
        remote.reset = pose.reset;
        const { root, wheels } = remote.car;
        remote.car.setLook(pose.look);
        Vector3.LerpToRef(root.position, position, blend, root.position);
        Quaternion.SlerpToRef(root.rotationQuaternion!, rotation, blend, root.rotationQuaternion!);
        remote.marker.position.copyFrom(root.position);
        remote.marker.position.y += 1.75;
        for (const [index, wheel] of wheels.entries()) {
          wheel.spin.rotation.x = (wheel.spin.rotation.x + pose.speed / wheelRadius * dt) % (Math.PI * 2);
          wheel.pivot.rotation.y += ((index < 2 ? pose.steering : 0) - wheel.pivot.rotation.y) * blend;
        }
      }
      if (count !== peers.size) {
        count = peers.size;
        status.hidden = count === 0 && !incompatible;
        status.textContent = incompatible ? "Kunne ikke bli med. Spillerne har ulike versjoner av verdenen."
          : count ? `${count + 1} spiller ${webPeers.size ? "sammen" : "lokalt"}` : "";
      }
    },
    attachPeer(channel: RTCDataChannel) {
      const id = crypto.randomUUID();
      incompatible = false;
      count = -1;
      const link = connectWorldPeer(channel, identity, (pose) => {
        webPeers.set(id, { pose, seen: performance.now() });
      }, () => {
        incompatible = true;
        count = -1;
      });
      function close() {
        channel.removeEventListener("close", close);
        connections.delete(close);
        webLinks.delete(link);
        webPeers.delete(id);
        link.dispose();
      }
      connections.add(close);
      webLinks.add(link);
      channel.addEventListener("close", close);
      return close;
    },
    disconnect() {
      room?.close();
      room = null;
      for (const close of connections) close();
      incompatible = false;
      status.hidden = true;
    },
    reconnect() {
      if (!room) {
        room = connectLocalCars(readPose, undefined, identity);
        count = -1;
      }
    },
  };
}
