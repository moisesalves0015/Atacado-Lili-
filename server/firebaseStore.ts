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

const BUNDLED_DATA_DIR = path.resolve(import.meta.dirname, "..", "data");
const BUNDLED_DATA_FILE = path.join(BUNDLED_DATA_DIR, "db.json");

const DATA_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), "vendaatacado-data")
  : BUNDLED_DATA_DIR;
const DATA_FILE = path.join(DATA_DIR, "db.json");

let storeCache: LocalStoreData | null = null;
let firestoreSyncPromise: Promise<void> | null = null;

function getFirebaseDb() {
  try {
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    return getFirestore(app);
  } catch {
    return null;
  }
}

function reviveDates(raw: any): LocalStoreData {
  const toDate = (v: any) => (v ? new Date(v) : new Date());
  const toNullableDate = (v: any) => (v ? new Date(v) : null);

  return {
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
}

function emptyStore(): LocalStoreData {
  return {
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

    if (!firestoreSyncPromise) {
      firestoreSyncPromise = pullFromFirestoreIfEmpty();
    }
  }
  return storeCache;
}

export async function ensureStoreLoaded(): Promise<LocalStoreData> {
  const store = getStore();
  if (firestoreSyncPromise) {
    await firestoreSyncPromise;
  }
  return storeCache ?? store;
}

async function pullFromFirestoreIfEmpty() {
  if (!storeCache) return;
  const isEmpty =
    storeCache.products.length === 0 &&
    storeCache.clients.length === 0 &&
    storeCache.orders.length === 0;
  if (!isEmpty) return;

  const fdb = getFirebaseDb();
  if (!fdb) return;
  try {
    const snap = await Promise.race([
      getDoc(doc(fdb, "vendaatacado", "state")),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 2500)),
    ]);
    if (snap && snap.exists() && snap.data()?.json) {
      const remote = reviveDates(JSON.parse(snap.data().json));
      if (
        remote.products.length > 0 ||
        remote.clients.length > 0 ||
        remote.orders.length > 0
      ) {
        storeCache = remote;
        writeDisk(storeCache);
      }
    }
  } catch {
    // Ignore offline or permission errors; local file store remains primary
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

export function saveStore() {
  if (!storeCache) return;
  if (storeCache.auditLogs.length > 100) {
    storeCache.auditLogs = storeCache.auditLogs.slice(0, 100);
  }
  writeDisk(storeCache);

  const fdb = getFirebaseDb();
  if (fdb) {
    const serialized = JSON.stringify(storeCache);
    setDoc(doc(fdb, "vendaatacado", "state"), {
      json: serialized,
      updatedAt: new Date().toISOString(),
    }).catch(() => {
      // Ignore Firebase permission/network errors when syncing in background
    });
  }
}

