import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { paint } from "./surfaces.ts";
import { sampleWorldRoads, type WorldDefinition } from "./worldDefinition.ts";
import { raceCheckpoints, selectRaceRoutes } from "./proceduralRaceRoutes.ts";
import { isPreset } from "./worldGenerator.ts";

const legacyRoutes = {
  alpine: { name: "Isnedfarten", roads: ["west-descent"] },
  desert: { name: "Klippeveien", roads: ["east-cliff", "east-return"] },
  countryside: { name: "Bygderunden", roads: ["west-climb", "west-descent"] },
} as const;

export function buildProceduralSprints(world: WorldDefinition, worldHash: string) {
  if (world.generation?.version === 2) {
    return selectRaceRoutes(world).map(({ id, label, rows }, index) => {
      const startIndex = rows.findIndex((row, i) => i >= 4 && row.frameUp.y > .975);
      const finishIndex = rows.findLastIndex((row, i) => i < rows.length - 6 && row.frameUp.y > .94);
      const start = rows[startIndex];
      return {
        id, name: `${label} ${index + 1}`, rows,
        spawn: { x: start.x, y: start.y + .84, z: start.z, heading: start.heading },
        gates: raceCheckpoints(rows, startIndex, finishIndex, 18),
        recordKey: `little-machines-procedural-sprint-v2:${worldHash}:${id}`,
      };
    });
  }
  const legacy = buildLegacySprint(world, worldHash);
  return legacy ? [legacy] : [];
}

export function buildProceduralSprint(world: WorldDefinition, worldHash: string) {
  return buildProceduralSprints(world, worldHash)[0];
}

function buildLegacySprint(world: WorldDefinition, worldHash: string) {
  const preset = world.generation?.preset;
  if (!preset || !isPreset(preset) || !(preset in legacyRoutes)) return;
  const route = legacyRoutes[preset as keyof typeof legacyRoutes];
  const sampled = new Map(sampleWorldRoads(world).map(({ road, rows }) => [road.id, rows]));
  const rows = route.roads.flatMap((id, i) => {
    const road = sampled.get(id);
    if (!road) throw new Error(`Tidkjøringen mangler veien ${id}.`);
    return i ? road.slice(1) : road;
  });
  // Leave room to settle at the start and to brake before the final junction.
  const start = rows[4];
  const spawn = { x: start.x, y: start.y + .84, z: start.z, heading: start.heading };
  const gates = raceCheckpoints(rows, 4, rows.length - 6, 16);
  return {
    id: "legacy", name: route.name, spawn, gates, rows,
    recordKey: `little-machines-procedural-sprint-v1:${preset}:${worldHash}`,
  };
}

export function addProceduralSprintGates(scene: Scene, layout: NonNullable<ReturnType<typeof buildProceduralSprint>>) {
  const passed = paint(scene, "#7994a6");
  const next = paint(scene, "#ffcb56");
  const finish = paint(scene, "#63e2cd");
  for (const material of [next, finish]) material.emissiveColor.copyFrom(material.diffuseColor).scaleInPlace(.5);
  const markers = layout.gates.map((gate) => {
    const span = gate.halfWidth + .25;
    return [-1, 1].map((side) => {
      const post = CreateBox("sprint gate", { width: .42, height: 3.5, depth: .42 }, scene);
      post.position.set(
        gate.x + Math.cos(gate.heading) * span * side,
        gate.y + 1.45 + (gate.frameRight?.y ?? 0) * span * side,
        gate.z - Math.sin(gate.heading) * span * side,
      );
      post.rotation.y = gate.heading;
      post.freezeWorldMatrix();
      return post;
    });
  });
  let highlighted = -1;
  return {
    ...layout,
    highlight(index: number) {
      if (index === highlighted) return;
      highlighted = index;
      for (const [i, posts] of markers.entries()) {
        const material = i === index ? (i === markers.length - 1 ? finish : next) : passed;
        for (const post of posts) {
          post.material = material;
          post.setEnabled(i >= index && i <= index + 2);
        }
      }
    },
    isOffRoad(point: { x: number; y: number; z: number }) {
      return !layout.rows.some((row) => Math.abs(point.y - row.y) < 3
        && (point.x - row.x) ** 2 + (point.z - row.z) ** 2 < (row.halfWidth + .5) ** 2);
    },
  };
}
