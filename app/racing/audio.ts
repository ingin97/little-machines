import { clamp } from "../driveInput";

export function createRacingAudio() {
  let mix: ReturnType<typeof buildMix> | undefined;
  let lastImpact = -1;
  let enabled = false;

  function unlock() {
    if (!enabled || typeof AudioContext === "undefined") return;
    try {
      mix ??= buildMix();
      if (mix.context.state !== "running") void mix.context.resume().catch(() => {});
    } catch { /* Driving remains available without audio output. */ }
  }

  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);

  function update(sound: boolean, active: boolean, speed: number, grounded: boolean, boost: number) {
    enabled = sound;
    if (!mix || mix.context.state !== "running") return;
    const now = mix.context.currentTime;
    const pace = clamp(speed / 30, 0, 1);
    mix.output.gain.setTargetAtTime(sound && active ? 1 : 0, now, .075);
    mix.engine.frequency.setTargetAtTime(44 + pace * 102 + boost * 10, now, .09);
    mix.engineGain.gain.setTargetAtTime(.025 + pace * .035 + boost * .012, now, .1);
    mix.windGain.gain.setTargetAtTime(.018 + pace * .040 + (grounded ? 0 : pace * .030), now, .12);
    mix.windFilter.frequency.setTargetAtTime(205 + pace * 420, now, .15);
  }

  function impact(strength: number) {
    if (!enabled || !mix || mix.context.state !== "running" || strength <= 0) return;
    const { context, noise, output } = mix;
    const now = context.currentTime;
    if (now - lastImpact < .16) return;
    lastImpact = now;
    const shot = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    shot.buffer = noise;
    filter.type = "lowpass";
    filter.frequency.value = 140 + strength * 460;
    envelope.gain.setValueAtTime((.14 + strength * .24), now);
    envelope.gain.exponentialRampToValueAtTime(.001, now + .16);
    shot.connect(filter).connect(envelope).connect(output);
    shot.start(now, .4, .18);
    shot.onended = () => { shot.disconnect(); filter.disconnect(); envelope.disconnect(); };
  }

  function chime(notes: number[], volume: number) {
    if (!enabled || !mix || mix.context.state !== "running") return;
    const { context, output } = mix;
    for (const [i, pitch] of notes.entries()) {
      const at = context.currentTime + i * .085;
      const bell = context.createOscillator();
      const envelope = context.createGain();
      bell.frequency.value = pitch;
      envelope.gain.setValueAtTime(.001, at);
      envelope.gain.exponentialRampToValueAtTime(volume, at + .017);
      envelope.gain.exponentialRampToValueAtTime(.001, at + .33);
      bell.connect(envelope).connect(output);
      bell.start(at);
      bell.stop(at + .34);
      bell.onended = () => { bell.disconnect(); envelope.disconnect(); };
    }
  }

  return {
    update, impact,
    goalChime: () => chime([523.25, 659.25, 783.99], .15),
    starChime: () => chime([659.25, 987.77], .11),
    bowlingChime: () => chime([293.66, 392], .12),
  };
}

function buildMix() {
  const context = new AudioContext();
  const output = context.createGain();
  output.gain.value = 0;
  output.connect(context.destination);
  const engine = context.createOscillator();
  engine.type = "triangle";
  const engineGain = context.createGain();
  engineGain.gain.value = 0;
  engine.connect(engineGain).connect(output);
  engine.start();

  const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  const wind = context.createBufferSource();
  wind.buffer = noise;
  wind.loop = true;
  const windFilter = context.createBiquadFilter();
  windFilter.type = "lowpass";
  const windGain = context.createGain();
  windGain.gain.value = 0;
  wind.connect(windFilter).connect(windGain).connect(output);
  wind.start();
  return { context, output, engine, engineGain, windFilter, windGain, noise };
}
