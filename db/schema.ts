import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const multiplayerRooms = sqliteTable("multiplayer_rooms", {
  code: text("code").primaryKey(),
  hostToken: text("host_token").notNull(),
  guestToken: text("guest_token"),
  joinSecretHash: text("join_secret_hash"),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const multiplayerRateLimits = sqliteTable("multiplayer_rate_limits", {
  key: text("key").primaryKey(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull(),
});

export const multiplayerSignals = sqliteTable("multiplayer_signals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomCode: text("room_code").notNull(),
  sender: text("sender").notNull(),
  recipient: text("recipient").notNull(),
  payload: text("payload").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("idx_multiplayer_signals_recipient").on(table.roomCode, table.recipient, table.id)]);

export const multiplayerParticipants = sqliteTable("multiplayer_participants", {
  roomCode: text("room_code").notNull(),
  playerId: text("player_id").notNull(),
  token: text("token").notNull(),
  joinedAt: integer("joined_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.roomCode, table.playerId] }),
  uniqueIndex("idx_multiplayer_participants_token").on(table.roomCode, table.token),
]);
