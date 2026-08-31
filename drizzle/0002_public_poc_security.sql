ALTER TABLE `multiplayer_rooms` ADD `join_secret_hash` text;
--> statement-breakpoint
CREATE TABLE `multiplayer_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
