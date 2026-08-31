import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFile(path.join(projectRoot, relativePath), "utf8");

test("produksjonsbygget starter og svarer med spillets forside", { timeout: 20_000 }, async () => {
  const port = 43_000 + process.pid % 1_000;
  const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  server.stdout.on("data", (chunk) => { diagnostics += chunk; });
  server.stderr.on("data", (chunk) => { diagnostics += chunk; });
  try {
    let response;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/`);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.ok(response, `Serveren startet ikke. ${diagnostics}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<title>Min byggeplass – maskinspill for små barn<\/title>/);
    assert.match(html, /<div id="root"><\/div>/);
  } finally {
    server.kill();
  }
});

test("alle 3D-modeller og lydfiler finnes og er ikke tomme", async () => {
  for (const directory of ["public/assets/models", "public/assets/audio"]) {
    const files = await readdir(path.join(projectRoot, directory));
    const assets = files.filter((file) => /\.(glb|wav)$/i.test(file));
    assert.ok(assets.length > 0, `${directory} mangler ressurser`);
    for (const file of assets) {
      const info = await stat(path.join(projectRoot, directory, file));
      assert.ok(info.size > 100, `${file} er tom eller ugyldig`);
    }
    const license = await read(`${directory}/LICENSES.md`);
    assert.ok(license.trim().length > 80, `${directory} mangler lisensinformasjon`);
  }
});

test("innstillinger lagres og manglende modeller har reservegrafikk", async () => {
  const page = await read("app/page.tsx");
  for (const key of ["little-tractor-mode", "little-machine-vehicle", "little-machine-sound"]) {
    assert.match(page, new RegExp(`getItem\\("${key}"\\)|setItem\\("${key}"`));
  }
  const tractor = await read("app/TractorGame3D.tsx");
  const decor = await read("app/sceneDecor.ts");
  assert.doesNotMatch(tractor, /tractor\.glb/);
  assert.match(tractor, /tractor-headlight/);
  assert.match(tractor, /tractor-windshield/);
  assert.match(tractor, /catch \(error\)/);
  assert.match(tractor, /round-bale/);
  assert.match(tractor, /automaticNextTool/);
  assert.match(decor, /catch \(error\)/);
});

test("WebRTC-flerspillerens backend er klar, men brukergrensesnittet er deaktivert", async () => {
  const [page, multiplayer, worker, construction, viteConfig, migration, securityMigration, document] = await Promise.all([
    read("app/page.tsx"), read("app/multiplayer.ts"), read("worker/index.ts"),
    read("app/ConstructionGame3D.tsx"), read("vite.config.ts"), read("drizzle/0000_multiplayer_poc.sql"), read("drizzle/0002_public_poc_security.sql"), read("index.html"),
  ]);
  assert.doesNotMatch(page, /multiplayerButton/);
  assert.doesNotMatch(page, /Lag rom/);
  assert.doesNotMatch(page, /Bli med/);
  assert.doesNotMatch(page, /Del lenke/);
  assert.doesNotMatch(page, /Invitasjonsnøkkel/);
  assert.match(multiplayer, /RTCPeerConnection/);
  assert.match(multiplayer, /remoteInputs/);
  assert.match(multiplayer, /playerCount/);
  assert.match(multiplayer, /stun:stun\.cloudflare\.com:3478/);
  assert.doesNotMatch(multiplayer, /turn:/);
  assert.match(worker, /multiplayer_signals/);
  assert.match(worker, /multiplayer_participants/);
  assert.match(worker, /join_secret_hash/);
  assert.match(worker, /multiplayer_rate_limits/);
  assert.match(worker, /sec-fetch-site/);
  assert.match(worker, /content-security-policy/);
  assert.match(worker, /validSignal/);
  assert.match(worker, /randomText\(8, CODE_ALPHABET\)/);
  assert.match(worker, /\["p2", "p3", "p4"\]/);
  assert.match(construction, /role==="host"/);
  assert.match(construction, /role==="guest"/);
  assert.match(construction, /remoteInputs\.current\.p3/);
  assert.match(construction, /remoteInputs\.current\.p4/);
  assert.match(construction, /maskin-ekstra-dumper/);
  const tractor = await read("app/TractorGame3D.tsx");
  assert.match(tractor, /tractor-snapshot/);
  assert.match(tractor, /medspiller-traktor/);
  assert.match(tractor, /peerTractors/);
  assert.match(tractor, /p3:buildPeerTractor/);
  assert.match(tractor, /p4:buildPeerTractor/);

  const multiplayerStyles = await read("app/multiplayer.css");
  assert.match(multiplayerStyles, /\.multiplayerButton\{[^}]*top:190px/);
  const hudLayout = await read("app/hud-layout.css");
  assert.match(hudLayout, /:has\(\.tractorGame\) \.multiplayerButton \{\s*top: 202px/);
  assert.match(hudLayout, /:has\(\.workHud\) \.multiplayerButton \{\s*top: 228px/);
  assert.match(hudLayout, /\.fullscreenGame \.adultControls \{[^}]*top: 108px/s);
  assert.match(hudLayout, /\.fullscreenGame \.vehicleMenuButton \{[^}]*top: 16px/s);
  assert.match(page, /Valgt maskin:/);
  assert.doesNotMatch(page, /> Velg maskin<\/button>/);
  assert.doesNotMatch(viteConfig, /\.openai\/hosting\.json/);
  assert.match(migration, /CREATE TABLE `multiplayer_rooms`/);
  assert.match(securityMigration, /join_secret_hash/);
  assert.match(securityMigration, /multiplayer_rate_limits/);
  assert.match(document, /<meta name="robots" content="index,follow"/);
  assert.match(multiplayer, /bufferedAmount<1_000_000/);
  assert.match(multiplayer, /event\.data\.length>200_000/);
});

test("mobilstyring har berøringsknapper for begge retninger", async () => {
  const page = await read("app/page.tsx");
  const styles = await read("app/touch-steering.css");
  assert.match(page, /aria-label="Styr til venstre"/);
  assert.match(page, /aria-label="Styr til høyre"/);
  assert.match(page, /onPointerCancel/);
  assert.match(styles, /touch-action:\s*none/);
  assert.match(styles, /pointer:\s*coarse/);
});
