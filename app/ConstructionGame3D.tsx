"use client";

import { useEffect, useRef, useState } from "react";
import { vehicleConfig } from "./vehicleModes";
import { MachineAudio, playUiSound, speakNorwegian, type WorkSound } from "./gameAudio";
import { createConstructionDecor, reportDecorError } from "./sceneDecor";
import { advanceMission, type ConstructionMode } from "./missionRules";
import type { MultiplayerBridge, WorldSnapshot } from "./multiplayer";

type Keys = { left: boolean; right: boolean; up: boolean; down: boolean };
type Props = { mode: ConstructionMode; steering: number; keys: Keys; pedalForward: number; pedalReverse: number; autoDrive: boolean; audioEnabled: boolean; audioActive: boolean; multiplayer?: MultiplayerBridge | null };
type WorkState = "seeking" | "working" | "ready";
type TargetKind = "pit" | "pile" | "tip";
type Rig = {
  root: import("@babylonjs/core").TransformNode;
  movingPart: import("@babylonjs/core").TransformNode | import("@babylonjs/core").Mesh;
  cargo: import("@babylonjs/core").TransformNode | null;
  wheels: import("@babylonjs/core").TransformNode[];
  heading: number;
  wheelRoll: number;
  workState: WorkState;
  workTime: number;
  cooldown: number;
  loaded: boolean;
};

const CONSTRUCTION_MODES: ConstructionMode[] = ["excavator", "dumper", "wheel-loader"];
const STARTS: Record<ConstructionMode, { x: number; z: number; heading: number }> = {
  excavator: { x: -14, z: 13, heading: -Math.PI / 2 },
  dumper: { x: -4, z: -2, heading: Math.PI },
  "wheel-loader": { x: 7, z: -5, heading: Math.PI },
};
const TARGETS: Record<TargetKind, { x: number; z: number; color: string }> = {
  pit: { x: -21, z: 13, color: "#48aee8" },
  pile: { x: 0, z: -15, color: "#f4c542" },
  tip: { x: 23, z: 12, color: "#70c95b" },
};
const MISSION_LABELS: Record<ConstructionMode, string> = {
  excavator: "Fyll dumperen 3 ganger",
  dumper: "Lever 3 lass",
  "wheel-loader": "Flytt 3 skuffer",
};
const sourceKind = (id: ConstructionMode): TargetKind => id === "excavator" ? "pit" : "pile";

export function ConstructionGame3D({ mode, steering, keys, pedalForward, pedalReverse, autoDrive, audioEnabled, audioActive, multiplayer = null }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resetRef = useRef<() => void>(() => {});
  const inputRef = useRef({ mode, steering, keys, pedalForward, pedalReverse, autoDrive });
  const audioRef = useRef<MachineAudio | null>(null);
  const audioStateRef = useRef({ enabled: audioEnabled, active: audioActive });
  const multiplayerRef = useRef(multiplayer);
  const [message, setMessage] = useState("Kjør til arbeidsområdet");
  const [progress, setProgress] = useState(0);
  const displayMode:ConstructionMode=multiplayer?.role==="guest"&&multiplayer.playerId==="p3"?"wheel-loader":mode;
  const config = vehicleConfig(displayMode);

  useEffect(() => { inputRef.current = { mode, steering, keys, pedalForward, pedalReverse, autoDrive }; }, [mode, steering, keys, pedalForward, pedalReverse, autoDrive]);
  useEffect(() => { multiplayerRef.current = multiplayer; }, [multiplayer]);
  useEffect(() => {
    audioStateRef.current = { enabled: audioEnabled, active: audioActive };
    audioRef.current?.setState(audioEnabled, audioActive);
  }, [audioEnabled, audioActive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let disposeScene = () => {};

    void (async () => {
      const B = await import("@babylonjs/core");
      if (disposed) return;
      const engine = new B.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
      const scene = new B.Scene(engine);
      scene.clearColor = new B.Color4(.57, .8, .9, 1);
      scene.fogMode = B.Scene.FOGMODE_LINEAR; scene.fogStart = 48; scene.fogEnd = 105; scene.fogColor = new B.Color3(.57, .8, .9);
      const light = new B.HemisphericLight("dagslys", new B.Vector3(-.4, 1, -.2), scene); light.intensity = 1.25;
      const material = (name: string, color: string) => { const mat = new B.StandardMaterial(name, scene); mat.diffuseColor = B.Color3.FromHexString(color); mat.specularColor = B.Color3.Black(); return mat; };
      const yellow = material("maskingul", "#f3b632"), dark = material("dekk", "#27312e"), glass = material("vinduer", "#9ed9e5"), steelGray = material("grått stål", "#747d7b");
      const sand = material("jord", "#b8793d"), paleSand = material("lys jord", "#d9a45d"), road = material("kjørevei", "#9b8d72"), grass = material("bakke", "#6f9848"), red = material("markør", "#e65f47"), green = material("mål", "#72b451");

      const ground = B.MeshBuilder.CreateGround("byggeplass", { width: 180, height: 180 }, scene); ground.material = grass;
      const yard = B.MeshBuilder.CreateGround("kjøreområde", { width: 67, height: 47 }, scene); yard.position.y = .02; yard.material = road;
      const grainSource = B.MeshBuilder.CreatePolyhedron("jordkorn-kilde", { type: 2, size: .42 }, scene); grainSource.material = paleSand; grainSource.position.set(1000,1000,1000); grainSource.isVisible = false;
      const granularHeap = (name: string, parent: import("@babylonjs/core").Node | null, position: [number,number,number], radius: number, count: number) => {
        const heap = new B.TransformNode(name, scene); heap.parent = parent; heap.position.set(...position);
        for (let index = 0; index < count; index++) {
          const angle = index * 2.399963, ring = Math.sqrt((index + .5) / count) * radius;
          const grain = grainSource.createInstance(`${name}-korn-${index}`); grain.parent = heap;
          grain.position.set(Math.cos(angle)*ring, Math.max(.05,(1-ring/radius)*radius*.48)*(.62+(index%5)*.085), Math.sin(angle)*ring);
          const size = .62 + ((index*17)%9)*.055; grain.scaling.set(size*(1+(index%3)*.08),size,size*(.86+(index%4)*.06)); grain.rotation.set((index%7)*.31,angle,(index%5)*.27); grain.isVisible = true;
        }
        return heap;
      };
      const makeDisc = (name: string, x: number, z: number, mat: typeof red) => { const disc = B.MeshBuilder.CreateCylinder(name, { diameter: 9, height: .08, tessellation: 40 }, scene); disc.position.set(x,.08,z); disc.material = mat; };
      makeDisc("graveområde",-21,13,red); makeDisc("lastesone",0,-15,paleSand); makeDisc("tippeplass",23,12,green);
      const pit = B.MeshBuilder.CreateCylinder("gravegrop", { diameterTop: 7, diameterBottom: 4.8, height: .6, tessellation: 36 }, scene); pit.position.set(-21,-.24,13); pit.material = dark;
      const pile = B.MeshBuilder.CreateSphere("jordhaug", { diameter: 6.5, segments: 12 }, scene); pile.scaling.y=.34; pile.position.set(0,.85,-15); pile.material=sand;
      granularHeap("kornete jordhaug",null,[0,.18,-15],3.5,135);
      const tipped = B.MeshBuilder.CreateSphere("tippet jord", { diameter: 4.6, segments: 10 }, scene); tipped.scaling.set(1,.2,1); tipped.position.set(23,.48,12); tipped.material=sand;
      granularHeap("korn på tippeplassen",null,[23,.12,12],2.7,80); granularHeap("jordkant ved gravegropa",null,[-21,.05,13],4.5,55);
      void createConstructionDecor(B, scene).catch((error) => reportDecorError("byggeplassbakgrunnen", error));

      const markerMaterial = new B.StandardMaterial("aktiv målmarkør", scene);
      markerMaterial.emissiveColor = B.Color3.FromHexString(TARGETS.pit.color);
      markerMaterial.diffuseColor = markerMaterial.emissiveColor;
      markerMaterial.alpha = .9;
      const marker = new B.TransformNode("aktivt mål", scene);
      const markerRing = B.MeshBuilder.CreateTorus("pulserende målring", { diameter: 8.2, thickness: .38, tessellation: 48 }, scene);
      markerRing.parent = marker; markerRing.position.y = .18; markerRing.material = markerMaterial;
      const markerStem = B.MeshBuilder.CreateCylinder("målpeker", { height: 2.6, diameter: .48, tessellation: 20 }, scene);
      markerStem.parent = marker; markerStem.position.y = 4.7; markerStem.material = markerMaterial;
      const markerArrow = B.MeshBuilder.CreateCylinder("målpil", { height: 1.7, diameterTop: 0, diameterBottom: 2.2, tessellation: 24 }, scene);
      markerArrow.parent = marker; markerArrow.position.y = 3.05; markerArrow.rotation.z = Math.PI; markerArrow.material = markerMaterial;

      const buildRig = (rigMode: ConstructionMode): Rig => {
        const root = new B.TransformNode(`maskin-${rigMode}`, scene);
        const start = STARTS[rigMode]; root.position.set(start.x,0,start.z); root.rotation.y = start.heading;
        const box = (name: string, size: {width:number;height:number;depth:number}, pos: [number,number,number], parent: import("@babylonjs/core").Node = root, mat = yellow) => { const mesh=B.MeshBuilder.CreateBox(`${rigMode}-${name}`,size,scene); mesh.parent=parent; mesh.position.set(...pos); mesh.material=mat; return mesh; };
        const wheels: import("@babylonjs/core").TransformNode[] = [];
        const addWheel = (x:number,z:number,diameter=1.8) => {
          const pivot=new B.TransformNode(`${rigMode}-hjulfeste-${x}-${z}`,scene); pivot.parent=root; pivot.position.set(x,.9,z);
          const mesh=B.MeshBuilder.CreateCylinder(`${rigMode}-hjul-${x}-${z}`,{diameter,height:.68,tessellation:24},scene); mesh.parent=pivot; mesh.rotation.z=Math.PI/2; mesh.material=dark;
          for(let i=0;i<10;i++){const tread=box(`dekkmønster-${x}-${z}-${i}`,{width:.76,height:.1,depth:.22},[0,Math.sin(i*Math.PI/5)*diameter*.49,Math.cos(i*Math.PI/5)*diameter*.49],pivot,dark);tread.rotation.x=i*Math.PI/5;}
          wheels.push(pivot);
        };
        let movingPart: Rig["movingPart"], cargo: Rig["cargo"] = null;
        if (rigMode === "excavator") {
          box("belter",{width:4.3,height:.8,depth:5.2},[0,.7,0],root,dark); box("undervogn",{width:3.8,height:.8,depth:3.8},[0,1.25,0]); box("førerhus",{width:2.9,height:2.8,depth:2.5},[-.35,2.8,-.35]); box("vindu",{width:2.95,height:1.5,depth:1.4},[-.35,3.15,.25],root,glass);
          const arm=new B.TransformNode("gravearm",scene);arm.parent=root;arm.position.set(0,2.4,1.2);arm.rotation.x=-.22;box("bom",{width:.65,height:.7,depth:5.4},[0,.8,2.3],arm);const bucket=box("skuffe",{width:2.5,height:1.2,depth:1.5},[0,.15,5.15],arm,steelGray);bucket.rotation.x=-.25;movingPart=arm;
          cargo=granularHeap("jord i graveskuffa",arm,[0,.42,5.1],1.05,24);cargo.scaling.z=.6;cargo.setEnabled(false);
        } else if (rigMode === "dumper") {
          box("ramme",{width:3.8,height:.7,depth:6.8},[0,1,0],root,dark);box("førerhus",{width:3.5,height:3,depth:2.6},[0,2.6,2.1]);box("frontrute",{width:2.5,height:1.25,depth:.08},[0,3.1,3.42],root,glass);
          const bed=new B.TransformNode("planfeste",scene);bed.parent=root;bed.position.set(0,1.55,-2.2);box("lasteplan",{width:4.2,height:1.45,depth:4.7},[0,.65,.7],bed,steelGray);movingPart=bed;cargo=granularHeap("jord på lasteplanet",bed,[0,1.1,.65],1.75,52);cargo.scaling.z=1.45;cargo.setEnabled(false);
          for(const z of [-2.3,2.2]){addWheel(-2,z,2.15);addWheel(2,z,2.15);}
        } else {
          box("karosseri",{width:3.8,height:1.5,depth:4.8},[0,1.5,0]);box("førerhus",{width:3.2,height:2.7,depth:2.4},[0,3,-.65]);box("frontrute",{width:2.45,height:1.45,depth:.08},[0,3.25,.58],root,glass);
          const arms=new B.TransformNode("lastearmer",scene);arms.parent=root;arms.position.set(0,1.45,1.55);box("venstre arm",{width:.35,height:.45,depth:3.5},[-1.45,.2,1.45],arms);box("høyre arm",{width:.35,height:.45,depth:3.5},[1.45,.2,1.45],arms);const bucket=box("skuffe",{width:4.3,height:1.25,depth:1.65},[0,.05,3.35],arms,steelGray);bucket.rotation.x=-.18;movingPart=arms;cargo=granularHeap("jord i skuffa",arms,[0,.35,3.25],1.25,30);cargo.scaling.z=.65;cargo.setEnabled(false);
          for(const z of [-1.5,1.45]){addWheel(-2,z,2);addWheel(2,z,2);}
        }
        return {root,movingPart,cargo,wheels,heading:start.heading,wheelRoll:0,workState:"seeking",workTime:0,cooldown:0,loaded:false};
      };

      const rigs = Object.fromEntries(CONSTRUCTION_MODES.map((id) => [id,buildRig(id)])) as Record<ConstructionMode,Rig>;
      const supportRig=buildRig("dumper");supportRig.root.name="maskin-ekstra-dumper";supportRig.root.position.set(14,0,4);supportRig.heading=-Math.PI/2;supportRig.root.rotation.y=supportRig.heading;
      const camera=new B.UniversalCamera("følgekamera",new B.Vector3(0,10,-14),scene);camera.rotation.x=.5;camera.fov=.9;camera.minZ=.1;scene.activeCamera=camera;
      let activeMode = inputRef.current.mode; camera.parent=rigs[activeMode].root;
      let audio = new MachineAudio(activeMode); audioRef.current=audio; audio.setState(audioStateRef.current.enabled,audioStateRef.current.active);
      const missionProgress: Record<ConstructionMode, number> = { excavator: 0, dumper: 0, "wheel-loader": 0 };
      const prompt = (id:ConstructionMode,loaded:boolean) => loaded ? (id==="dumper"?"Kjør til tippeplassen":"Kjør bort til dumperen") : (id==="excavator"?"Kjør til gravegropa":"Kjør til jordhaugen");
      const announce = (text:string) => speakNorwegian(text,audioStateRef.current.enabled&&audioStateRef.current.active);
      const resetRig = (id:ConstructionMode) => { const rig=rigs[id],start=STARTS[id];rig.root.position.set(start.x,0,start.z);rig.heading=start.heading;rig.root.rotation.y=start.heading;rig.wheelRoll=0;rig.workState="seeking";rig.workTime=0;rig.cooldown=0;rig.loaded=false;audio.setWork(null);rig.cargo?.setEnabled(false);rig.movingPart.rotation.x=id==="excavator"?-.22:0;missionProgress[id]=0;setProgress(0);setMessage(prompt(id,false));announce(`${MISSION_LABELS[id]}. ${prompt(id,false)}.`); };
      resetRef.current=()=>resetRig(activeMode); setMessage(prompt(activeMode,false));
      let lastTime=performance.now(),lastNetworkSend=0,networkSequence=0,lastGuestProgress=-1;
      scene.onBeforeRenderObservable.add(()=>{
        const now=performance.now(),dt=Math.min((now-lastTime)/1000,.04);lastTime=now;const input=inputRef.current;
        if(input.mode!==activeMode){audio.dispose();activeMode=input.mode;audio=new MachineAudio(activeMode);audioRef.current=audio;audio.setState(audioStateRef.current.enabled,audioStateRef.current.active);camera.parent=rigs[activeMode].root;setProgress(missionProgress[activeMode]);setMessage(missionProgress[activeMode]>=3?"Fri lek – kjør hvor du vil":prompt(activeMode,rigs[activeMode].loaded));}
        const network=multiplayerRef.current;
        if(network?.role==="guest"){
          const guestMode:ConstructionMode=network.playerId==="p3"?"wheel-loader":"dumper",guestRig=network.playerId==="p4"?supportRig:rigs[guestMode];camera.parent=guestRig.root;
          if(now-lastNetworkSend>65){network.send({v:1,type:"input",sequence:++networkSequence,input:{steering:input.steering,forward:Math.max(input.keys.up?1:0,input.pedalForward),reverse:Math.max(input.keys.down?1:0,input.pedalReverse),autoDrive:input.autoDrive}});lastNetworkSend=now;}
          const snapshot=network.remoteSnapshot.current;
          if(snapshot){for(const id of CONSTRUCTION_MODES){const source=snapshot.rigs[id],targetRig=rigs[id];targetRig.root.position.x+=(source.x-targetRig.root.position.x)*.32;targetRig.root.position.z+=(source.z-targetRig.root.position.z)*.32;targetRig.heading+=(source.heading-targetRig.heading)*.32;targetRig.root.rotation.y=targetRig.heading;targetRig.loaded=source.loaded;targetRig.workState=source.workState;targetRig.workTime=source.workTime;targetRig.cargo?.setEnabled(source.loaded);if(id==="dumper")targetRig.movingPart.rotation.x=source.workState==="working"?-Math.sin(Math.min(1,source.workTime/3.4)*Math.PI)*.72:0;else if(id==="wheel-loader")targetRig.movingPart.rotation.x=source.workState==="working"?-.55*Math.sin(Math.min(1,source.workTime/3.4)*Math.PI):0;}const support=snapshot.peers?.p4;if(support){supportRig.root.position.x+=(support.x-supportRig.root.position.x)*.32;supportRig.root.position.z+=(support.z-supportRig.root.position.z)*.32;supportRig.heading+=(support.heading-supportRig.heading)*.32;supportRig.root.rotation.y=supportRig.heading;}const guestProgress=network.playerId==="p4"?0:snapshot.progress[guestMode];if(guestProgress!==lastGuestProgress){lastGuestProgress=guestProgress;setProgress(guestProgress);setMessage(network.playerId==="p4"?"Kjør sammen med de andre":guestProgress>=3?"Fri lek – kjør hvor du vil":guestRig.loaded?guestMode==="dumper"?"Kjør til tippeplassen":"Kjør bort til dumperen":guestMode==="dumper"?"Vent på et lass":"Kjør til jordhaugen");}}
          const target=network.playerId==="p4"?{x:0,z:0,color:"#48aee8"}:guestRig.loaded&&guestMode==="dumper"?TARGETS.tip:guestRig.loaded?{x:rigs.dumper.root.position.x,z:rigs.dumper.root.position.z,color:"#48aee8"}:TARGETS[sourceKind(guestMode)];marker.position.set(target.x,0,target.z);marker.setEnabled(network.playerId!=="p4"&&(snapshot?.progress[guestMode]??0)<3);audio.setMotion(0);audio.tick(dt);return;
        }
        const rig=rigs[activeMode],speedSetting=vehicleConfig(activeMode).speed;rig.cooldown=Math.max(0,rig.cooldown-dt);
        const forward=Math.max(input.keys.up?1:0,input.pedalForward),reverse=Math.max(input.keys.down?1:0,input.pedalReverse);
        let speed=reverse>.12?-(1.5+reverse*speedSetting*.55):input.autoDrive?speedSetting*.58+forward*speedSetting*.35:forward*speedSetting;
        const target=rig.loaded&&activeMode!=="dumper"?{x:rigs.dumper.root.position.x,z:rigs.dumper.root.position.z,color:"#48aee8"}:TARGETS[rig.loaded?"tip":sourceKind(activeMode)];const distance=Math.hypot(rig.root.position.x-target.x,rig.root.position.z-target.z);
        const markerColor=B.Color3.FromHexString(target.color);markerMaterial.emissiveColor=markerColor;markerMaterial.diffuseColor=markerColor;marker.position.set(target.x,0,target.z);
        const markerPulse=1+Math.sin(now*.004)*.1;marker.scaling.set(markerPulse,markerPulse,markerPulse);markerArrow.position.y=3.05+Math.sin(now*.005)*.35;
        marker.setEnabled(rig.workState!=="working"&&missionProgress[activeMode]<3);
        if(rig.workState==="working"){const wasLoaded=rig.loaded,workSound:WorkSound=activeMode==="excavator"&&!wasLoaded?"dig":wasLoaded?"dump":"load";audio.setWork(workSound);speed=0;rig.workTime+=dt;const phase=Math.min(1,rig.workTime/3.4),base=activeMode==="excavator"?-.22:0,lift=.55;if(activeMode==="dumper"){rig.movingPart.rotation.x=-Math.sin(phase*Math.PI)*.72;}else{rig.movingPart.rotation.x=wasLoaded?base-lift*(1-phase):base-lift*phase;}if(phase>.48&&rig.cargo)rig.cargo.setEnabled(!wasLoaded);if(phase>=1){const nextProgress=advanceMission(missionProgress[activeMode],activeMode,wasLoaded),completedDelivery=nextProgress>missionProgress[activeMode];rig.workState="ready";rig.workTime=0;rig.loaded=!wasLoaded;audio.setWork(null);rig.cargo?.setEnabled(rig.loaded);if(wasLoaded&&activeMode!=="dumper"){const dumper=rigs.dumper;dumper.loaded=true;dumper.cargo?.setEnabled(true);}if(completedDelivery){missionProgress[activeMode]=nextProgress;setProgress(nextProgress);setMessage(nextProgress>=3?"Fri lek – kjør hvor du vil":"Bra jobbet!");if(nextProgress>=3){audio.playComplete();announce("Oppdraget er ferdig. Nå er det fri lek!");}else announce(`Bra jobbet! ${nextProgress} av 3.`);}else setMessage(missionProgress[activeMode]>=3?"Fri lek – kjør hvor du vil":"Klar!");rig.cooldown=1.2;}}
        else {audio.setWork(null);if(rig.workState==="ready"&&rig.cooldown<=0){rig.workState="seeking";if(missionProgress[activeMode]>=3){setMessage("Fri lek – kjør hvor du vil");}else{const nextPrompt=prompt(activeMode,rig.loaded);setMessage(nextPrompt);announce(`${nextPrompt}.`);}}if(rig.workState==="seeking"&&distance<5.2&&Math.abs(speed)<speedSetting*.7&&rig.cooldown<=0){rig.workState="working";rig.workTime=0;setMessage(rig.loaded?activeMode==="dumper"?"Tømmer …":"Fyller dumperen …":activeMode==="excavator"?"Graver og løfter …":"Laster og løfter …");}}
        audio.setMotion(speed/speedSetting);audio.tick(dt);
        rig.wheelRoll+=speed*dt*.9;rig.wheels.forEach(wheel=>wheel.rotation.x=rig.wheelRoll);rig.heading+=input.steering*(speed<0?-1:1)*(activeMode==="excavator"?.78:1.02)*dt;rig.root.rotation.y=rig.heading;rig.root.position.x+=Math.sin(rig.heading)*speed*dt;rig.root.position.z+=Math.cos(rig.heading)*speed*dt;rig.root.position.x=Math.max(-35,Math.min(35,rig.root.position.x));rig.root.position.z=Math.max(-25,Math.min(25,rig.root.position.z));
        if(network?.role==="host"){
          const driveRemote=(peerInput:typeof network.remoteInput.current,guestRig:Rig,guestMode:ConstructionMode,workEnabled=true)=>{if(!peerInput)return;const speedSetting=vehicleConfig(guestMode).speed;guestRig.cooldown=Math.max(0,guestRig.cooldown-dt);let guestSpeed=0;if(guestRig.workState==="working"&&workEnabled){const wasLoaded=guestRig.loaded;guestRig.workTime+=dt;const phase=Math.min(1,guestRig.workTime/3.4),base=guestMode==="excavator"?-.22:0;if(guestMode==="dumper")guestRig.movingPart.rotation.x=-Math.sin(phase*Math.PI)*.72;else guestRig.movingPart.rotation.x=wasLoaded?base-.55*(1-phase):base-.55*phase;if(phase>.48)guestRig.cargo?.setEnabled(!wasLoaded);if(phase>=1){guestRig.loaded=!wasLoaded;guestRig.workState="ready";guestRig.workTime=0;guestRig.cooldown=1.2;guestRig.movingPart.rotation.x=base;guestRig.cargo?.setEnabled(guestRig.loaded);if(wasLoaded){missionProgress[guestMode]=advanceMission(missionProgress[guestMode],guestMode,true);if(guestMode!=="dumper"){rigs.dumper.loaded=true;rigs.dumper.cargo?.setEnabled(true);}}}}else{const forward=peerInput.forward,reverse=peerInput.reverse;guestSpeed=reverse>.12?-(1.5+reverse*speedSetting*.55):peerInput.autoDrive?speedSetting*.58+forward*speedSetting*.35:forward*speedSetting;if(guestRig.workState==="ready"&&guestRig.cooldown<=0)guestRig.workState="seeking";if(workEnabled){const target=guestRig.loaded&&guestMode!=="dumper"?rigs.dumper.root.position:TARGETS[guestRig.loaded?"tip":sourceKind(guestMode)],distance=Math.hypot(guestRig.root.position.x-target.x,guestRig.root.position.z-target.z),mayWork=guestMode!=="dumper"||guestRig.loaded;if(mayWork&&guestRig.workState==="seeking"&&distance<5.2&&Math.abs(guestSpeed)<speedSetting*.7){guestRig.workState="working";guestRig.workTime=0;guestSpeed=0;}}guestRig.heading+=peerInput.steering*(guestSpeed<0?-1:1)*1.02*dt;guestRig.root.rotation.y=guestRig.heading;guestRig.root.position.x=Math.max(-35,Math.min(35,guestRig.root.position.x+Math.sin(guestRig.heading)*guestSpeed*dt));guestRig.root.position.z=Math.max(-25,Math.min(25,guestRig.root.position.z+Math.cos(guestRig.heading)*guestSpeed*dt));guestRig.wheelRoll+=guestSpeed*dt*.9;guestRig.wheels.forEach(wheel=>wheel.rotation.x=guestRig.wheelRoll);}};
          driveRemote(network.remoteInputs.current.p2,rigs.dumper,"dumper");driveRemote(network.remoteInputs.current.p3,rigs["wheel-loader"],"wheel-loader");driveRemote(network.remoteInputs.current.p4,supportRig,"dumper",false);
          if(now-lastNetworkSend>80){const support={x:supportRig.root.position.x,z:supportRig.root.position.z,heading:supportRig.heading,loaded:false,workState:supportRig.workState,workTime:supportRig.workTime};const world:WorldSnapshot={tick:now,rigs:Object.fromEntries(CONSTRUCTION_MODES.map((id)=>{const item=rigs[id];return[id,{x:item.root.position.x,z:item.root.position.z,heading:item.heading,loaded:item.loaded,workState:item.workState,workTime:item.workTime}]})) as WorldSnapshot["rigs"],peers:{p4:support},progress:{...missionProgress}};network.send({v:1,type:"snapshot",sequence:++networkSequence,world});lastNetworkSend=now;}
        }
      });
      engine.runRenderLoop(()=>scene.render());const resize=()=>engine.resize();window.addEventListener("resize",resize);disposeScene=()=>{window.removeEventListener("resize",resize);audio.dispose();if(audioRef.current===audio)audioRef.current=null;scene.dispose();engine.dispose();};
    })();
    return()=>{disposed=true;disposeScene();};
  }, []);

  return <div className="gameShell game3d"><canvas ref={canvasRef} aria-label={`3D-spill med ${config.name.toLowerCase()} på byggeplassen`} /><div className="gameHud workHud"><div><span>{config.name.toUpperCase()}</span></div><strong>{message}</strong><p className="missionLabel">{multiplayer?.playerId==="p4"?"Kjør sammen":progress>=3?"Fri lek":MISSION_LABELS[displayMode]}</p><div className="missionDots" aria-label={`${progress} av 3 fullført`}>{[0,1,2].map((step)=><i key={step} className={step<progress?"done":""} />)}</div></div>{multiplayer?.role!=="guest"&&<button className="resetButton" onClick={()=>{playUiSound("reset",audioEnabled&&audioActive);resetRef.current();}}>Start på nytt</button>}</div>;
}
