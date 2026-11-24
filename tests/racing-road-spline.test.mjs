import assert from "node:assert/strict";
import { test } from "node:test";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { sampleRoadSpline } from "../app/racing/roadSpline.ts";
import { paint, surface } from "../app/racing/surfaces.ts";

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);

test("spline carries a continuous orthonormal frame through a steep three-dimensional turn", () => {
  const knots = [
    { position: { x: 0, y: 0, z: 0 }, tangent: { x: 0, y: 0, z: 1 }, halfWidth: 3 },
    { position: { x: 0, y: 6, z: 6 }, tangent: { x: 0, y: 1, z: 0 }, halfWidth: 4, bank: .4 },
    { position: { x: 6, y: 12, z: 6 }, tangent: { x: 1, y: 0, z: 0 }, halfWidth: 5 },
  ];
  const rows = sampleRoadSpline(knots, .15);
  const join = rows.findIndex(({ x, y, z }) => x === 0 && y === 6 && z === 6);
  assert.ok(join > 0);
  assert.equal(rows[join].halfWidth, 4);
  close(rows[join].frameRight.y, 0);
  close(rows[join].frameRight.x, Math.cos(.4));
  for (let i = 0; i < rows.length; i++) {
    const { frameRight, frameUp } = rows[i];
    close(dot(frameRight, frameRight), 1);
    close(dot(frameUp, frameUp), 1);
    close(dot(frameRight, frameUp), 0);
    if (i) assert.ok(dot(frameRight, rows[i - 1].frameRight) > .99);
  }
  for (const neighbour of [rows[join - 1], rows[join + 1]]) {
    assert.ok(Math.hypot(neighbour.x, neighbour.z - 6) < Math.abs(neighbour.y - 6) * .05);
    close(neighbour.halfWidth, 4, .002);
  }
});

test("spline cross-section gives the rendered and physical road the same banked vertices", async (t) => {
  await RAPIER.init();
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const physics = new RAPIER.World({ x: 0, y: -16, z: 0 });
  t.after(() => { scene.dispose(); engine.dispose(); physics.free(); });
  const rows = sampleRoadSpline([0, 10].map((z) => ({
    position: { x: 0, y: 4, z }, tangent: { x: 0, y: 0, z: 1 }, halfWidth: 3, bank: .3,
  })));
  const mesh = surface(scene, "banked road", paint(scene, "#596477"), rows, [-1, 0, 1], physics);
  let collider;
  physics.forEachCollider((item) => { collider = item; });
  function triangles(vertices, indices) {
    const result = [];
    for (let i = 0; i < indices.length; i += 3) {
      const corners = Array.from(indices.slice(i, i + 3), (index) => vertices.slice(index * 3, index * 3 + 3).join(","));
      result.push(corners.sort().join("|"));
    }
    return result.sort();
  }
  const positions = new Float32Array(mesh.getVerticesData("position"));
  // Rapier can reorder vertices when fixing internal edges.
  assert.deepEqual(triangles(collider.vertices(), collider.indices()), triangles(positions, mesh.getIndices()));
  close(positions[7], 4 + 3 * Math.sin(.3));
});
