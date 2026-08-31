import type { VehicleMode } from "./vehicleModes";

export type WorkSound = "mower" | "rake" | "baler" | "dig" | "load" | "dump";
export type UiSound = "select" | "reset";

const AUDIO_ROOT = "/assets/audio";
const ENGINE_FILE: Record<VehicleMode, string> = {
  tractor: "engine-tractor.wav",
  excavator: "engine-excavator.wav",
  dumper: "engine-dumper.wav",
  "wheel-loader": "engine-loader.wav",
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function engineMix(speedRatio: number, working: boolean) {
  const speed = clamp01(Math.abs(speedRatio));
  return {
    volume: (0.075 + speed * 0.145) * (working ? 0.65 : 1),
    playbackRate: 0.82 + speed * 0.35,
  };
}

function makeAudio(file: string, loop = false) {
  const audio = new Audio(`${AUDIO_ROOT}/${file}`);
  audio.preload = "auto";
  audio.loop = loop;
  return audio;
}

function safelyPlay(audio: HTMLAudioElement) {
  void audio.play().catch((error) => {
    if (error instanceof DOMException && error.name === "NotAllowedError") return;
    console.warn("Kunne ikke spille av lyd.", error);
  });
}

export function unlockAudio() {
  const audio = makeAudio("ui-select.wav");
  audio.volume = 0;
  safelyPlay(audio);
}

export function playUiSound(sound: UiSound, enabled: boolean) {
  if (!enabled) return;
  const audio = makeAudio(sound === "select" ? "ui-select.wav" : "ui-reset.wav");
  audio.volume = sound === "select" ? 0.11 : 0.09;
  safelyPlay(audio);
}

export function stopSpeech() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
}

export function speakNorwegian(text: string, enabled: boolean) {
  if (!enabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const speech = window.speechSynthesis;
  speech.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "nb-NO";
  utterance.rate = .88;
  utterance.pitch = 1.05;
  utterance.volume = .9;
  const voices = speech.getVoices();
  utterance.voice = voices.find((voice) => voice.lang.toLowerCase() === "nb-no")
    ?? voices.find((voice) => voice.lang.toLowerCase().startsWith("nb"))
    ?? voices.find((voice) => voice.lang.toLowerCase().startsWith("no"))
    ?? null;
  speech.speak(utterance);
}

export class MachineAudio {
  private engine: HTMLAudioElement;
  private work: Record<WorkSound, HTMLAudioElement>;
  private enabled = false;
  private active = false;
  private targetEngineVolume = 0;
  private currentWork: WorkSound | null = null;
  private oneShots = new Set<HTMLAudioElement>();

  constructor(mode: VehicleMode) {
    this.engine = makeAudio(ENGINE_FILE[mode], true);
    this.engine.volume = 0;
    this.work = {
      mower: makeAudio("mower.wav", true),
      rake: makeAudio("rake.wav", true),
      baler: makeAudio("baler.wav", true),
      dig: makeAudio("dig.wav", true),
      load: makeAudio("load.wav", true),
      dump: makeAudio("dump.wav", true),
    };
    Object.values(this.work).forEach((audio) => { audio.volume = 0; });
  }

  setState(enabled: boolean, active: boolean) {
    this.enabled = enabled;
    this.active = active;
    if (!enabled || !active) {
      this.targetEngineVolume = 0;
      this.pauseWork();
    }
  }

  setMotion(speedRatio: number) {
    const mix = engineMix(speedRatio, this.currentWork !== null);
    this.engine.playbackRate = mix.playbackRate;
    this.targetEngineVolume = this.enabled && this.active ? mix.volume : 0;
    if (this.targetEngineVolume > 0 && this.engine.paused) safelyPlay(this.engine);
  }

  setWork(sound: WorkSound | null) {
    if (sound === this.currentWork) return;
    this.pauseWork();
    this.currentWork = sound;
    if (!sound || !this.enabled || !this.active) return;
    const audio = this.work[sound];
    audio.currentTime = 0;
    audio.volume = sound === "mower" ? 0.1 : sound === "rake" || sound === "baler" ? 0.12 : 0.16;
    safelyPlay(audio);
  }

  playComplete() {
    if (!this.enabled || !this.active) return;
    const audio = makeAudio("complete.wav");
    audio.volume = 0.22;
    this.oneShots.add(audio);
    audio.addEventListener("ended", () => this.oneShots.delete(audio), { once: true });
    safelyPlay(audio);
  }

  tick(dt: number) {
    const fade = Math.min(1, dt * 5);
    this.engine.volume += (this.targetEngineVolume - this.engine.volume) * fade;
    if (this.targetEngineVolume === 0 && this.engine.volume < 0.002 && !this.engine.paused) {
      this.engine.pause();
      this.engine.currentTime = 0;
      this.engine.volume = 0;
    }
  }

  dispose() {
    this.targetEngineVolume = 0;
    this.engine.pause();
    this.engine.removeAttribute("src");
    this.pauseWork();
    Object.values(this.work).forEach((audio) => audio.removeAttribute("src"));
    this.oneShots.forEach((audio) => { audio.pause(); audio.removeAttribute("src"); });
    this.oneShots.clear();
  }

  private pauseWork() {
    if (this.currentWork) {
      const audio = this.work[this.currentWork];
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 0;
    }
    this.currentWork = null;
  }
}
