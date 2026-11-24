import { Quaternion } from "@babylonjs/core/Maths/math.vector.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { createCarVisual } from "./carVisual.ts";
import { decodeRecord, gateCrossing, maxReplaySeconds, type GhostFrame } from "./sprintRules.ts";
import type { createSprintCourse } from "./sprintCourse.ts";
import { stepTime, type createVehicle } from "./vehicle.ts";

type SprintCourse = Pick<ReturnType<typeof createSprintCourse>, "gates" | "recordKey" | "highlight">;

const countdownTicks = 180;
const seconds = new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatTime = (time: number) => `${seconds.format(time)} s`;

export function createSprint(scene: Scene, course: SprintCourse, car: ReturnType<typeof createVehicle>) {
  const clock = document.querySelector("#sprint-clock")!;
  const best = document.querySelector("#sprint-best")!;
  const progress = document.querySelector("#sprint-progress")!;
  const split = document.querySelector<HTMLElement>("#sprint-split")!;
  const message = document.querySelector("#sprint-message")!;
  const ghost = createCarVisual(scene);
  ghost.setLook("beach");
  for (const mesh of ghost.root.getChildMeshes()) mesh.visibility = .34;
  const rotationA = new Quaternion();
  const rotationB = new Quaternion();

  function readRecord() {
    try {
      return decodeRecord(localStorage.getItem(course.recordKey), course.gates.length);
    } catch {
      return;
    }
  }

  let record = readRecord();
  let replay = record;
  let frames: GhostFrame[] = [];
  let splits: number[] = [];
  let remaining = countdownTicks;
  let ticks = 0;
  let elapsed = 0;
  let splitTimeout: ReturnType<typeof setTimeout> | undefined;
  let cursor = 0;
  let finished = false;
  let revision = car.revision();
  let frameStart = car.position();

  function capture(time: number): GhostFrame {
    const { x, y, z } = car.position();
    const rotation = car.rotation();
    return [time, x, y, z, rotation.x, rotation.y, rotation.z, rotation.w, car.steering(), car.wheelRotation()];
  }

  function updateBest() {
    const time = record?.splits.at(-1);
    best.textContent = time === undefined ? "–" : formatTime(time);
  }

  function updateProgress() {
    course.highlight(splits.length);
    progress.textContent = finished ? "Alle porter passert" : `Port ${splits.length + 1} av ${course.gates.length}`;
  }

  function announce(text: string) {
    if (message.textContent !== text) message.textContent = text;
  }

  function reset() {
    car.reset();
    revision = car.revision();
    remaining = countdownTicks;
    elapsed = ticks = cursor = 0;
    finished = false;
    replay = record;
    frames = [capture(0)];
    splits = [];
    clearTimeout(splitTimeout);
    split.textContent = "";
    announce("3");
    updateBest();
    updateProgress();
  }

  function beforeStep() {
    if (remaining > 0) {
      remaining--;
      announce(remaining ? String(Math.ceil(remaining / 60)) : "Kjør!");
      return false;
    }
    if (finished) return false;
    frameStart = car.position();
    return true;
  }

  function afterStep() {
    if (revision !== car.revision() || elapsed >= maxReplaySeconds - stepTime) {
      reset();
      return;
    }
    elapsed = ++ticks * stepTime;
    if (ticks === 54) announce("");
    const gate = course.gates[splits.length];
    const fraction = gateCrossing(frameStart, car.position(), gate);
    if (fraction !== null) {
      const time = (ticks - 1 + fraction) * stepTime;
      const reference = replay?.splits[splits.length];
      if (reference !== undefined) {
        const delta = time - reference;
        const sign = Math.abs(delta) < .005 ? "" : delta > 0 ? "+" : "−";
        clearTimeout(splitTimeout);
        split.textContent = `${sign}${formatTime(Math.abs(delta))}`;
        split.dataset.delta = sign ? (delta > 0 ? "behind" : "ahead") : "even";
        splitTimeout = setTimeout(() => { split.textContent = ""; }, 1800);
      }
      splits.push(time);
      finished = splits.length === course.gates.length;
      updateProgress();
      if (finished) {
        elapsed = time;
        // A second tab may have improved the record during this run.
        const saved = readRecord();
        if (saved && saved.splits.at(-1)! < (record?.splits.at(-1) ?? Infinity)) record = saved;
        if (time < (record?.splits.at(-1) ?? Infinity)) {
          if (frames.at(-1)![0] >= time) frames.pop();
          frames.push(capture(time));
          record = { splits, frames };
          try {
            localStorage.setItem(course.recordKey, JSON.stringify(record));
          } catch { /* Keep the personal best for this session. */ }
          updateBest();
          announce(`Ny rekord! ${formatTime(time)}`);
        } else {
          updateBest();
          announce(`I mål! ${formatTime(time)}`);
        }
        return;
      }
    }
    if (ticks % 3 === 0) frames.push(capture(elapsed));
  }

  function draw(alpha: number) {
    const time = finished ? elapsed : Math.max(0, elapsed - (1 - alpha) * stepTime);
    const label = formatTime(time);
    if (clock.textContent !== label) clock.textContent = label;
    ghost.root.setEnabled(Boolean(replay));
    if (!replay) return;
    const { frames: replayFrames } = replay;
    while (cursor > 0 && replayFrames[cursor][0] > time) cursor--;
    while (cursor + 1 < replayFrames.length && replayFrames[cursor + 1][0] <= time) cursor++;
    const a = replayFrames[cursor];
    const b = replayFrames[cursor + 1] ?? a;
    const blend = a === b ? 0 : (time - a[0]) / (b[0] - a[0]);
    const value = (i: number) => a[i] + (b[i] - a[i]) * blend;
    ghost.root.position.set(value(1), value(2), value(3));
    rotationA.set(a[4], a[5], a[6], a[7]);
    rotationB.set(b[4], b[5], b[6], b[7]);
    Quaternion.SlerpToRef(rotationA, rotationB, blend, ghost.root.rotationQuaternion!);
    for (const [i, { pivot, spin }] of ghost.wheels.entries()) {
      pivot.rotation.y = i < 2 ? value(8) : 0;
      spin.rotation.x = value(9);
    }
  }

  reset();
  return { reset, beforeStep, afterStep, draw, driving: () => remaining === 0 && !finished };
}
