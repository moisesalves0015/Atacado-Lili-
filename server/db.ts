import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { nanoid } from "nanoid";
import {
  auditLogs,
  chargeTemplates,
  charges,
  clients,
  orderItems,
  orders,
  payments,
  products,
  users,
  type InsertUser,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { getStore, pushStoreToFirestore, saveStore } from "./firebaseStore";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
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

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const existingAdmin = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
  const firstAccountWithoutOwnerHint = !ENV.ownerOpenId && existingAdmin.length === 0;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId || firstAccountWithoutOwnerHint) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  values.lastSignedIn ??= new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

function deriveStatus(totalCents: number, paidCents: number, dueDate: Date | null, cancelled = false) {
  if (cancelled) return "cancelled" as const;
  if (paidCents >= totalCents) return "paid" as const;
  if (dueDate && dueDate.getTime() < Date.now()) return "overdue" as const;
  if (paidCents > 0) return "partial" as const;
  return "pending" as const;
}

function effectiveStatus(order: { totalCents: number; paidCents: number; dueDate: Date | null; status: string }) {
  return deriveStatus(order.totalCents, order.paidCents, order.dueDate, order.status === "cancelled");
}

async function writeAudit(
  dbLike: any,
  actorUserId: number,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: Record<string, unknown>,
) {
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
      createdAt: new Date(),
    });
    return;
  }
  await dbLike.insert(auditLogs).values({
    actorUserId,
    action,
    entityType,
    entityId,
    metadata: metadata ? JSON.stringify(metadata) : null,
  });
}

export async function getDashboard() {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const productRows = store.products;
    const clientRows = store.clients;
    const orderRows = store.orders;
    const productMap = new Map(productRows.map(p => [p.id, p]));
    const clientMap = new Map(clientRows.map(c => [c.id, c]));
    const itemRows = store.orderItems
      .filter(item => productMap.has(item.productId))
      .map(item => ({ item, product: productMap.get(item.productId)! }));

    const knownClientIds = new Set(clientRows.map(client => client.id));
    const liveOrders = orderRows
      .filter(order => knownClientIds.has(order.clientId))
      .map(order => ({ ...order, liveStatus: effectiveStatus(order) }));
    const validOrderIds = new Set(liveOrders.filter(order => order.liveStatus !== "cancelled").map(order => order.id));
    const validOrders = liveOrders.filter(order => order.liveStatus !== "cancelled");
    const totalPieces = itemRows.filter(row => validOrderIds.has(row.item.orderId)).reduce((total, row) => total + row.item.quantity, 0);
    const topProducts = new Map<number, { productId: number; name: string; quantity: number }>();
    for (const row of itemRows) {
      if (!validOrderIds.has(row.item.orderId)) continue;
      const current = topProducts.get(row.item.productId) ?? { productId: row.item.productId, name: row.product.name, quantity: 0 };
      current.quantity += row.item.quantity;
      topProducts.set(row.item.productId, current);
    }

    const recentRows = [...orderRows]
      .filter(o => clientMap.has(o.clientId))
      .sort((a, b) => b.orderDate.getTime() - a.orderDate.getTime())
      .slice(0, 6);

    return {
      stats: {
        products: productRows.filter(product => product.active).length,
        clients: clientRows.filter(client => client.active).length,
        orders: validOrders.length,
        pieces: totalPieces,
        soldCents: validOrders.reduce((total, order) => total + order.totalCents, 0),
        receivedCents: validOrders.reduce((total, order) => total + order.paidCents, 0),
        pendingCents: validOrders.reduce((total, order) => total + Math.max(0, order.totalCents - order.paidCents), 0),
        paidOrders: liveOrders.filter(order => order.liveStatus === "paid").length,
        pendingOrders: liveOrders.filter(order => order.liveStatus === "pending").length,
        partialOrders: liveOrders.filter(order => order.liveStatus === "partial").length,
        overdueOrders: liveOrders.filter(order => order.liveStatus === "overdue").length,
        cancelledOrders: liveOrders.filter(order => order.liveStatus === "cancelled").length,
      },
      recentOrders: recentRows.map(order => ({
        id: order.id,
        code: order.code,
        clientName: clientMap.get(order.clientId)!.name,
        totalCents: order.totalCents,
        paidCents: order.paidCents,
        status: effectiveStatus(order),
        orderDate: order.orderDate,
      })),
      topProducts: [...topProducts.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5),
    };
  }

  const [productRows, clientRows, orderRows, itemRows, recentRows] = await Promise.all([
    db.select().from(products),
    db.select().from(clients),
    db.select().from(orders),
    db.select({ item: orderItems, product: products }).from(orderItems).innerJoin(products, eq(orderItems.productId, products.id)),
    db.select({ order: orders, client: clients }).from(orders).innerJoin(clients, eq(orders.clientId, clients.id)).orderBy(desc(orders.orderDate)).limit(6),
  ]);

  const knownClientIds = new Set(clientRows.map(client => client.id));
  const liveOrders = orderRows.filter(order => knownClientIds.has(order.clientId)).map(order => ({ ...order, liveStatus: effectiveStatus(order) }));
  const validOrderIds = new Set(liveOrders.filter(order => order.liveStatus !== "cancelled").map(order => order.id));
  const validOrders = liveOrders.filter(order => order.liveStatus !== "cancelled");
  const totalPieces = itemRows.filter(row => validOrderIds.has(row.item.orderId)).reduce((total, row) => total + row.item.quantity, 0);
  const topProducts = new Map<number, { productId: number; name: string; quantity: number }>();
  for (const row of itemRows) {
    if (!validOrderIds.has(row.item.orderId)) continue;
    const current = topProducts.get(row.item.productId) ?? { productId: row.item.productId, name: row.product.name, quantity: 0 };
    current.quantity += row.item.quantity;
    topProducts.set(row.item.productId, current);
  }

  return {
    stats: {
      products: productRows.filter(product => product.active).length,
      clients: clientRows.filter(client => client.active).length,
      orders: validOrders.length,
      pieces: totalPieces,
      soldCents: validOrders.reduce((total, order) => total + order.totalCents, 0),
      receivedCents: validOrders.reduce((total, order) => total + order.paidCents, 0),
      pendingCents: validOrders.reduce((total, order) => total + Math.max(0, order.totalCents - order.paidCents), 0),
      paidOrders: liveOrders.filter(order => order.liveStatus === "paid").length,
      pendingOrders: liveOrders.filter(order => order.liveStatus === "pending").length,
      partialOrders: liveOrders.filter(order => order.liveStatus === "partial").length,
      overdueOrders: liveOrders.filter(order => order.liveStatus === "overdue").length,
      cancelledOrders: liveOrders.filter(order => order.liveStatus === "cancelled").length,
    },
    recentOrders: recentRows.map(row => ({
      id: row.order.id,
      code: row.order.code,
      clientName: row.client.name,
      totalCents: row.order.totalCents,
      paidCents: row.order.paidCents,
      status: effectiveStatus(row.order),
      orderDate: row.order.orderDate,
    })),
    topProducts: [...topProducts.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5),
  };
}

export async function listProducts(search?: string) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const q = search?.trim().toLowerCase();
    return [...store.products]
      .filter(p => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  if (!search?.trim()) return db.select().from(products).orderBy(desc(products.createdAt));
  return db.select().from(products).where(like(products.name, `%${search.trim()}%`)).orderBy(desc(products.createdAt));
}

export async function createProduct(actorUserId: number, input: { name: string; priceCents: number; category?: string; description?: string; imageUrl?: string }) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    store.counters.products += 1;
    const id = store.counters.products;
    const now = new Date();
    store.products.push({
      id,
      name: input.name.trim(),
      priceCents: input.priceCents,
      category: input.category?.trim() || null,
      description: input.description?.trim() || null,
      imageUrl: input.imageUrl?.trim() || null,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(null, actorUserId, "create", "product", String(id), { name: input.name });
    await saveStore();
    return { id };
  }
  const [result] = await db.insert(products).values({
    name: input.name.trim(),
    priceCents: input.priceCents,
    category: input.category?.trim() || null,
    description: input.description?.trim() || null,
    imageUrl: input.imageUrl?.trim() || null,
  });
  const id = Number((result as any).insertId);
  await writeAudit(db, actorUserId, "create", "product", String(id), { name: input.name });
  return { id };
}

export async function updateProduct(actorUserId: number, id: number, input: { name?: string; priceCents?: number; category?: string; description?: string; imageUrl?: string; active?: boolean }) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const product = store.products.find(p => p.id === id);
    if (!product) throw new Error("Produto não encontrado");
    if (input.name !== undefined) product.name = input.name.trim();
    if (input.priceCents !== undefined) product.priceCents = input.priceCents;
    if (input.category !== undefined) product.category = input.category.trim() || null;
    if (input.description !== undefined) product.description = input.description.trim() || null;
    if (input.imageUrl !== undefined) product.imageUrl = input.imageUrl.trim() || null;
    if (input.active !== undefined) product.active = input.active;
    product.updatedAt = new Date();
    await writeAudit(null, actorUserId, "update", "product", String(id), input);
    await saveStore();
    return { ok: true };
  }
  await db.update(products).set({
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.priceCents !== undefined ? { priceCents: input.priceCents } : {}),
    ...(input.category !== undefined ? { category: input.category.trim() || null } : {}),
    ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
    ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl.trim() || null } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
  }).where(eq(products.id, id));
  await writeAudit(db, actorUserId, "update", "product", String(id), input);
  return { ok: true };
}

export async function listClients(search?: string) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const q = search?.trim().toLowerCase();
    return [...store.clients]
      .filter(c => !q || c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  if (!search?.trim()) return db.select().from(clients).orderBy(desc(clients.createdAt));
  const term = `%${search.trim()}%`;
  return db.select().from(clients).where(or(like(clients.name, term), like(clients.phone, term))).orderBy(desc(clients.createdAt));
}

export async function createClient(actorUserId: number, input: { name: string; phone: string; notes?: string }) {
  const db = await getDb();
  const phoneNormalized = normalizePhone(input.phone);
  if (!db) {
    const store = getStore();
    if (store.clients.some(c => c.phoneNormalized === phoneNormalized)) {
      throw new Error("Já existe um cliente com este telefone");
    }
    store.counters.clients += 1;
    const id = store.counters.clients;
    const now = new Date();
    store.clients.push({
      id,
      name: input.name.trim(),
      phone: input.phone.trim(),
      phoneNormalized,
      notes: input.notes?.trim() || null,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(null, actorUserId, "create", "client", String(id), { name: input.name });
    await saveStore();
    return { id };
  }
  const duplicate = await db.select({ id: clients.id }).from(clients).where(eq(clients.phoneNormalized, phoneNormalized)).limit(1);
  if (duplicate[0]) throw new Error("Já existe um cliente com este telefone");
  const [result] = await db.insert(clients).values({
    name: input.name.trim(),
    phone: input.phone.trim(),
    phoneNormalized,
    notes: input.notes?.trim() || null,
  });
  const id = Number((result as any).insertId);
  await writeAudit(db, actorUserId, "create", "client", String(id), { name: input.name });
  return { id };
}

export async function importClients(actorUserId: number, input: Array<{ name: string; phone: string; notes?: string }>) {
  const db = await getDb();
  const candidates = input.map(contact => ({ ...contact, phoneNormalized: normalizePhone(contact.phone) }));
  const validCandidates = candidates.filter(contact => contact.phoneNormalized.length >= 8);
  if (!db) {
    const store = getStore();
    const taken = new Set(store.clients.map(c => c.phoneNormalized));
    const seen = new Set<string>();
    let imported = 0;
    let duplicates = 0;
    const invalid = candidates.length - validCandidates.length;
    const now = new Date();
    for (const contact of validCandidates) {
      if (taken.has(contact.phoneNormalized) || seen.has(contact.phoneNormalized)) {
        duplicates += 1;
        continue;
      }
      seen.add(contact.phoneNormalized);
      store.counters.clients += 1;
      store.clients.push({
        id: store.counters.clients,
        name: contact.name.trim(),
        phone: contact.phone.trim(),
        phoneNormalized: contact.phoneNormalized,
        notes: contact.notes?.trim() || null,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      imported += 1;
    }
    if (imported > 0) {
      await writeAudit(null, actorUserId, "import", "client", "bulk", { imported, duplicates, invalid });
      await saveStore();
    }
    return { imported, duplicates, invalid };
  }
  const existingRows = validCandidates.length
    ? await db.select({ phoneNormalized: clients.phoneNormalized }).from(clients).where(inArray(clients.phoneNormalized, [...new Set(validCandidates.map(contact => contact.phoneNormalized))]))
    : [];
  const taken = new Set(existingRows.map(row => row.phoneNormalized));
  const seen = new Set<string>();
  const rows: Array<{ name: string; phone: string; phoneNormalized: string; notes: string | null }> = [];
  let duplicates = 0;
  let invalid = candidates.length - validCandidates.length;
  for (const contact of validCandidates) {
    if (taken.has(contact.phoneNormalized) || seen.has(contact.phoneNormalized)) {
      duplicates += 1;
      continue;
    }
    seen.add(contact.phoneNormalized);
    rows.push({ name: contact.name.trim(), phone: contact.phone.trim(), phoneNormalized: contact.phoneNormalized, notes: contact.notes?.trim() || null });
  }
  for (let index = 0; index < rows.length; index += 250) {
    await db.insert(clients).values(rows.slice(index, index + 250));
  }
  if (rows.length) await writeAudit(db, actorUserId, "import", "client", "bulk", { imported: rows.length, duplicates, invalid });
  return { imported: rows.length, duplicates, invalid };
}

export async function updateClient(actorUserId: number, id: number, input: { name?: string; phone?: string; notes?: string; active?: boolean }) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const client = store.clients.find(c => c.id === id);
    if (!client) throw new Error("Cliente não encontrado");
    if (input.name !== undefined) client.name = input.name.trim();
    if (input.phone !== undefined) {
      client.phone = input.phone.trim();
      client.phoneNormalized = normalizePhone(input.phone);
    }
    if (input.notes !== undefined) client.notes = input.notes.trim() || null;
    if (input.active !== undefined) client.active = input.active;
    client.updatedAt = new Date();
    await writeAudit(null, actorUserId, "update", "client", String(id), input);
    await saveStore();
    return { ok: true };
  }
  const values: Record<string, unknown> = {};
  if (input.name !== undefined) values.name = input.name.trim();
  if (input.phone !== undefined) {
    values.phone = input.phone.trim();
    values.phoneNormalized = normalizePhone(input.phone);
  }
  if (input.notes !== undefined) values.notes = input.notes.trim() || null;
  if (input.active !== undefined) values.active = input.active;
  await db.update(clients).set(values).where(eq(clients.id, id));
  await writeAudit(db, actorUserId, "update", "client", String(id), input);
  return { ok: true };
}

export async function listOrders(input: { search?: string; status?: string }) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const clientMap = new Map(store.clients.map(c => [c.id, c]));
    const productMap = new Map(store.products.map(p => [p.id, p]));
    const byOrder = new Map<number, Array<{ id: number; productId: number; productName: string; quantity: number; unitPriceCents: number; totalCents: number }>>();
    for (const item of store.orderItems) {
      const product = productMap.get(item.productId);
      if (!product) continue;
      const list = byOrder.get(item.orderId) ?? [];
      list.push({
        id: item.id,
        productId: item.productId,
        productName: product.name,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        totalCents: item.totalCents,
      });
      byOrder.set(item.orderId, list);
    }
    const q = input.search?.trim().toLowerCase();
    return store.orders
      .filter(o => clientMap.has(o.clientId))
      .map(order => {
        const client = clientMap.get(order.clientId)!;
        const status = effectiveStatus(order);
        return { ...order, status, client, items: byOrder.get(order.id) ?? [] };
      })
      .filter(order => {
        if (input.status && input.status !== "all" && order.status !== input.status) return false;
        if (q) {
          return (
            order.code.toLowerCase().includes(q) ||
            order.client.name.toLowerCase().includes(q) ||
            order.client.phone.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => b.orderDate.getTime() - a.orderDate.getTime());
  }
  const conditions = [] as any[];
  if (input.status && input.status !== "all") conditions.push(eq(orders.status, input.status as any));
  if (input.search?.trim()) {
    const term = `%${input.search.trim()}%`;
    conditions.push(or(like(orders.code, term), like(clients.name, term), like(clients.phone, term)));
  }
  const orderRows = await db.select({ order: orders, client: clients }).from(orders).innerJoin(clients, eq(orders.clientId, clients.id)).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(orders.orderDate));
  const items = await db.select({ item: orderItems, product: products }).from(orderItems).innerJoin(products, eq(orderItems.productId, products.id));
  const byOrder = new Map<number, Array<{ id: number; productId: number; productName: string; quantity: number; unitPriceCents: number; totalCents: number }>>();
  for (const row of items) {
    const list = byOrder.get(row.item.orderId) ?? [];
    list.push({ id: row.item.id, productId: row.item.productId, productName: row.product.name, quantity: row.item.quantity, unitPriceCents: row.item.unitPriceCents, totalCents: row.item.totalCents });
    byOrder.set(row.item.orderId, list);
  }
  return orderRows.map(row => ({ ...row.order, status: effectiveStatus(row.order), client: row.client, items: byOrder.get(row.order.id) ?? [] }));
}

export async function createOrder(actorUserId: number, input: { clientId: number; items: Array<{ productId: number; quantity: number }>; dueDate?: string; notes?: string; orderDate?: string; initialPaymentCents?: number }) {
  const db = await getDb();
  if (!input.items.length) throw new Error("Adicione pelo menos um produto");
  if (!db) {
    const store = getStore();
    const productsById = new Map(store.products.map(p => [p.id, p]));
    const normalizedItems = input.items.map(item => {
      const product = productsById.get(item.productId);
      if (!product || !product.active) throw new Error("Produto não encontrado ou inativo");
      if (item.quantity < 1) throw new Error("A quantidade precisa ser maior que zero");
      return { productId: product.id, quantity: item.quantity, unitPriceCents: product.priceCents, totalCents: product.priceCents * item.quantity };
    });
    const totalCents = normalizedItems.reduce((sum, item) => sum + item.totalCents, 0);
    const paidCents = Math.min(input.initialPaymentCents ?? 0, totalCents);
    const dueDate = input.dueDate ? new Date(`${input.dueDate}T23:59:59`) : null;
    const status = deriveStatus(totalCents, paidCents, dueDate);
    const code = `PV-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;
    const now = new Date();
    store.counters.orders += 1;
    const orderId = store.counters.orders;
    store.orders.push({
      id: orderId,
      code,
      clientId: input.clientId,
      totalCents,
      paidCents,
      status,
      orderDate: input.orderDate ? new Date(input.orderDate) : now,
      dueDate,
      notes: input.notes?.trim() || null,
      createdAt: now,
      updatedAt: now,
    });
    for (const item of normalizedItems) {
      store.counters.orderItems += 1;
      store.orderItems.push({
        id: store.counters.orderItems,
        orderId,
        ...item,
        createdAt: now,
      });
    }
    if (paidCents > 0) {
      store.counters.payments += 1;
      store.payments.push({
        id: store.counters.payments,
        orderId,
        amountCents: paidCents,
        paidAt: now,
        method: "Pagamento inicial",
        notes: "Registrado na criação do pedido",
        createdAt: now,
      });
    }
    await writeAudit(null, actorUserId, "create", "order", String(orderId), { code, totalCents, itemCount: normalizedItems.length });
    await saveStore();
    return { id: orderId, code };
  }

  const productIds = [...new Set(input.items.map(item => item.productId))];
  const productRows = await db.select().from(products).where(and(...productIds.map(id => eq(products.id, id))));
  const productsById = new Map(productRows.map(product => [product.id, product]));
  const normalizedItems = input.items.map(item => {
    const product = productsById.get(item.productId);
    if (!product || !product.active) throw new Error("Produto não encontrado ou inativo");
    if (item.quantity < 1) throw new Error("A quantidade precisa ser maior que zero");
    return { productId: product.id, quantity: item.quantity, unitPriceCents: product.priceCents, totalCents: product.priceCents * item.quantity };
  });
  const totalCents = normalizedItems.reduce((sum, item) => sum + item.totalCents, 0);
  const paidCents = Math.min(input.initialPaymentCents ?? 0, totalCents);
  const dueDate = input.dueDate ? new Date(`${input.dueDate}T23:59:59`) : null;
  const status = deriveStatus(totalCents, paidCents, dueDate);
  const code = `PV-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;

  return db.transaction(async tx => {
    const [result] = await tx.insert(orders).values({
      code,
      clientId: input.clientId,
      totalCents,
      paidCents,
      status,
      orderDate: input.orderDate ? new Date(input.orderDate) : new Date(),
      dueDate,
      notes: input.notes?.trim() || null,
    });
    const orderId = Number((result as any).insertId);
    await tx.insert(orderItems).values(normalizedItems.map(item => ({ ...item, orderId })));
    if (paidCents > 0) await tx.insert(payments).values({ orderId, amountCents: paidCents, method: "Pagamento inicial", notes: "Registrado na criação do pedido" });
    await writeAudit(tx, actorUserId, "create", "order", String(orderId), { code, totalCents, itemCount: normalizedItems.length });
    return { id: orderId, code };
  });
}

export async function updateOrder(actorUserId: number, orderId: number, input: { clientId: number; items: Array<{ productId: number; quantity: number; unitPriceCents?: number }>; dueDate?: string; notes?: string }) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const existing = store.orders.find(o => o.id === orderId);
    if (!existing) throw new Error("Pedido não encontrado");
    if (existing.status === "cancelled") throw new Error("Não é possível editar um pedido cancelado");
    if (!input.items.length) throw new Error("Adicione pelo menos um produto");
    const productsById = new Map(store.products.map(p => [p.id, p]));
    const normalizedItems = input.items.map(item => {
      const product = productsById.get(item.productId);
      if (!product) throw new Error("Produto não encontrado");
      if (item.quantity < 1) throw new Error("A quantidade precisa ser maior que zero");
      const unitPriceCents = item.unitPriceCents ?? product.priceCents;
      return { productId: product.id, quantity: item.quantity, unitPriceCents, totalCents: unitPriceCents * item.quantity };
    });
    const totalCents = normalizedItems.reduce((sum, item) => sum + item.totalCents, 0);
    if (existing.paidCents > totalCents) throw new Error("O novo total não pode ser menor que o valor já recebido");
    const dueDate = input.dueDate ? new Date(`${input.dueDate}T23:59:59`) : null;
    const status = deriveStatus(totalCents, existing.paidCents, dueDate);
    const now = new Date();
    existing.clientId = input.clientId;
    existing.totalCents = totalCents;
    existing.status = status;
    existing.dueDate = dueDate;
    existing.notes = input.notes?.trim() || null;
    existing.updatedAt = now;
    store.orderItems = store.orderItems.filter(i => i.orderId !== orderId);
    for (const item of normalizedItems) {
      store.counters.orderItems += 1;
      store.orderItems.push({
        id: store.counters.orderItems,
        orderId,
        ...item,
        createdAt: now,
      });
    }
    await writeAudit(null, actorUserId, "update", "order", String(orderId), { totalCents, itemCount: normalizedItems.length });
    await saveStore();
    return { ok: true, totalCents, status };
  }

  const existingRows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const existing = existingRows[0];
  if (!existing) throw new Error("Pedido não encontrado");
  if (existing.status === "cancelled") throw new Error("Não é possível editar um pedido cancelado");
  if (!input.items.length) throw new Error("Adicione pelo menos um produto");
  const productIds = [...new Set(input.items.map(item => item.productId))];
  const productRows = await db.select().from(products).where(and(...productIds.map(id => eq(products.id, id))));
  const productsById = new Map(productRows.map(product => [product.id, product]));
  const normalizedItems = input.items.map(item => {
    const product = productsById.get(item.productId);
    if (!product) throw new Error("Produto não encontrado");
    if (item.quantity < 1) throw new Error("A quantidade precisa ser maior que zero");
    const unitPriceCents = item.unitPriceCents ?? product.priceCents;
    return { productId: product.id, quantity: item.quantity, unitPriceCents, totalCents: unitPriceCents * item.quantity };
  });
  const totalCents = normalizedItems.reduce((sum, item) => sum + item.totalCents, 0);
  if (existing.paidCents > totalCents) throw new Error("O novo total não pode ser menor que o valor já recebido");
  const dueDate = input.dueDate ? new Date(`${input.dueDate}T23:59:59`) : null;
  const status = deriveStatus(totalCents, existing.paidCents, dueDate);
  return db.transaction(async tx => {
    await tx.update(orders).set({ clientId: input.clientId, totalCents, status, dueDate, notes: input.notes?.trim() || null }).where(eq(orders.id, orderId));
    await tx.delete(orderItems).where(eq(orderItems.orderId, orderId));
    await tx.insert(orderItems).values(normalizedItems.map(item => ({ ...item, orderId })));
    await writeAudit(tx, actorUserId, "update", "order", String(orderId), { totalCents, itemCount: normalizedItems.length });
    return { ok: true, totalCents, status };
  });
}

export async function getOrderDetail(id: number) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const order = store.orders.find(o => o.id === id);
    if (!order) return null;
    const client = store.clients.find(c => c.id === order.clientId);
    if (!client) return null;
    const productMap = new Map(store.products.map(p => [p.id, p]));
    const items = store.orderItems
      .filter(i => i.orderId === id && productMap.has(i.productId))
      .map(item => ({ ...item, product: productMap.get(item.productId)! }));
    const paymentRows = store.payments
      .filter(p => p.orderId === id)
      .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime());
    return {
      ...order,
      status: effectiveStatus(order),
      client,
      items,
      payments: paymentRows,
    };
  }
  const baseRows = await db.select({ order: orders, client: clients }).from(orders).innerJoin(clients, eq(orders.clientId, clients.id)).where(eq(orders.id, id)).limit(1);
  const base = baseRows[0];
  if (!base) return null;
  const [itemRows, paymentRows] = await Promise.all([
    db.select({ item: orderItems, product: products }).from(orderItems).innerJoin(products, eq(orderItems.productId, products.id)).where(eq(orderItems.orderId, id)),
    db.select().from(payments).where(eq(payments.orderId, id)).orderBy(desc(payments.paidAt)),
  ]);
  return { ...base.order, status: effectiveStatus(base.order), client: base.client, items: itemRows.map(row => ({ ...row.item, product: row.product })), payments: paymentRows };
}

export async function recordPayment(actorUserId: number, input: { orderId: number; amountCents: number; method?: string; notes?: string; paidAt?: string }) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const order = store.orders.find(o => o.id === input.orderId);
    if (!order) throw new Error("Pedido não encontrado");
    if (order.status === "cancelled") throw new Error("Não é possível pagar um pedido cancelado");
    const remaining = Math.max(0, order.totalCents - order.paidCents);
    if (input.amountCents < 1 || input.amountCents > remaining) throw new Error("Informe um valor até o saldo restante");
    const paidCents = order.paidCents + input.amountCents;
    const status = deriveStatus(order.totalCents, paidCents, order.dueDate);
    const now = new Date();
    store.counters.payments += 1;
    const paymentId = store.counters.payments;
    store.payments.push({
      id: paymentId,
      orderId: input.orderId,
      amountCents: input.amountCents,
      method: input.method?.trim() || null,
      notes: input.notes?.trim() || null,
      paidAt: input.paidAt ? new Date(input.paidAt) : now,
      createdAt: now,
    });
    order.paidCents = paidCents;
    order.status = status;
    order.updatedAt = now;
    await writeAudit(null, actorUserId, "create", "payment", String(paymentId), { orderId: input.orderId, amountCents: input.amountCents });
    await saveStore();
    return { paidCents, status };
  }
  const orderRows = await db.select().from(orders).where(eq(orders.id, input.orderId)).limit(1);
  const order = orderRows[0];
  if (!order) throw new Error("Pedido não encontrado");
  if (order.status === "cancelled") throw new Error("Não é possível pagar um pedido cancelado");
  const remaining = Math.max(0, order.totalCents - order.paidCents);
  if (input.amountCents < 1 || input.amountCents > remaining) throw new Error("Informe um valor até o saldo restante");
  const paidCents = order.paidCents + input.amountCents;
  const status = deriveStatus(order.totalCents, paidCents, order.dueDate);
  return db.transaction(async tx => {
    const [result] = await tx.insert(payments).values({ orderId: input.orderId, amountCents: input.amountCents, method: input.method?.trim() || null, notes: input.notes?.trim() || null, paidAt: input.paidAt ? new Date(input.paidAt) : new Date() });
    await tx.update(orders).set({ paidCents, status }).where(eq(orders.id, input.orderId));
    await writeAudit(tx, actorUserId, "create", "payment", String((result as any).insertId), { orderId: input.orderId, amountCents: input.amountCents });
    return { paidCents, status };
  });
}

export async function cancelOrder(actorUserId: number, orderId: number) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const order = store.orders.find(o => o.id === orderId);
    if (order) {
      order.status = "cancelled";
      order.updatedAt = new Date();
    }
    await writeAudit(null, actorUserId, "cancel", "order", String(orderId));
    await saveStore();
    return { ok: true };
  }
  await db.update(orders).set({ status: "cancelled" }).where(eq(orders.id, orderId));
  await writeAudit(db, actorUserId, "cancel", "order", String(orderId));
  return { ok: true };
}

export async function getProductDetail(productId: number) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const product = store.products.find(p => p.id === productId);
    if (!product) return null;
    const orderMap = new Map(store.orders.map(o => [o.id, o]));
    const clientMap = new Map(store.clients.map(c => [c.id, c]));
    const rows = store.orderItems
      .filter(i => i.productId === productId && orderMap.has(i.orderId))
      .map(item => {
        const order = orderMap.get(item.orderId)!;
        const client = clientMap.get(order.clientId);
        return client ? { item, order, client } : null;
      })
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .sort((a, b) => b.order.orderDate.getTime() - a.order.orderDate.getTime());

    const orderIds = [...new Set(rows.map(row => row.order.id))];
    const fullItems = store.orderItems.filter(item => orderIds.includes(item.orderId));
    const allocationByItem = new Map<number, number>();
    for (const orderId of orderIds) {
      const orderRows = rows.filter(row => row.order.id === orderId);
      const order = orderRows[0]?.order;
      if (!order) continue;
      const itemsForOrder = fullItems.filter(item => item.orderId === orderId);
      const bases = itemsForOrder.map(item => ({
        id: item.id,
        base: order.totalCents > 0 ? Math.floor((order.paidCents * item.totalCents) / order.totalCents) : 0,
        remainder: order.totalCents > 0 ? (order.paidCents * item.totalCents) % order.totalCents : 0,
      }));
      let leftover = order.paidCents - bases.reduce((sum, item) => sum + item.base, 0);
      for (const item of bases.sort((a, b) => b.remainder - a.remainder)) {
        const extra = leftover > 0 ? 1 : 0;
        allocationByItem.set(item.id, item.base + extra);
        leftover -= extra;
      }
    }
    const items = rows.map(row => {
      const paidAllocation = allocationByItem.get(row.item.id) ?? 0;
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
        dueDate: row.order.dueDate,
      };
    });
    const activeItems = items.filter(item => item.status !== "cancelled");
    return {
      product,
      items,
      stats: {
        totalPieces: activeItems.reduce((sum, item) => sum + item.quantity, 0),
        totalClients: new Set(activeItems.map(item => item.client.id)).size,
        soldCents: activeItems.reduce((sum, item) => sum + item.totalCents, 0),
        receivedCents: activeItems.reduce((sum, item) => sum + item.paidCents, 0),
        pendingCents: activeItems.reduce((sum, item) => sum + item.remainingCents, 0),
        paidOrders: items.filter(item => item.status === "paid").length,
        pendingOrders: items.filter(item => item.status === "pending" || item.status === "overdue").length,
        partialOrders: items.filter(item => item.status === "partial").length,
        cancelledOrders: items.filter(item => item.status === "cancelled").length,
      },
    };
  }

  const productRows = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  const product = productRows[0];
  if (!product) return null;
  const rows = await db.select({ item: orderItems, order: orders, client: clients }).from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id)).innerJoin(clients, eq(orders.clientId, clients.id)).where(eq(orderItems.productId, productId)).orderBy(desc(orders.orderDate));
  const orderIds = [...new Set(rows.map(row => row.order.id))];
  const fullItems = orderIds.length ? await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)) : [];
  const allocationByItem = new Map<number, number>();
  for (const orderId of orderIds) {
    const orderRows = rows.filter(row => row.order.id === orderId);
    const order = orderRows[0]?.order;
    if (!order) continue;
    const itemsForOrder = fullItems.filter(item => item.orderId === orderId);
    const bases = itemsForOrder.map(item => ({ id: item.id, base: order.totalCents > 0 ? Math.floor(order.paidCents * item.totalCents / order.totalCents) : 0, remainder: order.totalCents > 0 ? (order.paidCents * item.totalCents) % order.totalCents : 0 }));
    let leftover = order.paidCents - bases.reduce((sum, item) => sum + item.base, 0);
    for (const item of bases.sort((a, b) => b.remainder - a.remainder)) {
      const extra = leftover > 0 ? 1 : 0;
      allocationByItem.set(item.id, item.base + extra);
      leftover -= extra;
    }
  }
  const items = rows.map(row => {
    const paidAllocation = allocationByItem.get(row.item.id) ?? 0;
    return { id: row.item.id, orderId: row.order.id, code: row.order.code, client: row.client, quantity: row.item.quantity, unitPriceCents: row.item.unitPriceCents, totalCents: row.item.totalCents, paidCents: paidAllocation, remainingCents: Math.max(0, row.item.totalCents - paidAllocation), status: effectiveStatus(row.order), orderDate: row.order.orderDate, dueDate: row.order.dueDate };
  });
  const activeItems = items.filter(item => item.status !== "cancelled");
  return {
    product,
    items,
    stats: {
      totalPieces: activeItems.reduce((sum, item) => sum + item.quantity, 0),
      totalClients: new Set(activeItems.map(item => item.client.id)).size,
      soldCents: activeItems.reduce((sum, item) => sum + item.totalCents, 0),
      receivedCents: activeItems.reduce((sum, item) => sum + item.paidCents, 0),
      pendingCents: activeItems.reduce((sum, item) => sum + item.remainingCents, 0),
      paidOrders: items.filter(item => item.status === "paid").length,
      pendingOrders: items.filter(item => item.status === "pending" || item.status === "overdue").length,
      partialOrders: items.filter(item => item.status === "partial").length,
      cancelledOrders: items.filter(item => item.status === "cancelled").length,
    },
  };
}

const defaultTemplates = [
  { name: "Cobrança amigável", body: "Oi, {nome_cliente}! Tudo bem? Passando para lembrar sobre o pagamento do seu pedido no valor de {valor_pendente}. Qualquer dúvida estou à disposição!" },
  { name: "Primeiro lembrete", body: "Olá, {nome_cliente}! Estou passando para lembrar que seu pagamento ainda está pendente no valor de {valor_pendente}. Assim que realizar, pode me enviar o comprovante. Obrigada!" },
  { name: "Segundo lembrete", body: "Oi, {nome_cliente}! Seu pedido continua com pagamento pendente no valor de {valor_pendente}. Quando puder, me confirme a previsão de pagamento." },
  { name: "Cobrança direta", body: "Oi, {nome_cliente}! Seu pedido está com pagamento pendente no valor de {valor_pendente}. Consegue realizar o pagamento hoje?" },
  { name: "Confirmação de pagamento", body: "Olá, {nome_cliente}! Recebi seu pagamento de {valor_pago}. Obrigada pela confiança!" },
  { name: "Agradecimento", body: "Obrigada pela compra, {nome_cliente}! Qualquer coisa estou à disposição." },
];

export async function listTemplates() {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    if (store.chargeTemplates.length === 0) {
      const now = new Date();
      for (const tpl of defaultTemplates) {
        store.counters.chargeTemplates += 1;
        store.chargeTemplates.push({
          id: store.counters.chargeTemplates,
          name: tpl.name,
          body: tpl.body,
          createdAt: now,
          updatedAt: now,
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

export async function updateTemplate(actorUserId: number, id: number, body: string) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const tpl = store.chargeTemplates.find(t => t.id === id);
    if (tpl) {
      tpl.body = body.trim();
      tpl.updatedAt = new Date();
    }
    await writeAudit(null, actorUserId, "update", "charge_template", String(id));
    await saveStore();
    return { ok: true };
  }
  await db.update(chargeTemplates).set({ body: body.trim() }).where(eq(chargeTemplates.id, id));
  await writeAudit(db, actorUserId, "update", "charge_template", String(id));
  return { ok: true };
}

export async function listCharges() {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const clientMap = new Map(store.clients.map(c => [c.id, c]));
    const orderMap = new Map(store.orders.map(o => [o.id, o]));
    const tplMap = new Map(store.chargeTemplates.map(t => [t.id, t]));
    return store.charges
      .filter(c => clientMap.has(c.clientId) && orderMap.has(c.orderId))
      .map(charge => ({
        ...charge,
        client: clientMap.get(charge.clientId)!,
        order: orderMap.get(charge.orderId)!,
        template: charge.templateId ? tplMap.get(charge.templateId) ?? null : null,
      }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  const rows = await db.select({ charge: charges, client: clients, order: orders, template: chargeTemplates }).from(charges).innerJoin(clients, eq(charges.clientId, clients.id)).innerJoin(orders, eq(charges.orderId, orders.id)).leftJoin(chargeTemplates, eq(charges.templateId, chargeTemplates.id)).orderBy(desc(charges.createdAt));
  return rows.map(row => ({ ...row.charge, client: row.client, order: row.order, template: row.template }));
}

export async function createCharge(actorUserId: number, input: { orderId: number; templateId?: number; message: string; action: "prepared" | "whatsapp_opened" | "manual_sent" }) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const order = store.orders.find(o => o.id === input.orderId);
    if (!order) throw new Error("Pedido não encontrado");
    store.counters.charges += 1;
    const id = store.counters.charges;
    store.charges.push({
      id,
      orderId: input.orderId,
      clientId: order.clientId,
      templateId: input.templateId ?? null,
      message: input.message,
      action: input.action,
      createdAt: new Date(),
    });
    await writeAudit(null, actorUserId, "create", "charge", String(id), { orderId: input.orderId, action: input.action });
    await saveStore();
    return { id };
  }
  const orderRows = await db.select().from(orders).where(eq(orders.id, input.orderId)).limit(1);
  const order = orderRows[0];
  if (!order) throw new Error("Pedido não encontrado");
  const [result] = await db.insert(charges).values({ orderId: input.orderId, clientId: order.clientId, templateId: input.templateId ?? null, message: input.message, action: input.action });
  await writeAudit(db, actorUserId, "create", "charge", String((result as any).insertId), { orderId: input.orderId, action: input.action });
  return { id: Number((result as any).insertId) };
}

export async function getReportRows(input: { productId?: number; from?: string; to?: string; orderIds?: number[] }) {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    const orderMap = new Map(store.orders.map(o => [o.id, o]));
    const clientMap = new Map(store.clients.map(c => [c.id, c]));
    const productMap = new Map(store.products.map(p => [p.id, p]));
    const rows = store.orderItems
      .filter(i => {
        if (input.productId && i.productId !== input.productId) return false;
        return orderMap.has(i.orderId) && productMap.has(i.productId);
      })
      .map(item => {
        const order = orderMap.get(item.orderId)!;
        const client = clientMap.get(order.clientId);
        const product = productMap.get(item.productId)!;
        return client ? { item, order, client, product } : null;
      })
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .sort((a, b) => a.product.name.localeCompare(b.product.name) || a.client.name.localeCompare(b.client.name));

    return rows
      .filter(row => {
        if (row.order.status === "cancelled") return false;
        if (input.orderIds?.length && !input.orderIds.includes(row.order.id)) return false;
        if (input.from && row.order.orderDate < new Date(`${input.from}T00:00:00`)) return false;
        if (input.to && row.order.orderDate > new Date(`${input.to}T23:59:59`)) return false;
        return true;
      })
      .map(row => ({
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
      }));
  }
  const rows = await db.select({ item: orderItems, order: orders, client: clients, product: products }).from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id)).innerJoin(clients, eq(orders.clientId, clients.id)).innerJoin(products, eq(orderItems.productId, products.id)).where(input.productId ? eq(orderItems.productId, input.productId) : undefined).orderBy(products.name, clients.name);
  return rows.filter(row => {
    if (row.order.status === "cancelled") return false;
    if (input.orderIds?.length && !input.orderIds.includes(row.order.id)) return false;
    if (input.from && row.order.orderDate < new Date(`${input.from}T00:00:00`)) return false;
    if (input.to && row.order.orderDate > new Date(`${input.to}T23:59:59`)) return false;
    return true;
  }).map(row => ({
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
  }));
}

export async function getAuditLogs() {
  const db = await getDb();
  if (!db) {
    const store = getStore();
    return store.auditLogs.slice(0, 100);
  }
  return db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100);
}

/** Auditoria para módulos fora deste arquivo (grava no banco ou no store local). */
export async function recordAudit(actorUserId: number, action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>) {
  const db = await getDb();
  await writeAudit(db, actorUserId, action, entityType, entityId, metadata);
}

/** Saldo atual de um pedido; null se não existir ou estiver cancelado. */
export async function getOrderBalance(orderId: number): Promise<number | null> {
  const order = await getOrderDetail(orderId);
  if (!order || order.status === "cancelled") return null;
  return Math.max(0, order.totalCents - order.paidCents);
}

export async function syncLocalToCloud() {
  const store = getStore();
  const ok = await pushStoreToFirestore(store, true);
  return {
    ok,
    products: store.products.length,
    clients: store.clients.length,
    orders: store.orders.length,
  };
}
