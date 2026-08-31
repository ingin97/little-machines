CREATE TABLE `multiplayer_participants` (
	`room_code` text NOT NULL,
	`player_id` text NOT NULL,
	`token` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`room_code`, `player_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_multiplayer_participants_token` ON `multiplayer_participants` (`room_code`,`token`);
