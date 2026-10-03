CREATE TABLE `records` (
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	`expires_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`kind`, `id`)
);
