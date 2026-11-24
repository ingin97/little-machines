import { Color3, Mesh, Scene, StandardMaterial, VertexData } from "@babylonjs/core";
import RAPIER from "@dimforge/rapier3d-compat";

export type SurfaceRow = { x: number; y: number; z: number; heading: number; halfWidth: number; bank?: number };

export function straightRows(x: number, z: number, heading: number, halfWidth: number, profile: readonly (readonly [number, number])[]): SurfaceRow[] {
  return profile.map(([distance, y]) => ({
    x: x + Math.sin(heading) * distance,
    z: z + Math.cos(heading) * distance,
    heading, halfWidth, y,
  }));
}

export function surface(
  scene: Scene, name: string, material: StandardMaterial, rows: SurfaceRow[],
  bands: readonly number[], physics?: RAPIER.World,
) {
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const rightX = Math.cos(row.heading);
    const rightZ = -Math.sin(row.heading);
    for (const band of bands) {
      uvs.push((band + 1) / 2, rowIndex / (rows.length - 1));
      positions.push(
        row.x + rightX * row.halfWidth * band,
        row.y + (row.bank ?? 0) * band,
        row.z + rightZ * row.halfWidth * band,
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
    physics.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(positions), new Uint32Array(indices))
      .setFriction(.85));
  }
  return mesh;
}

export function paint(scene: Scene, color: string) {
  const material = new StandardMaterial(color, scene);
  material.diffuseColor = Color3.FromHexString(color);
  material.specularColor = Color3.Black();
  return material;
}
