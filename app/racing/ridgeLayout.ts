import { arcRows, smoothProfile, straightRows, type SurfaceRow } from "./surfaces.ts";

export const ridgeSpawn = { x: -145, y: 16.84, z: -125, heading: 0 };

export function buildRidgeLayout() {
  const rows: SurfaceRow[] = [{ ...ridgeSpawn, z: -137, y: 16, halfWidth: 5.5 }];
  const corners: SurfaceRow[][] = [];
  const gates: SurfaceRow[] = [];

  function straight(profile: [number, number][], gateAt: number[]) {
    const start = rows.at(-1)!;
    const samples = smoothProfile([[0, start.y], ...profile], 2).slice(1);
    rows.push(...straightRows(start.x, start.z, start.heading, start.halfWidth, samples));
    gates.push(...straightRows(start.x, start.z, start.heading, start.halfWidth,
      profile.filter(([distance]) => gateAt.includes(distance))));
  }

  function turn(radius: number, direction: number) {
    const corner = arcRows(rows.at(-1)!, radius, direction * Math.PI / 2, -direction * 1.45);
    corners.push(corner);
    rows.push(...corner.slice(1));
  }

  straight([[23, 16], [54, 22], [102, 8], [116, 8]], [102]);
  turn(30, 1);
  straight([[12, 8], [72, 24], [94, 24]], [12, 72]);
  turn(26, -1);
  straight([[14, 24], [38, 30], [78, 17], [88, 17]], [14, 78]);
  turn(25, 1);
  straight([[13, 17], [74, 5], [91, 5]], [13, 74]);
  turn(30, 1);
  straight([[14, 5], [52, 18], [103, 7], [116, 7]], [14, 103]);
  turn(25, -1);
  straight([[18, 7]], []);
  turn(22, 1);
  straight([[13, 7], [46, 3], [64, 3]], [13, 46]);

  return { rows, gates, corners };
}
