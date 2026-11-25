import { minimumRoadClearance, roadBands, sampleWorldRoads, type WorldDefinition } from "./worldDefinition.ts";

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

export function buildWorldTerrain(world: WorldDefinition, roads = sampleWorldRoads(world)) {
  const { halfExtent, flatRadius, phase, relief } = world.terrain;
  const cells = Math.min(260, Math.ceil(halfExtent));
  const stride = cells + 1;
  const spacing = 2 * halfExtent / cells;
  const heights = new Float32Array(stride ** 2);
  const baseHeights = new Float32Array(heights.length);
  const influence = new Float32Array(heights.length);
  const ceiling = new Float32Array(heights.length).fill(Infinity);
  for (let row = 0; row <= cells; row++) for (let col = 0; col <= cells; col++) {
    const x = col * spacing - halfExtent;
    const z = row * spacing - halfExtent;
    const hills = .15 + .65 * Math.sin(x / 40 + phase) ** 2 * Math.cos(z / 37 - phase) ** 2
      + .20 * Math.sin((x + z) / 42) ** 2;
    const canyon = world.terrain.shape === "canyon" ? smooth((Math.abs(z + 78 + Math.sin(x / 30) * 14) - 13) / 20) : 1;
    let height = relief * hills * canyon * smooth((Math.hypot(x, z) - flatRadius) / 42);
    if (world.generation?.version === 2 && world.terrain.shape === "canyon") {
      height -= 16 * (1 - smooth(Math.abs(x + 36 + Math.sin(z / 57) * 12) / 27))
        * smooth((Math.hypot(x, z) - flatRadius) / 38);
    }
    for (const peak of world.terrain.peaks ?? []) {
      height += peak.height * (1 - smooth(Math.hypot(x - peak.x, z - peak.z) / peak.radius));
    }
    heights[row * stride + col] = baseHeights[row * stride + col] = height;
  }

  for (const { road, rows } of roads) {
    const spans = world.bridges.filter((bridge) => bridge.road === road.id);
    for (const point of rows) {
      const shapeShoulder = world.generation?.version === 2 && !road.structure && point.crown <= .25;
      const rightX = Math.cos(point.heading), rightZ = -Math.sin(point.heading);
      const sideGrade = -(point.frameUp.x * rightX + point.frameUp.z * rightZ) / point.frameUp.y;
      const forwardGrade = -(point.frameUp.x * -rightZ + point.frameUp.z * rightX) / point.frameUp.y;
      const bankDrop = Math.abs(point.frameRight.y) * point.halfWidth;
      const target = point.y - bankDrop - .19;
      let bridgeDistance = Infinity;
      for (const bridge of spans) bridgeDistance = Math.min(bridgeDistance, Math.hypot(point.x - bridge.x, point.z - bridge.z) - bridge.radius);
      const bridgeBlend = 1 - smooth((bridgeDistance + 3) / 15);
      const roadExtent = point.halfWidth + spacing * 1.3;
      const influenceExtent = roadExtent + (shapeShoulder ? 32 : 13);
      const startCol = Math.max(0, Math.floor((point.x - influenceExtent + halfExtent) / spacing));
      const endCol = Math.min(cells, Math.ceil((point.x + influenceExtent + halfExtent) / spacing));
      const startRow = Math.max(0, Math.floor((point.z - influenceExtent + halfExtent) / spacing));
      const endRow = Math.min(cells, Math.ceil((point.z + influenceExtent + halfExtent) / spacing));
      for (let row = startRow; row <= endRow; row++) for (let col = startCol; col <= endCol; col++) {
        const dx = col * spacing - halfExtent - point.x;
        const dz = row * spacing - halfExtent - point.z;
        const distance = Math.hypot(dx, dz);
        if (distance > influenceExtent) continue;
        const index = row * stride + col;
        const base = baseHeights[index];
        const weight = 1 - smooth(distance / influenceExtent);
        const lateral = Math.max(-point.halfWidth, Math.min(point.halfWidth, dx * rightX + dz * rightZ));
        const localTarget = shapeShoulder
          ? point.y + sideGrade * lateral + forwardGrade * (dx * -rightZ + dz * rightX) - .34
          : target;
        const support = road.structure ? Math.min(localTarget, base) : localTarget;
        const bridgeFloor = Math.min(base, support - 8);
        const desired = support + (bridgeFloor - support) * bridgeBlend;
        if (weight > influence[index]) {
          if (shapeShoulder) {
            const outside = Math.max(0, distance - roadExtent);
            const rise = outside * .30;
            const blend = smooth((outside - 13) / 19);
            const verge = Math.max(desired - rise, Math.min(desired + rise, base));
            heights[index] = verge + (base - verge) * blend;
          } else {
            heights[index] = base + (desired - base) * (1 - smooth((distance - roadExtent) / 13));
          }
          influence[index] = weight;
        }
        if (distance <= roadExtent) ceiling[index] = Math.min(ceiling[index], desired);
      }
    }
  }
  for (let i = 0; i < heights.length; i++) heights[i] = Math.min(heights[i], ceiling[i]);

  function heightAt(x: number, z: number) {
    const u = Math.max(0, Math.min(cells, (x + halfExtent) / spacing));
    const v = Math.max(0, Math.min(cells, (z + halfExtent) / spacing));
    const col = Math.min(cells - 1, Math.floor(u));
    const row = Math.min(cells - 1, Math.floor(v));
    const a = heights[row * stride + col];
    const b = heights[row * stride + col + 1];
    const c = heights[(row + 1) * stride + col];
    const d = heights[(row + 1) * stride + col + 1];
    const dx = u - col;
    const dz = v - row;
    return dx + dz <= 1 ? a + (b - a) * dx + (c - a) * dz : d + (c - d) * (1 - dx) + (b - d) * (1 - dz);
  }
  return { cells, heights, spacing, halfExtent, heightAt };
}

export function roadTerrainClearance(world: WorldDefinition, roads = sampleWorldRoads(world), terrain = buildWorldTerrain(world, roads)) {
  for (const { road, rows } of roads) for (const [index, row] of rows.entries()) {
    for (const band of roadBands) {
      const width = row.halfWidth * band;
      const crown = row.crown * band ** 2;
      const y = row.y + width * row.frameRight.y + crown * row.frameUp.y;
      const ground = terrain.heightAt(row.x + width * row.frameRight.x + crown * row.frameUp.x,
        row.z + width * row.frameRight.z + crown * row.frameUp.z);
      if (y - ground < minimumRoadClearance) return `Road "${road.id}" is buried near sample ${index} (clearance ${(y - ground).toFixed(2)} m)`;
    }
  }
}

/** Tie grounded road edges back into the heightfield without changing bridge or ramp geometry. */
export function roadShoulders(rows: ReturnType<typeof sampleWorldRoads>[number]["rows"], terrain: ReturnType<typeof buildWorldTerrain>,
  side: -1 | 1, skip: (row: (typeof rows)[number]) => boolean) {
  const runs: {
    x: number; y: number; z: number; heading: number; halfWidth: number; frameRight: { x: number; y: number; z: number };
  }[][] = [];
  let run: (typeof runs)[number] = [];
  function finish() {
    if (run.length >= 2) runs.push(run);
    run = [];
  }
  for (const row of rows) {
    if (skip(row) || row.crown > .25) {
      finish();
      continue;
    }
    const signedWidth = side * row.halfWidth;
    const edge = {
      x: row.x + row.frameRight.x * signedWidth + row.frameUp.x * row.crown,
      y: row.y + row.frameRight.y * signedWidth + row.frameUp.y * row.crown,
      z: row.z + row.frameRight.z * signedWidth + row.frameUp.z * row.crown,
    };
    const x = Math.cos(row.heading) * side, z = -Math.sin(row.heading) * side;
    let width = 5;
    let ground = terrain.heightAt(edge.x + x * width, edge.z + z * width);
    while (edge.y - ground > width * .38 && width < 11) {
      width += 2;
      ground = terrain.heightAt(edge.x + x * width, edge.z + z * width);
    }
    const delta = ground - edge.y - .025;
    run.push({
      x: edge.x + x * width / 2, y: edge.y + delta / 2, z: edge.z + z * width / 2,
      heading: row.heading, halfWidth: width / 2,
      frameRight: { x: x * side, y: delta / width * side, z: z * side },
    });
  }
  finish();
  return runs;
}
