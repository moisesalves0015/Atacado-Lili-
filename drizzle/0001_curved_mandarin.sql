CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actorUserId` int NOT NULL,
	`action` varchar(80) NOT NULL,
	`entityType` varchar(80) NOT NULL,
	`entityId` varchar(80) NOT NULL,
	`metadata` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `charge_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`body` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `charge_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `charge_templates_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `charges` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`clientId` int NOT NULL,
	`templateId` int,
	`message` text NOT NULL,
	`action` enum('prepared','whatsapp_opened','manual_sent') NOT NULL DEFAULT 'prepared',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `charges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(180) NOT NULL,
	`phone` varchar(40) NOT NULL,
	`phoneNormalized` varchar(30) NOT NULL,
	`notes` text,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `clients_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`productId` int NOT NULL,
	`quantity` int NOT NULL,
	`unitPriceCents` int NOT NULL,
	`totalCents` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(40) NOT NULL,
	`clientId` int NOT NULL,
	`totalCents` int NOT NULL,
	`paidCents` int NOT NULL DEFAULT 0,
	`status` enum('pending','partial','paid','overdue','cancelled') NOT NULL DEFAULT 'pending',
	`orderDate` timestamp NOT NULL DEFAULT (now()),
	`dueDate` timestamp,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`amountCents` int NOT NULL,
	`paidAt` timestamp NOT NULL DEFAULT (now()),
	`method` varchar(80),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`priceCents` int NOT NULL,
	`category` varchar(120),
	`description` text,
	`imageUrl` text,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_logs` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `audit_date_idx` ON `audit_logs` (`createdAt`);--> statement-breakpoint
CREATE INDEX `charges_order_idx` ON `charges` (`orderId`);--> statement-breakpoint
CREATE INDEX `charges_client_idx` ON `charges` (`clientId`);--> statement-breakpoint
CREATE INDEX `clients_phone_idx` ON `clients` (`phoneNormalized`);--> statement-breakpoint
CREATE INDEX `clients_name_idx` ON `clients` (`name`);--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`orderId`);--> statement-breakpoint
CREATE INDEX `order_items_product_idx` ON `order_items` (`productId`);--> statement-breakpoint
CREATE INDEX `orders_client_idx` ON `orders` (`clientId`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `orders_date_idx` ON `orders` (`orderDate`);--> statement-breakpoint
CREATE INDEX `payments_order_idx` ON `payments` (`orderId`);--> statement-breakpoint
CREATE INDEX `products_name_idx` ON `products` (`name`);--> statement-breakpoint
CREATE INDEX `products_active_idx` ON `products` (`active`);