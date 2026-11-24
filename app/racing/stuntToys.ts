import "@babylonjs/core/Meshes/instancedMesh.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { paint } from "./surfaces.ts";

export function createStuntToys(scene: Scene, physics: RAPIER.World, shadows: ShadowGenerator, layout = {
  bowling: { x: -108, y: 0, z: 10 },
  stars: [[-12, 1.35, -17], [-92, 1.38, 26], [-149, 12.35, 49], [-116, 1.35, -36],
    [-188, 6.1, 3], [-125, 1.4, -90], [221, 10.8, 2]].map(([x, y, z]) => ({ x, y, z })),
}) {
  const ivory = paint(scene, "#fff1d9");
  const coral = paint(scene, "#ed674c");
  const gold = paint(scene, "#ffd040");
  const lavender = paint(scene, "#b1a1ff");
  gold.emissiveColor.set(.34, .22, .035);
  lavender.emissiveColor.set(.20, .15, .37);
  const bowlingCenter = layout.bowling;
  const pins: { home: Vector3; body: RAPIER.RigidBody; mesh: Mesh; knocked: boolean }[] = [];
  for (let row = 0; row < 3; row++) for (let pin = 0; pin <= row; pin++) {
    const home = new Vector3(bowlingCenter.x - row * 1.55, bowlingCenter.y + .02, bowlingCenter.z + (pin - row / 2) * 1.5);
    const mesh = CreateCylinder("bowling pin", { diameterBottom: .72, diameterTop: .56, height: 1.05, tessellation: 12 }, scene);
    mesh.material = ivory;
    shadows.addShadowCaster(mesh);
    const neck = CreateCylinder("bowling pin neck", { diameterBottom: .56, diameterTop: .32, height: .62, tessellation: 12 }, scene);
    neck.position.y = .80;
    neck.material = ivory;
    neck.parent = mesh;
    const collar = CreateCylinder("bowling pin stripe", { diameter: .37, height: .17, tessellation: 12 }, scene);
    collar.position.y = 1.14;
    collar.material = coral;
    collar.parent = mesh;
    const head = CreateCylinder("bowling pin head", { diameterBottom: .38, diameterTop: .43, height: .36, tessellation: 12 }, scene);
    head.position.y = 1.36;
    head.material = ivory;
    head.parent = mesh;
    const body = physics.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(home.x, home.y, home.z)
      .setLinearDamping(.34).setAngularDamping(.29).setCcdEnabled(true));
    physics.createCollider(RAPIER.ColliderDesc.cylinder(.88, .37).setTranslation(0, .88, 0)
      .setMass(8).setFriction(.8).setRestitution(.18), body);
    mesh.rotationQuaternion = Quaternion.Identity();
    pins.push({ home, body, mesh, knocked: false });
  }

  const starMesh = new Mesh("star shape", scene);
  const data = new VertexData();
  const vertices = [0, 0, .24, 0, 0, -.24];
  for (let i = 0; i < 10; i++) {
    const angle = Math.PI / 2 + i * Math.PI / 5;
    const radius = i % 2 ? .53 : 1.22;
    vertices.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
  }
  const indices: number[] = [];
  for (let i = 0; i < 10; i++) indices.push(0, 2 + (i + 1) % 10, 2 + i, 1, 2 + i, 2 + (i + 1) % 10);
  data.positions = vertices;
  data.indices = indices;
  data.normals = [];
  VertexData.ComputeNormals(vertices, indices, data.normals);
  data.applyToMesh(starMesh);
  starMesh.material = gold;
  starMesh.isVisible = false;
  const stars = layout.stars.map(({ x, y, z }, i) => {
    const home = new Vector3(x, y, z);
    const mesh = starMesh.createInstance("collectible star");
    mesh.position.copyFrom(home);
    return { home, mesh, collected: false, phase: i * 1.12 };
  });

  const pool = Array.from({ length: 24 }, (_, i) => {
    const mesh = CreateBox("stunt sparkle", { size: .19 }, scene);
    mesh.material = i % 3 ? gold : lavender;
    mesh.setEnabled(false);
    return { mesh, origin: new Vector3(), life: 0, vx: 0, vz: 0 };
  });
  function burst(position: RAPIER.Vector, amount: number) {
    let emitted = 0;
    for (const spark of pool) {
      if (spark.life > 0) continue;
      const angle = emitted * 2.39996;
      spark.origin.set(position.x, position.y, position.z);
      spark.mesh.position.copyFrom(spark.origin);
      spark.vx = Math.sin(angle) * (1.1 + emitted % 4);
      spark.vz = Math.cos(angle) * (1.1 + emitted % 4);
      spark.life = .68;
      spark.mesh.setEnabled(true);
      if (++emitted === amount) break;
    }
  }

  let sinceKnock = 0;
  let time = 0;
  function step(dt: number, car: RAPIER.Vector) {
    let collected = false;
    for (const star of stars) {
      const horizontal = Math.hypot(star.home.x - car.x, star.home.z - car.z);
      if (star.collected) {
        if (horizontal > 24) {
          star.collected = false;
          star.mesh.setEnabled(true);
        }
      } else if (horizontal < 1.83 && Math.abs(star.home.y - car.y) < 1.65) {
        star.collected = true;
        star.mesh.setEnabled(false);
        burst(star.home, 12);
        collected = true;
      }
    }

    let knocked = false;
    for (const pin of pins) {
      const rotation = pin.body.rotation();
      const position = pin.body.translation();
      if (!pin.knocked && (rotation.x ** 2 + rotation.z ** 2 > .13
        || Math.hypot(position.x - pin.home.x, position.z - pin.home.z) > 1.3)) {
        pin.knocked = true;
        knocked = true;
        burst({ x: position.x, y: position.y + 1, z: position.z }, 4);
      }
    }
    sinceKnock = knocked ? 0 : sinceKnock + dt;
    if (sinceKnock > .85 && pins.some((pin) => pin.knocked)
      && Math.hypot(car.x - bowlingCenter.x, car.z - bowlingCenter.z) > 14) {
      for (const pin of pins) {
        pin.body.setTranslation(pin.home, true);
        pin.body.setRotation(Quaternion.Identity(), true);
        pin.body.setLinvel(Vector3.Zero(), true);
        pin.body.setAngvel(Vector3.Zero(), true);
        pin.knocked = false;
      }
    }
    return { collected, knocked };
  }

  function render(dt: number) {
    time += dt;
    for (const { mesh, body } of pins) {
      const position = body.translation();
      const rotation = body.rotation();
      mesh.rotationQuaternion!.set(rotation.x, rotation.y, rotation.z, rotation.w);
      Vector3.UpReadOnly.rotateByQuaternionToRef(mesh.rotationQuaternion!, mesh.position);
      mesh.position.scaleInPlace(.525).addInPlaceFromFloats(position.x, position.y, position.z);
    }
    for (const { mesh, home, phase } of stars) {
      mesh.rotation.y = time * 1.9 + phase;
      mesh.position.y = home.y + Math.sin(time * 2.6 + phase) * .23;
    }
    for (const spark of pool) {
      if (spark.life <= 0) continue;
      spark.life -= dt;
      if (spark.life <= 0) {
        spark.mesh.setEnabled(false);
        continue;
      }
      const age = .68 - spark.life;
      spark.mesh.position.set(spark.origin.x + spark.vx * age, spark.origin.y + 4.4 * age - 5.6 * age ** 2,
        spark.origin.z + spark.vz * age);
      spark.mesh.rotation.set(age * 8, age * 4, age * 6);
      spark.mesh.scaling.setAll(Math.min(1, spark.life * 5));
    }
  }
  render(0);
  return { step, render };
}
