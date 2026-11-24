import { isCarLook, type CarLook } from "./looks.ts";

export type LocalPose = {
  position: [number, number, number];
  rotation: [number, number, number, number];
  look: CarLook;
  speed: number;
  steering: number;
  reset: number;
};

const roomName = "kjoreparken-local-v1";
const idleLimit = 15_000;

function finiteTuple(value: unknown, length: number, limit: number): value is number[] {
  return Array.isArray(value) && value.length === length
    && value.every((entry) => typeof entry === "number" && Number.isFinite(entry) && Math.abs(entry) <= limit);
}

function isPose(value: unknown): value is LocalPose {
  if (!value || typeof value !== "object") return false;
  const { position, rotation, look, speed, steering, reset } = value as Partial<LocalPose>;
  return finiteTuple(position, 3, 300) && finiteTuple(rotation, 4, 1.01)
    && Math.abs(Math.hypot(...rotation) - 1) < .05 && isCarLook(look)
    && typeof speed === "number" && Math.abs(speed) <= 80
    && typeof steering === "number" && Math.abs(steering) <= 1
    && Number.isSafeInteger(reset);
}

export function connectLocalCars(readPose: () => LocalPose, name = roomName) {
  let channel: BroadcastChannel;
  try { channel = new BroadcastChannel(name); } catch { return null; }
  const id = crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
  const peers = new Map<string, { pose: LocalPose; seen: number }>();

  function publish() {
    channel.postMessage({ kind: "pose", id, pose: readPose() });
  }

  channel.onmessage = ({ data }) => {
    if (!data || typeof data.id !== "string" || data.id.length > 60 || data.id === id) return;
    if (data.kind === "hello") publish();
    if (data.kind === "bye") peers.delete(data.id);
    if (data.kind === "pose" && isPose(data.pose) && (peers.has(data.id) || peers.size < 8)) {
      peers.set(data.id, { pose: data.pose, seen: performance.now() });
    }
  };
  channel.postMessage({ kind: "hello", id });
  publish();
  const heartbeat = setInterval(publish, 55);

  return {
    peers(now = performance.now()) {
      for (const [id, peer] of peers) {
        if (now - peer.seen > idleLimit) peers.delete(id);
      }
      return peers;
    },
    close() {
      clearInterval(heartbeat);
      channel.postMessage({ kind: "bye", id });
      channel.close();
    },
  };
}
