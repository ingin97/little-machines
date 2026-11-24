import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { definitionIdentity } from "../app/racing/worldDefinition.ts";
import { generateWorld, isPreset } from "../app/racing/worldGenerator.ts";
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

if (first === "--seed") {
  const [preset, seed] = rest;
  if (!preset || !isPreset(preset) || rest.length !== 2) {
    console.error("Usage: pnpm world:validate --seed <alpine|desert|countryside> <seed>");
    process.exitCode = 1;
  } else await check(`${preset} / ${seed}`, () => generateWorld(preset, seed), false);
} else {
  for (const path of files) await check(path, () => JSON.parse(readFileSync(path, "utf8")));
}
