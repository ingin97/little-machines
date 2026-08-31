type Babylon = typeof import("@babylonjs/core");
type Scene = import("@babylonjs/core").Scene;
type AssetContainer = import("@babylonjs/core").AssetContainer;

type Placement = {
  name: string;
  position: [number, number, number];
  height: number;
  rotation?: number;
  animate?: boolean;
};

const MODEL_ROOT = "/assets/models/";

async function loadAsset(B: Babylon, scene: Scene, file: string) {
  await import("@babylonjs/loaders/glTF");
  return B.SceneLoader.LoadAssetContainerAsync(MODEL_ROOT, file, scene);
}

function placeAsset(B: Babylon, container: AssetContainer, scene: Scene, placement: Placement) {
  const copy = container.instantiateModelsToScene((sourceName) => `${placement.name}-${sourceName}`, false);
  const anchor = new B.TransformNode(placement.name, scene);
  copy.rootNodes.forEach((node) => { node.parent = anchor; });
  anchor.rotation.y = placement.rotation ?? 0;

  const meshes = anchor.getChildMeshes(false);
  meshes.forEach((mesh) => {
    mesh.checkCollisions = false;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
  });
  if (!meshes.length) return anchor;

  anchor.computeWorldMatrix(true);
  meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
  let bounds = anchor.getHierarchyBoundingVectors(true);
  const currentHeight = Math.max(bounds.max.y - bounds.min.y, .001);
  anchor.scaling.setAll(placement.height / currentHeight);
  anchor.computeWorldMatrix(true);
  meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
  bounds = anchor.getHierarchyBoundingVectors(true);
  const center = bounds.min.add(bounds.max).scale(.5);
  anchor.position.addInPlace(new B.Vector3(
    placement.position[0] - center.x,
    placement.position[1] - bounds.min.y,
    placement.position[2] - center.z,
  ));

  if (placement.animate) {
    const idle = copy.animationGroups.find((group) => group.name.toLowerCase().includes("idle")) ?? copy.animationGroups[0];
    copy.animationGroups.forEach((group) => group.stop());
    idle?.start(true);
  } else {
    copy.animationGroups.forEach((group) => group.stop());
    anchor.computeWorldMatrix(true);
    meshes.forEach((mesh) => {
      mesh.computeWorldMatrix(true);
      mesh.freezeWorldMatrix();
      mesh.material?.freeze();
    });
  }
  return anchor;
}

function mountainMaterial(B: Babylon, scene: Scene, name: string, color: string) {
  const material = new B.StandardMaterial(name, scene);
  material.diffuseColor = B.Color3.FromHexString(color);
  material.specularColor = B.Color3.Black();
  return material;
}

function addMountainRange(B: Babylon, scene: Scene, prefix: string, muted = false) {
  const stone = mountainMaterial(B, scene, `${prefix}-fjellmateriale`, muted ? "#77847b" : "#728c83");
  const distantStone = mountainMaterial(B, scene, `${prefix}-fjernt-fjellmateriale`, muted ? "#899188" : "#829b91");
  const mountains: Array<[number, number, number, number, number]> = [
    [-62, 54, 32, 25, .2], [-35, 61, 38, 31, -.25], [0, 68, 44, 36, .15],
    [38, 62, 36, 29, -.18], [67, 52, 31, 24, .3],
  ];
  mountains.forEach(([x, z, diameter, height, rotation], index) => {
    const mountain = B.MeshBuilder.CreateCylinder(`${prefix}-fjell-${index}`, {
      diameterTop: 0,
      diameterBottom: diameter,
      height,
      tessellation: 5,
    }, scene);
    mountain.position.set(x, height / 2 - .2, z);
    mountain.rotation.y = rotation;
    mountain.material = index % 2 ? distantStone : stone;
    mountain.isPickable = false;
    mountain.checkCollisions = false;
    mountain.freezeWorldMatrix();
  });
}

async function safeAsset(B: Babylon, scene: Scene, file: string) {
  try {
    return await loadAsset(B, scene, file);
  } catch (error) {
    console.warn(`Kunne ikke laste bakgrunnsmodellen ${file}.`, error);
    return null;
  }
}

export async function createFieldDecor(B: Babylon, scene: Scene) {
  addMountainRange(B, scene, "gård");
  const [barn, cow, sheep, trees, rocks] = await Promise.all([
    safeAsset(B, scene, "barn.glb"),
    safeAsset(B, scene, "cow.glb"),
    safeAsset(B, scene, "sheep.glb"),
    safeAsset(B, scene, "pine-trees.glb"),
    safeAsset(B, scene, "rocks.glb"),
  ]);

  if (barn) placeAsset(B, barn, scene, { name: "rød låve", position: [-47, 0, -8], height: 9.5, rotation: .55 });
  if (cow) placeAsset(B, cow, scene, { name: "ku ved gjerdet", position: [-42, 0, 10], height: 2.5, rotation: 1.1, animate: true });
  if (sheep) {
    placeAsset(B, sheep, scene, { name: "sau en", position: [-39, 0, 15], height: 1.7, rotation: -.6, animate: true });
    placeAsset(B, sheep, scene, { name: "sau to", position: [-44, 0, 17], height: 1.55, rotation: .35 });
  }
  if (trees) [
    [-50, -20, 10, .1], [-46, 26, 8.5, .7], [46, -22, 9.5, -.5], [48, 22, 11, .4], [24, 34, 8, -.2],
  ].forEach(([x, z, height, rotation], index) => placeAsset(B, trees, scene, {
    name: `gårdstrær ${index}`,
    position: [x, 0, z],
    height,
    rotation,
  }));
  if (rocks) [[-43, -24, 2.2], [43, 25, 2.5], [31, 32, 1.8]].forEach(([x, z, height], index) => placeAsset(B, rocks, scene, {
    name: `gårdsstein ${index}`,
    position: [x, 0, z],
    height,
    rotation: index * .8,
  }));
}

export async function createConstructionDecor(B: Babylon, scene: Scene) {
  addMountainRange(B, scene, "byggeplass", true);
  const [trees, rocks] = await Promise.all([
    safeAsset(B, scene, "pine-trees.glb"),
    safeAsset(B, scene, "rocks.glb"),
  ]);

  if (trees) [
    [-39, -23, 9, .2], [-39, 22, 10.5, -.6], [39, -22, 8.5, .7], [39, 23, 11, -.2], [25, 29, 8, .35],
  ].forEach(([x, z, height, rotation], index) => placeAsset(B, trees, scene, {
    name: `byggeplasstrær ${index}`,
    position: [x, 0, z],
    height,
    rotation,
  }));
  if (rocks) [
    [-37, -8, 3.4], [-36, 2, 2.6], [36, -9, 3], [37, 3, 2.2], [31, 27, 2.8],
  ].forEach(([x, z, height], index) => placeAsset(B, rocks, scene, {
    name: `steinblokk ${index}`,
    position: [x, 0, z],
    height,
    rotation: index * .65,
  }));
}

export function reportDecorError(area: string, error: unknown) {
  console.warn(`Kunne ikke gjøre ferdig ${area}. Spillet fortsetter uten deler av bakgrunnen.`, error);
}
