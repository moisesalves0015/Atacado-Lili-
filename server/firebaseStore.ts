import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || "AIzaSyAIiafsVQkawBZrHVHDvoiZ72eTH0Cfb_U",
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || "atacadolili.firebaseapp.com",
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || "atacadolili",
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || "atacadolili.firebasestorage.app",
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "294276300088",
  appId: process.env.VITE_FIREBASE_APP_ID || "1:294276300088:web:1b1c6e19df185b104695cd",
};

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
  };
  products: Array<{
    id: number;
    name: string;
    priceCents: number;
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

function getFirebaseDb() {
  try {
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    return getFirestore(app);
  } catch {
    return null;
  }
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
    },
    products: (raw?.products ?? []).map((p: any) => ({
      ...p,
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

function emptyStore(): LocalStoreData {
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
    },
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

function mergeStores(base: LocalStoreData, incoming: LocalStoreData): { merged: LocalStoreData; changed: boolean } {
  let changed = false;

  const productMap = new Map<number, LocalStoreData["products"][number]>();
  for (const p of base.products) productMap.set(p.id, p);
  for (const p of incoming.products) {
    const existing = productMap.get(p.id);
    if (!existing) {
      productMap.set(p.id, p);
      changed = true;
    } else if (p.updatedAt.getTime() > existing.updatedAt.getTime() || (!existing.imageUrl && p.imageUrl)) {
      productMap.set(p.id, p);
      changed = true;
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
    if (!existing || o.updatedAt.getTime() > existing.updatedAt.getTime()) {
      orderMap.set(o.id, o);
      if (!existing) changed = true;
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

  const products = Array.from(productMap.values()).sort((a, b) => b.id - a.id);
  const clients = Array.from(clientMap.values()).sort((a, b) => a.id - b.id);
  const orders = Array.from(orderMap.values()).sort((a, b) => b.id - a.id);
  const orderItems = Array.from(itemMap.values());
  const payments = Array.from(paymentMap.values());

  const merged: LocalStoreData = {
    updatedAt: Math.max(base.updatedAt ?? 0, incoming.updatedAt ?? 0),
    counters: {
      products: Math.max(base.counters.products, incoming.counters.products, ...products.map(p => p.id), 0),
      clients: Math.max(base.counters.clients, incoming.counters.clients, ...clients.map(c => c.id), 0),
      orders: Math.max(base.counters.orders, incoming.counters.orders, ...orders.map(o => o.id), 0),
      orderItems: Math.max(base.counters.orderItems, incoming.counters.orderItems, ...orderItems.map(i => i.id), 0),
      payments: Math.max(base.counters.payments, incoming.counters.payments, ...payments.map(p => p.id), 0),
      chargeTemplates: Math.max(base.counters.chargeTemplates, incoming.counters.chargeTemplates),
      charges: Math.max(base.counters.charges, incoming.counters.charges),
      auditLogs: Math.max(base.counters.auditLogs, incoming.counters.auditLogs),
    },
    products,
    clients,
    orders,
    orderItems,
    payments,
    chargeTemplates: base.chargeTemplates.length >= incoming.chargeTemplates.length ? base.chargeTemplates : incoming.chargeTemplates,
    charges: base.charges.length >= incoming.charges.length ? base.charges : incoming.charges,
    auditLogs: (base.auditLogs.length >= incoming.auditLogs.length ? base.auditLogs : incoming.auditLogs).slice(0, 100),
  };

  return { merged, changed };
}

export function getStore(): LocalStoreData {
  if (!storeCache) {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
        storeCache = reviveDates(parsed);
      } else if (fs.existsSync(BUNDLED_DATA_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(BUNDLED_DATA_FILE, "utf-8"));
        storeCache = reviveDates(parsed);
      } else {
        storeCache = emptyStore();
      }
    } catch {
      storeCache = emptyStore();
    }
    localUpdatedAt = storeCache.updatedAt ?? 0;
  }
  return storeCache;
}

export async function ensureStoreLoaded(): Promise<LocalStoreData> {
  const store = getStore();
  const now = Date.now();
  if (now - lastCloudCheckAt < 1500 && !activeSyncPromise) {
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

async function pullRemoteFromFirestore(): Promise<LocalStoreData | null> {
  const fdb = getFirebaseDb();
  if (!fdb) return null;

  const metaSnap = await Promise.race([
    getDoc(doc(fdb, "vendaatacado", "meta")),
    new Promise<null>(resolve => setTimeout(() => resolve(null), 3200)),
  ]);

  if (!metaSnap || !metaSnap.exists()) {
    // Fallback to legacy single-doc "state" if present
    const legacySnap = await Promise.race([
      getDoc(doc(fdb, "vendaatacado", "state")),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 2000)),
    ]);
    if (legacySnap && legacySnap.exists() && legacySnap.data()?.json) {
      return reviveDates(JSON.parse(legacySnap.data().json));
    }
    return null;
  }

  const metaData = metaSnap.data();
  const remoteUpdatedAt = Number(metaData?.updatedAt || 0);

  // If local cache already has the exact same cloud version, no need to re-download chunks
  if (storeCache && localUpdatedAt > 0 && remoteUpdatedAt > 0 && remoteUpdatedAt === localUpdatedAt) {
    return storeCache;
  }

  const baseRaw = metaData?.json ? JSON.parse(metaData.json) : {};
  const productChunksCount = Number(metaData?.productChunksCount || 0);
  const clientChunksCount = Number(metaData?.clientChunksCount || 0);

  const productPromises = Array.from({ length: productChunksCount }, (_, idx) =>
    getDoc(doc(fdb, "vendaatacado", `products_${idx}`))
  );
  const clientPromises = Array.from({ length: clientChunksCount }, (_, idx) =>
    getDoc(doc(fdb, "vendaatacado", `clients_${idx}`))
  );

  const [productSnaps, clientSnaps] = await Promise.all([
    Promise.all(productPromises),
    Promise.all(clientPromises),
  ]);

  const products: any[] = [];
  for (const snap of productSnaps) {
    if (snap.exists() && snap.data()?.json) {
      products.push(...JSON.parse(snap.data().json));
    }
  }

  const clients: any[] = [];
  for (const snap of clientSnaps) {
    if (snap.exists() && snap.data()?.json) {
      clients.push(...JSON.parse(snap.data().json));
    }
  }

  return reviveDates({
    ...baseRaw,
    updatedAt: remoteUpdatedAt,
    products,
    clients,
  });
}

async function syncWithFirestore(): Promise<void> {
  try {
    const local = getStore();
    const remote = await pullRemoteFromFirestore();

    if (!remote) {
      // Cloud is empty, push local store to Cloud if local has data
      if (local.products.length > 0 || local.clients.length > 0 || local.orders.length > 0) {
        await pushStoreToFirestore(local);
      }
      return;
    }

    if (remote === storeCache) {
      return;
    }

    // Merge remote and local so no VCF contacts, products, or orders are ever lost
    const { merged, changed } = mergeStores(remote, local);
    storeCache = merged;
    localUpdatedAt = merged.updatedAt ?? Date.now();
    writeDisk(storeCache);

    // If local had extra items (e.g., from localhost db.json) not yet in remote, push merged state to Cloud!
    if (
      changed &&
      (merged.products.length > remote.products.length ||
        merged.clients.length > remote.clients.length ||
        merged.orders.length > remote.orders.length)
    ) {
      await pushStoreToFirestore(storeCache);
    }
  } catch {
    // Ignore offline/network errors; local cache stays active
  }
}

export async function pushStoreToFirestore(data: LocalStoreData): Promise<boolean> {
  const fdb = getFirebaseDb();
  if (!fdb) return false;

  try {
    const now = Date.now();
    data.updatedAt = now;
    localUpdatedAt = now;

    if (data.auditLogs.length > 100) {
      data.auditLogs = data.auditLogs.slice(0, 100);
    }

    const productChunks: Array<typeof data.products> = [];
    for (let i = 0; i < data.products.length; i += PRODUCT_CHUNK_SIZE) {
      productChunks.push(data.products.slice(i, i + PRODUCT_CHUNK_SIZE));
    }

    const clientChunks: Array<typeof data.clients> = [];
    for (let i = 0; i < data.clients.length; i += CLIENT_CHUNK_SIZE) {
      clientChunks.push(data.clients.slice(i, i + CLIENT_CHUNK_SIZE));
    }

    const writeOps: Array<Promise<void>> = [];

    for (let idx = 0; idx < productChunks.length; idx++) {
      writeOps.push(
        setDoc(doc(fdb, "vendaatacado", `products_${idx}`), {
          json: JSON.stringify(productChunks[idx]),
          updatedAt: now,
        })
      );
    }

    for (let idx = 0; idx < clientChunks.length; idx++) {
      writeOps.push(
        setDoc(doc(fdb, "vendaatacado", `clients_${idx}`), {
          json: JSON.stringify(clientChunks[idx]),
          updatedAt: now,
        })
      );
    }

    const metaPayload = {
      counters: data.counters,
      orders: data.orders,
      orderItems: data.orderItems,
      payments: data.payments,
      chargeTemplates: data.chargeTemplates,
      charges: data.charges,
      auditLogs: data.auditLogs,
    };

    writeOps.push(
      setDoc(doc(fdb, "vendaatacado", "meta"), {
        updatedAt: now,
        productChunksCount: productChunks.length,
        clientChunksCount: clientChunks.length,
        json: JSON.stringify(metaPayload),
      })
    );

    await Promise.race([
      Promise.all(writeOps),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Firestore write timeout")), 6000)),
    ]);

    return true;
  } catch (err) {
    console.warn("[Store] Cloud sync warning:", err instanceof Error ? err.message : String(err));
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
  storeCache.updatedAt = Date.now();
  localUpdatedAt = storeCache.updatedAt;
  if (storeCache.auditLogs.length > 100) {
    storeCache.auditLogs = storeCache.auditLogs.slice(0, 100);
  }
  writeDisk(storeCache);
  await pushStoreToFirestore(storeCache);
}
