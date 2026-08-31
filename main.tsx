import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "./app/page";
import "./app/globals.css";
import "./app/game.css";
import "./app/pedals.css";
import "./app/fullscreen.css";
import "./app/touch-steering.css";
import "./app/missions.css";
import "./app/sound.css";
import "./app/tractor.css";
import "./app/multiplayer.css";
import "./app/hud-layout.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
