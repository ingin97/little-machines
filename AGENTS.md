# Agent Guide

## Project overview

Little Machines is a Norwegian-language browser game for young children. It uses React, Vite, and Babylon.js.

- `app/`: game UI, 3D scenes, rules, controls, audio, and dormant multiplayer client
- `main.tsx` and `index.html`: static application entry point and document metadata
- `public/assets/`: shipped 3D models and generated audio
- `worker/`: optional WebRTC multiplayer signaling backend
- `drizzle/`: database migrations for the multiplayer backend
- `tests/`: Node test suite
- `scripts/generate-audio.mjs`: regenerates the local WAV effects

## Commands

Use Node.js 22.13+ and pnpm.

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm lint
```

Run `pnpm test` and `pnpm lint` after source changes.

## Development guidelines

- Keep the game playable with keyboard, touch, and gamepad/steering-wheel input.
- Preserve Norwegian UI text unless a task explicitly requests a language change.
- Keep third-party model provenance in `public/assets/models/LICENSES.md` when adding or replacing assets.
- Keep generated dependencies and build output out of Git; `.gitignore` covers them.
- Do not add credentials, deployment IDs, or environment files to the repository.

## Hosting

The game itself can be deployed to static hosting. Multiplayer is currently disabled in the game UI. Its dormant backend remains in `worker/` and requires deployment plus its database migrations before the UI can be restored; static hosting alone does not provide WebRTC signaling.
