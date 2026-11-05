// server/_core/app.ts
import "dotenv/config";
import crypto from "node:crypto";
import fs2 from "node:fs";
import os2 from "node:os";
import path2 from "node:path";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "webdev_app_session";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
var OAUTH_STATE_COOKIE = "__Host-oauth_state";
var decodeOAuthState = (state) => {
  let decoded;
  try {
    decoded = atob(state);
  } catch {
    return { redirectUri: "" };
  }
  try {
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.redirectUri === "string") return parsed;
  } catch {
  }
  return { redirectUri: decoded };
};

// server/_core/oauth.ts
import { parse as parseCookieHeader2 } from "cookie";

// server/db.ts
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { nanoid } from "nanoid";

// drizzle/schema.ts
import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var products = mysqlTable(
  "products",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    priceCents: int("priceCents").notNull(),
    category: varchar("category", { length: 120 }),
    description: text("description"),
    imageUrl: text("imageUrl"),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
  },
  (table) => ({
    nameIdx: index("products_name_idx").on(table.name),
    activeIdx: index("products_active_idx").on(table.active)
  })
);
var clients = mysqlTable(
  "clients",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 180 }).notNull(),
    phone: varchar("phone", { length: 40 }).notNull(),
    phoneNormalized: varchar("phoneNormalized", { length: 30 }).notNull(),
    notes: text("notes"),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
  },
  (table) => ({
    phoneIdx: index("clients_phone_idx").on(table.phoneNormalized),
    nameIdx: index("clients_name_idx").on(table.name)
  })
);
var orders = mysqlTable(
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
      "cancelled"
    ]).default("pending").notNull(),
    orderDate: timestamp("orderDate").defaultNow().notNull(),
    dueDate: timestamp("dueDate"),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
  },
  (table) => ({
    clientIdx: index("orders_client_idx").on(table.clientId),
    statusIdx: index("orders_status_idx").on(table.status),
    dateIdx: index("orders_date_idx").on(table.orderDate)
  })
);
var orderItems = mysqlTable(
  "order_items",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("orderId").notNull(),
    productId: int("productId").notNull(),
    quantity: int("quantity").notNull(),
    unitPriceCents: int("unitPriceCents").notNull(),
    totalCents: int("totalCents").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull()
  },
  (table) => ({
    orderIdx: index("order_items_order_idx").on(table.orderId),
    productIdx: index("order_items_product_idx").on(table.productId)
  })
);
var payments = mysqlTable(
  "payments",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("orderId").notNull(),
    amountCents: int("amountCents").notNull(),
    paidAt: timestamp("paidAt").defaultNow().notNull(),
    method: varchar("method", { length: 80 }),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull()
  },
  (table) => ({
    orderIdx: index("payments_order_idx").on(table.orderId)
  })
);
var chargeTemplates = mysqlTable("charge_templates", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  body: text("body").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var charges = mysqlTable(
  "charges",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("orderId").notNull(),
    clientId: int("clientId").notNull(),
    templateId: int("templateId"),
    message: text("message").notNull(),
    action: mysqlEnum("action", ["prepared", "whatsapp_opened", "manual_sent"]).default("prepared").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull()
  },
  (table) => ({
    orderIdx: index("charges_order_idx").on(table.orderId),
    clientIdx: index("charges_client_idx").on(table.clientId)
  })
);
var auditLogs = mysqlTable(
  "audit_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    actorUserId: int("actorUserId").notNull(),
    action: varchar("action", { length: 80 }).notNull(),
    entityType: varchar("entityType", { length: 80 }).notNull(),
    entityId: varchar("entityId", { length: 80 }).notNull(),
    metadata: text("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull()
  },
  (table) => ({
    entityIdx: index("audit_entity_idx").on(table.entityType, table.entityId),
    dateIdx: index("audit_date_idx").on(table.createdAt)
  })
);
var messageDestinations = mysqlTable("message_destinations", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  kind: varchar("kind", { length: 20 }).default("group").notNull(),
  description: text("description"),
  inviteUrl: text("inviteUrl"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var messageLots = mysqlTable(
  "message_lots",
  {
    id: int("id").autoincrement().primaryKey(),
    productId: int("productId").notNull(),
    name: varchar("name", { length: 160 }),
    goalPieces: int("goalPieces"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
  },
  (table) => ({
    productUnique: uniqueIndex("message_lots_product_unique").on(table.productId)
  })
);
var messageReminders = mysqlTable(
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
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
  },
  (table) => ({
    statusDueIdx: index("message_reminders_status_due_idx").on(table.status, table.nextDueAt)
  })
);
var messageReminderEvents = mysqlTable(
  "message_reminder_events",
  {
    id: int("id").autoincrement().primaryKey(),
    reminderId: int("reminderId").notNull(),
    eventKey: varchar("eventKey", { length: 120 }).notNull(),
    dueAt: timestamp("dueAt").notNull(),
    outcome: varchar("outcome", { length: 20 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull()
  },
  (table) => ({
    keyUnique: uniqueIndex("message_reminder_events_key_unique").on(table.eventKey),
    reminderIdx: index("message_reminder_events_reminder_idx").on(table.reminderId)
  })
);
var messageActions = mysqlTable(
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
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
  },
  (table) => ({
    keyUnique: uniqueIndex("message_actions_key_unique").on(table.idempotencyKey),
    orderIdx: index("message_actions_order_idx").on(table.orderId),
    dateIdx: index("message_actions_date_idx").on(table.updatedAt)
  })
);

// server/_core/env.ts
var ENV = {
  get appId() {
    return process.env.MANUS_PROJECT_ID || "vendaatacado-local";
  },
  get cookieSecret() {
    return process.env.MANUS_JWT_SECRET || "vendaatacado-local-jwt-secret-key-2026";
  },
  get databaseUrl() {
    return process.env.DATABASE_URL ?? "";
  },
  get oAuthServerUrl() {
    return process.env.MANUS_OAUTH_API_URL ?? "";
  },
  // Preserve the legacy hint when supplied; otherwise roles remain application data.
  get ownerOpenId() {
    return process.env.OWNER_OPEN_ID ?? "";
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
  get forgeApiUrl() {
    return process.env.MANUS_API_URL ?? "";
  },
  get forgeApiKey() {
    return process.env.MANUS_API_KEY ?? "";
  },
  get adminUser() {
    return process.env.ADMIN_USER || "admin";
  },
  get adminPassword() {
    return process.env.ADMIN_PASSWORD || "1234";
  }
};

// server/firebaseStore.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
var FIREBASE_PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || "atacadolili";
var FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY || "AIzaSyAIiafsVQkawBZrHVHDvoiZ72eTH0Cfb_U";
var FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/vendaatacado`;
var BUNDLED_DATA_DIR = path.resolve(process.cwd(), "data");
var BUNDLED_DATA_FILE = path.join(BUNDLED_DATA_DIR, "db.json");
var BUNDLED_UPLOADS_DIR = path.join(BUNDLED_DATA_DIR, "uploads");
var DATA_DIR = process.env.VERCEL ? path.join(os.tmpdir(), "vendaatacado-data") : BUNDLED_DATA_DIR;
var DATA_FILE = path.join(DATA_DIR, "db.json");
var PRODUCT_CHUNK_SIZE = 1;
var CLIENT_CHUNK_SIZE = 600;
var storeCache = null;
var localUpdatedAt = 0;
var lastCloudCheckAt = 0;
var activeSyncPromise = null;
var mutationVersion = 0;
var uploadedChunkJson = /* @__PURE__ */ new Map();
function nextMonotonicTimestamp(current) {
  return Math.max(Date.now(), (current ?? 0) + 1, localUpdatedAt + 1);
}
function embedLocalProductImages(data) {
  let changed = false;
  for (const product of data.products) {
    if (product.imageUrl && product.imageUrl.startsWith("/uploads/")) {
      const fileName = product.imageUrl.replace("/uploads/", "");
      const candidatePath = path.join(BUNDLED_UPLOADS_DIR, fileName);
      try {
        if (fs.existsSync(candidatePath)) {
          const ext = path.extname(fileName).toLowerCase().replace(".", "") || "jpeg";
          const mime = ext === "jpg" ? "jpeg" : ext;
          const b64 = fs.readFileSync(candidatePath).toString("base64");
          product.imageUrl = `data:image/${mime};base64,${b64}`;
          changed = true;
        }
      } catch {
      }
    }
  }
  return changed;
}
function reviveDates(raw) {
  const toDate = (v) => v ? new Date(v) : /* @__PURE__ */ new Date();
  const toNullableDate = (v) => v ? new Date(v) : null;
  const data = {
    updatedAt: typeof raw?.updatedAt === "number" ? raw.updatedAt : 0,
    counters: {
      products: raw?.counters?.products ?? 0,
      clients: raw?.counters?.clients ?? 0,
      orders: raw?.counters?.orders ?? 0,
      orderItems: raw?.counters?.orderItems ?? 0,
      payments: raw?.counters?.payments ?? 0,
      chargeTemplates: raw?.counters?.chargeTemplates ?? 0,
      charges: raw?.counters?.charges ?? 0,
      auditLogs: raw?.counters?.auditLogs ?? 0,
      messageDestinations: raw?.counters?.messageDestinations ?? 0,
      messageLots: raw?.counters?.messageLots ?? 0,
      messageReminders: raw?.counters?.messageReminders ?? 0,
      reminderEvents: raw?.counters?.reminderEvents ?? 0,
      messageActions: raw?.counters?.messageActions ?? 0
    },
    messageDestinations: (raw?.messageDestinations ?? []).map((d) => ({ ...d, createdAt: toDate(d.createdAt), updatedAt: toDate(d.updatedAt) })),
    messageLots: (raw?.messageLots ?? []).map((l) => ({ ...l, createdAt: toDate(l.createdAt), updatedAt: toDate(l.updatedAt) })),
    messageReminders: (raw?.messageReminders ?? []).map((r) => ({
      ...r,
      anchorAt: toDate(r.anchorAt),
      nextDueAt: toNullableDate(r.nextDueAt),
      pausedUntil: toNullableDate(r.pausedUntil),
      lastAckAt: toNullableDate(r.lastAckAt),
      createdAt: toDate(r.createdAt),
      updatedAt: toDate(r.updatedAt)
    })),
    reminderEvents: (raw?.reminderEvents ?? []).map((e) => ({ ...e, dueAt: toDate(e.dueAt), createdAt: toDate(e.createdAt) })),
    messageActions: (raw?.messageActions ?? []).map((a) => ({ ...a, createdAt: toDate(a.createdAt), updatedAt: toDate(a.updatedAt) })),
    products: (raw?.products ?? []).map((p) => ({
      ...p,
      createdAt: toDate(p.createdAt),
      updatedAt: toDate(p.updatedAt)
    })),
    clients: (raw?.clients ?? []).map((c) => ({
      ...c,
      createdAt: toDate(c.createdAt),
      updatedAt: toDate(c.updatedAt)
    })),
    orders: (raw?.orders ?? []).map((o) => ({
      ...o,
      orderDate: toDate(o.orderDate),
      dueDate: toNullableDate(o.dueDate),
      createdAt: toDate(o.createdAt),
      updatedAt: toDate(o.updatedAt)
    })),
    orderItems: (raw?.orderItems ?? []).map((i) => ({
      ...i,
      createdAt: toDate(i.createdAt)
    })),
    payments: (raw?.payments ?? []).map((p) => ({
      ...p,
      paidAt: toDate(p.paidAt),
      createdAt: toDate(p.createdAt)
    })),
    chargeTemplates: (raw?.chargeTemplates ?? []).map((t2) => ({
      ...t2,
      createdAt: toDate(t2.createdAt),
      updatedAt: toDate(t2.updatedAt)
    })),
    charges: (raw?.charges ?? []).map((c) => ({
      ...c,
      createdAt: toDate(c.createdAt)
    })),
    auditLogs: (raw?.auditLogs ?? []).map((a) => ({
      ...a,
      createdAt: toDate(a.createdAt)
    }))
  };
  if (embedLocalProductImages(data) && !process.env.VERCEL) {
    writeDisk(data);
  }
  return data;
}
function mergeStores(base, incoming) {
  let changed = false;
  const productMap = /* @__PURE__ */ new Map();
  for (const p of base.products) productMap.set(p.id, p);
  for (const p of incoming.products) {
    const existing = productMap.get(p.id);
    if (!existing) {
      productMap.set(p.id, p);
      changed = true;
    } else if (p.updatedAt.getTime() > existing.updatedAt.getTime() || !existing.imageUrl && p.imageUrl || p.active !== existing.active || p.name !== existing.name || p.priceCents !== existing.priceCents) {
      if (p.updatedAt.getTime() >= existing.updatedAt.getTime()) {
        productMap.set(p.id, p);
        changed = true;
      }
    }
  }
  const clientMap = /* @__PURE__ */ new Map();
  const phoneSet = /* @__PURE__ */ new Set();
  for (const c of base.clients) {
    clientMap.set(c.id, c);
    if (c.phoneNormalized) phoneSet.add(c.phoneNormalized);
  }
  for (const c of incoming.clients) {
    const existing = clientMap.get(c.id);
    if (!existing && (!c.phoneNormalized || !phoneSet.has(c.phoneNormalized))) {
      clientMap.set(c.id, c);
      if (c.phoneNormalized) phoneSet.add(c.phoneNormalized);
      changed = true;
    } else if (existing && c.updatedAt.getTime() > existing.updatedAt.getTime()) {
      clientMap.set(c.id, c);
      changed = true;
    }
  }
  const orderMap = /* @__PURE__ */ new Map();
  for (const o of base.orders) orderMap.set(o.id, o);
  for (const o of incoming.orders) {
    const existing = orderMap.get(o.id);
    if (!existing) {
      orderMap.set(o.id, o);
      changed = true;
    } else if (o.updatedAt.getTime() > existing.updatedAt.getTime() || o.paidCents > existing.paidCents || o.status === "cancelled" && existing.status !== "cancelled") {
      orderMap.set(o.id, o);
      changed = true;
    }
  }
  const itemMap = /* @__PURE__ */ new Map();
  for (const i of base.orderItems) itemMap.set(i.id, i);
  for (const i of incoming.orderItems) {
    if (!itemMap.has(i.id)) {
      itemMap.set(i.id, i);
      changed = true;
    }
  }
  const paymentMap = /* @__PURE__ */ new Map();
  for (const p of base.payments) paymentMap.set(p.id, p);
  for (const p of incoming.payments) {
    if (!paymentMap.has(p.id)) {
      paymentMap.set(p.id, p);
      changed = true;
    }
  }
  const tplMap = /* @__PURE__ */ new Map();
  for (const t2 of base.chargeTemplates) tplMap.set(t2.id, t2);
  for (const t2 of incoming.chargeTemplates) {
    const existing = tplMap.get(t2.id);
    if (!existing || t2.updatedAt.getTime() > existing.updatedAt.getTime()) {
      tplMap.set(t2.id, t2);
      if (!existing) changed = true;
    }
  }
  const chargeMap = /* @__PURE__ */ new Map();
  for (const c of base.charges) chargeMap.set(c.id, c);
  for (const c of incoming.charges) {
    if (!chargeMap.has(c.id)) {
      chargeMap.set(c.id, c);
      changed = true;
    }
  }
  const auditMap = /* @__PURE__ */ new Map();
  for (const a of base.auditLogs) auditMap.set(a.id, a);
  for (const a of incoming.auditLogs) {
    if (!auditMap.has(a.id)) {
      auditMap.set(a.id, a);
    }
  }
  const mergeById = (left, right, keyOf = (item) => item.id) => {
    const map = /* @__PURE__ */ new Map();
    for (const item of left) map.set(keyOf(item), item);
    for (const item of right) {
      const existing = map.get(keyOf(item));
      if (!existing) {
        map.set(keyOf(item), item);
        changed = true;
      } else if (item.updatedAt.getTime() > existing.updatedAt.getTime()) {
        map.set(keyOf(item), item);
        changed = true;
      }
    }
    return Array.from(map.values()).sort((a, b) => a.id - b.id);
  };
  const messageDestinations2 = mergeById(base.messageDestinations, incoming.messageDestinations);
  const messageLots2 = mergeById(base.messageLots, incoming.messageLots);
  const messageReminders2 = mergeById(base.messageReminders, incoming.messageReminders);
  const messageActions2 = mergeById(base.messageActions, incoming.messageActions, (action) => action.idempotencyKey);
  const reminderEvents = mergeById(
    base.reminderEvents.map((event) => ({ ...event, updatedAt: event.createdAt })),
    incoming.reminderEvents.map((event) => ({ ...event, updatedAt: event.createdAt })),
    (event) => event.key
  ).map(({ updatedAt: _ignored, ...event }) => event);
  const products2 = Array.from(productMap.values()).sort((a, b) => a.id - b.id);
  const clients2 = Array.from(clientMap.values()).sort((a, b) => a.id - b.id);
  const orders2 = Array.from(orderMap.values()).sort((a, b) => b.id - a.id);
  const orderItems2 = Array.from(itemMap.values());
  const payments2 = Array.from(paymentMap.values());
  const chargeTemplates2 = Array.from(tplMap.values()).sort((a, b) => a.id - b.id);
  const charges2 = Array.from(chargeMap.values()).sort((a, b) => b.id - a.id);
  const auditLogs2 = Array.from(auditMap.values()).sort((a, b) => b.id - a.id).slice(0, 100);
  const merged = {
    updatedAt: Math.max(base.updatedAt ?? 0, incoming.updatedAt ?? 0),
    counters: {
      products: Math.max(base.counters.products, incoming.counters.products, ...products2.map((p) => p.id), 0),
      clients: Math.max(base.counters.clients, incoming.counters.clients, ...clients2.map((c) => c.id), 0),
      orders: Math.max(base.counters.orders, incoming.counters.orders, ...orders2.map((o) => o.id), 0),
      orderItems: Math.max(base.counters.orderItems, incoming.counters.orderItems, ...orderItems2.map((i) => i.id), 0),
      payments: Math.max(base.counters.payments, incoming.counters.payments, ...payments2.map((p) => p.id), 0),
      chargeTemplates: Math.max(base.counters.chargeTemplates, incoming.counters.chargeTemplates, ...chargeTemplates2.map((t2) => t2.id), 0),
      charges: Math.max(base.counters.charges, incoming.counters.charges, ...charges2.map((c) => c.id), 0),
      auditLogs: Math.max(base.counters.auditLogs, incoming.counters.auditLogs, ...auditLogs2.map((a) => a.id), 0),
      messageDestinations: Math.max(base.counters.messageDestinations, incoming.counters.messageDestinations, ...messageDestinations2.map((d) => d.id), 0),
      messageLots: Math.max(base.counters.messageLots, incoming.counters.messageLots, ...messageLots2.map((l) => l.id), 0),
      messageReminders: Math.max(base.counters.messageReminders, incoming.counters.messageReminders, ...messageReminders2.map((r) => r.id), 0),
      reminderEvents: Math.max(base.counters.reminderEvents, incoming.counters.reminderEvents, ...reminderEvents.map((e) => e.id), 0),
      messageActions: Math.max(base.counters.messageActions, incoming.counters.messageActions, ...messageActions2.map((a) => a.id), 0)
    },
    messageDestinations: messageDestinations2,
    messageLots: messageLots2,
    messageReminders: messageReminders2,
    reminderEvents,
    messageActions: messageActions2,
    products: products2,
    clients: clients2,
    orders: orders2,
    orderItems: orderItems2,
    payments: payments2,
    chargeTemplates: chargeTemplates2,
    charges: charges2,
    auditLogs: auditLogs2
  };
  return { merged, changed };
}
function createEmptyStore() {
  return {
    updatedAt: 0,
    counters: {
      products: 0,
      clients: 0,
      orders: 0,
      orderItems: 0,
      payments: 0,
      chargeTemplates: 0,
      charges: 0,
      auditLogs: 0,
      messageDestinations: 0,
      messageLots: 0,
      messageReminders: 0,
      reminderEvents: 0,
      messageActions: 0
    },
    messageDestinations: [],
    messageLots: [],
    messageReminders: [],
    reminderEvents: [],
    messageActions: [],
    products: [],
    clients: [],
    orders: [],
    orderItems: [],
    payments: [],
    chargeTemplates: [],
    charges: [],
    auditLogs: []
  };
}
function getStore() {
  if (!storeCache) {
    storeCache = createEmptyStore();
    try {
      if (fs.existsSync(DATA_FILE)) {
        const diskData = reviveDates(JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")));
        storeCache = mergeStores(storeCache, diskData).merged;
      } else if (fs.existsSync(BUNDLED_DATA_FILE)) {
        const bundledData = reviveDates(JSON.parse(fs.readFileSync(BUNDLED_DATA_FILE, "utf-8")));
        storeCache = mergeStores(storeCache, bundledData).merged;
      }
    } catch {
    }
    localUpdatedAt = storeCache.updatedAt ?? 0;
  }
  return storeCache;
}
async function ensureStoreLoaded() {
  const store = getStore();
  const now = Date.now();
  if (now - lastCloudCheckAt < 2500 && !activeSyncPromise) {
    return storeCache ?? store;
  }
  if (!activeSyncPromise) {
    lastCloudCheckAt = now;
    activeSyncPromise = syncWithFirestore().finally(() => {
      activeSyncPromise = null;
    });
  }
  await activeSyncPromise;
  return storeCache ?? store;
}
function getFirestoreHeaders(contentType) {
  const headers = {};
  if (contentType) headers["Content-Type"] = contentType;
  if (process.env.FIREBASE_AUTH_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.FIREBASE_AUTH_TOKEN}`;
  }
  return headers;
}
async function firestoreGetDoc(docId, timeoutMs = 6e3) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${FIRESTORE_BASE_URL}/${docId}?key=${FIREBASE_API_KEY}`, {
        method: "GET",
        headers: getFirestoreHeaders(),
        signal: controller.signal
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        if (attempt === 0) continue;
        return null;
      }
      const data = await res.json();
      const fields = data?.fields;
      if (!fields) return null;
      const out = {};
      for (const [k, v] of Object.entries(fields)) {
        if ("stringValue" in v) out[k] = v.stringValue;
        else if ("integerValue" in v) out[k] = Number(v.integerValue);
        else if ("doubleValue" in v) out[k] = Number(v.doubleValue);
        else if ("booleanValue" in v) out[k] = Boolean(v.booleanValue);
      }
      return out;
    } catch {
      if (attempt === 0) continue;
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
async function firestoreSetDoc(docId, payload, timeoutMs = 12e3) {
  const fields = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === "number") {
      fields[k] = { integerValue: String(Math.trunc(v)) };
    } else {
      fields[k] = { stringValue: String(v) };
    }
  }
  const bodyStr = JSON.stringify({ fields });
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${FIRESTORE_BASE_URL}/${docId}?key=${FIREBASE_API_KEY}`, {
        method: "PATCH",
        headers: getFirestoreHeaders("application/json"),
        body: bodyStr,
        signal: controller.signal
      });
      if (res.ok) {
        return true;
      }
      const errText = await res.text().catch(() => "");
      console.warn(`[Firestore] Failed to write ${docId} (status ${res.status}):`, errText.slice(0, 200));
    } catch (err) {
      if (attempt === 1) {
        console.warn(`[Firestore] Error writing ${docId}:`, err instanceof Error ? err.message : err);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}
async function pullRemoteFromFirestore() {
  const metaData = await firestoreGetDoc("meta", 5e3);
  if (!metaData) {
    return null;
  }
  const remoteUpdatedAt = Number(metaData.updatedAt || 0);
  if (storeCache && localUpdatedAt > 0 && remoteUpdatedAt > 0 && remoteUpdatedAt === localUpdatedAt && uploadedChunkJson.size > 0) {
    return storeCache;
  }
  const baseRaw = metaData.json ? JSON.parse(metaData.json) : {};
  const productChunksCount = Number(metaData.productChunksCount || 0);
  const clientChunksCount = Number(metaData.clientChunksCount || 0);
  const [productDocs, clientDocs] = await Promise.all([
    Promise.all(Array.from({ length: productChunksCount }, (_, idx) => firestoreGetDoc(`products_${idx}`, 6e3))),
    Promise.all(Array.from({ length: clientChunksCount }, (_, idx) => firestoreGetDoc(`clients_${idx}`, 6e3)))
  ]);
  if (productDocs.some((d) => !d?.json) || clientDocs.some((d) => !d?.json)) {
    console.warn("[Firestore] Incomplete chunk read detected; keeping current store to prevent data loss.");
    return storeCache;
  }
  const products2 = [];
  productDocs.forEach((docItem, idx) => {
    if (docItem?.json) {
      uploadedChunkJson.set(`products_${idx}`, docItem.json);
      products2.push(...JSON.parse(docItem.json));
    }
  });
  const clients2 = [];
  clientDocs.forEach((docItem, idx) => {
    if (docItem?.json) {
      uploadedChunkJson.set(`clients_${idx}`, docItem.json);
      clients2.push(...JSON.parse(docItem.json));
    }
  });
  return reviveDates({
    ...baseRaw,
    updatedAt: remoteUpdatedAt,
    products: products2,
    clients: clients2
  });
}
async function syncWithFirestore() {
  if (process.env.NODE_ENV === "test") return;
  const startMutationVersion = mutationVersion;
  try {
    const local = getStore();
    const remote = await pullRemoteFromFirestore();
    if (!remote) {
      if (local.products.length > 0 || local.clients.length > 0 || local.orders.length > 0) {
        await pushStoreToFirestore(local);
      }
      return;
    }
    if (remote === storeCache) {
      return;
    }
    const currentLocal = getStore();
    const { merged, changed } = mergeStores(remote, currentLocal);
    storeCache = merged;
    localUpdatedAt = merged.updatedAt ?? nextMonotonicTimestamp();
    writeDisk(storeCache);
    if (changed || mutationVersion !== startMutationVersion || merged.products.length > remote.products.length || merged.clients.length > remote.clients.length || merged.orders.length > remote.orders.length || merged.payments.length > remote.payments.length) {
      await pushStoreToFirestore(storeCache);
    }
  } catch (err) {
    console.warn("[Firestore] Sync error:", err);
  }
}
async function pushStoreToFirestore(data, forceAll = false) {
  try {
    const now = nextMonotonicTimestamp(data.updatedAt);
    data.updatedAt = now;
    localUpdatedAt = now;
    if (data.auditLogs.length > 100) {
      data.auditLogs = data.auditLogs.slice(0, 100);
    }
    const sortedProducts = [...data.products].sort((a, b) => a.id - b.id);
    const sortedClients = [...data.clients].sort((a, b) => a.id - b.id);
    const productChunks = [];
    for (let i = 0; i < sortedProducts.length; i += PRODUCT_CHUNK_SIZE) {
      productChunks.push(sortedProducts.slice(i, i + PRODUCT_CHUNK_SIZE));
    }
    const clientChunks = [];
    for (let i = 0; i < sortedClients.length; i += CLIENT_CHUNK_SIZE) {
      clientChunks.push(sortedClients.slice(i, i + CLIENT_CHUNK_SIZE));
    }
    const pendingChunkTasks = [];
    for (let idx = 0; idx < productChunks.length; idx++) {
      const docId = `products_${idx}`;
      const jsonStr = JSON.stringify(productChunks[idx]);
      if (!forceAll && uploadedChunkJson.get(docId) === jsonStr) {
        continue;
      }
      pendingChunkTasks.push(async () => {
        const ok = await firestoreSetDoc(docId, { json: jsonStr, updatedAt: now });
        if (ok) uploadedChunkJson.set(docId, jsonStr);
        return ok;
      });
    }
    for (let idx = 0; idx < clientChunks.length; idx++) {
      const docId = `clients_${idx}`;
      const jsonStr = JSON.stringify(clientChunks[idx]);
      if (!forceAll && uploadedChunkJson.get(docId) === jsonStr) {
        continue;
      }
      pendingChunkTasks.push(async () => {
        const ok = await firestoreSetDoc(docId, { json: jsonStr, updatedAt: now });
        if (ok) uploadedChunkJson.set(docId, jsonStr);
        return ok;
      });
    }
    for (let i = 0; i < pendingChunkTasks.length; i += 4) {
      const batch = pendingChunkTasks.slice(i, i + 4);
      const batchResults = await Promise.all(batch.map((fn) => fn()));
      if (!batchResults.every(Boolean)) {
        return false;
      }
    }
    const metaPayload = {
      counters: data.counters,
      orders: data.orders,
      orderItems: data.orderItems,
      payments: data.payments,
      chargeTemplates: data.chargeTemplates,
      charges: data.charges,
      auditLogs: data.auditLogs,
      messageDestinations: data.messageDestinations,
      messageLots: data.messageLots,
      messageReminders: data.messageReminders,
      reminderEvents: data.reminderEvents,
      messageActions: data.messageActions
    };
    const metaOk = await firestoreSetDoc("meta", {
      updatedAt: now,
      productChunksCount: productChunks.length,
      clientChunksCount: clientChunks.length,
      json: JSON.stringify(metaPayload)
    });
    lastCloudCheckAt = Date.now();
    return metaOk;
  } catch (err) {
    console.warn("[Firestore] Push error:", err);
    return false;
  }
}
function writeDisk(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.warn("[Store] Failed to write local database file:", err);
  }
}
async function saveStore() {
  if (!storeCache) return;
  mutationVersion += 1;
  storeCache.updatedAt = nextMonotonicTimestamp(storeCache.updatedAt);
  localUpdatedAt = storeCache.updatedAt;
  if (storeCache.auditLogs.length > 100) {
    storeCache.auditLogs = storeCache.auditLogs.slice(0, 100);
  }
  writeDisk(storeCache);
  if (process.env.NODE_ENV === "test") return;
  const ok = await pushStoreToFirestore(storeCache);
  if (!ok) {
    console.warn("[Store] Retrying cloud sync after failure...");
    await pushStoreToFirestore(storeCache);
  }
}

// shared/vcf.ts
function normalizePhone(phone) {
  if (!phone) return "";
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  digits = digits.replace(/^0+/, "");
  if (!digits) return "";
  if (hasPlus && !trimmed.startsWith("+55")) {
    return digits;
  }
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return digits;
}

// server/db.ts
var _db = null;
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
async function upsertUser(user) {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const existingAdmin = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
  const firstAccountWithoutOwnerHint = !ENV.ownerOpenId && existingAdmin.length === 0;
  const values = { openId: user.openId };
  const updateSet = {};
  const textFields = ["name", "email", "loginMethod"];
  for (const field of textFields) {
    if (user[field] !== void 0) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.lastSignedIn !== void 0) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== void 0) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId || firstAccountWithoutOwnerHint) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  values.lastSignedIn ??= /* @__PURE__ */ new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = /* @__PURE__ */ new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}
function deriveStatus(totalCents, paidCents, dueDate, cancelled = false) {
  if (cancelled) return "cancelled";
  if (paidCents >= totalCents) return "paid";
  if (dueDate && dueDate.getTime() < Date.now()) return "overdue";
  if (paidCents > 0) return "partial";
  return "pending";
}
function effectiveStatus(order) {
  return deriveStatus(order.totalCents, order.paidCents, order.dueDate, order.status === "cancelled");
}
async function writeAudit(dbLike, actorUserId, action, entityType, entityId, metadata) {
  if (!dbLike) {
    const store = getStore();
    store.counters.auditLogs += 1;
    store.auditLogs.unshift({
      id: store.counters.auditLogs,
      actorUserId,
      action,
      entityType,
      entityId,
      metadata: metadata ? JSON.stringify(metadata) : null,
      createdAt: /* @__PURE__ */ new Date()
    });
    return;
  }
  await dbLike.insert(auditLogs).values({
    actorUserId,
    action,
    entityType,
    entityId,
    metadata: metadata ? JSON.stringify(metadata) : null
  });
}
async function getDashboard() {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const productRows2 = store.products;
    const clientRows2 = store.clients;
    const orderRows2 = store.orders;
    const productMap = new Map(productRows2.map((p) => [p.id, p]));
    const clientMap = new Map(clientRows2.map((c) => [c.id, c]));
    const itemRows2 = store.orderItems.filter((item) => productMap.has(item.productId)).map((item) => ({ item, product: productMap.get(item.productId) }));
    const knownClientIds2 = new Set(clientRows2.map((client) => client.id));
    const liveOrders2 = orderRows2.filter((order) => knownClientIds2.has(order.clientId)).map((order) => ({ ...order, liveStatus: effectiveStatus(order) }));
    const validOrderIds2 = new Set(liveOrders2.filter((order) => order.liveStatus !== "cancelled").map((order) => order.id));
    const validOrders2 = liveOrders2.filter((order) => order.liveStatus !== "cancelled");
    const totalPieces2 = itemRows2.filter((row) => validOrderIds2.has(row.item.orderId)).reduce((total, row) => total + row.item.quantity, 0);
    const topProducts2 = /* @__PURE__ */ new Map();
    for (const row of itemRows2) {
      if (!validOrderIds2.has(row.item.orderId)) continue;
      const current = topProducts2.get(row.item.productId) ?? { productId: row.item.productId, name: row.product.name, quantity: 0 };
      current.quantity += row.item.quantity;
      topProducts2.set(row.item.productId, current);
    }
    const recentRows2 = [...orderRows2].filter((o) => clientMap.has(o.clientId)).sort((a, b) => b.orderDate.getTime() - a.orderDate.getTime()).slice(0, 6);
    return {
      stats: {
        products: productRows2.filter((product) => product.active).length,
        clients: clientRows2.filter((client) => client.active).length,
        orders: validOrders2.length,
        pieces: totalPieces2,
        soldCents: validOrders2.reduce((total, order) => total + order.totalCents, 0),
        receivedCents: validOrders2.reduce((total, order) => total + order.paidCents, 0),
        pendingCents: validOrders2.reduce((total, order) => total + Math.max(0, order.totalCents - order.paidCents), 0),
        paidOrders: liveOrders2.filter((order) => order.liveStatus === "paid").length,
        pendingOrders: liveOrders2.filter((order) => order.liveStatus === "pending").length,
        partialOrders: liveOrders2.filter((order) => order.liveStatus === "partial").length,
        overdueOrders: liveOrders2.filter((order) => order.liveStatus === "overdue").length,
        cancelledOrders: liveOrders2.filter((order) => order.liveStatus === "cancelled").length
      },
      recentOrders: recentRows2.map((order) => ({
        id: order.id,
        code: order.code,
        clientName: clientMap.get(order.clientId).name,
        totalCents: order.totalCents,
        paidCents: order.paidCents,
        status: effectiveStatus(order),
        orderDate: order.orderDate
      })),
      topProducts: [...topProducts2.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5)
    };
  }
  const [productRows, clientRows, orderRows, itemRows, recentRows] = await Promise.all([
    db.select().from(products),
    db.select().from(clients),
    db.select().from(orders),
    db.select({ item: orderItems, product: products }).from(orderItems).innerJoin(products, eq(orderItems.productId, products.id)),
    db.select({ order: orders, client: clients }).from(orders).innerJoin(clients, eq(orders.clientId, clients.id)).orderBy(desc(orders.orderDate)).limit(6)
  ]);
  const knownClientIds = new Set(clientRows.map((client) => client.id));
  const liveOrders = orderRows.filter((order) => knownClientIds.has(order.clientId)).map((order) => ({ ...order, liveStatus: effectiveStatus(order) }));
  const validOrderIds = new Set(liveOrders.filter((order) => order.liveStatus !== "cancelled").map((order) => order.id));
  const validOrders = liveOrders.filter((order) => order.liveStatus !== "cancelled");
  const totalPieces = itemRows.filter((row) => validOrderIds.has(row.item.orderId)).reduce((total, row) => total + row.item.quantity, 0);
  const topProducts = /* @__PURE__ */ new Map();
  for (const row of itemRows) {
    if (!validOrderIds.has(row.item.orderId)) continue;
    const current = topProducts.get(row.item.productId) ?? { productId: row.item.productId, name: row.product.name, quantity: 0 };
    current.quantity += row.item.quantity;
    topProducts.set(row.item.productId, current);
  }
  return {
    stats: {
      products: productRows.filter((product) => product.active).length,
      clients: clientRows.filter((client) => client.active).length,
      orders: validOrders.length,
      pieces: totalPieces,
      soldCents: validOrders.reduce((total, order) => total + order.totalCents, 0),
      receivedCents: validOrders.reduce((total, order) => total + order.paidCents, 0),
      pendingCents: validOrders.reduce((total, order) => total + Math.max(0, order.totalCents - order.paidCents), 0),
      paidOrders: liveOrders.filter((order) => order.liveStatus === "paid").length,
      pendingOrders: liveOrders.filter((order) => order.liveStatus === "pending").length,
      partialOrders: liveOrders.filter((order) => order.liveStatus === "partial").length,
      overdueOrders: liveOrders.filter((order) => order.liveStatus === "overdue").length,
      cancelledOrders: liveOrders.filter((order) => order.liveStatus === "cancelled").length
    },
    recentOrders: recentRows.map((row) => ({
      id: row.order.id,
      code: row.order.code,
      clientName: row.client.name,
      totalCents: row.order.totalCents,
      paidCents: row.order.paidCents,
      status: effectiveStatus(row.order),
      orderDate: row.order.orderDate
    })),
    topProducts: [...topProducts.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5)
  };
}
async function listProducts(search) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const q = search?.trim().toLowerCase();
    return [...store.products].filter((p) => !q || p.name.toLowerCase().includes(q)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  if (!search?.trim()) return db.select().from(products).orderBy(desc(products.createdAt));
  return db.select().from(products).where(like(products.name, `%${search.trim()}%`)).orderBy(desc(products.createdAt));
}
async function createProduct(actorUserId, input) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    store.counters.products += 1;
    const id2 = store.counters.products;
    const now = /* @__PURE__ */ new Date();
    store.products.push({
      id: id2,
      name: input.name.trim(),
      priceCents: input.priceCents,
      category: input.category?.trim() || null,
      description: input.description?.trim() || null,
      imageUrl: input.imageUrl?.trim() || null,
      active: true,
      createdAt: now,
      updatedAt: now
    });
    await writeAudit(null, actorUserId, "create", "product", String(id2), { name: input.name });
    await saveStore();
    return { id: id2 };
  }
  const [result] = await db.insert(products).values({
    name: input.name.trim(),
    priceCents: input.priceCents,
    category: input.category?.trim() || null,
    description: input.description?.trim() || null,
    imageUrl: input.imageUrl?.trim() || null
  });
  const id = Number(result.insertId);
  await writeAudit(db, actorUserId, "create", "product", String(id), { name: input.name });
  return { id };
}
async function updateProduct(actorUserId, id, input) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const product = store.products.find((p) => p.id === id);
    if (!product) throw new Error("Produto n\xE3o encontrado");
    if (input.name !== void 0) product.name = input.name.trim();
    if (input.priceCents !== void 0) product.priceCents = input.priceCents;
    if (input.category !== void 0) product.category = input.category.trim() || null;
    if (input.description !== void 0) product.description = input.description.trim() || null;
    if (input.imageUrl !== void 0) product.imageUrl = input.imageUrl.trim() || null;
    if (input.active !== void 0) product.active = input.active;
    product.updatedAt = /* @__PURE__ */ new Date();
    await writeAudit(null, actorUserId, "update", "product", String(id), input);
    await saveStore();
    return { ok: true };
  }
  await db.update(products).set({
    ...input.name !== void 0 ? { name: input.name.trim() } : {},
    ...input.priceCents !== void 0 ? { priceCents: input.priceCents } : {},
    ...input.category !== void 0 ? { category: input.category.trim() || null } : {},
    ...input.description !== void 0 ? { description: input.description.trim() || null } : {},
    ...input.imageUrl !== void 0 ? { imageUrl: input.imageUrl.trim() || null } : {},
    ...input.active !== void 0 ? { active: input.active } : {}
  }).where(eq(products.id, id));
  await writeAudit(db, actorUserId, "update", "product", String(id), input);
  return { ok: true };
}
async function listClients(search) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const q = search?.trim().toLowerCase();
    return [...store.clients].filter((c) => !q || c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  if (!search?.trim()) return db.select().from(clients).orderBy(desc(clients.createdAt));
  const term = `%${search.trim()}%`;
  return db.select().from(clients).where(or(like(clients.name, term), like(clients.phone, term))).orderBy(desc(clients.createdAt));
}
async function createClient(actorUserId, input) {
  const db = await getDb();
  const digits = (input.phone || "").replace(/\D/g, "");
  const hasRealPhone = digits.length >= 8;
  const phoneNormalized = hasRealPhone ? normalizePhone(input.phone) : `sem-contato-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  if (!db) {
    const store = getStore();
    if (hasRealPhone && store.clients.some((c) => c.phoneNormalized === phoneNormalized)) {
      throw new Error("J\xE1 existe um cliente com este telefone");
    }
    store.counters.clients += 1;
    const id2 = store.counters.clients;
    const now = /* @__PURE__ */ new Date();
    store.clients.push({
      id: id2,
      name: input.name.trim(),
      phone: input.phone.trim(),
      phoneNormalized,
      notes: input.notes?.trim() || null,
      active: true,
      createdAt: now,
      updatedAt: now
    });
    await writeAudit(null, actorUserId, "create", "client", String(id2), { hasPhone: hasRealPhone });
    await saveStore();
    return { id: id2 };
  }
  if (hasRealPhone) {
    const duplicate = await db.select({ id: clients.id }).from(clients).where(eq(clients.phoneNormalized, phoneNormalized)).limit(1);
    if (duplicate[0]) throw new Error("J\xE1 existe um cliente com este telefone");
  }
  const [result] = await db.insert(clients).values({
    name: input.name.trim(),
    phone: input.phone.trim(),
    phoneNormalized,
    notes: input.notes?.trim() || null
  });
  const id = Number(result.insertId);
  await writeAudit(db, actorUserId, "create", "client", String(id), { hasPhone: hasRealPhone });
  return { id };
}
async function importClients(actorUserId, input, source = "vcf_import") {
  const db = await getDb();
  const effectiveSource = input[0]?.source || source;
  const candidates = input.map((item) => {
    const rawName = (item.name || "").trim();
    const rawPhone = (item.phone || "").trim();
    const digits = rawPhone.replace(/\D/g, "");
    const hasValidPhone = digits.length >= 8;
    const phoneNormalized = hasValidPhone ? normalizePhone(rawPhone) : "";
    const name = rawName || (hasValidPhone ? `Cliente ${rawPhone}` : "");
    const isValid = Boolean(name || hasValidPhone);
    return {
      name,
      phone: rawPhone,
      phoneNormalized,
      hasValidPhone,
      notes: item.notes?.trim() || null,
      isValid
    };
  });
  const validCandidates = candidates.filter((c) => c.isValid);
  const invalid = candidates.length - validCandidates.length;
  if (!db) {
    const store = getStore();
    const takenPhones2 = new Set(
      store.clients.filter((c) => c.phoneNormalized && !c.phoneNormalized.startsWith("sem-contato-")).map((c) => c.phoneNormalized)
    );
    const takenNames2 = new Set(store.clients.map((c) => c.name.toLowerCase().trim()));
    const seenPhones2 = /* @__PURE__ */ new Set();
    const seenNames2 = /* @__PURE__ */ new Set();
    let imported = 0;
    let duplicates2 = 0;
    const importedIds = [];
    const now = /* @__PURE__ */ new Date();
    for (const contact of validCandidates) {
      if (contact.hasValidPhone) {
        if (takenPhones2.has(contact.phoneNormalized) || seenPhones2.has(contact.phoneNormalized)) {
          duplicates2 += 1;
          continue;
        }
        seenPhones2.add(contact.phoneNormalized);
      } else {
        const lowerName = contact.name.toLowerCase().trim();
        if (takenNames2.has(lowerName) || seenNames2.has(lowerName)) {
          duplicates2 += 1;
          continue;
        }
        seenNames2.add(lowerName);
      }
      store.counters.clients += 1;
      const id = store.counters.clients;
      const finalPhoneNormalized = contact.hasValidPhone ? contact.phoneNormalized : `sem-contato-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      store.clients.push({
        id,
        name: contact.name,
        phone: contact.phone,
        phoneNormalized: finalPhoneNormalized,
        notes: contact.notes,
        active: true,
        createdAt: now,
        updatedAt: now
      });
      imported += 1;
      importedIds.push(id);
    }
    if (imported > 0) {
      await writeAudit(null, actorUserId, "import", "client", "bulk", {
        count: imported,
        duplicates: duplicates2,
        invalid,
        source: effectiveSource
      });
      await saveStore();
    }
    return { imported, duplicates: duplicates2, invalid, importedIds };
  }
  const phoneCandidates = validCandidates.filter((c) => c.hasValidPhone);
  const existingPhones = phoneCandidates.length ? await db.select({ phoneNormalized: clients.phoneNormalized }).from(clients).where(
    inArray(clients.phoneNormalized, [...new Set(phoneCandidates.map((c) => c.phoneNormalized))])
  ) : [];
  const takenPhones = new Set(existingPhones.map((r) => r.phoneNormalized));
  const nameCandidates = validCandidates.filter((c) => !c.hasValidPhone);
  const existingNames = nameCandidates.length ? await db.select({ name: clients.name }).from(clients).where(inArray(clients.name, [...new Set(nameCandidates.map((c) => c.name))])) : [];
  const takenNames = new Set(existingNames.map((r) => r.name.toLowerCase().trim()));
  const seenPhones = /* @__PURE__ */ new Set();
  const seenNames = /* @__PURE__ */ new Set();
  const rows = [];
  let duplicates = 0;
  for (const contact of validCandidates) {
    if (contact.hasValidPhone) {
      if (takenPhones.has(contact.phoneNormalized) || seenPhones.has(contact.phoneNormalized)) {
        duplicates += 1;
        continue;
      }
      seenPhones.add(contact.phoneNormalized);
      rows.push({
        name: contact.name,
        phone: contact.phone,
        phoneNormalized: contact.phoneNormalized,
        notes: contact.notes
      });
    } else {
      const lowerName = contact.name.toLowerCase().trim();
      if (takenNames.has(lowerName) || seenNames.has(lowerName)) {
        duplicates += 1;
        continue;
      }
      seenNames.add(lowerName);
      rows.push({
        name: contact.name,
        phone: contact.phone,
        phoneNormalized: `sem-contato-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        notes: contact.notes
      });
    }
  }
  for (let index2 = 0; index2 < rows.length; index2 += 250) {
    await db.insert(clients).values(rows.slice(index2, index2 + 250));
  }
  if (rows.length > 0) {
    await writeAudit(db, actorUserId, "import", "client", "bulk", {
      count: rows.length,
      duplicates,
      invalid,
      source: effectiveSource
    });
  }
  return { imported: rows.length, duplicates, invalid, importedIds: [] };
}
async function updateClient(actorUserId, id, input) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const client = store.clients.find((c) => c.id === id);
    if (!client) throw new Error("Cliente n\xE3o encontrado");
    if (input.name !== void 0) client.name = input.name.trim();
    if (input.phone !== void 0) {
      client.phone = input.phone.trim();
      client.phoneNormalized = normalizePhone(input.phone);
    }
    if (input.notes !== void 0) client.notes = input.notes.trim() || null;
    if (input.active !== void 0) client.active = input.active;
    client.updatedAt = /* @__PURE__ */ new Date();
    await writeAudit(null, actorUserId, "update", "client", String(id), { fields: Object.keys(input) });
    await saveStore();
    return { ok: true };
  }
  const values = {};
  if (input.name !== void 0) values.name = input.name.trim();
  if (input.phone !== void 0) {
    values.phone = input.phone.trim();
    values.phoneNormalized = normalizePhone(input.phone);
  }
  if (input.notes !== void 0) values.notes = input.notes.trim() || null;
  if (input.active !== void 0) values.active = input.active;
  await db.update(clients).set(values).where(eq(clients.id, id));
  await writeAudit(db, actorUserId, "update", "client", String(id), { fields: Object.keys(input) });
  return { ok: true };
}
async function listOrders(input) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const clientMap = new Map(store.clients.map((c) => [c.id, c]));
    const productMap = new Map(store.products.map((p) => [p.id, p]));
    const chargedOrderIds2 = /* @__PURE__ */ new Set();
    for (const a of store.messageActions) {
      if (a.kind === "charge" && a.orderId && (a.status === "manual_confirmed" || a.status === "share_started")) {
        chargedOrderIds2.add(Number(a.orderId));
      }
    }
    for (const c of store.charges) {
      if (c.orderId) chargedOrderIds2.add(Number(c.orderId));
    }
    const byOrder2 = /* @__PURE__ */ new Map();
    for (const item of store.orderItems) {
      const product = productMap.get(item.productId);
      if (!product) continue;
      const list = byOrder2.get(item.orderId) ?? [];
      list.push({
        id: item.id,
        productId: item.productId,
        productName: product.name,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        totalCents: item.totalCents
      });
      byOrder2.set(item.orderId, list);
    }
    const q = input.search?.trim().toLowerCase();
    return store.orders.filter((o) => clientMap.has(o.clientId)).map((order) => {
      const client = clientMap.get(order.clientId);
      const status = effectiveStatus(order);
      const isPaid = status === "paid" || order.paidCents >= order.totalCents && order.totalCents > 0;
      return {
        ...order,
        status,
        client,
        items: byOrder2.get(order.id) ?? [],
        isCharged: chargedOrderIds2.has(order.id),
        isPaid
      };
    }).filter((order) => {
      if (input.status && input.status !== "all" && order.status !== input.status) return false;
      if (q) {
        return order.code.toLowerCase().includes(q) || order.client.name.toLowerCase().includes(q) || order.client.phone.toLowerCase().includes(q);
      }
      return true;
    }).sort((a, b) => b.orderDate.getTime() - a.orderDate.getTime() || b.id - a.id);
  }
  const conditions = [];
  if (input.status && input.status !== "all") conditions.push(eq(orders.status, input.status));
  if (input.search?.trim()) {
    const term = `%${input.search.trim()}%`;
    conditions.push(or(like(orders.code, term), like(clients.name, term), like(clients.phone, term)));
  }
  const orderRows = await db.select({ order: orders, client: clients }).from(orders).innerJoin(clients, eq(orders.clientId, clients.id)).where(conditions.length ? and(...conditions) : void 0).orderBy(desc(orders.orderDate), desc(orders.id));
  const items = await db.select({ item: orderItems, product: products }).from(orderItems).innerJoin(products, eq(orderItems.productId, products.id));
  const byOrder = /* @__PURE__ */ new Map();
  for (const row of items) {
    const list = byOrder.get(row.item.orderId) ?? [];
    list.push({ id: row.item.id, productId: row.item.productId, productName: row.product.name, quantity: row.item.quantity, unitPriceCents: row.item.unitPriceCents, totalCents: row.item.totalCents });
    byOrder.set(row.item.orderId, list);
  }
  const chargeActions = await db.select({ orderId: messageActions.orderId }).from(messageActions).where(and(eq(messageActions.kind, "charge"), inArray(messageActions.status, ["manual_confirmed", "share_started"])));
  const chargesList = await db.select({ orderId: charges.orderId }).from(charges);
  const chargedOrderIds = /* @__PURE__ */ new Set([
    ...chargeActions.map((a) => Number(a.orderId)),
    ...chargesList.map((c) => Number(c.orderId))
  ]);
  return orderRows.map((row) => {
    const status = effectiveStatus(row.order);
    return {
      ...row.order,
      status,
      client: row.client,
      items: byOrder.get(row.order.id) ?? [],
      isCharged: chargedOrderIds.has(row.order.id),
      isPaid: status === "paid" || row.order.paidCents >= row.order.totalCents && row.order.totalCents > 0
    };
  });
}
async function createOrder(actorUserId, input) {
  const db = await getDb();
  if (!input.items.length) throw new Error("Adicione pelo menos um produto");
  if (!db) {
    const store = getStore();
    const productsById2 = new Map(store.products.map((p) => [p.id, p]));
    const normalizedItems2 = input.items.map((item) => {
      const product = productsById2.get(item.productId);
      if (!product || !product.active) throw new Error("Produto n\xE3o encontrado ou inativo");
      if (item.quantity < 1) throw new Error("A quantidade precisa ser maior que zero");
      return { productId: product.id, quantity: item.quantity, unitPriceCents: product.priceCents, totalCents: product.priceCents * item.quantity };
    });
    const totalCents2 = normalizedItems2.reduce((sum, item) => sum + item.totalCents, 0);
    const paidCents2 = Math.min(input.initialPaymentCents ?? 0, totalCents2);
    const dueDate2 = input.dueDate ? /* @__PURE__ */ new Date(`${input.dueDate}T23:59:59`) : null;
    const status2 = deriveStatus(totalCents2, paidCents2, dueDate2);
    const code2 = `PV-${(/* @__PURE__ */ new Date()).getFullYear()}-${nanoid(6).toUpperCase()}`;
    const now = /* @__PURE__ */ new Date();
    store.counters.orders += 1;
    const orderId = store.counters.orders;
    store.orders.push({
      id: orderId,
      code: code2,
      clientId: input.clientId,
      totalCents: totalCents2,
      paidCents: paidCents2,
      status: status2,
      orderDate: input.orderDate ? new Date(input.orderDate) : now,
      dueDate: dueDate2,
      notes: input.notes?.trim() || null,
      createdAt: now,
      updatedAt: now
    });
    for (const item of normalizedItems2) {
      store.counters.orderItems += 1;
      store.orderItems.push({
        id: store.counters.orderItems,
        orderId,
        ...item,
        createdAt: now
      });
    }
    if (paidCents2 > 0) {
      store.counters.payments += 1;
      store.payments.push({
        id: store.counters.payments,
        orderId,
        amountCents: paidCents2,
        paidAt: now,
        method: "Pagamento inicial",
        notes: "Registrado na cria\xE7\xE3o do pedido",
        createdAt: now
      });
    }
    await writeAudit(null, actorUserId, "create", "order", String(orderId), { code: code2, totalCents: totalCents2, itemCount: normalizedItems2.length });
    await saveStore();
    return { id: orderId, code: code2 };
  }
  const productIds = [...new Set(input.items.map((item) => item.productId))];
  const productRows = await db.select().from(products).where(and(...productIds.map((id) => eq(products.id, id))));
  const productsById = new Map(productRows.map((product) => [product.id, product]));
  const normalizedItems = input.items.map((item) => {
    const product = productsById.get(item.productId);
    if (!product || !product.active) throw new Error("Produto n\xE3o encontrado ou inativo");
    if (item.quantity < 1) throw new Error("A quantidade precisa ser maior que zero");
    return { productId: product.id, quantity: item.quantity, unitPriceCents: product.priceCents, totalCents: product.priceCents * item.quantity };
  });
  const totalCents = normalizedItems.reduce((sum, item) => sum + item.totalCents, 0);
  const paidCents = Math.min(input.initialPaymentCents ?? 0, totalCents);
  const dueDate = input.dueDate ? /* @__PURE__ */ new Date(`${input.dueDate}T23:59:59`) : null;
  const status = deriveStatus(totalCents, paidCents, dueDate);
  const code = `PV-${(/* @__PURE__ */ new Date()).getFullYear()}-${nanoid(6).toUpperCase()}`;
  return db.transaction(async (tx) => {
    const [result] = await tx.insert(orders).values({
      code,
      clientId: input.clientId,
      totalCents,
      paidCents,
      status,
      orderDate: input.orderDate ? new Date(input.orderDate) : /* @__PURE__ */ new Date(),
      dueDate,
      notes: input.notes?.trim() || null
    });
    const orderId = Number(result.insertId);
    await tx.insert(orderItems).values(normalizedItems.map((item) => ({ ...item, orderId })));
    if (paidCents > 0) await tx.insert(payments).values({ orderId, amountCents: paidCents, method: "Pagamento inicial", notes: "Registrado na cria\xE7\xE3o do pedido" });
    await writeAudit(tx, actorUserId, "create", "order", String(orderId), { code, totalCents, itemCount: normalizedItems.length });
    return { id: orderId, code };
  });
}
async function updateOrder(actorUserId, orderId, input) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const existing2 = store.orders.find((o) => o.id === orderId);
    if (!existing2) throw new Error("Pedido n\xE3o encontrado");
    if (existing2.status === "cancelled") throw new Error("N\xE3o \xE9 poss\xEDvel editar um pedido cancelado");
    if (!input.items.length) throw new Error("Adicione pelo menos um produto");
    const productsById2 = new Map(store.products.map((p) => [p.id, p]));
    const normalizedItems2 = input.items.map((item) => {
      const product = productsById2.get(item.productId);
      if (!product) throw new Error("Produto n\xE3o encontrado");
      if (item.quantity < 1) throw new Error("A quantidade precisa ser maior que zero");
      const unitPriceCents = item.unitPriceCents ?? product.priceCents;
      return { productId: product.id, quantity: item.quantity, unitPriceCents, totalCents: unitPriceCents * item.quantity };
    });
    const totalCents2 = normalizedItems2.reduce((sum, item) => sum + item.totalCents, 0);
    if (existing2.paidCents > totalCents2) throw new Error("O novo total n\xE3o pode ser menor que o valor j\xE1 recebido");
    const dueDate2 = input.dueDate ? /* @__PURE__ */ new Date(`${input.dueDate}T23:59:59`) : null;
    const status2 = deriveStatus(totalCents2, existing2.paidCents, dueDate2);
    const now = /* @__PURE__ */ new Date();
    existing2.clientId = input.clientId;
    existing2.totalCents = totalCents2;
    existing2.status = status2;
    existing2.dueDate = dueDate2;
    existing2.notes = input.notes?.trim() || null;
    existing2.updatedAt = now;
    store.orderItems = store.orderItems.filter((i) => i.orderId !== orderId);
    for (const item of normalizedItems2) {
      store.counters.orderItems += 1;
      store.orderItems.push({
        id: store.counters.orderItems,
        orderId,
        ...item,
        createdAt: now
      });
    }
    await writeAudit(null, actorUserId, "update", "order", String(orderId), { totalCents: totalCents2, itemCount: normalizedItems2.length });
    await saveStore();
    return { ok: true, totalCents: totalCents2, status: status2 };
  }
  const existingRows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const existing = existingRows[0];
  if (!existing) throw new Error("Pedido n\xE3o encontrado");
  if (existing.status === "cancelled") throw new Error("N\xE3o \xE9 poss\xEDvel editar um pedido cancelado");
  if (!input.items.length) throw new Error("Adicione pelo menos um produto");
  const productIds = [...new Set(input.items.map((item) => item.productId))];
  const productRows = await db.select().from(products).where(and(...productIds.map((id) => eq(products.id, id))));
  const productsById = new Map(productRows.map((product) => [product.id, product]));
  const normalizedItems = input.items.map((item) => {
    const product = productsById.get(item.productId);
    if (!product) throw new Error("Produto n\xE3o encontrado");
    if (item.quantity < 1) throw new Error("A quantidade precisa ser maior que zero");
    const unitPriceCents = item.unitPriceCents ?? product.priceCents;
    return { productId: product.id, quantity: item.quantity, unitPriceCents, totalCents: unitPriceCents * item.quantity };
  });
  const totalCents = normalizedItems.reduce((sum, item) => sum + item.totalCents, 0);
  if (existing.paidCents > totalCents) throw new Error("O novo total n\xE3o pode ser menor que o valor j\xE1 recebido");
  const dueDate = input.dueDate ? /* @__PURE__ */ new Date(`${input.dueDate}T23:59:59`) : null;
  const status = deriveStatus(totalCents, existing.paidCents, dueDate);
  return db.transaction(async (tx) => {
    await tx.update(orders).set({ clientId: input.clientId, totalCents, status, dueDate, notes: input.notes?.trim() || null }).where(eq(orders.id, orderId));
    await tx.delete(orderItems).where(eq(orderItems.orderId, orderId));
    await tx.insert(orderItems).values(normalizedItems.map((item) => ({ ...item, orderId })));
    await writeAudit(tx, actorUserId, "update", "order", String(orderId), { totalCents, itemCount: normalizedItems.length });
    return { ok: true, totalCents, status };
  });
}
async function getOrderDetail(id) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const order = store.orders.find((o) => o.id === id);
    if (!order) return null;
    const client = store.clients.find((c) => c.id === order.clientId);
    if (!client) return null;
    const productMap = new Map(store.products.map((p) => [p.id, p]));
    const items = store.orderItems.filter((i) => i.orderId === id && productMap.has(i.productId)).map((item) => ({ ...item, product: productMap.get(item.productId) }));
    const paymentRows2 = store.payments.filter((p) => p.orderId === id).sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime());
    return {
      ...order,
      status: effectiveStatus(order),
      client,
      items,
      payments: paymentRows2
    };
  }
  const baseRows = await db.select({ order: orders, client: clients }).from(orders).innerJoin(clients, eq(orders.clientId, clients.id)).where(eq(orders.id, id)).limit(1);
  const base = baseRows[0];
  if (!base) return null;
  const [itemRows, paymentRows] = await Promise.all([
    db.select({ item: orderItems, product: products }).from(orderItems).innerJoin(products, eq(orderItems.productId, products.id)).where(eq(orderItems.orderId, id)),
    db.select().from(payments).where(eq(payments.orderId, id)).orderBy(desc(payments.paidAt))
  ]);
  return { ...base.order, status: effectiveStatus(base.order), client: base.client, items: itemRows.map((row) => ({ ...row.item, product: row.product })), payments: paymentRows };
}
async function recordPayment(actorUserId, input) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const order2 = store.orders.find((o) => o.id === input.orderId);
    if (!order2) throw new Error("Pedido n\xE3o encontrado");
    if (order2.status === "cancelled") throw new Error("N\xE3o \xE9 poss\xEDvel pagar um pedido cancelado");
    const remaining2 = Math.max(0, order2.totalCents - order2.paidCents);
    if (input.amountCents < 1 || input.amountCents > remaining2) throw new Error("Informe um valor at\xE9 o saldo restante");
    const paidCents2 = order2.paidCents + input.amountCents;
    const status2 = deriveStatus(order2.totalCents, paidCents2, order2.dueDate);
    const now = /* @__PURE__ */ new Date();
    store.counters.payments += 1;
    const paymentId = store.counters.payments;
    store.payments.push({
      id: paymentId,
      orderId: input.orderId,
      amountCents: input.amountCents,
      method: input.method?.trim() || null,
      notes: input.notes?.trim() || null,
      paidAt: input.paidAt ? new Date(input.paidAt) : now,
      createdAt: now
    });
    order2.paidCents = paidCents2;
    order2.status = status2;
    order2.updatedAt = now;
    await writeAudit(null, actorUserId, "create", "payment", String(paymentId), { orderId: input.orderId, amountCents: input.amountCents });
    await saveStore();
    return { paidCents: paidCents2, status: status2 };
  }
  const orderRows = await db.select().from(orders).where(eq(orders.id, input.orderId)).limit(1);
  const order = orderRows[0];
  if (!order) throw new Error("Pedido n\xE3o encontrado");
  if (order.status === "cancelled") throw new Error("N\xE3o \xE9 poss\xEDvel pagar um pedido cancelado");
  const remaining = Math.max(0, order.totalCents - order.paidCents);
  if (input.amountCents < 1 || input.amountCents > remaining) throw new Error("Informe um valor at\xE9 o saldo restante");
  const paidCents = order.paidCents + input.amountCents;
  const status = deriveStatus(order.totalCents, paidCents, order.dueDate);
  return db.transaction(async (tx) => {
    const [result] = await tx.insert(payments).values({ orderId: input.orderId, amountCents: input.amountCents, method: input.method?.trim() || null, notes: input.notes?.trim() || null, paidAt: input.paidAt ? new Date(input.paidAt) : /* @__PURE__ */ new Date() });
    await tx.update(orders).set({ paidCents, status }).where(eq(orders.id, input.orderId));
    await writeAudit(tx, actorUserId, "create", "payment", String(result.insertId), { orderId: input.orderId, amountCents: input.amountCents });
    return { paidCents, status };
  });
}
async function cancelOrder(actorUserId, orderId) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const order = store.orders.find((o) => o.id === orderId);
    if (order) {
      order.status = "cancelled";
      order.updatedAt = /* @__PURE__ */ new Date();
    }
    await writeAudit(null, actorUserId, "cancel", "order", String(orderId));
    await saveStore();
    return { ok: true };
  }
  await db.update(orders).set({ status: "cancelled" }).where(eq(orders.id, orderId));
  await writeAudit(db, actorUserId, "cancel", "order", String(orderId));
  return { ok: true };
}
async function getProductDetail(productId) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const product2 = store.products.find((p) => p.id === productId);
    if (!product2) return null;
    const orderMap = new Map(store.orders.map((o) => [o.id, o]));
    const clientMap = new Map(store.clients.map((c) => [c.id, c]));
    const rows2 = store.orderItems.filter((i) => i.productId === productId && orderMap.has(i.orderId)).map((item) => {
      const order = orderMap.get(item.orderId);
      const client = clientMap.get(order.clientId);
      return client ? { item, order, client } : null;
    }).filter((r) => Boolean(r)).sort((a, b) => a.order.id - b.order.id || a.item.id - b.item.id);
    const orderIds2 = [...new Set(rows2.map((row) => row.order.id))];
    const fullItems2 = store.orderItems.filter((item) => orderIds2.includes(item.orderId));
    const allocationByItem2 = /* @__PURE__ */ new Map();
    for (const orderId of orderIds2) {
      const orderRows = rows2.filter((row) => row.order.id === orderId);
      const order = orderRows[0]?.order;
      if (!order) continue;
      const itemsForOrder = fullItems2.filter((item) => item.orderId === orderId);
      const bases = itemsForOrder.map((item) => ({
        id: item.id,
        base: order.totalCents > 0 ? Math.floor(order.paidCents * item.totalCents / order.totalCents) : 0,
        remainder: order.totalCents > 0 ? order.paidCents * item.totalCents % order.totalCents : 0
      }));
      let leftover = order.paidCents - bases.reduce((sum, item) => sum + item.base, 0);
      for (const item of bases.sort((a, b) => b.remainder - a.remainder)) {
        const extra = leftover > 0 ? 1 : 0;
        allocationByItem2.set(item.id, item.base + extra);
        leftover -= extra;
      }
    }
    const items2 = rows2.map((row) => {
      const paidAllocation = allocationByItem2.get(row.item.id) ?? 0;
      return {
        id: row.item.id,
        orderId: row.order.id,
        code: row.order.code,
        client: row.client,
        quantity: row.item.quantity,
        unitPriceCents: row.item.unitPriceCents,
        totalCents: row.item.totalCents,
        paidCents: paidAllocation,
        remainingCents: Math.max(0, row.item.totalCents - paidAllocation),
        status: effectiveStatus(row.order),
        orderDate: row.order.orderDate,
        dueDate: row.order.dueDate
      };
    });
    const activeItems2 = items2.filter((item) => item.status !== "cancelled");
    return {
      product: product2,
      items: items2,
      stats: {
        totalPieces: activeItems2.reduce((sum, item) => sum + item.quantity, 0),
        totalClients: new Set(activeItems2.map((item) => item.client.id)).size,
        soldCents: activeItems2.reduce((sum, item) => sum + item.totalCents, 0),
        receivedCents: activeItems2.reduce((sum, item) => sum + item.paidCents, 0),
        pendingCents: activeItems2.reduce((sum, item) => sum + item.remainingCents, 0),
        paidOrders: items2.filter((item) => item.status === "paid").length,
        pendingOrders: items2.filter((item) => item.status === "pending" || item.status === "overdue").length,
        partialOrders: items2.filter((item) => item.status === "partial").length,
        cancelledOrders: items2.filter((item) => item.status === "cancelled").length
      }
    };
  }
  const productRows = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  const product = productRows[0];
  if (!product) return null;
  const rows = await db.select({ item: orderItems, order: orders, client: clients }).from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id)).innerJoin(clients, eq(orders.clientId, clients.id)).where(eq(orderItems.productId, productId)).orderBy(orders.id, orderItems.id);
  const orderIds = [...new Set(rows.map((row) => row.order.id))];
  const fullItems = orderIds.length ? await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)) : [];
  const allocationByItem = /* @__PURE__ */ new Map();
  for (const orderId of orderIds) {
    const orderRows = rows.filter((row) => row.order.id === orderId);
    const order = orderRows[0]?.order;
    if (!order) continue;
    const itemsForOrder = fullItems.filter((item) => item.orderId === orderId);
    const bases = itemsForOrder.map((item) => ({ id: item.id, base: order.totalCents > 0 ? Math.floor(order.paidCents * item.totalCents / order.totalCents) : 0, remainder: order.totalCents > 0 ? order.paidCents * item.totalCents % order.totalCents : 0 }));
    let leftover = order.paidCents - bases.reduce((sum, item) => sum + item.base, 0);
    for (const item of bases.sort((a, b) => b.remainder - a.remainder)) {
      const extra = leftover > 0 ? 1 : 0;
      allocationByItem.set(item.id, item.base + extra);
      leftover -= extra;
    }
  }
  const items = rows.map((row) => {
    const paidAllocation = allocationByItem.get(row.item.id) ?? 0;
    return { id: row.item.id, orderId: row.order.id, code: row.order.code, client: row.client, quantity: row.item.quantity, unitPriceCents: row.item.unitPriceCents, totalCents: row.item.totalCents, paidCents: paidAllocation, remainingCents: Math.max(0, row.item.totalCents - paidAllocation), status: effectiveStatus(row.order), orderDate: row.order.orderDate, dueDate: row.order.dueDate };
  });
  const activeItems = items.filter((item) => item.status !== "cancelled");
  return {
    product,
    items,
    stats: {
      totalPieces: activeItems.reduce((sum, item) => sum + item.quantity, 0),
      totalClients: new Set(activeItems.map((item) => item.client.id)).size,
      soldCents: activeItems.reduce((sum, item) => sum + item.totalCents, 0),
      receivedCents: activeItems.reduce((sum, item) => sum + item.paidCents, 0),
      pendingCents: activeItems.reduce((sum, item) => sum + item.remainingCents, 0),
      paidOrders: items.filter((item) => item.status === "paid").length,
      pendingOrders: items.filter((item) => item.status === "pending" || item.status === "overdue").length,
      partialOrders: items.filter((item) => item.status === "partial").length,
      cancelledOrders: items.filter((item) => item.status === "cancelled").length
    }
  };
}
var defaultTemplates = [
  { name: "Cobran\xE7a amig\xE1vel", body: "Oi, {nome_cliente}! Tudo bem? Passando para lembrar sobre o pagamento do seu pedido no valor de {valor_pendente}. Qualquer d\xFAvida estou \xE0 disposi\xE7\xE3o!" },
  { name: "Primeiro lembrete", body: "Ol\xE1, {nome_cliente}! Estou passando para lembrar que seu pagamento ainda est\xE1 pendente no valor de {valor_pendente}. Assim que realizar, pode me enviar o comprovante. Obrigada!" },
  { name: "Segundo lembrete", body: "Oi, {nome_cliente}! Seu pedido continua com pagamento pendente no valor de {valor_pendente}. Quando puder, me confirme a previs\xE3o de pagamento." },
  { name: "Cobran\xE7a direta", body: "Oi, {nome_cliente}! Seu pedido est\xE1 com pagamento pendente no valor de {valor_pendente}. Consegue realizar o pagamento hoje?" },
  { name: "Confirma\xE7\xE3o de pagamento", body: "Ol\xE1, {nome_cliente}! Recebi seu pagamento de {valor_pago}. Obrigada pela confian\xE7a!" },
  { name: "Agradecimento", body: "Obrigada pela compra, {nome_cliente}! Qualquer coisa estou \xE0 disposi\xE7\xE3o." },
  { name: "Fechamento de lista com Pix", body: "Boa tarde, {nome_cliente}!\nPassando pra informar que fechamos a lista desse {produto_nome} e j\xE1 vamos enviar o pedido grande ao fornecedor.\n\n*Chave Pix* \u{1F447}\u{1F3FB}\n{chave_pix}\n\n*Resumo do seu pedido:*\n*{produto_nome}*\n{quantidade} \xD7 {preco_unitario}\n*Valor total:* {valor_total}\n\n\u26A0\uFE0F *Importante:* Para garantir suas pe\xE7as no lote, realize o pagamento e *envie o comprovante aqui assim que fizer o Pix*. Obrigada!" }
];
async function listTemplates() {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    if (store.chargeTemplates.length === 0) {
      const now = /* @__PURE__ */ new Date();
      for (const tpl of defaultTemplates) {
        store.counters.chargeTemplates += 1;
        store.chargeTemplates.push({
          id: store.counters.chargeTemplates,
          name: tpl.name,
          body: tpl.body,
          createdAt: now,
          updatedAt: now
        });
      }
      await saveStore();
    }
    return [...store.chargeTemplates].sort((a, b) => a.id - b.id);
  }
  const existing = await db.select().from(chargeTemplates).orderBy(chargeTemplates.id);
  if (existing.length) return existing;
  await db.insert(chargeTemplates).values(defaultTemplates);
  return db.select().from(chargeTemplates).orderBy(chargeTemplates.id);
}
async function updateTemplate(actorUserId, id, body) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const tpl = store.chargeTemplates.find((t2) => t2.id === id);
    if (tpl) {
      tpl.body = body.trim();
      tpl.updatedAt = /* @__PURE__ */ new Date();
    }
    await writeAudit(null, actorUserId, "update", "charge_template", String(id));
    await saveStore();
    return { ok: true };
  }
  await db.update(chargeTemplates).set({ body: body.trim() }).where(eq(chargeTemplates.id, id));
  await writeAudit(db, actorUserId, "update", "charge_template", String(id));
  return { ok: true };
}
async function listCharges() {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const clientMap = new Map(store.clients.map((c) => [c.id, c]));
    const orderMap = new Map(store.orders.map((o) => [o.id, o]));
    const tplMap = new Map(store.chargeTemplates.map((t2) => [t2.id, t2]));
    return store.charges.filter((c) => clientMap.has(c.clientId) && orderMap.has(c.orderId)).map((charge) => ({
      ...charge,
      client: clientMap.get(charge.clientId),
      order: orderMap.get(charge.orderId),
      template: charge.templateId ? tplMap.get(charge.templateId) ?? null : null
    })).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  const rows = await db.select({ charge: charges, client: clients, order: orders, template: chargeTemplates }).from(charges).innerJoin(clients, eq(charges.clientId, clients.id)).innerJoin(orders, eq(charges.orderId, orders.id)).leftJoin(chargeTemplates, eq(charges.templateId, chargeTemplates.id)).orderBy(desc(charges.createdAt));
  return rows.map((row) => ({ ...row.charge, client: row.client, order: row.order, template: row.template }));
}
async function createCharge(actorUserId, input) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const order2 = store.orders.find((o) => o.id === input.orderId);
    if (!order2) throw new Error("Pedido n\xE3o encontrado");
    store.counters.charges += 1;
    const id = store.counters.charges;
    store.charges.push({
      id,
      orderId: input.orderId,
      clientId: order2.clientId,
      templateId: input.templateId ?? null,
      message: input.message,
      action: input.action,
      createdAt: /* @__PURE__ */ new Date()
    });
    await writeAudit(null, actorUserId, "create", "charge", String(id), { orderId: input.orderId, action: input.action });
    await saveStore();
    return { id };
  }
  const orderRows = await db.select().from(orders).where(eq(orders.id, input.orderId)).limit(1);
  const order = orderRows[0];
  if (!order) throw new Error("Pedido n\xE3o encontrado");
  const [result] = await db.insert(charges).values({ orderId: input.orderId, clientId: order.clientId, templateId: input.templateId ?? null, message: input.message, action: input.action });
  await writeAudit(db, actorUserId, "create", "charge", String(result.insertId), { orderId: input.orderId, action: input.action });
  return { id: Number(result.insertId) };
}
async function getReportRows(input) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const orderMap = new Map(store.orders.map((o) => [o.id, o]));
    const clientMap = new Map(store.clients.map((c) => [c.id, c]));
    const productMap = new Map(store.products.map((p) => [p.id, p]));
    const chargedOrderIds = /* @__PURE__ */ new Set();
    for (const a of store.messageActions) {
      if (a.kind === "charge" && a.orderId && (a.status === "manual_confirmed" || a.status === "share_started")) {
        chargedOrderIds.add(Number(a.orderId));
      }
    }
    for (const c of store.charges) {
      if (c.orderId) chargedOrderIds.add(Number(c.orderId));
    }
    const rows2 = store.orderItems.filter((i) => {
      if (input.productId && i.productId !== input.productId) return false;
      return orderMap.has(i.orderId) && productMap.has(i.productId);
    }).map((item) => {
      const order = orderMap.get(item.orderId);
      const client = clientMap.get(order.clientId);
      const product = productMap.get(item.productId);
      return client ? { item, order, client, product } : null;
    }).filter((r) => Boolean(r)).sort((a, b) => a.product.id !== b.product.id ? a.product.id - b.product.id : a.order.id - b.order.id || a.item.id - b.item.id);
    return rows2.filter((row) => {
      if (row.order.status === "cancelled") return false;
      if (input.orderIds?.length && !input.orderIds.includes(row.order.id)) return false;
      if (input.from && row.order.orderDate < /* @__PURE__ */ new Date(`${input.from}T00:00:00`)) return false;
      if (input.to && row.order.orderDate > /* @__PURE__ */ new Date(`${input.to}T23:59:59`)) return false;
      return true;
    }).map((row) => {
      const orderStatus = effectiveStatus(row.order);
      const isPaid = orderStatus === "paid" || row.order.paidCents >= row.order.totalCents && row.order.totalCents > 0;
      const isCharged = chargedOrderIds.has(row.order.id);
      return {
        orderId: row.order.id,
        clientId: row.client.id,
        clientName: row.client.name,
        phone: row.client.phone,
        productId: row.product.id,
        productName: row.product.name,
        unitPriceCents: row.item.unitPriceCents,
        quantity: row.item.quantity,
        totalCents: row.item.totalCents,
        orderDate: row.order.orderDate,
        status: isPaid ? "paid" : orderStatus,
        isPaid,
        isCharged,
        paidCents: row.order.paidCents
      };
    });
  }
  const rows = await db.select({ item: orderItems, order: orders, client: clients, product: products }).from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id)).innerJoin(clients, eq(orders.clientId, clients.id)).innerJoin(products, eq(orderItems.productId, products.id)).where(input.productId ? eq(orderItems.productId, input.productId) : void 0).orderBy(products.id, orders.id, orderItems.id);
  const chargeActions = await db.select({ orderId: messageActions.orderId }).from(messageActions).where(and(eq(messageActions.kind, "charge"), inArray(messageActions.status, ["manual_confirmed", "share_started"])));
  const chargesList = await db.select({ orderId: charges.orderId }).from(charges);
  const dbChargedOrderIds = /* @__PURE__ */ new Set([
    ...chargeActions.map((a) => Number(a.orderId)),
    ...chargesList.map((c) => Number(c.orderId))
  ]);
  return rows.filter((row) => {
    if (row.order.status === "cancelled") return false;
    if (input.orderIds?.length && !input.orderIds.includes(row.order.id)) return false;
    if (input.from && row.order.orderDate < /* @__PURE__ */ new Date(`${input.from}T00:00:00`)) return false;
    if (input.to && row.order.orderDate > /* @__PURE__ */ new Date(`${input.to}T23:59:59`)) return false;
    return true;
  }).map((row) => {
    const orderStatus = effectiveStatus(row.order);
    const isPaid = orderStatus === "paid" || row.order.paidCents >= row.order.totalCents && row.order.totalCents > 0;
    const isCharged = dbChargedOrderIds.has(row.order.id);
    return {
      orderId: row.order.id,
      clientId: row.client.id,
      clientName: row.client.name,
      phone: row.client.phone,
      productId: row.product.id,
      productName: row.product.name,
      unitPriceCents: row.item.unitPriceCents,
      quantity: row.item.quantity,
      totalCents: row.item.totalCents,
      orderDate: row.order.orderDate,
      status: isPaid ? "paid" : orderStatus,
      isPaid,
      isCharged,
      paidCents: row.order.paidCents
    };
  });
}
async function getAuditLogs() {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    return store.auditLogs.slice(0, 100);
  }
  return db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100);
}
async function recordAudit(actorUserId, action, entityType, entityId, metadata) {
  const db = await getDb();
  await writeAudit(db, actorUserId, action, entityType, entityId, metadata);
}
async function getOrderBalance(orderId) {
  const order = await getOrderDetail(orderId);
  if (!order || order.status === "cancelled") return null;
  return Math.max(0, order.totalCents - order.paidCents);
}
async function syncLocalToCloud() {
  const store = getStore();
  const ok = await pushStoreToFirestore(store, true);
  return {
    ok,
    products: store.products.length,
    clients: store.clients.length,
    orders: store.orders.length
  };
}

// server/_core/cookies.ts
function getSessionCookieOptions(req) {
  const isHttps = req?.secure || req?.headers?.["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test";
  if (isHttps) {
    return { httpOnly: true, path: "/", sameSite: "none", secure: true };
  }
  return { httpOnly: true, path: "/", sameSite: "lax", secure: false };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    if (ENV.oAuthServerUrl) {
      console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    } else {
      console.log("[Auth] Local admin authentication enabled (user:", ENV.adminUser, ")");
    }
  }
  decodeState(state) {
    return decodeOAuthState(state).redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    if (!secret) throw new Error("MANUS_JWT_SECRET is unavailable");
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || (!isNonEmptyString(appId) || appId !== ENV.appId) || typeof name !== "string") {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    let sessionToken = cookies.get(COOKIE_NAME);
    if (!sessionToken && req.path.startsWith("/api/scheduled/")) {
      const ticket = cookies.get("app_session_id");
      const identity = await this.verifySession(ticket);
      if (identity?.openId.startsWith(CRON_OPEN_ID_PREFIX)) sessionToken = ticket;
    }
    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        sessionToken = authHeader.slice(7);
      }
    }
    const session = await this.verifySession(sessionToken);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    if (session.openId === "admin-fixed") {
      const now = /* @__PURE__ */ new Date();
      return {
        id: 1,
        openId: "admin-fixed",
        name: session.name || "Administradora",
        email: "admin@vendaatacado.local",
        loginMethod: "password",
        role: "admin",
        createdAt: now,
        updatedAt: now,
        lastSignedIn: now
      };
    }
    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
      const taskUid = userInfo.taskUid ?? null;
      if (!taskUid) {
        throw ForbiddenError("Cron session missing task_uid");
      }
      return buildCronUser(userInfo);
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var CRON_OPEN_ID_PREFIX = "cron_";
function buildCronUser(userInfo) {
  const now = /* @__PURE__ */ new Date();
  return {
    id: -1,
    openId: userInfo.openId,
    name: userInfo.name || "Manus Scheduled Task",
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    taskUid: userInfo.taskUid ?? void 0,
    isCron: true
  };
}
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app2) {
  app2.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    const { nonce } = decodeOAuthState(state);
    const expectedNonce = parseCookieHeader2(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!nonce || nonce !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error instanceof Error ? error.message : "unknown error");
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/_core/publicConfig.ts
function publicPlatformConfig(env = process.env) {
  return {
    projectId: env.MANUS_PROJECT_ID ?? "",
    oauthPortalUrl: env.MANUS_OAUTH_PORTAL_URL ?? "",
    apiUrl: env.MANUS_API_URL ?? "",
    apiBrowserKey: env.MANUS_API_BROWSER_KEY ?? ""
  };
}
function publicPlatformScript(env = process.env) {
  const json = JSON.stringify(publicPlatformConfig(env)).replaceAll("<", "\\u003c");
  return `window.__MANUS_CONFIG__=${json};`;
}

// server/routers.ts
import { z as z2 } from "zod";
import { TRPCError as TRPCError4 } from "@trpc/server";

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/messaging.ts
import { TRPCError as TRPCError3 } from "@trpc/server";

// shared/format.ts
var currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
var dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
var dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

// shared/messaging.ts
var WHATSAPP_HOSTS = ["chat.whatsapp.com", "wa.me", "api.whatsapp.com", "web.whatsapp.com", "whatsapp.com"];
function isAllowedWhatsAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && WHATSAPP_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}
var CLIENT_SETTABLE_STATUSES = ["reminder_pending", "draft", "ready", "share_started", "manual_confirmed"];
var STATUS_RANK = { reminder_pending: 0, draft: 1, ready: 2, share_started: 3, manual_confirmed: 4, api_confirmed: 5 };
function canAdvanceStatus(from, to) {
  return STATUS_RANK[to] > STATUS_RANK[from];
}
var MIN_INTERVAL_MINUTES = 5;
var MAX_INTERVAL_MINUTES = 7 * 24 * 60;
function isValidTimezone(timezone) {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
function parseClock(value) {
  const match = value?.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
function localMinutesOfDay(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}
function isQuietTime(date, schedule) {
  const start = parseClock(schedule.quietStart);
  const end = parseClock(schedule.quietEnd);
  if (start === null || end === null || start === end) return false;
  const minutes = localMinutesOfDay(date, schedule.timezone);
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}
function nextSlotAfter(schedule, from) {
  const step = schedule.intervalMinutes * 6e4;
  const anchor = schedule.anchorAt.getTime();
  if (from.getTime() < anchor) return new Date(anchor);
  const k = Math.floor((from.getTime() - anchor) / step) + 1;
  return new Date(anchor + k * step);
}
function skipQuietSlots(schedule, candidate) {
  let slot = candidate;
  for (let i = 0; i < 2e3 && isQuietTime(slot, schedule); i += 1) slot = nextSlotAfter(schedule, slot);
  return slot;
}
function firstRunAt(schedule, now) {
  const candidate = schedule.anchorAt.getTime() > now.getTime() ? schedule.anchorAt : nextSlotAfter(schedule, now);
  return skipQuietSlots(schedule, candidate);
}
function advanceAfterAck(schedule, dueAt, now) {
  const from = new Date(Math.max(now.getTime(), dueAt.getTime()));
  return skipQuietSlots(schedule, nextSlotAfter(schedule, from));
}
function snoozeUntil(schedule, now, minutes) {
  return skipQuietSlots(schedule, new Date(now.getTime() + minutes * 6e4));
}
function occurrenceKey(reminderId, dueAt) {
  return `r${reminderId}:${dueAt.getTime()}`;
}

// server/messaging.ts
var INTEGRATION_STATUS = {
  officialApiEnabled: false,
  autoSendAvailable: false,
  summary: "Envio autom\xE1tico desativado: n\xE3o h\xE1 integra\xE7\xE3o oficial do WhatsApp configurada. Lembretes s\xF3 avisam voc\xEA; cada mensagem \xE9 copiada/aberta por voc\xEA e o envio precisa ser confirmado manualmente."
};
var bad = (message) => new TRPCError3({ code: "BAD_REQUEST", message });
var DEFAULT_TITLES = { group_update: "Atualizar o grupo", charges_review: "Revisar cobran\xE7as" };
var RECENT_LIMIT = { events: 40, actions: 80 };
function parseLog(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function sameInstant(a, b) {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}
function createMessagingService(deps) {
  const { repo, audit } = deps;
  const now = () => deps.now ? deps.now() : /* @__PURE__ */ new Date();
  const scheduleOf = (reminder) => ({
    intervalMinutes: reminder.intervalMinutes,
    anchorAt: reminder.anchorAt,
    timezone: reminder.timezone,
    quietStart: reminder.quietStart,
    quietEnd: reminder.quietEnd
  });
  async function resumeExpired() {
    const current = now();
    let changed = false;
    for (const reminder of await repo.reminders()) {
      if (reminder.status === "paused" && reminder.pausedUntil && reminder.pausedUntil.getTime() <= current.getTime()) {
        await repo.saveReminder({ ...reminder, status: "active", pausedUntil: null, nextDueAt: firstRunAt(scheduleOf(reminder), current), updatedAt: current });
        changed = true;
      }
    }
    return changed;
  }
  async function assertDestination(id) {
    if (!id) return;
    if (!(await repo.destinations()).some((destination) => destination.id === id)) throw bad("Destino n\xE3o encontrado");
  }
  return {
    async overview() {
      if (await resumeExpired()) await repo.commit();
      const [destinations, lots, reminders, events, actions] = await Promise.all([
        repo.destinations(),
        repo.lots(),
        repo.reminders(),
        repo.recentEvents(RECENT_LIMIT.events),
        repo.recentActions(RECENT_LIMIT.actions)
      ]);
      return {
        serverNow: now(),
        integration: INTEGRATION_STATUS,
        destinations,
        lots,
        reminders: reminders.filter((reminder) => reminder.status !== "discarded"),
        events,
        actions
      };
    },
    async saveDestination(actor, input) {
      const name = input.name.trim();
      if (name.length < 2 || name.length > 80) throw bad("Informe um nome de 2 a 80 caracteres");
      const inviteUrl = input.inviteUrl?.trim() || null;
      if (inviteUrl && !isAllowedWhatsAppUrl(inviteUrl)) throw bad("O link precisa ser https e do pr\xF3prio WhatsApp (chat.whatsapp.com ou wa.me)");
      const description = input.description?.trim().slice(0, 280) || null;
      const current = now();
      const existing = input.id ? (await repo.destinations()).find((destination) => destination.id === input.id) : void 0;
      if (input.id && !existing) throw new TRPCError3({ code: "NOT_FOUND", message: "Destino n\xE3o encontrado" });
      const saved = await repo.saveDestination({
        id: existing?.id,
        name,
        kind: "group",
        description,
        inviteUrl,
        active: input.active ?? existing?.active ?? true,
        createdAt: existing?.createdAt ?? current,
        updatedAt: current
      });
      await audit(actor, existing ? "update" : "create", "message_destination", String(saved.id), { name, active: saved.active });
      await repo.commit();
      return saved;
    },
    async saveLot(actor, input) {
      if (input.goalPieces !== null && (!Number.isInteger(input.goalPieces) || input.goalPieces < 1 || input.goalPieces > 1e6)) {
        throw bad("A meta precisa ser um n\xFAmero inteiro maior que zero (ou vazia)");
      }
      const current = now();
      const existing = (await repo.lots()).find((lot) => lot.productId === input.productId);
      const saved = await repo.saveLot({
        id: existing?.id,
        productId: input.productId,
        name: input.name?.trim().slice(0, 160) || existing?.name || null,
        goalPieces: input.goalPieces,
        createdAt: existing?.createdAt ?? current,
        updatedAt: current
      });
      await audit(actor, existing ? "update" : "create", "message_lot", String(saved.id), { productId: input.productId, goalPieces: input.goalPieces });
      await repo.commit();
      return saved;
    },
    async saveReminder(actor, input) {
      if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < MIN_INTERVAL_MINUTES || input.intervalMinutes > MAX_INTERVAL_MINUTES) {
        throw bad(`O intervalo precisa ficar entre ${MIN_INTERVAL_MINUTES} minutos e 7 dias`);
      }
      if (!isValidTimezone(input.timezone)) throw bad("Fuso hor\xE1rio inv\xE1lido");
      const quietStart = input.quietStart || null;
      const quietEnd = input.quietEnd || null;
      if (quietStart === null !== (quietEnd === null)) throw bad("Informe in\xEDcio e fim do hor\xE1rio silencioso");
      if (quietStart !== null && (parseClock(quietStart) === null || parseClock(quietEnd) === null)) throw bad("Hor\xE1rio silencioso inv\xE1lido (use HH:mm)");
      if (input.startAt && Number.isNaN(input.startAt.getTime())) throw bad("Data de in\xEDcio inv\xE1lida");
      await assertDestination(input.destinationId);
      const current = now();
      const existing = input.id ? (await repo.reminders()).find((reminder) => reminder.id === input.id) : void 0;
      if (input.id && !existing) throw new TRPCError3({ code: "NOT_FOUND", message: "Lembrete n\xE3o encontrado" });
      if (existing && (existing.status === "discarded" || existing.status === "completed")) throw bad("Reative o lembrete antes de editar");
      const anchorAt = input.startAt ?? existing?.anchorAt ?? current;
      const schedule = { intervalMinutes: input.intervalMinutes, anchorAt, timezone: input.timezone, quietStart, quietEnd };
      const scheduleUnchanged = existing && existing.intervalMinutes === input.intervalMinutes && sameInstant(existing.anchorAt, anchorAt) && existing.timezone === input.timezone && existing.quietStart === quietStart && existing.quietEnd === quietEnd;
      const nextDueAt = !existing ? firstRunAt(schedule, current) : existing.status !== "active" ? existing.nextDueAt : scheduleUnchanged ? existing.nextDueAt : firstRunAt(schedule, current);
      const saved = await repo.saveReminder({
        id: existing?.id,
        kind: input.kind,
        title: input.title?.trim().slice(0, 120) || DEFAULT_TITLES[input.kind],
        productId: input.kind === "group_update" ? input.productId ?? null : null,
        destinationId: input.destinationId ?? null,
        intervalMinutes: input.intervalMinutes,
        anchorAt,
        nextDueAt,
        status: existing?.status ?? "active",
        pausedUntil: existing?.pausedUntil ?? null,
        timezone: input.timezone,
        quietStart,
        quietEnd,
        lastAckAt: existing?.lastAckAt ?? null,
        createdAt: existing?.createdAt ?? current,
        updatedAt: current
      });
      await audit(actor, existing ? "update" : "create", "message_reminder", String(saved.id), { kind: saved.kind, intervalMinutes: saved.intervalMinutes, timezone: saved.timezone });
      await repo.commit();
      return saved;
    },
    async setReminderStatus(actor, input) {
      const current = now();
      const existing = (await repo.reminders()).find((reminder) => reminder.id === input.id);
      if (!existing) throw new TRPCError3({ code: "NOT_FOUND", message: "Lembrete n\xE3o encontrado" });
      if (existing.status === "discarded") throw bad("Lembrete descartado n\xE3o pode ser alterado");
      if (existing.status === input.status && input.status !== "paused") return existing;
      let patch;
      let auditAction;
      if (input.status === "paused") {
        if (input.pauseMinutes !== void 0 && (!Number.isInteger(input.pauseMinutes) || input.pauseMinutes < 1 || input.pauseMinutes > 60 * 24 * 30)) throw bad("Tempo de pausa inv\xE1lido");
        patch = { status: "paused", pausedUntil: input.pauseMinutes ? new Date(current.getTime() + input.pauseMinutes * 6e4) : null };
        auditAction = "pause";
      } else if (input.status === "active") {
        patch = { status: "active", pausedUntil: null, nextDueAt: firstRunAt(scheduleOf(existing), current) };
        auditAction = "resume";
      } else if (input.status === "completed") {
        patch = { status: "completed", pausedUntil: null, nextDueAt: null };
        auditAction = "complete";
      } else {
        patch = { status: "discarded", pausedUntil: null, nextDueAt: null };
        auditAction = "discard";
      }
      const saved = await repo.saveReminder({ ...existing, ...patch, updatedAt: current });
      await audit(actor, auditAction, "message_reminder", String(saved.id));
      await repo.commit();
      return saved;
    },
    /** Lembretes vencidos para avisar a administradora. Nunca envia nada. */
    async dueReminders() {
      if (await resumeExpired()) await repo.commit();
      const current = now().getTime();
      return (await repo.reminders()).filter((reminder) => reminder.status === "active" && reminder.nextDueAt && reminder.nextDueAt.getTime() <= current).map((reminder) => ({ ...reminder, key: occurrenceKey(reminder.id, reminder.nextDueAt) }));
    },
    /** Concluir/dispensar/adiar uma ocorrência. Repetir a mesma chave é inofensivo. */
    async ackReminder(actor, input) {
      const current = now();
      const reminder = (await repo.reminders()).find((item) => item.id === input.id);
      if (!reminder) throw new TRPCError3({ code: "NOT_FOUND", message: "Lembrete n\xE3o encontrado" });
      if (await repo.eventByKey(input.key)) return { ignored: true, reason: "duplicate", reminder };
      if (reminder.status !== "active" || !reminder.nextDueAt || occurrenceKey(reminder.id, reminder.nextDueAt) !== input.key) {
        return { ignored: true, reason: "stale", reminder };
      }
      if (input.outcome === "snoozed" && (!input.snoozeMinutes || input.snoozeMinutes < 1 || input.snoozeMinutes > 24 * 60)) throw bad("Informe um adiamento entre 1 minuto e 24 horas");
      const schedule = scheduleOf(reminder);
      const nextDueAt = input.outcome === "snoozed" ? snoozeUntil(schedule, current, input.snoozeMinutes) : advanceAfterAck(schedule, reminder.nextDueAt, current);
      await repo.insertEvent({ reminderId: reminder.id, key: input.key, dueAt: reminder.nextDueAt, outcome: input.outcome, createdAt: current });
      const saved = await repo.saveReminder({ ...reminder, nextDueAt, lastAckAt: current, updatedAt: current });
      await audit(actor, `ack_${input.outcome}`, "message_reminder", String(reminder.id), { key: input.key });
      await repo.commit();
      return { ignored: false, reminder: saved };
    },
    /** Registra o que realmente aconteceu com uma mensagem (idempotente por chave). */
    async recordAction(actor, input) {
      const message = input.message.trim();
      const title = input.title.trim();
      if (!message || message.length > 2e3) throw bad("A mensagem precisa ter entre 1 e 2000 caracteres");
      if (!title || title.length > 200) throw bad("T\xEDtulo inv\xE1lido");
      if (input.kind === "charge" && (!input.orderId || !input.clientId)) throw bad("Cobran\xE7a exige pedido e cliente");
      if (input.destinationType === "group") await assertDestination(input.destinationId);
      const current = now();
      const existing = await repo.actionByKey(input.idempotencyKey);
      if (existing && !canAdvanceStatus(existing.status, input.status)) return { action: existing, ignored: true };
      const previous = existing?.status ?? null;
      const crossesShare = input.status === "share_started" || input.status === "manual_confirmed" && !(previous === "share_started");
      if (input.kind === "charge" && input.orderId && input.expectedBalanceCents !== void 0 && crossesShare && (previous === null || previous === "draft" || previous === "ready" || previous === "reminder_pending")) {
        const balance = deps.getOrderBalance ? await deps.getOrderBalance(input.orderId) : null;
        if (balance === null || balance !== input.expectedBalanceCents) {
          throw new TRPCError3({ code: "CONFLICT", message: "O saldo do pedido mudou desde a pr\xE9via. Revise a mensagem atualizada antes de continuar." });
        }
      }
      const log = [...parseLog(existing?.statusLog ?? "[]"), { status: input.status, at: current.toISOString() }];
      const saved = await repo.saveAction({
        id: existing?.id,
        kind: input.kind,
        status: input.status,
        destinationType: input.destinationType,
        destinationId: input.destinationId ?? null,
        clientId: input.clientId ?? null,
        orderId: input.orderId ?? null,
        productId: input.productId ?? null,
        reminderId: input.reminderId ?? null,
        title,
        message,
        idempotencyKey: input.idempotencyKey,
        statusLog: JSON.stringify(log.slice(-12)),
        createdAt: existing?.createdAt ?? current,
        updatedAt: current
      });
      if (saved.kind === "charge" && saved.orderId && deps.registerCharge) {
        if (input.status === "share_started") await deps.registerCharge(actor, { orderId: saved.orderId, message, action: "whatsapp_opened" });
        if (input.status === "manual_confirmed") await deps.registerCharge(actor, { orderId: saved.orderId, message, action: "manual_sent" });
      }
      const auditAction = input.status === "share_started" ? "whatsapp_opened" : input.status === "manual_confirmed" ? "manual_confirm" : "prepare";
      await audit(actor, auditAction, "message_action", String(saved.id), { kind: saved.kind, status: saved.status, orderId: saved.orderId, destinationType: saved.destinationType });
      await repo.commit();
      return { action: saved, ignored: false };
    }
  };
}

// server/messagingRepos.ts
import { desc as desc2, eq as eq2 } from "drizzle-orm";
var HISTORY_CAP = 300;
function createStoreMessagingRepo() {
  const nextId = (counter) => {
    const store = getStore();
    store.counters[counter] += 1;
    return store.counters[counter];
  };
  function upsert(list, value, counter) {
    if (value.id) {
      const index2 = list.findIndex((item) => item.id === value.id);
      if (index2 >= 0) {
        const updated = { ...value, id: value.id };
        list[index2] = updated;
        return updated;
      }
    }
    const created = { ...value, id: nextId(counter) };
    list.push(created);
    return created;
  }
  const newest = (list, pick, limit) => [...list].sort((a, b) => pick(b) - pick(a)).slice(0, limit);
  return {
    async destinations() {
      return [...getStore().messageDestinations];
    },
    async saveDestination(value) {
      return upsert(getStore().messageDestinations, value, "messageDestinations");
    },
    async lots() {
      return [...getStore().messageLots];
    },
    async saveLot(value) {
      return upsert(getStore().messageLots, value, "messageLots");
    },
    async reminders() {
      return [...getStore().messageReminders];
    },
    async saveReminder(value) {
      return upsert(getStore().messageReminders, value, "messageReminders");
    },
    async eventByKey(key) {
      return getStore().reminderEvents.find((event) => event.key === key) ?? null;
    },
    async insertEvent(value) {
      const store = getStore();
      if (store.reminderEvents.some((event) => event.key === value.key)) throw new Error("duplicate reminder event");
      const created = { ...value, id: nextId("reminderEvents") };
      store.reminderEvents.push(created);
      if (store.reminderEvents.length > HISTORY_CAP) store.reminderEvents = newest(store.reminderEvents, (event) => event.createdAt.getTime(), HISTORY_CAP);
      return created;
    },
    async recentEvents(limit) {
      return newest(getStore().reminderEvents, (event) => event.createdAt.getTime(), limit);
    },
    async actionByKey(key) {
      return getStore().messageActions.find((action) => action.idempotencyKey === key) ?? null;
    },
    async saveAction(value) {
      const store = getStore();
      const saved = upsert(store.messageActions, value, "messageActions");
      if (store.messageActions.length > HISTORY_CAP) store.messageActions = newest(store.messageActions, (action) => action.updatedAt.getTime(), HISTORY_CAP);
      return saved;
    },
    async recentActions(limit) {
      return newest(getStore().messageActions, (action) => action.updatedAt.getTime(), limit);
    },
    async commit() {
      await saveStore();
    }
  };
}
function createMysqlMessagingRepo(db) {
  async function save(table, value, map = (v) => v) {
    const { id, ...rest } = value;
    if (id) {
      await db.update(table).set(map(rest)).where(eq2(table.id, id));
      const [row2] = await db.select().from(table).where(eq2(table.id, id)).limit(1);
      return row2;
    }
    const [result] = await db.insert(table).values(map(rest));
    const [row] = await db.select().from(table).where(eq2(table.id, Number(result.insertId))).limit(1);
    return row;
  }
  const toEvent = (row) => ({ id: row.id, reminderId: row.reminderId, key: row.eventKey, dueAt: row.dueAt, outcome: row.outcome, createdAt: row.createdAt });
  return {
    destinations: async () => await db.select().from(messageDestinations).orderBy(messageDestinations.id),
    saveDestination: (value) => save(messageDestinations, value),
    lots: async () => await db.select().from(messageLots),
    saveLot: (value) => save(messageLots, value),
    reminders: async () => await db.select().from(messageReminders).orderBy(messageReminders.id),
    saveReminder: (value) => save(messageReminders, value),
    eventByKey: async (key) => {
      const [row] = await db.select().from(messageReminderEvents).where(eq2(messageReminderEvents.eventKey, key)).limit(1);
      return row ? toEvent(row) : null;
    },
    insertEvent: async (value) => {
      const [result] = await db.insert(messageReminderEvents).values({ reminderId: value.reminderId, eventKey: value.key, dueAt: value.dueAt, outcome: value.outcome, createdAt: value.createdAt });
      return { ...value, id: Number(result.insertId) };
    },
    recentEvents: async (limit) => (await db.select().from(messageReminderEvents).orderBy(desc2(messageReminderEvents.createdAt)).limit(limit)).map(toEvent),
    actionByKey: async (key) => {
      const [row] = await db.select().from(messageActions).where(eq2(messageActions.idempotencyKey, key)).limit(1);
      return row ?? null;
    },
    saveAction: (value) => save(messageActions, value),
    recentActions: async (limit) => await db.select().from(messageActions).orderBy(desc2(messageActions.updatedAt)).limit(limit),
    commit: async () => {
    }
  };
}
async function getMessagingRepo() {
  const db = await getDb();
  return db ? createMysqlMessagingRepo(db) : createStoreMessagingRepo();
}

// server/messagingRuntime.ts
async function getMessagingService() {
  return createMessagingService({
    repo: await getMessagingRepo(),
    audit: recordAudit,
    getOrderBalance,
    registerCharge: async (actorUserId, input) => {
      await createCharge(actorUserId, { orderId: input.orderId, message: input.message, action: input.action });
    }
  });
}

// server/routers.ts
var money = z2.number().int().min(0);
var positiveMoney = z2.number().int().min(1);
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    login: publicProcedure.input(
      z2.object({
        username: z2.string().trim().optional(),
        password: z2.string()
      })
    ).mutation(async ({ ctx, input }) => {
      const expectedUser = ENV.adminUser.toLowerCase();
      const providedUser = (input.username?.trim() || "admin").toLowerCase();
      const isProd = ENV.isProduction;
      const validPasswords = new Set(
        isProd ? [ENV.adminPassword].filter((p) => Boolean(p) && !["1234", "admin", "admin123", "password"].includes(p)) : [ENV.adminPassword, "1234", "admin", "admin123"]
      );
      if (providedUser !== expectedUser || !validPasswords.has(input.password.trim())) {
        throw new TRPCError4({
          code: "UNAUTHORIZED",
          message: "Usu\xE1rio ou senha incorretos"
        });
      }
      const sessionToken = await sdk.createSessionToken("admin-fixed", {
        name: "Administradora",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS
      });
      return {
        success: true,
        token: sessionToken
      };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    })
  }),
  dashboard: router({
    summary: adminProcedure.query(() => getDashboard())
  }),
  products: router({
    list: adminProcedure.input(z2.object({ search: z2.string().optional() })).query(({ input }) => listProducts(input.search)),
    detail: adminProcedure.input(z2.object({ id: z2.number().int().positive() })).query(({ input }) => getProductDetail(input.id)),
    create: adminProcedure.input(z2.object({ name: z2.string().trim().min(1).default("Novo Produto"), priceCents: money.default(0), category: z2.string().optional(), description: z2.string().optional(), imageUrl: z2.string().optional() })).mutation(({ ctx, input }) => createProduct(ctx.user.id, input)),
    update: adminProcedure.input(z2.object({ id: z2.number().int().positive(), name: z2.string().trim().min(1).optional(), priceCents: positiveMoney.optional(), category: z2.string().optional(), description: z2.string().optional(), imageUrl: z2.string().optional(), active: z2.boolean().optional() })).mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return updateProduct(ctx.user.id, id, data);
    }),
    duplicate: adminProcedure.input(z2.object({ id: z2.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const product = await getProductDetail(input.id);
      if (!product) throw new Error("Produto n\xE3o encontrado");
      return createProduct(ctx.user.id, { name: `${product.product.name} (c\xF3pia)`, priceCents: product.product.priceCents, category: product.product.category ?? void 0, description: product.product.description ?? void 0, imageUrl: product.product.imageUrl ?? void 0 });
    })
  }),
  clients: router({
    list: adminProcedure.input(z2.object({ search: z2.string().optional() })).query(({ input }) => listClients(input.search)),
    create: adminProcedure.input(
      z2.object({
        name: z2.string().trim().optional(),
        phone: z2.string().trim().optional(),
        notes: z2.string().optional()
      }).refine((data) => Boolean(data.name?.trim() || data.phone?.trim()), {
        message: "Informe pelo menos o nome ou o telefone"
      })
    ).mutation(({ ctx, input }) => {
      const name = input.name?.trim() || (input.phone?.trim() ? `Cliente ${input.phone.trim()}` : "Cliente");
      const phone = input.phone?.trim() || "Sem telefone";
      return createClient(ctx.user.id, { name, phone, notes: input.notes });
    }),
    update: adminProcedure.input(
      z2.object({
        id: z2.number().int().positive(),
        name: z2.string().trim().min(1).optional(),
        phone: z2.string().trim().optional(),
        notes: z2.string().optional(),
        active: z2.boolean().optional()
      })
    ).mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return updateClient(ctx.user.id, id, data);
    }),
    importBatch: adminProcedure.input(
      z2.object({
        contacts: z2.array(
          z2.object({
            name: z2.string().trim().optional(),
            phone: z2.string().trim().optional(),
            notes: z2.string().optional(),
            source: z2.enum(["vcf_import", "device_contact", "manual"]).optional()
          })
        ).min(1),
        source: z2.enum(["vcf_import", "device_contact", "manual"]).optional()
      })
    ).mutation(
      ({ ctx, input }) => importClients(ctx.user.id, input.contacts, input.source)
    ),
    importVcf: adminProcedure.input(
      z2.object({
        contacts: z2.array(
          z2.object({
            name: z2.string().trim().optional(),
            phone: z2.string().trim().optional(),
            notes: z2.string().optional()
          })
        ).min(1)
      })
    ).mutation(
      ({ ctx, input }) => importClients(ctx.user.id, input.contacts, "vcf_import")
    )
  }),
  orders: router({
    list: adminProcedure.input(z2.object({ search: z2.string().optional(), status: z2.string().optional() })).query(({ input }) => listOrders(input)),
    detail: adminProcedure.input(z2.object({ id: z2.number().int().positive() })).query(({ input }) => getOrderDetail(input.id)),
    create: adminProcedure.input(z2.object({ clientId: z2.number().int().positive(), items: z2.array(z2.object({ productId: z2.number().int().positive(), quantity: z2.number().int().positive() })).min(1), dueDate: z2.string().optional(), notes: z2.string().optional(), orderDate: z2.string().optional(), initialPaymentCents: money.optional() })).mutation(({ ctx, input }) => createOrder(ctx.user.id, input)),
    update: adminProcedure.input(z2.object({ id: z2.number().int().positive(), clientId: z2.number().int().positive(), items: z2.array(z2.object({ productId: z2.number().int().positive(), quantity: z2.number().int().positive(), unitPriceCents: positiveMoney.optional() })).min(1), dueDate: z2.string().optional(), notes: z2.string().optional() })).mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return updateOrder(ctx.user.id, id, data);
    }),
    cancel: adminProcedure.input(z2.object({ id: z2.number().int().positive() })).mutation(({ ctx, input }) => cancelOrder(ctx.user.id, input.id))
  }),
  payments: router({
    create: adminProcedure.input(z2.object({ orderId: z2.number().int().positive(), amountCents: positiveMoney, method: z2.string().optional(), notes: z2.string().optional(), paidAt: z2.string().optional() })).mutation(({ ctx, input }) => recordPayment(ctx.user.id, input))
  }),
  charges: router({
    list: adminProcedure.query(() => listCharges()),
    templates: adminProcedure.query(() => listTemplates()),
    updateTemplate: adminProcedure.input(z2.object({ id: z2.number().int().positive(), body: z2.string().trim().min(5) })).mutation(({ ctx, input }) => updateTemplate(ctx.user.id, input.id, input.body)),
    create: adminProcedure.input(z2.object({ orderId: z2.number().int().positive(), templateId: z2.number().int().positive().optional(), message: z2.string().min(1), action: z2.enum(["prepared", "whatsapp_opened", "manual_sent"]) })).mutation(({ ctx, input }) => createCharge(ctx.user.id, input))
  }),
  reports: router({
    rows: adminProcedure.input(z2.object({ productId: z2.number().int().positive().optional(), from: z2.string().optional(), to: z2.string().optional(), orderIds: z2.array(z2.number().int().positive()).optional() })).query(({ input }) => getReportRows(input))
  }),
  // Central de Mensagens: preparação, lembretes e histórico. Nada é enviado automaticamente.
  messages: router({
    overview: adminProcedure.query(async () => (await getMessagingService()).overview()),
    saveDestination: adminProcedure.input(z2.object({ id: z2.number().int().positive().optional(), name: z2.string().trim().min(2).max(80), description: z2.string().max(280).optional(), inviteUrl: z2.string().trim().max(300).optional(), active: z2.boolean().optional() })).mutation(async ({ ctx, input }) => (await getMessagingService()).saveDestination(ctx.user.id, input)),
    saveLot: adminProcedure.input(z2.object({ productId: z2.number().int().positive(), name: z2.string().max(160).optional(), goalPieces: z2.number().int().min(1).max(1e6).nullable() })).mutation(async ({ ctx, input }) => (await getMessagingService()).saveLot(ctx.user.id, input)),
    saveReminder: adminProcedure.input(z2.object({ id: z2.number().int().positive().optional(), kind: z2.enum(["group_update", "charges_review"]), title: z2.string().max(120).optional(), productId: z2.number().int().positive().nullable().optional(), destinationId: z2.number().int().positive().nullable().optional(), intervalMinutes: z2.number().int().min(5).max(7 * 24 * 60), startAt: z2.coerce.date().optional(), timezone: z2.string().trim().min(1).max(64), quietStart: z2.string().max(5).nullable().optional(), quietEnd: z2.string().max(5).nullable().optional() })).mutation(async ({ ctx, input }) => (await getMessagingService()).saveReminder(ctx.user.id, input)),
    setReminderStatus: adminProcedure.input(z2.object({ id: z2.number().int().positive(), status: z2.enum(["active", "paused", "completed", "discarded"]), pauseMinutes: z2.number().int().positive().optional() })).mutation(async ({ ctx, input }) => (await getMessagingService()).setReminderStatus(ctx.user.id, input)),
    dueReminders: adminProcedure.query(async () => (await getMessagingService()).dueReminders()),
    ackReminder: adminProcedure.input(z2.object({ id: z2.number().int().positive(), key: z2.string().min(3).max(120), outcome: z2.enum(["completed", "dismissed", "snoozed"]), snoozeMinutes: z2.number().int().positive().optional() })).mutation(async ({ ctx, input }) => (await getMessagingService()).ackReminder(ctx.user.id, input)),
    recordAction: adminProcedure.input(z2.object({ idempotencyKey: z2.string().min(8).max(120), kind: z2.enum(["group_update", "charge", "report"]), status: z2.enum(CLIENT_SETTABLE_STATUSES), destinationType: z2.enum(["group", "client", "none"]), destinationId: z2.number().int().positive().nullable().optional(), clientId: z2.number().int().positive().nullable().optional(), orderId: z2.number().int().positive().nullable().optional(), productId: z2.number().int().positive().nullable().optional(), reminderId: z2.number().int().positive().nullable().optional(), title: z2.string().trim().min(1).max(200), message: z2.string().trim().min(1).max(2e3), expectedBalanceCents: z2.number().int().min(0).optional() })).mutation(async ({ ctx, input }) => (await getMessagingService()).recordAction(ctx.user.id, input))
  }),
  settings: router({
    audit: adminProcedure.query(() => getAuditLogs()),
    syncCloud: adminProcedure.mutation(() => syncLocalToCloud())
  })
});

// server/_core/context.ts
async function createContext(opts) {
  await ensureStoreLoaded();
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/app.ts
var UPLOADS_DIR = process.env.VERCEL ? path2.join(os2.tmpdir(), "vendaatacado-uploads") : path2.resolve(process.cwd(), "data", "uploads");
function createApp() {
  try {
    if (!fs2.existsSync(UPLOADS_DIR)) {
      fs2.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
  } catch {
  }
  const app2 = express();
  app2.use(express.json({ limit: "50mb" }));
  app2.use(express.urlencoded({ limit: "50mb", extended: true }));
  app2.use("/uploads", express.static(UPLOADS_DIR, { maxAge: "365d", immutable: true }));
  app2.post("/api/upload", (req, res) => {
    try {
      const { fileName, dataUrl } = req.body;
      if (!dataUrl || typeof dataUrl !== "string") {
        res.status(400).json({ error: "Imagem inv\xE1lida" });
        return;
      }
      const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
      if (!match) {
        res.status(400).json({ error: "Formato de imagem inv\xE1lido" });
        return;
      }
      if (!process.env.VERCEL) {
        try {
          const extFromName = fileName?.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
          const ext = extFromName || (match[1] === "jpeg" ? "jpg" : match[1]) || "jpg";
          const safeName = `${crypto.randomUUID()}.${ext}`;
          const filePath = path2.join(UPLOADS_DIR, safeName);
          fs2.writeFileSync(filePath, Buffer.from(match[2], "base64"));
        } catch {
        }
      }
      res.json({ url: dataUrl });
    } catch (err) {
      console.error("[Upload] Failed to save image:", err);
      res.status(500).json({ error: "Falha ao salvar imagem" });
    }
  });
  app2.options("/api/image-proxy", (_req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.set("Access-Control-Allow-Headers", "*");
    res.sendStatus(204);
  });
  app2.get("/api/image-proxy", async (req, res) => {
    try {
      let rawUrl = typeof req.query.url === "string" ? req.query.url : "";
      if (req.url.includes("?url=")) {
        const afterUrl = req.url.slice(req.url.indexOf("?url=") + 5);
        if (afterUrl.startsWith("http%3A") || afterUrl.startsWith("https%3A")) {
          rawUrl = decodeURIComponent(afterUrl);
        } else if (afterUrl.startsWith("http://") || afterUrl.startsWith("https://")) {
          rawUrl = afterUrl;
        }
      }
      if (!rawUrl || !rawUrl.startsWith("http")) {
        res.status(400).send("URL de imagem inv\xE1lida");
        return;
      }
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        res.status(400).send("Protocolo n\xE3o suportado");
        return;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8e3);
      const upstreamRes = await fetch(rawUrl, {
        signal: controller.signal,
        headers: {
          Accept: "image/*,*/*;q=0.8",
          "User-Agent": "AtacadoLili-ImageProxy/1.0"
        }
      });
      clearTimeout(timeout);
      if (!upstreamRes.ok) {
        res.status(upstreamRes.status).send("Falha ao buscar imagem de origem");
        return;
      }
      const contentType = upstreamRes.headers.get("content-type") || "image/jpeg";
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      res.set("Cache-Control", "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800");
      res.type(contentType);
      const buffer = Buffer.from(await upstreamRes.arrayBuffer());
      res.send(buffer);
    } catch (err) {
      console.error("[ImageProxy] Falha no proxy de imagem:", err);
      res.status(500).send("Erro ao processar imagem");
    }
  });
  app2.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app2.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  registerOAuthRoutes(app2);
  app2.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  return app2;
}

// server/_core/vercelEntry.ts
var app = createApp();
var vercelEntry_default = app;
export {
  vercelEntry_default as default
};
