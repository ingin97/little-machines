/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

const ROOM_TTL_MS = 5 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PLAYERS = new Set(["host", "p2", "p3", "p4"]);

function randomText(length: number, alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function secure(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("content-security-policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self'; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function validSignal(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const signal = value as Record<string, unknown>;
  if ((signal.type === "offer" || signal.type === "answer") && typeof signal.sdp === "string") return signal.sdp.length <= 24_000;
  if (signal.candidate && typeof signal.candidate === "object") {
    const candidate = signal.candidate as Record<string, unknown>;
    return typeof candidate.candidate === "string" && candidate.candidate.length <= 4_096;
  }
  return false;
}

async function rateLimited(db: D1Database, request: Request, scope: string, limit: number, windowMs: number) {
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const key = await sha256(`${scope}:${ip.trim()}`), now = Date.now(), windowStart = now - windowMs;
  await db.prepare("INSERT INTO multiplayer_rate_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window_start = CASE WHEN window_start < ? THEN excluded.window_start ELSE window_start END, count = CASE WHEN window_start < ? THEN 1 ELSE count + 1 END")
    .bind(key, now, windowStart, windowStart).run();
  const row = await db.prepare("SELECT count FROM multiplayer_rate_limits WHERE key = ?").bind(key).first<{ count: number }>();
  return (row?.count ?? 0) > limit;
}

async function ensureMultiplayerSchema(db: D1Database) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS multiplayer_rooms (code TEXT PRIMARY KEY, host_token TEXT NOT NULL, guest_token TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS multiplayer_signals (id INTEGER PRIMARY KEY AUTOINCREMENT, room_code TEXT NOT NULL, sender TEXT NOT NULL, recipient TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_multiplayer_signals_recipient ON multiplayer_signals (room_code, recipient, id)"),
    db.prepare("CREATE TABLE IF NOT EXISTS multiplayer_participants (room_code TEXT NOT NULL, player_id TEXT NOT NULL, token TEXT NOT NULL, joined_at INTEGER NOT NULL, PRIMARY KEY (room_code, player_id))"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_multiplayer_participants_token ON multiplayer_participants (room_code, token)"),
    db.prepare("CREATE TABLE IF NOT EXISTS multiplayer_rate_limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL)"),
  ]);
  try { await db.prepare("ALTER TABLE multiplayer_rooms ADD COLUMN join_secret_hash TEXT").run(); } catch { /* Existing deployments already have the column. */ }
}

async function multiplayerApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env?.DB) return json({ error: "Multiplayer-databasen er ikke tilgjengelig" }, 503);
  const origin = request.headers.get("origin"), fetchSite = request.headers.get("sec-fetch-site");
  if ((origin && origin !== url.origin) || fetchSite === "cross-site") return json({ error: "Forespørselen ble avvist" }, 403);
  await ensureMultiplayerSchema(env.DB);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM multiplayer_signals WHERE created_at < ?").bind(now - ROOM_TTL_MS),
    env.DB.prepare("DELETE FROM multiplayer_rooms WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM multiplayer_participants WHERE room_code NOT IN (SELECT code FROM multiplayer_rooms)"),
    env.DB.prepare("DELETE FROM multiplayer_rate_limits WHERE window_start < ?").bind(now - 24 * 60 * 60 * 1000),
  ]);

  if (request.method === "POST" && url.pathname === "/api/multiplayer/rooms") {
    if (await rateLimited(env.DB, request, "create", 10, 10 * 60 * 1000)) return json({ error: "For mange nye rom. Prøv igjen senere." }, 429);
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = randomText(8, CODE_ALPHABET), token = randomText(32), inviteKey = randomText(24), joinSecretHash = await sha256(inviteKey);
      const result = await env.DB.prepare("INSERT OR IGNORE INTO multiplayer_rooms (code, host_token, join_secret_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
        .bind(code, token, joinSecretHash, now, now + ROOM_TTL_MS).run();
      if (result.meta.changes) {
        await env.DB.prepare("INSERT INTO multiplayer_participants (room_code, player_id, token, joined_at) VALUES (?, 'host', ?, ?)").bind(code, token, now).run();
        return json({ code, player: "host", playerId: "host", token, inviteKey, expiresAt: now + ROOM_TTL_MS }, 201);
      }
    }
    return json({ error: "Kunne ikke lage rom" }, 503);
  }

  const match = url.pathname.match(/^\/api\/multiplayer\/rooms\/([A-Z2-9]{8})(?:\/signals)?$/);
  if (!match) return json({ error: "Ikke funnet" }, 404);
  const code = match[1];
  const room = await env.DB.prepare("SELECT expires_at, join_secret_hash FROM multiplayer_rooms WHERE code = ?").bind(code).first<{ expires_at: number; join_secret_hash: string | null }>();
  if (!room || room.expires_at < now) return json({ error: "Rommet finnes ikke eller har utløpt" }, 404);

  if (request.method === "POST" && url.pathname.endsWith("/join")) return json({ error: "Ikke funnet" }, 404);
  if (request.method === "POST" && url.pathname === `/api/multiplayer/rooms/${code}`) {
    if (await rateLimited(env.DB, request, "join", 30, 10 * 60 * 1000)) return json({ error: "For mange forsøk. Prøv igjen senere." }, 429);
    const raw = await request.text();
    if (raw.length > 1_000) return json({ error: "Ugyldig invitasjon" }, 413);
    let inviteKey = "";
    try { inviteKey = (JSON.parse(raw) as { inviteKey?: unknown }).inviteKey as string; } catch { return json({ error: "Ugyldig invitasjon" }, 400); }
    if (typeof inviteKey !== "string" || inviteKey.length < 16 || await sha256(inviteKey) !== room.join_secret_hash) return json({ error: "Ugyldig invitasjonslenke" }, 403);
    for (const playerId of ["p2", "p3", "p4"]) {
      const token = randomText(32);
      const joined = await env.DB.prepare("INSERT OR IGNORE INTO multiplayer_participants (room_code, player_id, token, joined_at) VALUES (?, ?, ?, ?)").bind(code, playerId, token, now).run();
      if (joined.meta.changes) { await env.DB.prepare("UPDATE multiplayer_rooms SET expires_at = ? WHERE code = ?").bind(now + ROOM_TTL_MS, code).run(); return json({ code, player: "guest", playerId, token, expiresAt: now + ROOM_TTL_MS }); }
    }
    return json({ error: "Rommet er fullt" }, 409);
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const participant = token ? await env.DB.prepare("SELECT player_id FROM multiplayer_participants WHERE room_code = ? AND token = ?").bind(code, token).first<{ player_id: string }>() : null;
  if (!participant) return json({ error: "Ugyldig romtilgang" }, 401);
  const player = participant.player_id;

  if (url.pathname.endsWith("/signals") && request.method === "POST") {
    if (await rateLimited(env.DB, request, `signal-write:${token}`, 120, 60_000)) return json({ error: "For mange signaler" }, 429);
    const raw = await request.text();
    if (raw.length > 32_000) return json({ error: "Signalet er for stort" }, 413);
    let body: { recipient?: string; signal?: unknown };
    try { body = JSON.parse(raw) as typeof body; } catch { return json({ error: "Ugyldig signal" }, 400); }
    if (!body.recipient || !PLAYERS.has(body.recipient) || !validSignal(body.signal)) return json({ error: "Ugyldig signal" }, 400);
    const recipient = await env.DB.prepare("SELECT 1 AS ok FROM multiplayer_participants WHERE room_code = ? AND player_id = ?").bind(code, body.recipient).first();
    if (!recipient) return json({ error: "Mottakeren finnes ikke" }, 404);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO multiplayer_signals (room_code, sender, recipient, payload, created_at) VALUES (?, ?, ?, ?, ?)").bind(code, player, body.recipient, JSON.stringify(body.signal), now),
      env.DB.prepare("UPDATE multiplayer_rooms SET expires_at = ? WHERE code = ?").bind(now + ROOM_TTL_MS, code),
    ]);
    return json({ ok: true }, 202);
  }
  if (url.pathname.endsWith("/signals") && request.method === "GET") {
    if (await rateLimited(env.DB, request, `signal-read:${token}`, 300, 60_000)) return json({ error: "For mange forespørsler" }, 429);
    const after = Math.max(0, Number(url.searchParams.get("after")) || 0);
    const rows = await env.DB.prepare("SELECT id, sender, payload FROM multiplayer_signals WHERE room_code = ? AND recipient = ? AND id > ? ORDER BY id LIMIT 100")
      .bind(code, player, after).all<{ id: number; sender: string; payload: string }>();
    return json({ signals: rows.results.map((row) => ({ id: row.id, sender: row.sender, payload: JSON.parse(row.payload) })) });
  }
  return json({ error: "Ikke funnet" }, 404);
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/multiplayer/")) {
      return secure(await multiplayerApi(request, env, url));
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return secure(await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths));
    }

    return secure(await handler.fetch(request, env, ctx));
  },
};

export default worker;
