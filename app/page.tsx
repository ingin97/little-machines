"use client";

import { useEffect, useMemo, useState } from "react";
import { combinedPedals, firstGamepad, steeringDeadZone } from "./driveInput";
import { TractorGame3D } from "./TractorGame3D";
import { ConstructionGame3D } from "./ConstructionGame3D";
import { isVehicleMode, VEHICLES, vehicleConfig, type VehicleMode } from "./vehicleModes";
import { playUiSound, speakNorwegian, stopSpeech, unlockAudio } from "./gameAudio";

type Keys = { left: boolean; right: boolean; up: boolean; down: boolean };
type WheelState = { id: string; steering: number; pedal: number } | null;

export default function Home() {
  const [wheel, setWheel] = useState<WheelState>(null);
  const [keys, setKeys] = useState<Keys>({ left: false, right: false, up: false, down: false });
  const [touchSteering, setTouchSteering] = useState({ left: false, right: false });
  const [autoDrive, setAutoDrive] = useState(true);
  const [mode, setMode] = useState<VehicleMode>("tractor");
  const [menuOpen, setMenuOpen] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    const restorePreferences = window.setTimeout(() => {
      if (localStorage.getItem("little-tractor-mode") === "manual") setAutoDrive(false);
      const savedVehicle = localStorage.getItem("little-machine-vehicle");
      if (isVehicleMode(savedVehicle)) setMode(savedVehicle);
      if (localStorage.getItem("little-machine-sound") === "off") setSoundEnabled(false);
    }, 0);
    return () => window.clearTimeout(restorePreferences);
  }, []);

  useEffect(() => {
    const updateVisibility = () => setPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    localStorage.setItem("little-tractor-mode", autoDrive ? "auto" : "manual");
  }, [autoDrive]);

  useEffect(() => {
    let frame = 0;
    const readWheel = () => {
      const pad = firstGamepad();
      setWheel(pad ? { id: pad.id, steering: pad.axes[0] ?? 0, pedal: pad.axes[1] ?? 0 } : null);
      frame = requestAnimationFrame(readWheel);
    };
    frame = requestAnimationFrame(readWheel);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const update = (event: KeyboardEvent, pressed: boolean) => {
      const key = event.key.toLowerCase();
      if (["arrowleft", "arrowright", "arrowup", "arrowdown", "a", "d", "w", "s"].includes(key)) event.preventDefault();
      setKeys((current) => ({
        left: key === "arrowleft" || key === "a" ? pressed : current.left,
        right: key === "arrowright" || key === "d" ? pressed : current.right,
        up: key === "arrowup" || key === "w" ? pressed : current.up,
        down: key === "arrowdown" || key === "s" ? pressed : current.down,
      }));
    };
    const down = (event: KeyboardEvent) => update(event, true);
    const up = (event: KeyboardEvent) => update(event, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  const keyboardSteering = Number(keys.right) - Number(keys.left);
  const buttonSteering = Number(touchSteering.right) - Number(touchSteering.left);
  const steering = useMemo(() => {
    const raw = buttonSteering || wheel?.steering || keyboardSteering;
    return steeringDeadZone(raw);
  }, [wheel?.steering, keyboardSteering, buttonSteering]);
  const { accelerator: pedalForward, brake: pedalReverse } = combinedPedals(wheel?.pedal ?? 0);

  const chooseVehicle = (vehicle: VehicleMode) => {
    unlockAudio();
    playUiSound("select", soundEnabled);
    const chosen = vehicleConfig(vehicle);
    speakNorwegian(`${chosen.name}. ${chosen.description}.`, soundEnabled);
    setMode(vehicle);
    localStorage.setItem("little-machine-vehicle", vehicle);
    setMenuOpen(false);
  };
  const toggleSound = () => {
    unlockAudio();
    setSoundEnabled((enabled) => {
      const next = !enabled;
      localStorage.setItem("little-machine-sound", next ? "on" : "off");
      if (next) playUiSound("select", true);
      else stopSpeech();
      return next;
    });
  };
  const currentVehicle = vehicleConfig(mode);
  const constructionVehicles = VEHICLES.filter((vehicle) => vehicle.scene === "construction");
  const audioActive = pageVisible && !menuOpen;
  const setTouchDirection = (direction: "left" | "right", pressed: boolean) => {
    setTouchSteering((current) => current[direction] === pressed ? current : { ...current, [direction]: pressed });
  };
  const touchButtonProps = (direction: "left" | "right") => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setTouchDirection(direction, true);
    },
    onPointerUp: () => setTouchDirection(direction, false),
    onPointerCancel: () => setTouchDirection(direction, false),
    onLostPointerCapture: () => setTouchDirection(direction, false),
  });

  return <main className="fullscreenGame">
    {mode === "tractor"
      ? <TractorGame3D steering={steering} keys={keys} pedalForward={pedalForward} pedalReverse={pedalReverse} autoDrive={autoDrive} audioEnabled={soundEnabled} audioActive={audioActive} />
      : <ConstructionGame3D mode={mode} steering={steering} keys={keys} pedalForward={pedalForward} pedalReverse={pedalReverse} autoDrive={autoDrive} audioEnabled={soundEnabled} audioActive={audioActive} />}
    <div className="touchSteering" role="group" aria-label="Styring på mobil">
      <button type="button" className={touchSteering.left ? "pressed" : ""} aria-label="Styr til venstre" {...touchButtonProps("left")}><span aria-hidden="true">←</span></button>
      <button type="button" className={touchSteering.right ? "pressed" : ""} aria-label="Styr til høyre" {...touchButtonProps("right")}><span aria-hidden="true">→</span></button>
    </div>
    <button className="vehicleMenuButton" onClick={() => { stopSpeech(); setMenuOpen(true); }} aria-label={`Valgt maskin: ${currentVehicle.name}. Trykk for å bytte.`}><span aria-hidden="true">{currentVehicle.icon}</span> {currentVehicle.name}</button>
    {mode !== "tractor" && <div className="constructionTools" aria-label="Bytt byggeplassmaskin">
      {constructionVehicles.map((vehicle) => <button key={vehicle.id} className={vehicle.id === mode ? "active" : ""} onClick={() => chooseVehicle(vehicle.id)} aria-label={`Bytt til ${vehicle.name.toLowerCase()}`} aria-pressed={vehicle.id === mode} style={{ "--vehicle-color": vehicle.color } as React.CSSProperties}>
        <span aria-hidden="true">{vehicle.icon}</span><strong>{vehicle.name}</strong>
      </button>)}
    </div>}
    <div className="adultControls">
      <span className={wheel ? "wheelOnline" : ""}>{wheel ? "Ratt tilkoblet" : "WASD aktiv"}</span>
      <button onClick={() => setAutoDrive((value) => !value)} aria-label="Bytt kjøremåte">{autoDrive ? "Automatisk kjøring" : "Voksenstyrt kjøring"}</button>
    </div>
    <button onClick={toggleSound} className="soundButton" aria-label={soundEnabled ? "Slå av lyd" : "Slå på lyd"} aria-pressed={!soundEnabled}><span aria-hidden="true">{soundEnabled ? "🔊" : "🔇"}</span> {soundEnabled ? "Lyd på" : "Lyd av"}</button>
    {menuOpen && <div className="vehicleMenu" role="dialog" aria-modal="true" aria-labelledby="vehicle-menu-title">
      <div className="vehicleMenuPanel">
        <p className="menuEyebrow">BYGGEPLASSEN</p>
        <h1 id="vehicle-menu-title">Velg en modus</h1>
        <p className="menuLead">Hva har du lyst til å leke med?</p>
        <div className="vehicleGrid modeGrid">
          <button className={mode === "tractor" ? "vehicleCard selected" : "vehicleCard"} onClick={() => chooseVehicle("tractor")} style={{ "--vehicle-color": vehicleConfig("tractor").color } as React.CSSProperties} aria-label="Velg traktormodus">
            <span className="vehiclePicture" aria-hidden="true">🚜</span><strong>Traktor</strong><small>Klipp, rak og press gresset</small>
          </button>
          <button className={mode !== "tractor" ? "vehicleCard selected" : "vehicleCard"} onClick={() => chooseVehicle(mode === "tractor" ? "excavator" : mode)} style={{ "--vehicle-color": vehicleConfig("excavator").color } as React.CSSProperties} aria-label="Velg byggeplassmodus">
            <span className="vehiclePicture" aria-hidden="true">🏗️</span><strong>Byggeplass</strong><small>Grav, last og kjør dumper</small>
          </button>
        </div>
        <nav className="drivingModes" aria-label="Bilkjøring">
          <a href="./racing.html">Kjøreparken</a>
          <a href="./racing.html?mode=sprint">Tidkjøring</a>
        </nav>
        <p className="menuHelp">Bruk ratt, piltaster eller knappene på skjermen for å styre</p>
      </div>
    </div>}
  </main>;
}
