import type { ActionStatus } from "../shared/messaging";

export type ReminderKind = "group_update" | "charges_review";
export type ReminderStatus = "active" | "paused" | "completed" | "discarded";
export type ReminderOutcome = "completed" | "dismissed" | "snoozed";
export type MessageActionKind = "group_update" | "charge" | "report";
export type MessageDestinationType = "group" | "client" | "none";

/** Destino configurado manualmente (grupo). Nada é descoberto automaticamente. */
export interface MessageDestination {
  id: number;
  name: string;
  kind: "group";
  description: string | null;
  inviteUrl: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Lote/campanha: um produto com meta opcional de peças. */
export interface MessageLot {
  id: number;
  productId: number;
  name: string | null;
  goalPieces: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageReminder {
  id: number;
  kind: ReminderKind;
  title: string;
  productId: number | null;
  destinationId: number | null;
  intervalMinutes: number;
  anchorAt: Date;
  nextDueAt: Date | null;
  status: ReminderStatus;
  pausedUntil: Date | null;
  timezone: string;
  quietStart: string | null;
  quietEnd: string | null;
  lastAckAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReminderEvent {
  id: number;
  reminderId: number;
  /** Chave única da ocorrência (idempotência). */
  key: string;
  dueAt: Date;
  outcome: ReminderOutcome;
  createdAt: Date;
}

export interface MessageActionRecord {
  id: number;
  kind: MessageActionKind;
  status: ActionStatus;
  destinationType: MessageDestinationType;
  destinationId: number | null;
  clientId: number | null;
  orderId: number | null;
  productId: number | null;
  reminderId: number | null;
  title: string;
  message: string;
  idempotencyKey: string;
  /** JSON: [{ status, at }] — o que realmente aconteceu e quando. */
  statusLog: string;
  createdAt: Date;
  updatedAt: Date;
}

export type NewEntity<T extends { id: number }> = Omit<T, "id"> & { id?: number };

/** Persistência abstrata: implementada para o store local/Firestore e para MySQL. */
export interface MessagingRepo {
  destinations(): Promise<MessageDestination[]>;
  saveDestination(value: NewEntity<MessageDestination>): Promise<MessageDestination>;
  lots(): Promise<MessageLot[]>;
  saveLot(value: NewEntity<MessageLot>): Promise<MessageLot>;
  reminders(): Promise<MessageReminder[]>;
  saveReminder(value: NewEntity<MessageReminder>): Promise<MessageReminder>;
  eventByKey(key: string): Promise<ReminderEvent | null>;
  insertEvent(value: Omit<ReminderEvent, "id">): Promise<ReminderEvent>;
  recentEvents(limit: number): Promise<ReminderEvent[]>;
  actionByKey(key: string): Promise<MessageActionRecord | null>;
  saveAction(value: NewEntity<MessageActionRecord>): Promise<MessageActionRecord>;
  recentActions(limit: number): Promise<MessageActionRecord[]>;
  /** Confirma/sincroniza a escrita (nuvem no store local; no-op no MySQL). */
  commit(): Promise<void>;
}

