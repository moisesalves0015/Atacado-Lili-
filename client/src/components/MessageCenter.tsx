import { Button } from "@/components/ui/button";
import { copyTextSync, csvFromRows, downloadText, shareReportOnWhatsApp } from "@/lib/shareTools";
import { trpc } from "@/lib/trpc";
import { formatDateTime, formatMoney } from "@shared/format";
import {
  ACTION_STATUS_LABELS,
  type ActionStatus,
  type ChargeOrder,
  type GroupUpdateOptions,
  type ReportRow,
  buildGroupUpdateText,
  buildReportText,
  collectibleOrders,
  computeProgress,
  defaultGroupUpdateOptions,
  describeInterval,
  detectBalanceChanges,
  fillChargeTemplate,
  openBalanceCents,
  reportTotals,
  waChatUrl,
} from "@shared/messaging";
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  Check,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileText,
  MessageCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

export type MessageTab = "update" | "charges" | "report" | "reminders" | "destinations" | "history";
export type MessageIntent = {
  tab: MessageTab;
  productId?: number | null;
  destinationId?: number | null;
  reminder?: { id: number; key: string; title: string } | null;
};

const TABS: Array<{ id: MessageTab; label: string }> = [
  { id: "update", label: "Atualizar grupo" },
  { id: "charges", label: "Cobrar clientes" },
  { id: "report", label: "Relatório" },
  { id: "reminders", label: "Lembretes" },
  { id: "destinations", label: "Destinos" },
  { id: "history", label: "Histórico" },
];

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const newKey = (prefix: string) => `${prefix}:${uid()}`;
const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
const TIMEZONES = Array.from(new Set([deviceTimezone, "America/Sao_Paulo", "America/Cuiaba", "America/Manaus", "America/Belem", "America/Fortaleza", "America/Rio_Branco", "America/Noronha"]));
const formatInZone = (date: string | Date | null | undefined, timeZone: string) =>
  date ? new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(date)) : "—";

type RecordInput = Parameters<ReturnType<typeof trpc.messages.recordAction.useMutation>["mutateAsync"]>[0];
type Recorder = (input: RecordInput) => Promise<ActionStatus | null>;

function StatusChip({ status }: { status?: ActionStatus | null }) {
  if (!status) return null;
  return <span className={`mc-chip mc-chip-${status}`}>{ACTION_STATUS_LABELS[status]}</span>;
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="mc-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function Check2({ checked, onChange, children }: { checked: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return <label className="mc-check"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /> <span>{children}</span></label>;
}

function Empty({ icon: Icon, title, children }: { icon: typeof Users; title: string; children?: ReactNode }) {
  return <div className="mc-empty"><Icon size={22} /><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}

function useRecorder(): Recorder {
  const utils = trpc.useUtils();
  const mutation = trpc.messages.recordAction.useMutation();
  return async input => {
    try {
      const result = await mutation.mutateAsync(input);
      void utils.messages.overview.invalidate();
      if (input.kind === "charge") void utils.charges.list.invalidate();
      return result.action.status as ActionStatus;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível registrar a ação");
      void utils.orders.list.invalidate();
      return null;
    }
  };
}

export default function MessageCenter({ open, onClose, intent, onIntentHandled }: { open: boolean; onClose: () => void; intent: MessageIntent | null; onIntentHandled: () => void }) {
  const utils = trpc.useUtils();
  const overviewQuery = trpc.messages.overview.useQuery(undefined, { refetchInterval: open ? 30_000 : false, refetchOnWindowFocus: true });
  const productsQuery = trpc.products.list.useQuery({ search: "" });
  const ordersQuery = trpc.orders.list.useQuery({ search: "", status: "all" }, { refetchInterval: open ? 30_000 : false, refetchOnWindowFocus: true });
  const templatesQuery = trpc.charges.templates.useQuery();
  const dueQuery = trpc.messages.dueReminders.useQuery(undefined, { refetchInterval: 60_000, refetchOnWindowFocus: true });
  const ackReminder = trpc.messages.ackReminder.useMutation();
  const record = useRecorder();

  const overview = overviewQuery.data;
  const products = ((productsQuery.data ?? []) as any[]);
  const orders = ((ordersQuery.data ?? []) as any[]);
  const templates = ((templatesQuery.data ?? []) as any[]);
  const destinations = (overview?.destinations ?? []) as any[];
  const dueList = (dueQuery.data ?? []) as any[];

  const [tab, setTab] = useState<MessageTab>("update");
  const [updateProductId, setUpdateProductId] = useState("");
  const [updateDestinationId, setUpdateDestinationId] = useState("");
  const [activeReminder, setActiveReminder] = useState<{ id: number; key: string; title: string } | null>(null);

  useEffect(() => {
    if (open) {
      void overviewQuery.refetch();
      void ordersQuery.refetch();
    }
  }, [open]);

  // Um lembrete aberto leva direto à aba certa; o conteúdo é sempre recalculado dos dados atuais.
  useEffect(() => {
    if (!intent) return;
    setTab(intent.tab);
    if (intent.productId) setUpdateProductId(String(intent.productId));
    if (intent.destinationId) setUpdateDestinationId(String(intent.destinationId));
    setActiveReminder(intent.reminder ?? null);
    onIntentHandled();
  }, [intent]);

  const settleReminder = async (outcome: "completed" | "dismissed" | "snoozed") => {
    if (!activeReminder) return;
    try {
      const result = await ackReminder.mutateAsync({ id: activeReminder.id, key: activeReminder.key, outcome, snoozeMinutes: outcome === "snoozed" ? 15 : undefined });
      toast[result.ignored ? "info" : "success"](result.ignored ? "Esse aviso já tinha sido tratado." : outcome === "completed" ? "Lembrete concluído. A próxima ocorrência já foi calculada." : outcome === "snoozed" ? "Adiado por 15 minutos." : "Aviso dispensado.");
      setActiveReminder(null);
      void utils.messages.dueReminders.invalidate();
      void utils.messages.overview.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar o lembrete");
    }
  };

  const openDue = (reminder: any) => {
    setActiveReminder({ id: reminder.id, key: reminder.key, title: reminder.title });
    setTab(reminder.kind === "charges_review" ? "charges" : "update");
    if (reminder.productId) setUpdateProductId(String(reminder.productId));
    if (reminder.destinationId) setUpdateDestinationId(String(reminder.destinationId));
  };

  return (
    <div className={`mc-shell ${open ? "" : "mc-hidden"}`} role="dialog" aria-label="Central de mensagens" aria-hidden={!open}>
      <header className="mc-header">
        <button type="button" className="mc-back" onClick={onClose}><ArrowLeft size={16} /> Vitrine</button>
        <div>
          <div className="eyebrow">preparar · lembrar · acompanhar</div>
          <h2>Central de mensagens</h2>
        </div>
      </header>

      <div className="mc-callout">
        <AlertTriangle size={16} />
        <p>{overview?.integration.summary ?? "Nada é enviado automaticamente: você revisa, abre o WhatsApp e confirma o envio."}</p>
      </div>

      {activeReminder && (
        <div className="mc-active-reminder">
          <div><BellRing size={16} /> <strong>Lembrete: {activeReminder.title}</strong><small>Prévia e destinatários abaixo já usam os dados atuais.</small></div>
          <div className="mc-row-actions">
            <Button size="sm" onClick={() => settleReminder("completed")}><Check size={14} /> Concluído</Button>
            <Button size="sm" variant="outline" onClick={() => settleReminder("snoozed")}><Clock size={14} /> Adiar 15 min</Button>
            <Button size="sm" variant="ghost" onClick={() => settleReminder("dismissed")}>Dispensar</Button>
          </div>
        </div>
      )}

      {!activeReminder && dueList.length > 0 && (
        <div className="mc-active-reminder">
          <div><BellRing size={16} /> <strong>{dueList.length} lembrete(s) pendente(s)</strong><small>{dueList.map(item => item.title).join(" · ")}</small></div>
          <Button size="sm" onClick={() => openDue(dueList[0])}>Revisar agora</Button>
        </div>
      )}

      <nav className="mc-tabs" aria-label="Seções da central">
        {TABS.map(item => (
          <button key={item.id} type="button" className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
            {item.label}{item.id === "reminders" && dueList.length > 0 ? <em>{dueList.length}</em> : null}
          </button>
        ))}
      </nav>

      <div className="mc-body">
        <div hidden={tab !== "update"}>
          <UpdateTab products={products} lots={overview?.lots ?? []} destinations={destinations} productId={updateProductId} setProductId={setUpdateProductId} destinationId={updateDestinationId} setDestinationId={setUpdateDestinationId} reminderId={activeReminder?.id ?? null} record={record} />
        </div>
        <div hidden={tab !== "charges"}>
          <ChargesTab orders={orders} loading={ordersQuery.isLoading} templates={templates} record={record} refetchOrders={() => ordersQuery.refetch()} />
        </div>
        <div hidden={tab !== "report"}>
          <ReportTab products={products} destinations={destinations} record={record} />
        </div>
        <div hidden={tab !== "reminders"}>
          <RemindersTab overview={overview} products={products} destinations={destinations} dueList={dueList} onReview={openDue} loading={overviewQuery.isLoading} />
        </div>
        <div hidden={tab !== "destinations"}>
          <DestinationsTab destinations={destinations} />
        </div>
        <div hidden={tab !== "history"}>
          <HistoryTab overview={overview} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Atualizar grupo / lista
// ---------------------------------------------------------------------------

function UpdateTab({ products, lots, destinations, productId, setProductId, destinationId, setDestinationId, reminderId, record }: any) {
  const utils = trpc.useUtils();
  const saveLot = trpc.messages.saveLot.useMutation();
  const activeProducts = products.filter((item: any) => item.active);
  const product = products.find((item: any) => String(item.id) === productId) ?? null;
  const lot = lots.find((item: any) => item.productId === Number(productId));
  const rowsQuery = trpc.reports.rows.useQuery({ productId: Number(productId) }, { enabled: Boolean(productId), refetchInterval: 30_000 });
  const rows = (rowsQuery.data ?? []) as ReportRow[];
  const totals = reportTotals(rows);

  const [goalInput, setGoalInput] = useState("");
  const [options, setOptions] = useState<GroupUpdateOptions>(() => ({ ...defaultGroupUpdateOptions, showPaymentStatus: true }));
  const [override, setOverride] = useState<{ text: string; base: string } | null>(null);
  const [key, setKey] = useState(() => newKey("update"));
  const [status, setStatus] = useState<ActionStatus | null>(null);

  useEffect(() => { setGoalInput(lot?.goalPieces ? String(lot.goalPieces) : ""); }, [productId, lot?.goalPieces]);
  useEffect(() => { setKey(newKey("update")); setStatus(null); setOverride(null); }, [productId]);

  const goal = Number(goalInput) >= 1 ? Math.floor(Number(goalInput)) : null;
  const progress = computeProgress(totals.pieces, goal);
  const destination = destinations.find((item: any) => String(item.id) === destinationId && item.active) ?? null;
  const generated = useMemo(() => (product ? buildGroupUpdateText({ productName: product.name, productPriceCents: product.priceCents, productDescription: product.description, rows, goalPieces: goal, options }) : ""), [product, rows, goal, options]);
  const stale = Boolean(override && override.base !== generated);
  const text = override ? override.text : generated;
  const set = (patch: Partial<GroupUpdateOptions>) => setOptions(current => ({ ...current, ...patch }));

  const act = async (next: Exclude<ActionStatus, "api_confirmed">) => {
    if (!product) return null;
    const result = await record({ idempotencyKey: key, kind: "group_update", status: next, destinationType: destination ? "group" : "none", destinationId: destination?.id ?? null, productId: product.id, reminderId: reminderId ?? null, title: `Atualização — ${product.name}`, message: text.slice(0, 50000) });
    if (result) setStatus(result);
    return result;
  };
  const share = async () => {
    const started = await shareReportOnWhatsApp(text, product, { targetUrl: destination?.inviteUrl ?? undefined });
    if (!started) return;
    await act("share_started");
    toast.info(destination?.inviteUrl ? "Texto copiado e grupo aberto: cole a mensagem e envie. Depois confirme aqui." : "Compartilhamento iniciado. Escolha o grupo, envie e depois confirme aqui.");
  };
  const persistGoal = async () => {
    if (!product) return;
    try {
      await saveLot.mutateAsync({ productId: product.id, goalPieces: goal });
      await utils.messages.overview.invalidate();
      toast.success(goal ? "Meta do lote salva" : "Meta removida");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar a meta");
    }
  };
  const confirmed = status === "manual_confirmed";

  return (
    <div className="mc-grid">
      <section className="mc-panel">
        <div className="mc-panel-head"><div><div className="eyebrow">lote / campanha</div><h3>O que atualizar</h3></div></div>
        <Field label="Produto do lote">
          <select value={productId} onChange={event => setProductId(event.target.value)}>
            <option value="">Selecione um produto</option>
            {activeProducts.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
        {product && (
          <>
            <div className="mc-stats">
              <span><strong>{totals.pieces}</strong> peças registradas</span>
              <span><strong>{totals.clients}</strong> clientes</span>
              <span><strong>{formatMoney(totals.totalCents)}</strong> vendido</span>
            </div>
            <Field label="Meta de peças do lote (opcional)" hint="Você decide quando fechar o lote; a meta só mostra o progresso.">
              <div className="mc-inline">
                <input type="number" min="1" inputMode="numeric" value={goalInput} onChange={event => setGoalInput(event.target.value)} placeholder="Sem meta" />
                <Button size="sm" variant="outline" onClick={persistGoal} disabled={saveLot.isPending || (goal ?? null) === (lot?.goalPieces ?? null)}>Salvar meta</Button>
              </div>
            </Field>
            {progress && (
              <div className="mc-progress" aria-label={`Progresso ${progress.percent}%`}>
                <div><i style={{ width: `${progress.percent}%` }} /></div>
                <small>{progress.reached ? `Meta atingida: ${progress.total} de ${progress.goal} peças` : `${progress.total} de ${progress.goal} peças · faltam ${progress.remaining}`}</small>
              </div>
            )}
            <p className="mc-note">Pedido registrado é a quantidade atribuída à cliente — não significa que o lote já foi pedido ao fornecedor.</p>
            <div className="mc-checks">
              <Check2 checked={options.showPaymentStatus ?? true} onChange={value => set({ showPaymentStatus: value })}>Exibir status de pagamento (✅ Pago, 📲 Cobrado)</Check2>
              <Check2 checked={options.includePix ?? false} onChange={value => set({ includePix: value })}>Incluir Chave Pix no final</Check2>
              <Check2 checked={options.showNames} onChange={value => set({ showNames: value })}>Mostrar nomes e quantidades</Check2>
              <Check2 checked={options.showPrices} onChange={value => set({ showPrices: value })}>Mostrar preço</Check2>
              <Check2 checked={options.showPhones} onChange={value => set({ showPhones: value })}>Mostrar telefones (evite em grupo público)</Check2>
              <Check2 checked={options.showTotals} onChange={value => set({ showTotals: value })}>Mostrar totais</Check2>
              <Check2 checked={options.showProgress} onChange={value => set({ showProgress: value })}>Mostrar progresso da meta</Check2>
            </div>
            <Field label="Abertura"><input value={options.intro} onChange={event => set({ intro: event.target.value })} maxLength={120} /></Field>
            <Field label="Fechamento (opcional)"><input value={options.closing} onChange={event => set({ closing: event.target.value })} maxLength={200} placeholder="Ex.: Quem quiser mais peças, responda aqui!" /></Field>
          </>
        )}
      </section>

      <section className="mc-panel">
        <div className="mc-panel-head">
          <div><div className="eyebrow">prévia editável</div><h3>Mensagem para o grupo</h3></div>
          <StatusChip status={status} />
        </div>
        {!product ? <Empty icon={Users} title="Escolha um produto">A lista é montada com as quantidades já registradas.</Empty> : rowsQuery.isLoading ? <div className="mc-loading"><RefreshCw className="spin" size={16} /> Carregando quantidades...</div> : (
          <>
            {stale && <div className="mc-warning"><AlertTriangle size={15} /> As quantidades mudaram depois da sua edição. <button type="button" onClick={() => setOverride(null)}>Regenerar com dados atuais</button></div>}
            <Field label="Destino">
              <select value={destinationId} onChange={event => setDestinationId(event.target.value)}>
                <option value="">Sem destino definido (escolho no WhatsApp)</option>
                {destinations.filter((item: any) => item.active).map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
            <textarea className="mc-preview" value={text} onChange={event => setOverride({ text: event.target.value, base: generated })} aria-label="Texto da mensagem" />
            <div className="mc-meta"><span>{text.length} caracteres{text.length > 1020 && product?.imageUrl ? " · acima de 1.024 caract. (limite de legenda de foto do WhatsApp), será enviado como texto completo sem cortes" : ""}</span>{override && <button type="button" onClick={() => setOverride(null)}>Descartar edição</button>}</div>
            <div className="mc-actions">
              <Button variant="outline" size="sm" onClick={() => act("draft")} disabled={!text}>Salvar rascunho</Button>
              <Button variant="outline" size="sm" onClick={() => { copyTextSync(text); toast.success("Texto copiado"); void act("ready"); }} disabled={!text}><Copy size={14} /> Copiar</Button>
              <Button size="sm" onClick={share} disabled={!text}><MessageCircle size={14} /> "WhatsApp"</Button>
              {destination?.inviteUrl && <Button variant="outline" size="sm" onClick={() => window.open(destination.inviteUrl, "_blank", "noopener,noreferrer")}><ExternalLink size={14} /> Abrir grupo</Button>}
            </div>
            <div className="mc-confirm">
              <p>Abrir o WhatsApp não envia a mensagem. Depois de enviar, confirme:</p>
              <Button size="sm" onClick={() => act("manual_confirmed")} disabled={confirmed || !text}><Check size={14} /> {confirmed ? "Envio confirmado" : "Confirmei que enviei"}</Button>
              {confirmed && <Button size="sm" variant="ghost" onClick={() => { setKey(newKey("update")); setStatus(null); setOverride(null); }}>Nova mensagem deste lote</Button>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cobrar clientes (uma mensagem por pedido; nunca coletiva)
// ---------------------------------------------------------------------------

type ChargeCardState = { templateId: number; override: { text: string; base: string } | null; snapshot: number; key: string; status: ActionStatus | null };

function ChargesTab({ orders, loading, templates, record, refetchOrders }: { orders: any[]; loading: boolean; templates: any[]; record: Recorder; refetchOrders: () => Promise<{ data?: unknown }> }) {
  const [search, setSearch] = useState("");
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [cards, setCards] = useState<Record<number, ChargeCardState>>({});

  const collectible = useMemo(() => collectibleOrders(orders as ChargeOrder[]) as any[], [orders]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return collectible.filter(order => (!onlyOverdue || order.status === "overdue") && (!q || order.client.name.toLowerCase().includes(q) || order.client.phone.toLowerCase().includes(q) || order.code.toLowerCase().includes(q)));
  }, [collectible, search, onlyOverdue]);
  const byId = useMemo(() => new Map(orders.map(order => [order.id, order])), [orders]);
  const selectedIds = Object.keys(cards).map(Number);
  const selectedTotal = selectedIds.reduce((sum, id) => sum + (byId.get(id) ? openBalanceCents(byId.get(id)) : 0), 0);

  const select = (order: any) => setCards(current => {
    if (current[order.id]) {
      const { [order.id]: _removed, ...rest } = current;
      return rest;
    }
    return { ...current, [order.id]: { templateId: templates.find((t: any) => t.name?.includes("Pix") || t.body?.includes("Pix"))?.id ?? templates[0]?.id ?? 0, override: null, snapshot: openBalanceCents(order), key: newKey(`charge-${order.id}`), status: order.isCharged ? "manual_confirmed" : null } };
  });
  const patchCard = (id: number, patch: Partial<ChargeCardState>) => setCards(current => (current[id] ? { ...current, [id]: { ...current[id], ...patch } } : current));

  return (
    <div className="mc-stack">
      <section className="mc-panel">
        <div className="mc-panel-head">
          <div><div className="eyebrow">saldo pendente / vencido</div><h3>Quem receber cobrança</h3></div>
          <span className="mc-count">{selectedIds.length} selecionada(s){selectedIds.length ? ` · ${formatMoney(selectedTotal)}` : ""}</span>
        </div>
        <div className="mc-filters">
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar cliente, telefone ou pedido..." aria-label="Buscar" />
          <Check2 checked={onlyOverdue} onChange={setOnlyOverdue}>Só vencidos</Check2>
          <Button size="sm" variant="outline" onClick={() => setCards(current => Object.fromEntries([...Object.entries(current), ...visible.filter(order => !current[order.id]).map(order => [order.id, { templateId: templates[0]?.id ?? 0, override: null, snapshot: openBalanceCents(order), key: newKey(`charge-${order.id}`), status: null } as ChargeCardState])]))} disabled={!visible.length}>Selecionar visíveis</Button>
          <Button size="sm" variant="ghost" onClick={() => setCards({})} disabled={!selectedIds.length}>Limpar</Button>
        </div>
        <p className="mc-note">Cada pedido gera uma mensagem separada. Saldos e dados financeiros nunca vão para outras clientes nem para o grupo.</p>
        {loading ? <div className="mc-loading"><RefreshCw className="spin" size={16} /> Carregando pedidos...</div> : visible.length === 0 ? <Empty icon={Check} title="Nenhum pedido com saldo">Quando houver pedidos pendentes ou vencidos, eles aparecem aqui.</Empty> : (
          <ul className="mc-list">
            {visible.map(order => (
              <li key={order.id}>
                <label className="mc-pick">
                  <input type="checkbox" checked={Boolean(cards[order.id])} onChange={() => select(order)} />
                  <span className="mc-pick-main"><strong>{order.client.name}</strong><small>{order.client.phone} · {order.code}</small></span>
                  <span className={`mc-pick-balance ${order.status === "overdue" ? "overdue" : ""}`}>{formatMoney(openBalanceCents(order))}{order.status === "overdue" ? " · vencido" : ""}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selectedIds.length > 0 && (
        <section className="mc-panel">
          <div className="mc-panel-head"><div><div className="eyebrow">uma por cliente/pedido</div><h3>Revise cada mensagem</h3></div></div>
          <div className="mc-cards">
            {selectedIds.map(id => {
              const order = byId.get(id);
              if (!order) return null;
              return <ChargeCard key={id} order={order} card={cards[id]} templates={templates} record={record} refetchOrders={refetchOrders} onPatch={patch => patchCard(id, patch)} onRemove={() => select(order)} />;
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function ChargeCard({ order, card, templates, record, refetchOrders, onPatch, onRemove }: { order: any; card: ChargeCardState; templates: any[]; record: Recorder; refetchOrders: () => Promise<{ data?: unknown }>; onPatch: (patch: Partial<ChargeCardState>) => void; onRemove: () => void }) {
  const pixTemplate = templates.find((t: any) => t.name?.includes("Pix") || t.body?.includes("Pix")) ?? templates[0];
  const template = templates.find(item => item.id === card.templateId) ?? pixTemplate ?? templates[0];
  const balance = openBalanceCents(order);
  const generated = template ? fillChargeTemplate(template.body, order) : "";
  const text = card.override ? card.override.text : generated;
  const balanceChanged = balance !== card.snapshot;
  const stale = Boolean(card.override && card.override.base !== generated);
  const closed = order.status === "cancelled" || balance === 0;
  const blocked = balanceChanged || closed;

  const createPayment = trpc.payments.create.useMutation();
  const cancelOrder = trpc.orders.cancel.useMutation();
  const utils = trpc.useUtils();

  const act = async (status: Exclude<ActionStatus, "api_confirmed">) => {
    const result = await record({ idempotencyKey: card.key, kind: "charge", status, destinationType: "client", clientId: order.clientId ?? order.client.id, orderId: order.id, title: `Cobrança ${order.code} — ${order.client.name}`.slice(0, 200), message: text.slice(0, 50000), expectedBalanceCents: card.snapshot });
    if (result) onPatch({ status: result });
    return result;
  };

  const openWhatsApp = async () => {
    const popup = window.open("about:blank", "_blank");
    const fresh = (((await refetchOrders()).data ?? []) as ChargeOrder[]);
    const changes = detectBalanceChanges({ [order.id]: card.snapshot }, fresh);
    if (changes.length) {
      popup?.close();
      toast.warning(`O saldo de ${order.client.name} mudou (${formatMoney(changes[0].expectedCents)} → ${formatMoney(changes[0].currentCents)}). Atualize a prévia e revise antes de abrir.`);
      return;
    }
    if (!popup) {
      copyTextSync(text);
      toast.error("O navegador bloqueou a nova aba. O texto foi copiado; libere pop-ups ou cole manualmente no WhatsApp.");
      return;
    }
    popup.opener = null;
    popup.location.href = waChatUrl(order.client.phone, text);
    const result = await act("share_started");
    if (result) toast.info("WhatsApp aberto!");
  };

  return (
    <article className={`mc-card ${card.status === "manual_confirmed" ? "done" : ""}`}>
      <header>
        <div><strong>{order.client.name}</strong><small>{order.client.phone} · {order.code} · saldo {formatMoney(balance)}</small></div>
        <div className="mc-card-head-right"><StatusChip status={card.status} /><button type="button" className="mc-icon" onClick={onRemove} aria-label="Remover da seleção"><X size={15} /></button></div>
      </header>
      {closed && <div className="mc-warning"><AlertTriangle size={15} /> Este pedido não tem mais saldo cobrável (quitado ou cancelado). Remova da seleção.</div>}
      {balanceChanged && !closed && <div className="mc-warning"><AlertTriangle size={15} /> O saldo mudou: {formatMoney(card.snapshot)} → {formatMoney(balance)}. <button type="button" onClick={() => onPatch({ snapshot: balance, override: null })}>Atualizar prévia</button></div>}
      {stale && !balanceChanged && <div className="mc-warning"><AlertTriangle size={15} /> Os dados do pedido mudaram depois da sua edição. <button type="button" onClick={() => onPatch({ override: null })}>Regenerar</button></div>}
      <Field label="Modelo">
        <select value={card.templateId} onChange={event => onPatch({ templateId: Number(event.target.value), override: null })}>
          {templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </Field>
      <textarea className="mc-preview small" value={text} onChange={event => onPatch({ override: { text: event.target.value, base: generated } })} aria-label={`Mensagem para ${order.client.name}`} />
      <div className="vmc-card-actions" style={{ marginTop: "10px" }}>
        <button
          type="button"
          className="vmc-action-btn copy"
          disabled={blocked || !text}
          onClick={() => { copyTextSync(text); toast.success("Mensagem copiada"); void act("ready"); }}
        >
          <Copy size={14} /> Copiar
        </button>
        <button
          type="button"
          className="vmc-action-btn share"
          disabled={blocked || !text}
          onClick={openWhatsApp}
        >
          <MessageCircle size={14} /> WhatsApp
        </button>
        <button
          type="button"
          className={`vmc-action-btn charged ${order.isCharged || card.status === "manual_confirmed" ? "is-active" : ""}`}
          disabled={closed}
          onClick={async () => {
            const ok = await act("manual_confirmed");
            if (ok) {
              order.isCharged = true;
              void utils.orders.list.invalidate();
              void utils.reports.rows.invalidate();
              toast.success(`Cobrança de ${order.client.name} marcada como enviada!`);
            }
          }}
        >
          <Check size={14} /> Cobrado
        </button>
        <button
          type="button"
          className={`vmc-action-btn paid ${order.status === "paid" || order.isPaid ? "is-active" : ""}`}
          disabled={order.status === "paid" || order.isPaid || closed}
          onClick={async () => {
            if (!window.confirm(`Deseja marcar o pedido ${order.code} de ${order.client.name} como PAGO (${formatMoney(balance)})?`)) return;
            await createPayment.mutateAsync({ orderId: order.id, amountCents: balance, method: "PIX", notes: "Baixa manual" });
            await act("manual_confirmed");
            void refetchOrders();
            void utils.orders.list.invalidate();
            void utils.reports.rows.invalidate();
            void utils.dashboard.summary.invalidate();
            toast.success(`Pedido de ${order.client.name} quitado com sucesso!`);
          }}
        >
          <Check size={14} /> Pago
        </button>
        <button
          type="button"
          className="vmc-action-btn cancel"
          disabled={order.status === "cancelled"}
          onClick={async () => {
            if (!window.confirm(`Deseja realmente CANCELAR o pedido ${order.code} de ${order.client.name}?`)) return;
            await cancelOrder.mutateAsync({ id: order.id });
            void refetchOrders();
            void utils.orders.list.invalidate();
            void utils.reports.rows.invalidate();
            void utils.dashboard.summary.invalidate();
            toast.success(`Pedido de ${order.client.name} cancelado.`);
          }}
        >
          <X size={14} /> Cancelar
        </button>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Relatório operacional / separação
// ---------------------------------------------------------------------------

function ReportTab({ products, destinations, record }: { products: any[]; destinations: any[]; record: Recorder }) {
  const [productId, setProductId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [includePhones, setIncludePhones] = useState(true);
  const [includePrices, setIncludePrices] = useState(true);
  const [destinationId, setDestinationId] = useState("");
  const [override, setOverride] = useState<{ text: string; base: string } | null>(null);
  const [key, setKey] = useState(() => newKey("report"));
  const [status, setStatus] = useState<ActionStatus | null>(null);

  const rowsQuery = trpc.reports.rows.useQuery({ productId: productId ? Number(productId) : undefined, from: from || undefined, to: to || undefined });
  const rows = (rowsQuery.data ?? []) as ReportRow[];
  const totals = reportTotals(rows);
  const productIds = Array.from(new Set(rows.map(row => row.productId)));
  const photoProduct = productIds.length === 1 ? products.find(item => item.id === productIds[0]) ?? null : null;
  const destination = destinations.find(item => String(item.id) === destinationId && item.active) ?? null;
  const generated = useMemo(() => buildReportText(rows, { includePhones, includePrices }), [rows, includePhones, includePrices]);
  const stale = Boolean(override && override.base !== generated);
  const text = override ? override.text : generated;

  useEffect(() => { setKey(newKey("report")); setStatus(null); setOverride(null); }, [productId, from, to, includePhones, includePrices]);

  const act = async (next: Exclude<ActionStatus, "api_confirmed">) => {
    const result = await record({ idempotencyKey: key, kind: "report", status: next, destinationType: destination ? "group" : "none", destinationId: destination?.id ?? null, productId: productId ? Number(productId) : null, title: productId ? `Relatório — ${products.find(item => String(item.id) === productId)?.name ?? "produto"}` : "Relatório geral", message: (text || "(vazio)").slice(0, 50000) });
    if (result) setStatus(result);
    return result;
  };
  const share = async () => {
    const started = await shareReportOnWhatsApp(text, photoProduct, { targetUrl: destination?.inviteUrl ?? undefined });
    if (started) {
      await act("share_started");
      toast.info("Compartilhamento iniciado. Depois de enviar, confirme aqui.");
    }
  };

  return (
    <div className="mc-grid">
      <section className="mc-panel">
        <div className="mc-panel-head"><div><div className="eyebrow">separação · conferência</div><h3>Filtros do relatório</h3></div></div>
        <Field label="Produto"><select value={productId} onChange={event => setProductId(event.target.value)}><option value="">Todos os produtos</option>{products.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <div className="mc-two">
          <Field label="De"><input type="date" value={from} onChange={event => setFrom(event.target.value)} /></Field>
          <Field label="Até"><input type="date" value={to} onChange={event => setTo(event.target.value)} /></Field>
        </div>
        <div className="mc-checks">
          <Check2 checked={includePhones} onChange={setIncludePhones}>Incluir telefones (útil na separação; evite em grupo público)</Check2>
          <Check2 checked={includePrices} onChange={setIncludePrices}>Incluir preço unitário histórico</Check2>
        </div>
        <div className="mc-stats">
          <span><strong>{totals.clients}</strong> clientes</span>
          <span><strong>{totals.pieces}</strong> peças</span>
          <span><strong>{formatMoney(totals.totalCents)}</strong> total</span>
        </div>
        <p className="mc-note">Mesmo formato dos Relatórios: produto e preço, cliente e quantidade, telefone na linha seguinte e resumo final. Cancelados ficam fora.</p>
      </section>

      <section className="mc-panel">
        <div className="mc-panel-head"><div><div className="eyebrow">prévia editável</div><h3>Relatório pronto</h3></div><StatusChip status={status} /></div>
        {rowsQuery.isLoading ? <div className="mc-loading"><RefreshCw className="spin" size={16} /> Gerando relatório...</div> : rows.length === 0 ? <Empty icon={FileText} title="Sem vendas neste filtro">Ajuste os filtros ou registre pedidos.</Empty> : (
          <>
            {stale && <div className="mc-warning"><AlertTriangle size={15} /> Os dados mudaram depois da sua edição. <button type="button" onClick={() => setOverride(null)}>Regenerar</button></div>}
            <Field label="Destino">
              <select value={destinationId} onChange={event => setDestinationId(event.target.value)}>
                <option value="">Sem destino definido (escolho no WhatsApp)</option>
                {destinations.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
            <textarea className="mc-preview" value={text} onChange={event => setOverride({ text: event.target.value, base: generated })} aria-label="Texto do relatório" />
            <div className="mc-actions">
              <Button size="sm" variant="outline" onClick={() => { copyTextSync(text); toast.success("Relatório copiado"); void act("ready"); }}><Copy size={14} /> Copiar</Button>
              <Button size="sm" onClick={share}><MessageCircle size={14} /> "WhatsApp"</Button>
              <Button size="sm" variant="outline" onClick={() => downloadText("relatorio-venda-atacado.txt", text)}><Download size={14} /> TXT</Button>
              <Button size="sm" variant="outline" onClick={() => downloadText("relatorio-venda-atacado.csv", csvFromRows(includePhones ? rows : rows.map(row => ({ ...row, phone: "" }))), "text/csv;charset=utf-8")}><Download size={14} /> Excel (CSV)</Button>
            </div>
            <div className="mc-confirm">
              <p>Depois de enviar pelo WhatsApp, confirme:</p>
              <Button size="sm" onClick={() => act("manual_confirmed")} disabled={status === "manual_confirmed"}><Check size={14} /> {status === "manual_confirmed" ? "Envio confirmado" : "Confirmei que enviei"}</Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lembretes (avisam você; nunca enviam)
// ---------------------------------------------------------------------------

type ReminderForm = { id?: number; kind: "group_update" | "charges_review"; title: string; productId: string; destinationId: string; intervalValue: string; unit: "min" | "h"; startAt: string; timezone: string; quietOn: boolean; quietStart: string; quietEnd: string };
const emptyReminder: ReminderForm = { kind: "group_update", title: "", productId: "", destinationId: "", intervalValue: "1", unit: "h", startAt: "", timezone: deviceTimezone, quietOn: true, quietStart: "22:00", quietEnd: "07:00" };
const SUGGESTIONS: Array<{ label: string; patch: Partial<ReminderForm> }> = [
  { label: "Atualizar o grupo a cada 1 hora", patch: { kind: "group_update", intervalValue: "1", unit: "h" } },
  { label: "Revisar cobranças a cada 2 horas", patch: { kind: "charges_review", intervalValue: "2", unit: "h" } },
];

function RemindersTab({ overview, products, destinations, dueList, onReview, loading }: { overview: any; products: any[]; destinations: any[]; dueList: any[]; onReview: (reminder: any) => void; loading: boolean }) {
  const utils = trpc.useUtils();
  const saveReminder = trpc.messages.saveReminder.useMutation();
  const setStatus = trpc.messages.setReminderStatus.useMutation();
  const [form, setForm] = useState<ReminderForm | null>(null);
  const reminders = (overview?.reminders ?? []) as any[];
  const events = (overview?.events ?? []) as any[];
  const dueIds = new Set(dueList.map(item => item.id));
  const canNotify = typeof Notification !== "undefined";
  const [permission, setPermission] = useState(canNotify ? Notification.permission : "denied");

  const refresh = () => Promise.all([utils.messages.overview.invalidate(), utils.messages.dueReminders.invalidate()]);
  const patch = (value: Partial<ReminderForm>) => setForm(current => (current ? { ...current, ...value } : current));

  const submit = async () => {
    if (!form) return;
    const interval = Math.round(Number(form.intervalValue) * (form.unit === "h" ? 60 : 1));
    if (!Number.isFinite(interval) || interval < 5) return toast.error("Informe um intervalo de pelo menos 5 minutos");
    try {
      await saveReminder.mutateAsync({
        id: form.id,
        kind: form.kind,
        title: form.title.trim() || undefined,
        productId: form.kind === "group_update" && form.productId ? Number(form.productId) : null,
        destinationId: form.destinationId ? Number(form.destinationId) : null,
        intervalMinutes: interval,
        startAt: form.startAt ? new Date(form.startAt) : undefined,
        timezone: form.timezone,
        quietStart: form.quietOn ? form.quietStart : null,
        quietEnd: form.quietOn ? form.quietEnd : null,
      });
      toast.success(form.id ? "Lembrete atualizado" : "Lembrete criado");
      setForm(null);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o lembrete");
    }
  };
  const change = async (id: number, status: "active" | "paused" | "completed" | "discarded", pauseMinutes?: number) => {
    if (status === "discarded" && !window.confirm("Descartar este lembrete? Ele deixa de aparecer e não pode ser reativado.")) return;
    try {
      await setStatus.mutateAsync({ id, status, pauseMinutes });
      await refresh();
      toast.success(status === "paused" ? "Lembrete pausado" : status === "active" ? "Lembrete retomado" : status === "completed" ? "Lembrete encerrado" : "Lembrete descartado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível alterar o lembrete");
    }
  };
  const edit = (reminder: any) => setForm({
    id: reminder.id,
    kind: reminder.kind,
    title: reminder.title,
    productId: reminder.productId ? String(reminder.productId) : "",
    destinationId: reminder.destinationId ? String(reminder.destinationId) : "",
    intervalValue: String(reminder.intervalMinutes % 60 === 0 ? reminder.intervalMinutes / 60 : reminder.intervalMinutes),
    unit: reminder.intervalMinutes % 60 === 0 ? "h" : "min",
    startAt: "",
    timezone: reminder.timezone,
    quietOn: Boolean(reminder.quietStart),
    quietStart: reminder.quietStart ?? "22:00",
    quietEnd: reminder.quietEnd ?? "07:00",
  });

  return (
    <div className="mc-stack">
      <section className="mc-panel">
        <div className="mc-panel-head">
          <div><div className="eyebrow">avisos recorrentes</div><h3>Lembretes</h3></div>
          <Button size="sm" onClick={() => setForm({ ...emptyReminder })}><Plus size={14} /> Novo lembrete</Button>
        </div>
        <p className="mc-note">Lembretes só avisam <strong>você</strong>, enquanto o app estiver aberto (ele confere a cada minuto e ao voltar para a aba). Nenhuma mensagem é publicada ou cobrança repetida automaticamente. Nada é criado até você salvar.</p>
        <div className="mc-suggestions">
          {SUGGESTIONS.map(item => <button key={item.label} type="button" onClick={() => setForm({ ...emptyReminder, ...item.patch })}><Plus size={12} /> {item.label}</button>)}
        </div>
        {canNotify && permission !== "granted" && (
          <div className="mc-inline-note">
            <span>Notificações do navegador: {permission === "denied" ? "bloqueadas neste navegador" : "desativadas"}.</span>
            {permission === "default" && <Button size="sm" variant="outline" onClick={async () => setPermission(await Notification.requestPermission())}>Ativar avisos</Button>}
          </div>
        )}

        {form && (
          <div className="mc-form">
            <div className="mc-two">
              <Field label="Tipo"><select value={form.kind} onChange={event => patch({ kind: event.target.value as ReminderForm["kind"] })}><option value="group_update">Atualizar grupo/lista</option><option value="charges_review">Revisar cobranças</option></select></Field>
              <Field label="Título (opcional)"><input value={form.title} onChange={event => patch({ title: event.target.value })} maxLength={120} placeholder={form.kind === "group_update" ? "Atualizar o grupo" : "Revisar cobranças"} /></Field>
            </div>
            {form.kind === "group_update" && (
              <Field label="Produto/lote (opcional)"><select value={form.productId} onChange={event => patch({ productId: event.target.value })}><option value="">Escolher na hora</option>{products.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
            )}
            <Field label="Destino sugerido (opcional)"><select value={form.destinationId} onChange={event => patch({ destinationId: event.target.value })}><option value="">Nenhum</option>{destinations.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
            <div className="mc-two">
              <Field label="Repetir a cada"><div className="mc-inline"><input type="number" min="1" value={form.intervalValue} onChange={event => patch({ intervalValue: event.target.value })} /><select value={form.unit} onChange={event => patch({ unit: event.target.value as "min" | "h" })}><option value="min">minutos</option><option value="h">horas</option></select></div></Field>
              <Field label="Primeiro aviso (opcional)" hint={`Horário do seu aparelho (${deviceTimezone}). Em branco: depois de um intervalo.`}><input type="datetime-local" value={form.startAt} onChange={event => patch({ startAt: event.target.value })} /></Field>
            </div>
            <Field label="Fuso horário do lembrete" hint="Define o horário silencioso e como a próxima ocorrência é exibida.">
              <select value={form.timezone} onChange={event => patch({ timezone: event.target.value })}>{TIMEZONES.map(zone => <option key={zone} value={zone}>{zone}{zone === deviceTimezone ? " (aparelho)" : ""}</option>)}</select>
            </Field>
            <Check2 checked={form.quietOn} onChange={value => patch({ quietOn: value })}>Não avisar em horário silencioso</Check2>
            {form.quietOn && <div className="mc-two"><Field label="Silêncio a partir de"><input type="time" value={form.quietStart} onChange={event => patch({ quietStart: event.target.value })} /></Field><Field label="Até"><input type="time" value={form.quietEnd} onChange={event => patch({ quietEnd: event.target.value })} /></Field></div>}
            <div className="mc-actions"><Button size="sm" onClick={submit} disabled={saveReminder.isPending}><Check size={14} /> {form.id ? "Salvar alterações" : "Criar lembrete"}</Button><Button size="sm" variant="ghost" onClick={() => setForm(null)}>Cancelar</Button></div>
          </div>
        )}

        {loading ? <div className="mc-loading"><RefreshCw className="spin" size={16} /> Carregando...</div> : reminders.length === 0 ? <Empty icon={BellRing} title="Nenhum lembrete">Crie um lembrete ou use uma sugestão acima.</Empty> : (
          <ul className="mc-list">
            {reminders.map(reminder => {
              const product = products.find(item => item.id === reminder.productId);
              const destination = destinations.find(item => item.id === reminder.destinationId);
              const isDue = dueIds.has(reminder.id);
              return (
                <li key={reminder.id} className="mc-reminder">
                  <div className="mc-reminder-main">
                    <strong>{reminder.title}</strong>
                    <small>{reminder.kind === "group_update" ? "Atualizar grupo" : "Revisar cobranças"} · {describeInterval(reminder.intervalMinutes)}{product ? ` · ${product.name}` : ""}{destination ? ` · ${destination.name}` : ""}</small>
                    <small>
                      {reminder.status === "active" ? <>Próximo aviso: <b>{formatInZone(reminder.nextDueAt, reminder.timezone)}</b> ({reminder.timezone})</> : reminder.status === "paused" ? <>Pausado{reminder.pausedUntil ? ` até ${formatInZone(reminder.pausedUntil, reminder.timezone)}` : ""}</> : "Encerrado"}
                      {reminder.quietStart ? ` · silêncio ${reminder.quietStart}–${reminder.quietEnd}` : ""}
                    </small>
                  </div>
                  <div className="mc-reminder-side">
                    <span className={`mc-chip mc-reminder-${isDue ? "due" : reminder.status}`}>{isDue ? "Pendente agora" : reminder.status === "active" ? "Ativo" : reminder.status === "paused" ? "Pausado" : "Encerrado"}</span>
                    <div className="mc-row-actions">
                      {isDue && <Button size="sm" onClick={() => onReview(dueList.find(item => item.id === reminder.id))}>Revisar</Button>}
                      {reminder.status === "active" && <button type="button" className="mc-icon" title="Pausar" aria-label="Pausar" onClick={() => change(reminder.id, "paused")}><Pause size={15} /></button>}
                      {reminder.status !== "active" && <button type="button" className="mc-icon" title="Retomar" aria-label="Retomar" onClick={() => change(reminder.id, "active")}><Play size={15} /></button>}
                      {reminder.status !== "completed" && <button type="button" className="mc-icon" title="Encerrar (lote concluído)" aria-label="Encerrar" onClick={() => change(reminder.id, "completed")}><Check size={15} /></button>}
                      {reminder.status !== "completed" && <button type="button" className="mc-icon" title="Editar" aria-label="Editar" onClick={() => edit(reminder)}><Pencil size={15} /></button>}
                      <button type="button" className="mc-icon danger" title="Descartar" aria-label="Descartar" onClick={() => change(reminder.id, "discarded")}><Trash2 size={15} /></button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mc-panel">
        <div className="mc-panel-head"><div><div className="eyebrow">histórico de lembretes</div><h3>Ocorrências tratadas</h3></div></div>
        {events.length === 0 ? <Empty icon={Clock} title="Nenhuma ocorrência tratada ainda" /> : (
          <ul className="mc-timeline">
            {events.map(event => <li key={event.id}><b>{reminders.find(item => item.id === event.reminderId)?.title ?? `Lembrete ${event.reminderId}`}</b> — {event.outcome === "completed" ? "concluído" : event.outcome === "snoozed" ? "adiado" : "dispensado"} <small>(previsto {formatDateTime(event.dueAt)} · tratado {formatDateTime(event.createdAt)})</small></li>)}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Destinos (grupos cadastrados manualmente)
// ---------------------------------------------------------------------------

function DestinationsTab({ destinations }: { destinations: any[] }) {
  const utils = trpc.useUtils();
  const save = trpc.messages.saveDestination.useMutation();
  const [form, setForm] = useState<{ id?: number; name: string; description: string; inviteUrl: string } | null>(null);

  const submit = async (values = form, active?: boolean) => {
    if (!values) return;
    try {
      await save.mutateAsync({ id: values.id, name: values.name, description: values.description || undefined, inviteUrl: values.inviteUrl || undefined, active });
      toast.success(values.id ? "Destino atualizado" : "Destino cadastrado");
      setForm(null);
      await utils.messages.overview.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o destino");
    }
  };

  return (
    <section className="mc-panel">
      <div className="mc-panel-head">
        <div><div className="eyebrow">grupos do WhatsApp</div><h3>Destinos</h3></div>
        <Button size="sm" onClick={() => setForm({ name: "", description: "", inviteUrl: "" })}><Plus size={14} /> Novo destino</Button>
      </div>
      <p className="mc-note">Cadastre aqui os seus grupos. O link de convite só abre o grupo no WhatsApp — ele não publica nada e não aceita texto pronto, por isso a mensagem é copiada para você colar. O sistema não descobre grupos nem números sozinho.</p>
      {form && (
        <div className="mc-form">
          <Field label="Nome do grupo"><input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} maxLength={80} /></Field>
          <Field label="Descrição (opcional)"><input value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} maxLength={280} /></Field>
          <Field label="Link de convite (opcional)" hint="Somente https do próprio WhatsApp (chat.whatsapp.com ou wa.me)."><input value={form.inviteUrl} onChange={event => setForm({ ...form, inviteUrl: event.target.value })} placeholder="https://chat.whatsapp.com/..." inputMode="url" /></Field>
          <div className="mc-actions"><Button size="sm" onClick={() => submit()} disabled={save.isPending || form.name.trim().length < 2}><Check size={14} /> Salvar</Button><Button size="sm" variant="ghost" onClick={() => setForm(null)}>Cancelar</Button></div>
        </div>
      )}
      {destinations.length === 0 ? <Empty icon={Users} title="Nenhum destino cadastrado">Sem destino, a mensagem é copiada/compartilhada e você escolhe o grupo no WhatsApp.</Empty> : (
        <ul className="mc-list">
          {destinations.map(item => (
            <li key={item.id} className={`mc-reminder ${item.active ? "" : "inactive"}`}>
              <div className="mc-reminder-main"><strong>{item.name}{item.active ? "" : " (arquivado)"}</strong><small>{item.description || "Sem descrição"}{item.inviteUrl ? " · com link de convite" : " · sem link"}</small></div>
              <div className="mc-row-actions">
                {item.inviteUrl && <button type="button" className="mc-icon" title="Abrir grupo no WhatsApp" aria-label="Abrir grupo" onClick={() => window.open(item.inviteUrl, "_blank", "noopener,noreferrer")}><ExternalLink size={15} /></button>}
                <button type="button" className="mc-icon" title="Editar" aria-label="Editar" onClick={() => setForm({ id: item.id, name: item.name, description: item.description ?? "", inviteUrl: item.inviteUrl ?? "" })}><Pencil size={15} /></button>
                <button type="button" className="mc-icon" title={item.active ? "Arquivar" : "Reativar"} aria-label={item.active ? "Arquivar" : "Reativar"} onClick={() => submit({ id: item.id, name: item.name, description: item.description ?? "", inviteUrl: item.inviteUrl ?? "" }, !item.active)}>{item.active ? <Trash2 size={15} /> : <Play size={15} />}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Histórico de ações
// ---------------------------------------------------------------------------

function HistoryTab({ overview }: { overview: any }) {
  const actions = (overview?.actions ?? []) as any[];
  const destinations = (overview?.destinations ?? []) as any[];
  const kindLabel = (kind: string) => (kind === "group_update" ? "Atualização do grupo" : kind === "charge" ? "Cobrança" : "Relatório");
  return (
    <section className="mc-panel">
      <div className="mc-panel-head"><div><div className="eyebrow">o que realmente aconteceu</div><h3>Histórico de mensagens</h3></div></div>
      <p className="mc-note">“WhatsApp aberto” indica apenas que o compartilhamento foi iniciado. Só aparece “envio confirmado” quando você mesma confirma.</p>
      {actions.length === 0 ? <Empty icon={MessageCircle} title="Nada registrado ainda">Rascunhos, cópias, aberturas do WhatsApp e confirmações aparecem aqui.</Empty> : (
        <ul className="mc-list">
          {actions.map(action => {
            const log = (() => { try { return JSON.parse(action.statusLog) as Array<{ status: ActionStatus; at: string }>; } catch { return []; } })();
            return (
              <li key={action.id} className="mc-history">
                <div className="mc-history-head"><div><strong>{action.title}</strong><small>{kindLabel(action.kind)}{action.destinationType === "group" ? ` · ${destinations.find(item => item.id === action.destinationId)?.name ?? "grupo"}` : action.destinationType === "client" ? " · cliente" : ""} · {formatDateTime(action.updatedAt)}</small></div><StatusChip status={action.status} /></div>
                <details><summary>Ver mensagem e linha do tempo</summary><pre>{action.message}</pre><ol>{log.map((entry, index) => <li key={index}>{ACTION_STATUS_LABELS[entry.status]} — {formatDateTime(entry.at)}</li>)}</ol></details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

