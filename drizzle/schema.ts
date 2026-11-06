import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const products = mysqlTable(
  "products",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    priceCents: int("priceCents").notNull(),
    stock: int("stock").default(0),
    category: varchar("category", { length: 120 }),
    description: text("description"),
    imageUrl: text("imageUrl"),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    nameIdx: index("products_name_idx").on(table.name),
    activeIdx: index("products_active_idx").on(table.active),
  }),
);

export const clients = mysqlTable(
  "clients",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 180 }).notNull(),
    phone: varchar("phone", { length: 40 }).notNull(),
    phoneNormalized: varchar("phoneNormalized", { length: 30 }).notNull(),
    notes: text("notes"),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    phoneIdx: index("clients_phone_idx").on(table.phoneNormalized),
    nameIdx: index("clients_name_idx").on(table.name),
  }),
);

export const orders = mysqlTable(
  "orders",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 40 }).notNull().unique(),
    clientId: int("clientId").notNull(),
    totalCents: int("totalCents").notNull(),
    paidCents: int("paidCents").default(0).notNull(),
    status: mysqlEnum("status", [
      "pending",
      "partial",
      "paid",
      "overdue",
      "cancelled",
    ]).default("pending").notNull(),
    orderDate: timestamp("orderDate").defaultNow().notNull(),
    dueDate: timestamp("dueDate"),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    clientIdx: index("orders_client_idx").on(table.clientId),
    statusIdx: index("orders_status_idx").on(table.status),
    dateIdx: index("orders_date_idx").on(table.orderDate),
  }),
);

export const orderItems = mysqlTable(
  "order_items",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("orderId").notNull(),
    productId: int("productId").notNull(),
    quantity: int("quantity").notNull(),
    unitPriceCents: int("unitPriceCents").notNull(),
    totalCents: int("totalCents").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    orderIdx: index("order_items_order_idx").on(table.orderId),
    productIdx: index("order_items_product_idx").on(table.productId),
  }),
);

export const payments = mysqlTable(
  "payments",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("orderId").notNull(),
    amountCents: int("amountCents").notNull(),
    paidAt: timestamp("paidAt").defaultNow().notNull(),
    method: varchar("method", { length: 80 }),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    orderIdx: index("payments_order_idx").on(table.orderId),
  }),
);

export const chargeTemplates = mysqlTable("charge_templates", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  body: text("body").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const charges = mysqlTable(
  "charges",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("orderId").notNull(),
    clientId: int("clientId").notNull(),
    templateId: int("templateId"),
    message: text("message").notNull(),
    action: mysqlEnum("action", ["prepared", "whatsapp_opened", "manual_sent"]).default("prepared").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    orderIdx: index("charges_order_idx").on(table.orderId),
    clientIdx: index("charges_client_idx").on(table.clientId),
  }),
);

export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    actorUserId: int("actorUserId").notNull(),
    action: varchar("action", { length: 80 }).notNull(),
    entityType: varchar("entityType", { length: 80 }).notNull(),
    entityId: varchar("entityId", { length: 80 }).notNull(),
    metadata: text("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    entityIdx: index("audit_entity_idx").on(table.entityType, table.entityId),
    dateIdx: index("audit_date_idx").on(table.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// Central de Mensagens: destinos, lotes, lembretes, eventos e histórico de ações.
// Lembretes só notificam a administradora; "api_confirmed" só existiria com
// integração oficial (não implementada).
// ---------------------------------------------------------------------------

export const messageDestinations = mysqlTable("message_destinations", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  kind: varchar("kind", { length: 20 }).default("group").notNull(),
  description: text("description"),
  inviteUrl: text("inviteUrl"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const messageLots = mysqlTable(
  "message_lots",
  {
    id: int("id").autoincrement().primaryKey(),
    productId: int("productId").notNull(),
    name: varchar("name", { length: 160 }),
    goalPieces: int("goalPieces"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    productUnique: uniqueIndex("message_lots_product_unique").on(table.productId),
  }),
);

export const messageReminders = mysqlTable(
  "message_reminders",
  {
    id: int("id").autoincrement().primaryKey(),
    kind: varchar("kind", { length: 30 }).notNull(),
    title: varchar("title", { length: 120 }).notNull(),
    productId: int("productId"),
    destinationId: int("destinationId"),
    intervalMinutes: int("intervalMinutes").notNull(),
    anchorAt: timestamp("anchorAt").notNull(),
    nextDueAt: timestamp("nextDueAt"),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    pausedUntil: timestamp("pausedUntil"),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    quietStart: varchar("quietStart", { length: 5 }),
    quietEnd: varchar("quietEnd", { length: 5 }),
    lastAckAt: timestamp("lastAckAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    statusDueIdx: index("message_reminders_status_due_idx").on(table.status, table.nextDueAt),
  }),
);

export const messageReminderEvents = mysqlTable(
  "message_reminder_events",
  {
    id: int("id").autoincrement().primaryKey(),
    reminderId: int("reminderId").notNull(),
    eventKey: varchar("eventKey", { length: 120 }).notNull(),
    dueAt: timestamp("dueAt").notNull(),
    outcome: varchar("outcome", { length: 20 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    keyUnique: uniqueIndex("message_reminder_events_key_unique").on(table.eventKey),
    reminderIdx: index("message_reminder_events_reminder_idx").on(table.reminderId),
  }),
);

export const messageActions = mysqlTable(
  "message_actions",
  {
    id: int("id").autoincrement().primaryKey(),
    kind: varchar("kind", { length: 20 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    destinationType: varchar("destinationType", { length: 10 }).notNull(),
    destinationId: int("destinationId"),
    clientId: int("clientId"),
    orderId: int("orderId"),
    productId: int("productId"),
    reminderId: int("reminderId"),
    title: varchar("title", { length: 200 }).notNull(),
    message: text("message").notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 120 }).notNull(),
    statusLog: text("statusLog").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    keyUnique: uniqueIndex("message_actions_key_unique").on(table.idempotencyKey),
    orderIdx: index("message_actions_order_idx").on(table.orderId),
    dateIdx: index("message_actions_date_idx").on(table.updatedAt),
  }),
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Product = typeof products.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type ChargeTemplate = typeof chargeTemplates.$inferSelect;
export type Charge = typeof charges.$inferSelect;
