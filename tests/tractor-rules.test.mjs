import assert from "node:assert/strict";
import test from "node:test";
import { advanceGrass, automaticNextTool, BALE_CELL_INTERVAL, balesEarned, GRASS, tractorStageProgress } from "../app/tractorRules.ts";

test("traktorredskapene følger riktig grasrekkefølge", () => {
  assert.equal(advanceGrass(GRASS.standing, "mower"), GRASS.cut);
  assert.equal(advanceGrass(GRASS.standing, "rake"), GRASS.standing);
  assert.equal(advanceGrass(GRASS.cut, "rake"), GRASS.raked);
  assert.equal(advanceGrass(GRASS.cut, "baler"), GRASS.cut);
  assert.equal(advanceGrass(GRASS.raked, "baler"), GRASS.baled);
  assert.equal(advanceGrass(GRASS.baled, "mower"), GRASS.baled);
});

test("progresjon inkluderer gras som er viderebehandlet", () => {
  const counts = [10, 20, 30, 40];
  assert.equal(tractorStageProgress(counts, 100, "mower"), 90);
  assert.equal(tractorStageProgress(counts, 100, "rake"), 70);
  assert.equal(tractorStageProgress(counts, 100, "baler"), 40);
});

test("automatisk redskapsbytte skjer ved 90 prosent", () => {
  assert.equal(automaticNextTool("mower", 89), null);
  assert.equal(automaticNextTool("mower", 90), "rake");
  assert.equal(automaticNextTool("rake", 100), "baler");
  assert.equal(automaticNextTool("baler", 100), null);
});

test("rundballer opptjenes med et fast intervall", () => {
  assert.equal(balesEarned(BALE_CELL_INTERVAL - 1, BALE_CELL_INTERVAL), 1);
  assert.equal(balesEarned(0, BALE_CELL_INTERVAL * 2 + 5), 2);
  assert.equal(balesEarned(BALE_CELL_INTERVAL, BALE_CELL_INTERVAL + 20), 0);
});
