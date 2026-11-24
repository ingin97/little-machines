import "@babylonjs/core/Meshes/instancedMesh.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Scene } from "@babylonjs/core/scene.js";
import { CreateIcoSphere } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { paint } from "./surfaces.ts";

export function createDrivingParticles(scene: Scene) {
  const dustMesh = CreateIcoSphere("dust source", { radius: 1, subdivisions: 1 }, scene);
  dustMesh.material = paint(scene, "#e6cc98");
  const boostMesh = CreateBox("boost source", { size: 1 }, scene);
  const glow = paint(scene, "#65ffff");
  glow.emissiveColor.copyFromFloats(.20, .64, .68);
  boostMesh.material = glow;
  dustMesh.isVisible = boostMesh.isVisible = false;

  function pool(source: typeof dustMesh, capacity: number) {
    return Array.from({ length: capacity }, () => {
      const mesh = source.createInstance("driving particle");
      mesh.setEnabled(false);
      return { mesh, velocity: new Vector3(), life: 0, lifetime: 0, size: 0 };
    });
  }
  const dust = pool(dustMesh, 28);
  const sparks = pool(boostMesh, 18);
  const offset = new Vector3();
  const worldOffset = new Vector3();
  let nextDust = 0;
  let nextSpark = 0;
  let nextImpact = 0;
  let side = 1;

  function emit(particles: typeof dust, point: Vector3, rotation: Quaternion, spark: boolean) {
    const puff = particles.find((particle) => particle.life <= 0);
    if (!puff) return;
    side *= -1;
    offset.set(side * (spark ? .54 : .83), spark ? -.19 : -.40, -1.37);
    offset.rotateByQuaternionToRef(rotation, worldOffset);
    puff.mesh.position.copyFrom(point).addInPlace(worldOffset);
    offset.set(side * (.55 + Math.random() * 1.25), spark ? .22 : .7, spark ? -4.8 : -1.45);
    offset.rotateByQuaternionToRef(rotation, puff.velocity);
    puff.mesh.rotation.set(.4, Math.random() * Math.PI, Math.random() * Math.PI);
    puff.size = spark ? .10 : .19 + Math.random() * .13;
    puff.mesh.scaling.setAll(puff.size);
    puff.life = puff.lifetime = spark ? .28 : .48 + Math.random() * .16;
    puff.mesh.setEnabled(true);
  }

  function update(dt: number, point: Vector3, rotation: Quaternion, speed: number, grounded: boolean, boost: number, impact: number, onGrass: boolean) {
    nextDust -= dt;
    nextSpark -= dt;
    nextImpact -= dt;
    if (grounded && speed > 4 && nextDust <= 0) {
      emit(dust, point, rotation, false);
      nextDust = onGrass ? .05 + 1 / speed * .22 : .18;
    }
    if (boost > 0 && nextSpark <= 0) {
      emit(sparks, point, rotation, true);
      nextSpark = .043;
    }
    if (impact > 0 && nextImpact <= 0) {
      for (let i = 0; i < Math.ceil(impact * 8); i++) emit(dust, point, rotation, false);
      nextImpact = .17;
    }

    for (const particles of [dust, sparks]) {
      for (const particle of particles) {
        if (particle.life <= 0) continue;
        particle.life -= dt;
        if (particle.life <= 0) {
          particle.mesh.setEnabled(false);
          continue;
        }
        const { mesh, velocity } = particle;
        mesh.position.x += velocity.x * dt;
        mesh.position.y += velocity.y * dt;
        mesh.position.z += velocity.z * dt;
        const progress = 1 - particle.life / particle.lifetime;
        mesh.scaling.setAll(particle.size * (1 + progress) * Math.min(1, (1 - progress) * 4));
        if (particles === sparks) mesh.scaling.z *= 2.6;
      }
    }
  }

  return { update };
}
