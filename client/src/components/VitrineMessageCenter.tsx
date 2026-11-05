import { Button } from "@/components/ui/button";
import { copyTextSync, shareReportOnWhatsApp } from "@/lib/shareTools";
import { trpc } from "@/lib/trpc";
import { formatMoney } from "@shared/format";
import {
  ACTION_STATUS_LABELS,
  type ActionStatus,
  type GroupUpdateOptions,
  type ReportRow,
  buildGroupUpdateText,
  collectibleOrders,
  computeProgress,
  defaultGroupUpdateOptions,
  fillChargeTemplate,
  openBalanceCents,
  waChatUrl,
} from "@shared/messaging";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  MessageCircle,
  Send,
  Package,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

export type VitrineMessageMode = "group_update" | "charges";

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const newKey = (prefix: string) => `${prefix}:${uid()}`;

export default function VitrineMessageCenter({
  open,
  onClose,
  initialProductId,
}: {
  open: boolean;
  onClose: () => void;
  initialProductId?: number | null;
}) {
  const [mode, setMode] = useState<VitrineMessageMode>("group_update");
  const [selectedProductId, setSelectedProductId] = useState<number | null>(initialProductId ?? null);
  const initializedForOpenRef = useRef(false);

  const utils = trpc.useUtils();
  const productsQuery = trpc.products.list.useQuery({ search: "" }, { enabled: open });
  const ordersQuery = trpc.orders.list.useQuery({ search: "", status: "all" }, { enabled: open, refetchInterval: open ? 30_000 : false });
  const overviewQuery = trpc.messages.overview.useQuery(undefined, { enabled: open, refetchInterval: open ? 30_000 : false });
  const templatesQuery = trpc.charges.templates.useQuery(undefined, { enabled: open });
  const recordAction = trpc.messages.recordAction.useMutation();

  const products = (productsQuery.data ?? []) as any[];
  const activeProducts = useMemo(() => products.filter((p: any) => p.active), [products]);
  const orders = (ordersQuery.data ?? []) as any[];
  const overview = overviewQuery.data;
  const templates = (templatesQuery.data ?? []) as any[];
  const destinations = (overview?.destinations ?? []).filter((d: any) => d.active);

  // Sincroniza produto inicial apenas ao abrir o modal, sem sobrescrever a escolha manual da usuária
  useEffect(() => {
    if (!open) {
      initializedForOpenRef.current = false;
      return;
    }
    if (initializedForOpenRef.current) return;

    if (initialProductId && activeProducts.some((p: any) => p.id === initialProductId)) {
      setSelectedProductId(initialProductId);
      initializedForOpenRef.current = true;
      return;
    }

    if (activeProducts.length > 0) {
      const productWithOrders = activeProducts.find((p: any) =>
        orders.some(
          (o: any) =>
            o.status !== "cancelled" &&
            o.items?.some((item: any) => item.productId === p.id)
        )
      );
      setSelectedProductId((productWithOrders ?? activeProducts[0]).id);
      initializedForOpenRef.current = true;
    }
  }, [open, initialProductId, activeProducts, orders]);

  if (!open) return null;

  return (
    <div className="vmc-overlay" role="dialog" aria-label="Mensagens da Vitrine" aria-modal="true">
      <div className="vmc-modal">
        {/* Topo limpo e direto */}
        <header className="vmc-header">
          <div className="vmc-header-left">
            <button type="button" className="vmc-close-btn" onClick={onClose} title="Voltar para a Vitrine">
              <ArrowLeft size={16} />
              <span>Vitrine</span>
            </button>
            <div className="vmc-title-box">
              <h2>Mensagens da Vitrine</h2>
              <small>Rápido, visual e integrado</small>
            </div>
          </div>

          <div className="vmc-header-right">
            <button type="button" className="vmc-icon-close" onClick={onClose} aria-label="Fechar">
              <X size={18} />
            </button>
          </div>
        </header>

        {/* Alternador de Modo: Apenas 2 Opções Principais */}
        <div className="vmc-nav-bar">
          <button
            type="button"
            className={`vmc-nav-tab ${mode === "group_update" ? "active" : ""}`}
            onClick={() => setMode("group_update")}
          >
            <Users size={16} />
            <span>Atualização de grupo</span>
          </button>
          <button
            type="button"
            className={`vmc-nav-tab ${mode === "charges" ? "active" : ""}`}
            onClick={() => setMode("charges")}
          >
            <MessageCircle size={16} />
            <span>Cobrança de clientes</span>
          </button>
        </div>

        {/* Conteúdo Dinâmico */}
        <div className="vmc-body">
          {mode === "group_update" ? (
            <VitrineGroupUpdateFlow
              products={activeProducts}
              orders={orders}
              recentActions={overview?.actions ?? []}
              selectedProductId={selectedProductId}
              onSelectProduct={setSelectedProductId}
              destinations={destinations}
              lots={overview?.lots ?? []}
              onActionRecorded={() => {
                void utils.messages.overview.invalidate();
                void utils.orders.list.invalidate();
                void utils.reports.rows.invalidate();
                void utils.dashboard.summary.invalidate();
              }}
              recordAction={recordAction}
            />
          ) : (
            <VitrineChargesFlow
              products={activeProducts}
              orders={orders}
              templates={templates}
              selectedProductId={selectedProductId}
              onSelectProduct={setSelectedProductId}
              onActionRecorded={() => {
                void utils.messages.overview.invalidate();
                void utils.orders.list.invalidate();
                void utils.reports.rows.invalidate();
                void utils.dashboard.summary.invalidate();
              }}
              recordAction={recordAction}
            />
          )}
        </div>
      </div>
    </div>
  );
}

const handleHorizontalWheel = (e: React.WheelEvent<HTMLDivElement>) => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    e.currentTarget.scrollLeft += e.deltaY;
  }
};

// ===========================================================================
// FLUXO 1: ATUALIZAÇÃO DE GRUPO
// ===========================================================================

function VitrineGroupUpdateFlow({
  products,
  orders,
  recentActions = [],
  selectedProductId,
  onSelectProduct,
  destinations,
  lots,
  onActionRecorded,
  recordAction,
}: {
  products: any[];
  orders: any[];
  recentActions?: any[];
  selectedProductId: number | null;
  onSelectProduct: (id: number) => void;
  destinations: any[];
  lots: any[];
  onActionRecorded: () => void;
  recordAction: any;
}) {
  const [showConfig, setShowConfig] = useState(false);
  const [options, setOptions] = useState<GroupUpdateOptions>(() => ({
    ...defaultGroupUpdateOptions,
    showPaymentStatus: true,
  }));
  const [editedText, setEditedText] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState(() => newKey("vupdate"));
  const [status, setStatus] = useState<ActionStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedProduct = useMemo(
    () => products.find((p: any) => p.id === selectedProductId) ?? null,
    [products, selectedProductId]
  );

  // Contagem de peças vendidas por produto (para indicar visualmente nos cards)
  const piecesByProduct = useMemo(() => {
    const map = new Map<number, number>();
    for (const o of orders) {
      if (o.status === "cancelled") continue;
      for (const item of o.items ?? []) {
        map.set(item.productId, (map.get(item.productId) ?? 0) + Number(item.quantity || 0));
      }
    }
    return map;
  }, [orders]);

  // Busca linhas de pedidos do produto selecionado
  const rowsQuery = trpc.reports.rows.useQuery(
    { productId: selectedProductId ?? undefined },
    { enabled: Boolean(selectedProductId) }
  );

  const rawRows = (rowsQuery.data ?? []) as ReportRow[];
  const lot = lots.find((l: any) => l.productId === selectedProductId);
  const goalPieces = lot?.goalPieces ?? null;

  // Reconcilia com orders e recentActions em tempo real instantaneamente
  const rows = useMemo(() => {
    const orderMap = new Map(orders.map((o: any) => [o.id, o]));
    const chargedOrderIds = new Set(
      recentActions
        .filter((a: any) => a.kind === "charge" && a.orderId && (a.status === "manual_confirmed" || a.status === "share_started"))
        .map((a: any) => Number(a.orderId))
    );

    return rawRows.map(r => {
      const o = orderMap.get(r.orderId);
      const isPaid = (o && (o.status === "paid" || o.paidCents >= o.totalCents)) || r.status === "paid" || Boolean(r.isPaid);
      const isCharged = chargedOrderIds.has(r.orderId) || Boolean(o?.isCharged) || Boolean(r.isCharged);
      return {
        ...r,
        status: isPaid ? "paid" : (o?.status ?? r.status ?? "pending"),
        isPaid,
        isCharged,
        paidCents: o?.paidCents ?? r.paidCents,
      };
    });
  }, [rawRows, orders, recentActions]);

  // Reseta texto editado e chave ao trocar de produto
  useEffect(() => {
    setEditedText(null);
    setStatus(null);
    setActionKey(newKey("vupdate"));
  }, [selectedProductId]);

  // Mensagem gerada automaticamente
  const generatedMessage = useMemo(() => {
    if (!selectedProduct) return "";
    return buildGroupUpdateText({
      productName: selectedProduct.name,
      productPriceCents: selectedProduct.priceCents,
      productDescription: selectedProduct.description,
      rows,
      goalPieces,
      options,
    });
  }, [selectedProduct, rows, goalPieces, options]);

  const messageText = editedText ?? generatedMessage;
  const isEdited = editedText !== null && editedText !== generatedMessage;

  // Clientes únicos que compraram este produto
  const buyers = useMemo(() => {
    const map = new Map<number, { clientId: number; name: string; phone: string; quantity: number }>();
    for (const r of rows) {
      const prev = map.get(r.clientId);
      if (prev) {
        prev.quantity += r.quantity;
      } else {
        map.set(r.clientId, { clientId: r.clientId, name: r.clientName, phone: r.phone, quantity: r.quantity });
      }
    }
    return Array.from(map.values());
  }, [rows]);

  const totalPieces = buyers.reduce((sum, b) => sum + b.quantity, 0);


  const handleRecord = async (nextStatus: ActionStatus) => {
    try {
      const res = await recordAction.mutateAsync({
        idempotencyKey: actionKey,
        kind: "group_update",
        status: nextStatus,
        destinationType: "none",
        destinationId: null,
        productId: selectedProductId,
        title: selectedProduct ? `Atualização — ${selectedProduct.name}` : "Atualização",
        message: messageText.slice(0, 2000),
      });
      setStatus(res.action.status as ActionStatus);
      onActionRecorded();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível registrar a atualização");
      return false;
    }
  };

  const handleCopy = () => {
    if (!messageText.trim()) return;
    copyTextSync(messageText);
    toast.success("Mensagem copiada para a área de transferência!");
    void handleRecord("ready");
  };

  const handleShare = async () => {
    if (busy || !messageText.trim()) return;
    setBusy(true);
    try {
      const started = await shareReportOnWhatsApp(messageText, selectedProduct);
      if (started) {
        await handleRecord("share_started");
        toast.success("WhatsApp aberto!");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (busy || !messageText.trim()) return;
    setBusy(true);
    try {
      const ok = await handleRecord("manual_confirmed");
      if (ok) {
        toast.success("Envio de atualização confirmado!");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vmc-flow-stack">
      {/* ETAPA 1 — Seleção visual do produto */}
      <section className="vmc-step-section">
        <div className="vmc-step-title">
          <span className="vmc-step-num">1</span>
          <div className="vmc-step-title-row">
            <div>
              <strong>Escolha o produto</strong>
              <small>Identifique a peça pela imagem ({products.length} disponíveis)</small>
            </div>
          </div>
        </div>

        <div className="vmc-products-scroll" onWheel={handleHorizontalWheel}>
          {products.map((p: any) => {
            const isSelected = p.id === selectedProductId;
            const soldPieces = piecesByProduct.get(p.id) ?? 0;
            return (
              <button
                key={p.id}
                type="button"
                className={`vmc-product-card ${isSelected ? "is-selected" : ""}`}
                onClick={() => onSelectProduct(p.id)}
                aria-pressed={isSelected}
              >
                <div className="vmc-product-thumb">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} />
                  ) : (
                    <div className="vmc-placeholder">
                      <Package size={18} />
                    </div>
                  )}
                  {soldPieces > 0 && (
                    <span className="vmc-pending-badge vmc-sold-badge" title={`${soldPieces} peça(s) vendida(s)`}>
                      {soldPieces} un
                    </span>
                  )}
                  {isSelected && (
                    <span className="vmc-selected-badge">
                      <Check size={11} />
                    </span>
                  )}
                </div>
                <span className="vmc-product-name" title={p.name}>{p.name}</span>
                <span className="vmc-product-price">{formatMoney(p.priceCents)}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ETAPA 2 — Clientes relacionados ao produto */}
      <section className="vmc-step-section">
        <div className="vmc-step-title">
          <span className="vmc-step-num">2</span>
          <div>
            <strong>Clientes do produto{selectedProduct ? ` — ${selectedProduct.name}` : ""}</strong>
            <small>
              {rowsQuery.isLoading
                ? "Carregando clientes..."
                : buyers.length === 0
                ? "Nenhum pedido registrado ainda"
                : `${buyers.length} cliente(s) · ${totalPieces} peça(s) no total`}
            </small>
          </div>
        </div>

        {buyers.length > 0 ? (
          <div className="vmc-buyers-chips">
            {buyers.map(b => (
              <div key={b.clientId} className="vmc-buyer-pill">
                <span className="vmc-buyer-avatar">{b.name.charAt(0).toUpperCase()}</span>
                <span className="vmc-buyer-name" title={b.name}>{b.name}</span>
                <strong className="vmc-buyer-qty">{b.quantity} un</strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="vmc-empty-mini">
            <span>Ainda não há vendas registradas para este produto na vitrine.</span>
          </div>
        )}
      </section>

      {/* ETAPA 3 — Informações e configurações adicionais (MINIMIZADAS) */}
      <section className="vmc-step-section">
        <button
          type="button"
          className="vmc-accordion-toggle"
          onClick={() => setShowConfig(prev => !prev)}
          aria-expanded={showConfig}
        >
          <div className="vmc-acc-left">
            <SlidersHorizontal size={14} />
            <span>Configurações e dados da mensagem</span>
          </div>
          <span className="vmc-acc-state">
            {showConfig ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </button>

        {showConfig && (
          <div className="vmc-accordion-body">
            <div className="vmc-options-grid">
              <label className="vmc-chk-label">
                <input
                  type="checkbox"
                  checked={options.showDescription !== false}
                  onChange={e => setOptions({ ...options, showDescription: e.target.checked })}
                />
                <span>Exibir descrição do produto</span>
              </label>

              <label className="vmc-chk-label">
                <input
                  type="checkbox"
                  checked={options.showNames}
                  onChange={e => setOptions({ ...options, showNames: e.target.checked })}
                />
                <span>Exibir nome das clientes</span>
              </label>

              <label className="vmc-chk-label">
                <input
                  type="checkbox"
                  checked={options.showPrices}
                  onChange={e => setOptions({ ...options, showPrices: e.target.checked })}
                />
                <span>Exibir preço da peça</span>
              </label>

              <label className="vmc-chk-label">
                <input
                  type="checkbox"
                  checked={options.showPhones}
                  onChange={e => setOptions({ ...options, showPhones: e.target.checked })}
                />
                <span>Exibir telefone (evite em grupo público)</span>
              </label>

              <label className="vmc-chk-label">
                <input
                  type="checkbox"
                  checked={options.showTotals}
                  onChange={e => setOptions({ ...options, showTotals: e.target.checked })}
                />
                <span>Exibir totais de peças e clientes</span>
              </label>

              <label className="vmc-chk-label">
                <input
                  type="checkbox"
                  checked={Boolean(options.showPaymentStatus)}
                  onChange={e => setOptions({ ...options, showPaymentStatus: e.target.checked })}
                />
                <span>Exibir status de pagamento (✅ Pago)</span>
              </label>

              <label className="vmc-chk-label">
                <input
                  type="checkbox"
                  checked={Boolean(options.includePix)}
                  onChange={e => setOptions({ ...options, includePix: e.target.checked })}
                />
                <span>Incluir Chave Pix no final</span>
              </label>
            </div>


          </div>
        )}
      </section>

      {/* ETAPA 4 — Mensagem objetiva e ações */}
      <section className="vmc-step-section">
        <div className="vmc-step-title">
          <span className="vmc-step-num">4</span>
          <div className="vmc-step-title-row">
            <div>
              <strong>Mensagem de atualização</strong>
              <small>Prévia editável pronta para envio</small>
            </div>
            {status && (
              <span className={`vmc-status-chip vmc-status-${status}`}>
                {ACTION_STATUS_LABELS[status]}
              </span>
            )}
          </div>
        </div>

        <div className="vmc-message-card">
          <textarea
            className="vmc-message-textarea"
            rows={5}
            value={messageText}
            onChange={e => setEditedText(e.target.value)}
            placeholder="A mensagem gerada aparecerá aqui..."
          />

          {isEdited && (
            <div className="vmc-edited-hint">
              <span>Texto personalizado manualmente</span>
              <button type="button" onClick={() => setEditedText(null)}>
                Restaurar original
              </button>
            </div>
          )}

          <div className="vmc-action-bar">
            <Button size="sm" variant="outline" onClick={handleCopy} disabled={!messageText.trim() || busy}>
              <Copy size={14} />
              <span>Copiar texto</span>
            </Button>

            <Button size="sm" onClick={handleShare} disabled={!messageText.trim() || busy}>
              <MessageCircle size={14} />
              <span>WhatsApp</span>
            </Button>

            <Button
              size="sm"
              variant={status === "manual_confirmed" ? "secondary" : "outline"}
              onClick={handleConfirm}
              disabled={!messageText.trim() || busy}
            >
              <Check size={14} />
              <span>{status === "manual_confirmed" ? "Envio confirmado" : "Confirmei o envio"}</span>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

// ===========================================================================
// FLUXO 2: COBRANÇA DE CLIENTES (SIMPLIFICADA)
// ===========================================================================

function VitrineChargesFlow({
  products,
  orders,
  templates,
  selectedProductId,
  onSelectProduct,
  onActionRecorded,
  recordAction,
}: {
  products: any[];
  orders: any[];
  templates: any[];
  selectedProductId: number | null;
  onSelectProduct: (id: number) => void;
  onActionRecorded: () => void;
  recordAction: any;
}) {
  const [filterAll, setFilterAll] = useState(false);
  // Cards expandidos por padrão para exibir os 5 botões e a mensagem imediatamente
  const [collapsedOrderIds, setCollapsedOrderIds] = useState<Record<number, boolean>>({});

  // Pedidos válidos com saldo pendente
  const pendingOrders = useMemo(() => collectibleOrders(orders), [orders]);

  // Contagem de cobranças pendentes por produto
  const pendingCountByProduct = useMemo(() => {
    const map = new Map<number, number>();
    for (const o of pendingOrders) {
      for (const item of o.items ?? []) {
        map.set(item.productId, (map.get(item.productId) ?? 0) + 1);
      }
    }
    return map;
  }, [pendingOrders]);

  // Filtra os pedidos relevantes de acordo com a seleção
  const relevantOrders = useMemo(() => {
    if (filterAll || !selectedProductId) {
      return pendingOrders;
    }
    return pendingOrders.filter(o =>
      o.items?.some((item: any) => item.productId === selectedProductId)
    );
  }, [pendingOrders, filterAll, selectedProductId]);

  const toggleOrderExpand = (orderId: number) => {
    setCollapsedOrderIds(prev => ({
      ...prev,
      [orderId]: !prev[orderId],
    }));
  };

  const allRelevantExpanded =
    relevantOrders.length > 0 && relevantOrders.every(o => !collapsedOrderIds[o.id]);

  const toggleAllRelevant = () => {
    if (allRelevantExpanded) {
      const next: Record<number, boolean> = {};
      for (const o of relevantOrders) next[o.id] = true;
      setCollapsedOrderIds(next);
    } else {
      setCollapsedOrderIds({});
    }
  };

  return (
    <div className="vmc-flow-stack">
      {/* ETAPA 1 — Escolher o produto (Filtro visual por imagem) */}
      <section className="vmc-step-section">
        <div className="vmc-step-title">
          <span className="vmc-step-num">1</span>
          <div className="vmc-step-title-row">
            <div>
              <strong>Filtrar por produto</strong>
              <small>Mostrando peças com cobranças pendentes</small>
            </div>
            <button
              type="button"
              className={`vmc-pill-filter ${filterAll ? "is-active" : ""}`}
              onClick={() => setFilterAll(prev => !prev)}
            >
              Ver todas as peças ({pendingOrders.length})
            </button>
          </div>
        </div>

        <div className="vmc-products-scroll" onWheel={handleHorizontalWheel}>
          {products.map((p: any) => {
            const count = pendingCountByProduct.get(p.id) ?? 0;
            const isSelected = !filterAll && p.id === selectedProductId;
            return (
              <button
                key={p.id}
                type="button"
                className={`vmc-product-card ${isSelected ? "is-selected" : ""} ${count === 0 ? "is-dimmed" : ""}`}
                onClick={() => {
                  setFilterAll(false);
                  onSelectProduct(p.id);
                }}
                aria-pressed={isSelected}
              >
                <div className="vmc-product-thumb">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} />
                  ) : (
                    <div className="vmc-placeholder">
                      <Package size={18} />
                    </div>
                  )}
                  {count > 0 && <span className="vmc-pending-badge">{count}</span>}
                  {isSelected && (
                    <span className="vmc-selected-badge">
                      <Check size={11} />
                    </span>
                  )}
                </div>
                <span className="vmc-product-name" title={p.name}>{p.name}</span>
                <span className="vmc-product-price">
                  {count > 0 ? `${count} cobrança(s)` : "Sem saldo"}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ETAPA 2 e 3 — Clientes e Mensagens Individuais MINIMIZADAS */}
      <section className="vmc-step-section">
        <div className="vmc-step-title">
          <span className="vmc-step-num">2</span>
          <div className="vmc-step-title-row">
            <div>
              <strong>Clientes para cobrança</strong>
              <small>
                {relevantOrders.length === 0
                  ? "Nenhuma cliente com saldo pendente para esta seleção."
                  : `${relevantOrders.length} cliente(s) encontrada(s) · clique para expandir a mensagem`}
              </small>
            </div>
            {relevantOrders.length > 1 && (
              <button
                type="button"
                className="vmc-pill-filter"
                onClick={toggleAllRelevant}
              >
                {allRelevantExpanded ? "Recolher todos" : "Expandir todos"}
              </button>
            )}
          </div>
        </div>

        {relevantOrders.length > 0 ? (
          <div className="vmc-charge-cards-list">
            {relevantOrders.map(order => {
              const isExpanded = !collapsedOrderIds[order.id];
              return (
                <VitrineChargeCardItem
                  key={order.id}
                  order={order}
                  products={products}
                  templates={templates}
                  isExpanded={isExpanded}
                  onToggleExpand={() => toggleOrderExpand(order.id)}
                  onActionRecorded={onActionRecorded}
                  recordAction={recordAction}
                />
              );
            })}
          </div>
        ) : (
          <div className="vmc-empty-mini">
            <Check size={20} className="vmc-text-sage" />
            <span>Nenhuma cobrança pendente para este produto!</span>
          </div>
        )}
      </section>
    </div>
  );
}

// ===========================================================================
// CARD MINIMIZADO E EXPANSÍVEL DE COBRANÇA INDIVIDUAL
// ===========================================================================

function VitrineChargeCardItem({
  order,
  products,
  templates,
  isExpanded,
  onToggleExpand,
  onActionRecorded,
  recordAction,
}: {
  order: any;
  products: any[];
  templates: any[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onActionRecorded: () => void;
  recordAction: any;
}) {
  const balance = openBalanceCents(order);
  const pixTemplate = templates.find((t: any) => t.name?.includes("Pix") || t.body?.includes("Pix")) ?? templates[0];
  const defaultTemplate = pixTemplate ?? templates[0];
  const [templateId, setTemplateId] = useState<number>(pixTemplate?.id ?? defaultTemplate?.id ?? 0);
  const [customText, setCustomText] = useState<string | null>(null);
  const [actionKey] = useState(() => newKey(`vcharge-${order.id}`));
  const [orderStatus, setOrderStatus] = useState<string>(order.status);
  const [actionStatus, setActionStatus] = useState<ActionStatus | null>(() => (order.isCharged ? "manual_confirmed" : null));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (order.isCharged && !actionStatus) {
      setActionStatus("manual_confirmed");
    }
    if (order.status && order.status !== orderStatus) {
      setOrderStatus(order.status);
    }
  }, [order.isCharged, order.status, orderStatus, actionStatus]);

  const createPayment = trpc.payments.create.useMutation();
  const cancelOrder = trpc.orders.cancel.useMutation();
  const utils = trpc.useUtils();

  // Produto principal deste pedido (para foto e contexto)
  const product = useMemo(() => {
    const firstProductId = order.items?.[0]?.productId;
    return products.find((p: any) => p.id === firstProductId) ?? null;
  }, [products, order.items]);

  // Sincroniza o template padrão caso a query de modelos carregue após a montagem
  useEffect(() => {
    const target = templates.find((t: any) => t.name?.includes("Pix") || t.body?.includes("Pix")) ?? templates[0];
    if (target && (!templateId || !templates.some((t: any) => t.id === templateId))) {
      setTemplateId(target.id);
    }
  }, [templates, templateId]);

  const activeTemplate = templates.find((t: any) => t.id === templateId) ?? defaultTemplate;

  const generatedMessage = useMemo(() => {
    const body =
      activeTemplate?.body ??
      `{saudacao}, {nome_cliente}!\nPassando pra informar que fechamos a lista desse {produto_nome} e já vamos enviar o pedido grande ao fornecedor.\n\n*Chave Pix* 👇🏻\n{chave_pix}\n\n*Resumo do seu pedido:*\n*{produto_nome}*\n{quantidade} × {preco_unitario}\n*Valor total:* {valor_total}\n\n⚠️ *Importante:* Para garantir suas peças no lote, realize o pagamento e *envie o comprovante aqui assim que fizer o Pix*. Obrigada!`;
    return fillChargeTemplate(body, order, undefined, { product });
  }, [activeTemplate, order, product]);

  const messageText = customText ?? generatedMessage;
  const isEdited = customText !== null && customText !== generatedMessage;

  const productSummary = useMemo(() => {
    const items = order.items ?? [];
    if (!items.length) return "Sem itens detalhados";
    return items.map((item: any) => `${item.productName} (${item.quantity} un)`).join(" · ");
  }, [order.items]);

  // Status efetivo para exibição com emojis definidos
  const currentEffectiveStatus = useMemo(() => {
    if (orderStatus === "paid" || order.status === "paid" || Boolean(order.isPaid) || (order.paidCents >= order.totalCents && order.totalCents > 0)) {
      return "paid";
    }
    if (orderStatus === "cancelled" || order.status === "cancelled") {
      return "cancelled";
    }
    if (actionStatus === "manual_confirmed" || actionStatus === "share_started" || Boolean(order.isCharged)) {
      return "charged";
    }
    return "pending";
  }, [orderStatus, actionStatus, order.status, order.isPaid, order.paidCents, order.totalCents, order.isCharged]);

  const handleRecord = async (nextStatus: ActionStatus) => {
    try {
      const res = await recordAction.mutateAsync({
        idempotencyKey: actionKey,
        kind: "charge",
        status: nextStatus,
        destinationType: "client",
        orderId: order.id,
        clientId: Number(order.client?.id ?? order.clientId) || null,
        title: `Cobrança ${order.code} — ${order.client?.name ?? "Cliente"}`.slice(0, 200),
        message: messageText.slice(0, 2000),
        expectedBalanceCents: balance,
      });
      setActionStatus(res.action.status as ActionStatus);
      onActionRecorded();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao registrar cobrança");
      return false;
    }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!messageText.trim()) return;
    copyTextSync(messageText);
    toast.success(`Mensagem de ${order.client?.name} copiada!`);
    void handleRecord("ready");
  };

  // Envio livre com foto + texto sem limites ou avisos impeditivos
  const handleOpenWhatsApp = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!messageText.trim()) return;
    const phone = order.client?.phone ?? "";
    await shareReportOnWhatsApp(messageText, product, { phone });
    void handleRecord("share_started");
    setActionStatus("share_started");
    toast.success("WhatsApp aberto!");
  };

  // Atualizar status: Cobrado
  const handleMarkCharged = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const ok = await handleRecord("manual_confirmed");
      if (ok) {
        setActionStatus("manual_confirmed");
        order.isCharged = true;
        onActionRecorded();
        toast.success(`Cobrança de ${order.client?.name} marcada como enviada!`);
      }
    } finally {
      setBusy(false);
    }
  };

  // Atualizar status: Pago (dá baixa e quita o pedido)
  const handleMarkPaid = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    if (!window.confirm(`Deseja marcar o pedido ${order.code} de ${order.client?.name} como PAGO (${formatMoney(balance)})?`)) {
      return;
    }
    setBusy(true);
    try {
      await createPayment.mutateAsync({
        orderId: order.id,
        amountCents: balance,
        method: "PIX",
        notes: "Baixa manual registrada na Vitrine",
      });
      setOrderStatus("paid");
      await handleRecord("manual_confirmed");
      utils.orders.list.invalidate();
      utils.dashboard.summary.invalidate();
      onActionRecorded();
      toast.success(`Pedido de ${order.client?.name} quitado com sucesso!`);
    } catch (err: any) {
      toast.error(err instanceof Error ? err.message : "Erro ao registrar pagamento");
    } finally {
      setBusy(false);
    }
  };

  // Atualizar status: Cancelar
  const handleCancelOrder = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    if (!window.confirm(`Deseja realmente CANCELAR o pedido ${order.code} de ${order.client?.name}?`)) {
      return;
    }
    setBusy(true);
    try {
      await cancelOrder.mutateAsync({ id: order.id });
      setOrderStatus("cancelled");
      utils.orders.list.invalidate();
      utils.dashboard.summary.invalidate();
      onActionRecorded();
      toast.success(`Pedido de ${order.client?.name} cancelado.`);
    } catch (err: any) {
      toast.error(err instanceof Error ? err.message : "Erro ao cancelar pedido");
    } finally {
      setBusy(false);
    }
  };

  const handleHeaderKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggleExpand();
    }
  };

  return (
    <article className={`vmc-charge-card ${isExpanded ? "is-expanded" : ""}`}>
      {/* Cabeçalho do Card: compacto, clicável para expandir */}
      <div
        className="vmc-charge-card-header"
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={onToggleExpand}
        onKeyDown={handleHeaderKeyDown}
      >
        <div className="vmc-charge-header-left">
          <div className="vmc-charge-avatar">
            {(order.client?.name ?? "C").charAt(0).toUpperCase()}
          </div>
          <div className="vmc-charge-meta">
            <strong className="vmc-charge-client-name">{order.client?.name}</strong>
            <span className="vmc-charge-client-products" title={productSummary}>
              {productSummary}
            </span>
            <small className="vmc-charge-client-phone">
              {order.client?.phone || "Sem telefone"} · Pedido {order.code}
            </small>
          </div>
        </div>

        <div className="vmc-charge-header-right">
          <div className="vmc-charge-price-tag">
            <span className="vmc-charge-balance-label">Saldo em aberto</span>
            <strong className="vmc-charge-balance-val">{formatMoney(balance)}</strong>
          </div>

          <span className={`vmc-status-chip vmc-status-${currentEffectiveStatus}`}>
            {currentEffectiveStatus === "paid" && "✅ Pago"}
            {currentEffectiveStatus === "cancelled" && "❌ Cancelado"}
            {currentEffectiveStatus === "charged" && "📲 Cobrado"}
            {currentEffectiveStatus === "pending" && "⏳ Pendente"}
          </span>

          <button
            type="button"
            className="vmc-expand-icon-btn"
            onClick={e => {
              e.stopPropagation();
              onToggleExpand();
            }}
            aria-label={isExpanded ? "Recolher mensagem" : "Expandir mensagem"}
          >
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* Conteúdo Expansível: aparece somente quando solicitado */}
      {isExpanded && (
        <div className="vmc-charge-card-body">
          {templates.length > 1 && (
            <div className="vmc-template-select-row">
              <label>Modelo:</label>
              <select
                value={templateId}
                onChange={e => {
                  setTemplateId(Number(e.target.value));
                  setCustomText(null);
                }}
              >
                {templates.map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <textarea
            className="vmc-message-textarea"
            rows={5}
            value={messageText}
            onChange={e => setCustomText(e.target.value)}
            placeholder="Mensagem de cobrança..."
          />

          {isEdited && (
            <div className="vmc-edited-hint">
              <span>Texto personalizado manualmente</span>
              <button type="button" onClick={() => setCustomText(null)}>
                Restaurar original
              </button>
            </div>
          )}

          <div className="vmc-charge-card-actions">
            <button
              type="button"
              className="vmc-action-btn vmc-btn-copy"
              onClick={handleCopy}
              disabled={!messageText.trim() || busy}
            >
              <Copy size={13} />
              <span>Copiar</span>
            </button>

            <button
              type="button"
              className="vmc-action-btn vmc-btn-whatsapp"
              onClick={handleOpenWhatsApp}
              disabled={!messageText.trim() || busy}
              title="Abrir WhatsApp com foto do produto e mensagem"
            >
              <MessageCircle size={13} />
              <span>WhatsApp</span>
            </button>

            <button
              type="button"
              className={`vmc-action-btn vmc-btn-charged ${currentEffectiveStatus === "charged" ? "is-active" : ""}`}
              onClick={handleMarkCharged}
              disabled={busy || currentEffectiveStatus === "paid" || currentEffectiveStatus === "cancelled"}
              title="Marcar como cobrado"
            >
              <Send size={12} />
              <span>Cobrado</span>
            </button>

            <button
              type="button"
              className={`vmc-action-btn vmc-btn-paid ${currentEffectiveStatus === "paid" ? "is-active" : ""}`}
              onClick={handleMarkPaid}
              disabled={busy || currentEffectiveStatus === "paid" || currentEffectiveStatus === "cancelled"}
              title="Quitar pedido e dar baixa no saldo"
            >
              <Check size={12} />
              <span>Pago</span>
            </button>

            <button
              type="button"
              className={`vmc-action-btn vmc-btn-cancel ${currentEffectiveStatus === "cancelled" ? "is-active" : ""}`}
              onClick={handleCancelOrder}
              disabled={busy || currentEffectiveStatus === "cancelled" || currentEffectiveStatus === "paid"}
              title="Cancelar pedido"
            >
              <X size={12} />
              <span>Cancelar</span>
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
