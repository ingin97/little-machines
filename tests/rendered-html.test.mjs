import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { engineMix } from "../app/gameAudio.ts";
import { advanceMission, missionStepCompleted } from "../app/missionRules.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("har fire maskinmoduser med norske navn", async () => {
  const modes = await read("app/vehicleModes.ts");
  for (const id of ["tractor", "excavator", "dumper", "wheel-loader"]) assert.match(modes, new RegExp(`id: "${id}"`));
  for (const name of ["Traktor", "Gravemaskin", "Dumper", "Hjullaster"]) assert.match(modes, new RegExp(`name: "${name}"`));
  assert.match(modes, /scene: "field"/);
  assert.match(modes, /scene: "construction"/);
});

test("viser to norske hovedmoduser og lagrer maskinvalget lokalt", async () => {
  const page = await read("app/page.tsx");
  assert.match(page, /Velg en modus/);
  assert.match(page, /Hva har du lyst til å leke med\?/);
  assert.match(page, />Traktor</);
  assert.match(page, />Byggeplass</);
  assert.match(page, /constructionTools/);
  assert.match(page, /little-machine-vehicle/);
  assert.match(page, /Automatisk kjøring/);
  assert.match(page, /Voksenstyrt kjøring/);
  assert.doesNotMatch(page, />\s*(Choose|Select|Reset|Start over|Automatic|Adult mode)\b/i);
});

test("byggeplassen har automatiske norske arbeidsmeldinger", async () => {
  const game = await read("app/ConstructionGame3D.tsx");
  for (const message of ["Kjør til gravegropa", "Kjør til jordhaugen", "Kjør til tippeplassen", "Graver og løfter …", "Laster og løfter …", "Fyller dumperen …", "Tømmer …", "Klar!", "Fri lek – kjør hvor du vil"]) assert.ok(game.includes(message));
  assert.ok(!game.includes('className="celebration"'), "ferdig oppdrag skal ikke vise en sluttdialog");
  assert.match(game, /distance\s*<\s*5\.2/);
  assert.match(game, /workState\s*===\s*"working"/);
  assert.match(game, /cargo\.setEnabled/);
  assert.match(game, /granularHeap/);
  assert.match(game, /kornete jordhaug/);
  assert.match(game, /hjulfeste/);
  assert.match(game, /jord i graveskuffa/);
  assert.match(game, /CONSTRUCTION_MODES\.map/);
  assert.match(game, /camera\.parent=rigs\[activeMode\]\.root/);
});

test("ferdige oppdrag går til fri lek uten sluttdialog", async () => {
  for (const file of ["app/ConstructionGame3D.tsx", "app/TractorGame3D.tsx"]) {
    const game = await read(file);
    assert.match(game, /Fri lek – kjør hvor du vil/);
    assert.ok(!game.includes('className="celebration"'), `${file} skal ikke vise sluttdialog`);
  }
});

test("byggeplassens materialer, arbeidsretning og dumperlasting er koblet riktig", async () => {
  const game = await read("app/ConstructionGame3D.tsx");
  assert.match(game, /material\("bakke", "#6f9848"\)/);
  assert.match(game, /material\("grått stål", "#747d7b"\)/);
  assert.match(game, /"lasteplan"[^\n]+steelGray/);
  assert.equal((game.match(/"skuffe"[^\n]+steelGray/g) ?? []).length, 2);
  assert.match(game, /wasLoaded\?base-lift\*\(1-phase\):base-lift\*phase/);
  assert.match(game, /dumper\.loaded=true/);
  assert.match(game, /dumper\.cargo\?\.setEnabled\(true\)/);
  assert.match(game, /Fyll dumperen 3 ganger/);
  assert.ok(!game.includes("targetDirection"), "navigasjonspilen skal være fjernet");
});

test("kontrollene og grønne omgivelser har riktige plasseringer og marginer", async () => {
  const page = await read("app/page.tsx");
  const styles = await read("app/missions.css");
  const tractor = await read("app/TractorGame3D.tsx");
  const construction = await read("app/ConstructionGame3D.tsx");
  assert.match(page, /className="constructionTools"/);
  assert.match(styles, /\.constructionTools\s*\{[^}]*bottom: 8px/s);
  assert.match(styles, /\.soundButton\s*\{[^}]*top: 18px/s);
  assert.match(tractor, /green-surroundings[^\n]+width: 180, height: 180/);
  assert.match(construction, /"byggeplass", \{ width: 180, height: 180 \}/);
  assert.match(tractor, /fieldEdgeMargin = 8/);
  assert.match(tractor, /COLS \* CELL \/ 2 \+ fieldEdgeMargin/);
  assert.match(tractor, /ROWS \* CELL \/ 2 \+ fieldEdgeMargin/);
});

test("slått gras vises, rakes i hauger ved kontakt og forsvinner ikke ved kamerakutting", async () => {
  const tractor = await read("app/TractorGame3D.tsx");
  assert.match(tractor, /state !== GRASS\.cut && state !== GRASS\.raked/);
  assert.match(tractor, /isPile = state === GRASS\.raked/);
  assert.match(tractor, /implementContactRadiusSquared = 5\.5/);
  assert.match(tractor, /dx \* dx \+ dz \* dz > implementContactRadiusSquared/);
  assert.match(tractor, /alwaysSelectAsActiveMesh = true/);
  assert.match(tractor, /writeWindrowMatrix\(index,after,heading\)/);
  assert.match(tractor, /Rak det slåtte graset i hauger/);
});

test("har ferdig norsk sidemetadata", async () => {
  const document = await read("index.html");
  assert.match(document, /Min byggeplass – maskinspill for små barn/);
  assert.match(document, /<html lang="no">/);
  assert.match(document, /favicon-tractor\.png/);
  assert.doesNotMatch(document, /Starter Project|codex-preview/);
});

test("har lokal, dempbar lyd for alle maskiner", async () => {
  const page = await read("app/page.tsx");
  const audio = await read("app/gameAudio.ts");
  assert.match(page, /little-machine-sound/);
  assert.match(page, /Lyd på/);
  assert.match(page, /Lyd av/);
  assert.match(page, /visibilitychange/);
  for (const file of ["engine-tractor.wav", "engine-excavator.wav", "engine-dumper.wav", "engine-loader.wav", "mower.wav", "rake.wav", "baler.wav", "dig.wav", "load.wav", "dump.wav", "complete.wav"]) assert.ok(audio.includes(file));
});

test("motorlyden følger hastighet og dempes under arbeid", () => {
  const idle = engineMix(0, false);
  const driving = engineMix(1, false);
  const working = engineMix(1, true);
  assert.ok(driving.volume > idle.volume);
  assert.ok(driving.playbackRate > idle.playbackRate);
  assert.equal(working.volume, driving.volume * 0.65);
  assert.deepEqual(engineMix(-1, false), driving);
});

test("har norsk tale for oppgaver og mål", async () => {
  const audio = await read("app/gameAudio.ts");
  const construction = await read("app/ConstructionGame3D.tsx");
  assert.match(audio, /SpeechSynthesisUtterance/);
  assert.match(audio, /nb-NO/);
  assert.match(audio, /speechSynthesis\.cancel/);
  assert.match(construction, /announce\(`/);
});

test("oppdrag teller bare ferdig arbeid og stopper på tre", () => {
  assert.equal(missionStepCompleted("excavator", false), false, "fylling av graveskuffen skal ikke telle");
  assert.equal(missionStepCompleted("dumper", false), false, "lasting skal ikke telle som levering");
  assert.equal(missionStepCompleted("wheel-loader", false), false, "lasting av skuffen skal ikke telle");
  assert.equal(missionStepCompleted("dumper", true), true, "tømming av dumperen skal telle");
  assert.equal(missionStepCompleted("wheel-loader", true), true, "levering med hjullasteren skal telle");
  assert.equal(missionStepCompleted("excavator", true), true, "levering fra gravemaskinen til dumperen skal telle");
  assert.equal(advanceMission(0, "excavator", false), 0);
  assert.equal(advanceMission(1, "dumper", false), 1);
  assert.equal(advanceMission(2, "dumper", true), 3);
  assert.equal(advanceMission(3, "excavator", true), 3, "progresjonen skal aldri gå over tre");
});

test("har lisensierte 3D-bakgrunner for gård og byggeplass", async () => {
  const decor = await read("app/sceneDecor.ts");
  const tractor = await read("app/TractorGame3D.tsx");
  const construction = await read("app/ConstructionGame3D.tsx");
  const licenses = await read("public/assets/models/LICENSES.md");
  for (const file of ["barn.glb", "cow.glb", "sheep.glb", "pine-trees.glb", "rocks.glb"]) {
    assert.ok(decor.includes(file));
    assert.ok(licenses.includes(file));
    const model = await readFile(new URL(`public/assets/models/${file}`, root));
    assert.equal(model.subarray(0, 4).toString("ascii"), "glTF");
  }
  assert.match(tractor, /createFieldDecor/);
  for (const label of ["Slå", "Rake", "Press"]) assert.ok(tractor.includes(label));
  assert.match(tractor, /mower-implement/);
  assert.match(tractor, /rake-implement/);
  assert.match(tractor, /baler-implement/);
  assert.match(construction, /createConstructionDecor/);
  assert.match(decor, /checkCollisions = false/);
  assert.match(decor, /addMountainRange/);
  assert.match(licenses, /CC0-1\.0/);
});
