import { Scene } from "@babylonjs/core/scene.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { arcRows, paint, straightRows, surface, type SurfaceRow } from "./surfaces.ts";
import { addSprintScenery } from "./sprintScenery.ts";
import { buildRidgeLayout, ridgeSpawn } from "./ridgeLayout.ts";

export const sprintSpawn = { x: -155, y: .84, z: -150, heading: 0 };

export function buildSprintLayout() {
  const corners: SurfaceRow[][] = [];
  const rows: SurfaceRow[] = [{ ...sprintSpawn, z: -172, y: .02, halfWidth: 5.5 }];
  const gates: SurfaceRow[] = [];
  const straight = (length: number, gateOffsets: number[] = []) => {
    const start = rows.at(-1)!;
    const samples = Array.from({ length: Math.ceil(length / 3) }, (_, i) =>
      [Math.min((i + 1) * 3, length), start.y] as const);
    rows.push(...straightRows(start.x, start.z, start.heading, start.halfWidth, samples));
    gates.push(...straightRows(start.x, start.z, start.heading, start.halfWidth,
      gateOffsets.map((distance) => [distance, start.y])));
  };
  const turn = (radius: number, direction: number) => {
    const corner = arcRows(rows.at(-1)!, radius, direction * Math.PI / 2, 0);
    corners.push(corner);
    rows.push(...corner.slice(1));
  };

  straight(147, [130]);
  turn(26, 1);
  straight(75, [15, 58]);
  turn(24, -1);
  straight(90, [16, 74]);
  turn(22, 1);
  straight(95, [16, 78]);
  turn(27, 1);
  straight(114, [17, 95]);
  turn(24, -1);
  straight(38, [18]);
  turn(22, 1);
  straight(92, [78]);

  return { rows, gates, corners };
}

export function createSprintCourse(scene: Scene, physics: RAPIER.World, ridge = false) {
  const spawn = ridge ? ridgeSpawn : sprintSpawn;
  const recordKey = ridge ? "little-machines-ridge-v1" : "little-machines-sprint-v1";
  const meadow = CreateGround("sprint meadow", { width: 530, height: 530 }, scene);
  meadow.material = paint(scene, ridge ? "#768b78" : "#769d66");
  meadow.receiveShadows = true;
  physics.createCollider(RAPIER.ColliderDesc.cuboid(265, .5, 265).setTranslation(0, -.5, 0));

  const road = paint(scene, "#354357");
  const edge = paint(scene, "#fbedd1");
  const passed = paint(scene, "#7994a6");
  const next = paint(scene, "#ffcb56");
  next.emissiveColor.copyFrom(next.diffuseColor).scaleInPlace(.35);
  const finish = paint(scene, "#63e2cd");
  finish.emissiveColor.copyFrom(finish.diffuseColor).scaleInPlace(.35);
  const dark = paint(scene, "#1c2638");
  const { rows, gates, corners } = ridge ? buildRidgeLayout() : buildSprintLayout();
  surface(scene, "sprint asphalt", road, rows, [-1, 1], ridge ? physics : undefined);
  if (ridge) addRidgeWalls(scene, physics, rows);
  const markings = rows.map((row) => ({ ...row, y: row.y + .015 }));
  surface(scene, "left road edge", edge, markings, [-1, -.97]);
  surface(scene, "right road edge", edge, markings, [.97, 1]);
  const curb = paint(scene, "#ff7857");
  for (const corner of corners) {
    for (let i = 0; i < corner.length - 1; i += 2) {
      const section = corner.slice(i, i + 3).map((row) => ({ ...row, y: row.y + .007 }));
      for (const side of [-1, 1]) {
        const bands = side < 0 ? [ridge ? -1 : -1.1, -.97] : [.97, ridge ? 1 : 1.1];
        surface(scene, "corner curb", i % 4 === 0 ? curb : edge, section, bands);
      }
    }
  }

  function box(name: string, gate: SurfaceRow, side: number, y: number, width: number, height: number, depth: number) {
    const mesh = CreateBox(name, { width, height, depth }, scene);
    mesh.position.set(gate.x + Math.cos(gate.heading) * side, gate.y + y, gate.z - Math.sin(gate.heading) * side);
    mesh.rotation.y = gate.heading;
    return mesh;
  }

  const gateMeshes = gates.map((gate) => [
    box("gate left", gate, -gate.halfWidth - .3, 1.85, .35, 3.7, .4),
    box("gate right", gate, gate.halfWidth + .3, 1.85, .35, 3.7, .4),
    box("gate stripe", gate, 0, .018, gate.halfWidth * 2, .008, .34),
  ]);
  const finishGate = gates.at(-1)!;
  for (let row = 0; row < 2; row++) {
    const stripe = { ...finishGate, x: finishGate.x + Math.sin(finishGate.heading) * (row - .5) * .55,
      z: finishGate.z + Math.cos(finishGate.heading) * (row - .5) * .55 };
    for (let col = 0; col < 20; col++) {
      box("finish checker", stripe, (col - 9.5) * .55, .032, .55, .01, .55).material = (col + row) % 2 ? dark : edge;
    }
  }
  box("start line", { ...rows[0], x: spawn.x, z: spawn.z }, 0, .02, 11, .01, .4).material = edge;
  addSprintScenery(scene, { ...rows[0], x: spawn.x, z: spawn.z }, finishGate, corners, ridge);
  let highlighted = -1;

  return {
    gates, spawn, recordKey,
    highlight(index: number) {
      if (index === highlighted) return;
      highlighted = index;
      gateMeshes.forEach((meshes, i) => {
        const material = i === index ? (i === gates.length - 1 ? finish : next) : passed;
        for (const mesh of meshes) mesh.material = material;
      });
    },
    isGrass(point: { x: number; y: number; z: number }) {
      return !rows.some((row) => (!ridge || Math.abs(point.y - row.y) < 3)
        && (point.x - row.x) ** 2 + (point.z - row.z) ** 2 < row.halfWidth ** 2);
    },
  };
}

function addRidgeWalls(scene: Scene, physics: RAPIER.World, rows: SurfaceRow[]) {
  const concrete = paint(scene, "#b7c8d3");
  const cap = paint(scene, "#ed7041");
  const supports = paint(scene, "#546371");

  // Use continuous strips so the wheels and chassis can't catch on individual barrier ends.
  function strip(side: number, inner: [number, number], outer: [number, number]) {
    const offset = (inner[0] + outer[0]) / 2;
    return rows.map((row) => ({
      ...row,
      x: row.x + Math.cos(row.heading) * (row.halfWidth + offset) * side,
      z: row.z - Math.sin(row.heading) * (row.halfWidth + offset) * side,
      y: row.y + side * (row.bank ?? 0) + (inner[1] + outer[1]) / 2,
      halfWidth: (outer[0] - inner[0]) / 2,
      bank: side * (outer[1] - inner[1]) / 2,
    }));
  }

  for (const side of [-1, 1]) {
    surface(scene, "concrete wall face", concrete, strip(side, [0, -.12], [.22, 1.4]), [-1, 1], physics);
    surface(scene, "orange wall cap", cap, strip(side, [.22, 1.4], [.82, 1.4]), [-1, 1], physics);
    surface(scene, "concrete outer wall", concrete, strip(side, [.82, 1.4], [1.04, -.22]), [-1, 1]);
  }

  for (const [index, row] of rows.entries()) {
    if (index % 12 || row.y < 5) continue;
    const height = row.y - 1;
    const pier = CreateBox("viaduct pier", { width: 2.3, height, depth: 2.3 }, scene);
    pier.position.set(row.x, height / 2, row.z);
    pier.material = supports;
  }
}
