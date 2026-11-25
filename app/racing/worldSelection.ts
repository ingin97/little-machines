/// <reference types="vite/client" />

import { defaultSeed, generateWorld, generatorVersion, isPreset, normalizeSeed, presets, supportsGenerator, type GeneratorVersion } from "./worldGenerator.ts";
import { validateWorld } from "./worldValidation.ts";
import type { WorldDefinition } from "./worldDefinition.ts";

const authored = import.meta.glob("./worlds/*.json", { eager: true, import: "default" });
const definitions = new Map<string, WorldDefinition>();
for (const [path, value] of Object.entries(authored)) {
  const errors = validateWorld(value);
  if (errors.length) throw new Error(`${path}: ${errors.join("; ")}`);
  const world = value as WorldDefinition;
  if (world.generation || isPreset(world.id) || world.id === "classic" || definitions.has(world.id)) {
    throw new Error(`Invalid or duplicate authored world id: ${world.id}`);
  }
  definitions.set(world.id, world);
}

export const worldOptions = [
  { id: "classic", name: "Kjøreparken" },
  ...Object.entries(presets).map(([id, { name }]) => ({ id, name })),
  ...definitions.values(),
];

export type WorldChoice = { id: string; seed?: string; version?: GeneratorVersion };
export function readWorldChoice(params: URLSearchParams): WorldChoice {
  const id = params.get("world") ?? "classic";
  if (isPreset(id)) {
    const raw = params.get("v");
    const version = raw === null ? (supportsGenerator(id, 1) ? 1 : generatorVersion) : Number(raw);
    if ((raw !== null && raw !== String(version)) || !supportsGenerator(id, version)) throw new Error("Denne verdenen bruker en ukjent generatorversjon.");
    return { id, seed: normalizeSeed(params.get("seed") ?? defaultSeed), version };
  }
  if (id === "classic" || definitions.has(id)) return { id };
  throw new Error("Fant ikke verdenen fra denne lenken.");
}

export function resolveWorld(choice: WorldChoice) {
  return isPreset(choice.id) ? generateWorld(choice.id, choice.seed ?? defaultSeed, choice.version) : definitions.get(choice.id);
}

export function worldURL(choice: WorldChoice, current: string) {
  const url = new URL(current);
  for (const key of ["world", "seed", "v", "mode", "track", "route"]) url.searchParams.delete(key);
  if (choice.id !== "classic") url.searchParams.set("world", choice.id);
  if (isPreset(choice.id)) {
    url.searchParams.set("seed", normalizeSeed(choice.seed ?? defaultSeed));
    url.searchParams.set("v", String(choice.version ?? generatorVersion));
  }
  return url;
}
