const statusFilter = document.getElementById("statusFilter");
const logoutButton = document.getElementById("logoutButton");
const closeDayButton = document.getElementById("closeDayButton");
const ordersTableBody = document.getElementById("ordersTableBody");
const orderDetail = document.getElementById("orderDetail");
const tableMeta = document.getElementById("tableMeta");
const feedback = document.getElementById("feedback");
const ordersAutoRefreshMeta = document.getElementById("ordersAutoRefreshMeta");

const conversationMeta = document.getElementById("conversationMeta");
const conversationList = document.getElementById("conversationList");
const chatTitle = document.getElementById("chatTitle");
const chatSubtitle = document.getElementById("chatSubtitle");
const chatOrderSummary = document.getElementById("chatOrderSummary");
const chatMessages = document.getElementById("chatMessages");
const chatComposer = document.getElementById("chatComposer");
const chatMessageInput = document.getElementById("chatMessageInput");
const sendMessageButton = document.getElementById("sendMessageButton");
const chatFeedback = document.getElementById("chatFeedback");

const kpiOrdersToday = document.getElementById("kpiOrdersToday");
const kpiSalesToday = document.getElementById("kpiSalesToday");
const kpiPending = document.getElementById("kpiPending");
const kpiDelivered = document.getElementById("kpiDelivered");
const reportsGrid = document.getElementById("reportsGrid");
const settingsGrid = document.getElementById("settingsGrid");
const historyList = document.getElementById("historyList");
const historyDetail = document.getElementById("historyDetail");
const toastContainer = document.getElementById("toastContainer");
const closeDayModal = document.getElementById("closeDayModal");
const closeDaySummary = document.getElementById("closeDaySummary");
const closeModalButton = document.getElementById("closeModalButton");
const cancelCloseDayButton = document.getElementById("cancelCloseDayButton");
const confirmCloseDayButton = document.getElementById("confirmCloseDayButton");
const navLinks = Array.from(document.querySelectorAll(".nav-link[data-section]"));
const sectionViews = Array.from(document.querySelectorAll(".panel-view[data-view]"));
const tableWrap = document.querySelector(".table-wrap");
const saasShell = document.querySelector(".saas-shell");
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");

const STATUS_OPTIONS = [
  { value: "pendiente", label: "Pendiente" },
  { value: "en proceso", label: "En camino" },
  { value: "entregado", label: "Entregado" },
  { value: "cancelado", label: "Cancelado" }
];

const PANEL_LOGIN_PATH = window.__PANEL_LOGIN_PATH__ || "/portal";
const SIDEBAR_STORAGE_KEY = "sidebarCollapsed";
const ACTIVE_SECTION_STORAGE_KEY = "activeSection";
const ORDERS_REFRESH_MS = 8000;
const MOBILE_LAYOUT = window.matchMedia("(max-width: 1100px)");
let orders = [];
let dashboardSummary = null;
let selectedOrderId = null;
let conversations = [];
let selectedPhone = null;
let activeMessages = [];
let historyClosures = [];
let selectedClosureId = null;
let healthState = null;
let sessionTimeoutHandle = null;
let finalizeModalOpen = false;
let sidebarCollapsed = false;
let mobileSidebarOpen = false;
let activeSection = "dashboard";
let lastOrdersSnapshot = new Map();
let lastOrdersSyncAt = null;
let ordersAutoRefreshHandle = null;
let ordersRefreshMetaHandle = null;
let ordersPollingInFlight = false;

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatOrderItemsSummary(order) {
  if (order?.resumenItems) return order.resumenItems;
  if (!Array.isArray(order?.items) || !order.items.length) return "-";
  return order.items
    .map((item) => [item.cantidad ?? "?", item.producto || "producto", item.sabor || null].filter(Boolean).join(" "))
    .join(", ");
}

function buildAvatarLabel(order) {
  const source = String(order?.cliente || order?.telefono || "CL").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("").slice(0, 2) || "CL";
}

function redirectToLogin() {
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `${PANEL_LOGIN_PATH}?next=${next}`;
}

function getStoredSidebarPreference() {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch (_error) {
    return false;
  }
}

function getStoredActiveSection() {
  try {
    const stored = window.localStorage.getItem(ACTIVE_SECTION_STORAGE_KEY);
    return navLinks.some((link) => link.dataset.section === stored) ? stored : "dashboard";
  } catch (_error) {
    return "dashboard";
  }
}

function storeSidebarPreference() {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed));
  } catch (_error) {
    // noop
  }
}

function storeActiveSection() {
  try {
    window.localStorage.setItem(ACTIVE_SECTION_STORAGE_KEY, activeSection);
  } catch (_error) {
    // noop
  }
}

function syncSidebarState() {
  const isMobile = MOBILE_LAYOUT.matches;
  saasShell.classList.toggle("sidebar-collapsed", !isMobile && sidebarCollapsed);
  saasShell.classList.toggle("sidebar-mobile-open", isMobile && mobileSidebarOpen);
  document.body.classList.toggle("sidebar-mobile-open", isMobile && mobileSidebarOpen);

  if (sidebarToggle) {
    sidebarToggle.setAttribute("aria-expanded", String(isMobile ? mobileSidebarOpen : !sidebarCollapsed));
  }

  if (sidebarBackdrop) {
    const shouldShowBackdrop = isMobile && mobileSidebarOpen;
    sidebarBackdrop.hidden = !shouldShowBackdrop;
    sidebarBackdrop.setAttribute("aria-hidden", String(!shouldShowBackdrop));
  }
}

function closeMobileSidebar() {
  if (!MOBILE_LAYOUT.matches || !mobileSidebarOpen) {
    return;
  }

  mobileSidebarOpen = false;
  syncSidebarState();
}

function toggleSidebar() {
  if (MOBILE_LAYOUT.matches) {
    mobileSidebarOpen = !mobileSidebarOpen;
    syncSidebarState();
    return;
  }

  sidebarCollapsed = !sidebarCollapsed;
  storeSidebarPreference();
  syncSidebarState();
}

function initSidebarState() {
  sidebarCollapsed = getStoredSidebarPreference();
  mobileSidebarOpen = false;
  syncSidebarState();
}

function updateOrdersRefreshMeta() {
  if (!ordersAutoRefreshMeta) {
    return;
  }

  if (!lastOrdersSyncAt) {
    ordersAutoRefreshMeta.textContent = "Actualizando pedidos automáticamente...";
    return;
  }

  const diffSeconds = Math.max(Math.round((Date.now() - lastOrdersSyncAt) / 1000), 0);
  if (diffSeconds < 5) {
    ordersAutoRefreshMeta.textContent = "Actualizado hace unos segundos";
  } else if (diffSeconds < 60) {
    ordersAutoRefreshMeta.textContent = `Actualizado hace ${diffSeconds}s`;
  } else {
    ordersAutoRefreshMeta.textContent = `Actualizado hace ${Math.round(diffSeconds / 60)} min`;
  }
}

function showSection(sectionName) {
  activeSection = navLinks.some((link) => link.dataset.section === sectionName) ? sectionName : "dashboard";
  storeActiveSection();

  navLinks.forEach((link) => {
    const isActive = link.dataset.section === activeSection;
    link.classList.toggle("active", isActive);
    link.classList.toggle("is-active", isActive);
  });

  sectionViews.forEach((view) => {
    const isVisible = view.dataset.view === activeSection;
    view.classList.toggle("is-hidden", !isVisible);
    view.toggleAttribute("hidden", !isVisible);
  });
}

function initSectionState() {
  showSection(getStoredActiveSection());
}

function getOrderSnapshot(orderList) {
  return new Map((orderList || []).map((order) => [order.id, JSON.stringify({
    estado: order.estado,
    total: Number(order.total || 0),
    resumenItems: formatOrderItemsSummary(order)
  })]));
}

function captureTablePosition() {
  if (!tableWrap) {
    return null;
  }

  return { top: tableWrap.scrollTop, left: tableWrap.scrollLeft };
}

function restoreTablePosition(position) {
  if (!tableWrap || !position) {
    return;
  }

  tableWrap.scrollTop = position.top;
  tableWrap.scrollLeft = position.left;
}

function notifyOrderChanges(nextOrders, previousSnapshot) {
  const nextSnapshot = getOrderSnapshot(nextOrders);
  const previousIds = new Set(previousSnapshot.keys());
  const newOrders = [];
  let statusChanged = false;

  for (const order of nextOrders) {
    if (!previousSnapshot.has(order.id)) {
      newOrders.push(order);
      continue;
    }

    if (previousSnapshot.get(order.id) !== nextSnapshot.get(order.id)) {
      statusChanged = true;
    }

    previousIds.delete(order.id);
  }

  lastOrdersSnapshot = nextSnapshot;

  if (newOrders.length) {
    showToast(newOrders.length === 1 ? "Nuevo pedido recibido" : `${newOrders.length} pedidos nuevos recibidos`, "success");
  } else if (statusChanged) {
    showToast("Pedidos actualizados automáticamente.", "info");
  }
}

function startOrdersAutoRefresh() {
  stopOrdersAutoRefresh();
  ordersAutoRefreshHandle = window.setInterval(() => {
    loadOrders({ silent: true, source: "poll" });
  }, ORDERS_REFRESH_MS);
  ordersRefreshMetaHandle = window.setInterval(updateOrdersRefreshMeta, 1000);
}

function stopOrdersAutoRefresh() {
  if (ordersAutoRefreshHandle) {
    window.clearInterval(ordersAutoRefreshHandle);
    ordersAutoRefreshHandle = null;
  }
  if (ordersRefreshMetaHandle) {
    window.clearInterval(ordersRefreshMetaHandle);
    ordersRefreshMetaHandle = null;
  }
}

function scheduleSessionTimeout(expiresAt) {
  if (sessionTimeoutHandle) {
    window.clearTimeout(sessionTimeoutHandle);
    sessionTimeoutHandle = null;
  }

  if (!expiresAt) return;

  const remainingMs = Math.max(Number(expiresAt) - Date.now(), 0);
  sessionTimeoutHandle = window.setTimeout(async () => {
    try {
      await fetch("/auth/logout", { method: "POST" });
    } finally {
      redirectToLogin();
    }
  }, remainingMs);
}

async function initSessionGuard() {
  try {
    const response = await fetch("/auth/session", { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok || !payload.ok || payload.authenticated === false) {
      redirectToLogin();
      return false;
    }

    scheduleSessionTimeout(payload.expiresAt);
    return true;
  } catch (_error) {
    redirectToLogin();
    return false;
  }
}

function showFeedback(message, type = "success") {
  feedback.hidden = false;
  feedback.className = `feedback ${type}`;
  feedback.textContent = message;
}

function hideFeedback() {
  feedback.hidden = true;
  feedback.textContent = "";
  feedback.className = "feedback";
}

function showChatFeedback(message, type = "success") {
  chatFeedback.hidden = false;
  chatFeedback.className = `feedback ${type}`;
  chatFeedback.textContent = message;
}

function hideChatFeedback() {
  chatFeedback.hidden = true;
  chatFeedback.textContent = "";
  chatFeedback.className = "feedback";
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function setLoadingState() {
  ordersTableBody.innerHTML = Array.from({ length: 5 }).map(() => `
    <tr>
      <td colspan="7"><div class="skeleton" style="height: 54px;"></div></td>
    </tr>
  `).join("");

  conversationList.innerHTML = Array.from({ length: 4 }).map(() => `
    <div class="conversation-item"><div class="skeleton" style="height: 66px;"></div></div>
  `).join("");

  historyList.innerHTML = Array.from({ length: 3 }).map(() => `
    <div class="history-card"><div class="skeleton" style="height: 74px;"></div></div>
  `).join("");
}

function getOrderById(orderId) {
  return orders.find((item) => item.id === orderId) || null;
}

function getConversationByPhone(phone) {
  return conversations.find((item) => item.phone === phone) || null;
}

function getClosureById(closureId) {
  return historyClosures.find((item) => item.id === closureId) || null;
}

function renderKPIs(summary) {
  const stats = summary?.stats || {};
  kpiOrdersToday.textContent = String(stats.totalOrders || 0);
  kpiSalesToday.textContent = formatCurrency(stats.totalSales || 0);
  kpiPending.textContent = String(stats.pending || 0);
  kpiDelivered.textContent = String(stats.delivered || 0);
}

function getTopProductSummary(orderList = []) {
  const counts = new Map();

  for (const order of orderList) {
    for (const item of order.items || []) {
      const label = [item.producto || "Producto", item.sabor || null].filter(Boolean).join(" ");
      counts.set(label, (counts.get(label) || 0) + Number(item.cantidad || 0));
    }
  }

  const [label, total] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0] || [];
  return label ? `${label} · ${total} und` : "Sin datos suficientes";
}

function getClosureTotals(days) {
  const now = Date.now();
  return historyClosures.reduce((sum, closure) => {
    const createdAt = new Date(closure.createdAt).getTime();
    if (!createdAt || Number.isNaN(createdAt)) {
      return sum;
    }

    const ageDays = (now - createdAt) / (1000 * 60 * 60 * 24);
    if (ageDays <= days) {
      return sum + Number(closure.totalSales || closure.summary?.stats?.totalSales || 0);
    }

    return sum;
  }, 0);
}

function renderReports() {
  const stats = dashboardSummary?.stats || {};
  const payments = dashboardSummary?.paymentBreakdown || [];
  const latestClosure = historyClosures[0] || null;
  const topProduct = getTopProductSummary(orders);
  const weeklyTotal = getClosureTotals(7) + Number(stats.totalSales || 0);
  const monthlyTotal = getClosureTotals(30) + Number(stats.totalSales || 0);

  reportsGrid.innerHTML = `
    <article class="report-card">
      <h3>Ventas del día</h3>
      <p class="report-copy">Resumen comercial actualizado en tiempo real.</p>
      <div class="report-stack">
        <span class="metric-pill">${formatCurrency(stats.totalSales || 0)}</span>
        <span class="helper-text">${stats.totalOrders || 0} pedido(s) activos hoy</span>
      </div>
    </article>
    <article class="report-card">
      <h3>Métodos de pago</h3>
      <p class="report-copy">Así se está moviendo el cobro hoy.</p>
      <div class="report-stack">
        ${payments.length
          ? payments.map((item) => `<span class="helper-text"><strong>${escapeHtml(item.label)}</strong> · ${item.count} pedido(s) · ${formatCurrency(item.total)}</span>`).join("")
          : '<span class="helper-text">Sin pagos registrados todavía.</span>'}
      </div>
    </article>
    <article class="report-card">
      <h3>Producto más vendido</h3>
      <p class="report-copy">Lectura rápida del catálogo con mayor salida.</p>
      <div class="report-stack">
        <span class="metric-pill">${escapeHtml(topProduct)}</span>
      </div>
    </article>
    <article class="report-card">
      <h3>Total semanal</h3>
      <p class="report-copy">Cierres recientes + operación activa.</p>
      <div class="report-stack">
        <span class="metric-pill">${formatCurrency(weeklyTotal)}</span>
      </div>
    </article>
    <article class="report-card">
      <h3>Total mensual</h3>
      <p class="report-copy">Acumulado del último mes según historial.</p>
      <div class="report-stack">
        <span class="metric-pill">${formatCurrency(monthlyTotal)}</span>
      </div>
    </article>
    <article class="report-card">
      <h3>Último cierre</h3>
      <p class="report-copy">Consulta rápida del último archivo histórico.</p>
      <div class="report-stack">
        <span class="metric-pill">${escapeHtml(latestClosure?.title || "Sin cierres todavía")}</span>
        <span class="helper-text">${escapeHtml(latestClosure ? formatDate(latestClosure.createdAt) : "Aún no hay historial")}</span>
      </div>
    </article>
  `;
}

function renderSettings() {
  const summary = dashboardSummary?.stats || {};
  settingsGrid.innerHTML = `
    <article class="setting-card">
      <h3>Estado de Abi</h3>
      <p class="setting-copy">${healthState?.ok ? "Online" : "Sin respuesta"}</p>
    </article>
    <article class="setting-card">
      <h3>Negocio</h3>
      <p class="setting-copy">Tellolac AI · Panel comercial</p>
    </article>
    <article class="setting-card">
      <h3>Versión del sistema</h3>
      <p class="setting-copy">${escapeHtml(healthState?.appVersion || "local")}</p>
    </article>
    <article class="setting-card">
      <h3>WhatsApp</h3>
      <p class="setting-copy">${healthState?.whatsappEnabled ? "Activo" : "Simulado / desactivado"}</p>
    </article>
    <article class="setting-card">
      <h3>Google Sheets</h3>
      <p class="setting-copy">${escapeHtml(healthState?.sheetsRole || "disabled")}</p>
    </article>
    <article class="setting-card">
      <h3>Base de datos</h3>
      <p class="setting-copy">${escapeHtml(healthState?.sourceOfTruth || "sqlite")}</p>
    </article>
    <article class="setting-card">
      <h3>Autenticación panel</h3>
      <p class="setting-copy">${healthState?.panelAuthEnabled ? "Protegido con login" : "Modo abierto"}</p>
    </article>
    <article class="setting-card">
      <h3>Variables visibles</h3>
      <p class="setting-copy">WHATSAPP_ENABLED=${healthState?.whatsappEnabled ? "true" : "false"} · SHEETS_ROLE=${escapeHtml(healthState?.sheetsRole || "disabled")}</p>
    </article>
    <article class="setting-card">
      <h3>Catálogo activo</h3>
      <p class="setting-copy">${healthState?.catalogProducts || 0} producto(s) sincronizados</p>
    </article>
    <article class="setting-card">
      <h3>Pedidos visibles</h3>
      <p class="setting-copy">${summary.totalOrders || 0} pedido(s) activos hoy</p>
    </article>
  `;
}

function renderOrders() {
  if (!orders.length) {
    ordersTableBody.innerHTML = '<tr><td colspan="7" class="empty">No hay pedidos activos para este filtro.</td></tr>';
    return;
  }

  ordersTableBody.innerHTML = orders.map((order) => {
    const activeClass = order.id === selectedOrderId ? "active" : "";
    const badgeClass = order.estado.replace(/\s+/g, "-");
    const itemsSummary = formatOrderItemsSummary(order);
    const avatar = buildAvatarLabel(order);

    return `
      <tr data-order-id="${escapeHtml(order.id)}" class="${activeClass}">
        <td>
          <div class="customer-cell">
            <span class="customer-avatar">${escapeHtml(avatar)}</span>
            <div>
              <div class="customer-name">${escapeHtml(order.cliente || "Cliente sin nombre")}</div>
              <div class="customer-subline">${escapeHtml(order.telefono || "Sin teléfono")}</div>
            </div>
          </div>
        </td>
        <td>
          <div class="customer-name">${escapeHtml(itemsSummary)}</div>
          <div class="customer-subline">${escapeHtml(order.direccion || "Sin dirección")}</div>
        </td>
        <td>${escapeHtml(formatDate(order.fechaRegistro))}</td>
        <td><span class="payment-pill">${escapeHtml(order.metodoPago || "Sin definir")}</span></td>
        <td><span class="total-pill">${escapeHtml(formatCurrency(order.total || 0))}</span></td>
        <td><span class="badge ${badgeClass}">${escapeHtml(order.estadoLabel || order.estado)}</span></td>
        <td>
          <div class="row-actions">
            <select data-status-select="${escapeHtml(order.id)}">
              ${STATUS_OPTIONS.map((status) => `<option value="${status.value}" ${order.estado === status.value ? "selected" : ""}>${status.label}</option>`).join("")}
            </select>
            <button class="primary" data-save-status="${escapeHtml(order.id)}">Guardar</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderDetail() {
  const order = getOrderById(selectedOrderId);

  if (!order) {
    orderDetail.innerHTML = '<div class="detail-empty"><p>No hay ningún pedido seleccionado.</p></div>';
    return;
  }

  const itemsHtml = (order.items || []).length
    ? order.items.map((item) => `
        <div class="item-row">
          <strong>${escapeHtml([item.cantidad ?? "?", item.producto || "Producto", item.sabor || null].filter(Boolean).join(" "))}</strong>
          <div class="helper-text">Precio unitario: ${escapeHtml(formatCurrency(item.precioUnitario || item.precio_unitario || 0))}</div>
          <div class="helper-text">Subtotal: ${escapeHtml(formatCurrency(item.subtotal || 0))}</div>
        </div>
      `).join("")
    : '<p class="helper-text">No hay detalle de productos disponible.</p>';

  orderDetail.innerHTML = `
    <div class="detail-grid">
      <div class="detail-card">
        <h3>Resumen</h3>
        <div class="meta-list">
          <div class="meta-item"><span>Cliente</span>${escapeHtml(order.cliente || "Cliente sin nombre")}</div>
          <div class="meta-item"><span>Teléfono</span>${escapeHtml(order.telefono || "-")}</div>
          <div class="meta-item"><span>Pedido</span>${escapeHtml(formatOrderItemsSummary(order))}</div>
          <div class="meta-item"><span>Total</span>${escapeHtml(formatCurrency(order.total || 0))}</div>
          <div class="meta-item"><span>Estado</span>${escapeHtml(order.estadoLabel || order.estado)}</div>
        </div>
      </div>
      <div class="detail-card">
        <h3>Entrega y pago</h3>
        <div class="meta-list">
          <div class="meta-item"><span>Dirección</span>${escapeHtml(order.direccion || "-")}</div>
          <div class="meta-item"><span>Fecha</span>${escapeHtml(formatDate(order.fechaRegistro))}</div>
          <div class="meta-item"><span>Fecha entrega</span>${escapeHtml(order.fechaEntrega || "-")}</div>
          <div class="meta-item"><span>Método de pago</span>${escapeHtml(order.metodoPago || "-")}</div>
        </div>
      </div>
      <div class="detail-card">
        <h3>Productos</h3>
        <div class="items-list">${itemsHtml}</div>
      </div>
      <div class="detail-card">
        <h3>Notas</h3>
        <p class="helper-text">${escapeHtml(order.observaciones || "Sin observaciones")}</p>
      </div>
    </div>
  `;
}

function renderConversationList() {
  if (!conversations.length) {
    conversationList.innerHTML = '<div class="conversation-empty">No hay conversaciones todavía.</div>';
    return;
  }

  conversationList.innerHTML = conversations.map((conversation) => {
    const activeClass = conversation.phone === selectedPhone ? "active" : "";
    const relatedOrder = getOrderById(conversation.lastOrderId);
    const customerName = relatedOrder?.cliente || conversation.phone;

    return `
      <article class="conversation-item ${activeClass}" data-phone="${escapeHtml(conversation.phone)}">
        <div class="conversation-topline">
          <div class="conversation-phone">${escapeHtml(customerName)}</div>
          <span class="helper-text">${escapeHtml(formatTime(conversation.lastMessageAt))}</span>
        </div>
        <div class="helper-text">${escapeHtml(conversation.phone)}</div>
        <div class="conversation-snippet">${escapeHtml(conversation.lastMessage || "Sin mensajes")}</div>
        <div class="conversation-meta">
          <span class="badge light">Último pedido: ${escapeHtml(conversation.lastOrderId || "ninguno")}</span>
        </div>
      </article>
    `;
  }).join("");
}

function renderChatHeader() {
  const conversation = getConversationByPhone(selectedPhone);

  if (!conversation) {
    chatTitle.textContent = "Selecciona una conversación";
    chatSubtitle.textContent = "Aquí verás el historial del cliente.";
    chatOrderSummary.innerHTML = "";
    chatMessageInput.disabled = true;
    sendMessageButton.disabled = true;
    return;
  }

  const relatedOrder = getOrderById(conversation.lastOrderId);
  chatTitle.textContent = relatedOrder?.cliente || conversation.phone;
  chatSubtitle.textContent = `${conversation.phone} · Último mensaje ${formatDate(conversation.lastMessageAt)}`;
  chatOrderSummary.innerHTML = `
    <span class="badge light">lastMessageOrderId: ${escapeHtml(conversation.lastMessageOrderId || "null")}</span>
    <span class="badge light">lastOrderId: ${escapeHtml(conversation.lastOrderId || "null")}</span>
  `;
  chatMessageInput.disabled = false;
  sendMessageButton.disabled = false;
}

function renderMessages() {
  if (!selectedPhone) {
    chatMessages.className = "chat-messages empty-chat";
    chatMessages.innerHTML = "<p>No hay conversación seleccionada.</p>";
    return;
  }

  if (!activeMessages.length) {
    chatMessages.className = "chat-messages empty-chat";
    chatMessages.innerHTML = "<p>Esta conversación aún no tiene mensajes.</p>";
    return;
  }

  chatMessages.className = "chat-messages";
  chatMessages.innerHTML = activeMessages.map((message) => `
    <div class="message-row ${escapeHtml(message.direction)}">
      <article class="message-bubble">
        <div>${escapeHtml(message.messageText || "")}</div>
        <div class="message-meta">
          <span>${escapeHtml(message.direction === "in" ? "Entrante" : "Saliente")}</span>
          <span>${escapeHtml(formatDate(message.createdAt))}</span>
          <span>orderId: ${escapeHtml(message.orderId || "null")}</span>
        </div>
      </article>
    </div>
  `).join("");

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderHistory() {
  if (!historyClosures.length) {
    historyList.innerHTML = '<div class="detail-empty"><p>No hay cierres guardados todavía.</p></div>';
    historyDetail.innerHTML = '<div class="detail-empty"><p>Aquí verás el resumen del cierre seleccionado.</p></div>';
    return;
  }

  if (!historyClosures.some((closure) => closure.id === selectedClosureId)) {
    selectedClosureId = historyClosures[0].id;
  }

  historyList.innerHTML = historyClosures.map((closure) => {
    const activeClass = closure.id === selectedClosureId ? "active" : "";
    return `
      <article class="history-card ${activeClass}" data-closure-id="${escapeHtml(closure.id)}">
        <div class="history-card-top">
          <div>
            <div class="customer-name">${escapeHtml(closure.title || `Cierre ${closure.dateKey}`)}</div>
            <div class="history-meta">${escapeHtml(formatDate(closure.createdAt))}</div>
          </div>
          <span class="badge light">${escapeHtml(String(closure.archivedOrdersCount || 0))} pedidos</span>
        </div>
        <div class="helper-text">Ventas: ${escapeHtml(formatCurrency(closure.totalSales || 0))}</div>
      </article>
    `;
  }).join("");

  renderHistoryDetail();
}

function renderHistoryDetail() {
  const closure = getClosureById(selectedClosureId);

  if (!closure) {
    historyDetail.innerHTML = '<div class="detail-empty"><p>Aquí verás el resumen del cierre seleccionado.</p></div>';
    return;
  }

  const stats = closure.summary?.stats || {};
  const paymentBreakdown = closure.summary?.paymentBreakdown || [];
  const ordersList = closure.summary?.orders || [];

  historyDetail.innerHTML = `
    <div class="detail-grid">
      <div class="detail-card">
        <h3>${escapeHtml(closure.title || `Cierre ${closure.dateKey}`)}</h3>
        <div class="meta-list">
          <div class="meta-item"><span>Fecha</span>${escapeHtml(formatDate(closure.createdAt))}</div>
          <div class="meta-item"><span>Pedidos archivados</span>${escapeHtml(String(stats.totalOrders || closure.archivedOrdersCount || 0))}</div>
          <div class="meta-item"><span>Ventas</span>${escapeHtml(formatCurrency(stats.totalSales || closure.totalSales || 0))}</div>
        </div>
        ${closure.downloadUrl ? `<div style="margin-top:12px;"><a class="primary" style="display:inline-flex;padding:12px 16px;text-decoration:none;" href="${escapeHtml(closure.downloadUrl)}">Descargar PDF</a></div>` : ""}
      </div>
      <div class="detail-card">
        <h3>Métodos de pago</h3>
        <div class="meta-list">
          ${paymentBreakdown.length
            ? paymentBreakdown.map((item) => `<div class="meta-item"><span>${escapeHtml(item.label)}</span>${escapeHtml(`${item.count} pedido(s) · ${formatCurrency(item.total)}`)}</div>`).join("")
            : '<p class="helper-text">No hay métodos de pago registrados.</p>'}
        </div>
      </div>
      <div class="detail-card">
        <h3>Pedidos archivados</h3>
        <div class="items-list">
          ${ordersList.length
            ? ordersList.map((order) => `<div class="item-row"><strong>${escapeHtml(order.cliente || "Cliente sin nombre")}</strong><div class="helper-text">${escapeHtml(order.resumenItems || "Sin detalle")}</div><div class="helper-text">${escapeHtml(formatCurrency(order.total || 0))}</div></div>`).join("")
            : '<p class="helper-text">No se guardaron pedidos en este cierre.</p>'}
        </div>
      </div>
    </div>
  `;
}

function getFinalizeDaySnapshot() {
  if (dashboardSummary?.stats) {
    return {
      stats: {
        totalOrders: Number(dashboardSummary.stats.totalOrders || 0),
        totalSales: Number(dashboardSummary.stats.totalSales || 0),
        pending: Number(dashboardSummary.stats.pending || 0),
        delivered: Number(dashboardSummary.stats.delivered || 0)
      },
      paymentBreakdown: Array.isArray(dashboardSummary.paymentBreakdown) ? dashboardSummary.paymentBreakdown : []
    };
  }

  const paymentMap = new Map();
  for (const order of orders) {
    const key = String(order.metodoPago || "Sin definir").trim() || "Sin definir";
    const current = paymentMap.get(key) || { label: key, count: 0, total: 0 };
    current.count += 1;
    current.total += Number(order.total || 0);
    paymentMap.set(key, current);
  }

  return {
    stats: {
      totalOrders: orders.length,
      totalSales: orders.reduce((sum, order) => sum + Number(order.total || 0), 0),
      pending: orders.filter((order) => order.estado === "pendiente").length,
      delivered: orders.filter((order) => order.estado === "entregado").length
    },
    paymentBreakdown: Array.from(paymentMap.values()).sort((a, b) => b.total - a.total)
  };
}

function renderCloseDaySummary() {
  const { stats, paymentBreakdown } = getFinalizeDaySnapshot();
  const hasOrders = Number(stats.totalOrders || 0) > 0;

  confirmCloseDayButton.disabled = !hasOrders;

  if (!hasOrders) {
    closeDaySummary.innerHTML = `
      <div class="modal-empty-state">
        <p class="modal-empty-title">No hay pedidos activos para cerrar hoy.</p>
        <p class="helper-text">Cuando existan pedidos del día, aquí verás el resumen antes de confirmar el cierre.</p>
      </div>
    `;
    return;
  }

  closeDaySummary.innerHTML = `
    <div class="modal-summary">
      <div class="modal-summary-card"><span class="helper-text">Pedidos del día</span><strong>${escapeHtml(String(stats.totalOrders || 0))}</strong></div>
      <div class="modal-summary-card"><span class="helper-text">Total vendido</span><strong>${escapeHtml(formatCurrency(stats.totalSales || 0))}</strong></div>
      <div class="modal-summary-card"><span class="helper-text">Pendientes</span><strong>${escapeHtml(String(stats.pending || 0))}</strong></div>
      <div class="modal-summary-card"><span class="helper-text">Entregados</span><strong>${escapeHtml(String(stats.delivered || 0))}</strong></div>
    </div>
    <div class="detail-card compact-card">
      <h3>Métodos de pago del día</h3>
      <div class="meta-list">
        ${paymentBreakdown.length
          ? paymentBreakdown.map((item) => `<div class="meta-item"><span>${escapeHtml(item.label)}</span>${escapeHtml(`${item.count} pedido(s) · ${formatCurrency(item.total)}`)}</div>`).join("")
          : '<p class="helper-text">No hay pagos registrados todavía.</p>'}
      </div>
    </div>
    <p class="helper-text modal-note">Se generará un PDF del día, se archivarán los pedidos visibles y el panel operativo quedará limpio.</p>
  `;
}

function resetFinalizeModalState() {
  closeDaySummary.innerHTML = "";
  closeDayModal.hidden = true;
  closeDayModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  finalizeModalOpen = false;
  confirmCloseDayButton.disabled = false;
}

function openFinalizeModal() {
  renderCloseDaySummary();
  closeDayModal.hidden = false;
  closeDayModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  finalizeModalOpen = true;
  closeDayModal.scrollTop = 0;
  window.requestAnimationFrame(() => {
    (confirmCloseDayButton.disabled ? closeModalButton : confirmCloseDayButton)?.focus();
  });
}

function closeFinalizeModal() {
  resetFinalizeModalState();
}

async function loadOrders(options = {}) {
  const { silent = false, source = "manual" } = options;
  const status = statusFilter.value;
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const previousSnapshot = lastOrdersSnapshot;
  const tablePosition = captureTablePosition();

  if (ordersPollingInFlight && source === "poll") {
    return;
  }

  if (source === "poll") {
    ordersPollingInFlight = true;
  }

  if (!silent) {
    tableMeta.textContent = "Cargando pedidos...";
  }

  try {
    const response = await fetch(`/orders${query}`, { cache: "no-store" });
    const payload = await response.json();

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (!response.ok || !payload.ok) {
      throw new Error(payload.detalle || payload.error || "No se pudieron cargar los pedidos");
    }

    orders = payload.orders || [];
    dashboardSummary = payload.summary || null;
    tableMeta.textContent = `${payload.total || orders.length} pedido(s) activos`;
    renderKPIs(dashboardSummary);
    renderReports();
    renderSettings();

    if (!orders.some((order) => order.id === selectedOrderId)) {
      selectedOrderId = orders[0]?.id || null;
    }

    renderOrders();
    renderDetail();
    renderConversationList();
    renderChatHeader();
    restoreTablePosition(tablePosition);

    if (silent && previousSnapshot.size) {
      notifyOrderChanges(orders, previousSnapshot);
    } else {
      lastOrdersSnapshot = getOrderSnapshot(orders);
    }

    lastOrdersSyncAt = Date.now();
    updateOrdersRefreshMeta();
  } catch (error) {
    if (!silent) {
      orders = [];
      selectedOrderId = null;
      tableMeta.textContent = "No se pudieron cargar pedidos";
      ordersTableBody.innerHTML = '<tr><td colspan="7" class="empty">No fue posible cargar los pedidos.</td></tr>';
      orderDetail.innerHTML = `<div class="detail-empty"><p>${escapeHtml(error.message)}</p></div>`;
      showFeedback(error.message, "error");
    }
  } finally {
    if (source === "poll") {
      ordersPollingInFlight = false;
    }
  }
}

async function loadConversations() {
  conversationMeta.textContent = "Cargando conversaciones...";

  try {
    const response = await fetch("/conversations");
    const payload = await response.json();

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (!response.ok || !payload.ok) {
      throw new Error(payload.detalle || payload.error || "No se pudieron cargar las conversaciones");
    }

    conversations = payload.conversations || [];
    conversationMeta.textContent = `${payload.total || conversations.length} conversación(es) activas`;

    if (!conversations.some((conversation) => conversation.phone === selectedPhone)) {
      selectedPhone = conversations[0]?.phone || null;
    }

    renderConversationList();

    if (selectedPhone) {
      await loadMessages(selectedPhone);
    } else {
      activeMessages = [];
      renderChatHeader();
      renderMessages();
    }
  } catch (error) {
    conversations = [];
    selectedPhone = null;
    activeMessages = [];
    conversationMeta.textContent = "No se pudieron cargar conversaciones";
    conversationList.innerHTML = `<div class="conversation-empty">${escapeHtml(error.message)}</div>`;
    renderChatHeader();
    renderMessages();
    showChatFeedback(error.message, "error");
  }
}

async function loadMessages(phone) {
  try {
    const response = await fetch(`/conversations/${encodeURIComponent(phone)}/messages`);
    const payload = await response.json();

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (!response.ok || !payload.ok) {
      throw new Error(payload.detalle || payload.error || "No se pudieron cargar los mensajes");
    }

    activeMessages = payload.messages || [];
    renderConversationList();
    renderChatHeader();
    renderMessages();
  } catch (error) {
    activeMessages = [];
    renderChatHeader();
    renderMessages();
    showChatFeedback(error.message, "error");
  }
}

async function loadHistory() {
  try {
    const response = await fetch("/history/closures");
    const payload = await response.json();

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (!response.ok || !payload.ok) {
      throw new Error(payload.detalle || payload.error || "No se pudo cargar el historial");
    }

    historyClosures = payload.closures || [];
    renderHistory();
    renderReports();
  } catch (error) {
    historyClosures = [];
    historyList.innerHTML = `<div class="detail-empty"><p>${escapeHtml(error.message)}</p></div>`;
    historyDetail.innerHTML = '<div class="detail-empty"><p>No fue posible cargar el historial.</p></div>';
  }
}

async function loadHealth() {
  try {
    const response = await fetch("/health");
    const payload = await response.json();
    if (response.ok && payload.ok) {
      healthState = payload;
      renderSettings();
    }
  } catch (_error) {
    // noop
  }
}

async function updateOrderStatus(orderId, nextStatus, button) {
  button.disabled = true;
  hideFeedback();

  try {
    const response = await fetch(`/orders/${encodeURIComponent(orderId)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus })
    });
    const payload = await response.json();

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (!response.ok || !payload.ok) {
      throw new Error(payload.detalle || payload.error || "No se pudo actualizar el estado");
    }

    showFeedback(`Estado actualizado a ${payload.order?.estadoLabel || nextStatus}.`, "success");
    showToast("Pedido actualizado correctamente.", "success");
    await loadOrders();
  } catch (error) {
    showFeedback(error.message, "error");
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function sendChatMessage(event) {
  event.preventDefault();
  hideChatFeedback();

  if (!selectedPhone) {
    showChatFeedback("Selecciona una conversación primero.", "error");
    return;
  }

  const message = chatMessageInput.value.trim();
  if (!message) {
    showChatFeedback("Escribe un mensaje antes de enviar.", "error");
    return;
  }

  sendMessageButton.disabled = true;

  try {
    const response = await fetch(`/conversations/${encodeURIComponent(selectedPhone)}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message })
    });
    const payload = await response.json();

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (!response.ok || !payload.ok) {
      throw new Error(payload.detalle || payload.error || "No se pudo enviar el mensaje");
    }

    chatMessageInput.value = "";
    showChatFeedback(payload.delivery?.simulated ? "Mensaje guardado y envío simulado correctamente." : "Mensaje enviado correctamente.", "success");
    showToast("Mensaje enviado desde Abi CRM.", "success");
    await loadConversations();
  } catch (error) {
    showChatFeedback(error.message, "error");
    showToast(error.message, "error");
  } finally {
    sendMessageButton.disabled = false;
  }
}

async function confirmCloseDay() {
  const { stats } = getFinalizeDaySnapshot();
  if (!Number(stats.totalOrders || 0)) {
    showToast("No hay pedidos activos para cerrar hoy.", "info");
    return;
  }

  confirmCloseDayButton.disabled = true;

  try {
    const response = await fetch("/admin/close-day", { method: "POST" });
    const payload = await response.json();

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (!response.ok || !payload.ok) {
      throw new Error(payload.detalle || payload.error || "No se pudo finalizar el día");
    }

    closeFinalizeModal();
    showToast(`Día finalizado. ${payload.archivedOrders || 0} pedido(s) archivados.`, "success");

    if (payload.closure?.downloadUrl) {
      const link = document.createElement("a");
      link.href = payload.closure.downloadUrl;
      link.click();
    }

    await loadDashboard();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    confirmCloseDayButton.disabled = false;
  }
}

async function loadDashboard() {
  closeDayButton.disabled = true;
  hideFeedback();
  hideChatFeedback();
  setLoadingState();

  try {
    await Promise.all([loadOrders(), loadConversations(), loadHistory(), loadHealth()]);
  } finally {
    closeDayButton.disabled = false;
  }
}

document.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-order-id]");
  if (row && !event.target.closest("button") && !event.target.closest("select")) {
    selectedOrderId = row.dataset.orderId;
    renderOrders();
    renderDetail();
    return;
  }

  const conversationItem = event.target.closest(".conversation-item[data-phone]");
  if (conversationItem) {
    selectedPhone = conversationItem.dataset.phone;
    hideChatFeedback();
    loadMessages(selectedPhone);
    renderConversationList();
    return;
  }

  const historyCard = event.target.closest(".history-card[data-closure-id]");
  if (historyCard && !event.target.closest("a")) {
    selectedClosureId = historyCard.dataset.closureId;
    renderHistory();
    return;
  }

  const saveButton = event.target.closest("button[data-save-status]");
  if (saveButton) {
    const orderId = saveButton.dataset.saveStatus;
    const select = document.querySelector(`select[data-status-select="${CSS.escape(orderId)}"]`);
    const nextStatus = select?.value;

    if (!nextStatus) {
      showFeedback("Selecciona un estado válido.", "error");
      return;
    }

    updateOrderStatus(orderId, nextStatus, saveButton);
    return;
  }

  const navLink = event.target.closest(".nav-link[data-section]");
  if (navLink) {
    showSection(navLink.dataset.section);
    closeMobileSidebar();
  }
});

sidebarToggle?.addEventListener("click", toggleSidebar);
sidebarBackdrop?.addEventListener("click", closeMobileSidebar);
MOBILE_LAYOUT.addEventListener("change", () => {
  mobileSidebarOpen = false;
  syncSidebarState();
});

statusFilter.addEventListener("change", () => {
  hideFeedback();
  loadOrders();
});

closeDayButton?.addEventListener("click", openFinalizeModal);
closeModalButton?.addEventListener("click", closeFinalizeModal);
cancelCloseDayButton?.addEventListener("click", closeFinalizeModal);
confirmCloseDayButton?.addEventListener("click", confirmCloseDay);
closeDayModal?.addEventListener("click", (event) => {
  if (event.target === closeDayModal) {
    closeFinalizeModal();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  if (finalizeModalOpen) {
    closeFinalizeModal();
    return;
  }

  closeMobileSidebar();
});

logoutButton?.addEventListener("click", async () => {
  stopOrdersAutoRefresh();
  try {
    await fetch("/auth/logout", { method: "POST" });
  } finally {
    redirectToLogin();
  }
});

window.addEventListener("beforeunload", stopOrdersAutoRefresh);

chatComposer.addEventListener("submit", sendChatMessage);

initSidebarState();
initSectionState();
updateOrdersRefreshMeta();

(async () => {
  const authenticated = await initSessionGuard();
  if (authenticated) {
    await loadDashboard();
    startOrdersAutoRefresh();
  }
})();
