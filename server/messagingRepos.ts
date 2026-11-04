import { desc, eq } from "drizzle-orm";
import { messageActions, messageDestinations, messageLots, messageReminderEvents, messageReminders } from "../drizzle/schema";
import { getDb } from "./db";
import { getStore, saveStore, type LocalStoreData } from "./firebaseStore";
import type {
  MessageActionRecord,
  MessageDestination,
  MessageLot,
  MessageReminder,
  MessagingRepo,
  NewEntity,
  ReminderEvent,
} from "./messagingTypes";

const HISTORY_CAP = 300;

/** Repositório do store local/Firestore (o usado na Vercel e sem DATABASE_URL). */
export function createStoreMessagingRepo(): MessagingRepo {
  const nextId = (counter: keyof LocalStoreData["counters"]) => {
    const store = getStore();
    store.counters[counter] += 1;
    return store.counters[counter];
  };
  function upsert<T extends { id: number }>(list: T[], value: NewEntity<T>, counter: keyof LocalStoreData["counters"]): T {
    if (value.id) {
      const index = list.findIndex(item => item.id === value.id);
      if (index >= 0) {
        const updated = { ...value, id: value.id } as T;
        list[index] = updated;
        return updated;
      }
    }
    const created = { ...value, id: nextId(counter) } as T;
    list.push(created);
    return created;
  }
  const newest = <T>(list: T[], pick: (item: T) => number, limit: number) => [...list].sort((a, b) => pick(b) - pick(a)).slice(0, limit);

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
      return getStore().reminderEvents.find(event => event.key === key) ?? null;
    },
    async insertEvent(value) {
      const store = getStore();
      if (store.reminderEvents.some(event => event.key === value.key)) throw new Error("duplicate reminder event");
      const created = { ...value, id: nextId("reminderEvents") } as ReminderEvent;
      store.reminderEvents.push(created);
      if (store.reminderEvents.length > HISTORY_CAP) store.reminderEvents = newest(store.reminderEvents, event => event.createdAt.getTime(), HISTORY_CAP);
      return created;
    },
    async recentEvents(limit) {
      return newest(getStore().reminderEvents, event => event.createdAt.getTime(), limit);
    },
    async actionByKey(key) {
      return getStore().messageActions.find(action => action.idempotencyKey === key) ?? null;
    },
    async saveAction(value) {
      const store = getStore();
      const saved = upsert(store.messageActions, value, "messageActions");
      if (store.messageActions.length > HISTORY_CAP) store.messageActions = newest(store.messageActions, action => action.updatedAt.getTime(), HISTORY_CAP);
      return saved;
    },
    async recentActions(limit) {
      return newest(getStore().messageActions, action => action.updatedAt.getTime(), limit);
    },
    async commit() {
      await saveStore();
    },
  };
}

/**
 * Repositório MySQL/Drizzle (mesmas regras do store local). Requer aplicar a
 * migração `drizzle/0002_message_center.sql`. Ainda não exercitado contra um
 * MySQL real neste repositório.
 */
export function createMysqlMessagingRepo(db: NonNullable<Awaited<ReturnType<typeof getDb>>>): MessagingRepo {
  async function save<T extends { id: number }>(table: any, value: NewEntity<T>, map: (v: any) => any = v => v): Promise<T> {
    const { id, ...rest } = value as any;
    if (id) {
      await db.update(table).set(map(rest)).where(eq(table.id, id));
      const [row] = await db.select().from(table).where(eq(table.id, id)).limit(1);
      return row as T;
    }
    const [result] = await db.insert(table).values(map(rest));
    const [row] = await db.select().from(table).where(eq(table.id, Number((result as any).insertId))).limit(1);
    return row as T;
  }
  const toEvent = (row: any): ReminderEvent => ({ id: row.id, reminderId: row.reminderId, key: row.eventKey, dueAt: row.dueAt, outcome: row.outcome, createdAt: row.createdAt });

  return {
    destinations: async () => (await db.select().from(messageDestinations).orderBy(messageDestinations.id)) as MessageDestination[],
    saveDestination: value => save<MessageDestination>(messageDestinations, value),
    lots: async () => (await db.select().from(messageLots)) as MessageLot[],
    saveLot: value => save<MessageLot>(messageLots, value),
    reminders: async () => (await db.select().from(messageReminders).orderBy(messageReminders.id)) as MessageReminder[],
    saveReminder: value => save<MessageReminder>(messageReminders, value),
    eventByKey: async key => {
      const [row] = await db.select().from(messageReminderEvents).where(eq(messageReminderEvents.eventKey, key)).limit(1);
      return row ? toEvent(row) : null;
    },
    insertEvent: async value => {
      const [result] = await db.insert(messageReminderEvents).values({ reminderId: value.reminderId, eventKey: value.key, dueAt: value.dueAt, outcome: value.outcome, createdAt: value.createdAt });
      return { ...value, id: Number((result as any).insertId) };
    },
    recentEvents: async limit => (await db.select().from(messageReminderEvents).orderBy(desc(messageReminderEvents.createdAt)).limit(limit)).map(toEvent),
    actionByKey: async key => {
      const [row] = await db.select().from(messageActions).where(eq(messageActions.idempotencyKey, key)).limit(1);
      return (row as MessageActionRecord | undefined) ?? null;
    },
    saveAction: value => save<MessageActionRecord>(messageActions, value),
    recentActions: async limit => (await db.select().from(messageActions).orderBy(desc(messageActions.updatedAt)).limit(limit)) as MessageActionRecord[],
    commit: async () => {},
  };
}

export async function getMessagingRepo(): Promise<MessagingRepo> {
  const db = await getDb();
  return db ? createMysqlMessagingRepo(db) : createStoreMessagingRepo();
}

