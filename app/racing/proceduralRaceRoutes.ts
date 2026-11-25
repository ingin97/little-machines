import { sampleWorldRoads, type WorldDefinition } from "./worldDefinition.ts";

type SampledRoad = ReturnType<typeof sampleWorldRoads>[number];
type Row = SampledRoad["rows"][number];
type Leg = { road: SampledRoad; from: string; to: string; reversed: boolean };
const distance = (a: Row, b: Row) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function orient({ road, reversed }: Leg) {
  if (!reversed) return road.rows;
  return road.rows.slice().reverse().map((row) => ({
    ...row, heading: Math.atan2(-Math.sin(row.heading), -Math.cos(row.heading)),
    frameRight: { x: -row.frameRight.x, y: -row.frameRight.y, z: -row.frameRight.z },
  }));
}

/** Rank bounded, continuous graph paths in both directions. Keep distinct courses, not reverse duplicates. */
export function selectRaceRoutes(world: WorldDefinition, roads = sampleWorldRoads(world)) {
  const outgoing = new Map<string, Leg[]>();
  const starts: Leg[] = [];
  for (const road of roads) {
    if (road.road.structure === "ramp" || road.rows.some(({ crown }) => crown > .5)) continue;
    const { from, to } = road.road;
    for (const leg of [{ road, from, to, reversed: false }, { road, from: to, to: from, reversed: true }]) {
      starts.push(leg);
      const edges = outgoing.get(leg.from) ?? [];
      edges.push(leg);
      outgoing.set(leg.from, edges);
    }
  }

  const ranked: {
    id: string; rows: Row[]; score: number; signature: string; label: string;
  }[] = [];
  const last = (leg: Leg) => leg.reversed ? leg.road.rows[0] : leg.road.rows.at(-1)!;
  const first = (leg: Leg) => leg.reversed ? leg.road.rows.at(-1)! : leg.road.rows[0];
  function search(path: Leg[]) {
    const start = path[0], end = path.at(-1)!;
    const rows = path.flatMap((leg, i) => i ? orient(leg).slice(1) : orient(leg));
    let length = 0, turning = 0, banking = 0, low = Infinity, high = -Infinity;
    for (const [index, row] of rows.entries()) {
      low = Math.min(low, row.y);
      high = Math.max(high, row.y);
      banking += Math.abs(row.frameRight.y);
      if (!index) continue;
      const prior = rows[index - 1];
      length += distance(prior, row);
      turning += Math.abs(Math.atan2(Math.sin(row.heading - prior.heading), Math.cos(row.heading - prior.heading)));
    }
    if (length > 950) return;
    const loop = start.from === end.to;
    if (length >= 125 && rows.length > 24 && rows.slice(3, 9).some((row) => row.frameUp.y > .975)
      && rows.slice(-12, -5).some((row) => row.frameUp.y > .94)) {
      const id = path.map(({ road, reversed }) => road.road.id + (reversed ? "-reverse" : "")).join(".");
      const signature = path.map(({ road }) => road.road.id).sort().join(".");
      const descent = rows[0].y - rows.at(-1)!.y;
      const elevation = high - low;
      const variety = new Set(path.map(({ road }) => road.road.surface)).size;
      const deckBonus = path.some(({ road }) => road.road.structure === "deck") ? 23 : 0;
      const score = Math.min(length, 760) * .21 + elevation * 2.3 + descent * .75 + Math.min(turning, 10) * 4
        + banking / rows.length * 40 + variety * 5 + (loop ? 30 : 0) + deckBonus;
      const label = loop ? "Rundløype" : descent > 18 ? "Nedkjøring" : elevation > 17 ? "Høydeløype" : "Sprint";
      ranked.push({ id, rows, score, signature, label });
    }
    if (path.length >= 6 || loop) return;
    for (const leg of outgoing.get(end.to) ?? []) {
      if (path.some((prior) => prior.road === leg.road)
        || (leg.to !== start.from && path.some((prior) => prior.from === leg.to))) continue;
      const cosine = Math.cos(last(end).heading - first(leg).heading) * (end.reversed === leg.reversed ? 1 : -1);
      if (cosine > .985) search([...path, leg]);
    }
  }
  for (const start of starts) search([start]);
  ranked.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const selected: typeof ranked = [];
  for (const candidate of ranked) {
    const edges = candidate.signature.split(".");
    const redundant = selected.some((other) => {
      const prior = other.signature.split(".");
      return edges.filter((id) => prior.includes(id)).length / Math.max(edges.length, prior.length) >= .65;
    });
    if (!redundant) selected.push(candidate);
    if (selected.length === 4) break;
  }
  return selected;
}

export function raceCheckpoints(rows: Row[], startIndex: number, finishIndex: number, spacing: number) {
  const gates: Row[] = [];
  let travelled = 0;
  for (let i = startIndex + 1; i <= finishIndex; i++) {
    travelled += distance(rows[i - 1], rows[i]);
    if ((travelled >= spacing && i < finishIndex - 6) || i === finishIndex) {
      gates.push(rows[i]);
      travelled = 0;
    }
  }
  return gates;
}
