/**
 * Lógica pura (sem I/O) da Central de Mensagens: formatação de relatórios e
 * atualizações, cobranças, estados de ação e agenda de lembretes.
 * É usada pelo cliente, pelo servidor e pelos testes.
 */
import { formatDate, formatMoney } from "./format";

// ---------------------------------------------------------------------------
// Relatórios e atualização de lista
// ---------------------------------------------------------------------------

export type ReportRow = {
  orderId: number;
  clientId: number;
  clientName: string;
  phone: string;
  productId: number;
  productName: string;
  unitPriceCents: number;
  quantity: number;
  totalCents: number;
  status?: string;
  paidCents?: number;
  isPaid?: boolean;
  isCharged?: boolean;
};

export type ReportTextOptions = {
  /** Inclui o telefone na linha seguinte ao nome/quantidade (padrão: true, formato original). */
  includePhones?: boolean;
  /** Inclui o preco unitario historico no cabecalho do produto (padrao: true). */
  includePrices?: boolean;
  showPaymentStatus?: boolean;
  /** Divide a lista em blocos "Pago" e "Pagamento pendente" mantendo a ordem original. */
  groupByPaymentStatus?: boolean;
  /** Estoque total para cálculo de peças que faltam vender. */
  productStock?: number | null;
};

export function isRowPaid(row: ReportRow): boolean {
  return (
    Boolean(row.isPaid) ||
    row.status === "paid" ||
    (row.paidCents !== undefined && row.paidCents >= row.totalCents && row.totalCents > 0)
  );
}

export function reportPieceSummary(rows: ReportRow[], stock?: number | null) {
  const paidPieces = rows.filter(isRowPaid).reduce((sum, r) => sum + r.quantity, 0);
  const totalPieces = rows.reduce((sum, r) => sum + r.quantity, 0);
  const pendingPieces = Math.max(0, totalPieces - paidPieces);
  const effectiveStock = stock !== undefined && stock !== null && Number(stock) > 0 ? Number(stock) : null;
  const toSell = effectiveStock !== null ? Math.max(0, effectiveStock - totalPieces) : null;

  return {
    paidPieces,
    pendingPieces,
    totalPieces,
    toSell,
  };
}

export function formatPieceSummaryLines(summary: { paidPieces: number; pendingPieces: number; toSell: number | null }): string[] {
  const lines: string[] = [
    `${summary.paidPieces} Peças`,
    `${summary.pendingPieces} faltam receber`,
  ];
  if (summary.toSell !== null) {
    lines.push(`${summary.toSell} falta vender`);
  }
  return lines;
}

/** Blocos "produto + preço" com as clientes. Usa o preço histórico de cada item. */
export function buildReportBlocks(rows: ReportRow[], options: ReportTextOptions = {}): string[] {
  const includePhones = options.includePhones ?? true;
  const includePrices = options.includePrices ?? true;
  const showPaymentStatus = options.showPaymentStatus ?? false;
  const groupByPaymentStatus = options.groupByPaymentStatus ?? false;
  const groups = new Map<string, ReportRow[]>();
  for (const row of rows) {
    const key = includePrices ? `${row.productId}-${row.unitPriceCents}` : `${row.productId}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const sections: string[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const header = includePrices ? `${first.productName} ${formatMoney(first.unitPriceCents)}` : first.productName;
    const formatClient = (row: ReportRow) => {
      const isPaid = isRowPaid(row);
      const isCharged = Boolean(row.isCharged);
      const statusTag = showPaymentStatus && !groupByPaymentStatus
        ? isPaid
          ? " ✅ Pago"
          : isCharged
          ? " 📲 Cobrado"
          : " ⏳ Pendente"
        : "";
      return `${row.clientName} – ${row.quantity}${statusTag}`;
    };

    if (groupByPaymentStatus) {
      const paidRows = group.filter(isRowPaid);
      const pendingRows = group.filter(r => !isRowPaid(r));
      const blocks: string[] = [header];

      if (paidRows.length > 0) {
        if (includePhones) {
          const lines = ["Pago"];
          for (const row of paidRows) lines.push(`${formatClient(row)}\n${row.phone}`);
          blocks.push(lines.join("\n\n"));
        } else {
          blocks.push(`Pago\n\n${paidRows.map(formatClient).join("\n")}`);
        }
      }

      if (pendingRows.length > 0) {
        if (includePhones) {
          const lines = ["Pagamento pendente"];
          for (const row of pendingRows) lines.push(`${formatClient(row)}\n${row.phone}`);
          blocks.push(lines.join("\n\n"));
        } else {
          blocks.push(`Pagamento pendente\n\n${pendingRows.map(formatClient).join("\n")}`);
        }
      }

      sections.push(blocks.join("\n\n"));
    } else if (includePhones) {
      const lines = [header];
      for (const row of group) lines.push(`${formatClient(row)}\n${row.phone}`);
      sections.push(lines.join("\n\n"));
    } else {
      sections.push(`${header}\n\n${group.map(formatClient).join("\n")}`);
    }
  }
  return sections;
}

export function reportTotals(rows: ReportRow[]) {
  return {
    clients: new Set(rows.map(row => row.clientId)).size,
    pieces: rows.reduce((sum, row) => sum + row.quantity, 0),
    totalCents: rows.reduce((sum, row) => sum + row.totalCents, 0),
  };
}

/** Mesmo formato do módulo de Relatórios: blocos + resumo final. */
export function buildReportText(rows: ReportRow[], options: ReportTextOptions = {}): string {
  const sections = buildReportBlocks(rows, options);
  const totals = reportTotals(rows);
  sections.push(`Total de clientes: ${totals.clients}\nTotal de peças: ${totals.pieces}\nValor total vendido: ${formatMoney(totals.totalCents)}`);
  return sections.join("\n\n");
}

export type LotProgress = { total: number; goal: number; remaining: number; percent: number; reached: boolean };

/** Meta é opcional: sem meta válida não há progresso. */
export function computeProgress(total: number, goal: number | null | undefined): LotProgress | null {
  if (!goal || goal < 1) return null;
  const safeTotal = Math.max(0, total);
  return {
    total: safeTotal,
    goal,
    remaining: Math.max(0, goal - safeTotal),
    percent: Math.min(100, Math.round((safeTotal / goal) * 100)),
    reached: safeTotal >= goal,
  };
}

export type GroupUpdateOptions = {
  showNames: boolean;
  showPrices: boolean;
  showPhones: boolean;
  showTotals: boolean;
  showProgress: boolean;
  showPaymentStatus?: boolean;
  showDescription?: boolean;
  includePix?: boolean;
  /** Divide a lista em blocos "Pago" e "Pagamento pendente" mantendo a ordem original. */
  groupByPaymentStatus?: boolean;
  intro: string;
  closing: string;
};

export const defaultGroupUpdateOptions: GroupUpdateOptions = {
  showNames: true,
  showPrices: true,
  showPhones: false,
  showTotals: true,
  showProgress: true,
  showPaymentStatus: false,
  showDescription: true,
  includePix: false,
  groupByPaymentStatus: false,
  intro: "Atualização da lista",
  closing: "",
};

export function progressLine(progress: LotProgress) {
  return progress.reached
    ? `Meta do lote: ${progress.goal} peças — atingida (${progress.total} registradas)`
    : `Meta do lote: ${progress.goal} peças — ${progress.total} registradas, faltam ${progress.remaining}`;
}

/**
 * Texto de atualização para o grupo. Por padrão NÃO expõe telefones nem valores
 * financeiros de clientes (saldo/pagamento nunca entram aqui).
 */
export function buildGroupUpdateText(input: {
  productName: string;
  productPriceCents?: number | null;
  productDescription?: string | null;
  productStock?: number | null;
  rows: ReportRow[];
  goalPieces?: number | null;
  options?: Partial<GroupUpdateOptions>;
}): string {
  const options = { ...defaultGroupUpdateOptions, ...input.options };
  const totals = reportTotals(input.rows);
  const parts: string[] = [];

  // 1. Abertura
  if (options.intro.trim()) {
    parts.push(options.intro.trim());
  }

  // 2. Nome do Produto e Valor
  const productLines: string[] = [input.productName];
  if (options.showPrices) {
    const priceCents = input.productPriceCents ?? input.rows[0]?.unitPriceCents;
    if (priceCents) {
      productLines.push(`VALOR: ${formatMoney(priceCents)}`);
    }
  }
  parts.push(productLines.join("\n"));

  // 3. Descrição do produto
  if (options.showDescription !== false && input.productDescription?.trim()) {
    parts.push(input.productDescription.trim());
  }

  // 4. Lista de clientes com quantidades e status
  if (!input.rows.length) {
    parts.push("Ainda sem quantidades registradas.");
  } else if (options.showNames) {
    const formatClient = (row: ReportRow) => {
      const isPaid = isRowPaid(row);
      const isCharged = Boolean(row.isCharged);
      const statusTag = options.showPaymentStatus && !options.groupByPaymentStatus
        ? isPaid
          ? " ✅ Pago"
          : isCharged
          ? " 📲 Cobrado"
          : " ⏳ Pendente"
        : "";
      const phoneLine = options.showPhones && row.phone ? `\n${row.phone}` : "";
      return `${row.clientName} – ${row.quantity}${statusTag}${phoneLine}`;
    };

    if (options.groupByPaymentStatus) {
      const paidRows = input.rows.filter(isRowPaid);
      const pendingRows = input.rows.filter(r => !isRowPaid(r));
      const groupParts: string[] = [];

      if (paidRows.length > 0) {
        groupParts.push(`Pago\n\n${paidRows.map(formatClient).join("\n")}`);
      }
      if (pendingRows.length > 0) {
        groupParts.push(`Pagamento pendente\n\n${pendingRows.map(formatClient).join("\n")}`);
      }
      parts.push(groupParts.join("\n\n"));
    } else {
      parts.push(input.rows.map(formatClient).join("\n"));
    }
  }

  // 5. Totais e Resumo de status
  const footer: string[] = [];
  if (options.showTotals) {
    const summary = reportPieceSummary(input.rows, input.productStock ?? input.goalPieces);
    footer.push(formatPieceSummaryLines(summary).join("\n"));
    footer.push(`Total de peças: ${totals.pieces}\nTotal de clientes: ${totals.clients}`);
  }
  if (options.showPaymentStatus && input.rows.length > 0 && !options.groupByPaymentStatus) {
    const paidCount = input.rows.filter(isRowPaid).length;
    const chargedCount = input.rows.filter(r => Boolean(r.isCharged) && !isRowPaid(r)).length;
    const pendingCount = Math.max(0, input.rows.length - paidCount - chargedCount);
    footer.push(`Status: ${paidCount} pago(s) ✅ · ${chargedCount} cobrado(s) 📲 · ${pendingCount} pendente(s) ⏳`);
  }
  if (options.showProgress) {
    const progress = computeProgress(totals.pieces, input.goalPieces ?? input.productStock);
    if (progress) footer.push(progressLine(progress));
  }
  if (footer.length) parts.push(footer.join("\n"));

  // 6. Chave Pix (se selecionada)
  if (options.includePix) {
    parts.push("*Chave Pix* 👇🏻\nKriciaquaresma@gmail.com");
  }

  // 7. Fechamento
  if (options.closing.trim()) {
    parts.push(options.closing.trim());
  }

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Cobranças (sempre uma mensagem por cliente/pedido)
// ---------------------------------------------------------------------------

export type ChargeOrder = {
  id: number;
  code: string;
  status: string;
  totalCents: number;
  paidCents: number;
  dueDate?: string | Date | null;
  orderDate?: string | Date | null;
  client: { id?: number; name: string; phone: string };
  items?: Array<{ productName: string; quantity: number }>;
};

export function openBalanceCents(order: { totalCents: number; paidCents: number }) {
  return Math.max(0, order.totalCents - order.paidCents);
}

/** Pedidos cobráveis: não cancelados, com saldo. Vencidos primeiro, depois os mais antigos. */
export function collectibleOrders<T extends ChargeOrder>(orders: T[]): T[] {
  const time = (value?: string | Date | null) => (value ? new Date(value).getTime() : 0);
  return orders
    .filter(order => order.status !== "cancelled" && openBalanceCents(order) > 0)
    .sort((a, b) => {
      const overdueDiff = Number(b.status === "overdue") - Number(a.status === "overdue");
      return overdueDiff || time(a.orderDate) - time(b.orderDate);
    });
}

export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
}

/** Preenche os modelos de cobrança existentes com dados reais do pedido. */
export function fillChargeTemplate(
  body: string,
  order: any,
  valueOverride?: number,
  extra?: { product?: any; clientsList?: string }
) {
  const greeting = getGreeting();
  const product = order.items?.map((item: any) => `${item.productName} (${item.quantity})`).join(", ") || "seu pedido";
  const firstItem = order.items?.[0];
  const productName = extra?.product?.name || firstItem?.productName || "Produto";
  const productPrice = extra?.product?.priceCents
    ? formatMoney(extra.product.priceCents)
    : firstItem?.unitPriceCents
    ? formatMoney(firstItem.unitPriceCents)
    : "";
  const pending = valueOverride ?? Math.max(0, order.totalCents - order.paidCents);
  const pixKey = "Kriciaquaresma@gmail.com";

  const totalPieces = order.items?.reduce((sum: number, it: any) => sum + Number(it.quantity || 0), 0) || Number(firstItem?.quantity || 1);
  const unitPrice = firstItem?.unitPriceCents
    ? formatMoney(firstItem.unitPriceCents)
    : productPrice;
  const totalOrderVal = formatMoney(order.totalCents || (pending + (order.paidCents || 0)));
  const isPaid = order.status === "paid" || (order.paidCents >= order.totalCents && order.totalCents > 0);
  const statusPagamento = isPaid ? "*Status:* ✅ Pago" : `*Valor a pagar:* ${formatMoney(pending)}`;
  const resumoPedido = `${totalPieces} peças × ${unitPrice}\n*Total:* ${totalOrderVal}`;

  return body
    .replaceAll("{saudacao}", greeting)
    .replaceAll("{nome_cliente}", order.client?.name ?? "cliente")
    .replaceAll("{produto}", product)
    .replaceAll("{produto_nome}", productName)
    .replaceAll("{produto_preco}", productPrice)
    .replaceAll("{chave_pix}", pixKey)
    .replaceAll("{numero_pedido}", order.code ?? "")
    .replaceAll("{valor_pendente}", formatMoney(pending))
    .replaceAll("{valor_pago}", formatMoney(order.paidCents ?? 0))
    .replaceAll("{data_vencimento}", formatDate(order.dueDate))
    .replaceAll("{detalhes_produto}", extra?.product?.description || "Cores variadas\nCom detalhe cinto")
    .replaceAll("{lista_clientes}", extra?.clientsList ?? "")
    .replaceAll("{resumo_pedido}", resumoPedido)
    .replaceAll("{quantidade}", `${totalPieces} peças`)
    .replaceAll("{preco_unitario}", unitPrice)
    .replaceAll("{valor_total}", totalOrderVal)
    .replaceAll("{status_pagamento}", statusPagamento);
}

export type BalanceChange = { orderId: number; expectedCents: number; currentCents: number };

/** Compara os saldos usados na prévia com os saldos atuais (0 se o pedido deixou de ser cobrável). */
export function detectBalanceChanges(expected: Record<number, number>, current: ChargeOrder[]): BalanceChange[] {
  const byId = new Map(current.map(order => [order.id, order]));
  const changes: BalanceChange[] = [];
  for (const [id, expectedCents] of Object.entries(expected)) {
    const order = byId.get(Number(id));
    const currentCents = order && order.status !== "cancelled" ? openBalanceCents(order) : 0;
    if (currentCents !== expectedCents) changes.push({ orderId: Number(id), expectedCents, currentCents });
  }
  return changes;
}

// ---------------------------------------------------------------------------
// WhatsApp (abrir conversa ≠ mensagem enviada)
// ---------------------------------------------------------------------------

/** Telefones brasileiros com 10/11 dígitos recebem o DDI 55. */
export function toWaPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
}

export function waChatUrl(phone: string, text: string) {
  return `https://wa.me/${toWaPhone(phone)}?text=${encodeURIComponent(text)}`;
}

const WHATSAPP_HOSTS = ["chat.whatsapp.com", "wa.me", "api.whatsapp.com", "web.whatsapp.com", "whatsapp.com"];

/** Aceita apenas links https do próprio WhatsApp (convite de grupo ou conversa). */
export function isAllowedWhatsAppUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && WHATSAPP_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Estados de ação — nunca "enviada/entregue" sem confirmação real
// ---------------------------------------------------------------------------

export const ACTION_STATUSES = ["reminder_pending", "draft", "ready", "share_started", "manual_confirmed", "api_confirmed"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
/** `api_confirmed` só pode ser definido por uma integração oficial no servidor (inexistente hoje). */
export const CLIENT_SETTABLE_STATUSES = ["reminder_pending", "draft", "ready", "share_started", "manual_confirmed"] as const;

const STATUS_RANK: Record<ActionStatus, number> = { reminder_pending: 0, draft: 1, ready: 2, share_started: 3, manual_confirmed: 4, api_confirmed: 5 };

export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  reminder_pending: "Lembrete pendente",
  draft: "Rascunho",
  ready: "Pronto para compartilhar",
  share_started: "WhatsApp aberto / compartilhamento iniciado",
  manual_confirmed: "Envio confirmado manualmente por você",
  api_confirmed: "Envio confirmado pela API oficial",
};

/** Estados só avançam; repetir ou voltar é ignorado (idempotência). */
export function canAdvanceStatus(from: ActionStatus, to: ActionStatus) {
  return STATUS_RANK[to] > STATUS_RANK[from];
}

// ---------------------------------------------------------------------------
// Agenda de lembretes (notificam a administradora; não enviam nada)
// ---------------------------------------------------------------------------

export const MIN_INTERVAL_MINUTES = 5;
export const MAX_INTERVAL_MINUTES = 7 * 24 * 60;

export type ReminderSchedule = {
  intervalMinutes: number;
  anchorAt: Date;
  timezone: string;
  quietStart?: string | null;
  quietEnd?: string | null;
};

export function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function parseClock(value?: string | null): number | null {
  const match = value?.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function localMinutesOfDay(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const hour = Number(parts.find(part => part.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find(part => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/** Horário silencioso (pode atravessar a meia-noite, ex.: 22:00–07:00). */
export function isQuietTime(date: Date, schedule: Pick<ReminderSchedule, "timezone" | "quietStart" | "quietEnd">) {
  const start = parseClock(schedule.quietStart);
  const end = parseClock(schedule.quietEnd);
  if (start === null || end === null || start === end) return false;
  const minutes = localMinutesOfDay(date, schedule.timezone);
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/** Primeira ocorrência da grade (âncora + k·intervalo) estritamente depois de `from`. */
export function nextSlotAfter(schedule: ReminderSchedule, from: Date): Date {
  const step = schedule.intervalMinutes * 60_000;
  const anchor = schedule.anchorAt.getTime();
  if (from.getTime() < anchor) return new Date(anchor);
  const k = Math.floor((from.getTime() - anchor) / step) + 1;
  return new Date(anchor + k * step);
}

/** Pula ocorrências que caem no horário silencioso. */
export function skipQuietSlots(schedule: ReminderSchedule, candidate: Date): Date {
  let slot = candidate;
  for (let i = 0; i < 2000 && isQuietTime(slot, schedule); i += 1) slot = nextSlotAfter(schedule, slot);
  return slot;
}

export function firstRunAt(schedule: ReminderSchedule, now: Date): Date {
  const candidate = schedule.anchorAt.getTime() > now.getTime() ? schedule.anchorAt : nextSlotAfter(schedule, now);
  return skipQuietSlots(schedule, candidate);
}

/** Depois de tratar uma ocorrência: próxima da grade depois de agora (sem rajada de atrasadas). */
export function advanceAfterAck(schedule: ReminderSchedule, dueAt: Date, now: Date): Date {
  const from = new Date(Math.max(now.getTime(), dueAt.getTime()));
  return skipQuietSlots(schedule, nextSlotAfter(schedule, from));
}

export function snoozeUntil(schedule: ReminderSchedule, now: Date, minutes: number): Date {
  return skipQuietSlots(schedule, new Date(now.getTime() + minutes * 60_000));
}

/** Chave estável da ocorrência: base da idempotência de "concluir/dispensar/adiar". */
export function occurrenceKey(reminderId: number, dueAt: Date) {
  return `r${reminderId}:${dueAt.getTime()}`;
}

export function describeInterval(minutes: number) {
  if (minutes % 1440 === 0) return minutes === 1440 ? "todo dia" : `a cada ${minutes / 1440} dias`;
  if (minutes % 60 === 0) return minutes === 60 ? "a cada 1 hora" : `a cada ${minutes / 60} horas`;
  return `a cada ${minutes} min`;
}
