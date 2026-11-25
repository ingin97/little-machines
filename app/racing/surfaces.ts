import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Scene } from "@babylonjs/core/scene.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { setColliderSurface, type DrivingSurface } from "./drivingSurfaces.ts";
import type { RoadVector } from "./roadSpline.ts";

export type SurfaceRow = {
  x: number; y: number; z: number; heading: number; halfWidth: number;
  bank?: number; crown?: number; frameRight?: RoadVector; frameUp?: RoadVector;
};

export function straightRows(x: number, z: number, heading: number, halfWidth: number, profile: readonly (readonly [number, number])[]): SurfaceRow[] {
  return profile.map(([distance, y]) => ({
    x: x + Math.sin(heading) * distance,
    z: z + Math.cos(heading) * distance,
    heading, halfWidth, y,
  }));
}

export function smoothProfile(profile: readonly (readonly [number, number])[], spacing = 3) {
  const samples: [number, number][] = [[...profile[0]]];
  for (let i = 1; i < profile.length; i++) {
    const [from, bottom] = profile[i - 1];
    const [to, top] = profile[i];
    const count = Math.ceil((to - from) / spacing);
    for (let step = 1; step <= count; step++) {
      const t = step / count;
      samples.push([from + (to - from) * t, bottom + (top - bottom) * t * t * (3 - 2 * t)]);
    }
  }
  return samples;
}

export function arcRows(start: SurfaceRow, radius: number, sweep: number, bank: number, samples = 20): SurfaceRow[] {
  const signedRadius = Math.sign(sweep) * radius;
  return Array.from({ length: samples + 1 }, (_, i) => {
    const t = i / samples;
    const heading = start.heading + sweep * t;
    return {
      ...start, heading,
      x: start.x + signedRadius * (Math.cos(start.heading) - Math.cos(heading)),
      z: start.z + signedRadius * (Math.sin(heading) - Math.sin(start.heading)),
      bank: bank * Math.sin(Math.PI * t) ** 2,
    };
  });
}

export function shoulderRows(rows: SurfaceRow[], side: -1 | 1, width: number, groundY = -.012): SurfaceRow[] {
  return rows.map((row) => {
    const offset = side * (row.halfWidth + width / 2);
    const edge = row.y + side * (row.bank ?? 0) + (row.crown ?? 0);
    return {
      ...row, x: row.x + Math.cos(row.heading) * offset,
      z: row.z - Math.sin(row.heading) * offset,
      halfWidth: width / 2, y: (edge + groundY) / 2, crown: 0,
      bank: side * (groundY - edge) / 2,
    };
  });
}

export function surface(
  scene: Scene, name: string, material: StandardMaterial, rows: SurfaceRow[],
  bands: readonly number[], physics?: RAPIER.World, drivingSurface?: DrivingSurface | ((point: RAPIER.Vector) => DrivingSurface),
) {
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const right = row.frameRight ?? { x: Math.cos(row.heading), y: 0, z: -Math.sin(row.heading) };
    const up = row.frameUp ?? { x: 0, y: 1, z: 0 };
    for (const band of bands) {
      uvs.push((band + 1) / 2, rowIndex / (rows.length - 1));
      const width = row.halfWidth * band;
      const crown = (row.crown ?? 0) * band ** 2;
      positions.push(
        row.x + right.x * width + up.x * crown,
        row.y + (row.frameRight ? right.y * width : (row.bank ?? 0) * band) + up.y * crown,
        row.z + right.z * width + up.z * crown,
      );
    }
    if (!rowIndex) continue;
    for (let col = 0; col < bands.length - 1; col++) {
      const a = (rowIndex - 1) * bands.length + col;
      const b = a + bands.length;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.uvs = uvs;
  data.normals = [];
  VertexData.ComputeNormals(positions, indices, data.normals);
  data.applyToMesh(mesh);
  mesh.material = material;
  mesh.receiveShadows = true;
  if (physics) {
    const collider = physics.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(positions), new Uint32Array(indices), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES_TWO_SIDED)
      .setFriction(.85));
    if (drivingSurface) setColliderSurface(physics, collider, drivingSurface);
  }
  return mesh;
}

export function paint(scene: Scene, color: string) {
  const material = new StandardMaterial(color, scene);
  material.diffuseColor = Color3.FromHexString(color);
  material.specularColor = Color3.Black();
  return material;
}
