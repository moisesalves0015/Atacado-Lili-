import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MessageActionRecord, MessageDestination, MessageLot, MessageReminder, ReminderEvent } from "./messagingTypes";

const FIREBASE_PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || "atacadolili";
const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY || "AIzaSyAIiafsVQkawBZrHVHDvoiZ72eTH0Cfb_U";

const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/vendaatacado`;

export interface LocalStoreData {
  updatedAt?: number;
  counters: {
    products: number;
    clients: number;
    orders: number;
    orderItems: number;
    payments: number;
    chargeTemplates: number;
    charges: number;
    auditLogs: number;
    messageDestinations: number;
    messageLots: number;
    messageReminders: number;
    reminderEvents: number;
    messageActions: number;
  };
  /** Central de Mensagens (pequenos registros; sincronizados no documento meta). */
  messageDestinations: MessageDestination[];
  messageLots: MessageLot[];
  messageReminders: MessageReminder[];
  reminderEvents: ReminderEvent[];
  messageActions: MessageActionRecord[];
  products: Array<{
    id: number;
    name: string;
    priceCents: number;
    stock?: number | null;
    category: string | null;
    description: string | null;
    imageUrl: string | null;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
  }>;
  clients: Array<{
    id: number;
    name: string;
    phone: string;
    phoneNormalized: string;
    notes: string | null;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
  }>;
  orders: Array<{
    id: number;
    code: string;
    clientId: number;
    totalCents: number;
    paidCents: number;
    status: "pending" | "partial" | "paid" | "overdue" | "cancelled";
    orderDate: Date;
    dueDate: Date | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  orderItems: Array<{
    id: number;
    orderId: number;
    productId: number;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
    createdAt: Date;
  }>;
  payments: Array<{
    id: number;
    orderId: number;
    amountCents: number;
    paidAt: Date;
    method: string | null;
    notes: string | null;
    createdAt: Date;
  }>;
  chargeTemplates: Array<{
    id: number;
    name: string;
    body: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  charges: Array<{
    id: number;
    orderId: number;
    clientId: number;
    templateId: number | null;
    message: string;
    action: "prepared" | "whatsapp_opened" | "manual_sent";
    createdAt: Date;
  }>;
  auditLogs: Array<{
    id: number;
    actorUserId: number;
    action: string;
    entityType: string;
    entityId: string;
    metadata: string | null;
    createdAt: Date;
  }>;
}

const BUNDLED_DATA_DIR = path.resolve(process.cwd(), "data");
const BUNDLED_DATA_FILE = path.join(BUNDLED_DATA_DIR, "db.json");
const BUNDLED_UPLOADS_DIR = path.join(BUNDLED_DATA_DIR, "uploads");

const DATA_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), "vendaatacado-data")
  : BUNDLED_DATA_DIR;
const DATA_FILE = path.join(DATA_DIR, "db.json");

const PRODUCT_CHUNK_SIZE = 1;
const CLIENT_CHUNK_SIZE = 600;

let storeCache: LocalStoreData | null = null;
let localUpdatedAt = 0;
let lastCloudCheckAt = 0;
let activeSyncPromise: Promise<void> | null = null;
let mutationVersion = 0;

// Cache of serialized chunk JSON already confirmed in Cloud Firestore
const uploadedChunkJson = new Map<string, string>();

function nextMonotonicTimestamp(current?: number): number {
  return Math.max(Date.now(), (current ?? 0) + 1, localUpdatedAt + 1);
}

function embedLocalProductImages(data: LocalStoreData): boolean {
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
        // Ignore read error
      }
    }
  }
  return changed;
}

function reviveDates(raw: any): LocalStoreData {
  const toDate = (v: any) => (v ? new Date(v) : new Date());
  const toNullableDate = (v: any) => (v ? new Date(v) : null);

  const data: LocalStoreData = {
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
      messageActions: raw?.counters?.messageActions ?? 0,
    },
    messageDestinations: (raw?.messageDestinations ?? []).map((d: any) => ({ ...d, createdAt: toDate(d.createdAt), updatedAt: toDate(d.updatedAt) })),
    messageLots: (raw?.messageLots ?? []).map((l: any) => ({ ...l, createdAt: toDate(l.createdAt), updatedAt: toDate(l.updatedAt) })),
    messageReminders: (raw?.messageReminders ?? []).map((r: any) => ({
      ...r,
      anchorAt: toDate(r.anchorAt),
      nextDueAt: toNullableDate(r.nextDueAt),
      pausedUntil: toNullableDate(r.pausedUntil),
      lastAckAt: toNullableDate(r.lastAckAt),
      createdAt: toDate(r.createdAt),
      updatedAt: toDate(r.updatedAt),
    })),
    reminderEvents: (raw?.reminderEvents ?? []).map((e: any) => ({ ...e, dueAt: toDate(e.dueAt), createdAt: toDate(e.createdAt) })),
    messageActions: (raw?.messageActions ?? []).map((a: any) => ({ ...a, createdAt: toDate(a.createdAt), updatedAt: toDate(a.updatedAt) })),
    products: (raw?.products ?? []).map((p: any) => ({
      ...p,
      stock: typeof p.stock === "number" ? p.stock : (Number(p.stock) || 0),
      createdAt: toDate(p.createdAt),
      updatedAt: toDate(p.updatedAt),
    })),
    clients: (raw?.clients ?? []).map((c: any) => ({
      ...c,
      createdAt: toDate(c.createdAt),
      updatedAt: toDate(c.updatedAt),
    })),
    orders: (raw?.orders ?? []).map((o: any) => ({
      ...o,
      orderDate: toDate(o.orderDate),
      dueDate: toNullableDate(o.dueDate),
      createdAt: toDate(o.createdAt),
      updatedAt: toDate(o.updatedAt),
    })),
    orderItems: (raw?.orderItems ?? []).map((i: any) => ({
      ...i,
      createdAt: toDate(i.createdAt),
    })),
    payments: (raw?.payments ?? []).map((p: any) => ({
      ...p,
      paidAt: toDate(p.paidAt),
      createdAt: toDate(p.createdAt),
    })),
    chargeTemplates: (raw?.chargeTemplates ?? []).map((t: any) => ({
      ...t,
      createdAt: toDate(t.createdAt),
      updatedAt: toDate(t.updatedAt),
    })),
    charges: (raw?.charges ?? []).map((c: any) => ({
      ...c,
      createdAt: toDate(c.createdAt),
    })),
    auditLogs: (raw?.auditLogs ?? []).map((a: any) => ({
      ...a,
      createdAt: toDate(a.createdAt),
    })),
  };

  if (embedLocalProductImages(data) && !process.env.VERCEL) {
    writeDisk(data);
  }
  return data;
}

function mergeStores(base: LocalStoreData, incoming: LocalStoreData): { merged: LocalStoreData; changed: boolean } {
  let changed = false;

  const productMap = new Map<number, LocalStoreData["products"][number]>();
  for (const p of base.products) productMap.set(p.id, p);
  for (const p of incoming.products) {
    const existing = productMap.get(p.id);
    if (!existing) {
      productMap.set(p.id, p);
      changed = true;
    } else if (
      p.updatedAt.getTime() > existing.updatedAt.getTime() ||
      (!existing.imageUrl && p.imageUrl) ||
      p.active !== existing.active ||
      p.name !== existing.name ||
      p.priceCents !== existing.priceCents
    ) {
      if (p.updatedAt.getTime() >= existing.updatedAt.getTime()) {
        productMap.set(p.id, p);
        changed = true;
      }
    }
  }

  const clientMap = new Map<number, LocalStoreData["clients"][number]>();
  const phoneSet = new Set<string>();
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

  const orderMap = new Map<number, LocalStoreData["orders"][number]>();
  for (const o of base.orders) orderMap.set(o.id, o);
  for (const o of incoming.orders) {
    const existing = orderMap.get(o.id);
    if (!existing) {
      orderMap.set(o.id, o);
      changed = true;
    } else if (
      o.updatedAt.getTime() > existing.updatedAt.getTime() ||
      o.paidCents > existing.paidCents ||
      (o.status === "cancelled" && existing.status !== "cancelled")
    ) {
      orderMap.set(o.id, o);
      changed = true;
    }
  }

  const itemMap = new Map<number, LocalStoreData["orderItems"][number]>();
  for (const i of base.orderItems) itemMap.set(i.id, i);
  for (const i of incoming.orderItems) {
    if (!itemMap.has(i.id)) {
      itemMap.set(i.id, i);
      changed = true;
    }
  }

  const paymentMap = new Map<number, LocalStoreData["payments"][number]>();
  for (const p of base.payments) paymentMap.set(p.id, p);
  for (const p of incoming.payments) {
    if (!paymentMap.has(p.id)) {
      paymentMap.set(p.id, p);
      changed = true;
    }
  }

  const tplMap = new Map<number, LocalStoreData["chargeTemplates"][number]>();
  for (const t of base.chargeTemplates) tplMap.set(t.id, t);
  for (const t of incoming.chargeTemplates) {
    const existing = tplMap.get(t.id);
    if (!existing || t.updatedAt.getTime() > existing.updatedAt.getTime()) {
      tplMap.set(t.id, t);
      if (!existing) changed = true;
    }
  }

  const chargeMap = new Map<number, LocalStoreData["charges"][number]>();
  for (const c of base.charges) chargeMap.set(c.id, c);
  for (const c of incoming.charges) {
    if (!chargeMap.has(c.id)) {
      chargeMap.set(c.id, c);
      changed = true;
    }
  }

  const auditMap = new Map<number, LocalStoreData["auditLogs"][number]>();
  for (const a of base.auditLogs) auditMap.set(a.id, a);
  for (const a of incoming.auditLogs) {
    if (!auditMap.has(a.id)) {
      auditMap.set(a.id, a);
    }
  }

  // Central de Mensagens: o registro mais recente (updatedAt) vence; descartes são lógicos, então não ressuscitam.
  const mergeById = <T extends { id: number; updatedAt: Date }>(left: T[], right: T[], keyOf: (item: T) => string | number = item => item.id): T[] => {
    const map = new Map<string | number, T>();
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
  const messageDestinations = mergeById(base.messageDestinations, incoming.messageDestinations);
  const messageLots = mergeById(base.messageLots, incoming.messageLots);
  const messageReminders = mergeById(base.messageReminders, incoming.messageReminders);
  const messageActions = mergeById(base.messageActions, incoming.messageActions, action => action.idempotencyKey);
  // Uma ocorrência de lembrete só pode ter um evento (chave única).
  const reminderEvents = mergeById(
    base.reminderEvents.map(event => ({ ...event, updatedAt: event.createdAt })),
    incoming.reminderEvents.map(event => ({ ...event, updatedAt: event.createdAt })),
    event => event.key,
  ).map(({ updatedAt: _ignored, ...event }) => event as ReminderEvent);

  const products = Array.from(productMap.values()).sort((a, b) => a.id - b.id);
  const clients = Array.from(clientMap.values()).sort((a, b) => a.id - b.id);
  const orders = Array.from(orderMap.values()).sort((a, b) => b.id - a.id);
  const orderItems = Array.from(itemMap.values());
  const payments = Array.from(paymentMap.values());
  const chargeTemplates = Array.from(tplMap.values()).sort((a, b) => a.id - b.id);
  const charges = Array.from(chargeMap.values()).sort((a, b) => b.id - a.id);
  const auditLogs = Array.from(auditMap.values())
    .sort((a, b) => b.id - a.id)
    .slice(0, 100);

  const merged: LocalStoreData = {
    updatedAt: Math.max(base.updatedAt ?? 0, incoming.updatedAt ?? 0),
    counters: {
      products: Math.max(base.counters.products, incoming.counters.products, ...products.map(p => p.id), 0),
      clients: Math.max(base.counters.clients, incoming.counters.clients, ...clients.map(c => c.id), 0),
      orders: Math.max(base.counters.orders, incoming.counters.orders, ...orders.map(o => o.id), 0),
      orderItems: Math.max(base.counters.orderItems, incoming.counters.orderItems, ...orderItems.map(i => i.id), 0),
      payments: Math.max(base.counters.payments, incoming.counters.payments, ...payments.map(p => p.id), 0),
      chargeTemplates: Math.max(base.counters.chargeTemplates, incoming.counters.chargeTemplates, ...chargeTemplates.map(t => t.id), 0),
      charges: Math.max(base.counters.charges, incoming.counters.charges, ...charges.map(c => c.id), 0),
      auditLogs: Math.max(base.counters.auditLogs, incoming.counters.auditLogs, ...auditLogs.map(a => a.id), 0),
      messageDestinations: Math.max(base.counters.messageDestinations, incoming.counters.messageDestinations, ...messageDestinations.map(d => d.id), 0),
      messageLots: Math.max(base.counters.messageLots, incoming.counters.messageLots, ...messageLots.map(l => l.id), 0),
      messageReminders: Math.max(base.counters.messageReminders, incoming.counters.messageReminders, ...messageReminders.map(r => r.id), 0),
      reminderEvents: Math.max(base.counters.reminderEvents, incoming.counters.reminderEvents, ...reminderEvents.map(e => e.id), 0),
      messageActions: Math.max(base.counters.messageActions, incoming.counters.messageActions, ...messageActions.map(a => a.id), 0),
    },
    messageDestinations,
    messageLots,
    messageReminders,
    reminderEvents,
    messageActions,
    products,
    clients,
    orders,
    orderItems,
    payments,
    chargeTemplates,
    charges,
    auditLogs,
  };

  return { merged, changed };
}

function createEmptyStore(): LocalStoreData {
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
      messageActions: 0,
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
    auditLogs: [],
  };
}

export function getStore(): LocalStoreData {
  if (!storeCache) {
    storeCache = createEmptyStore();

    // Carrega dados dinamicamente do disco se presente em tempo de execução
    try {
      if (fs.existsSync(DATA_FILE)) {
        const diskData = reviveDates(JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")));
        storeCache = mergeStores(storeCache, diskData).merged;
      } else if (fs.existsSync(BUNDLED_DATA_FILE)) {
        const bundledData = reviveDates(JSON.parse(fs.readFileSync(BUNDLED_DATA_FILE, "utf-8")));
        storeCache = mergeStores(storeCache, bundledData).merged;
      }
    } catch {
      // Mantém estrutura limpa em memória
    }

    localUpdatedAt = storeCache.updatedAt ?? 0;
  }
  return storeCache;
}

export async function ensureStoreLoaded(): Promise<LocalStoreData> {
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

function getFirestoreHeaders(contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (contentType) headers["Content-Type"] = contentType;
  if (process.env.FIREBASE_AUTH_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.FIREBASE_AUTH_TOKEN}`;
  }
  return headers;
}

async function firestoreGetDoc(docId: string, timeoutMs = 6000): Promise<Record<string, any> | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${FIRESTORE_BASE_URL}/${docId}?key=${FIREBASE_API_KEY}`, {
        method: "GET",
        headers: getFirestoreHeaders(),
        signal: controller.signal,
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        if (attempt === 0) continue;
        return null;
      }
      const data: any = await res.json();
      const fields = data?.fields;
      if (!fields) return null;
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries<any>(fields)) {
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

async function firestoreSetDoc(docId: string, payload: Record<string, string | number>, timeoutMs = 12000): Promise<boolean> {
  const fields: Record<string, any> = {};
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
        signal: controller.signal,
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

async function pullRemoteFromFirestore(): Promise<LocalStoreData | null> {
  const metaData = await firestoreGetDoc("meta", 5000);
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
    Promise.all(Array.from({ length: productChunksCount }, (_, idx) => firestoreGetDoc(`products_${idx}`, 6000))),
    Promise.all(Array.from({ length: clientChunksCount }, (_, idx) => firestoreGetDoc(`clients_${idx}`, 6000))),
  ]);

  // Never accept an incomplete pull if any expected chunk failed to load
  if (productDocs.some(d => !d?.json) || clientDocs.some(d => !d?.json)) {
    console.warn("[Firestore] Incomplete chunk read detected; keeping current store to prevent data loss.");
    return storeCache;
  }

  const products: any[] = [];
  productDocs.forEach((docItem, idx) => {
    if (docItem?.json) {
      uploadedChunkJson.set(`products_${idx}`, docItem.json);
      products.push(...JSON.parse(docItem.json));
    }
  });

  const clients: any[] = [];
  clientDocs.forEach((docItem, idx) => {
    if (docItem?.json) {
      uploadedChunkJson.set(`clients_${idx}`, docItem.json);
      clients.push(...JSON.parse(docItem.json));
    }
  });

  return reviveDates({
    ...baseRaw,
    updatedAt: remoteUpdatedAt,
    products,
    clients,
  });
}

async function syncWithFirestore(): Promise<void> {
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

    // Use the latest storeCache in case a mutation happened while pulling
    const currentLocal = getStore();
    const { merged, changed } = mergeStores(remote, currentLocal);
    storeCache = merged;
    localUpdatedAt = merged.updatedAt ?? nextMonotonicTimestamp();
    writeDisk(storeCache);

    if (
      changed ||
      mutationVersion !== startMutationVersion ||
      merged.products.length > remote.products.length ||
      merged.clients.length > remote.clients.length ||
      merged.orders.length > remote.orders.length ||
      merged.payments.length > remote.payments.length
    ) {
      await pushStoreToFirestore(storeCache);
    }
  } catch (err) {
    console.warn("[Firestore] Sync error:", err);
  }
}

export async function pushStoreToFirestore(data: LocalStoreData, forceAll = false): Promise<boolean> {
  try {
    const now = nextMonotonicTimestamp(data.updatedAt);
    data.updatedAt = now;
    localUpdatedAt = now;

    if (data.auditLogs.length > 100) {
      data.auditLogs = data.auditLogs.slice(0, 100);
    }

    // Sort ascending by ID so chunk indices remain stable when new items are added
    const sortedProducts = [...data.products].sort((a, b) => a.id - b.id);
    const sortedClients = [...data.clients].sort((a, b) => a.id - b.id);

    const productChunks: Array<typeof data.products> = [];
    for (let i = 0; i < sortedProducts.length; i += PRODUCT_CHUNK_SIZE) {
      productChunks.push(sortedProducts.slice(i, i + PRODUCT_CHUNK_SIZE));
    }

    const clientChunks: Array<typeof data.clients> = [];
    for (let i = 0; i < sortedClients.length; i += CLIENT_CHUNK_SIZE) {
      clientChunks.push(sortedClients.slice(i, i + CLIENT_CHUNK_SIZE));
    }

    // 1. Upload only changed product & client chunks first (in controlled concurrency)
    const pendingChunkTasks: Array<() => Promise<boolean>> = [];

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

    // Run chunk uploads in batches of 4 to avoid saturating connection
    for (let i = 0; i < pendingChunkTasks.length; i += 4) {
      const batch = pendingChunkTasks.slice(i, i + 4);
      const batchResults = await Promise.all(batch.map(fn => fn()));
      if (!batchResults.every(Boolean)) {
        return false;
      }
    }

    // 2. Write meta LAST only after all product and client chunks succeeded
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
      messageActions: data.messageActions,
    };

    const metaOk = await firestoreSetDoc("meta", {
      updatedAt: now,
      productChunksCount: productChunks.length,
      clientChunksCount: clientChunks.length,
      json: JSON.stringify(metaPayload),
    });

    lastCloudCheckAt = Date.now();
    return metaOk;
  } catch (err) {
    console.warn("[Firestore] Push error:", err);
    return false;
  }
}

function writeDisk(data: LocalStoreData) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.warn("[Store] Failed to write local database file:", err);
  }
}

export async function saveStore(): Promise<void> {
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
