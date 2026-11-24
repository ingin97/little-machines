import { minimumRoadClearance, roadBands, sampleWorldRoads, type WorldDefinition } from "./worldDefinition.ts";

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

export function buildWorldTerrain(world: WorldDefinition, roads = sampleWorldRoads(world)) {
  const { halfExtent, flatRadius, phase, relief } = world.terrain;
  const cells = Math.ceil(halfExtent);
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
    heights[row * stride + col] = baseHeights[row * stride + col]
      = relief * hills * canyon * smooth((Math.hypot(x, z) - flatRadius) / 42);
  }

  for (const { road, rows } of roads) {
    const spans = world.bridges.filter((bridge) => bridge.road === road.id);
    for (const point of rows) {
      const bankDrop = Math.abs(point.frameRight.y) * point.halfWidth;
      const target = point.y - bankDrop - .19;
      const bridgeDistance = Math.min(...spans.map((bridge) => Math.hypot(point.x - bridge.x, point.z - bridge.z) - bridge.radius));
      const bridgeBlend = 1 - smooth((bridgeDistance + 3) / 15);
      const roadExtent = point.halfWidth + spacing * 1.3;
      const influenceExtent = roadExtent + 13;
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
        const support = road.structure === "ramp" ? Math.min(target, base) : target;
        const bridgeFloor = Math.min(base, support - 8);
        const desired = support + (bridgeFloor - support) * bridgeBlend;
        if (weight > influence[index]) {
          heights[index] = base + (desired - base) * (1 - smooth((distance - roadExtent) / 13));
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
