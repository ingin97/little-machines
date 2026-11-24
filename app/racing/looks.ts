export const looks = {
  rally: { color: "#ff6538", accent: "#fff0bd" },
  beach: { color: "#16a99e", accent: "#ffe277" },
  rocket: { color: "#8464e3", accent: "#aaf0fc" },
} as const;

export type CarLook = keyof typeof looks;

export function isCarLook(value: unknown): value is CarLook {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(looks, value);
}
