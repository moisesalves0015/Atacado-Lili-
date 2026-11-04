CREATE TABLE `message_actions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` varchar(20) NOT NULL,
	`status` varchar(20) NOT NULL,
	`destinationType` varchar(10) NOT NULL,
	`destinationId` int,
	`clientId` int,
	`orderId` int,
	`productId` int,
	`reminderId` int,
	`title` varchar(200) NOT NULL,
	`message` text NOT NULL,
	`idempotencyKey` varchar(120) NOT NULL,
	`statusLog` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `message_actions_id` PRIMARY KEY(`id`),
	CONSTRAINT `message_actions_key_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `message_destinations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(80) NOT NULL,
	`kind` varchar(20) NOT NULL DEFAULT 'group',
	`description` text,
	`inviteUrl` text,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `message_destinations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `message_lots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productId` int NOT NULL,
	`name` varchar(160),
	`goalPieces` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `message_lots_id` PRIMARY KEY(`id`),
	CONSTRAINT `message_lots_product_unique` UNIQUE(`productId`)
);
--> statement-breakpoint
CREATE TABLE `message_reminder_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reminderId` int NOT NULL,
	`eventKey` varchar(120) NOT NULL,
	`dueAt` timestamp NOT NULL,
	`outcome` varchar(20) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `message_reminder_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `message_reminder_events_key_unique` UNIQUE(`eventKey`)
);
--> statement-breakpoint
CREATE TABLE `message_reminders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` varchar(30) NOT NULL,
	`title` varchar(120) NOT NULL,
	`productId` int,
	`destinationId` int,
	`intervalMinutes` int NOT NULL,
	`anchorAt` timestamp NOT NULL,
	`nextDueAt` timestamp,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`pausedUntil` timestamp,
	`timezone` varchar(64) NOT NULL,
	`quietStart` varchar(5),
	`quietEnd` varchar(5),
	`lastAckAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `message_reminders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `message_actions_order_idx` ON `message_actions` (`orderId`);--> statement-breakpoint
CREATE INDEX `message_actions_date_idx` ON `message_actions` (`updatedAt`);--> statement-breakpoint
CREATE INDEX `message_reminder_events_reminder_idx` ON `message_reminder_events` (`reminderId`);--> statement-breakpoint
CREATE INDEX `message_reminders_status_due_idx` ON `message_reminders` (`status`,`nextDueAt`);