import { describe, expect, it } from "vitest";
import {
  ACTION_STATUS_LABELS,
  advanceAfterAck,
  buildGroupUpdateText,
  buildReportText,
  canAdvanceStatus,
  collectibleOrders,
  computeProgress,
  detectBalanceChanges,
  fillChargeTemplate,
  firstRunAt,
  isAllowedWhatsAppUrl,
  isQuietTime,
  nextSlotAfter,
  occurrenceKey,
  snoozeUntil,
  toWaPhone,
  waChatUrl,
  type ChargeOrder,
  type ReminderSchedule,
  type ReportRow,
} from "../shared/messaging";
import { formatMoney } from "../shared/format";

const money = (cents: number) => formatMoney(cents);
const row = (overrides: Partial<ReportRow>): ReportRow => ({
  orderId: 1, clientId: 1, clientName: "Ana", phone: "65 99999-0001", productId: 7, productName: "Shorts", unitPriceCents: 2200, quantity: 2, totalCents: 4400, ...overrides,
});
const rows: ReportRow[] = [
  row({}),
  row({ orderId: 2, clientId: 2, clientName: "Bia", phone: "65 99999-0002", quantity: 1, totalCents: 2200 }),
];

describe("relatório e atualização de lista", () => {
  it("preserva o formato atual: produto e preço, cliente – quantidade, telefone na linha seguinte e resumo", () => {
    expect(buildReportText(rows)).toBe(
      [`Shorts ${money(2200)}`, "", "Ana – 2\n65 99999-0001", "", "Bia – 1\n65 99999-0002", "", "Total de clientes: 2\nTotal de peças: 3\nValor total vendido: " + money(6600)].join("\n"),
    );
  });

  it("permite ocultar telefones sem alterar o restante", () => {
    const text = buildReportText(rows, { includePhones: false });
    expect(text).toContain("Ana – 2\nBia – 1");
    expect(text).not.toContain("99999");
    expect(text).toContain("Total de peças: 3");
  });

  it("usa o preço histórico de cada item e separa blocos por preço", () => {
    const text = buildReportText([row({}), row({ orderId: 3, clientId: 3, clientName: "Cris", unitPriceCents: 2500, totalCents: 5000 })]);
    expect(text).toContain(`Shorts ${money(2200)}`);
    expect(text).toContain(`Shorts ${money(2500)}`);
  });

  it("atualização do grupo não expõe telefones por padrão nem dados financeiros", () => {
    const text = buildGroupUpdateText({ productName: "Shorts", rows });
    expect(text).not.toContain("99999");
    expect(text).not.toMatch(/saldo|pago|pendente/i);
    expect(text).toContain("Total de peças: 3");
    expect(text).toContain("Ana – 2");
  });

  it("mostra progresso apenas quando há meta e informa o que falta", () => {
    expect(buildGroupUpdateText({ productName: "Shorts", rows })).not.toContain("Meta do lote");
    const withGoal = buildGroupUpdateText({ productName: "Shorts", rows, goalPieces: 10 });
    expect(withGoal).toContain("Meta do lote: 10 peças — 3 registradas, faltam 7");
    expect(buildGroupUpdateText({ productName: "Shorts", rows, goalPieces: 3 })).toContain("atingida");
    expect(buildGroupUpdateText({ productName: "Shorts", rows, goalPieces: 10, options: { showProgress: false } })).not.toContain("Meta do lote");
  });

  it("permite lista sem nomes e lote sem registros", () => {
    const anonymous = buildGroupUpdateText({ productName: "Shorts", rows, options: { showNames: false } });
    expect(anonymous).not.toContain("Ana");
    expect(anonymous).toContain("Shorts");
    expect(anonymous).toContain(money(2200));
    expect(buildGroupUpdateText({ productName: "Shorts", rows: [] })).toContain("Ainda sem quantidades registradas.");
  });

  it("calcula progresso", () => {
    expect(computeProgress(3, null)).toBeNull();
    expect(computeProgress(3, 0)).toBeNull();
    expect(computeProgress(3, 12)).toEqual({ total: 3, goal: 12, remaining: 9, percent: 25, reached: false });
    expect(computeProgress(15, 12)).toMatchObject({ remaining: 0, percent: 100, reached: true });
  });
});

describe("cobranças: destinatários e saldos", () => {
  const order = (id: number, status: string, total: number, paid: number, date: string): ChargeOrder => ({ id, code: `PV-${id}`, status, totalCents: total, paidCents: paid, orderDate: date, client: { id, name: `Cliente ${id}`, phone: "65 99999-0000" } });

  it("lista apenas pedidos com saldo, sem cancelados, vencidos primeiro", () => {
    const list = collectibleOrders([
      order(1, "pending", 1000, 0, "2026-01-02"),
      order(2, "paid", 1000, 1000, "2026-01-01"),
      order(3, "cancelled", 1000, 0, "2026-01-01"),
      order(4, "overdue", 1000, 400, "2026-01-03"),
      order(5, "partial", 1000, 500, "2026-01-01"),
    ]);
    expect(list.map(item => item.id)).toEqual([4, 5, 1]);
  });

  it("preenche o modelo com os dados reais de um único pedido", () => {
    const text = fillChargeTemplate("Oi, {nome_cliente}! Pedido {numero_pedido}: {valor_pendente} de {produto}", {
      code: "PV-9", totalCents: 5000, paidCents: 1500, client: { name: "Ana" }, items: [{ productName: "Shorts", quantity: 2 }],
    });
    expect(text).toBe(`Oi, Ana! Pedido PV-9: ${money(3500)} de Shorts (2)`);
  });

  it("detecta saldo desatualizado, inclusive pedido pago/cancelado depois da prévia", () => {
    const current = [order(1, "pending", 1000, 0, "2026-01-01"), order(2, "partial", 1000, 700, "2026-01-01"), order(3, "cancelled", 1000, 0, "2026-01-01")];
    expect(detectBalanceChanges({ 1: 1000, 2: 500, 3: 1000, 4: 200 }, current)).toEqual([
      { orderId: 2, expectedCents: 500, currentCents: 300 },
      { orderId: 3, expectedCents: 1000, currentCents: 0 },
      { orderId: 4, expectedCents: 200, currentCents: 0 },
    ]);
    expect(detectBalanceChanges({ 1: 1000 }, current)).toEqual([]);
  });

  it("monta links do WhatsApp sem prometer envio e valida destinos", () => {
    expect(toWaPhone("(65) 99999-0001")).toBe("5565999990001");
    expect(toWaPhone("+55 65 99999-0001")).toBe("5565999990001");
    expect(waChatUrl("65 99999-0001", "Olá & tudo bem")).toBe("https://wa.me/5565999990001?text=Ol%C3%A1%20%26%20tudo%20bem");
    expect(isAllowedWhatsAppUrl("https://chat.whatsapp.com/ABC123")).toBe(true);
    expect(isAllowedWhatsAppUrl("http://chat.whatsapp.com/ABC123")).toBe(false);
    expect(isAllowedWhatsAppUrl("https://evil.example/chat.whatsapp.com")).toBe(false);
    expect(isAllowedWhatsAppUrl("https://chat.whatsapp.com.evil.example/x")).toBe(false);
  });
});

describe("estados de ação", () => {
  it("só avança e nunca rotula como enviada/entregue", () => {
    expect(canAdvanceStatus("draft", "ready")).toBe(true);
    expect(canAdvanceStatus("share_started", "ready")).toBe(false);
    expect(canAdvanceStatus("manual_confirmed", "manual_confirmed")).toBe(false);
    for (const label of Object.values(ACTION_STATUS_LABELS)) expect(label).not.toMatch(/entregue|enviada\b/i);
    expect(ACTION_STATUS_LABELS.share_started).not.toMatch(/enviad|confirmad/i);
  });
});

describe("agenda de lembretes", () => {
  const schedule = (overrides: Partial<ReminderSchedule> = {}): ReminderSchedule => ({
    intervalMinutes: 60,
    anchorAt: new Date("2026-01-10T12:00:00Z"), // 09:00 em America/Sao_Paulo
    timezone: "America/Sao_Paulo",
    quietStart: "22:00",
    quietEnd: "07:00",
    ...overrides,
  });

  it("calcula ocorrências da grade de 1h e de 2h", () => {
    expect(nextSlotAfter(schedule(), new Date("2026-01-10T12:30:00Z")).toISOString()).toBe("2026-01-10T13:00:00.000Z");
    expect(nextSlotAfter(schedule({ intervalMinutes: 120 }), new Date("2026-01-10T12:30:00Z")).toISOString()).toBe("2026-01-10T14:00:00.000Z");
    expect(nextSlotAfter(schedule(), new Date("2026-01-10T13:00:00Z")).toISOString()).toBe("2026-01-10T14:00:00.000Z");
  });

  it("respeita o horário silencioso que atravessa a meia-noite, no fuso configurado", () => {
    const s = schedule();
    expect(isQuietTime(new Date("2026-01-11T01:00:00Z"), s)).toBe(true); // 22:00 local
    expect(isQuietTime(new Date("2026-01-11T09:59:00Z"), s)).toBe(true); // 06:59 local
    expect(isQuietTime(new Date("2026-01-11T10:00:00Z"), s)).toBe(false); // 07:00 local
    expect(isQuietTime(new Date("2026-01-11T01:00:00Z"), schedule({ timezone: "Asia/Tokyo" }))).toBe(false); // 10:00 em Tóquio
    expect(advanceAfterAck(s, new Date("2026-01-11T00:00:00Z"), new Date("2026-01-11T00:30:00Z")).toISOString()).toBe("2026-01-11T10:00:00.000Z");
  });

  it("primeira ocorrência: respeita início futuro e evita horário silencioso", () => {
    expect(firstRunAt(schedule(), new Date("2026-01-10T11:00:00Z")).toISOString()).toBe("2026-01-10T12:00:00.000Z");
    expect(firstRunAt(schedule(), new Date("2026-01-10T12:10:00Z")).toISOString()).toBe("2026-01-10T13:00:00.000Z");
  });

  it("depois de ficar ausente, avança para a próxima da grade sem rajada de atrasadas", () => {
    const next = advanceAfterAck(schedule({ quietStart: null, quietEnd: null }), new Date("2026-01-10T12:00:00Z"), new Date("2026-01-10T15:30:00Z"));
    expect(next.toISOString()).toBe("2026-01-10T16:00:00.000Z");
  });

  it("adiar usa o tempo pedido (ou o próximo horário permitido)", () => {
    expect(snoozeUntil(schedule(), new Date("2026-01-10T15:00:00Z"), 15).toISOString()).toBe("2026-01-10T15:15:00.000Z");
  });

  it("chave da ocorrência é estável", () => {
    expect(occurrenceKey(3, new Date("2026-01-10T12:00:00Z"))).toBe(`r3:${Date.parse("2026-01-10T12:00:00Z")}`);
  });
});
