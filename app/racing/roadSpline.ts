export type RoadVector = { x: number; y: number; z: number };

export type RoadKnot = {
  position: RoadVector;
  /** Derivative with respect to cumulative knot-to-knot chord distance. */
  tangent: RoadVector;
  halfWidth: number;
  /** Roll in radians. Positive roll raises the right edge. */
  bank?: number;
  /** Rise of the two edges above the road center, measured in the road frame. */
  crown?: number;
};

const add = (a: RoadVector, b: RoadVector): RoadVector => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (v: RoadVector, s: number): RoadVector => ({ x: v.x * s, y: v.y * s, z: v.z * s });
const dot = (a: RoadVector, b: RoadVector) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: RoadVector, b: RoadVector): RoadVector => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const length = (v: RoadVector) => Math.hypot(v.x, v.y, v.z);
function unit(v: RoadVector) {
  const size = length(v);
  if (!(size > 1e-9) || !Number.isFinite(size)) throw new Error("Road spline has an invalid tangent or frame");
  return scale(v, 1 / size);
}

function transport(right: RoadVector, from: RoadVector, to: RoadVector) {
  const axis = cross(from, to);
  const cosine = dot(from, to);
  if (cosine < -.999999) throw new Error("Road spline reverses direction between samples");
  // Shortest rotation between successive tangents, without adding roll.
  const rotated = add(right, add(cross(axis, right), scale(cross(axis, cross(axis, right)), 1 / (1 + cosine))));
  return unit(add(rotated, scale(to, -dot(rotated, to))));
}

/** Sample a continuous Hermite chain. Keep connected spans in the same chain to share their frame. */
export function sampleRoadSpline(knots: readonly RoadKnot[], spacing = 1, alignEnd = false, frame: "transport" | "upright" = "transport") {
  if (knots.length < 2 || !(spacing > 0) || !Number.isFinite(spacing)) {
    throw new Error("Road spline requires two or more knots and positive sample spacing");
  }
  for (const { position, tangent, halfWidth, bank = 0, crown = 0 } of knots) {
    if (!Number.isFinite(length(position)) || !Number.isFinite(length(tangent)) ||
      length(tangent) < 1e-9 || !(halfWidth > 0) || !Number.isFinite(halfWidth) || !Number.isFinite(bank) || !Number.isFinite(crown)) {
      throw new Error("Road spline knot requires finite geometry, a nonzero tangent and positive width");
    }
  }

  let forward = unit(knots[0].tangent);
  const reference = Math.abs(forward.y) > .99 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  let right = unit(cross(reference, forward));

  function row(position: RoadVector, tangent: RoadVector, halfWidth: number, bank: number, crown: number) {
    const direction = unit(tangent);
    // World-up banking keeps long, multi-level turns from accumulating unintended roll.
    right = frame === "upright" && Math.abs(direction.y) < .95
      ? unit(cross({ x: 0, y: 1, z: 0 }, direction))
      : transport(right, forward, direction);
    forward = direction;
    const up = cross(forward, right);
    return {
      ...position,
      heading: Math.atan2(forward.x, forward.z),
      halfWidth, crown,
      frameRight: add(scale(right, Math.cos(bank)), scale(up, Math.sin(bank))),
      frameUp: add(scale(up, Math.cos(bank)), scale(right, -Math.sin(bank))),
    };
  }

  const first = knots[0];
  const rows = [row(first.position, first.tangent, first.halfWidth, first.bank ?? 0, first.crown ?? 0)];
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1];
    const b = knots[i];
    const delta = add(b.position, scale(a.position, -1));
    const distance = length(delta);
    if (!(distance > 1e-6) || !Number.isFinite(distance)) throw new Error("Road spline knots must be distinct neighbours");
    const start = scale(a.tangent, distance);
    const end = scale(b.tangent, distance);
    // The equivalent Bézier control polygon bounds the span length.
    const extent = (length(start) + length(end)) / 3 + length(add(delta, scale(add(start, end), -1 / 3)));
    const steps = Math.max(2, Math.ceil(extent / spacing));
    if (rows.length + steps > 20_000) throw new Error("Road spline exceeds the sample limit");
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const smooth = t * t * (3 - 2 * t);
      const position = step === steps ? b.position : add(a.position, add(
        scale(delta, smooth),
        add(scale(start, t * (1 - t) ** 2), scale(end, t * t * (t - 1))),
      ));
      const tangent = step === steps ? b.tangent : add(scale(delta, 6 * t * (1 - t)),
        add(scale(start, 1 - 4 * t + 3 * t * t), scale(end, 3 * t * t - 2 * t)));
      rows.push(row(position, tangent, a.halfWidth + (b.halfWidth - a.halfWidth) * smooth,
        (a.bank ?? 0) + ((b.bank ?? 0) - (a.bank ?? 0)) * smooth,
        (a.crown ?? 0) + ((b.crown ?? 0) - (a.crown ?? 0)) * smooth));
    }
  }
  if (alignEnd && Math.abs(forward.y) < .99) {
    // Match the upright reference of the next independently sampled road.
    const desired = unit(cross({ x: 0, y: 1, z: 0 }, forward));
    const correction = Math.atan2(dot(cross(right, desired), forward), dot(right, desired));
    for (let i = 1; i < rows.length; i++) {
      const t = i / (rows.length - 1);
      const angle = correction * t * t * (3 - 2 * t);
      const { frameRight, frameUp } = rows[i];
      rows[i].frameRight = add(scale(frameRight, Math.cos(angle)), scale(frameUp, Math.sin(angle)));
      rows[i].frameUp = add(scale(frameUp, Math.cos(angle)), scale(frameRight, -Math.sin(angle)));
    }
  }
  return rows;
}
