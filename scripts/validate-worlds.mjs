import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { definitionIdentity } from "../app/racing/worldDefinition.ts";
import { generateWorld, generatorVersion, isPreset, presets, supportsGenerator } from "../app/racing/worldGenerator.ts";
import { validateWorld } from "../app/racing/worldValidation.ts";

const [first, ...rest] = process.argv.slice(2);
const directory = new URL("../app/racing/worlds/", import.meta.url);
const files = first ? [first, ...rest] : readdirSync(directory).filter((name) => name.endsWith(".json"))
  .map((name) => fileURLToPath(new URL(name, directory)));
const ids = new Set();

async function check(label, read, authored = true) {
  try {
    const world = read();
    const errors = validateWorld(world);
    if (authored && world?.generation) errors.push("authored worlds must omit generation");
    if (authored && world && (world.id === "classic" || isPreset(world.id) || ids.has(world.id))) errors.push("id is reserved or duplicated");
    if (errors.length) throw new Error(errors.join("\n  "));
    ids.add(world.id);
    const { id, hash } = await definitionIdentity(world);
    console.log(`${label}: ${id} ${hash}`);
  } catch (error) {
    console.error(`${label}:\n  ${error.message}`);
    process.exitCode = 1;
  }
}

if (first === "--batch") {
  const [countArg, preset, startArg = "0"] = rest;
  const count = Number(countArg), start = Number(startArg);
  if (!Number.isSafeInteger(count) || count < 1 || count > 1000 || !Number.isSafeInteger(start)
    || start < 0 || start + count > Number.MAX_SAFE_INTEGER || (preset && !isPreset(preset)) || rest.length > 3) {
    console.error("Usage: pnpm world:validate --batch <1–1000 seeds per preset> [preset] [start seed]");
    process.exitCode = 1;
  } else {
    const begin = performance.now();
    let total = 0, failed = 0;
    for (const profile of preset ? [preset] : Object.keys(presets)) {
      for (let i = start; i < start + count; i++) {
        total++;
        try {
          const world = generateWorld(profile, String(i));
          const errors = validateWorld(world);
          if (errors.length) throw new Error(errors.join("\n  "));
        } catch (error) {
          failed++;
          console.error(`${profile} / seed ${i}:\n  ${error.message}`);
        }
      }
    }
    console.log(`Generator v${generatorVersion}: ${total - failed}/${total} worlds valid in ${((performance.now() - begin) / 1000).toFixed(1)} s`);
    if (failed) process.exitCode = 1;
  }
} else if (first === "--seed") {
  const [preset, seed, versionArg = String(generatorVersion)] = rest;
  const version = Number(versionArg);
  if (!preset || !isPreset(preset) || seed === undefined || !supportsGenerator(preset, version) || rest.length > 3) {
    console.error("Usage: pnpm world:validate --seed <preset> <seed> [generator version]");
    process.exitCode = 1;
  } else await check(`${preset} / ${seed}`, () => generateWorld(preset, seed, version), false);
} else {
  for (const path of files) await check(path, () => JSON.parse(readFileSync(path, "utf8")));
}
