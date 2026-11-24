import { isPose, type LocalPose } from "./localRoom.ts";
import { sameWorld, type WorldIdentity } from "./worldDefinition.ts";

/** Attach the driving pose protocol to an ordered, reliable WebRTC data channel. */
export function connectWorldPeer(channel: RTCDataChannel, world: WorldIdentity, onPose: (pose: LocalPose) => void, onRejected: () => void) {
  let compatible = false;
  let announced = false;
  function hello() {
    if (announced || channel.readyState !== "open") return;
    announced = true;
    channel.send(JSON.stringify({ v: 1, type: "world", world }));
  }
  function receive({ data }: MessageEvent) {
    if (typeof data !== "string" || data.length > 2048) return;
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (message?.v !== 1) return;
    if (message.type === "world") {
      if (!sameWorld(world, message.world)) {
        compatible = false;
        onRejected();
        channel.close();
        return;
      }
      compatible = true;
      hello();
    } else if (compatible && message.type === "pose" && isPose(message.pose)) {
      onPose(message.pose);
    }
  }
  channel.addEventListener("open", hello);
  channel.addEventListener("message", receive);
  hello();
  return {
    send(pose: LocalPose) {
      if (compatible && channel.readyState === "open" && channel.bufferedAmount < 64_000) {
        channel.send(JSON.stringify({ v: 1, type: "pose", pose }));
      }
    },
    dispose() {
      compatible = false;
      channel.removeEventListener("open", hello);
      channel.removeEventListener("message", receive);
      channel.close();
    },
  };
}
