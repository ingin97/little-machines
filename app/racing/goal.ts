import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { paint } from "./surfaces.ts";

export const goal = { x: 30, z: -13, halfWidth: 6.5, height: 5.5 };

export function crossedGoal(previous: { x: number; y: number; z: number }, ball: { x: number; y: number; z: number }, radius: number) {
  const line = goal.z + radius;
  if (previous.z >= line || ball.z < line) return false;
  const amount = (line - previous.z) / (ball.z - previous.z);
  const x = previous.x + (ball.x - previous.x) * amount;
  const y = previous.y + (ball.y - previous.y) * amount;
  return Math.abs(x - goal.x) + radius <= goal.halfWidth && y > 0 && y + radius <= goal.height;
}

export function addFootballGoal(scene: Scene, pieces: Mesh[]) {
  const white = paint(scene, "#fff5d8");
  const pink = paint(scene, "#ee6389");
  const grass = paint(scene, "#8bcc75");
  function box(name: string, w: number, h: number, d: number, x: number, y: number, z: number, material: typeof white) {
    const mesh = CreateBox(name, { width: w, height: h, depth: d }, scene);
    mesh.position.set(x, y, z);
    mesh.material = material;
    pieces.push(mesh);
  }
  const { x, z, halfWidth, height } = goal;
  box("football pitch", 20, .025, 26, x, .012, z - 10, grass);
  box("football goal line", halfWidth * 2, .04, .18, x, .035, z, white);
  box("football crossbar", halfWidth * 2 + .55, .38, .38, x, height + .16, z, white);
  for (const side of [-1, 1]) {
    const postX = x + side * (halfWidth + .14);
    box("football goalpost", .42, height + .28, .42, postX, height / 2, z, white);
    box("football post pad", .73, 1.1, .73, postX, .55, z, pink);
    box("football back support", .28, height, .28, postX, height / 2, z + 3.6, pink);
  }
  for (let i = -6; i <= 6; i++) box("football net", .06, height, .06, x + i, height / 2, z + 3.6, white);
  for (let i = 1; i < 6; i++) box("football net", halfWidth * 2, .065, .065, x, height * i / 6, z + 3.6, white);

  const colors = ["#ffce55", "#eb6699", "#48c6c4", "#9276df"].map((color) => paint(scene, color));
  const confetti = Array.from({ length: 32 }, (_, i) => {
    const mesh = CreateBox("goal confetti", { width: .31, height: .25, depth: .07 }, scene);
    mesh.material = colors[i % colors.length];
    mesh.setEnabled(false);
    return mesh;
  });
  let elapsed = 2;
  return {
    celebrate() {
      elapsed = 0;
      for (const mesh of confetti) mesh.setEnabled(true);
    },
    update(dt: number) {
      if (elapsed >= 1.8) return;
      elapsed += dt;
      for (const [i, mesh] of confetti.entries()) {
        const angle = i * 2.39996;
        const speed = 2.2 + i % 6 * .64;
        mesh.position.set(x + Math.cos(angle) * speed * elapsed,
          3.1 + (4.4 + i % 5 * .8) * elapsed - 5 * elapsed ** 2, z + Math.sin(angle) * speed * elapsed);
        mesh.rotation.set(elapsed * (3 + i % 3), angle, elapsed * 4 + i);
        if (elapsed >= 1.8 || mesh.position.y < 0) mesh.setEnabled(false);
      }
    },
  };
}

export function serveAreaClear(car: Vector3, home: Vector3) {
  return Math.hypot(car.x - home.x, car.z - home.z) > 5;
}
