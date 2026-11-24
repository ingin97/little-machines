import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder.js";
import { CreateIcoSphere } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { paint } from "./surfaces.ts";

export function createLandmarks(scene: Scene, pieces: Mesh[]) {
  const coral = paint(scene, "#ef6648");
  const butter = paint(scene, "#ffcf56");
  const cream = paint(scene, "#fff5d5");
  const navy = paint(scene, "#374866");
  const turquoise = paint(scene, "#51baaf");
  const foliage = paint(scene, "#509e63");
  const mint = paint(scene, "#79bd63");
  const bark = paint(scene, "#ad7556");

  function rock(x: number, y: number, z: number, size: number, material = navy) {
    const mesh = CreateIcoSphere("meadow detail", { radius: 1, subdivisions: 1, flat: true }, scene);
    mesh.position.set(x, y, z);
    mesh.scaling.set(size, size * .72, size * .85);
    mesh.rotation.y = x * .72 + z;
    mesh.material = material;
    pieces.push(mesh);
  }

  function block(name: string, x: number, y: number, z: number, w: number, h: number, d: number,
    material: typeof coral, parent?: TransformNode) {
    const mesh = CreateBox(name, { width: w, height: h, depth: d }, scene);
    mesh.position.set(x, y, z);
    mesh.material = material;
    if (parent) mesh.parent = parent;
    else pieces.push(mesh);
    return mesh;
  }

  // A checkered gateway is visible immediately and leaves the full road width open.
  const gateZ = 13;
  for (const side of [-1, 1]) {
    const x = side * 7.6;
    block("gateway footing", x, .23, gateZ, 2.2, .46, 2.4, navy);
    block("gateway pillar", x, 2.8, gateZ, 1.24, 5.2, 1.35, coral);
    block("gateway cap", x, 5.48, gateZ, 1.8, .44, 1.75, butter);
    block("gateway trim", x, 1.2, gateZ, 1.30, .28, 1.41, cream);
  }
  block("gateway beam", 0, 5.72, gateZ, 16.85, 1.08, 1.35, coral);
  block("gateway top", 0, 6.30, gateZ, 17.1, .22, 1.48, butter);
  for (let row = 0; row < 2; row++) {
    for (let tile = 0; tile < 14; tile++) {
      for (const face of [-1, 1]) {
        block("checkered gateway panel", (tile - 6.5) * .47, 5.53 + row * .47, gateZ + face * .687,
          .47, .47, .045, (tile + row) % 2 ? navy : cream);
      }
    }
  }

  // A windmill and red-roof pavilion give the two sides of the park different silhouettes.
  const millX = -24;
  const millZ = 25;
  const mill = CreateCylinder("windmill tower", { height: 9.6, diameterTop: 3.1, diameterBottom: 4.7, tessellation: 8 }, scene);
  mill.position.set(millX, 4.8, millZ);
  mill.material = cream;
  pieces.push(mill);
  const roof = CreateCylinder("windmill roof", { height: 2.2, diameterTop: 0, diameterBottom: 4.65, tessellation: 8 }, scene);
  roof.position.set(millX, 10.45, millZ);
  roof.material = coral;
  pieces.push(roof);
  block("windmill door", millX, 1.25, millZ - 2.2, 1.15, 2.5, .22, turquoise);
  block("windmill window", millX, 5.45, millZ - 1.87, .92, 1.12, .22, navy);
  const sails = new TransformNode("windmill sails", scene);
  sails.position.set(millX, 7.85, millZ - 2.3);
  block("windmill hub", 0, 0, 0, .9, .9, .67, coral, sails);
  for (let i = 0; i < 4; i++) {
    const spoke = new TransformNode("windmill arm", scene);
    spoke.parent = sails;
    spoke.rotation.z = i * Math.PI / 2;
    block("windmill spar", 0, 2.8, 0, .24, 5.5, .25, navy, spoke);
    block("windmill blade", .42, 3.62, 0, 1.14, 3.45, .16, butter, spoke);
    block("windmill blade stripe", .42, 3.8, -.091, 1.15, .32, .04, cream, spoke);
  }

  const pavilionX = 26;
  const pavilionZ = 43;
  block("pavilion deck", pavilionX, .24, pavilionZ, 7.2, .48, 5.3, cream);
  for (const dx of [-2.85, 2.85]) for (const dz of [-1.95, 1.95]) {
    block("pavilion column", pavilionX + dx, 2, pavilionZ + dz, .49, 3.6, .49, turquoise);
  }
  for (const side of [-1, 1]) {
    const panel = block("pavilion roof", pavilionX, 4.20, pavilionZ + side * 1.45, 8, .31, 3.18, coral);
    panel.rotation.x = -side * .37;
  }
  block("pavilion ridge", pavilionX, 4.81, pavilionZ, 8.05, .19, .40, butter);

  // Curated groves frame the straightaways while leaving open grass for stunts.
  const trees = [[-13, -11, 1], [14, -14, 1.12], [-15, 20, .88], [17, 26, 1.03],
    [-32, 10, .94], [-39, 14, 1.13], [43, 37, 1.2], [48, 40, .95],
    [-16, 67, 1.1], [19, 68, 1], [56, -33, 1.1], [-61, -47, 1.24]];
  for (const [x, z, factor] of trees) {
    const trunk = CreateCylinder("tree trunk", { height: 2.6 * factor, diameterTop: .37 * factor, diameterBottom: .62 * factor, tessellation: 6 }, scene);
    trunk.position.set(x, 1.3 * factor, z);
    trunk.material = bark;
    pieces.push(trunk);
    rock(x - .55 * factor, 2.9 * factor, z + .13, 1.8 * factor, foliage);
    rock(x + .54 * factor, 3.9 * factor, z, 1.75 * factor, mint);
    rock(x + .52 * factor, 2.65 * factor, z - .34, 1.38 * factor, foliage);
  }

  for (const [x, z] of [[-10, -13], [11, -11], [-11, 19], [12, 25], [-15, 31], [19, 43], [36, 31], [-34, 25]]) {
    for (let i = 0; i < 10; i++) {
      const angle = i * 2.39996;
      const distance = .48 * Math.sqrt(i + 1);
      const px = x + Math.cos(angle) * distance;
      const pz = z + Math.sin(angle) * distance;
      const height = .23 + (i % 4) * .09;
      block("flower stem", px, height / 2, pz, .055, height, .055, foliage);
      rock(px, height, pz, .15, i % 3 === 0 ? coral : i % 3 === 1 ? butter : cream);
    }
  }

  let angle = .24;
  sails.rotation.z = angle;
  return { update(dt: number) { angle = (angle + dt * .56) % (Math.PI * 2); sails.rotation.z = angle; },
    shadowMaterials: [coral, cream, navy, turquoise, foliage, mint] };
}
