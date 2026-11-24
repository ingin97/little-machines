import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { CreateIcoSphere } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder.js";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { drivingSurfaces, setColliderSurface, type DrivingSurface } from "./drivingSurfaces.ts";
import { addFootballGoal, goal } from "./goal.ts";
import { createPlaythings } from "./playthings.ts";
import { createStuntToys } from "./stuntToys.ts";
import { paint, surface } from "./surfaces.ts";
import { roadBands, sampleWorldRoads, terrainSurface, type WorldDefinition } from "./worldDefinition.ts";
import { buildWorldTerrain } from "./worldTerrain.ts";

export function createDefinedWorld(scene: Scene, physics: RAPIER.World, shadows: ShadowGenerator, definition: WorldDefinition) {
  const staticPieces: Mesh[] = [];
  const roads = sampleWorldRoads(definition);
  const terrain = buildWorldTerrain(definition, roads);
  const colors = new Map<DrivingSurface, Color3>();
  const roadMaterials = new Map<DrivingSurface, ReturnType<typeof paint>>();
  const edge = paint(scene, "#fff1cc");
  edge.zOffset = -4;
  const support = paint(scene, "#67848f");
  const landmarkPaint = paint(scene, "#dc835e");
  const snow = paint(scene, "#f2f8ff");
  const ground = new Mesh("terrain", scene);
  const data = new VertexData();
  const { cells, heights, spacing, halfExtent } = terrain;
  const stride = cells + 1;
  const positions = new Float32Array(heights.length * 3);
  const vertexColors = new Float32Array(heights.length * 4);
  const indices = new Uint32Array(cells * cells * 6);
  let triangle = 0;
  for (let row = 0; row <= cells; row++) for (let col = 0; col <= cells; col++) {
    const i = row * stride + col;
    const x = col * spacing - halfExtent;
    const z = row * spacing - halfExtent;
    const kind = terrainSurface(definition, { x, z });
    let color = colors.get(kind);
    if (!color) {
      color = Color3.FromHexString(drivingSurfaces[kind].color);
      colors.set(kind, color);
    }
    const shade = .88 + .12 * Math.sin(x / 17 + z / 25) ** 2;
    positions.set([x, heights[i], z], i * 3);
    vertexColors.set([color.r * shade, color.g * shade, color.b * shade, 1], i * 4);
    if (row < cells && col < cells) {
      indices.set([i, i + 1, i + stride, i + 1, i + stride + 1, i + stride], triangle);
      triangle += 6;
    }
  }
  data.positions = positions;
  data.colors = vertexColors;
  data.indices = indices;
  data.normals = new Float32Array(positions.length);
  VertexData.ComputeNormals(positions, indices, data.normals);
  data.applyToMesh(ground);
  ground.material = paint(scene, "#ffffff");
  ground.receiveShadows = true;
  ground.freezeWorldMatrix();
  const terrainCollider = physics.createCollider(RAPIER.ColliderDesc.trimesh(positions, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES_TWO_SIDED));
  setColliderSurface(physics, terrainCollider, (point) => terrainSurface(definition, point));

  function box(name: string, dimensions: [number, number, number], position: [number, number, number], material: typeof edge, solid = false) {
    const [width, height, depth] = dimensions;
    const mesh = CreateBox(name, { width, height, depth }, scene);
    mesh.position.set(...position);
    mesh.material = material;
    staticPieces.push(mesh);
    if (solid) physics.createCollider(RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2).setTranslation(...position));
  }

  const degrees = new Map<string, number>();
  for (const { road } of roads) {
    for (const node of [road.from, road.to]) degrees.set(node, (degrees.get(node) ?? 0) + 1);
  }
  const nearIntersection = (node: string, point: { x: number; z: number }, end: { x: number; z: number }) =>
    (degrees.get(node) ?? 0) > 2 && Math.hypot(point.x - end.x, point.z - end.z) < 9;
  for (const { road, rows } of roads) {
    let material = roadMaterials.get(road.surface);
    if (!material) {
      material = paint(scene, drivingSurfaces[road.surface].color);
      // Asphalt owns the visible surface at coplanar junctions with dirt or ice.
      if (road.surface === "asphalt") material.zOffset = -3;
      roadMaterials.set(road.surface, material);
    }
    staticPieces.push(surface(scene, road.id, material, rows, roadBands, physics, road.surface));
    const firstStripe = rows.findIndex((row) => !nearIntersection(road.from, row, rows[0]));
    const lastStripe = rows.findLastIndex((row) => !nearIntersection(road.to, row, rows[rows.length - 1]));
    if (firstStripe >= 0 && lastStripe > firstStripe) {
      const stripes = rows.slice(firstStripe, lastStripe + 1).map((row) => ({ ...row, y: row.y + .025 }));
      for (const bands of [[-.96, -.92], [.92, .96]]) staticPieces.push(surface(scene, "edge stripe", edge, stripes, bands));
    }
    const bridges = definition.bridges.filter((bridge) => bridge.road === road.id);
    for (const bridge of bridges) {
      const span = rows.filter(({ x, z }) => Math.hypot(x - bridge.x, z - bridge.z) <= bridge.radius);
      if (span.length < 2) continue;
      for (const side of [-1, 1]) {
        const edging = (offset: number, halfWidth: number, facing = 1) => span.map((row) => ({
          ...row,
          x: row.x + row.frameRight.x * row.halfWidth * side,
          y: row.y + row.frameRight.y * row.halfWidth * side + offset,
          z: row.z + row.frameRight.z * row.halfWidth * side,
          halfWidth,
          crown: 0,
          frameRight: { x: 0, y: side * facing, z: 0 },
        }));
        staticPieces.push(surface(scene, "bridge fascia", support, edging(-.45, .46, -1), [-1, 1]));
        // The wall faces inward and continuously follows the same banked deck samples.
        staticPieces.push(surface(scene, "bridge rail", support, edging(.32, .32), [-1, 1], physics));
      }
      for (let i = 4; i < span.length - 4; i += 13) {
        const { x, y, z } = span[i];
        const foot = terrain.heightAt(x, z);
        const height = y - foot - .55;
        if (height > 1) box("bridge pier", [2.4, height, 2.4], [x, foot + height / 2, z], support, true);
      }
    }
  }

  for (const { x, y, z, width, length, height } of definition.tunnels) {
    box("tunnel roof", [width + 1, .8, length], [x, y + height + .4, z], support, true);
    for (const side of [-1, 1]) {
      box("tunnel wall", [.65, height, length], [x + side * width / 2, y + height / 2 - .18, z], support, true);
      for (const end of [-1, 1]) box("tunnel portal", [.84, height + .8, 1.3], [x + side * width / 2, y + height / 2, z + end * length / 2], landmarkPaint, true);
    }
    for (const end of [-1, 1]) box("tunnel lintel", [width, .65, 1.3], [x, y + height + .32, z + end * length / 2], landmarkPaint, true);
  }

  for (const { x, z, height, kind } of definition.landmarks) {
    const y = terrain.heightAt(x, z);
    if (kind === "arch") {
      for (const side of [-1, 1]) box("canyon arch leg", [3, height, 4], [x + side * 6, y + height / 2, z], landmarkPaint, true);
      box("canyon arch lintel", [15, 3, 4], [x, y + height, z], landmarkPaint, true);
    } else {
      const tip = CreateCylinder(kind, { height, diameterBottom: kind === "peak" ? 18 : 4, diameterTop: kind === "peak" ? 1 : 3, tessellation: 7 }, scene);
      tip.position.set(x, y + height / 2, z);
      tip.material = kind === "peak" ? snow : landmarkPaint;
      staticPieces.push(tip);
      physics.createCollider(RAPIER.ColliderDesc.cylinder(height / 2, kind === "peak" ? 3 : 1.5).setTranslation(x, y + height / 2, z));
    }
  }

  const alpine = definition.terrain.surface === "ice";
  const foliage = paint(scene, alpine ? "#537c7b" : "#4c9361");
  const bark = paint(scene, "#9e7558");
  const stones = paint(scene, definition.terrain.shape === "canyon" ? "#b36f52" : "#889fa2");
  for (const { kind, x, z, scale } of definition.scenery ?? []) {
    if (roads.some(({ rows }) => rows.some((row) => Math.hypot(row.x - x, row.z - z) < row.halfWidth + 3))) continue;
    const groundY = terrain.heightAt(x, z);
    if (kind === "rock") {
      const rock = CreateIcoSphere("rock", { radius: scale * 1.4, subdivisions: 0, flat: true }, scene);
      rock.scaling.set(1.4, .8, 1);
      rock.position.set(x, groundY + scale * .48, z);
      rock.material = stones;
      staticPieces.push(rock);
      continue;
    }
    const height = scale * (kind === "pine" ? 7 : 4);
    const stem = CreateCylinder(kind + " trunk", { height: height * .72, diameter: scale * .75, tessellation: 6 }, scene);
    stem.material = kind === "pine" ? bark : foliage;
    stem.position.set(x, groundY + height * .36, z);
    staticPieces.push(stem);
    if (kind === "cactus") {
      for (const side of [-1, 1]) box("cactus arm", [scale * .78, height * .21, .49], [x + side * scale * .61, groundY + height * (side < 0 ? .40 : .53), z], foliage);
      continue;
    }
    for (let layer = 0; layer < 3; layer++) {
      const crown = CreateCylinder("pine crown", { height: height * .47, diameterBottom: scale * (3.4 - layer * .65), diameterTop: 0, tessellation: 7 }, scene);
      crown.material = alpine && layer === 2 ? snow : foliage;
      crown.position.set(x, groundY + height * (.43 + layer * .17), z);
      staticPieces.push(crown);
    }
  }

  const { football, bowling, stars } = definition.attractions;
  const target = { ...goal, x: football.x, y: football.y, z: football.z };
  const footballGoal = addFootballGoal(scene, staticPieces, target);
  const playthings = createPlaythings(scene, physics, shadows, {
    target, balls: [{ x: football.x, y: football.y, z: football.z - 15 }], stacks: [],
  });
  const stuntToys = createStuntToys(scene, physics, shadows, { bowling, stars });

  const batches = new Map<typeof edge, Mesh[]>();
  for (const piece of staticPieces) {
    const material = piece.material as typeof edge;
    const batch = batches.get(material) ?? [];
    batch.push(piece);
    batches.set(material, batch);
  }
  for (const batch of batches.values()) {
    const mesh = Mesh.MergeMeshes(batch, true, true);
    if (!mesh) continue;
    mesh.freezeWorldMatrix();
    mesh.receiveShadows = true;
  }

  return {
    padAt: () => -1,
    stepStuntToys: stuntToys.step,
    checkGoals(dt: number, car: Parameters<typeof playthings.checkGoals>[1]) {
      const scored = playthings.checkGoals(dt, car);
      if (scored) footballGoal.celebrate();
      return scored;
    },
    sync(car: Parameters<typeof playthings.sync>[0], _boost: number, dt: number) {
      playthings.sync(car);
      stuntToys.render(dt);
      footballGoal.update(dt);
    },
  };
}
