import type { WorldDefinition } from "./worldDefinition.ts";
import { generateWorld as generateV1, normalizeSeed, presets as legacyPresets, isPreset as isLegacyPreset } from "./worldGeneratorV1.ts";
import { generateV2, profiles } from "./worldGeneratorV2.ts";

export { defaultSeed, normalizeSeed } from "./worldGeneratorV1.ts";
export const generatorVersion = 2;
export const presets = { ...legacyPresets, ...profiles };
export type Preset = keyof typeof presets;
export type GeneratorVersion = 1 | 2;

export function isPreset(value: string): value is Preset {
  return Object.hasOwn(presets, value);
}

export function supportsGenerator(preset: Preset, version: number): version is GeneratorVersion {
  return version === 2 || (version === 1 && isLegacyPreset(preset));
}

export function generateWorld(preset: Preset, seed: string, version: GeneratorVersion = generatorVersion): WorldDefinition {
  if (version === 1 && isLegacyPreset(preset)) return generateV1(preset, seed);
  if (version === 2) return generateV2(preset, normalizeSeed(seed));
  throw new Error(`Generator version ${version} does not support ${preset}`);
}
