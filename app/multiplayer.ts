"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { ConstructionMode } from "./missionRules";
import type { TractorTool } from "./tractorRules";

export type DriveInput = { steering: number; forward: number; reverse: number; autoDrive: boolean };
export type RigSnapshot = { x: number; z: number; heading: number; loaded: boolean; workState: "seeking" | "working" | "ready"; workTime: number };
export type WorldSnapshot = { tick: number; rigs: Record<ConstructionMode, RigSnapshot>; peers?: Record<string, RigSnapshot>; progress: Record<ConstructionMode, number> };
export type TractorPose = { x: number; z: number; heading: number };
export type TractorSnapshot = { sequence: number; tractors: Record<string, TractorPose>; tool: TractorTool; progress: number; patches: Array<[number, number]>; field?: string; bales: Array<{ x: number; z: number; heading: number }> };
export type MultiplayerGame = "tractor" | "construction";
export type PeerMessage =
  | { v: 1; type: "input"; sequence: number; input: DriveInput }
  | { v: 1; type: "snapshot"; sequence: number; world: WorldSnapshot }
  | { v: 1; type: "tractor-snapshot"; snapshot: TractorSnapshot }
  | { v: 1; type: "game"; game: MultiplayerGame }
  | { v: 1; type: "participant-count"; count: number }
  | { v: 1; type: "reset" }
  | { v: 1; type: "ping"; sentAt: number }
  | { v: 1; type: "pong"; sentAt: number };

export type MultiplayerRole = "host" | "guest";
export type MultiplayerStatus = "solo" | "waiting" | "connecting" | "connected" | "failed";
export type MultiplayerBridge = {
  role: MultiplayerRole;
  playerId: string;
  remoteInput: MutableRefObject<DriveInput | null>;
  remoteInputs: MutableRefObject<Record<string, DriveInput>>;
  remoteSnapshot: MutableRefObject<WorldSnapshot | null>;
  remoteTractorSnapshot: MutableRefObject<TractorSnapshot | null>;
  send: (message: PeerMessage) => void;
};

type Session = { code: string; player: MultiplayerRole; playerId: string; token: string; inviteKey?: string };
type Signal = RTCSessionDescriptionInit | { candidate: RTCIceCandidateInit };
type SignalRow = { id: number; sender: string; payload: Signal };
const rtcConfig: RTCConfiguration = { iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] };

export function useMultiplayer(onGame?: (game: MultiplayerGame) => void) {
  const [session, setSession] = useState<Session | null>(null), [status, setStatus] = useState<MultiplayerStatus>("solo"), [error, setError] = useState(""), [activeGame, setActiveGame] = useState<MultiplayerGame | null>(null), [playerCount, setPlayerCount] = useState(1);
  const peersRef = useRef(new Map<string, RTCPeerConnection>()), channelsRef = useRef(new Map<string, RTCDataChannel>()), pollAbortRef = useRef<AbortController | null>(null);
  const messageRatesRef = useRef(new Map<string, { started: number; count: number }>());
  const remoteInput = useRef<DriveInput | null>(null), remoteInputs = useRef<Record<string, DriveInput>>({}), remoteSnapshot = useRef<WorldSnapshot | null>(null), remoteTractorSnapshot = useRef<TractorSnapshot | null>(null), gameRef = useRef<MultiplayerGame | null>(null);

  const updateCount = useCallback(() => setPlayerCount(1 + Array.from(channelsRef.current.values()).filter((channel) => channel.readyState === "open").length), []);
  const send = useCallback((message: PeerMessage) => { const encoded=JSON.stringify(message);for(const channel of channelsRef.current.values())if(channel.readyState==="open"&&channel.bufferedAmount<1_000_000)channel.send(encoded); }, []);
  const close = useCallback(() => { pollAbortRef.current?.abort();for(const channel of channelsRef.current.values())channel.close();for(const peer of peersRef.current.values())peer.close();channelsRef.current.clear();peersRef.current.clear();remoteInput.current=null;remoteInputs.current={};remoteSnapshot.current=null;remoteTractorSnapshot.current=null;gameRef.current=null;setActiveGame(null);setSession(null);setPlayerCount(1);setStatus("solo");setError(""); }, []);

  const handleMessage = useCallback((sender:string,event:MessageEvent) => { try { if(typeof event.data!=="string"||event.data.length>200_000)return;const now=Date.now(),previous=messageRatesRef.current.get(sender),rate=!previous||now-previous.started>=1000?{started:now,count:1}:{started:previous.started,count:previous.count+1};messageRatesRef.current.set(sender,rate);if(rate.count>60)return;const message=JSON.parse(event.data) as PeerMessage;if(message.v!==1)return;if(message.type==="input"){const input=message.input;if(!input||![input.steering,input.forward,input.reverse].every(Number.isFinite)||typeof input.autoDrive!=="boolean")return;remoteInputs.current[sender]={steering:Math.max(-1,Math.min(1,input.steering)),forward:Math.max(0,Math.min(1,input.forward)),reverse:Math.max(0,Math.min(1,input.reverse)),autoDrive:input.autoDrive};remoteInput.current=remoteInputs.current.p2??remoteInputs.current.p3??remoteInputs.current.p4??null;}if(sender==="host"&&message.type==="snapshot")remoteSnapshot.current=message.world;if(sender==="host"&&message.type==="tractor-snapshot")remoteTractorSnapshot.current=message.snapshot;if(sender==="host"&&message.type==="participant-count"&&Number.isInteger(message.count))setPlayerCount(Math.max(1,Math.min(4,message.count)));if(sender==="host"&&message.type==="game"&&(message.game==="tractor"||message.game==="construction")){gameRef.current=message.game;setActiveGame(message.game);onGame?.(message.game);}if(message.type==="ping"&&Number.isFinite(message.sentAt)){const channel=channelsRef.current.get(sender);if(channel?.readyState==="open"&&channel.bufferedAmount<1_000_000)channel.send(JSON.stringify({v:1,type:"pong",sentAt:message.sentAt} satisfies PeerMessage));}}catch{/* Ignore malformed peer messages. */} }, [onGame]);
  const attachChannel = useCallback((playerId:string,channel:RTCDataChannel,role:MultiplayerRole) => { channelsRef.current.set(playerId,channel);const announceCount=()=>{const count=1+Array.from(channelsRef.current.values()).filter((item)=>item.readyState==="open").length;setPlayerCount(count);if(role==="host")send({v:1,type:"participant-count",count});};channel.onopen=()=>{setStatus("connected");setError("");if(role==="guest")pollAbortRef.current?.abort();if(role==="host"&&gameRef.current)channel.send(JSON.stringify({v:1,type:"game",game:gameRef.current} satisfies PeerMessage));announceCount();};channel.onmessage=(event)=>handleMessage(playerId,event);channel.onclose=()=>{channelsRef.current.delete(playerId);delete remoteInputs.current[playerId];remoteInput.current=remoteInputs.current.p2??remoteInputs.current.p3??remoteInputs.current.p4??null;announceCount();if(role==="guest"){setStatus("failed");setError("Forbindelsen ble borte");}};channel.onerror=()=>setError("En direkteforbindelse fikk en feil"); }, [handleMessage, send]);

  const beginRtc = useCallback(async(next:Session)=>{const headers={"content-type":"application/json",authorization:`Bearer ${next.token}`},base=`/api/multiplayer/rooms/${next.code}/signals`,abort=new AbortController(),pendingCandidates=new Map<string,RTCIceCandidateInit[]>();pollAbortRef.current=abort;let after=0;const postSignal=(recipient:string,signal:Signal)=>fetch(base,{method:"POST",headers,body:JSON.stringify({recipient,signal})});
    const makePeer=(remoteId:string)=>{const existing=peersRef.current.get(remoteId);if(existing)return existing;const peer=new RTCPeerConnection(rtcConfig);peersRef.current.set(remoteId,peer);peer.onicecandidate=(event)=>{if(event.candidate)void postSignal(remoteId,{candidate:event.candidate.toJSON()});};peer.onconnectionstatechange=()=>{if(peer.connectionState==="failed"){setError(`Kunne ikke koble til ${remoteId}`);peer.close();peersRef.current.delete(remoteId);channelsRef.current.delete(remoteId);updateCount();}};return peer;};
    if(next.player==="guest"){const peer=makePeer("host"),channel=peer.createDataChannel("game",{ordered:true});attachChannel("host",channel,"guest");await peer.setLocalDescription(await peer.createOffer());await postSignal("host",peer.localDescription!);}
    const deadline=Date.now()+20_000;while(!abort.signal.aborted&&(next.player==="host"||Date.now()<deadline)){const response=await fetch(`${base}?after=${after}`,{headers:{authorization:`Bearer ${next.token}`},signal:abort.signal});if(!response.ok)throw new Error("Signaleringen stoppet");const data=await response.json() as {signals:SignalRow[]};for(const item of data.signals){after=Math.max(after,item.id);const peer=makePeer(item.sender);if("candidate" in item.payload){if(peer.remoteDescription)await peer.addIceCandidate(item.payload.candidate);else pendingCandidates.set(item.sender,[...(pendingCandidates.get(item.sender)??[]),item.payload.candidate]);}else{if(item.payload.type==="offer")peer.ondatachannel=(event)=>attachChannel(item.sender,event.channel,"host");await peer.setRemoteDescription(item.payload);for(const candidate of pendingCandidates.get(item.sender)??[])await peer.addIceCandidate(candidate);pendingCandidates.delete(item.sender);if(item.payload.type==="offer"){await peer.setLocalDescription(await peer.createAnswer());await postSignal(item.sender,peer.localDescription!);}}}await new Promise((resolve)=>window.setTimeout(resolve,450));}
    if(!abort.signal.aborted&&next.player==="guest"&&!channelsRef.current.has("host")){setStatus("failed");setError("Fant ingen direkte rute til verten. TURN er ikke aktivert.");}
  },[attachChannel,updateCount]);

  const start=useCallback(async(kind:MultiplayerRole,roomCode?:string,game?:MultiplayerGame,inviteKey?:string)=>{close();if(game){gameRef.current=game;setActiveGame(game);}setStatus(kind==="host"?"waiting":"connecting");try{const url=kind==="host"?"/api/multiplayer/rooms":`/api/multiplayer/rooms/${roomCode?.trim().toUpperCase()}`,response=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(kind==="guest"?{inviteKey}:{})}),data=await response.json() as Session&{error?:string};if(!response.ok)throw new Error(data.error||"Kunne ikke åpne rommet");setSession(data);void beginRtc(data).catch((reason)=>{if((reason as Error).name!=="AbortError"){setStatus("failed");setError((reason as Error).message);}});}catch(reason){setStatus("failed");setError(reason instanceof Error?reason.message:"Kunne ikke koble til");}},[beginRtc,close]);
  useEffect(()=>close,[close]);
  const bridge=session?{role:session.player,playerId:session.playerId,remoteInput,remoteInputs,remoteSnapshot,remoteTractorSnapshot,send} satisfies MultiplayerBridge:null;
  return{session,status,error,activeGame,playerCount,bridge,createRoom:(game:MultiplayerGame)=>start("host",undefined,game),joinRoom:(code:string,inviteKey:string)=>start("guest",code,undefined,inviteKey),close};
}
