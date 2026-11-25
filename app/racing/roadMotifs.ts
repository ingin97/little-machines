import type { RoadKnot, RoadVector } from "./roadSpline.ts";

const rounded = (value: number) => Math.round(value * 1e5) / 1e5 || 0;
const vector = (x: number, y: number, z: number): RoadVector => ({ x: rounded(x), y: rounded(y), z: rounded(z) });

export function roadKnot(position: RoadVector, tangent: RoadVector, halfWidth: number, bank = 0): RoadKnot {
  return { position: vector(position.x, position.y, position.z), tangent: vector(tangent.x, tangent.y, tangent.z), halfWidth, bank: rounded(bank) };
}

/** Sample a parametrized motif into Hermite knots with derivatives per metre. */
function curve(steps: number, point: (t: number) => RoadVector, halfWidth: number, bank: (t: number) => number) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const before = point(t - .00001);
    const after = point(t + .00001);
    const x = after.x - before.x, y = after.y - before.y, z = after.z - before.z;
    const norm = Math.hypot(x, y, z);
    return roadKnot(point(t), { x: x / norm, y: y / norm, z: z / norm }, halfWidth, bank(t));
  });
}

export function circuitArc(centerX: number, radiusX: number, radiusZ: number, level: number, quarter: number, rise: number, bank: number) {
  return curve(6, (t) => {
    const angle = (quarter + t) * Math.PI / 2;
    return { x: centerX + radiusX * Math.sin(angle), z: -radiusZ * Math.cos(angle), y: level + rise * Math.sin(t * Math.PI) ** 2 };
  }, 7, (t) => bank * Math.sin(t * Math.PI) ** 2);
}

export function figureEight(centerX: number, level: number, lift: number, bank: number) {
  return curve(24, (t) => {
    const angle = (t * 2 - .5) * Math.PI;
    // The west tip is the access junction. The two centre passes are half a turn apart.
    const hump = Math.max(0, -Math.cos(angle));
    return { x: centerX + 67 * Math.sin(angle), z: 43 * Math.sin(2 * angle), y: level + lift * hump ** 2 };
  }, 5.5, (t) => bank * Math.sin(t * 4 * Math.PI) * Math.sin(t * Math.PI) ** 2);
}

export function mountainSpiral(centerX: number, radius: number, level: number, turns: number, rise: number, handedness: number) {
  return curve(Math.round(turns * 12), (t) => {
    const angle = turns * 2 * Math.PI * t;
    // Ease the first and last eighth of the climb while keeping the interior grade nearly constant.
    const ease = (n: number) => n < .125 ? 4 * n * n : n > .875 ? .875 - 4 * (1 - n) ** 2 : n - .0625;
    return { x: centerX + radius * Math.cos(angle), z: handedness * radius * Math.sin(angle), y: level + rise * ease(t) / .875 };
  }, 6, (t) => -.20 * handedness * Math.sin(t * Math.PI));
}

export function switchback(start: RoadVector, direction: number, rise: number) {
  const stations = [
    [0, 0, 0, 1], [0, 22, 0, 1], [-16, 38, -1, 0], [-68, 38, -1, 0],
    [-82, 52, 0, 1], [-68, 66, 1, 0], [-17, 66, 1, 0],
    [-3, 80, 0, 1], [-17, 94, -1, 0], [-78, 94, -1, 0],
  ];
  const distances = [0];
  for (let i = 1; i < stations.length; i++) {
    distances.push(distances[i - 1] + Math.hypot(stations[i][0] - stations[i - 1][0], stations[i][1] - stations[i - 1][1]));
  }
  const total = distances.at(-1)!;
  return stations.map(([x, z, tx, tz], i) => {
    const t = distances[i] / total;
    const bank = (i === 4 ? -.2 : i === 7 ? .2 : 0) * direction;
    return roadKnot({ x: start.x + x, z: start.z + z * direction, y: start.y + rise * t * t * (3 - 2 * t) },
      { x: tx, y: 6 * rise * t * (1 - t) / total, z: tz * direction }, 5.5, bank);
  });
}

export function scenicBypass(centerX: number, halfZ: number, level: number, width: number) {
  return curve(12, (t) => ({
    x: centerX + width * Math.sin(Math.PI * t), z: -halfZ * Math.cos(Math.PI * t), y: level,
  }), 7, () => 0);
}

export function elevatedHighway(x: number, level: number, halfLength: number, height: number, steps = 12) {
  return curve(steps, (t) => ({
    x: x + (2 * t - 1) * halfLength,
    z: 18 * Math.sin(2 * Math.PI * t) * Math.sin(Math.PI * t) ** 2,
    y: level + height * Math.sin(Math.PI * t) ** 2,
  }), 7, (t) => .18 * Math.sin(2 * Math.PI * t) * Math.sin(Math.PI * t) ** 2);
}

/** A long return from the north end of a spiral to a low circuit hub. */
export function mountainDescent(summit: RoadKnot, north: RoadVector) {
  const height = summit.position.y - north.y;
  const at = (x: number, z: number, fraction: number, tx: number, ty: number, tz: number, bank: number) =>
    roadKnot({ x, y: north.y + fraction * height, z }, { x: tx, y: ty, z: tz }, 7, bank);
  return [
    summit,
    at(-275, 60, .88, -.46, -.16, .86, -.19),
    at(-281, 115, .70, .1, -.19, .97, -.24),
    at(-246, 158, .55, .90, 0, .42, -.18),
    at(-165, 187, .33, .99, -.16, .09, -.08),
    at(-85, 180, .19, .83, -.15, -.54, -.19),
    roadKnot(north, { x: 0, y: 0, z: -1 }, 7),
  ];
}
