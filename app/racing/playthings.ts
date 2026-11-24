import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { CreateIcoSphere } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { crossedGoal, goal, serveAreaClear } from "./goal.ts";
import { paint } from "./surfaces.ts";

export function createPlaythings(scene: Scene, physics: RAPIER.World, shadows: ShadowGenerator, layout = {
  target: goal,
  balls: [{ x: 30, y: 0, z: -29 }, { x: 43, y: 0, z: -34 }, { x: -31, y: 0, z: 32 }],
  stacks: [[36, 34], [-38, 38], [100, 13]],
}) {
  const cream = paint(scene, "#fff9df");
  const dark = paint(scene, "#38405d");
  const colors = ["#fc7355", "#f6c759", "#5ec6be", "#818be1"].map((color) => paint(scene, color));
  const objects: { node: TransformNode; body: RAPIER.RigidBody; home: Vector3 }[] = [];
  const footballs: { body: RAPIER.RigidBody; home: Vector3; previous: Vector3; scoredFor: number }[] = [];
  function add(node: TransformNode, home: Vector3, shape: RAPIER.ColliderDesc) {
    const body = physics.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(home.x, home.y, home.z).setLinearDamping(.24).setAngularDamping(.25).setCcdEnabled(true));
    physics.createCollider(shape, body);
    node.rotationQuaternion = Quaternion.Identity();
    node.position.copyFrom(home);
    objects.push({ node, body, home });
    return body;
  }

  const radius = 1.8;
  const golden = (1 + Math.sqrt(5)) / 2;
  const directions = [];
  for (const a of [-1, 1]) for (const b of [-golden, golden]) {
    directions.push(new Vector3(0, a, b), new Vector3(b, 0, a), new Vector3(a, b, 0));
  }
  for (const { x, y, z } of layout.balls) {
    const ball = CreateIcoSphere("football", { radius, subdivisions: 3, flat: true }, scene);
    ball.material = cream;
    shadows.addShadowCaster(ball);
    const panels = new Mesh("football panels", scene);
    const data = new VertexData();
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (const direction of directions) {
      const normal = direction.normalizeToNew();
      const tangent = Vector3.Cross(Vector3.Up(), normal).normalize();
      const bitangent = Vector3.Cross(normal, tangent);
      const center = positions.length / 3;
      const append = (point: Vector3) => {
        normals.push(point.x, point.y, point.z);
        positions.push(point.x * (radius + .018), point.y * (radius + .018), point.z * (radius + .018));
      };
      append(normal);
      for (let i = 0; i < 5; i++) {
        const angle = i * Math.PI * 2 / 5;
        append(normal.add(tangent.scale(Math.cos(angle) * .32))
          .add(bitangent.scale(Math.sin(angle) * .32)).normalize());
        indices.push(center, center + 1 + (i + 1) % 5, center + 1 + i);
      }
    }
    data.positions = positions;
    data.normals = normals;
    data.indices = indices;
    data.applyToMesh(panels);
    panels.parent = ball;
    panels.material = dark;
    const home = new Vector3(x, y + radius + .06, z);
    const body = add(ball, home, RAPIER.ColliderDesc.ball(radius).setMass(26).setFriction(.54).setRestitution(.55));
    footballs.push({ body, home, previous: home.clone(), scoredFor: -1 });
  }

  for (const [x, z] of layout.stacks) {
    const size = 1.55;
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3 - row; column++) {
        const block = CreateBox("stacking block", { size }, scene);
        block.material = colors[(row * 2 + column) % colors.length];
        shadows.addShadowCaster(block);
        add(block, new Vector3(x + (column - (2 - row) / 2) * (size + .04), (row + .5) * size + row * .02 + .025, z),
          RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2).setMass(15).setFriction(.73).setRestitution(.18));
      }
    }
  }

  function returnHome(body: RAPIER.RigidBody, home: Vector3) {
    body.setTranslation(home, true);
    body.setLinvel(Vector3.Zero(), true);
    body.setAngvel(Vector3.Zero(), true);
    body.setRotation(Quaternion.Identity(), true);
  }

  function checkGoals(dt: number, car: Vector3) {
    let scored = false;
    for (const ball of footballs) {
      const { body, home, previous } = ball;
      const point = body.translation();
      if (ball.scoredFor >= 0) {
        ball.scoredFor += dt;
        if (ball.scoredFor > 1.25 && serveAreaClear(car, home) && footballs.every((other) => {
          if (other === ball) return true;
          const location = other.body.translation();
          return Math.hypot(location.x - home.x, location.z - home.z) > radius * 2;
        })) {
          returnHome(body, home);
          previous.copyFrom(home);
          ball.scoredFor = -1;
          continue;
        }
      } else if (crossedGoal(previous, point, radius, layout.target)) {
        ball.scoredFor = 0;
        const velocity = body.linvel();
        body.setLinvel({ x: velocity.x * .24, y: velocity.y, z: velocity.z * .20 }, true);
        scored = true;
      }
      previous.set(point.x, point.y, point.z);
    }
    return scored;
  }

  function sync(car: Vector3) {
    for (const { node, body, home } of objects) {
      const point = body.translation();
      if ((point.y < -6 || Math.hypot(point.x, point.z) > 260) && Vector3.DistanceSquared(car, home) > 100) {
        returnHome(body, home);
        const ball = footballs.find((item) => item.body === body);
        if (ball) { ball.previous.copyFrom(home); ball.scoredFor = -1; }
      }
      const current = body.translation();
      const rotation = body.rotation();
      node.position.set(current.x, current.y, current.z);
      node.rotationQuaternion!.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }
  }
  return { sync, checkGoals };
}
