import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { uploadProductPhoto } from "@/lib/firebase";
import { toast } from "sonner";
import {
  Archive,
  ArrowLeft,
  BarChart3,
  BellRing,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Copy,
  Download,
  FileText,
  LayoutDashboard,
  LogOut,
  Maximize2,
  Menu,
  MessageCircle,
  Minimize2,
  Minus,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShoppingBag,
  Trash2,
  Upload,
  UserPlus,
  UserRound,
  UsersRound,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

type Section = "dashboard" | "products" | "product" | "clients" | "orders" | "charges" | "finance" | "reports" | "settings";
type ProductForm = { id: number | null; name: string; price: string; category: string; description: string; imageUrl: string };
type ClientForm = { id: number | null; name: string; phone: string; notes: string };
type SaleItem = { productId: string; quantity: string; unitPriceCents?: number };
type VcfContact = { name: string; phone: string };

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

const navItems: Array<{ id: Section; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "products", label: "Produtos", icon: Package },
  { id: "clients", label: "Clientes", icon: UsersRound },
  { id: "orders", label: "Pedidos", icon: ClipboardList },
  { id: "charges", label: "Cobranças", icon: BellRing },
  { id: "finance", label: "Financeiro", icon: Wallet },
  { id: "reports", label: "Relatórios", icon: FileText },
  { id: "settings", label: "Configurações", icon: Settings },
];

const emptyProduct: ProductForm = { id: null, name: "", price: "", category: "", description: "", imageUrl: "" };
const emptyClient: ClientForm = { id: null, name: "", phone: "", notes: "" };
const emptySale = { clientId: "", items: [{ productId: "", quantity: "1" }] as SaleItem[] };

function moneyToCents(value: string) {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function centsToInput(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function formatMoney(cents = 0) {
  return currency.format(cents / 100);
}

function formatDate(date?: string | Date | null) {
  if (!date) return "—";
  return dateFormatter.format(new Date(date));
}

function formatDateTime(date?: string | Date | null) {
  if (!date) return "—";
  return dateTimeFormatter.format(new Date(date));
}

function statusLabel(status: string) {
  return ({ pending: "Pendente", partial: "Parcial", paid: "Pago", overdue: "Vencido", cancelled: "Cancelado" } as Record<string, string>)[status] ?? status;
}

function statusClass(status: string) {
  return ({ paid: "status-paid", partial: "status-partial", overdue: "status-overdue", cancelled: "status-cancelled", pending: "status-pending" } as Record<string, string>)[status] ?? "status-pending";
}

function parseVcf(raw: string): VcfContact[] {
  return raw.split(/BEGIN:VCARD/i).slice(1).map(block => {
    const name = block.match(/(?:^|\n)FN(?:;[^:]*)?:([^\n\r]+)/i)?.[1]?.trim().replace(/\\,/g, ",") ?? "";
    const phone = block.match(/(?:^|\n)TEL(?:;[^:]*)?:([^\n\r]+)/i)?.[1]?.trim() ?? "";
    return { name, phone };
  }).filter(contact => contact.name && contact.phone);
}

function templateMessage(body: string, order: any, valueOverride?: number) {
  const product = order.items?.map((item: any) => `${item.productName} (${item.quantity})`).join(", ") || "seu pedido";
  const pending = valueOverride ?? Math.max(0, order.totalCents - order.paidCents);
  return body.replaceAll("{nome_cliente}", order.client?.name ?? "cliente")
    .replaceAll("{produto}", product)
    .replaceAll("{numero_pedido}", order.code ?? "")
    .replaceAll("{valor_pendente}", formatMoney(pending))
    .replaceAll("{valor_pago}", formatMoney(order.paidCents ?? 0))
    .replaceAll("{data_vencimento}", formatDate(order.dueDate));
}

function buildReport(rows: any[]) {
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const key = `${row.productId}-${row.unitPriceCents}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const sections: string[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const lines = [`${first.productName} ${formatMoney(first.unitPriceCents)}`];
    for (const row of group) lines.push(`${row.clientName} – ${row.quantity}\n${row.phone}`);
    sections.push(lines.join("\n\n"));
  }
  const clients = new Set(rows.map(row => row.clientId)).size;
  const pieces = rows.reduce((sum, row) => sum + row.quantity, 0);
  const total = rows.reduce((sum, row) => sum + row.totalCents, 0);
  sections.push(`Total de clientes: ${clients}\nTotal de peças: ${pieces}\nValor total vendido: ${formatMoney(total)}`);
  return sections.join("\n\n");
}

function downloadText(name: string, content: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvFromRows(rows: any[]) {
  const header = "Produto;Preço;Cliente;Quantidade;Telefone;Total;Data";
  const lines = rows.map(row => [row.productName, formatMoney(row.unitPriceCents), row.clientName, row.quantity, row.phone, formatMoney(row.totalCents), formatDate(row.orderDate)].map(value => `"${String(value).replaceAll('"', '""')}"`).join(";"));
  return [header, ...lines].join("\n");
}

function StatCard({ label, value, helper, icon: Icon, accent = "teal" }: { label: string; value: string; helper?: string; icon: typeof Package; accent?: string }) {
  return <div className={`stat-card accent-${accent}`}>
    <div className="stat-card-top"><span>{label}</span><span className="stat-icon"><Icon size={17} /></span></div>
    <strong>{value}</strong>
    {helper && <small>{helper}</small>}
  </div>;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge ${statusClass(status)}`}><span />{statusLabel(status)}</span>;
}

function EmptyState({ icon: Icon, title, description, action }: { icon: typeof Package; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={23} /></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export default function Home() {
  const { user, loading, loggingIn, login, logout } = useAuth();
  const [loginUser, setLoginUser] = useState("admin");
  const [loginPassword, setLoginPassword] = useState("");
  const [isQuickSaleHome, setIsQuickSaleHome] = useState(true);
  const [vitrineSearch, setVitrineSearch] = useState("");
  const [quickClientSearch, setQuickClientSearch] = useState("");
  const [quickProductId, setQuickProductId] = useState<number | null>(null);
  const [quickClientQuantities, setQuickClientQuantities] = useState<Record<number, number>>({});
  const [savingQuickSale, setSavingQuickSale] = useState(false);
  const [section, setSection] = useState<Section>("dashboard");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatus, setOrderStatus] = useState("all");
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [productForm, setProductForm] = useState<ProductForm>(emptyProduct);
  const [productImageFile, setProductImageFile] = useState<File | null>(null);
  const [productImagePreview, setProductImagePreview] = useState<string>("");
  const [savingProduct, setSavingProduct] = useState(false);
  const [clientForm, setClientForm] = useState<ClientForm>(emptyClient);
  const [sale, setSale] = useState(emptySale);
  const [showProductForm, setShowProductForm] = useState(false);
  const [showClientForm, setShowClientForm] = useState(false);
  const [showVcf, setShowVcf] = useState(false);
  const [vcfPreview, setVcfPreview] = useState<VcfContact[]>([]);
  const [chargeDraft, setChargeDraft] = useState<{ order: any; templateId: number; message: string } | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Pix");
  const [reportProductId, setReportProductId] = useState<string>("");
  const [orderEditor, setOrderEditor] = useState<{ clientId: string; notes: string; items: SaleItem[] } | null>(null);
  const [editingOrder, setEditingOrder] = useState(false);

  const utils = trpc.useUtils();
  const enabled = Boolean(user);
  const dashboardQuery = trpc.dashboard.summary.useQuery(undefined, { enabled });
  const productsQuery = trpc.products.list.useQuery({ search: productSearch }, { enabled });
  const clientsQuery = trpc.clients.list.useQuery({ search: clientSearch }, { enabled });
  const ordersQuery = trpc.orders.list.useQuery({ search: orderSearch, status: orderStatus }, { enabled });
  const productDetailQuery = trpc.products.detail.useQuery({ id: selectedProductId ?? 0 }, { enabled: enabled && section === "product" && Boolean(selectedProductId) });
  const orderDetailQuery = trpc.orders.detail.useQuery({ id: selectedOrderId ?? 0 }, { enabled: enabled && Boolean(selectedOrderId) });
  const chargesQuery = trpc.charges.list.useQuery(undefined, { enabled: enabled && section === "charges" });
  const templatesQuery = trpc.charges.templates.useQuery(undefined, { enabled });
  const auditQuery = trpc.settings.audit.useQuery(undefined, { enabled: enabled && section === "settings" });
  const reportsQuery = trpc.reports.rows.useQuery({ productId: reportProductId ? Number(reportProductId) : undefined }, { enabled: enabled && section === "reports" });

  const createProduct = trpc.products.create.useMutation();
  const updateProduct = trpc.products.update.useMutation();
  const duplicateProduct = trpc.products.duplicate.useMutation();
  const createClient = trpc.clients.create.useMutation();
  const updateClient = trpc.clients.update.useMutation();
  const importVcf = trpc.clients.importVcf.useMutation();
  const createOrder = trpc.orders.create.useMutation();
  const updateOrder = trpc.orders.update.useMutation();
  const cancelOrder = trpc.orders.cancel.useMutation();
  const createPayment = trpc.payments.create.useMutation();
  const createCharge = trpc.charges.create.useMutation();
  const updateTemplate = trpc.charges.updateTemplate.useMutation();
  const syncCloud = trpc.settings.syncCloud.useMutation();

  useEffect(() => {
    const data: any = orderDetailQuery.data;
    if (!data) return;
    setOrderEditor({
      clientId: String(data.client.id),
      notes: data.notes ?? "",
      items: data.items.map((item: any) => ({ productId: String(item.productId), quantity: String(item.quantity), unitPriceCents: item.unitPriceCents })),
    });
    setPaymentAmount("");
    setEditingOrder(false);
  }, [orderDetailQuery.data?.id]);

  const products = (productsQuery.data ?? []) as any[];
  const clients = (clientsQuery.data ?? []) as any[];
  const orders = (ordersQuery.data ?? []) as any[];
  const templates = (templatesQuery.data ?? []) as any[];
  const dashboard: any = dashboardQuery.data;
  const selectedOrder: any = orderDetailQuery.data;
  const vcfInvalidCount = vcfPreview.filter(contact => contact.phone.replace(/\D/g, "").length < 8).length;
  const orderTotalCents = useMemo(() => sale.items.reduce((total, item) => {
    const product = products.find(product => product.id === Number(item.productId));
    return total + (product ? product.priceCents * Math.max(0, Number(item.quantity) || 0) : 0);
  }, 0), [products, sale.items]);
  const reportText = useMemo(() => buildReport((reportsQuery.data ?? []) as any[]), [reportsQuery.data]);

  const refresh = async () => {
    await Promise.all([
      utils.dashboard.summary.invalidate(),
      utils.products.list.invalidate(),
      utils.clients.list.invalidate(),
      utils.orders.list.invalidate(),
      utils.products.detail.invalidate(),
      utils.orders.detail.invalidate(),
      utils.charges.list.invalidate(),
      utils.reports.rows.invalidate(),
    ]);
  };

  const navigate = (next: Section) => {
    setSection(next);
    setMobileMenu(false);
  };

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      toast.success(success);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível concluir a ação");
    }
  };

  useEffect(() => {
    if (!productImageFile) {
      setProductImagePreview("");
      return;
    }
    const objectUrl = URL.createObjectURL(productImageFile);
    setProductImagePreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [productImageFile]);

  const submitProduct = () => {
    if (savingProduct) return;
    setSavingProduct(true);
    run(async () => {
      const imageUrl = productImageFile ? await uploadProductPhoto(productImageFile) : productForm.imageUrl;
      const payload = { name: productForm.name, priceCents: moneyToCents(productForm.price), category: productForm.category, description: productForm.description, imageUrl };
      if (productForm.id) await updateProduct.mutateAsync({ id: productForm.id, ...payload });
      else await createProduct.mutateAsync(payload);
      setProductForm(emptyProduct);
      setProductImageFile(null);
      setShowProductForm(false);
    }, productForm.id ? "Produto atualizado" : "Produto cadastrado").finally(() => {
      setSavingProduct(false);
    });
  };

  const submitClient = () => run(async () => {
    if (clientForm.id) await updateClient.mutateAsync({ id: clientForm.id, name: clientForm.name, phone: clientForm.phone, notes: clientForm.notes });
    else await createClient.mutateAsync(clientForm);
    setClientForm(emptyClient);
    setShowClientForm(false);
  }, clientForm.id ? "Cliente atualizado" : "Cliente cadastrado");

  const submitQuickBatchSale = () => {
    if (savingQuickSale) return;
    const entries = Object.entries(quickClientQuantities)
      .map(([clientId, qty]) => ({ clientId: Number(clientId), quantity: Math.max(1, Number(qty) || 1) }))
      .filter(entry => entry.clientId > 0 && entry.quantity >= 1);

    if (!quickProductId) {
      toast.error("Selecione um produto na vitrine");
      return;
    }
    if (!entries.length) {
      toast.error("Selecione pelo menos uma cliente");
      return;
    }

    setSavingQuickSale(true);
    run(
      async () => {
        for (const entry of entries) {
          await createOrder.mutateAsync({
            clientId: entry.clientId,
            items: [{ productId: quickProductId, quantity: entry.quantity }],
          });
        }
        setQuickClientQuantities({});
        setQuickClientSearch("");
      },
      entries.length === 1
        ? "Venda registrada com sucesso!"
        : `Vendas registradas para ${entries.length} clientes!`
    ).finally(() => {
      setSavingQuickSale(false);
    });
  };

  const submitSale = () => run(async () => {
    const validItems = sale.items.filter(item => item.productId && Number(item.quantity) >= 1);
    if (!sale.clientId) throw new Error("Selecione uma cliente para a venda");
    if (!validItems.length) throw new Error("Selecione pelo menos um produto na vitrine e informe a quantidade");
    await createOrder.mutateAsync({
      clientId: Number(sale.clientId),
      items: validItems.map(item => ({ productId: Number(item.productId), quantity: Number(item.quantity) })),
    });
    setSale(emptySale);
  }, "Venda registrada com sucesso");

  const openCharge = (order: any) => {
    const template = templates[0];
    if (!template) return toast.error("Os modelos de cobrança ainda estão carregando");
    setChargeDraft({ order, templateId: template.id, message: templateMessage(template.body, order) });
  };

  const submitCharge = async () => {
    if (!chargeDraft) return;
    const text = chargeDraft.message;
    const phone = String(chargeDraft.order.client?.phone ?? "").replace(/\D/g, "");
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    await run(() => createCharge.mutateAsync({ orderId: chargeDraft.order.id, templateId: chargeDraft.templateId, message: text, action: "whatsapp_opened" }), "WhatsApp aberto; o envio precisa ser confirmado por você");
    setChargeDraft(null);
  };

  const submitPayment = () => {
    if (!selectedOrder) return;
    run(async () => {
      const remainingCents = Math.max(0, selectedOrder.totalCents - selectedOrder.paidCents);
      const amountCents = paymentAmount.trim() ? moneyToCents(paymentAmount) : remainingCents;
      if (amountCents < 1) throw new Error("Informe um valor de recebimento maior que zero");
      await createPayment.mutateAsync({ orderId: selectedOrder.id, amountCents, method: paymentMethod });
      setPaymentAmount("");
    }, "Pagamento registrado");
  };

  const submitOrderEdit = () => {
    if (!selectedOrder || !orderEditor) return;
    run(async () => {
      await updateOrder.mutateAsync({ id: selectedOrder.id, clientId: Number(orderEditor.clientId), notes: orderEditor.notes, items: orderEditor.items.map(item => ({ productId: Number(item.productId), quantity: Number(item.quantity), unitPriceCents: item.unitPriceCents })) });
      setEditingOrder(false);
    }, "Pedido atualizado");
  };

  const handleVcfFile = async (file?: File) => {
    if (!file) return;
    const contacts = parseVcf(await file.text());
    setVcfPreview(contacts);
    setShowVcf(true);
  };

  const submitLogin = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!loginPassword.trim()) {
      toast.error("Digite a senha de administrador");
      return;
    }
    try {
      await login(loginPassword, loginUser);
      toast.success("Bem-vinda ao sistema!");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Usuário ou senha incorretos");
    }
  };

  if (loading) return <div className="splash"><div className="brand-mark">VA</div><span>Carregando sua operação...</span></div>;
  if (!user) return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submitLogin}>
        <div className="brand-lockup">
          <div className="brand-mark">VA</div>
          <div>
            <strong>Venda Atacado</strong>
            <span>controle de pedidos</span>
          </div>
        </div>
        <div className="eyebrow">ACESSO ADMINISTRATIVO</div>
        <h1>Seu caderno de pedidos, agora organizado.</h1>
        <p>Entre com seu acesso fixo de administrador para gerenciar clientes, vendas, pagamentos e relatórios.</p>
        <div className="login-fields">
          <label>
            Usuário
            <input
              type="text"
              value={loginUser}
              onChange={e => setLoginUser(e.target.value)}
              placeholder="admin"
              autoComplete="username"
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              value={loginPassword}
              onChange={e => setLoginPassword(e.target.value)}
              placeholder="Digite sua senha (padrão: 1234)"
              autoComplete="current-password"
              autoFocus
            />
          </label>
        </div>
        <Button type="submit" size="lg" disabled={loggingIn}>
          <UserRound size={18} /> {loggingIn ? "Entrando..." : "Entrar no sistema"}
        </Button>
      </form>
    </div>
  );

  const title = navItems.find(item => item.id === section)?.label ?? "Produto";
  const subtitle = section === "dashboard" ? "visão geral da operação" : section === "orders" ? "registre vendas sem perder o fio" : section === "product" ? "acompanhe pedidos por produto" : section === "reports" ? "prontos para enviar às chefes" : "organize o próximo passo";

  return <div className={isQuickSaleHome ? "quick-home-shell" : "app-shell"}>
    {isQuickSaleHome ? (
      <QuickSaleHomeView
        products={products}
        clients={clients}
        quickProductId={quickProductId}
        setQuickProductId={setQuickProductId}
        quickClientQuantities={quickClientQuantities}
        setQuickClientQuantities={setQuickClientQuantities}
        vitrineSearch={vitrineSearch}
        setVitrineSearch={setVitrineSearch}
        clientSearch={quickClientSearch}
        setClientSearch={setQuickClientSearch}
        onSave={submitQuickBatchSale}
        savingSale={savingQuickSale}
        onMinimize={() => setIsQuickSaleHome(false)}
        onAddProduct={() => { setProductForm(emptyProduct); setProductImageFile(null); setShowProductForm(true); }}
        onAddClient={() => { setClientForm(emptyClient); setShowClientForm(true); }}
        onFile={handleVcfFile}
      />
    ) : (
      <>
        <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>
          <div className="sidebar-brand"><div className="brand-mark">VA</div><div><strong>Venda Atacado</strong><span>controle pessoal</span></div><button className="sidebar-close" onClick={() => setMobileMenu(false)}><X size={18} /></button></div>
          <div className="sidebar-context"><span className="context-dot" /> operação ativa <span className="context-lock">admin</span></div>
          <button className="vitrine-launch-btn" onClick={() => setIsQuickSaleHome(true)}><Maximize2 size={16} /><span>Home de Registro (Vitrine)</span></button>
          <nav>{navItems.map(item => { const Icon = item.icon; return <button key={item.id} className={`nav-item ${section === item.id || (item.id === "products" && section === "product") ? "active" : ""}`} onClick={() => navigate(item.id)}><Icon size={18} /><span>{item.label}</span>{item.id === "orders" && dashboard?.stats?.pendingOrders ? <em>{dashboard.stats.pendingOrders}</em> : null}</button>; })}</nav>
          <div className="sidebar-bottom"><div className="admin-card"><div className="avatar">{(user.name ?? "A").charAt(0).toUpperCase()}</div><div><strong>{user.name ?? "Administradora"}</strong><span>acesso total</span></div><button onClick={() => logout()} title="Sair"><LogOut size={16} /></button></div><div className="sidebar-note">Dados protegidos e salvos no banco do projeto.</div></div>
        </aside>
        {mobileMenu && <button className="sidebar-scrim" onClick={() => setMobileMenu(false)} aria-label="Fechar menu" />}
        <main className="main-shell">
          <header className="topbar"><div className="topbar-left"><button className="mobile-menu-button" onClick={() => setMobileMenu(true)}><Menu size={20} /></button><div><div className="eyebrow">{subtitle}</div><h1>{title}</h1></div></div><div className="topbar-actions"><button className="icon-button" onClick={() => refresh()} title="Atualizar dados"><RefreshCw size={17} /></button><Button variant="outline" onClick={() => setIsQuickSaleHome(true)}><Maximize2 size={16} /> Modo Vitrine</Button><Button onClick={() => navigate("orders")}><Plus size={17} /> Nova venda</Button></div></header>

          {section === "dashboard" && <DashboardView dashboard={dashboard} loading={dashboardQuery.isLoading} navigate={navigate} onOrder={setSelectedOrderId} />}
          {section === "products" && <ProductsView products={products} search={productSearch} setSearch={setProductSearch} onAdd={() => { setProductForm(emptyProduct); setProductImageFile(null); setShowProductForm(true); }} onOpen={(id: number) => { setSelectedProductId(id); navigate("product"); }} onEdit={(product: any) => { setProductForm({ id: product.id, name: product.name, price: centsToInput(product.priceCents), category: product.category ?? "", description: product.description ?? "", imageUrl: product.imageUrl ?? "" }); setProductImageFile(null); setShowProductForm(true); }} onDuplicate={(product: any) => run(() => duplicateProduct.mutateAsync({ id: product.id }), "Produto duplicado")} onToggle={(product: any) => run(() => updateProduct.mutateAsync({ id: product.id, active: !product.active }), product.active ? "Produto encerrado" : "Produto reativado")} />}
          {section === "product" && <ProductDetailView detail={productDetailQuery.data as any} loading={productDetailQuery.isLoading} onBack={() => navigate("products")} onOrder={setSelectedOrderId} onCharge={openCharge} />}
          {section === "clients" && <ClientsView clients={clients} search={clientSearch} setSearch={setClientSearch} onAdd={() => { setClientForm(emptyClient); setShowClientForm(true); }} onEdit={(client: any) => { setClientForm({ id: client.id, name: client.name, phone: client.phone, notes: client.notes ?? "" }); setShowClientForm(true); }} onToggle={(client: any) => run(() => updateClient.mutateAsync({ id: client.id, active: !client.active }), client.active ? "Cliente arquivado" : "Cliente reativado")} onFile={handleVcfFile} />}
          {section === "orders" && <OrdersView clients={clients} products={products} orders={orders} sale={sale} setSale={setSale} totalCents={orderTotalCents} onSave={submitSale} search={orderSearch} setSearch={setOrderSearch} status={orderStatus} setStatus={setOrderStatus} onOpen={setSelectedOrderId} onCharge={openCharge} />}
          {section === "charges" && <ChargesView charges={(chargesQuery.data ?? []) as any[]} templates={templates} onSaveTemplate={(id: number, body: string) => run(() => updateTemplate.mutateAsync({ id, body }), "Modelo atualizado")} onOpenOrder={setSelectedOrderId} onCharge={openCharge} />}
          {section === "finance" && <FinanceView orders={orders} onOpen={setSelectedOrderId} onCharge={openCharge} />}
          {section === "reports" && <ReportsView products={products} productId={reportProductId} setProductId={setReportProductId} rows={(reportsQuery.data ?? []) as any[]} text={reportText} loading={reportsQuery.isLoading} />}
          {section === "settings" && <SettingsView user={user} audit={(auditQuery.data ?? []) as any[]} syncing={syncCloud.isPending} onSyncCloud={() => run(async () => { const res = await syncCloud.mutateAsync(); toast.success(`Sincronizado: ${res.products} produtos, ${res.clients} clientes e ${res.orders} pedidos!`); }, "Banco sincronizado com a nuvem")} onExport={() => downloadText("backup-venda-atacado.json", JSON.stringify({ exportedAt: new Date().toISOString(), dashboard: dashboard ?? null, products, clients, orders }, null, 2), "application/json;charset=utf-8")} />}
        </main>
      </>
    )}

    {showProductForm && <Modal title={productForm.id ? "Editar produto" : "Novo produto"} onClose={() => { setProductImageFile(null); setShowProductForm(false); }}><div className="form-grid"><label>Nome do produto<input value={productForm.name} onChange={event => setProductForm({ ...productForm, name: event.target.value })} placeholder="Ex.: Shorts alfaiataria" /></label><label>Preço unitário<input value={productForm.price} onChange={event => setProductForm({ ...productForm, price: event.target.value })} placeholder="22,00" inputMode="decimal" /></label><label>Categoria<input value={productForm.category} onChange={event => setProductForm({ ...productForm, category: event.target.value })} placeholder="Ex.: Verão" /></label><label className="full product-upload-field">Foto do produto <span className="optional">opcional · até 15 MB</span><input type="file" accept="image/*" onChange={event => setProductImageFile(event.target.files?.[0] ?? null)} />{(productImagePreview || productForm.imageUrl) ? <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "6px" }}><img className="upload-preview" src={productImagePreview || productForm.imageUrl} alt="Prévia da foto do produto" /><div style={{ display: "grid", gap: "4px" }}><span className="upload-selected">{productImageFile ? `Selecionada: ${productImageFile.name}` : "Foto atual do produto"}</span><button type="button" className="text-button" onClick={e => { e.preventDefault(); setProductImageFile(null); setProductForm({ ...productForm, imageUrl: "" }); }}>Remover foto</button></div></div> : <span className="upload-hint">Escolha uma foto do celular ou computador</span>}</label><label className="full">Descrição <span className="optional">opcional</span><textarea value={productForm.description} onChange={event => setProductForm({ ...productForm, description: event.target.value })} placeholder="Detalhes que ajudam a identificar a peça" /></label></div><div className="modal-actions"><Button variant="outline" onClick={() => { setProductImageFile(null); setShowProductForm(false); }} disabled={savingProduct}>Cancelar</Button><Button onClick={submitProduct} disabled={savingProduct || !productForm.name || moneyToCents(productForm.price) < 1}>{savingProduct ? "Salvando produto..." : productForm.id ? "Salvar alterações" : "Cadastrar produto"}</Button></div></Modal>}
    {showClientForm && <Modal title={clientForm.id ? "Editar cliente" : "Novo cliente"} onClose={() => setShowClientForm(false)}><div className="form-grid"><label>Nome completo<input value={clientForm.name} onChange={event => setClientForm({ ...clientForm, name: event.target.value })} placeholder="Nome da cliente" /></label><label>Telefone com DDD<input value={clientForm.phone} onChange={event => setClientForm({ ...clientForm, phone: event.target.value })} placeholder="65 99999-9999" inputMode="tel" /></label><label className="full">Observações <span className="optional">opcional</span><textarea value={clientForm.notes} onChange={event => setClientForm({ ...clientForm, notes: event.target.value })} placeholder="Preferências, cidade ou lembretes" /></label></div><div className="modal-actions"><Button variant="outline" onClick={() => setShowClientForm(false)}>Cancelar</Button><Button onClick={submitClient} disabled={!clientForm.name || clientForm.phone.replace(/\D/g, "").length < 8}>{clientForm.id ? "Salvar alterações" : "Cadastrar cliente"}</Button></div></Modal>}
    {showVcf && <Modal title="Importar contatos VCF" onClose={() => setShowVcf(false)}><div className="import-summary"><div><strong>{vcfPreview.length}</strong><span>contatos na prévia</span></div><div><strong>{new Set(vcfPreview.map(contact => contact.phone.replace(/\D/g, ""))).size}</strong><span>telefones únicos</span></div><div className={vcfInvalidCount ? "import-warning" : ""}><strong>{vcfInvalidCount}</strong><span>telefones curtos ignorados</span></div></div>{vcfInvalidCount > 0 && <p className="microcopy import-warning-text">Alguns cartões possuem códigos ou telefones incompletos. Eles serão ignorados; os contatos válidos serão importados normalmente.</p>}<div className="vcf-list">{vcfPreview.map((contact, index) => <div className={`vcf-row ${contact.phone.replace(/\D/g, "").length < 8 ? "invalid-row" : ""}`} key={`${contact.phone}-${index}`}><span>{contact.name}</span><small>{contact.phone}{contact.phone.replace(/\D/g, "").length < 8 ? " · ignorado" : ""}</small></div>)}</div><div className="modal-actions"><Button variant="outline" onClick={() => setShowVcf(false)}>Cancelar</Button><Button disabled={!vcfPreview.length || vcfInvalidCount === vcfPreview.length || importVcf.isPending} onClick={() => run(async () => { const result = await importVcf.mutateAsync({ contacts: vcfPreview }); if (result.invalid) toast.info(`${result.invalid} contato(s) foram ignorado(s) por telefone insuficiente`); setShowVcf(false); }, "Contatos válidos importados")}>{importVcf.isPending ? "Importando contatos..." : "Importar contatos válidos"}</Button></div></Modal>}
    {chargeDraft && <Modal title="Preparar cobrança" onClose={() => setChargeDraft(null)}><div className="charge-recipient"><div className="avatar">{chargeDraft.order.client?.name?.charAt(0) ?? "C"}</div><div><strong>{chargeDraft.order.client?.name}</strong><span>{chargeDraft.order.client?.phone} · saldo {formatMoney(Math.max(0, chargeDraft.order.totalCents - chargeDraft.order.paidCents))}</span></div></div><label>Modelo<select value={chargeDraft.templateId} onChange={event => { const id = Number(event.target.value); const template = templates.find(item => item.id === id); if (template) setChargeDraft({ ...chargeDraft, templateId: id, message: templateMessage(template.body, chargeDraft.order) }); }}>{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label><label>Mensagem<textarea className="message-editor" value={chargeDraft.message} onChange={event => setChargeDraft({ ...chargeDraft, message: event.target.value })} /></label><p className="microcopy">O botão abre o WhatsApp com o texto preenchido. O envio final depende da sua confirmação dentro do WhatsApp.</p><div className="modal-actions"><Button variant="outline" onClick={() => navigator.clipboard?.writeText(chargeDraft.message).then(() => toast.success("Mensagem copiada"))}><Copy size={16} /> Copiar</Button><Button onClick={submitCharge}><MessageCircle size={16} /> Abrir WhatsApp</Button></div></Modal>}
    {selectedOrderId && <OrderDrawer order={selectedOrder} clients={clients} products={products} editor={orderEditor} setEditor={setOrderEditor} editing={editingOrder} setEditing={setEditingOrder} paymentAmount={paymentAmount} setPaymentAmount={setPaymentAmount} paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod} onClose={() => setSelectedOrderId(null)} onSaveEdit={submitOrderEdit} onPayment={submitPayment} onCancel={() => run(() => cancelOrder.mutateAsync({ id: selectedOrderId }), "Pedido cancelado")} onCharge={openCharge} />}
  </div>;
}

function QuickSaleHomeView({
  products,
  clients,
  quickProductId,
  setQuickProductId,
  quickClientQuantities,
  setQuickClientQuantities,
  vitrineSearch,
  setVitrineSearch,
  clientSearch,
  setClientSearch,
  onSave,
  savingSale,
  onMinimize,
  onAddProduct,
  onAddClient,
  onFile,
}: any) {
  const activeProducts = useMemo(() => {
    const q = vitrineSearch.trim().toLowerCase();
    return products
      .filter((p: any) => p.active)
      .filter((p: any) => !q || p.name.toLowerCase().includes(q));
  }, [products, vitrineSearch]);

  const activeClients = useMemo(() => clients.filter((c: any) => c.active), [clients]);

  const selectedClients = useMemo(
    () => activeClients.filter((c: any) => Number(quickClientQuantities[c.id]) > 0),
    [activeClients, quickClientQuantities]
  );

  const unselectedClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    return activeClients
      .filter((c: any) => !quickClientQuantities[c.id])
      .filter((c: any) => !q || c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q));
  }, [activeClients, quickClientQuantities, clientSearch]);

  const selectProduct = (productId: number) => {
    setQuickProductId(quickProductId === productId ? null : productId);
  };

  const addClientSelection = (clientId: number) => {
    setQuickClientQuantities((prev: Record<number, number>) => ({
      ...prev,
      [clientId]: Math.max(1, prev[clientId] || 1),
    }));
  };

  const removeClientSelection = (clientId: number) => {
    setQuickClientQuantities((prev: Record<number, number>) => {
      const next = { ...prev };
      delete next[clientId];
      return next;
    });
  };

  const updateClientQuantity = (clientId: number, nextQty: number) => {
    const safeQty = Math.max(1, nextQty);
    setQuickClientQuantities((prev: Record<number, number>) => ({
      ...prev,
      [clientId]: safeQty,
    }));
  };

  return (
    <div className="quick-home">
      <header className="quick-home-header">
        <div className="quick-home-left">
          <div className="brand-mark small">VA</div>
          <div className="quick-search-inline">
            <Search size={14} />
            <input
              value={vitrineSearch}
              onChange={e => setVitrineSearch(e.target.value)}
              placeholder="Filtrar produto..."
            />
            {vitrineSearch && (
              <button type="button" onClick={() => setVitrineSearch("")}>
                <X size={12} />
              </button>
            )}
          </div>
        </div>
        <div className="quick-home-icons">
          <button type="button" className="mini-icon-btn" onClick={onAddProduct} title="Novo produto">
            <PackagePlus size={16} />
          </button>
          <button type="button" className="mini-icon-btn" onClick={onAddClient} title="Nova cliente">
            <UserPlus size={16} />
          </button>
          <label className="mini-icon-btn" title="Importar contatos VCF" style={{ cursor: "pointer", margin: 0 }}>
            <Upload size={16} />
            <input
              type="file"
              accept=".vcf,text/vcard"
              style={{ display: "none" }}
              onChange={event => {
                onFile?.(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          <button type="button" className="mini-icon-btn accent" onClick={onMinimize} title="Diminuir / Painel completo">
            <Minimize2 size={16} />
          </button>
        </div>
      </header>

      <div className="quick-home-body">
        <section
          className="quick-vitrine-section"
          onWheel={e => {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
              e.currentTarget.scrollLeft += e.deltaY;
            }
          }}
        >
          {activeProducts.length ? (
            <div className="vitrine-grid">
              {activeProducts.map((product: any) => {
                const isSelected = quickProductId === product.id;
                return (
                  <article
                    key={product.id}
                    className={`vitrine-card ${isSelected ? "is-selected" : ""}`}
                    onClick={() => selectProduct(product.id)}
                  >
                    <div className="vitrine-photo">
                      {product.imageUrl ? (
                        <img src={product.imageUrl} alt={product.name} />
                      ) : (
                        <div className="product-placeholder">
                          <Package size={20} />
                        </div>
                      )}
                      {isSelected && (
                        <span className="vitrine-check-badge">
                          <Check size={12} />
                        </span>
                      )}
                    </div>
                    <strong className="vitrine-title">{product.name}</strong>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="quick-empty-box">
              <Package size={22} />
              <span>Nenhum produto cadastrado</span>
              <Button size="sm" onClick={onAddProduct}>
                <Plus size={14} /> Novo produto
              </Button>
            </div>
          )}
        </section>

        <aside className="quick-client-panel">
          <div className="quick-client-top">
            <div className="quick-client-search">
              <Search size={15} />
              <input
                value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
                placeholder="Buscar cliente pelo nome ou telefone..."
              />
              {clientSearch && (
                <button type="button" onClick={() => setClientSearch("")} title="Limpar busca">
                  <X size={13} />
                </button>
              )}
            </div>
            {selectedClients.length > 0 && (
              <button
                type="button"
                className="clear-selected-btn"
                onClick={() => setQuickClientQuantities({})}
                title="Limpar selecionadas"
              >
                {selectedClients.length} selecionada(s) · limpar
              </button>
            )}
          </div>

          <div className="quick-client-list">
            {selectedClients.map((client: any) => {
              const qty = Math.max(1, Number(quickClientQuantities[client.id]) || 1);
              return (
                <div key={`sel-${client.id}`} className="client-card-item is-selected">
                  <div className="row-avatar">{client.name.charAt(0)}</div>
                  <div className="client-card-text">
                    <strong>{client.name}</strong>
                    <small>{client.phone}</small>
                  </div>
                  <div className="client-qty-inline" onClick={e => e.stopPropagation()}>
                    <button type="button" onClick={() => updateClientQuantity(client.id, qty - 1)}>
                      <Minus size={11} />
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={qty}
                      onChange={e => updateClientQuantity(client.id, Math.max(1, Number(e.target.value) || 1))}
                    />
                    <button type="button" onClick={() => updateClientQuantity(client.id, qty + 1)}>
                      <Plus size={11} />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="client-check-btn"
                    title="Remover seleção"
                    onClick={() => removeClientSelection(client.id)}
                  >
                    <Check size={15} className="client-check" />
                  </button>
                </div>
              );
            })}

            {unselectedClients.map((client: any) => (
              <div
                key={client.id}
                className="client-card-item"
                onClick={() => addClientSelection(client.id)}
              >
                <div className="row-avatar">{client.name.charAt(0)}</div>
                <div className="client-card-text">
                  <strong>{client.name}</strong>
                  <small>{client.phone}</small>
                </div>
                <button
                  type="button"
                  className="client-select-btn"
                  onClick={e => {
                    e.stopPropagation();
                    addClientSelection(client.id);
                  }}
                >
                  Selecionar
                </button>
              </div>
            ))}

            {selectedClients.length === 0 && unselectedClients.length === 0 && (
              <div className="quick-empty-box">
                <span>Cliente não encontrada</span>
                <Button size="sm" variant="outline" onClick={onAddClient}>
                  <Plus size={13} /> Nova cliente
                </Button>
              </div>
            )}
          </div>

          <Button
            size="lg"
            className="quick-finish-btn"
            onClick={onSave}
            disabled={savingSale || selectedClients.length === 0 || !quickProductId}
          >
            <Check size={17} />
            {savingSale
              ? "Finalizando..."
              : selectedClients.length > 1
              ? `Finalizar (${selectedClients.length} clientes)`
              : "Finalizar"}
          </Button>
        </aside>
      </div>
    </div>
  );
}

function DashboardView({ dashboard, loading, navigate, onOrder }: { dashboard: any; loading: boolean; navigate: (section: Section) => void; onOrder: (id: number) => void }) {
  if (loading || !dashboard) return <div className="content-stack"><div className="loading-panel"><RefreshCw className="spin" size={20} /> Carregando os números da operação...</div></div>;
  const stats = dashboard.stats;
  return <div className="content-stack"><section className="hero-strip"><div><div className="eyebrow">bom dia, administradora</div><h2>Venda registrada sem perder o fio.</h2><p>Acompanhe pedidos, recebimentos e pendências em uma visão rápida.</p></div><div className="hero-actions"><Button size="sm" variant="secondary" onClick={() => navigate("orders")}><Plus size={16} /> Registrar venda</Button><Button size="sm" variant="ghost" onClick={() => navigate("reports")}><FileText size={16} /> Criar relatório</Button></div></section><div className="stats-grid"><StatCard label="Vendas válidas" value={String(stats.orders)} helper={`${stats.pieces} peças registradas`} icon={ShoppingBag} /><StatCard label="Faturamento" value={formatMoney(stats.soldCents)} helper={`${stats.clients} clientes ativos`} icon={CircleDollarSign} accent="coral" /><StatCard label="Recebido" value={formatMoney(stats.receivedCents)} helper={`${stats.paidOrders} pedidos pagos`} icon={Check} accent="sage" /><StatCard label="Em aberto" value={formatMoney(stats.pendingCents)} helper={`${stats.pendingOrders + stats.partialOrders + stats.overdueOrders} pedidos para acompanhar`} icon={BellRing} accent="gold" /></div><div className="dashboard-grid"><section className="panel"><div className="panel-heading"><div><div className="eyebrow">últimas vendas</div><h3>Movimento recente</h3></div><button className="text-button" onClick={() => navigate("orders")}>Ver todos <ChevronRight size={15} /></button></div>{dashboard.recentOrders?.length ? <div className="compact-list">{dashboard.recentOrders.map((order: any) => <button className="list-row" key={order.id} onClick={() => onOrder(order.id)}><div className="row-avatar">{order.clientName.charAt(0)}</div><div className="row-main"><strong>{order.clientName}</strong><span>{order.code} · {formatDateTime(order.orderDate)}</span></div><div className="row-end"><strong>{formatMoney(order.totalCents)}</strong><StatusBadge status={order.status} /></div></button>)}</div> : <EmptyState icon={ShoppingBag} title="Nenhuma venda ainda" description="Registre a primeira venda para começar a acompanhar sua operação." action={<Button size="sm" onClick={() => navigate("orders")}><Plus size={16} /> Registrar venda</Button>} />}</section><section className="panel"><div className="panel-heading"><div><div className="eyebrow">giro do catálogo</div><h3>Produtos mais vendidos</h3></div></div>{dashboard.topProducts?.length ? <div className="ranking-list">{dashboard.topProducts.map((product: any, index: number) => <button className="ranking-row" key={product.productId} onClick={() => navigate("products")}><span className="rank">0{index + 1}</span><span className="rank-name">{product.name}<small>desempenho do período</small></span><strong>{product.quantity}<small>peças</small></strong></button>)}</div> : <EmptyState icon={BarChart3} title="Sem dados de giro" description="Os produtos mais vendidos aparecem depois dos primeiros pedidos." />}</section></div><section className="status-overview"><div><span className="overview-title">Status da carteira</span><span className="overview-caption">Uma leitura rápida do que precisa de atenção hoje.</span></div><div className="status-pills"><span><i className="dot dot-sage" /> {stats.paidOrders} pagos</span><span><i className="dot dot-gold" /> {stats.partialOrders} parciais</span><span><i className="dot dot-coral" /> {stats.overdueOrders} vencidos</span><span><i className="dot dot-muted" /> {stats.cancelledOrders} cancelados</span></div></section></div>;
}

function ProductsView({ products, search, setSearch, onAdd, onOpen, onEdit, onDuplicate, onToggle }: any) {
  return <div className="content-stack"><SectionHeader eyebrow="catálogo de peças" title="Produtos" description="Cadastre o que você divulga e acompanhe o giro de cada peça." action={<Button onClick={onAdd}><Plus size={17} /> Novo produto</Button>} /><div className="toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Pesquisar por nome..." /></div><span className="result-count">{products.length} {products.length === 1 ? "produto" : "produtos"}</span></div>{products.length ? <div className="product-grid">{products.map((product: any) => <article className={`product-card ${!product.active ? "is-inactive" : ""}`} key={product.id}><button className="product-cover" onClick={() => onOpen(product.id)}>{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <div className="product-placeholder"><Package size={26} /><span>VA</span></div>}<span className={`product-status ${product.active ? "active" : "inactive"}`}>{product.active ? "Ativo" : "Encerrado"}</span></button><div className="product-card-body"><button className="product-title" onClick={() => onOpen(product.id)}><strong>{product.name}</strong><ChevronRight size={16} /></button><span className="product-meta">{product.category || "Sem categoria"}</span><div className="product-bottom"><strong>{formatMoney(product.priceCents)}</strong><div className="row-actions"><button onClick={() => onEdit(product)} title="Editar"><Pencil size={15} /></button><button onClick={() => onDuplicate(product)} title="Duplicar"><Copy size={15} /></button><button onClick={() => onToggle(product)} title={product.active ? "Encerrar" : "Reativar"}>{product.active ? <Archive size={15} /> : <RefreshCw size={15} />}</button></div></div></div></article>)}</div> : <EmptyState icon={Package} title="Seu catálogo começa aqui" description="Cadastre os produtos que você divulga nos grupos para registrar vendas em poucos toques." action={<Button onClick={onAdd}><Plus size={16} /> Cadastrar produto</Button>} />}</div>;
}

function ProductDetailView({ detail, loading, onBack, onOrder, onCharge }: any) {
  if (loading || !detail) return <div className="content-stack"><button className="back-button" onClick={onBack}><ArrowLeft size={16} /> Voltar para produtos</button><div className="loading-panel"><RefreshCw className="spin" size={20} /> Carregando produto...</div></div>;
  const { product, stats, items } = detail;
  return <div className="content-stack"><button className="back-button" onClick={onBack}><ArrowLeft size={16} /> Voltar para produtos</button><section className="product-detail-head"><div className="detail-photo">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <Package size={32} />}</div><div className="detail-copy"><div className="eyebrow">visão do produto</div><h2>{product.name}</h2><p>{product.category || "Sem categoria"} · {formatMoney(product.priceCents)} por peça</p></div></section><div className="mini-stats"><div><span>Peças vendidas</span><strong>{stats.totalPieces}</strong></div><div><span>Faturamento</span><strong>{formatMoney(stats.soldCents)}</strong></div><div><span>Recebido</span><strong>{formatMoney(stats.receivedCents)}</strong></div><div><span>Em aberto</span><strong className="text-coral">{formatMoney(stats.pendingCents)}</strong></div><div><span>Clientes</span><strong>{stats.totalClients}</strong></div></div><section className="panel"><div className="panel-heading"><div><div className="eyebrow">pedidos relacionados</div><h3>Quem comprou {product.name}</h3></div><div className="status-pills compact"><span>{stats.paidOrders} pagos</span><span>{stats.partialOrders} parciais</span><span>{stats.pendingOrders} pendentes</span></div></div>{items.length ? <div className="table-wrap product-orders-table"><table><thead><tr><th>Cliente</th><th>Qtd.</th><th>Total</th><th>Recebido</th><th>Saldo</th><th>Status</th><th /></tr></thead><tbody>{items.map((item: any) => <tr key={item.id}><td><div className="table-person"><div className="row-avatar">{item.client.name.charAt(0)}</div><div><strong>{item.client.name}</strong><small>{item.client.phone}</small></div></div></td><td>{item.quantity}</td><td>{formatMoney(item.totalCents)}</td><td>{formatMoney(item.paidCents)}</td><td className={item.remainingCents ? "text-coral" : ""}>{formatMoney(item.remainingCents)}</td><td><StatusBadge status={item.status} /></td><td><div className="table-actions"><button onClick={() => onOrder(item.orderId)}>Detalhes</button>{item.remainingCents > 0 && <button className="whatsapp-mini" onClick={() => onCharge({ id: item.orderId, code: item.code, client: item.client, totalCents: item.totalCents, paidCents: item.paidCents, items: [{ productName: product.name, quantity: item.quantity }], dueDate: item.dueDate })}><MessageCircle size={14} /> Cobrar</button>}</div></td></tr>)}</tbody></table></div> : <EmptyState icon={ClipboardList} title="Ainda sem pedidos para este produto" description="Quando uma venda for registrada, todos os clientes aparecerão aqui com o status de pagamento." />}</section></div>;
}

function ClientsView({ clients, search, setSearch, onAdd, onEdit, onToggle, onFile }: any) {
  return <div className="content-stack"><SectionHeader eyebrow="carteira de clientes" title="Clientes" description="Tenha telefones prontos para registrar, cobrar e montar relatórios." action={<div className="header-actions"><label className="upload-button"><Upload size={16} /> Importar VCF<input type="file" accept=".vcf,text/vcard" onChange={event => onFile(event.target.files?.[0])} /></label><Button onClick={onAdd}><Plus size={17} /> Novo cliente</Button></div>} /><div className="toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Pesquisar nome ou telefone..." /></div><span className="result-count">{clients.length} clientes</span></div>{clients.length ? <div className="client-list">{clients.map((client: any) => <div className={`client-row ${!client.active ? "is-inactive" : ""}`} key={client.id}><div className="row-avatar large">{client.name.charAt(0)}</div><div className="client-main"><strong>{client.name}</strong><span>{client.phone}</span>{client.notes && <small>{client.notes}</small>}</div><span className={`client-state ${client.active ? "" : "inactive"}`}>{client.active ? "Ativo" : "Arquivado"}</span><div className="row-actions"><button onClick={() => onEdit(client)} title="Editar"><Pencil size={15} /></button><button onClick={() => onToggle(client)} title={client.active ? "Arquivar" : "Reativar"}>{client.active ? <Archive size={15} /> : <RefreshCw size={15} />}</button></div></div>)}</div> : <EmptyState icon={UsersRound} title="Sua carteira começa aqui" description="Cadastre a primeira cliente ou importe um arquivo VCF do celular." action={<Button onClick={onAdd}><Plus size={16} /> Cadastrar cliente</Button>} />}</div>;
}

function OrdersView({ clients, products, orders, sale, setSale, totalCents, onSave, search, setSearch, status, setStatus, onOpen, onCharge }: any) {
  return <div className="content-stack">
    <SectionHeader eyebrow="registro rápido" title="Pedidos" description="Selecione cliente, produto e quantidade. O sistema calcula o total automaticamente." />
    <section className="quick-sale">
      <div className="quick-sale-head"><div><div className="eyebrow">nova venda</div><h3>Registrar pedido</h3></div><span className="quick-total">{formatMoney(totalCents)}</span></div>
      <div className="sale-client-field"><label>Cliente<select value={sale.clientId} onChange={event => setSale({ ...sale, clientId: event.target.value })}><option value="">Selecione uma cliente</option>{clients.filter((client: any) => client.active).map((client: any) => <option key={client.id} value={client.id}>{client.name} · {client.phone}</option>)}</select></label></div>
      <div className="sale-items"><div className="sale-items-heading"><span>Produtos do pedido</span><button className="text-button" onClick={() => setSale({ ...sale, items: [...sale.items, { productId: "", quantity: "1" }] })}><Plus size={15} /> Adicionar produto</button></div>{sale.items.map((item: SaleItem, index: number) => <div className="sale-item" key={index}><select value={item.productId} onChange={event => { const next = [...sale.items]; next[index] = { ...item, productId: event.target.value }; setSale({ ...sale, items: next }); }}><option value="">Selecione o produto</option>{products.filter((product: any) => product.active).map((product: any) => <option key={product.id} value={product.id}>{product.name} · {formatMoney(product.priceCents)}</option>)}</select><input type="number" min="1" value={item.quantity} onChange={event => { const next = [...sale.items]; next[index] = { ...item, quantity: event.target.value }; setSale({ ...sale, items: next }); }} /><strong>{formatMoney((products.find((product: any) => product.id === Number(item.productId))?.priceCents ?? 0) * Number(item.quantity || 0))}</strong>{sale.items.length > 1 && <button className="remove-button" onClick={() => setSale({ ...sale, items: sale.items.filter((_: SaleItem, rowIndex: number) => rowIndex !== index) })}><Trash2 size={15} /></button>}</div>)}</div>
      <div className="sale-actions"><Button size="sm" onClick={onSave}><Check size={16} /> Registrar venda</Button></div>
    </section>
    <section className="panel"><div className="panel-heading"><div><div className="eyebrow">histórico de pedidos</div><h3>Todos os pedidos</h3></div><span className="result-count">{orders.length} registros</span></div><div className="toolbar compact-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Cliente, telefone ou código..." /></div><select className="filter-select" value={status} onChange={event => setStatus(event.target.value)}><option value="all">Todos os status</option><option value="pending">Pendentes</option><option value="partial">Parciais</option><option value="paid">Pagos</option><option value="overdue">Vencidos</option><option value="cancelled">Cancelados</option></select></div>{orders.length ? <div className="table-wrap orders-table"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Itens</th><th>Total</th><th>Saldo</th><th>Status</th><th /></tr></thead><tbody>{orders.map((order: any) => <tr key={order.id} onClick={() => onOpen(order.id)} className="clickable-row"><td><strong className="code-label">{order.code}</strong><small>{formatDate(order.orderDate)}</small></td><td><div className="table-person"><div className="row-avatar">{order.client.name.charAt(0)}</div><div><strong>{order.client.name}</strong><small>{order.client.phone}</small></div></div></td><td>{order.items.reduce((sum: number, item: any) => sum + item.quantity, 0)} peças<small>{order.items.map((item: any) => item.productName).join(", ")}</small></td><td><strong>{formatMoney(order.totalCents)}</strong></td><td className={order.totalCents - order.paidCents > 0 ? "text-coral" : ""}>{formatMoney(Math.max(0, order.totalCents - order.paidCents))}</td><td><StatusBadge status={order.status} /></td><td><div className="table-actions">{order.totalCents - order.paidCents > 0 && <button className="whatsapp-mini" onClick={event => { event.stopPropagation(); onCharge(order); }}><MessageCircle size={14} /> Cobrar</button>}<ChevronRight size={16} /></div></td></tr>)}</tbody></table></div> : <EmptyState icon={ClipboardList} title="Nenhum pedido encontrado" description="Ajuste os filtros ou registre uma nova venda acima." />}</section>
  </div>;
}

function ChargesView({ charges, templates, onSaveTemplate, onOpenOrder, onCharge }: any) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingBody, setEditingBody] = useState("");
  return <div className="content-stack"><SectionHeader eyebrow="acompanhamento de recebimentos" title="Cobranças" description="Mensagem pronta, conversa aberta e histórico organizado — sem afirmar o que o WhatsApp não confirmou." /><section className="charge-summary"><div><span>Mensagens registradas</span><strong>{charges.length}</strong></div><div><span>Última ação</span><strong>{charges[0] ? formatDateTime(charges[0].createdAt) : "Ainda não"}</strong></div><div><span>Regra do sistema</span><strong>Envio manual</strong></div></section><div className="two-column"><section className="panel"><div className="panel-heading"><div><div className="eyebrow">central de cobranças</div><h3>Histórico recente</h3></div></div>{charges.length ? <div className="compact-list">{charges.map((charge: any) => <div className="charge-row" key={charge.id}><div className="row-avatar">{charge.client.name.charAt(0)}</div><div className="row-main"><strong>{charge.client.name}</strong><span>{charge.template?.name ?? "Mensagem personalizada"} · {formatDateTime(charge.createdAt)}</span><small>{charge.message}</small></div><div className="charge-action"><span className="manual-tag">{charge.action === "whatsapp_opened" ? "WhatsApp aberto" : charge.action === "manual_sent" ? "Confirmado manualmente" : "Preparada"}</span><button onClick={() => onOpenOrder(charge.orderId)}>Ver pedido</button></div></div>)}</div> : <EmptyState icon={MessageCircle} title="Nenhuma cobrança registrada" description="Use o botão Cobrar dentro de um pedido com saldo em aberto." />}</section><section className="panel"><div className="panel-heading"><div><div className="eyebrow">modelos editáveis</div><h3>Suas mensagens</h3></div></div><div className="template-list">{templates.map((template: any) => <div className="template-row" key={template.id}>{editingId === template.id ? <><textarea value={editingBody} onChange={event => setEditingBody(event.target.value)} /><div><Button size="sm" onClick={() => { onSaveTemplate(template.id, editingBody); setEditingId(null); }}><Check size={14} /> Salvar</Button><Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancelar</Button></div></> : <><div><strong>{template.name}</strong><p>{template.body}</p></div><button onClick={() => { setEditingId(template.id); setEditingBody(template.body); }}><Pencil size={15} /></button></>}</div>)}</div></section></div></div>;
}

function FinanceView({ orders, onOpen, onCharge }: any) {
  const valid = orders.filter((order: any) => order.status !== "cancelled");
  const received = valid.reduce((sum: number, order: any) => sum + order.paidCents, 0);
  const pending = valid.reduce((sum: number, order: any) => sum + Math.max(0, order.totalCents - order.paidCents), 0);
  const overdue = valid.filter((order: any) => order.status === "overdue");
  return <div className="content-stack"><SectionHeader eyebrow="controle financeiro" title="Financeiro" description="Veja o que entrou, o que está em aberto e onde agir primeiro." /><div className="stats-grid finance-stats"><StatCard label="Recebido" value={formatMoney(received)} helper="soma dos pagamentos registrados" icon={Check} accent="sage" /><StatCard label="Saldo em aberto" value={formatMoney(pending)} helper="pedidos pendentes e parciais" icon={Wallet} accent="coral" /><StatCard label="Vencidos" value={String(overdue.length)} helper="com data vencida e saldo" icon={BellRing} accent="gold" /><StatCard label="Pedidos válidos" value={String(valid.length)} helper="cancelados ficam no histórico" icon={ClipboardList} /></div><section className="panel"><div className="panel-heading"><div><div className="eyebrow">visão de recebimentos</div><h3>Pedidos que pedem atenção</h3></div></div>{orders.filter((order: any) => order.status !== "paid" && order.status !== "cancelled").length ? <div className="table-wrap finance-table"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Total</th><th>Recebido</th><th>Saldo</th><th>Status</th><th /></tr></thead><tbody>{orders.filter((order: any) => order.status !== "paid" && order.status !== "cancelled").map((order: any) => <tr key={order.id}><td><strong>{order.code}</strong><small>{formatDate(order.orderDate)}</small></td><td>{order.client.name}<small>{order.client.phone}</small></td><td>{formatMoney(order.totalCents)}</td><td>{formatMoney(order.paidCents)}</td><td className="text-coral">{formatMoney(Math.max(0, order.totalCents - order.paidCents))}</td><td><StatusBadge status={order.status} /></td><td><div className="table-actions"><button onClick={() => onOpen(order.id)}>Abrir</button><button className="whatsapp-mini" onClick={() => onCharge(order)}><MessageCircle size={14} /> Cobrar</button></div></td></tr>)}</tbody></table></div> : <EmptyState icon={Check} title="Tudo em dia" description="Não há pedidos pendentes ou vencidos neste momento." />}</section></div>;
}

function ReportsView({ products, productId, setProductId, rows, text, loading }: any) {
  return <div className="content-stack"><SectionHeader eyebrow="para enviar às chefes" title="Relatórios" description="Escolha um produto ou veja o consolidado geral. O texto sai no mesmo padrão que você já usa." /><section className="report-builder"><div className="report-filters"><label>Produto<select value={productId} onChange={event => setProductId(event.target.value)}><option value="">Todos os produtos</option>{products.map((product: any) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label></div><div className="report-summary"><span><strong>{rows.length}</strong> linhas de venda</span><span><strong>{rows.reduce((sum: number, row: any) => sum + row.quantity, 0)}</strong> peças</span><span><strong>{formatMoney(rows.reduce((sum: number, row: any) => sum + row.totalCents, 0))}</strong> total</span></div></section><section className="report-layout"><div className="panel report-preview-panel"><div className="panel-heading"><div><div className="eyebrow">prévia em texto</div><h3>Relatório pronto</h3></div><div className="report-actions"><Button variant="outline" size="sm" onClick={() => navigator.clipboard?.writeText(text).then(() => toast.success("Relatório copiado"))}><Copy size={14} /> Copiar</Button><Button variant="outline" size="sm" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer")}><MessageCircle size={14} /> WhatsApp</Button></div></div>{loading ? <div className="loading-panel"><RefreshCw className="spin" size={18} /> Gerando relatório...</div> : <pre className="report-preview">{rows.length ? text : "Selecione um produto ou registre pedidos para gerar o relatório."}</pre>}<div className="report-footer-actions"><Button onClick={() => downloadText("relatorio-venda-atacado.txt", text)} disabled={!rows.length}><Download size={15} /> Baixar TXT</Button><Button variant="outline" onClick={() => window.print()} disabled={!rows.length}><FileText size={15} /> Gerar PDF</Button><Button variant="outline" onClick={() => downloadText("relatorio-venda-atacado.csv", csvFromRows(rows), "text/csv;charset=utf-8")} disabled={!rows.length}><Download size={15} /> Exportar Excel</Button></div></div><aside className="report-note"><div className="note-icon"><FileText size={18} /></div><strong>Formato preservado</strong><p>O nome e quantidade ficam juntos na primeira linha. O telefone entra na linha seguinte, com blocos separados por uma linha em branco.</p><span>Cancelados ficam fora por padrão.</span></aside></section></div>;
}

function SettingsView({ user, audit, onExport, onSyncCloud, syncing }: any) {
  return <div className="content-stack"><SectionHeader eyebrow="administração principal" title="Configurações" description="Acesso total, sincronização em nuvem entre aparelhos e exportação dos dados da operação." /><div className="settings-grid"><section className="panel"><div className="panel-heading"><div><div className="eyebrow">perfil atual</div><h3>Administradora</h3></div><span className="admin-pill">acesso total</span></div><div className="profile-box"><div className="avatar large">{(user.name ?? "A").charAt(0)}</div><div><strong>{user.name ?? "Administradora"}</strong><span>{user.email ?? "Conta Administradora"}</span><small>Dados compartilhados em todos os aparelhos conectados.</small></div></div><div className="settings-actions" style={{ display: "grid", gap: "10px" }}><div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}><Button onClick={onSyncCloud} disabled={syncing}><RefreshCw size={16} className={syncing ? "spin" : ""} /> {syncing ? "Sincronizando..." : "Empurrar dados para o Banco (Nuvem)"}</Button><Button variant="outline" onClick={onExport}><Download size={16} /> Exportar cópia JSON</Button></div><p>Todos os produtos, contatos VCF e pedidos criados são salvos diretamente no banco em nuvem e ficam disponíveis em qualquer celular ou computador logado.</p></div></section><section className="panel"><div className="panel-heading"><div><div className="eyebrow">rastro de segurança</div><h3>Últimas alterações</h3></div></div>{audit.length ? <div className="audit-list">{audit.slice(0, 10).map((entry: any) => <div key={entry.id}><span className="audit-dot" /><div><strong>{entry.action} · {entry.entityType}</strong><small>{formatDateTime(entry.createdAt)} · registro {entry.entityId}</small></div></div>)}</div> : <EmptyState icon={Archive} title="Nenhuma alteração registrada" description="As ações administrativas aparecerão aqui conforme você usar o sistema." />}</section></div><section className="security-callout"><Settings size={18} /><div><strong>Sincronização Multi-Aparelho</strong><p>Qualquer contato VCF anexado, cliente cadastrada ou produto adicionado é salvo automaticamente no banco de dados e aparece em todos os aparelhos logados.</p></div></section></div>;
}

function SectionHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <section className="section-header"><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2><p>{description}</p></div>{action && <div className="section-action">{action}</div>}</section>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card"><div className="modal-head"><div><div className="eyebrow">editar operação</div><h3>{title}</h3></div><button onClick={onClose}><X size={18} /></button></div>{children}</div></div>;
}

function OrderDrawer({ order, clients, products, editor, setEditor, editing, setEditing, paymentAmount, setPaymentAmount, paymentMethod, setPaymentMethod, onClose, onSaveEdit, onPayment, onCancel, onCharge }: any) {
  if (!order) return <div className="drawer-backdrop"><div className="drawer-card"><RefreshCw className="spin" size={20} /> Carregando pedido...</div></div>;
  return <div className="drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><aside className="drawer-card"><div className="drawer-head"><div><div className="eyebrow">detalhe do pedido</div><h3>{order.code}</h3><span>{formatDateTime(order.orderDate)} · {order.client.name}</span></div><button onClick={onClose}><X size={19} /></button></div>{editing && editor ? <div className="drawer-edit"><label>Cliente<select value={editor.clientId} onChange={event => setEditor({ ...editor, clientId: event.target.value })}>{clients.map((client: any) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><div className="drawer-items-edit">{editor.items.map((item: SaleItem, index: number) => <div key={index}><select value={item.productId} onChange={event => { const items = [...editor.items]; items[index] = { ...item, productId: event.target.value, unitPriceCents: products.find((product: any) => product.id === Number(event.target.value))?.priceCents }; setEditor({ ...editor, items }); }}>{products.map((product: any) => <option key={product.id} value={product.id}>{product.name}</option>)}</select><input type="number" min="1" value={item.quantity} onChange={event => { const items = [...editor.items]; items[index] = { ...item, quantity: event.target.value }; setEditor({ ...editor, items }); }} /></div>)}</div><label>Observações<textarea value={editor.notes} onChange={event => setEditor({ ...editor, notes: event.target.value })} /></label><Button onClick={onSaveEdit}><Check size={16} /> Salvar edição</Button></div> : <><div className="drawer-status-line"><StatusBadge status={order.status} /><button className="text-button" onClick={() => setEditing(true)}><Pencil size={14} /> Editar pedido</button></div><div className="drawer-client"><div className="row-avatar large">{order.client.name.charAt(0)}</div><div><strong>{order.client.name}</strong><span>{order.client.phone}</span></div></div><div className="drawer-items">{order.items.map((item: any) => <div key={item.id}><div><strong>{item.product.name}</strong><span>{item.quantity} × {formatMoney(item.unitPriceCents)}</span></div><strong>{formatMoney(item.totalCents)}</strong></div>)}</div><div className="drawer-totals"><div><span>Total do pedido</span><strong>{formatMoney(order.totalCents)}</strong></div><div><span>Recebido</span><strong className="text-sage">{formatMoney(order.paidCents)}</strong></div><div><span>Saldo restante</span><strong className={order.totalCents - order.paidCents ? "text-coral" : ""}>{formatMoney(Math.max(0, order.totalCents - order.paidCents))}</strong></div></div>{order.totalCents - order.paidCents > 0 && <div className="payment-box"><div className="eyebrow">registrar recebimento</div><div className="payment-inline"><input value={paymentAmount} onChange={event => setPaymentAmount(event.target.value)} placeholder={centsToInput(Math.max(0, order.totalCents - order.paidCents))} inputMode="decimal" /><select value={paymentMethod} onChange={event => setPaymentMethod(event.target.value)}><option>Pix</option><option>Dinheiro</option><option>Transferência</option><option>Cartão</option><option>Outro</option></select><Button onClick={onPayment}><Check size={15} /> Registrar</Button></div></div>}<div className="drawer-history"><div className="eyebrow">histórico de pagamentos</div>{order.payments.length ? order.payments.map((payment: any) => <div key={payment.id}><span>{formatDateTime(payment.paidAt)} · {payment.method || "Pagamento"}</span><strong>{formatMoney(payment.amountCents)}</strong></div>) : <p>Nenhum pagamento registrado ainda.</p>}</div><div className="drawer-actions">{order.totalCents - order.paidCents > 0 && <Button onClick={() => onCharge(order)}><MessageCircle size={16} /> Cobrar no WhatsApp</Button>}{order.status !== "cancelled" && <Button variant="outline" className="danger-outline" onClick={onCancel}><Trash2 size={16} /> Cancelar pedido</Button>}</div></>}</aside></div>;
}
