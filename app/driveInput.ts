export function clamp(value: number, min = -1, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function availableGamepads() {
  try { return navigator.getGamepads?.() ?? []; } catch { return []; }
}

export function firstGamepad(pads: ArrayLike<Gamepad | null> = availableGamepads()) {
  return Array.from(pads).find((pad): pad is Gamepad => Boolean(pad));
}

export function steeringDeadZone(value: number, deadZone = .08) {
  return Math.abs(value) < deadZone ? 0 : clamp(value);
}

// Little Machines' wheel uses one axis for both pedals, with neutral at zero.
export function combinedPedals(value: number) {
  return { accelerator: clamp(-value, 0, 1), brake: clamp(value, 0, 1) };
}
