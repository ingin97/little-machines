import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { paint, shoulderRows, straightRows, type SurfaceRow } from "./surfaces.ts";

import type { DrivingSurface } from "./drivingSurfaces.ts";

const width = 7.5;
const center = 151;
const radiusX = 70;
const radiusZ = 54;

export function addScenicLoop(
  scene: Scene, pieces: Mesh[],
  paved: (name: string, rows: SurfaceRow[], solid?: boolean) => void,
  strip: (name: string, rows: SurfaceRow[], material: StandardMaterial, solid?: boolean, bands?: readonly number[], drivingSurface?: DrivingSurface) => void,
) {
  const blue = paint(scene, "#4384bc");
  const yellow = paint(scene, "#ffe279");
  const coral = paint(scene, "#f27659");
  const grass = paint(scene, "#88bf5b");
  const dirt = paint(scene, "#f0c483");
  const rows = Array.from({ length: 81 }, (_, i) => {
    const angle = i / 80 * Math.PI * 2;
    const east = Math.cos(angle);
    return {
      x: center + east * radiusX, z: Math.sin(angle) * radiusZ,
      heading: Math.atan2(-radiusX * Math.sin(angle), radiusZ * east),
      y: .028 + Math.max(0, east) ** 2 * 9.4, halfWidth: width,
    };
  });
  paved("scenic loop", rows, true);
  for (const side of [-1, 1] as const) strip("hill shoulder", shoulderRows(rows, side, 18), grass, true, undefined, "grass");
  for (const [z, finish] of [[-40, 105], [0, 83], [40, 105]]) {
    paved("scenic access road", straightRows(76, z, Math.PI / 2, 6.5, [[0, .036], [finish - 76, .036]]));
  }
  const jump = straightRows(130, -35, Math.PI / 2, 7.5,
    [[0, .02], [10, .3], [17, 1.35], [22, 3.45], [24, .015]]);
  strip("scenic jump", jump, dirt, true, undefined, "sand");
  for (const side of [-1, 1]) {
    strip("scenic jump shoulder", jump.map((row) => ({
      ...row, z: row.z - side * (row.halfWidth + 3), halfWidth: 3,
      y: row.y / 2, bank: -side * row.y / 2,
    })), grass, true, undefined, "grass");
  }

  function box(name: string, size: [number, number, number], at: [number, number, number], material: StandardMaterial) {
    const [w, h, d] = size;
    const mesh = CreateBox(name, { width: w, height: h, depth: d }, scene);
    mesh.position.set(...at);
    mesh.material = material;
    pieces.push(mesh);
    return mesh;
  }
  for (const [x, z, direction] of [[68, -33, 1], [66, 9, 1], [68, 47, 1], [89, 46, -1], [89, -46, -1]]) {
    box("wayfinding post", [.27, 2, .25], [x, 1, z], blue);
    box("wayfinding panel", [3.4, 1.28, .26], [x, 2.26, z], blue);
    for (const face of [-1, 1]) {
      box("wayfinding arrow shaft", [1.35, .20, .065], [x - direction * .27, 2.26, z + face * .15], yellow);
      for (const side of [-1, 1]) {
        const tip = box("wayfinding arrow tip", [.85, .19, .065], [x + direction * .55, 2.26 + side * .25, z + face * .15], yellow);
        tip.rotation.z = -side * direction * .70;
      }
    }
  }
  box("scenic jump lip marker", [.42, .07, 12.8], [151.75, 3.41, -35], coral);

  const kite = new TransformNode("hilltop kite", scene);
  kite.position.set(210, 24, 4);
  const sail = new Mesh("diamond kite", scene);
  const shape = new VertexData();
  shape.positions = [0, 0, 0, 0, 3.2, 0, 2.5, 0, 0, 0, -4.4, 0, -2.5, 0, 0];
  shape.indices = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1];
  shape.normals = [];
  VertexData.ComputeNormals(shape.positions, shape.indices, shape.normals);
  shape.colors = [1, .84, .3, 1, 1, .4, .28, 1, .35, .82, .91, 1, 1, .45, .31, 1, 1, .78, .23, 1];
  shape.applyToMesh(sail);
  sail.material = paint(scene, "#fff5e5");
  sail.material.backFaceCulling = false;
  sail.parent = kite;
  for (let i = 0; i < 5; i++) {
    const tail = CreateBox("kite tail ribbon", { width: .9 - i * .09, height: .35, depth: .07 }, scene);
    tail.position.set(Math.sin(i * .6) * 1.25, -4.6 - i * .68, i * .17);
    tail.rotation.z = (i % 2 ? -.3 : .3);
    tail.material = i % 2 ? blue : coral;
    tail.parent = kite;
  }

  let time = 0;
  return {
    update(dt: number) {
      time += dt;
      kite.position.y = 24 + Math.sin(time * .75) * 1.1;
      kite.rotation.y = .28 + Math.sin(time * .6) * .35;
      kite.rotation.z = Math.sin(time * 1.2) * .17;
    },
    onRoad({ x, z }: Pick<Vector3, "x" | "z">) {
      if (x < 76 || x > 231 || Math.abs(z) > 63) return false;
      const ellipse = Math.hypot((x - center) / radiusX, z / radiusZ);
      return Math.abs(ellipse - 1) * radiusZ < width
        || (x < 106 && [0, 40, -40].some((entry) => Math.abs(z - entry) < 6.5));
    },
  };
}
