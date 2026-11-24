import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { createLocalMultiplayer } from "../app/racing/localMultiplayer.ts";
import { connectLocalCars } from "../app/racing/localRoom.ts";

const pose = {
  position: [0, .8, -8],
  rotation: [0, 0, 0, 1],
  look: "rally",
  speed: 0,
  steering: 0,
  reset: 1,
};

async function received(predicate) {
  const deadline = performance.now() + 2_000;
  while (!predicate() && performance.now() < deadline) await setTimeout(10);
  assert.ok(predicate(), "local car update arrived");
}

test("local cars discover each other, exchange poses and leave the room", async () => {
  const roomName = `test-kjoreparken-${crypto.randomUUID()}`;
  let firstPose = pose;
  const first = connectLocalCars(() => firstPose, roomName);
  assert.ok(first);
  const second = connectLocalCars(() => ({ ...pose, look: "rocket" }), roomName);
  assert.ok(second);
  let secondClosed = false;
  try {
    await received(() => first.peers().size === 1 && second.peers().size === 1);
    assert.equal([...first.peers().values()][0].pose.look, "rocket");
    firstPose = { ...pose, position: [9, 1, 15], speed: -3, reset: 2 };
    await received(() => [...second.peers().values()][0]?.pose.reset === 2);
    assert.deepEqual([...second.peers().values()][0].pose.position, [9, 1, 15]);
    assert.equal([...second.peers().values()][0].pose.speed, -3);
    assert.equal(second.peers(performance.now() + 16_000).size, 0);
    second.close();
    secondClosed = true;
    await received(() => first.peers().size === 0);
  } finally {
    if (!secondClosed) second.close();
    first.close();
  }
});


test("the scene shows a marked remote car and cleans it up on leave", async (t) => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const status = { hidden: true, textContent: "" };
  const view = createLocalMultiplayer(scene, () => pose, status);
  const second = connectLocalCars(() => ({
    ...pose, position: [3.35, .8, -8], look: "beach",
  }));
  assert.ok(second);
  t.after(() => { view.disconnect(); scene.dispose(); engine.dispose(); });
  let closed = false;
  t.after(() => { if (!closed) second.close(); });
  await received(() => { view.update(1 / 60); return !status.hidden; });
  assert.equal(status.textContent, "2 spiller lokalt");
  const marker = scene.getMeshByName("local player marker");
  assert.ok(marker);
  assert.equal(marker.position.x, 3.35);
  assert.equal(scene.getTransformNodeByName("surfboard").isEnabled(), true);

  second.close();
  closed = true;
  await received(() => { view.update(1 / 60); return status.hidden; });
  assert.equal(scene.getMeshByName("local player marker"), null);
  assert.equal(scene.getTransformNodeByName("car"), null);
});
