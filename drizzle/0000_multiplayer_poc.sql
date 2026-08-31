CREATE TABLE `multiplayer_rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`host_token` text NOT NULL,
	`guest_token` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `multiplayer_signals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_code` text NOT NULL,
	`sender` text NOT NULL,
	`recipient` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_multiplayer_signals_recipient` ON `multiplayer_signals` (`room_code`,`recipient`,`id`);
