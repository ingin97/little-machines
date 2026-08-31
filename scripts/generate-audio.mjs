import { mkdir, writeFile } from "node:fs/promises";

const sampleRate = 22050;
const target = new URL("../public/assets/audio/", import.meta.url);

function wav(duration, sample) {
  const count = Math.floor(duration * sampleRate);
  const buffer = Buffer.alloc(44 + count * 2);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + count * 2, 4); buffer.write("WAVE", 8);
  buffer.write("fmt ", 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(count * 2, 40);
  let seed = 123456789;
  for (let i = 0; i < count; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = seed / 0xffffffff * 2 - 1;
    const value = Math.max(-1, Math.min(1, sample(i / sampleRate, noise, duration)));
    buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  return buffer;
}

const fade = (t, duration, edge = .045) => Math.min(1, t / edge, (duration - t) / edge);
const pulse = (t, hz) => Math.sin(2 * Math.PI * hz * t) > .2 ? 1 : -.55;
const engine = (base, grit) => wav(1.6, (t, noise) => {
  const wobble = Math.sin(2 * Math.PI * 2.5 * t) * 1.4;
  return .18 * Math.sin(2 * Math.PI * (base + wobble) * t) + .1 * Math.sin(2 * Math.PI * base * 2 * t) + grit * noise * (.35 + .2 * pulse(t, base / 2));
});

await mkdir(target, { recursive: true });
const files = {
  "engine-tractor.wav": engine(42, .055),
  "engine-excavator.wav": engine(34, .075),
  "engine-dumper.wav": engine(48, .065),
  "engine-loader.wav": engine(45, .06),
  "mower.wav": wav(1.2, (t, noise) => .12 * noise + .055 * Math.sin(2 * Math.PI * 92 * t)),
  "rake.wav": wav(1.15, (t, noise) => .075 * noise * (.55 + .45 * pulse(t, 8)) + .025 * Math.sin(2 * Math.PI * 155 * t)),
  "baler.wav": wav(1.2, (t, noise) => .055 * noise + .07 * pulse(t, 4.5) + .035 * Math.sin(2 * Math.PI * 72 * t)),
  "dig.wav": wav(1.25, (t, noise) => (.12 * noise + .06 * pulse(t, 7)) * (.65 + .35 * Math.sin(Math.PI * t / 1.25))),
  "load.wav": wav(1.15, (t, noise) => .09 * noise + .06 * Math.sin(2 * Math.PI * (60 - t * 18) * t)),
  "dump.wav": wav(1.25, (t, noise) => (.15 * noise + .045 * pulse(t, 5)) * (1 - t / 1.5)),
  "ui-select.wav": wav(.16, (t, _noise, d) => .2 * Math.sin(2 * Math.PI * (520 + t * 900) * t) * fade(t, d, .025)),
  "ui-reset.wav": wav(.18, (t, _noise, d) => .16 * Math.sin(2 * Math.PI * (340 + t * 280) * t) * fade(t, d, .03)),
  "complete.wav": wav(.9, (t, _noise, d) => {
    const note = t < .28 ? 523.25 : t < .56 ? 659.25 : 783.99;
    return .17 * Math.sin(2 * Math.PI * note * t) * fade(t, d, .035);
  }),
};
await Promise.all(Object.entries(files).map(([name, data]) => writeFile(new URL(name, target), data)));
