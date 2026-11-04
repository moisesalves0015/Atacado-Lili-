import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import { createMessagingService, type MessagingDeps } from "./messaging";
import type { TrpcContext } from "./_core/context";
import type {
  MessageActionRecord,
  MessageDestination,
  MessageLot,
  MessageReminder,
  MessagingRepo,
  NewEntity,
  ReminderEvent,
} from "./messagingTypes";

function memoryRepo(): MessagingRepo & { commits: number } {
  let seq = 0;
  const db = { destinations: [] as MessageDestination[], lots: [] as MessageLot[], reminders: [] as MessageReminder[], events: [] as ReminderEvent[], actions: [] as MessageActionRecord[] };
  function upsert<T extends { id: number }>(list: T[], value: NewEntity<T>): T {
    if (value.id) {
      const index = list.findIndex(item => item.id === value.id);
      list[index] = { ...value } as T;
      return list[index];
    }
    const created = { ...value, id: ++seq } as T;
    list.push(created);
    return created;
  }
  const repo = {
    commits: 0,
    destinations: async () => [...db.destinations],
    saveDestination: async (v: NewEntity<MessageDestination>) => upsert(db.destinations, v),
    lots: async () => [...db.lots],
    saveLot: async (v: NewEntity<MessageLot>) => upsert(db.lots, v),
    reminders: async () => [...db.reminders],
    saveReminder: async (v: NewEntity<MessageReminder>) => upsert(db.reminders, v),
    eventByKey: async (key: string) => db.events.find(e => e.key === key) ?? null,
    insertEvent: async (v: Omit<ReminderEvent, "id">) => {
      const created = { ...v, id: ++seq };
      db.events.push(created);
      return created;
    },
    recentEvents: async (limit: number) => db.events.slice(-limit).reverse(),
    actionByKey: async (key: string) => db.actions.find(a => a.idempotencyKey === key) ?? null,
    saveAction: async (v: NewEntity<MessageActionRecord>) => upsert(db.actions, v),
    recentActions: async (limit: number) => db.actions.slice(-limit).reverse(),
    commit: async () => { repo.commits += 1; },
  };
  return repo;
}

function setup(overrides: Partial<MessagingDeps> = {}) {
  const clock = { now: new Date("2026-01-10T11:00:00Z") };
  const repo = memoryRepo();
  const audit = vi.fn(async () => {});
  const registerCharge = vi.fn(async () => {});
  const service = createMessagingService({ repo, audit, registerCharge, getOrderBalance: async () => 5000, now: () => clock.now, ...overrides });
  return { service, repo, audit, registerCharge, clock };
}

const reminderInput = { kind: "group_update" as const, intervalMinutes: 60, timezone: "America/Sao_Paulo", quietStart: "22:00", quietEnd: "07:00", startAt: new Date("2026-01-10T12:00:00Z") };
const actionInput = { idempotencyKey: "charge-1-abcdef", kind: "charge" as const, status: "ready" as const, destinationType: "client" as const, clientId: 1, orderId: 10, title: "Cobrança", message: "Oi, Ana", expectedBalanceCents: 5000 };

describe("lembretes: configuração, pausa e cancelamento", () => {
  it("cria lembretes com os padrões sugeridos de 1h e 2h e mostra a próxima ocorrência", async () => {
    const { service } = setup();
    const group = await service.saveReminder(1, { ...reminderInput });
    const charges = await service.saveReminder(1, { ...reminderInput, kind: "charges_review", intervalMinutes: 120, productId: 5 });
    expect(group.nextDueAt?.toISOString()).toBe("2026-01-10T12:00:00.000Z");
    expect(group.title).toBe("Atualizar o grupo");
    expect(charges.intervalMinutes).toBe(120);
    expect(charges.productId).toBeNull(); // cobrança não se associa a produto
    expect(charges.title).toBe("Revisar cobranças");
  });

  it("valida intervalo, fuso e horário silencioso no servidor", async () => {
    const { service } = setup();
    await expect(service.saveReminder(1, { ...reminderInput, intervalMinutes: 2 })).rejects.toThrow(/intervalo/);
    await expect(service.saveReminder(1, { ...reminderInput, timezone: "Mars/Olympus" })).rejects.toThrow(/Fuso/);
    await expect(service.saveReminder(1, { ...reminderInput, quietEnd: null })).rejects.toThrow(/silencioso/);
    await expect(service.saveReminder(1, { ...reminderInput, quietStart: "25:00", quietEnd: "07:00" })).rejects.toThrow(/silencioso/);
    await expect(service.saveReminder(1, { ...reminderInput, destinationId: 99 })).rejects.toThrow(/Destino/);
  });

  it("pausa, retoma sem rajada, conclui e descarta (descartado é definitivo)", async () => {
    const { service, clock } = setup();
    const reminder = await service.saveReminder(1, reminderInput);
    const paused = await service.setReminderStatus(1, { id: reminder.id, status: "paused" });
    expect(paused.status).toBe("paused");
    clock.now = new Date("2026-01-10T15:30:00Z");
    expect((await service.dueReminders()).length).toBe(0); // pausado não dispara
    const resumed = await service.setReminderStatus(1, { id: reminder.id, status: "active" });
    expect(resumed.nextDueAt?.toISOString()).toBe("2026-01-10T16:00:00.000Z");
    await service.setReminderStatus(1, { id: reminder.id, status: "discarded" });
    await expect(service.setReminderStatus(1, { id: reminder.id, status: "active" })).rejects.toThrow(/descartado/);
    expect((await service.overview()).reminders).toHaveLength(0);
  });

  it("pausa temporária volta sozinha ao vencer", async () => {
    const { service, clock } = setup();
    const reminder = await service.saveReminder(1, reminderInput);
    await service.setReminderStatus(1, { id: reminder.id, status: "paused", pauseMinutes: 30 });
    clock.now = new Date("2026-01-10T11:20:00Z");
    expect((await service.overview()).reminders[0].status).toBe("paused");
    clock.now = new Date("2026-01-10T11:40:00Z");
    const [after] = (await service.overview()).reminders;
    expect(after.status).toBe("active");
    expect(after.nextDueAt?.toISOString()).toBe("2026-01-10T12:00:00.000Z");
  });

  it("editar título não perde uma ocorrência vencida; mudar o intervalo recalcula", async () => {
    const { service, clock } = setup();
    const reminder = await service.saveReminder(1, reminderInput);
    clock.now = new Date("2026-01-10T12:05:00Z");
    const renamed = await service.saveReminder(1, { ...reminderInput, id: reminder.id, title: "Outro" });
    expect(renamed.nextDueAt?.toISOString()).toBe("2026-01-10T12:00:00.000Z");
    expect((await service.dueReminders()).map(r => r.id)).toEqual([reminder.id]);
    const changed = await service.saveReminder(1, { ...reminderInput, id: reminder.id, intervalMinutes: 120, startAt: undefined });
    expect(changed.nextDueAt?.toISOString()).toBe("2026-01-10T14:00:00.000Z");
  });
});

describe("lembretes: idempotência e ausência de envio", () => {
  it("concluir a mesma ocorrência duas vezes só registra um evento e avança uma vez", async () => {
    const { service, clock, registerCharge } = setup();
    await service.saveReminder(1, reminderInput);
    clock.now = new Date("2026-01-10T12:01:00Z");
    const [due] = await service.dueReminders();
    const first = await service.ackReminder(1, { id: due.id, key: due.key, outcome: "completed" });
    const second = await service.ackReminder(1, { id: due.id, key: due.key, outcome: "completed" });
    expect(first.ignored).toBe(false);
    expect(second).toMatchObject({ ignored: true, reason: "duplicate" });
    expect((await service.overview()).events).toHaveLength(1);
    expect((await service.dueReminders()).length).toBe(0);
    expect((await service.overview()).reminders[0].nextDueAt?.toISOString()).toBe("2026-01-10T13:00:00.000Z");
    expect(registerCharge).not.toHaveBeenCalled(); // lembrete nunca envia nem cria cobrança
  });

  it("chave de ocorrência antiga é ignorada e adiar remarca para depois", async () => {
    const { service, clock } = setup();
    const reminder = await service.saveReminder(1, reminderInput);
    clock.now = new Date("2026-01-10T12:01:00Z");
    expect(await service.ackReminder(1, { id: reminder.id, key: "r1:123", outcome: "dismissed" })).toMatchObject({ ignored: true, reason: "stale" });
    const [due] = await service.dueReminders();
    const snoozed = await service.ackReminder(1, { id: due.id, key: due.key, outcome: "snoozed", snoozeMinutes: 15 });
    expect(snoozed.ignored).toBe(false);
    expect((await service.overview()).reminders[0].nextDueAt?.toISOString()).toBe("2026-01-10T12:16:00.000Z");
    await expect(service.ackReminder(1, { id: reminder.id, key: "r1:999999999999", outcome: "snoozed" })).resolves.toMatchObject({ ignored: true });
  });

  it("depois de ficar ausente há horas, uma única ocorrência fica pendente", async () => {
    const { service, clock } = setup();
    await service.saveReminder(1, { ...reminderInput, quietStart: null, quietEnd: null });
    clock.now = new Date("2026-01-10T18:30:00Z");
    expect(await service.dueReminders()).toHaveLength(1);
  });
});

describe("ações de mensagem", () => {
  it("é idempotente por chave: repetir ou voltar de estado não duplica nem recua", async () => {
    const { service, repo } = setup();
    const created = await service.recordAction(1, actionInput);
    const repeated = await service.recordAction(1, actionInput);
    expect(repeated.ignored).toBe(true);
    expect(repeated.action.id).toBe(created.action.id);
    expect((await repo.recentActions(10)).length).toBe(1);
    await service.recordAction(1, { ...actionInput, status: "share_started" });
    const back = await service.recordAction(1, { ...actionInput, status: "draft" });
    expect(back.ignored).toBe(true);
    expect(back.action.status).toBe("share_started");
  });

  it("registra abrir o WhatsApp e a confirmação manual como coisas diferentes, uma vez cada", async () => {
    const { service, registerCharge, audit } = setup();
    await service.recordAction(1, actionInput);
    await service.recordAction(1, { ...actionInput, status: "share_started" });
    await service.recordAction(1, { ...actionInput, status: "share_started" });
    const confirmed = await service.recordAction(1, { ...actionInput, status: "manual_confirmed" });
    expect(confirmed.action.status).toBe("manual_confirmed");
    expect(JSON.parse(confirmed.action.statusLog).map((entry: any) => entry.status)).toEqual(["ready", "share_started", "manual_confirmed"]);
    expect(registerCharge.mock.calls.map(call => (call as any)[1].action)).toEqual(["whatsapp_opened", "manual_sent"]);
    expect((audit.mock.calls as any[]).map(call => call[1])).toEqual(["prepare", "whatsapp_opened", "manual_confirm"]);
  });

  it("recusa abrir/enviar cobrança quando o saldo mudou desde a prévia", async () => {
    const { service, registerCharge } = setup({ getOrderBalance: async () => 3000 });
    await service.recordAction(1, actionInput); // rascunho/pronto não é bloqueado
    await expect(service.recordAction(1, { ...actionInput, status: "share_started" })).rejects.toThrow(/saldo/i);
    expect(registerCharge).not.toHaveBeenCalled();
    const cancelled = setup({ getOrderBalance: async () => null });
    await expect(cancelled.service.recordAction(1, { ...actionInput, status: "share_started" })).rejects.toThrow(/saldo/i);
  });

  it("valida cobrança sem pedido, mensagem vazia e destino inexistente", async () => {
    const { service } = setup();
    await expect(service.recordAction(1, { ...actionInput, orderId: null })).rejects.toThrow(/pedido/);
    await expect(service.recordAction(1, { ...actionInput, message: "   " })).rejects.toThrow(/mensagem/);
    await expect(service.recordAction(1, { ...actionInput, kind: "group_update", destinationType: "group", destinationId: 77, orderId: null, clientId: null })).rejects.toThrow(/Destino/);
  });

  it("destino de grupo só aceita links do próprio WhatsApp", async () => {
    const { service } = setup();
    await expect(service.saveDestination(1, { name: "Grupo VIP", inviteUrl: "https://evil.example/x" })).rejects.toThrow(/WhatsApp/);
    const saved = await service.saveDestination(1, { name: "Grupo VIP", inviteUrl: "https://chat.whatsapp.com/ABC" });
    expect(saved.inviteUrl).toBe("https://chat.whatsapp.com/ABC");
    const lot = await service.saveLot(1, { productId: 7, goalPieces: 30 });
    expect((await service.saveLot(1, { productId: 7, goalPieces: null })).id).toBe(lot.id);
  });

  it("não expõe envio automático", async () => {
    const { service } = setup();
    expect((await service.overview()).integration).toMatchObject({ officialApiEnabled: false, autoSendAvailable: false });
  });
});

describe("controle de acesso (tRPC)", () => {
  const baseUser = { id: 1, openId: "x", email: null, name: "x", loginMethod: "local", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
  const caller = (user: TrpcContext["user"]) => appRouter.createCaller({ user, req: { headers: {}, protocol: "https" } as any, res: {} as any });

  it("recusa visitantes e usuários sem papel de administradora em todas as rotas da central", async () => {
    for (const user of [null, { ...baseUser, role: "user" as const }]) {
      const api = caller(user);
      await expect(api.messages.overview()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(api.messages.dueReminders()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(api.messages.saveDestination({ name: "Grupo" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(api.messages.setReminderStatus({ id: 1, status: "paused" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(api.messages.recordAction({ idempotencyKey: "abcdefgh1", kind: "report", status: "draft", destinationType: "none", title: "t", message: "m" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("administradora não consegue gravar 'confirmado pela API' nem intervalos inválidos", async () => {
    const api = caller({ ...baseUser, role: "admin" as const });
    await expect(api.messages.recordAction({ idempotencyKey: "abcdefgh1", kind: "report", status: "api_confirmed" as any, destinationType: "none", title: "t", message: "m" })).rejects.toThrow();
    await expect(api.messages.saveReminder({ kind: "group_update", intervalMinutes: 1, timezone: "UTC" })).rejects.toThrow();
  });
});
