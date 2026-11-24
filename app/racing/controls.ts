import { isCarLook, type CarLook } from "./looks";
import { availableGamepads, clamp, combinedPedals, firstGamepad, steeringDeadZone } from "../driveInput";

type PedalAxis = { index: number; rest: number; pressed: number };
type Calibration = { id: string; center: number; accelerator?: PedalAxis; brake?: PedalAxis };

const toddler = { speed: 15, automatic: true, gentle: true, reverse: true, recovery: true };
const normal = { speed: 28, automatic: false, gentle: false, reverse: false, recovery: false };
const defaults = { ...toddler, sound: true, car: "rally" as CarLook, dead: 8, calibration: null as Calibration | null };
const storageKey = "little-machines-racing-controls";

export type DrivingSettings = typeof defaults;
export type DriveInput = { steer: number; accelerator: number; brake: number };

function loadSettings(): DrivingSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    return {
      sound: typeof saved?.sound === "boolean" ? saved.sound : defaults.sound,
      car: isCarLook(saved?.car) ? saved.car : defaults.car,
      speed: Number.isFinite(saved?.speed) ? clamp(saved.speed, 8, 36) : defaults.speed,
      dead: Number.isFinite(saved?.dead) ? clamp(saved.dead, 0, 30) : defaults.dead,
      automatic: typeof saved?.automatic === "boolean" ? saved.automatic : defaults.automatic,
      gentle: typeof saved?.gentle === "boolean" ? saved.gentle : defaults.gentle,
      reverse: typeof saved?.reverse === "boolean" ? saved.reverse : defaults.reverse,
      recovery: typeof saved?.recovery === "boolean" ? saved.recovery : defaults.recovery,
      calibration: saved?.calibration ?? null,
    };
  } catch {
    return { ...defaults };
  }
}

export function createControls(reset: () => void) {
  const settings = loadSettings();
  const dialog = document.querySelector<HTMLDialogElement>("#parent")!;
  const status = document.querySelector("#status")!;
  const help = document.querySelector("#calibration")!;
  const pedalButton = document.querySelector<HTMLButtonElement>("#pedals")!;
  const keys = new Set<string>();
  const touch = new Map<number, string>();
  const keyGroups = ["arrowleft", "arrowright", "arrowup", "arrowdown", "a", "d", "w", "s"];
  let pad: Gamepad | undefined;
  let lastStatus = "";
  let capture: { id: string; rest: number[]; accelerator?: PedalAxis } | undefined;

  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* Settings still work in memory. */ }
  }

  function clearInput() {
    keys.clear();
    touch.clear();
  }

  window.addEventListener("blur", clearInput);
  document.addEventListener("visibilitychange", clearInput);
  window.addEventListener("keydown", (event) => {
    if (dialog.open || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === "r" && !event.repeat) reset();
    if (!keyGroups.includes(key)) return;
    event.preventDefault();
    keys.add(key);
  });
  window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-key]")) {
    button.addEventListener("pointerdown", (event) => {
      button.setPointerCapture(event.pointerId);
      touch.set(event.pointerId, button.dataset.key!);
    });
    button.addEventListener("lostpointercapture", (event) => touch.delete(event.pointerId));
  }

  const booleanFields = ["automatic", "gentle", "reverse", "recovery", "sound"] as const;
  const cars = document.querySelectorAll<HTMLButtonElement>("[data-car]");
  function reflectCar() {
    for (const button of cars) button.setAttribute("aria-pressed", String(button.dataset.car === settings.car));
  }
  for (const button of cars) {
    button.onclick = () => {
      if (!isCarLook(button.dataset.car)) return;
      settings.car = button.dataset.car;
      reflectCar();
      save();
    };
  }
  const rangeFields = ["speed", "dead"] as const;
  const input = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;
  function reflect() {
    reflectCar();
    for (const key of booleanFields) input(key).checked = settings[key];
    for (const key of rangeFields) input(key).value = String(settings[key]);
    document.querySelector("#speed-value")!.textContent = `${Math.round(settings.speed * 3.6)} km/t`;
    document.querySelector("#dead-value")!.textContent = `${settings.dead} %`;
  }

  for (const key of booleanFields) input(key).onchange = () => { settings[key] = input(key).checked; save(); };
  for (const key of rangeFields) input(key).oninput = () => { settings[key] = +input(key).value; reflect(); save(); };
  for (const [id, preset] of [["toddler", toddler], ["normal", normal]] as const) {
    document.querySelector<HTMLButtonElement>(`#${id}`)!.onclick = () => {
      Object.assign(settings, preset);
      reflect();
      save();
    };
  }

  document.querySelector<HTMLButtonElement>("#settings")!.onclick = () => {
    clearInput();
    reflect();
    dialog.showModal();
  };
  document.querySelector<HTMLButtonElement>("#reset")!.onclick = () => { reset(); dialog.close(); };
  dialog.onclose = () => {
    capture = undefined;
    pedalButton.textContent = "Kalibrer pedaler";
    help.textContent = "";
  };

  function calibration(current: Gamepad): Calibration {
    return settings.calibration?.id === current.id
      ? settings.calibration : { id: current.id, center: 0 };
  }

  document.querySelector<HTMLButtonElement>("#center")!.onclick = () => {
    if (!pad) { help.textContent = "Beveg rattet for å koble det til."; return; }
    settings.calibration = { ...calibration(pad), center: clamp(pad.axes[0] ?? 0, -.5, .5) };
    save();
    help.textContent = "Rattet er sentrert.";
  };

  pedalButton.onclick = () => {
    if (!pad) { help.textContent = "Beveg rattet for å koble det til."; return; }
    if (!capture || capture.id !== pad.id) {
      capture = { id: pad.id, rest: [...pad.axes] };
      pedalButton.textContent = "Lagre pedal";
      help.textContent = "Hold gasspedalen helt inne, og trykk Lagre pedal.";
      return;
    }

    let axis: PedalAxis | undefined;
    for (let index = 1; index < pad.axes.length; index++) {
      const rest = capture.rest[index];
      const pressed = pad.axes[index];
      if (Math.abs(pressed - rest) > Math.max(.35, axis ? Math.abs(axis.pressed - axis.rest) : 0)) {
        axis = { index, rest, pressed };
      }
    }
    if (!axis) { help.textContent = "Ingen pedalakse ble registrert. Hold pedalen helt inne og prøv igjen."; return; }
    if (!capture.accelerator) {
      capture.accelerator = axis;
      help.textContent = "Slipp gassen, hold bremsen helt inne, og trykk Lagre pedal.";
      return;
    }
    if (axis.index === capture.accelerator.index && Math.sign(axis.pressed - axis.rest) === Math.sign(capture.accelerator.pressed - capture.accelerator.rest)) {
      help.textContent = "Slipp gassen og hold bare bremsen inne.";
      return;
    }
    settings.calibration = { ...calibration(pad), accelerator: capture.accelerator, brake: axis };
    save();
    capture = undefined;
    pedalButton.textContent = "Kalibrer pedaler";
    help.textContent = "Pedalene er lagret.";
  };

  function read(): DriveInput {
    const pads = availableGamepads();
    // Prefer a wheel over a standard-mapped controller when both are connected.
    pad = firstGamepad(Array.from(pads).filter((device) => device?.mapping !== "standard")) ?? firstGamepad(pads);
    const label = pad
      ? (pad.mapping === "standard" ? "Håndkontroll tilkoblet" : "Ratt tilkoblet")
      : "Piltaster · WASD · R";
    if (label !== lastStatus) {
      status.textContent = label;
      lastStatus = label;
    }

    const touchKeys = [...touch.values()];
    const pressed = (key: string) => keys.has(key) || touchKeys.includes(key);
    const keyboardSteer = Number(pressed("arrowright") || pressed("d")) - Number(pressed("arrowleft") || pressed("a"));
    const mapping = pad && calibration(pad);
    const center = mapping?.center ?? 0;
    const offset = (pad?.axes[0] ?? 0) - center;
    const steer = steeringDeadZone(offset / (1 - Math.sign(offset) * center), settings.dead / 100);
    const pedals = combinedPedals(pad?.axes[1] ?? 0);
    const readPedal = ({ index, rest, pressed }: PedalAxis) => {
      const value = pad?.axes[index];
      return value === undefined ? 0 : clamp((value - rest) / (pressed - rest), 0, 1);
    };
    if (mapping?.accelerator && mapping.brake) {
      pedals.accelerator = readPedal(mapping.accelerator);
      pedals.brake = readPedal(mapping.brake);
    } else if (pad?.mapping === "standard") {
      pedals.accelerator = pad.buttons[7]?.value ?? 0;
      pedals.brake = pad.buttons[6]?.value ?? 0;
    }
    return {
      steer: keyboardSteer || steer,
      accelerator: Math.max(Number(pressed("arrowup") || pressed("w")), pedals.accelerator),
      brake: Math.max(Number(pressed("arrowdown") || pressed("s")), pedals.brake),
    };
  }

  return { settings, read, paused: () => dialog.open || document.hidden };
}
