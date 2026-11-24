import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Quaternion } from "@babylonjs/core/Maths/math.vector.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder.js";
import { looks, type CarLook } from "./looks.ts";
import { paint } from "./surfaces.ts";

export const wheelRadius = .4;
export const axleHeight = -.09;
export const restLength = .35;
export const wheelMounts = [1.05, -1.05].flatMap((z) => [-.89, .89].map((x) => ({ x, z })));

export function createCarVisual(scene: Scene, shadows?: ShadowGenerator) {
  const root = new TransformNode("car", scene);
  root.rotationQuaternion = Quaternion.Identity();
  const shell = new TransformNode("car body", scene);
  shell.parent = root;
  const orange = paint(scene, looks.rally.color);
  const cream = paint(scene, looks.rally.accent);
  const black = paint(scene, "#26363e");
  const glass = paint(scene, "#376d82");
  const red = paint(scene, "#b52f37");
  function box(name: string, width: number, height: number, depth: number, x: number, y: number, z: number, material: typeof orange, parent = shell) {
    const mesh = CreateBox(name, { width, height, depth }, scene);
    mesh.parent = parent;
    mesh.position.set(x, y, z);
    mesh.material = material;
    shadows?.addShadowCaster(mesh);
  }
  box("chassis", 1.78, .47, 3.02, 0, 0, 0, orange);
  box("hood", 1.66, .18, 1.12, 0, .24, .85, orange);
  box("cab", 1.37, .6, 1.32, 0, .47, -.24, glass);
  box("roof", 1.46, .14, 1.44, 0, .8, -.24, orange);
  box("front bumper", 1.79, .17, .19, 0, -.16, 1.51, cream);
  box("rear bumper", 1.79, .17, .19, 0, -.16, -1.51, black);
  for (const side of [-1, 1]) {
    box("headlight", .34, .18, .08, side * .54, .15, 1.52, cream);
    box("tail light", .32, .18, .08, side * .54, .13, -1.52, red);
  }

  const accessories = {
    rally: new TransformNode("rally spoiler", scene),
    beach: new TransformNode("surfboard", scene),
    rocket: new TransformNode("rocket fins", scene),
  };
  for (const accessory of Object.values(accessories)) accessory.parent = shell;
  for (const x of [-.49, .49]) box("spoiler stand", .10, .28, .15, x, .38, -1.22, black, accessories.rally);
  box("spoiler wing", 1.49, .12, .40, 0, .53, -1.27, cream, accessories.rally);
  box("surfboard", .47, .09, 1.69, .08, .91, -.19, cream, accessories.beach);
  box("surfboard stripe", .12, .014, 1.60, .08, .96, -.19, orange, accessories.beach);
  for (const x of [-.71, .71]) {
    box("fin", .14, .35, .47, x, .38, -1.20, cream, accessories.rocket);
    box("jet outlet", .29, .21, .13, x, -.08, -1.56, glass, accessories.rocket);
  }

  let selectedLook: CarLook | undefined;
  function setLook(look: CarLook) {
    if (look === selectedLook) return;
    selectedLook = look;
    for (const key of Object.keys(looks) as CarLook[]) accessories[key].setEnabled(key === look);
    orange.diffuseColor.copyFrom(Color3.FromHexString(looks[look].color));
    cream.diffuseColor.copyFrom(Color3.FromHexString(looks[look].accent));
  }
  setLook("rally");

  const wheels: { pivot: TransformNode; spin: TransformNode }[] = [];
  for (const { x, z } of wheelMounts) {
    const pivot = new TransformNode("steering knuckle", scene);
    pivot.parent = root;
    pivot.position.set(x, axleHeight - restLength, z);
    const spin = new TransformNode("wheel axle", scene);
    spin.parent = pivot;
    for (const [name, diameter, width, material] of [["tire", .8, .34, black], ["hub", .46, .355, cream]] as const) {
      const mesh = CreateCylinder(name, { diameter, height: width, tessellation: 16 }, scene);
      mesh.rotation.z = Math.PI / 2;
      mesh.parent = spin;
      mesh.material = material;
      shadows?.addShadowCaster(mesh);
    }
    // An offset hub marker makes wheel rotation readable even at low speed.
    const marker = CreateBox("hub marker", { width: .02, height: .10, depth: .08 }, scene);
    marker.parent = spin;
    marker.position.set(Math.sign(x) * .181, .12, 0);
    marker.material = orange;
    wheels.push({ pivot, spin });
  }

  function animateBody(pitch: number, roll: number, braking: boolean) {
    shell.rotation.x = pitch;
    shell.rotation.z = roll;
    red.emissiveColor.set(braking ? .48 : .09, .015, .012);
  }

  return {
    root, setLook, wheels, animateBody,
    dispose() {
      root.dispose();
      for (const material of [orange, cream, black, glass, red]) material.dispose();
    },
  };
}
