# Building a Kjøreparken world

Copy [Sommerlia](sommerlia.json) to a new JSON file in this directory and change its `id` and `name`. The world picker discovers these files at build time. Open `/racing.html?world=<id>` to drive it.

```sh
pnpm world:validate
pnpm world:validate app/racing/worlds/sommerlia.json
pnpm world:validate --seed alpine "Fjell og fjord"
pnpm test
pnpm lint
```

Validation prints the world identity and SHA-256 hash or reports the location of invalid geometry and fields. Use unique lowercase IDs and finite coordinates. Units are meters and radians. The origin is in the middle of the map, Y points up, and a spawn heading of zero points along +Z.

## Definition version 1

| Field | How to use it |
| --- | --- |
| `version`, `id`, `name` | Set version to 1. Use a stable ID and a short Norwegian display name. Leave `generation` out of authored files. |
| `terrain` | Set `halfExtent` (40–240), `relief` (0–60), `phase` (0–7), `flatRadius` (0–140) and a base `surface`. The optional `shape: "canyon"` cuts a valley across the map. |
| `terrain.zones` | Add up to 16 circular surface zones with `x`, `z`, `radius` (2–80), and `surface`. Earlier zones take priority where they overlap. |
| `junctions` | Give each road connection or dead end a unique `id` and `position` with `x`, `y`, and `z`. All junctions must be reachable via the road graph. |
| `roads` | Up to 24 roads, each with an `id`, `from` and `to` junction IDs, `surface` and 2–32 `knots`. Use `structure: "ramp"` to leave terrain below an optional jump. |
| `bridges` | Reference a road by its `road` ID. An `x`, `z`, and `radius` circle (6–50) selects an elevated span and carves clearance underneath. |
| `tunnels` | Place a straight north–south tunnel over an existing road. Use `x`, `y`, `z`, `length`, `width` and `height`. The road needs at least 3.5 m of headroom. |
| `attractions` | Give `football` and `bowling` level positions near a road. A football pitch extends 23 m south of its goal. Bowling pins extend 4 m west. Put each of 1–24 `stars` around 1.35 m above a drivable surface. |
| `landmarks` | Place a `peak`, `arch` or `tower` using `kind`, `x`, `z` and `height`. The world places it on the terrain. Keep it away from traffic unless you intend players to drive through an arch. |
| `scenery` | Optionally place up to 48 decorative props with `x`, `z`, `scale` (0.4–3) and `kind` (`pine`, `cactus` or `rock`). The renderer skips props too close to a road. |
| `spawn` | Place the car about 0.87 m above a flat, wide road using `x`, `y`, `z`, and `heading`. Keep the spawn and the space immediately ahead clear. |

## Road recipes

A knot has a `position`, a `tangent`, a `halfWidth` (2–14 m), and optional `bank` (±0.55 rad) and `crown` (0–5 m). Tangents describe the derivative per meter of knot-to-knot chord distance. A horizontal tangent normally has a length near one. Use its Y component to enter or leave a slope. Positive bank raises the right side. The sampler interpolates width and banking between knots and carries the 3D road frame along the curve.

| Feature | Recipe |
| --- | --- |
| Straight | Use two knots with equal elevation and tangents parallel to the line between them. |
| Curve or banked curve | Add a knot near the middle of the turn and aim each tangent along the curve. Add bank at the middle and return to zero at flat junctions. |
| Hill, valley, or downhill | Set the elevation of successive knots and use zero vertical tangent at a crest or trough. Use broad slopes, with a maximum sampled grade of 48%. |
| Spiral | Place knots every 30–45 degrees around a center, aim tangents around the circle, and change height each time. Leave plenty of room between turns and avoid stacking routes at the same height. |
| Bridge or tunnel | Use the respective feature list over a road with gradually sloped approaches. Leave an off-road path into the valley or through the portal. |
| Ramp | Branch from a flat junction, increase height and pitch toward the lip, and leave room to land on terrain. Keep a route around it. |
| Intersection | Give roads the same endpoint junction. Keep corners of the intersection flat and wide. For straight-through connections match width, grade and bank on both sides. |
| Halfpipe | Set `crown` on the middle knots to raise both outer edges. Set zero crown at both ends for flat entrances. |

The available surfaces are `asphalt` (high grip), `grass` (softer handling), `sand` (loose), `mud` (higher resistance), `ice` (long braking and sliding), and `magnetic` (increased adhesion). Use separate connected road segments for material changes. The wheels blend handling as they encounter the new surface.

Keep the easiest route wide and visible from the spawn. Drive every junction and approach, then verify the optional jumps, toys, and off-road areas in toddler and normal modes. The validator checks sampled geometry and reachable locations. Playtesting establishes whether a route is fun and forgiving.

Share a procedural world as `?world=alpine&seed=2026&v=1`. Authored worlds use `?world=<id>`. Tabs match on identity and canonical definition hash. Bump the generator version if a change would alter previously shared seed worlds, and retain the earlier generator while its links need to remain playable.
