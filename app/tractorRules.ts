export type TractorTool = "mower" | "rake" | "baler";
export type GrassState = 0 | 1 | 2 | 3;

export const GRASS = {
  standing: 0,
  cut: 1,
  raked: 2,
  baled: 3,
} as const satisfies Record<string, GrassState>;

export const BALE_CELL_INTERVAL = 700;

const REQUIRED_STATE: Record<TractorTool, GrassState> = {
  mower: GRASS.standing,
  rake: GRASS.cut,
  baler: GRASS.raked,
};

const COMPLETED_STATE: Record<TractorTool, GrassState> = {
  mower: GRASS.cut,
  rake: GRASS.raked,
  baler: GRASS.baled,
};

export function advanceGrass(state: GrassState, tool: TractorTool): GrassState {
  return state === REQUIRED_STATE[tool] ? ((state + 1) as GrassState) : state;
}

export function tractorStageProgress(counts: readonly number[], total: number, tool: TractorTool) {
  if (total <= 0) return 0;
  const threshold = COMPLETED_STATE[tool];
  let completed = 0;
  for (let state = threshold; state <= GRASS.baled; state++) completed += counts[state] ?? 0;
  return Math.round(completed / total * 100);
}

export function automaticNextTool(tool: TractorTool, progress: number): TractorTool | null {
  if (progress < 90) return null;
  if (tool === "mower") return "rake";
  if (tool === "rake") return "baler";
  return null;
}

export function balesEarned(previousBaledCells: number, nextBaledCells: number) {
  return Math.max(0, Math.floor(nextBaledCells / BALE_CELL_INTERVAL) - Math.floor(previousBaledCells / BALE_CELL_INTERVAL));
}
