import { Color3, Mesh, MeshBuilder, Scene, ShadowGenerator, StandardMaterial, Vector3 } from "@babylonjs/core";
import RAPIER from "@dimforge/rapier3d-compat";
import { createPlaythings } from "./playthings.ts";
import { paint, straightRows, surface, type SurfaceRow } from "./surfaces.ts";

export type Spawn = { x: number; y: number; z: number; heading: number };
export const spawn: Spawn = { x: 0, y: .87, z: -8, heading: 0 };
export const boundary = 145;

const east = Math.PI / 2;
const flat = [-1, 1] as const;

export function createWorld(scene: Scene, physics: RAPIER.World, shadows: ShadowGenerator) {
  const grass = paint(scene, "#a4d467");
  const grassHill = paint(scene, "#85bd59");
  const road = paint(scene, "#596477");
  const edge = paint(scene, "#fff0bb");
  const sand = paint(scene, "#f3ca84");
  const orange = paint(scene, "#f47856");
  const teal = paint(scene, "#50bba9");
  const purple = paint(scene, "#777ac9");
  const boostPaint = paint(scene, "#28cecf");
  boostPaint.emissiveColor = Color3.FromHexString("#135b67");
  const staticPieces: Mesh[] = [];

  const ground = MeshBuilder.CreateGround("meadow", { width: 330, height: 330 }, scene);
  ground.material = grass;
  ground.receiveShadows = true;
  ground.freezeWorldMatrix();
  physics.createCollider(RAPIER.ColliderDesc.cuboid(165, .5, 165).setTranslation(0, -.5, 0).setFriction(.8));

  function box(name: string, size: [number, number, number], point: [number, number, number], material: StandardMaterial, solid = false) {
    const [width, height, depth] = size;
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    mesh.position.set(...point);
    mesh.material = material;
    staticPieces.push(mesh);
    if (solid) {
      physics.createCollider(RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2)
        .setTranslation(...point).setRestitution(.15));
    }
    return mesh;
  }

  function strip(name: string, rows: SurfaceRow[], material: StandardMaterial, solid = false) {
    const mesh = surface(scene, name, material, rows, flat, solid ? physics : undefined);
    staticPieces.push(mesh);
  }

  function paved(name: string, rows: SurfaceRow[], solid = false) {
    strip(name, rows, road, solid);
    const marks = rows.map((row) => ({ ...row, y: row.y + .023 }));
    for (const side of [-1, 1]) {
      staticPieces.push(surface(scene, "road edge", edge, marks, [side * .92 - .022, side * .92 + .022]));
    }
  }

  // The two broad cross streets meet the outer loop at four open junctions.
  for (const [x, z, heading] of [[0, -83, 0], [-83, 0, east]]) {
    for (const [start, end] of [[13, 76], [90, 153]]) {
      paved("cross street", straightRows(x, z, heading, 6.5, [[start, .024], [end, .024]]));
    }
  }
  box("central intersection", [14, .018, 14], [0, .017, 0], road);
  for (const [x, z, heading] of [[-54, 76, east], [-54, -76, east], [76, -54, 0], [-76, -54, 0]]) {
    for (const [start, end] of [[0, 47], [61, 108]]) {
      paved("loop straight", straightRows(x, z, heading, 7, [[start, .015], [end, .015]]));
    }
  }
  for (const [x, z] of [[76, 0], [-76, 0], [0, 76], [0, -76]]) {
    box("loop junction", [14, .018, 14], [x, .018, z], road);
  }

  for (const [x, z, startHeading] of [[54, 54, east], [54, -54, Math.PI], [-54, -54, east * 3], [-54, 54, 0]]) {
    const rows = Array.from({ length: 17 }, (_, i) => {
      const fraction = i / 16;
      const heading = startHeading + fraction * east;
      return {
        x: x - Math.cos(heading) * 22, z: z + Math.sin(heading) * 22, heading, halfWidth: 7,
        y: .015 + Math.sin(fraction * Math.PI) ** 2 * .52, bank: -.49 * Math.sin(fraction * Math.PI) ** 2,
      };
    });
    paved("banked corner", rows, true);
    const shoulder = rows.map((row) => ({
      ...row,
      x: row.x - Math.cos(row.heading) * 9,
      z: row.z + Math.sin(row.heading) * 9,
      halfWidth: 2,
      y: (row.y - row.bank) / 2,
      bank: (row.y - row.bank) / 2,
    }));
    strip("grass shoulder", shoulder, grassHill, true);
  }

  // The bridge has gentle approaches and a full-width underpass on the north road.
  const bridgeZ = 53;
  for (const [x, heading] of [[-69, east], [69, -east]]) {
    paved("bridge approach", straightRows(x, bridgeZ, heading, 6,
      [[0, .02], [17, .02], [26, .6], [38, 2.4], [49, 4.9], [57.5, 6.5]]), true);
  }
  paved("bridge deck", straightRows(-11.5, bridgeZ, east, 6, [[0, 6.516], [23, 6.516]]));
  box("bridge span", [23, .55, 12], [0, 6.225, bridgeZ], teal, true);
  for (const side of [-1, 1]) {
    for (const [x, height] of [[10.85, 6.2], [20, 4.9], [31, 2.4]]) {
      for (const z of [bridgeZ - 4.8, bridgeZ + 4.8]) {
        box("bridge pier", [1.1, height, 1.1], [x * side, height / 2, z], teal, true);
      }
    }
  }
  for (const z of [bridgeZ - 5.8, bridgeZ + 5.8]) {
    box("bridge rail", [23, .55, .34], [0, 6.775, z], teal, true);
    for (const x of [-10.8, 10.8]) box("bridge post", [1.25, 1.05, .85], [x, 6.96, z], edge);
  }

  // High clearance, two open ends and no internal collision seams.
  const tunnelX = -43;
  box("tunnel roof", [23, .8, 14.8], [tunnelX, 5.6, 0], purple, true);
  for (const z of [-7, 7]) box("tunnel wall", [23, 5.3, .85], [tunnelX, 2.65, z], purple, true);
  for (const x of [tunnelX - 11.7, tunnelX + 11.7]) {
    box("tunnel lintel", [1.3, 1, 15.6], [x, 5.75, 0], orange, true);
    for (const z of [-7.25, 7.25]) {
      box("tunnel portal", [1.3, 5.5, 1.1], [x, 2.75, z], orange, true);
      box("tunnel reflector", [1.35, .33, 1.12], [x, 1.05, z], edge);
    }
  }

  for (const [x, z, halfWidth, height] of [[-30, 85, 20, 6], [39, -63, 17, 4.2], [103, 28, 19, 5.4], [-114, -30, 21, 6.4]]) {
    // Rings taper to the grass so every side can be driven up and over.
    const rings: SurfaceRow[] = Array.from({ length: 25 }, (_, i) => {
      const angle = i / 24 * Math.PI * 2;
      return { x: x + Math.sin(angle) * halfWidth / 2, z: z + Math.cos(angle) * halfWidth / 2,
        heading: angle + east, y: height / 2 - .008, bank: height / 2, halfWidth: halfWidth / 2 };
    });
    staticPieces.push(surface(scene, "rolling hill", grassHill, rings, [-1, -.72, -.44, 0, .44, .72, .999], physics));
  }

  const jumps = [
    { x: 27, z: 9, halfWidth: 7, profile: [[0, .02], [4, .16], [8, .65], [11, 1.5], [12.5, .02]] },
    { x: -28, z: -55, halfWidth: 10, profile: [[0, .02], [5, .24], [10, 1.1], [15, 2.8], [19, 4.65], [20.5, .02]] },
  ] as const;
  for (const { x, z, halfWidth, profile } of jumps) {
    const rows = straightRows(x, z, 0, halfWidth, profile);
    strip("jump ramp", rows, sand, true);
    for (const side of [-1, 1]) {
      const shoulders = rows.map((row) => ({
        ...row, x: row.x + side * (halfWidth + 3), y: row.y * .5, bank: -side * row.y * .5, halfWidth: 3,
      }));
      strip("ramp shoulder", shoulders, grassHill, true);
    }
    const lip = profile[profile.length - 2];
    box("jump marker", [halfWidth * 1.82, .09, .45], [x, lip[1] + .056, z + lip[0] - .2], orange);
  }

  const pads = [{ x: 0, z: 21, halfX: 5.25, halfZ: 2.2 }, { x: 37, z: 0, halfX: 2.2, halfZ: 5.25 }];
  const arrow = paint(scene, "#d8ffed");
  arrow.emissiveColor = Color3.FromHexString("#407770");
  for (const { x, z, halfX, halfZ } of pads) {
    box("boost pad", [halfX * 2, .026, halfZ * 2], [x, .052, z], boostPaint);
    const angle = halfX > halfZ ? 0 : east;
    for (const offset of [-3, 0, 3]) {
      for (const direction of [-1, 1]) {
        for (const side of [-1, 1]) {
          const graphic = box("boost chevron", [1.02, .035, .16],
            [x + Math.cos(angle) * (offset + side * .31), .078, z - Math.sin(angle) * (offset + side * .31)], arrow);
          graphic.position.x += Math.sin(angle) * direction * .81;
          graphic.position.z += Math.cos(angle) * direction * .81;
          graphic.rotation.y = angle + direction * side * .72;
        }
      }
    }
  }

  addScenery(scene, staticPieces);
  // Batch immutable scenery by material for the main camera and shadow pass.
  const batches = new Map<StandardMaterial, Mesh[]>();
  for (const piece of staticPieces) {
    const material = piece.material as StandardMaterial;
    const batch = batches.get(material) ?? [];
    batch.push(piece);
    batches.set(material, batch);
  }
  for (const [material, batch] of batches) {
    const mesh = Mesh.MergeMeshes(batch, true, true);
    if (!mesh) continue;
    mesh.freezeWorldMatrix();
    mesh.receiveShadows = !material.disableLighting;
    if ([orange, teal, purple].includes(material)) shadows.addShadowCaster(mesh);
  }

  const playthings = createPlaythings(scene, physics, shadows);
  return {
    padAt: ({ x, y, z }: RAPIER.Vector) => y > .35 && y < 1.45
      ? pads.findIndex((pad) => Math.abs(x - pad.x) < pad.halfX && Math.abs(z - pad.z) < pad.halfZ)
      : -1,
    sync: (car: Vector3, boost: number) => {
      boostPaint.emissiveColor.set(.07 + boost * .12, .34 + boost * .35, .39 + boost * .33);
      playthings.sync(car);
    },
  };
}

function addScenery(scene: Scene, pieces: Mesh[]) {
  const ridge = paint(scene, "#83b654");
  const cloud = paint(scene, "#fff9e7");
  cloud.disableLighting = true;
  cloud.emissiveColor = Color3.FromHexString("#fff9e7");
  const leaves = [paint(scene, "#4a9765"), paint(scene, "#69ac66"), paint(scene, "#378e78")];
  const trunk = paint(scene, "#ad7958");
  for (let i = 0; i < 26; i++) {
    const angle = i * 2.39996;
    const distance = 147 + (i % 5) * 7;
    const x = Math.sin(angle) * distance;
    const z = Math.cos(angle) * distance;
    const hill = MeshBuilder.CreateIcoSphere("distant hill", { radius: 1, subdivisions: 2, flat: true }, scene);
    hill.position.set(x, -8, z);
    hill.scaling.set(19 + i % 7, 17 + i % 11, 22);
    hill.material = ridge;
    pieces.push(hill);
    for (let j = -1; j <= 1; j++) {
      const tree = MeshBuilder.CreateCylinder("tree trunk", { height: 3, diameter: .68, tessellation: 6 }, scene);
      tree.position.set(x + j * 5.7, hill.scaling.y * .87 - 7.5, z - Math.cos(angle) * 6);
      tree.material = trunk;
      const crown = MeshBuilder.CreateIcoSphere("tree crown", { radius: 2.3, subdivisions: 1, flat: true }, scene);
      crown.position.set(tree.position.x, tree.position.y + 2.25, tree.position.z);
      crown.scaling.y = 1.5;
      crown.material = leaves[(i + j + 3) % leaves.length];
      pieces.push(tree, crown);
    }
  }
  for (let i = 0; i < 10; i++) {
    const angle = i * Math.PI / 5;
    for (let j = -1; j <= 1; j++) {
      const puff = MeshBuilder.CreateIcoSphere("cloud", { radius: 1, subdivisions: 2, flat: true }, scene);
      puff.position.set(Math.sin(angle) * 152 + j * 9, 29 + i % 4 * 6 - Math.abs(j) * 2, Math.cos(angle) * 152);
      puff.scaling.set(11, 4, 6);
      puff.material = cloud;
      pieces.push(puff);
    }
  }
}
