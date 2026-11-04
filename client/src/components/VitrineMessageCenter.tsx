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
              selectedProductId={selectedProductId}
              onSelectProduct={setSelectedProductId}
              destinations={destinations}
              lots={overview?.lots ?? []}
              onActionRecorded={() => {
                void utils.messages.overview.invalidate();
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
  selectedProductId,
  onSelectProduct,
  destinations,
  lots,
  onActionRecorded,
  recordAction,
}: {
  products: any[];
  orders: any[];
  selectedProductId: number | null;
  onSelectProduct: (id: number) => void;
  destinations: any[];
  lots: any[];
  onActionRecorded: () => void;
  recordAction: any;
}) {
  const [showConfig, setShowConfig] = useState(false);
  const [options, setOptions] = useState<GroupUpdateOptions>(defaultGroupUpdateOptions);
  const [destinationId, setDestinationId] = useState<string>("");
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

  const rows = (rowsQuery.data ?? []) as ReportRow[];
  const lot = lots.find((l: any) => l.productId === selectedProductId);
  const goalPieces = lot?.goalPieces ?? null;

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

  const targetDestination = destinations.find((d: any) => String(d.id) === destinationId);

  const handleRecord = async (nextStatus: ActionStatus) => {
    try {
      const res = await recordAction.mutateAsync({
        idempotencyKey: actionKey,
        kind: "group_update",
        status: nextStatus,
        destinationType: targetDestination ? "group" : "none",
        destinationId: targetDestination?.id ?? null,
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
      const started = await shareReportOnWhatsApp(messageText, selectedProduct, {
        targetUrl: targetDestination?.inviteUrl ?? undefined,
      });
      if (started) {
        await handleRecord("share_started");
        toast.info("WhatsApp aberto. Confirme o envio após compartilhar no grupo.");
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
            </div>

            {destinations.length > 0 && (
              <div className="vmc-field-inline">
                <label>Destino de grupo configurado:</label>
                <select value={destinationId} onChange={e => setDestinationId(e.target.value)}>
                  <option value="">Nenhum (escolho no WhatsApp)</option>
                  {destinations.map((d: any) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
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
              <span>{selectedProduct?.imageUrl ? "WhatsApp (Foto + Legenda)" : "Abrir WhatsApp"}</span>
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
  // Estado individual de expansão por pedido/cliente (permite expandir qualquer quantidade de clientes sem fechar outros)
  const [expandedOrderIds, setExpandedOrderIds] = useState<Record<number, boolean>>({});

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
    setExpandedOrderIds(prev => ({
      ...prev,
      [orderId]: !prev[orderId],
    }));
  };

  const allRelevantExpanded =
    relevantOrders.length > 0 && relevantOrders.every(o => Boolean(expandedOrderIds[o.id]));

  const toggleAllRelevant = () => {
    if (allRelevantExpanded) {
      setExpandedOrderIds(prev => {
        const next = { ...prev };
        for (const o of relevantOrders) {
          delete next[o.id];
        }
        return next;
      });
    } else {
      setExpandedOrderIds(prev => {
        const next = { ...prev };
        for (const o of relevantOrders) {
          next[o.id] = true;
        }
        return next;
      });
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
              const isExpanded = Boolean(expandedOrderIds[order.id]);
              return (
                <VitrineChargeCardItem
                  key={order.id}
                  order={order}
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
  templates,
  isExpanded,
  onToggleExpand,
  onActionRecorded,
  recordAction,
}: {
  order: any;
  templates: any[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onActionRecorded: () => void;
  recordAction: any;
}) {
  const balance = openBalanceCents(order);
  const defaultTemplate = templates[0];
  const [templateId, setTemplateId] = useState<number>(defaultTemplate?.id ?? 0);
  const [customText, setCustomText] = useState<string | null>(null);
  const [actionKey] = useState(() => newKey(`vcharge-${order.id}`));
  const [status, setStatus] = useState<ActionStatus | null>(null);
  const [busy, setBusy] = useState(false);

  // Sincroniza o template padrão caso a query de modelos carregue após a montagem
  useEffect(() => {
    if ((!templateId || !templates.some((t: any) => t.id === templateId)) && templates.length > 0) {
      setTemplateId(templates[0].id);
    }
  }, [templates, templateId]);

  const activeTemplate = templates.find((t: any) => t.id === templateId) ?? defaultTemplate;

  const generatedMessage = useMemo(() => {
    const body =
      activeTemplate?.body ??
      "Olá, {cliente}! Seu pedido {codigo} ({itens}) está com saldo em aberto de {saldo}. Total: {total}.";
    return fillChargeTemplate(body, order);
  }, [activeTemplate, order]);

  const messageText = customText ?? generatedMessage;
  const isEdited = customText !== null && customText !== generatedMessage;

  const productSummary = useMemo(() => {
    const items = order.items ?? [];
    if (!items.length) return "Sem itens detalhados";
    return items.map((item: any) => `${item.productName} (${item.quantity} un)`).join(" · ");
  }, [order.items]);

  const handleRecord = async (nextStatus: ActionStatus) => {
    try {
      const res = await recordAction.mutateAsync({
        idempotencyKey: actionKey,
        kind: "charge",
        status: nextStatus,
        orderId: order.id,
        clientId: order.client?.id ?? null,
        title: `Cobrança — ${order.client?.name}`,
        message: messageText.slice(0, 2000),
        snapshotBalanceCents: balance,
      });
      setStatus(res.action.status as ActionStatus);
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

  const handleOpenWhatsApp = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!messageText.trim()) return;
    const phone = order.client?.phone ?? "";
    const url = waChatUrl(phone, messageText);
    window.open(url, "_blank", "noopener,noreferrer");
    void handleRecord("share_started");
    toast.info("WhatsApp aberto; confirme o envio após enviar no aplicativo.");
  };

  const handleConfirm = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy || !messageText.trim()) return;
    setBusy(true);
    try {
      const ok = await handleRecord("manual_confirmed");
      if (ok) {
        toast.success(`Envio para ${order.client?.name} registrado!`);
      }
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
              {order.client?.phone} · Pedido {order.code}
            </small>
          </div>
        </div>

        <div className="vmc-charge-header-right">
          <div className="vmc-charge-price-tag">
            <span className="vmc-charge-balance-label">Saldo em aberto</span>
            <strong className="vmc-charge-balance-val">{formatMoney(balance)}</strong>
          </div>

          {status && (
            <span className={`vmc-status-chip vmc-status-${status}`}>
              {ACTION_STATUS_LABELS[status]}
            </span>
          )}

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
            <Button size="sm" variant="outline" onClick={handleCopy} disabled={!messageText.trim() || busy}>
              <Copy size={13} />
              <span>Copiar</span>
            </Button>

            <Button size="sm" onClick={handleOpenWhatsApp} disabled={!messageText.trim() || busy}>
              <MessageCircle size={13} />
              <span>Abrir WhatsApp</span>
            </Button>

            <Button
              size="sm"
              variant={status === "manual_confirmed" ? "secondary" : "outline"}
              onClick={handleConfirm}
              disabled={!messageText.trim() || busy}
            >
              <Check size={13} />
              <span>{status === "manual_confirmed" ? "Confirmado" : "Confirmei o envio"}</span>
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

