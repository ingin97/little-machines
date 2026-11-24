import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { paint, surface, type SurfaceRow } from "./surfaces.ts";

export function addSprintScenery(scene: Scene, start: SurfaceRow, finish: SurfaceRow, corners: SurfaceRow[][], ridge: boolean) {
  const frame = paint(scene, "#172a46");
  const teal = paint(scene, "#40e6d4");
  teal.emissiveColor = Color3.FromHexString("#1e7469");
  const amber = paint(scene, "#ffca61");
  amber.emissiveColor = Color3.FromHexString("#70521b");

  function place(row: SurfaceRow, mesh: ReturnType<typeof CreateBox>, side: number, y: number, forward = 0) {
    mesh.position.set(
      row.x + Math.cos(row.heading) * side + Math.sin(row.heading) * forward,
      row.y + y,
      row.z - Math.sin(row.heading) * side + Math.cos(row.heading) * forward,
    );
    mesh.rotation.y = row.heading;
  }

  function box(row: SurfaceRow, name: string, side: number, y: number, width: number, height: number, depth: number, material: StandardMaterial) {
    const mesh = CreateBox(name, { width, height, depth }, scene);
    mesh.material = material;
    place(row, mesh, side, y);
  }

  const signs = new Map<string, StandardMaterial>();
  function sign(row: SurfaceRow, label: string, side: number, y: number, width: number, height: number, depth: number) {
    if (typeof HTMLCanvasElement === "undefined") return;
    let material = signs.get(label);
    if (!material) {
      const texture = new DynamicTexture(label, { width: 512, height: 128 }, scene, true);
      const arrow = label === "❯❯❯" || label === "❮❮❮";
      texture.drawText(label, null, 94, "bold 86px system-ui, sans-serif", arrow ? "#ffca61" : "#e7fffa", "#172a46", true);
      material = new StandardMaterial(label, scene);
      material.disableLighting = true;
      material.emissiveTexture = texture;
      signs.set(label, material);
    }
    const panel = CreatePlane(label, { width, height }, scene);
    panel.material = material;
    place(row, panel, side, y, -depth / 2 - .02);
  }

  function gantry(row: SurfaceRow, label: string, trim: StandardMaterial) {
    const width = row.halfWidth * 2 + 2.8;
    for (const side of [-1, 1]) {
      const offset = side * (row.halfWidth + .95);
      box(row, label + " pylon", offset, 4.1, .85, 8.2, 1.1, frame);
      box(row, label + " light", offset, 4.5, .26, 5.7, 1.15, trim);
    }
    box(row, label + " crossbar", 0, 7.9, width, 1.8, 1.12, frame);
    box(row, label + " light strip", 0, 7.07, width, .18, 1.18, trim);
    sign(row, label, 0, 7.95, 6.3, 1.48, 1.12);
  }

  gantry(finish, "MÅL", teal);
  if (!ridge) return;
  gantry(start, "START", teal);

  for (const corner of corners) {
    const direction = Math.sign(corner.at(-1)!.heading - corner[0].heading);
    const entry = corner[0];
    const outside = -direction * (entry.halfWidth + 1.25);
    const label = direction > 0 ? "❯❯❯" : "❮❮❮";
    box(entry, "corner board", outside, 2.25, 3.4, 1.1, .22, frame);
    sign(entry, label, outside, 2.25, 3.35, 1, .22);
    const illuminated = corner.map((row) => ({ ...row, y: row.y + .033 }));
    surface(scene, "inside turn strip", amber, illuminated, direction > 0 ? [.82, .88] : [-.88, -.82]);
  }
}
