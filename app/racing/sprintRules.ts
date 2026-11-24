export type RacePoint = { x: number; z: number; y?: number };
type Gate = RacePoint & { heading: number; halfWidth: number };
export type GhostFrame = [time: number, x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number, steer: number, wheelRotation: number];
export type RaceRecord = { splits: number[]; frames: GhostFrame[] };
export const maxReplaySeconds = 600;

export function gateCrossing(from: RacePoint, to: RacePoint, gate: Gate) {
  const sin = Math.sin(gate.heading);
  const cos = Math.cos(gate.heading);
  const start = (from.x - gate.x) * sin + (from.z - gate.z) * cos;
  const end = (to.x - gate.x) * sin + (to.z - gate.z) * cos;
  if (start >= 0 || end < 0) return null;
  const fraction = -start / (end - start);
  if (gate.y !== undefined && from.y !== undefined && to.y !== undefined
    && Math.abs(from.y + (to.y - from.y) * fraction - gate.y) > 3) return null;
  const lateral = (from.x + (to.x - from.x) * fraction - gate.x) * cos
    - (from.z + (to.z - from.z) * fraction - gate.z) * sin;
  return Math.abs(lateral) <= gate.halfWidth ? fraction : null;
}

export function decodeRecord(raw: string | null, gateCount: number): RaceRecord | undefined {
  try {
    const record = JSON.parse(raw ?? "null");
    if (!Array.isArray(record?.splits) || record.splits.length !== gateCount
      || !Array.isArray(record.frames) || record.frames.length < 2 || record.frames.length > maxReplaySeconds * 20 + 2) return;
    const { frames, splits } = record as RaceRecord;
    if (splits.some((time, i) => !Number.isFinite(time) || time <= (splits[i - 1] ?? 0) || time > maxReplaySeconds)) return;
    if (frames.some((frame, i) => !Array.isArray(frame) || frame.length !== 10
      || !frame.every(Number.isFinite) || (i > 0 && frame[0] <= frames[i - 1][0]))) return;
    if (frames[0][0] !== 0 || frames.at(-1)![0] !== splits.at(-1)) return;
    return { frames, splits };
  } catch {
    return;
  }
}
