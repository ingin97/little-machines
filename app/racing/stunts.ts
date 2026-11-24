import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { arcRows, paint, shoulderRows, smoothProfile, straightRows, type SurfaceRow } from "./surfaces.ts";

type Strip = (name: string, rows: SurfaceRow[], material: StandardMaterial, solid?: boolean, bands?: readonly number[]) => void;
type Paved = (name: string, rows: SurfaceRow[], solid?: boolean, bands?: readonly number[]) => void;

export function addStuntArea(scene: Scene, pieces: Mesh[], paved: Paved, strip: Strip) {
  const meadow = paint(scene, "#8dc45e");
  const plum = paint(scene, "#7168a7");
  const gold = paint(scene, "#f8cf69");
  const coral = paint(scene, "#ed755b");
  const cream = paint(scene, "#fff1cc");

  function deck(name: string, rows: SurfaceRow[], material: StandardMaterial, shoulder: number, bands?: readonly number[]) {
    strip(name, rows, material, true, bands);
    for (const side of [-1, 1] as const) strip(name + " shoulder", shoulderRows(rows, side, shoulder), meadow, true);
  }

  // The wide hill road can be driven both ways. The north fork joins at its flat summit.
  const downhill = straightRows(-151, 105, Math.PI, 10.5, smoothProfile([[0, .025], [39, 11], [66, 11], [145, .025], [169, .025]]));
  paved("stunt downhill", downhill, true);
  for (const side of [-1, 1] as const) strip("downhill hillside", shoulderRows(downhill, side, 19), meadow, true);
  const northwest = straightRows(-76, 48, -Math.PI / 2, 7.4,
    smoothProfile([[0, .025], [9, .025], [64, 11], [75, 11]]));
  paved("summit road", northwest, true);
  for (const side of [-1, 1] as const) strip("summit shoulder", shoulderRows(northwest, side, 13), meadow, true);

  const atBottom = downhill[downhill.length - 1];
  const bend = arcRows(atBottom, 28, -Math.PI / 2, 1.36);
  paved("stunt banked bend", bend, true);
  strip("banked bend outer shoulder", shoulderRows(bend, 1, 10), meadow, true);
  const exit = bend[bend.length - 1];
  paved("stunt exit", straightRows(exit.x, exit.z, exit.heading, 10.5, [[0, .025], [58, .025]]));
  paved("stunt exit link", straightRows(-65, -92, 0, 7.2, [[0, .030], [18, .030]]));

  deck("rolling hills", straightRows(-188, 53, Math.PI, 10, smoothProfile(
    [[0, .02], [17, 3.3], [32, .65], [50, 4.8], [69, .65], [86, 3.2], [101, .02]], 2.2)), meadow, 7);
  deck("optional stunt jump", straightRows(-177, -50, Math.PI, 6.5,
    [[0, .02], [6, .28], [12, 1.25], [17, 2.85], [21, .02]]), gold, 4.5);

  // The rounded floor is open at both ends and the wall tops taper to grass on the outside.
  const pipe = straightRows(-116, -13, Math.PI, 12, [[0, .033], [52, .033]]);
  const halfpipe = Array.from({ length: 27 }, (_, i) => {
    const t = i / 26;
    return { ...pipe[0], z: pipe[0].z - 52 * t, crown: 3.9 * Math.min(1, Math.sin(t * Math.PI) ** 2 * 2) };
  });
  const crossSection = [-1, -.84, -.68, -.50, -.32, -.16, 0, .16, .32, .50, .68, .84, 1];
  deck("open halfpipe", halfpipe, plum, 7, crossSection);
  for (const side of [-1, 1]) strip("halfpipe rail stripe", halfpipe.map((row) => ({ ...row, y: row.y + .018 })),
    cream, false, [side * .88 - .016, side * .88 + .016]);

  paved("bowling lane", straightRows(-116, 10, Math.PI / 2, 6.0, [[0, .028], [29, .028]]));

  function block(name: string, width: number, height: number, depth: number, x: number, y: number, z: number, material: StandardMaterial) {
    const mesh = CreateBox(name, { width, height, depth }, scene);
    mesh.position.set(x, y, z);
    mesh.material = material;
    pieces.push(mesh);
  }
  const ridge = { x: -151, y: 11, z: 57 };
  for (const side of [-1, 1]) {
    const x = ridge.x + side * 10.6;
    block("summit arch foot", 1.75, .7, 1.6, x, ridge.y + .35, ridge.z, plum);
    block("summit arch post", .9, 5.8, 1.1, x, ridge.y + 2.9, ridge.z, coral);
  }
  block("summit arch beam", 22, .64, 1.0, ridge.x, ridge.y + 5.79, ridge.z, plum);
  for (let i = -4; i <= 4; i++) {
    block("summit arch tile", 1.75, .52, 1.06, ridge.x + i * 1.8, ridge.y + 5.79, ridge.z, i % 2 ? cream : gold);
  }

  for (const [x, y, z] of [[-83, 0, 44], [-95, 0, 14], [-102, 0, -15], [-141, 11, 51],
    [-161, 11, 48], [-134, 0, -81], [-174, 0, -47]]) {
    block("stunt pennant pole", .21, 3.2, .21, x, y + 1.6, z, cream);
    block("stunt pennant", .87, .55, .14, x + .38, y + 2.91, z, coral);
  }
  return {
    onRoad(x: number, z: number) {
      return (Math.abs(x + 151) < 10.5 && z > -64 && z < 105)
        || (Math.abs(z - 48) < 7.4 && x >= -151 && x < -76)
        || (Math.abs(x + 116) < 12 && z > -65 && z < -13)
        || (Math.abs(z - 10) < 6 && x > -116 && x < -87)
        || (Math.abs(z + 92) < 10.5 && x > -123 && x < -64)
        || (x < -123 && z < -64 && Math.abs(Math.hypot(x + 123, z + 64) - 28) < 10.5);
    },
  };
}
