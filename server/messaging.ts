import { TRPCError } from "@trpc/server";
import {
  type ActionStatus,
  MAX_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  advanceAfterAck,
  canAdvanceStatus,
  firstRunAt,
  isAllowedWhatsAppUrl,
  isValidTimezone,
  occurrenceKey,
  parseClock,
  snoozeUntil,
  type ReminderSchedule,
} from "../shared/messaging";
import type {
  MessageActionKind,
  MessageActionRecord,
  MessageDestination,
  MessageDestinationType,
  MessageReminder,
  MessagingRepo,
  ReminderKind,
  ReminderOutcome,
  ReminderStatus,
} from "./messagingTypes";

/**
 * Situação real da integração. Não existe envio automático neste projeto:
 * lembretes só avisam a administradora e toda mensagem sai por ação manual dela.
 * A API oficial (Cloud API) não publica em grupos já existentes de clientes
 * (grupos da API são criados pela empresa, por convite, com poucos participantes),
 * então `api_confirmed` nunca é gravado por este código.
 */
export const INTEGRATION_STATUS = {
  officialApiEnabled: false,
  autoSendAvailable: false,
  summary:
    "Envio automático desativado: não há integração oficial do WhatsApp configurada. Lembretes só avisam você; cada mensagem é copiada/aberta por você e o envio precisa ser confirmado manualmente.",
} as const;

export type MessagingDeps = {
  repo: MessagingRepo;
  audit: (actorUserId: number, action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>) => Promise<void>;
  registerCharge?: (actorUserId: number, input: { orderId: number; message: string; action: "whatsapp_opened" | "manual_sent" }) => Promise<void>;
  /** Saldo atual do pedido (null se inexistente/cancelado). */
  getOrderBalance?: (orderId: number) => Promise<number | null>;
  now?: () => Date;
};

export type DestinationInput = { id?: number; name: string; description?: string; inviteUrl?: string; active?: boolean };
export type LotInput = { productId: number; name?: string; goalPieces: number | null };
export type ReminderInput = {
  id?: number;
  kind: ReminderKind;
  title?: string;
  productId?: number | null;
  destinationId?: number | null;
  intervalMinutes: number;
  startAt?: Date;
  timezone: string;
  quietStart?: string | null;
  quietEnd?: string | null;
};
export type ActionInput = {
  idempotencyKey: string;
  kind: MessageActionKind;
  status: Exclude<ActionStatus, "api_confirmed">;
  destinationType: MessageDestinationType;
  destinationId?: number | null;
  clientId?: number | null;
  orderId?: number | null;
  productId?: number | null;
  reminderId?: number | null;
  title: string;
  message: string;
  /** Saldo exibido na prévia da cobrança; o servidor recusa o envio se mudou. */
  expectedBalanceCents?: number;
};

const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const DEFAULT_TITLES: Record<ReminderKind, string> = { group_update: "Atualizar o grupo", charges_review: "Revisar cobranças" };
const RECENT_LIMIT = { events: 40, actions: 80 };

function parseLog(raw: string): Array<{ status: ActionStatus; at: string }> {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sameInstant(a: Date | null | undefined, b: Date | null | undefined) {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

export function createMessagingService(deps: MessagingDeps) {
  const { repo, audit } = deps;
  const now = () => (deps.now ? deps.now() : new Date());

  const scheduleOf = (reminder: Pick<MessageReminder, "intervalMinutes" | "anchorAt" | "timezone" | "quietStart" | "quietEnd">): ReminderSchedule => ({
    intervalMinutes: reminder.intervalMinutes,
    anchorAt: reminder.anchorAt,
    timezone: reminder.timezone,
    quietStart: reminder.quietStart,
    quietEnd: reminder.quietEnd,
  });

  /** Pausa temporária vencida volta a ativa, sem rajada de ocorrências atrasadas. */
  async function resumeExpired(): Promise<boolean> {
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

  async function assertDestination(id?: number | null) {
    if (!id) return;
    if (!(await repo.destinations()).some(destination => destination.id === id)) throw bad("Destino não encontrado");
  }

  return {
    async overview() {
      if (await resumeExpired()) await repo.commit();
      const [destinations, lots, reminders, events, actions] = await Promise.all([
        repo.destinations(),
        repo.lots(),
        repo.reminders(),
        repo.recentEvents(RECENT_LIMIT.events),
        repo.recentActions(RECENT_LIMIT.actions),
      ]);
      return {
        serverNow: now(),
        integration: INTEGRATION_STATUS,
        destinations,
        lots,
        reminders: reminders.filter(reminder => reminder.status !== "discarded"),
        events,
        actions,
      };
    },

    async saveDestination(actor: number, input: DestinationInput) {
      const name = input.name.trim();
      if (name.length < 2 || name.length > 80) throw bad("Informe um nome de 2 a 80 caracteres");
      const inviteUrl = input.inviteUrl?.trim() || null;
      if (inviteUrl && !isAllowedWhatsAppUrl(inviteUrl)) throw bad("O link precisa ser https e do próprio WhatsApp (chat.whatsapp.com ou wa.me)");
      const description = input.description?.trim().slice(0, 280) || null;
      const current = now();
      const existing = input.id ? (await repo.destinations()).find(destination => destination.id === input.id) : undefined;
      if (input.id && !existing) throw new TRPCError({ code: "NOT_FOUND", message: "Destino não encontrado" });
      const saved = await repo.saveDestination({
        id: existing?.id,
        name,
        kind: "group",
        description,
        inviteUrl,
        active: input.active ?? existing?.active ?? true,
        createdAt: existing?.createdAt ?? current,
        updatedAt: current,
      });
      await audit(actor, existing ? "update" : "create", "message_destination", String(saved.id), { name, active: saved.active });
      await repo.commit();
      return saved;
    },

    async saveLot(actor: number, input: LotInput) {
      if (input.goalPieces !== null && (!Number.isInteger(input.goalPieces) || input.goalPieces < 1 || input.goalPieces > 1_000_000)) {
        throw bad("A meta precisa ser um número inteiro maior que zero (ou vazia)");
      }
      const current = now();
      const existing = (await repo.lots()).find(lot => lot.productId === input.productId);
      const saved = await repo.saveLot({
        id: existing?.id,
        productId: input.productId,
        name: input.name?.trim().slice(0, 160) || existing?.name || null,
        goalPieces: input.goalPieces,
        createdAt: existing?.createdAt ?? current,
        updatedAt: current,
      });
      await audit(actor, existing ? "update" : "create", "message_lot", String(saved.id), { productId: input.productId, goalPieces: input.goalPieces });
      await repo.commit();
      return saved;
    },

    async saveReminder(actor: number, input: ReminderInput) {
      if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < MIN_INTERVAL_MINUTES || input.intervalMinutes > MAX_INTERVAL_MINUTES) {
        throw bad(`O intervalo precisa ficar entre ${MIN_INTERVAL_MINUTES} minutos e 7 dias`);
      }
      if (!isValidTimezone(input.timezone)) throw bad("Fuso horário inválido");
      const quietStart = input.quietStart || null;
      const quietEnd = input.quietEnd || null;
      if ((quietStart === null) !== (quietEnd === null)) throw bad("Informe início e fim do horário silencioso");
      if (quietStart !== null && (parseClock(quietStart) === null || parseClock(quietEnd) === null)) throw bad("Horário silencioso inválido (use HH:mm)");
      if (input.startAt && Number.isNaN(input.startAt.getTime())) throw bad("Data de início inválida");
      await assertDestination(input.destinationId);

      const current = now();
      const existing = input.id ? (await repo.reminders()).find(reminder => reminder.id === input.id) : undefined;
      if (input.id && !existing) throw new TRPCError({ code: "NOT_FOUND", message: "Lembrete não encontrado" });
      if (existing && (existing.status === "discarded" || existing.status === "completed")) throw bad("Reative o lembrete antes de editar");

      const anchorAt = input.startAt ?? existing?.anchorAt ?? current;
      const schedule: ReminderSchedule = { intervalMinutes: input.intervalMinutes, anchorAt, timezone: input.timezone, quietStart, quietEnd };
      const scheduleUnchanged =
        existing &&
        existing.intervalMinutes === input.intervalMinutes &&
        sameInstant(existing.anchorAt, anchorAt) &&
        existing.timezone === input.timezone &&
        existing.quietStart === quietStart &&
        existing.quietEnd === quietEnd;
      // Mantém uma ocorrência já vencida e ainda não tratada quando só título/destino mudam.
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
        updatedAt: current,
      });
      await audit(actor, existing ? "update" : "create", "message_reminder", String(saved.id), { kind: saved.kind, intervalMinutes: saved.intervalMinutes, timezone: saved.timezone });
      await repo.commit();
      return saved;
    },

    async setReminderStatus(actor: number, input: { id: number; status: ReminderStatus; pauseMinutes?: number }) {
      const current = now();
      const existing = (await repo.reminders()).find(reminder => reminder.id === input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Lembrete não encontrado" });
      if (existing.status === "discarded") throw bad("Lembrete descartado não pode ser alterado");
      if (existing.status === input.status && input.status !== "paused") return existing;

      let patch: Partial<MessageReminder>;
      let auditAction: string;
      if (input.status === "paused") {
        if (input.pauseMinutes !== undefined && (!Number.isInteger(input.pauseMinutes) || input.pauseMinutes < 1 || input.pauseMinutes > 60 * 24 * 30)) throw bad("Tempo de pausa inválido");
        patch = { status: "paused", pausedUntil: input.pauseMinutes ? new Date(current.getTime() + input.pauseMinutes * 60_000) : null };
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
      return (await repo.reminders())
        .filter(reminder => reminder.status === "active" && reminder.nextDueAt && reminder.nextDueAt.getTime() <= current)
        .map(reminder => ({ ...reminder, key: occurrenceKey(reminder.id, reminder.nextDueAt as Date) }));
    },

    /** Concluir/dispensar/adiar uma ocorrência. Repetir a mesma chave é inofensivo. */
    async ackReminder(actor: number, input: { id: number; key: string; outcome: ReminderOutcome; snoozeMinutes?: number }) {
      const current = now();
      const reminder = (await repo.reminders()).find(item => item.id === input.id);
      if (!reminder) throw new TRPCError({ code: "NOT_FOUND", message: "Lembrete não encontrado" });
      if (await repo.eventByKey(input.key)) return { ignored: true as const, reason: "duplicate" as const, reminder };
      if (reminder.status !== "active" || !reminder.nextDueAt || occurrenceKey(reminder.id, reminder.nextDueAt) !== input.key) {
        return { ignored: true as const, reason: "stale" as const, reminder };
      }
      if (input.outcome === "snoozed" && (!input.snoozeMinutes || input.snoozeMinutes < 1 || input.snoozeMinutes > 24 * 60)) throw bad("Informe um adiamento entre 1 minuto e 24 horas");

      const schedule = scheduleOf(reminder);
      const nextDueAt = input.outcome === "snoozed" ? snoozeUntil(schedule, current, input.snoozeMinutes as number) : advanceAfterAck(schedule, reminder.nextDueAt, current);
      await repo.insertEvent({ reminderId: reminder.id, key: input.key, dueAt: reminder.nextDueAt, outcome: input.outcome, createdAt: current });
      const saved = await repo.saveReminder({ ...reminder, nextDueAt, lastAckAt: current, updatedAt: current });
      await audit(actor, `ack_${input.outcome}`, "message_reminder", String(reminder.id), { key: input.key });
      await repo.commit();
      return { ignored: false as const, reminder: saved };
    },

    /** Registra o que realmente aconteceu com uma mensagem (idempotente por chave). */
    async recordAction(actor: number, input: ActionInput): Promise<{ action: MessageActionRecord; ignored: boolean }> {
      const message = input.message.trim();
      const title = input.title.trim();
      if (!message || message.length > 2000) throw bad("A mensagem precisa ter entre 1 e 2000 caracteres");
      if (!title || title.length > 200) throw bad("Título inválido");
      if (input.kind === "charge" && (!input.orderId || !input.clientId)) throw bad("Cobrança exige pedido e cliente");
      if (input.destinationType === "group") await assertDestination(input.destinationId);

      const current = now();
      const existing = await repo.actionByKey(input.idempotencyKey);
      if (existing && !canAdvanceStatus(existing.status, input.status)) return { action: existing, ignored: true };

      const previous = existing?.status ?? null;
      const crossesShare = input.status === "share_started" || (input.status === "manual_confirmed" && !(previous === "share_started"));
      if (input.kind === "charge" && input.orderId && input.expectedBalanceCents !== undefined && crossesShare && (previous === null || previous === "draft" || previous === "ready" || previous === "reminder_pending")) {
        const balance = deps.getOrderBalance ? await deps.getOrderBalance(input.orderId) : null;
        if (balance === null || balance !== input.expectedBalanceCents) {
          throw new TRPCError({ code: "CONFLICT", message: "O saldo do pedido mudou desde a prévia. Revise a mensagem atualizada antes de continuar." });
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
        updatedAt: current,
      });

      if (saved.kind === "charge" && saved.orderId && deps.registerCharge) {
        if (input.status === "share_started") await deps.registerCharge(actor, { orderId: saved.orderId, message, action: "whatsapp_opened" });
        if (input.status === "manual_confirmed") await deps.registerCharge(actor, { orderId: saved.orderId, message, action: "manual_sent" });
      }
      const auditAction = input.status === "share_started" ? "whatsapp_opened" : input.status === "manual_confirmed" ? "manual_confirm" : "prepare";
      await audit(actor, auditAction, "message_action", String(saved.id), { kind: saved.kind, status: saved.status, orderId: saved.orderId, destinationType: saved.destinationType });
      await repo.commit();
      return { action: saved, ignored: false };
    },
  };
}

export type MessagingService = ReturnType<typeof createMessagingService>;

