const statusFilter = document.getElementById("statusFilter");
const logoutButton = document.getElementById("logoutButton");
const closeDayButton = document.getElementById("closeDayButton");
const ordersTableBody = document.getElementById("ordersTableBody");
const orderDetail = document.getElementById("orderDetail");
const tableMeta = document.getElementById("tableMeta");
const feedback = document.getElementById("feedback");
const ordersAutoRefreshMeta = document.getElementById("ordersAutoRefreshMeta");
const appLoader = document.getElementById("appLoader");
const themeToggleButton = document.getElementById("themeToggleButton");
const themeToggleLabel = document.getElementById("themeToggleLabel");
const themeToggleIcon = document.getElementById("themeToggleIcon");
const soundToggleButton = document.getElementById("soundToggleButton");
const soundToggleLabel = document.getElementById("soundToggleLabel");
const soundToggleIcon = document.getElementById("soundToggleIcon");

const conversationMeta = document.getElementById("conversationMeta");
const conversationList = document.getElementById("conversationList");
const conversationSearchInput = document.getElementById("conversationSearchInput");
const chatWorkspace = document.getElementById("chatWorkspace");
const chatBackButton = document.getElementById("chatBackButton");
const chatContactAvatar = document.getElementById("chatContactAvatar");
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
const customersMeta = document.getElementById("customersMeta");
const customersFeedback = document.getElementById("customersFeedback");
const customersList = document.getElementById("customersList");
const customerSearchInput = document.getElementById("customerSearchInput");
const customerForm = document.getElementById("customerForm");
const customerFormTitle = document.getElementById("customerFormTitle");
const customerFormResetButton = document.getElementById("customerFormResetButton");
const customerIdInput = document.getElementById("customerIdInput");
const customerNameInput = document.getElementById("customerNameInput");
const customerPhoneInput = document.getElementById("customerPhoneInput");
const customerTypeInput = document.getElementById("customerTypeInput");
const customerNotesInput = document.getElementById("customerNotesInput");
const customerSubmitButton = document.getElementById("customerSubmitButton");
const historyList = document.getElementById("historyList");
const historyDetail = document.getElementById("historyDetail");
const toastContainer = document.getElementById("toastContainer");
const closeDayModal = document.getElementById("closeDayModal");
const closeDaySummary = document.getElementById("closeDaySummary");
const closeModalButton = document.getElementById("closeModalButton");
const cancelCloseDayButton = document.getElementById("cancelCloseDayButton");
const confirmCloseDayButton = document.getElementById("confirmCloseDayButton");
const orderDetailModal = document.getElementById("orderDetailModal");
const orderDetailTitle = document.getElementById("orderDetailTitle");
const orderDetailCloseButton = document.getElementById("orderDetailCloseButton");
const orderDetailStatusSelect = document.getElementById("orderDetailStatusSelect");
const orderDetailSaveButton = document.getElementById("orderDetailSaveButton");
const navLinks = Array.from(document.querySelectorAll(".nav-link[data-section]"));
const sectionViews = Array.from(document.querySelectorAll(".panel-view[data-view]"));
const tableWrap = document.querySelector(".table-wrap");
const saasShell = document.querySelector(".saas-shell");
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");

const STATUS_OPTIONS = [
  { value: "pendiente", label: "🟡 Pendiente" },
  { value: "en proceso", label: "🔵 En camino" },
  { value: "entregado", label: "🟢 Entregado" },
  { value: "cancelado", label: "Cancelado" }
];

const PANEL_LOGIN_PATH = window.__PANEL_LOGIN_PATH__ || "/portal";
const SIDEBAR_STORAGE_KEY = "sidebarCollapsed";
const ACTIVE_SECTION_STORAGE_KEY = "activeSection";
const THEME_STORAGE_KEY = "theme";
const SOUNDS_STORAGE_KEY = "uiSoundsEnabled";
const ORDERS_REFRESH_MS = 8000;
const CONVERSATIONS_REFRESH_MS = 12000;
const LOADER_MIN_VISIBLE_MS = 650;
const MOBILE_LAYOUT = window.matchMedia("(max-width: 1100px)");
const appBootStartedAt = performance.now();

let orders = [];
let dashboardSummary = null;
let selectedOrderId = null;
let conversations = [];
let selectedPhone = null;
let activeMessages = [];
let historyClosures = [];
let selectedClosureId = null;
let customers = [];
let selectedCustomerId = null;
let healthState = null;
let sessionTimeoutHandle = null;
let finalizeModalOpen = false;
let orderDetailModalOpen = false;
let sidebarCollapsed = false;
let mobileSidebarOpen = false;
let activeSection = "dashboard";
let lastOrdersSnapshot = new Map();
let lastConversationSnapshot = new Map();
let lastOrdersSyncAt = null;
let ordersAutoRefreshHandle = null;
let conversationsAutoRefreshHandle = null;
let ordersRefreshMetaHandle = null;
let ordersPollingInFlight = false;
let conversationsPollingInFlight = false;
let conversationSearchQuery = "";
let conversationSearchDebounce = null;
let customerSearchQuery = "";
let customerSearchDebounce = null;
let visibleMessagesLimit = 60;
let currentTheme = getStoredThemePreference();
let uiSoundsEnabled = getStoredSoundsPreference();
let audioContext = null;
let audioActivationHintShown = false;

function icon(name, className = "ui-icon") {
  return `<svg class="${className}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

function renderEmptyState({ iconName = "sparkles", title, copy, compact = false } = {}) {
  return `
    <div class="empty-state${compact ? " compact" : ""}">
      <div class="empty-state-icon">${icon(iconName)}</div>
      <div class="empty-state-title">${escapeHtml(title || "Sin información")}</div>
      <p class="helper-text">${escapeHtml(copy || "Cuando haya datos disponibles, aparecerán aquí.")}</p>
    </div>
  `;
}

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

function getStatusLabel(status) {
  const labels = {
    pendiente: "🟡 Pendiente",
    "en proceso": "🔵 En camino",
    entregado: "🟢 Entregado",
    cancelado: "Cancelado"
  };

  return labels[status] || labels.pendiente;
}

function formatDateTimeStack(value) {
  if (!value) {
    return { date: "-", time: "-" };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { date: value, time: "-" };
  }

  return {
    date: new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(date),
    time: new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit" }).format(date)
  };
}

function getPaymentVariant(paymentMethod) {
  const normalized = String(paymentMethod || "").toLowerCase();
  if (normalized.includes("efectivo")) return "cash";
  if (normalized.includes("transfer") || normalized.includes("nequi") || normalized.includes("davi")) return "digital";
  return "neutral";
}

function formatCustomerTypeLabel(value) {
  return String(value || "public").toLowerCase() === "distributor" ? "Distribuidor" : "Público";
}

function formatCustomerStatusLabel(value) {
  return value ? "Activo" : "Inactivo";
}

function getCustomerTypeBadgeClass(value) {
  return String(value || "public").toLowerCase() === "distributor" ? "badge distributor" : "badge light";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCustomizationList(customizations = []) {
  return Array.isArray(customizations)
    ? customizations.filter((item) => item?.label && item?.value).map((item) => `${item.label}: ${item.value}`)
    : [];
}

function renderCustomizationHtml(customizations = []) {
  const items = formatCustomizationList(customizations);
  if (!items.length) {
    return '<p class="helper-text">Sin observaciones</p>';
  }

  return `<div class="meta-list premium-meta-list">${items.map((item) => `<div class="meta-item"><span>Observación</span>${escapeHtml(item)}</div>`).join("")}</div>`;
}

function renderReceiptHtml(receipt) {
  if (!receipt?.path) {
    return '<p class="helper-text">Sin comprobante</p>';
  }

  const isImage = /\.(png|jpe?g|webp|gif)$/i.test(receipt.path) || String(receipt.mimeType || "").startsWith("image/");
  return `
    <div class="items-list">
      <div class="item-row premium-item-row detail-product-row">
        <div>
          <strong>Comprobante recibido</strong>
          <div class="helper-text">${escapeHtml(receipt.mimeType || "Archivo adjunto")}</div>
          <div class="helper-text"><a href="${escapeHtml(receipt.path)}" target="_blank" rel="noopener noreferrer">Abrir comprobante</a></div>
        </div>
      </div>
      ${isImage ? `<img src="${escapeHtml(receipt.path)}" alt="Comprobante del pedido" style="width:100%;max-height:280px;object-fit:contain;border-radius:16px;border:1px solid rgba(143,164,191,.18);background:rgba(255,255,255,.65);padding:8px;box-sizing:border-box;">` : ""}
    </div>
  `;
}

function formatOrderItemsSummary(order) {
  if (order?.resumenItems) return order.resumenItems;
  if (!Array.isArray(order?.items) || !order.items.length) return "-";
  return order.items
    .map((item) => {
      const summary = [item.cantidad ?? "?", item.producto || "producto", item.sabor || null].filter(Boolean).join(" ");
      const notes = item.productNotes || item.product_notes || null;
      return `${summary}${notes ? ` (Nota: ${notes})` : ""}`;
    })
    .join(", ");
}

function formatCompactOrderSummary(order) {
  const items = Array.isArray(order?.items) ? order.items.filter(Boolean) : [];

  if (!items.length) {
    return {
      countLabel: "Sin productos",
      previewLabel: formatOrderItemsSummary(order),
      extraLabel: ""
    };
  }

  const previewLabel = items
    .slice(0, 2)
    .map((item) => `${item.cantidad ?? "?"} ${item.producto || "Producto"}`)
    .join(", ");
  const remaining = items.length - 2;

  return {
    countLabel: `${items.length} producto${items.length === 1 ? "" : "s"}`,
    previewLabel,
    extraLabel: remaining > 0 ? `+${remaining} más` : ""
  };
}

function buildAvatarLabel(order) {
  const source = String(order?.cliente || order?.telefono || "CL").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("").slice(0, 2) || "CL";
}

function syncModalOpenState() {
  document.body.classList.toggle("modal-open", finalizeModalOpen || orderDetailModalOpen);
}

function syncOrderDetailSaveState() {
  const hasOrder = Boolean(selectedOrderId && getOrderById(selectedOrderId));
  const changed = hasOrder && orderDetailStatusSelect?.value !== orderDetailStatusSelect?.dataset.currentStatus;

  if (orderDetailSaveButton) {
    orderDetailSaveButton.disabled = !changed;
    orderDetailSaveButton.hidden = !hasOrder;
  }

  if (orderDetailStatusSelect) {
    orderDetailStatusSelect.disabled = !hasOrder;
  }
}

function openOrderDetailModal(orderId = selectedOrderId) {
  if (orderId) {
    selectedOrderId = orderId;
  }

  renderOrders();
  renderDetail();
  orderDetailModal.hidden = false;
  orderDetailModal.setAttribute("aria-hidden", "false");
  orderDetailModalOpen = true;
  syncModalOpenState();
  orderDetail.scrollTop = 0;
  window.requestAnimationFrame(() => {
    (orderDetailCloseButton || orderDetailSaveButton)?.focus();
  });
}

function closeOrderDetailModal() {
  orderDetailModal.hidden = true;
  orderDetailModal.setAttribute("aria-hidden", "true");
  orderDetailModalOpen = false;
  syncModalOpenState();
}

function buildConversationLabel(conversation) {
  const relatedOrder = getOrderById(conversation?.lastOrderId);
  return relatedOrder?.cliente || conversation?.phone || "CL";
}

function getUnreadCount(conversation) {
  return conversation?.lastMessageDirection === "in" ? 1 : 0;
}

function syncChatWorkspaceState() {
  if (!chatWorkspace) {
    return;
  }

  const mobileChatOpen = MOBILE_LAYOUT.matches && Boolean(selectedPhone) && activeSection === "chat";
  chatWorkspace.classList.toggle("chat-mobile-active", mobileChatOpen);
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

function getStoredThemePreference() {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "dark" ? "dark" : "light";
  } catch (_error) {
    return "light";
  }
}

function getStoredSoundsPreference() {
  try {
    return window.localStorage.getItem(SOUNDS_STORAGE_KEY) === "true";
  } catch (_error) {
    return false;
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
    window.localStorage.setItem(ACTIVE_SECTION_STORAGE_KEY, String(activeSection));
  } catch (_error) {
    // noop
  }
}

function storeThemePreference() {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, currentTheme);
  } catch (_error) {
    // noop
  }
}

function storeSoundsPreference() {
  try {
    window.localStorage.setItem(SOUNDS_STORAGE_KEY, String(uiSoundsEnabled));
  } catch (_error) {
    // noop
  }
}

function applyTheme(theme) {
  currentTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.classList.remove("theme-light", "theme-dark");
  document.documentElement.classList.add(`theme-${currentTheme}`);
}

function syncThemeToggleState() {
  if (!themeToggleButton) {
    return;
  }

  themeToggleButton.setAttribute("aria-pressed", String(currentTheme === "dark"));
  if (themeToggleLabel) {
    themeToggleLabel.textContent = currentTheme === "dark" ? "Tema oscuro" : "Tema claro";
  }

  const useNode = themeToggleIcon?.querySelector("use");
  if (useNode) {
    useNode.setAttribute("href", currentTheme === "dark" ? "#icon-sun" : "#icon-moon");
  }
}

function syncSoundToggleState() {
  if (!soundToggleButton) {
    return;
  }

  soundToggleButton.setAttribute("aria-pressed", String(uiSoundsEnabled));
  soundToggleButton.classList.toggle("active", uiSoundsEnabled);
  if (soundToggleLabel) {
    soundToggleLabel.textContent = uiSoundsEnabled ? "Sonidos suaves: activos" : "Sonidos suaves: apagados";
  }

  const useNode = soundToggleIcon?.querySelector("use");
  if (useNode) {
    useNode.setAttribute("href", uiSoundsEnabled ? "#icon-volume-2" : "#icon-volume-x");
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

  syncChatWorkspaceState();
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

function getConversationSnapshot(conversationListItems) {
  return new Map((conversationListItems || []).map((conversation) => [conversation.phone, JSON.stringify({
    lastMessage: conversation.lastMessage || "",
    lastMessageAt: conversation.lastMessageAt || "",
    lastMessageDirection: conversation.lastMessageDirection || "",
    unread: getUnreadCount(conversation)
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

function getOrCreateAudioContext() {
  if (audioContext) {
    return audioContext;
  }

  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) {
    return null;
  }

  audioContext = new Context();
  return audioContext;
}

function showAudioActivationHint() {
  if (audioActivationHintShown) {
    return;
  }

  audioActivationHintShown = true;
  showToast("Haz clic en el panel para activar sonidos.", "info");
}

async function ensureAudioContextReady({ userGesture = false } = {}) {
  const context = getOrCreateAudioContext();
  if (!context) {
    return null;
  }

  if (context.state === "running") {
    audioActivationHintShown = false;
    return context;
  }

  if (context.state === "closed") {
    return null;
  }

  try {
    await context.resume();
  } catch (_error) {
    if (!userGesture) {
      showAudioActivationHint();
    }
    return null;
  }

  if (context.state === "running") {
    audioActivationHintShown = false;
    return context;
  }

  if (!userGesture) {
    showAudioActivationHint();
  }

  return null;
}

function scheduleSoftTone(context, type = "conversation") {
  const start = context.currentTime + 0.01;
  const frequencies = type === "order" ? [587, 740] : [494, 659];
  const gainNode = context.createGain();
  gainNode.gain.setValueAtTime(0.0001, start);
  gainNode.gain.exponentialRampToValueAtTime(0.02, start + 0.03);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, start + 0.34);
  gainNode.connect(context.destination);

  frequencies.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start + index * 0.04);
    oscillator.connect(gainNode);
    oscillator.start(start + index * 0.04);
    oscillator.stop(start + 0.34 + index * 0.02);
  });
}

function playSoftTone(type = "conversation") {
  if (!uiSoundsEnabled) {
    return;
  }

  const context = getOrCreateAudioContext();
  if (!context) {
    return;
  }

  if (context.state === "running") {
    audioActivationHintShown = false;
    scheduleSoftTone(context, type);
    return;
  }

  ensureAudioContextReady()
    .then((readyContext) => {
      if (readyContext) {
        scheduleSoftTone(readyContext, type);
      }
    })
    .catch(() => undefined);
}

function primeAudioPlayback() {
  if (!uiSoundsEnabled) {
    return;
  }

  ensureAudioContextReady({ userGesture: true }).catch(() => undefined);
}

function toggleUiSounds() {
  uiSoundsEnabled = !uiSoundsEnabled;
  storeSoundsPreference();
  syncSoundToggleState();
  renderSettings();

  if (uiSoundsEnabled) {
    primeAudioPlayback();
  }

  showToast(uiSoundsEnabled ? "Sonidos suaves activados." : "Sonidos suaves desactivados.", "info");
}

function notifyOrderChanges(nextOrders, previousSnapshot) {
  const nextSnapshot = getOrderSnapshot(nextOrders);
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
  }

  lastOrdersSnapshot = nextSnapshot;

  if (newOrders.length) {
    showToast(newOrders.length === 1 ? "Nuevo pedido recibido" : `${newOrders.length} pedidos nuevos recibidos`, "success");
    playSoftTone("order");
  } else if (statusChanged) {
    showToast("Pedidos actualizados automáticamente.", "info");
  }
}

function notifyConversationChanges(nextConversations, previousSnapshot) {
  const nextSnapshot = getConversationSnapshot(nextConversations);
  let newConversationCount = 0;
  let newInboundMessages = 0;

  for (const conversation of nextConversations) {
    if (!previousSnapshot.has(conversation.phone)) {
      newConversationCount += 1;
      continue;
    }

    const previousValue = previousSnapshot.get(conversation.phone);
    const nextValue = nextSnapshot.get(conversation.phone);
    if (previousValue !== nextValue && getUnreadCount(conversation)) {
      newInboundMessages += 1;
    }
  }

  lastConversationSnapshot = nextSnapshot;

  if (newConversationCount) {
    showToast(newConversationCount === 1 ? "Nueva conversación en Abi" : `${newConversationCount} conversaciones nuevas`, "info");
    playSoftTone("conversation");
    return;
  }

  if (newInboundMessages) {
    showToast(newInboundMessages === 1 ? "Nuevo mensaje en Abi" : `${newInboundMessages} mensajes nuevos en Abi`, "info");
    playSoftTone("conversation");
  }
}

function startOrdersAutoRefresh() {
  stopOrdersAutoRefresh();
  ordersAutoRefreshHandle = window.setInterval(() => {
    loadOrders({ silent: true, source: "poll" });
  }, ORDERS_REFRESH_MS);
  conversationsAutoRefreshHandle = window.setInterval(() => {
    loadConversations({ silent: true, source: "poll" });
  }, CONVERSATIONS_REFRESH_MS);
  ordersRefreshMetaHandle = window.setInterval(updateOrdersRefreshMeta, 1000);
}

function handleOrdersAutoRefreshVisibility() {
  if (document.hidden) {
    stopOrdersAutoRefresh();
    return;
  }

  startOrdersAutoRefresh();
  loadOrders({ silent: true, source: "poll" });
  loadConversations({ silent: true, source: "poll" });
}

function stopOrdersAutoRefresh() {
  if (ordersAutoRefreshHandle) {
    window.clearInterval(ordersAutoRefreshHandle);
    ordersAutoRefreshHandle = null;
  }
  if (conversationsAutoRefreshHandle) {
    window.clearInterval(conversationsAutoRefreshHandle);
    conversationsAutoRefreshHandle = null;
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

function hideAppLoader() {
  if (!appLoader) {
    return;
  }

  const elapsed = performance.now() - appBootStartedAt;
  const delay = Math.max(LOADER_MIN_VISIBLE_MS - elapsed, 0);
  window.setTimeout(() => {
    appLoader.classList.add("is-hidden");
    window.setTimeout(() => {
      appLoader.hidden = true;
    }, 260);
  }, delay);
}

function setLoadingState() {
  ordersTableBody.innerHTML = Array.from({ length: 5 }).map(() => `
    <tr>
      <td colspan="7"><div class="skeleton" style="height: 54px;"></div></td>
    </tr>
  `).join("");

  conversationList.innerHTML = Array.from({ length: 5 }).map(() => `
    <div class="conversation-item conversation-skeleton"><div class="skeleton" style="height: 82px;"></div></div>
  `).join("");

  chatMessages.className = "chat-messages";
  chatMessages.innerHTML = Array.from({ length: 4 }).map((_, index) => `
    <div class="message-row ${index % 2 === 0 ? "in" : "out"}"><div class="skeleton" style="height: 76px; width: ${index % 2 === 0 ? "68%" : "56%"}; border-radius: 22px;"></div></div>
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

function getCustomerById(customerId) {
  return customers.find((item) => item.id === customerId) || null;
}

function showCustomersFeedback(message, type = "success") {
  if (!customersFeedback) {
    return;
  }

  customersFeedback.textContent = message;
  customersFeedback.className = `feedback ${type}`;
  customersFeedback.hidden = false;
}

function hideCustomersFeedback() {
  if (!customersFeedback) {
    return;
  }

  customersFeedback.hidden = true;
  customersFeedback.textContent = "";
  customersFeedback.className = "feedback";
}

function resetCustomerForm() {
  selectedCustomerId = null;
  if (customerForm) {
    customerForm.reset();
  }
  if (customerIdInput) customerIdInput.value = "";
  if (customerTypeInput) customerTypeInput.value = "public";
  if (customerFormTitle) customerFormTitle.textContent = "Nuevo cliente";
  if (customerSubmitButton) customerSubmitButton.textContent = "Guardar cliente";
  hideCustomersFeedback();
}

function fillCustomerForm(customer) {
  if (!customer) {
    resetCustomerForm();
    return;
  }

  selectedCustomerId = customer.id;
  customerIdInput.value = customer.id || "";
  customerNameInput.value = customer.name || "";
  customerPhoneInput.value = customer.phone || "";
  customerTypeInput.value = customer.customerType || "public";
  customerNotesInput.value = customer.notes || "";
  customerFormTitle.textContent = `Editar ${customer.name || "cliente"}`;
  customerSubmitButton.textContent = "Guardar cambios";
  hideCustomersFeedback();
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
          : `<span class="helper-text">Sin pagos registrados todavía.</span>`}
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
      <h3>Branding final</h3>
      <p class="report-copy">Tellolac AI · Powered by Abi listo para demo comercial.</p>
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
      <p class="setting-copy">Tellolac AI · Powered by Abi</p>
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
    <article class="setting-card setting-card-action">
      <div>
        <h3>Sonidos premium</h3>
        <p class="setting-copy">${uiSoundsEnabled ? "Activos para nuevos pedidos y conversaciones." : "Apagados. Puedes activarlos cuando quieras."}</p>
      </div>
      <button type="button" class="secondary small-action" data-toggle-sounds>${uiSoundsEnabled ? "Desactivar" : "Activar"}</button>
    </article>
    <article class="setting-card">
      <h3>Pedidos visibles</h3>
      <p class="setting-copy">${summary.totalOrders || 0} pedido(s) activos hoy</p>
    </article>
  `;
}

function renderCustomers() {
  if (customersMeta) {
    customersMeta.textContent = `${customers.length} cliente(s) ${customerSearchQuery.trim() ? "filtrados" : "registrados"}`;
  }

  if (!customersList) {
    return;
  }

  if (!customers.length) {
    customersList.innerHTML = renderEmptyState({ iconName: "users", title: "Sin clientes registrados", copy: "Aquí podrás administrar clientes directos y distribuidores." });
    return;
  }

  customersList.innerHTML = customers.map((customer) => {
    const isSelected = customer.id === selectedCustomerId;
    return `
      <article class="customer-card ${isSelected ? "active" : ""}" data-customer-id="${escapeHtml(customer.id)}">
        <div class="customer-card-top">
          <div>
            <div class="customer-name">${escapeHtml(customer.name || "Cliente sin nombre")}</div>
            <div class="customer-subline">${escapeHtml(customer.phone || "Sin teléfono")}</div>
          </div>
          <span class="${escapeHtml(getCustomerTypeBadgeClass(customer.customerType))}">${escapeHtml(formatCustomerTypeLabel(customer.customerType))}</span>
        </div>
        <div class="customer-card-meta">
          <span class="mini-pill">${escapeHtml(formatCustomerStatusLabel(customer.isActive))}</span>
          <span class="helper-text">Actualizado ${escapeHtml(formatDate(customer.updatedAt || customer.createdAt))}</span>
        </div>
        ${customer.notes ? `<p class="helper-text customer-notes">${escapeHtml(customer.notes)}</p>` : ""}
        <div class="customer-card-actions">
          <button type="button" class="secondary small-action" data-edit-customer="${escapeHtml(customer.id)}">Editar</button>
          <button type="button" class="secondary small-action" data-toggle-customer="${escapeHtml(customer.id)}" data-next-active="${customer.isActive ? "false" : "true"}">${customer.isActive ? "Desactivar" : "Activar"}</button>
          <button type="button" class="secondary ghost small-action" data-delete-customer="${escapeHtml(customer.id)}">Eliminar</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderOrders() {
  if (!orders.length) {
    ordersTableBody.innerHTML = `<tr><td colspan="6">${renderEmptyState({ iconName: "box", title: "Todo tranquilo por ahora 😊", copy: "Abi mostrará aquí los nuevos pedidos cuando lleguen.", compact: true })}</td></tr>`;
    return;
  }

  ordersTableBody.innerHTML = orders.map((order) => {
    const activeClass = order.id === selectedOrderId ? "active" : "";
    const badgeClass = order.estado.replace(/\s+/g, "-");
    const { countLabel, previewLabel, extraLabel } = formatCompactOrderSummary(order);
    const avatar = buildAvatarLabel(order);
    const statusLabel = getStatusLabel(order.estado);
    const paymentVariant = getPaymentVariant(order.metodoPago);
    const customerTierLabel = formatCustomerTypeLabel(order.customerTypeApplied || order.priceTierApplied);

    return `
      <tr data-order-id="${escapeHtml(order.id)}" class="${activeClass}">
        <td data-label="Cliente">
          <div class="customer-cell">
            <span class="customer-avatar">${escapeHtml(avatar)}</span>
            <div class="order-cell-stack">
              <div class="customer-name">${escapeHtml(order.cliente || "Cliente sin nombre")}</div>
              <div class="customer-subline">${escapeHtml(order.telefono || "Sin teléfono")}</div>
              <div class="inline-micro-meta">
                <span class="mini-pill">${icon("message-circle", "ui-icon mini-icon")} Chat activo</span>
                <span class="mini-pill">${escapeHtml(customerTierLabel)}</span>
              </div>
            </div>
          </div>
        </td>
        <td data-label="Pedido resumido">
          <div class="order-cell-stack order-summary-cell">
            <div class="summary-count">${escapeHtml(countLabel)}</div>
            <div class="summary-preview multiline-clamp">${escapeHtml(previewLabel || "Sin detalle")}</div>
            ${extraLabel ? `<div class="summary-extra">${escapeHtml(extraLabel)}</div>` : ""}
          </div>
        </td>
        <td data-label="Pago">
          <div class="order-cell-stack compact-gap">
            <div class="cell-kicker">Pago</div>
            <span class="payment-pill ${paymentVariant}">${icon("wallet", "ui-icon mini-icon")} ${escapeHtml(order.metodoPago || "Sin definir")}</span>
          </div>
        </td>
        <td data-label="Total">
          <div class="order-cell-stack compact-gap">
            <span class="total-pill">${icon("badge-check", "ui-icon mini-icon")} ${escapeHtml(formatCurrency(order.total || 0))}</span>
            <div class="customer-subline">Pedido #${escapeHtml(order.id)}</div>
          </div>
        </td>
        <td data-label="Estado"><span class="badge ${badgeClass}">${escapeHtml(statusLabel)}</span></td>
        <td data-label="Acción">
          <div class="row-actions">
            <button class="secondary small-action" data-open-order-detail="${escapeHtml(order.id)}">Ver detalle</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderDetail() {
  const order = getOrderById(selectedOrderId);

  if (!order) {
    orderDetailTitle.textContent = "Pedido";
    orderDetailStatusSelect.value = "pendiente";
    orderDetailStatusSelect.dataset.currentStatus = "";
    syncOrderDetailSaveState();
    orderDetail.innerHTML = renderEmptyState({ iconName: "clipboard-list", title: "No hay pedido seleccionado", copy: "Elige un pedido de la tabla para ver su detalle completo." });
    return;
  }

  const dateMeta = formatDateTimeStack(order.fechaRegistro);
  const customerTierLabel = formatCustomerTypeLabel(order.customerTypeApplied || order.priceTierApplied);
  const orderCustomizations = formatCustomizationList(order.customizations);
  const itemsHtml = (order.items || []).length
    ? order.items.map((item) => {
        const itemCustomizations = formatCustomizationList(item.customizations);
        const itemNotes = [item.productNotes || item.product_notes || null, ...itemCustomizations].filter(Boolean);
        return `
          <div class="item-row premium-item-row detail-product-row">
            <div>
              <strong>• ${escapeHtml([item.cantidad ?? "?", item.producto || "Producto", item.sabor || null].filter(Boolean).join(" "))} — ${escapeHtml(formatCurrency(item.subtotal || 0))}</strong>
              <div class="helper-text">Unitario: ${escapeHtml(formatCurrency(item.precioUnitario || item.precio_unitario || 0))} · Fuente: ${escapeHtml(formatCustomerTypeLabel(item.priceSource || item.price_source))}</div>
              ${itemNotes.map((note) => `<div class="helper-text">${escapeHtml(String(note).startsWith("Nota:") ? note : `Nota: ${note}`)}</div>`).join("")}
            </div>
          </div>
        `;
      }).join("")
    : "<p class=\"helper-text\">No hay detalle de productos disponible.</p>";

  const statusLabel = getStatusLabel(order.estado);
  const paymentVariant = getPaymentVariant(order.metodoPago);
  orderDetailTitle.textContent = `Pedido #${order.id || ""}`;
  orderDetailStatusSelect.value = order.estado || "pendiente";
  orderDetailStatusSelect.dataset.currentStatus = order.estado || "pendiente";
  syncOrderDetailSaveState();

  orderDetail.innerHTML = `
    <div class="detail-grid">
      <div class="detail-card detail-hero-card">
        <div class="detail-hero-top">
          <div>
            <p class="eyebrow">Pedido activo</p>
            <h3>${escapeHtml(order.cliente || "Cliente sin nombre")}</h3>
            <p class="helper-text">${escapeHtml(order.telefono || "Sin teléfono registrado")}</p>
          </div>
          <div class="detail-total-highlight">
            <span>Total</span>
            <strong>${escapeHtml(formatCurrency(order.total || 0))}</strong>
          </div>
        </div>
        <div class="detail-chip-row">
          <span class="badge ${order.estado.replace(/\s+/g, "-")}">${escapeHtml(statusLabel)}</span>
          <span class="payment-pill ${paymentVariant}">${icon("wallet", "ui-icon mini-icon")} ${escapeHtml(order.metodoPago || "Sin definir")}</span>
          <span class="mini-pill">${escapeHtml(customerTierLabel)}</span>
          <span class="mini-pill">${icon("clock-3", "ui-icon mini-icon")} ${escapeHtml(dateMeta.date)} · ${escapeHtml(dateMeta.time)}</span>
        </div>
      </div>
      <div class="detail-card">
        <h3>${icon("shopping-bag")} Resumen</h3>
        <div class="meta-list premium-meta-list">
          <div class="meta-item"><span>Fecha y hora</span>${escapeHtml(`${dateMeta.date} · ${dateMeta.time}`)}</div>
          <div class="meta-item"><span>ID</span>${escapeHtml(order.id || "-")}</div>
          <div class="meta-item"><span>Cliente</span>${escapeHtml(order.cliente || "-")}</div>
          <div class="meta-item"><span>Teléfono</span>${escapeHtml(order.telefono || "-")}</div>
          <div class="meta-item"><span>Precio aplicado</span>${escapeHtml(customerTierLabel)}</div>
        </div>
      </div>
      <div class="detail-card">
        <h3>${icon("message-circle")} Entrega y pago</h3>
        <div class="meta-list premium-meta-list">
          <div class="meta-item detail-address-block"><span>Dirección</span>${escapeHtml(order.direccion || "-")}</div>
          <div class="meta-item"><span>Método de pago</span><span class="payment-pill ${paymentVariant}">${icon("wallet", "ui-icon mini-icon")} ${escapeHtml(order.metodoPago || "-")}</span></div>
          <div class="meta-item"><span>Estado</span><span class="badge ${order.estado.replace(/\s+/g, "-")}">${escapeHtml(statusLabel)}</span></div>
          <div class="meta-item"><span>Fecha entrega</span>${escapeHtml(order.fechaEntrega || "Sin definir")}</div>
        </div>
      </div>
      <div class="detail-card">
        <h3>${icon("box")} Productos</h3>
        <div class="items-list">${itemsHtml}</div>
      </div>
      <div class="detail-card">
        <h3>${icon("file-text")} Observaciones</h3>
        ${renderCustomizationHtml(order.customizations)}
        ${order.notes ? `<p class="helper-text">${escapeHtml(order.notes)}</p>` : ""}
        ${order.observaciones ? `<p class="helper-text">${escapeHtml(order.observaciones)}</p>` : ""}
        ${!order.notes && !order.observaciones && !orderCustomizations.length ? '<p class="helper-text">Sin observaciones</p>' : ""}
      </div>
      <div class="detail-card">
        <h3>${icon("file-text")} Comprobante</h3>
        ${renderReceiptHtml(order.receipt)}
      </div>
    </div>
  `;
}

function renderConversationList() {
  if (!conversations.length) {
    conversationList.innerHTML = renderEmptyState({ iconName: "inbox", title: "Sin conversaciones todavía", copy: "Cuando un cliente escriba, aparecerá aquí." });
    return;
  }

  conversationList.innerHTML = conversations.map((conversation) => {
    const activeClass = conversation.phone === selectedPhone ? "active" : "";
    const customerName = buildConversationLabel(conversation);
    const avatar = buildAvatarLabel({ cliente: customerName, telefono: conversation.phone });
    const unreadCount = getUnreadCount(conversation);
    const whatsappState = healthState?.whatsappEnabled ? "Conectado" : "Simulado";

    return `
      <article class="conversation-item ${activeClass}" data-phone="${escapeHtml(conversation.phone)}">
        <div class="conversation-avatar-wrap">
          <span class="conversation-avatar">${escapeHtml(avatar)}</span>
          <span class="presence-dot ${healthState?.whatsappEnabled ? "is-online" : "is-idle"}"></span>
        </div>
        <div class="conversation-main">
          <div class="conversation-topline">
            <div class="conversation-phone">${escapeHtml(customerName)}</div>
            <span class="helper-text">${escapeHtml(formatTime(conversation.lastMessageAt))}</span>
          </div>
          <div class="conversation-meta-row">
            <span class="helper-text conversation-phone-sub">${escapeHtml(conversation.phone)}</span>
            <span class="helper-text">${escapeHtml(whatsappState)}</span>
          </div>
          <div class="conversation-bottomline">
            <div class="conversation-snippet">${escapeHtml(conversation.lastMessage || "Sin mensajes")}</div>
            ${unreadCount ? `<span class="unread-badge">${unreadCount}</span>` : ""}
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderChatHeader() {
  const conversation = getConversationByPhone(selectedPhone);

  if (!conversation) {
    chatContactAvatar.textContent = "AB";
    chatTitle.textContent = "Selecciona una conversación";
    chatSubtitle.textContent = "Cuando un cliente escriba, aparecerá aquí.";
    chatOrderSummary.innerHTML = `
      <div class="chat-header-side">
        <span class="badge light">${icon("circle-dot")} Abi online</span>
        <div class="chat-header-actions">
          <button type="button" class="secondary ghost icon-button" aria-label="Información futura">${icon("file-search")}</button>
          <button type="button" class="secondary ghost icon-button" aria-label="Acciones futuras">${icon("settings")}</button>
        </div>
      </div>
    `;
    chatMessageInput.disabled = true;
    sendMessageButton.disabled = true;
    syncChatWorkspaceState();
    return;
  }

  const customerName = buildConversationLabel(conversation);
  chatContactAvatar.textContent = buildAvatarLabel({ cliente: customerName, telefono: conversation.phone });
  chatTitle.textContent = customerName;
  chatSubtitle.textContent = healthState?.whatsappEnabled ? "En línea ahora" : "Seguimiento desde Abi";
  chatOrderSummary.innerHTML = `
    <div class="chat-header-side">
      <div class="chat-contact-meta">
        <span class="badge light">${icon("message-circle")} ${escapeHtml(conversation.phone || "Sin teléfono")}</span>
        <span class="badge light">${icon("circle-dot")} ${conversation.lastMessageDirection === "in" ? "Cliente activo" : "Abi respondió"}</span>
        <span class="badge light">${icon("clipboard-list")} Pedido: ${escapeHtml(conversation.lastOrderId || "ninguno")}</span>
      </div>
      <div class="chat-header-actions">
        <button type="button" class="secondary ghost icon-button" aria-label="Información futura">${icon("file-search")}</button>
        <button type="button" class="secondary ghost icon-button" aria-label="Acciones futuras">${icon("settings")}</button>
      </div>
    </div>
  `;
  chatMessageInput.disabled = false;
  sendMessageButton.disabled = false;
  syncChatWorkspaceState();
}

function renderMessages() {
  if (!selectedPhone) {
    chatMessages.className = "chat-messages empty-chat";
    chatMessages.innerHTML = renderEmptyState({ iconName: "bot", title: "Sin conversaciones todavía", copy: "Cuando un cliente escriba, aparecerá aquí." });
    syncChatWorkspaceState();
    return;
  }

  if (!activeMessages.length) {
    chatMessages.className = "chat-messages empty-chat";
    chatMessages.innerHTML = renderEmptyState({ iconName: "message-circle", title: "Sin mensajes", copy: "Esta conversación todavía no tiene historial." });
    syncChatWorkspaceState();
    return;
  }

  const hasMore = activeMessages.length > visibleMessagesLimit;
  const visibleMessages = hasMore ? activeMessages.slice(-visibleMessagesLimit) : activeMessages;
  const conversation = getConversationByPhone(selectedPhone);
  const customerName = buildConversationLabel(conversation);
  const customerAvatar = buildAvatarLabel({ cliente: customerName, telefono: selectedPhone });

  chatMessages.className = "chat-messages";
  chatMessages.innerHTML = `
    ${hasMore ? `<button type="button" class="secondary ghost load-older-button" id="loadOlderMessagesButton">Cargar mensajes anteriores</button>` : ""}
    ${visibleMessages.map((message) => {
      const isInbound = message.direction === "in";
      const actorLabel = isInbound ? customerAvatar : "AB";
      return `
        <div class="message-row ${escapeHtml(message.direction)}">
          <div class="message-cluster">
            <span class="message-avatar">${escapeHtml(actorLabel)}</span>
            <article class="message-bubble">
              <div class="message-text">${escapeHtml(message.messageText || "")}</div>
              <div class="message-meta compact-message-meta">
                <span>${escapeHtml(formatTime(message.createdAt))}</span>
                <span>${escapeHtml(isInbound ? "Cliente" : "Abi")}</span>
              </div>
            </article>
          </div>
        </div>
      `;
    }).join("")}
  `;

  const loadOlderButton = document.getElementById("loadOlderMessagesButton");
  loadOlderButton?.addEventListener("click", () => {
    visibleMessagesLimit += 40;
    renderMessages();
  }, { once: true });

  chatMessages.scrollTop = chatMessages.scrollHeight;
  syncChatWorkspaceState();
}

function renderHistory() {
  if (!historyClosures.length) {
    historyList.innerHTML = renderEmptyState({ iconName: "history", title: "No hay historial", copy: "Cuando cierres días operativos, se guardarán aquí para consulta y descarga." });
    historyDetail.innerHTML = renderEmptyState({ iconName: "file-search", title: "Sin detalle histórico", copy: "Selecciona un cierre guardado para revisar ventas, pagos y PDF." });
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
    historyDetail.innerHTML = renderEmptyState({ iconName: "file-search", title: "Sin detalle histórico", copy: "Selecciona un cierre guardado para revisar ventas, pagos y PDF." });
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
          <div class="meta-item"><span>Branding</span>Tellolac AI · Powered by Abi</div>
        </div>
        ${closure.downloadUrl ? `<div style="margin-top:12px;"><a class="primary" style="display:inline-flex;align-items:center;gap:8px;padding:12px 16px;text-decoration:none;" href="${escapeHtml(closure.downloadUrl)}">${icon("file-text")}Descargar PDF</a></div>` : ""}
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
            ? ordersList.map((order) => {
                const customizationText = formatCustomizationList(order.customizations).join(" · ");
                const receiptText = order.receipt?.path ? " · Comprobante recibido" : "";
                return `<div class="item-row"><strong>${escapeHtml(order.cliente || "Cliente sin nombre")}</strong><div class="helper-text">${escapeHtml(order.customerTypeLabel || formatCustomerTypeLabel(order.customerTypeApplied || order.priceTierApplied))} · ${escapeHtml(order.resumenItems || "Sin detalle")}</div>${customizationText ? `<div class="helper-text">${escapeHtml(customizationText)}</div>` : ""}${order.notes ? `<div class="helper-text">${escapeHtml(order.notes)}</div>` : ""}<div class="helper-text">${escapeHtml(formatCurrency(order.total || 0))}${escapeHtml(receiptText)}</div></div>`;
              }).join("")
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
        ${renderEmptyState({ iconName: "file-text", title: "No hay pedidos activos para cerrar hoy.", copy: "Cuando existan pedidos del día, aquí verás el resumen antes de confirmar el cierre." })}
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
    <p class="helper-text modal-note">Generaremos el reporte PDF y limpiaremos el panel operativo.</p>
  `;
}

function resetFinalizeModalState() {
  closeDaySummary.innerHTML = "";
  closeDayModal.hidden = true;
  closeDayModal.setAttribute("aria-hidden", "true");
  finalizeModalOpen = false;
  syncModalOpenState();
  confirmCloseDayButton.disabled = false;
}

function openFinalizeModal() {
  renderCloseDaySummary();
  closeDayModal.hidden = false;
  closeDayModal.setAttribute("aria-hidden", "false");
  finalizeModalOpen = true;
  syncModalOpenState();
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
      ordersTableBody.innerHTML = `<tr><td colspan="6">${renderEmptyState({ iconName: "box", title: "No fue posible cargar los pedidos", copy: error.message, compact: true })}</td></tr>`;
      orderDetail.innerHTML = renderEmptyState({ iconName: "file-search", title: "Sin detalle disponible", copy: error.message });
      showFeedback(error.message, "error");
    }
  } finally {
    if (source === "poll") {
      ordersPollingInFlight = false;
    }
  }
}

async function loadConversations(options = {}) {
  const { silent = false, source = "manual" } = options;
  const query = conversationSearchQuery.trim();
  const requestQuery = query ? `?q=${encodeURIComponent(query)}` : "";
  const previousSnapshot = lastConversationSnapshot;

  if (source === "poll" && conversationsPollingInFlight) {
    return;
  }

  if (source === "poll") {
    conversationsPollingInFlight = true;
  }

  if (!silent) {
    conversationMeta.textContent = "Cargando conversaciones...";
  }

  try {
    const response = await fetch(`/conversations${requestQuery}`, { cache: "no-store" });
    const payload = await response.json();

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (!response.ok || !payload.ok) {
      throw new Error(payload.detalle || payload.error || "No se pudieron cargar las conversaciones");
    }

    conversations = payload.conversations || [];
    conversationMeta.textContent = `${payload.total || conversations.length} conversación(es) ${query ? "filtradas" : "activas"}`;

    if (!conversations.some((conversation) => conversation.phone === selectedPhone)) {
      selectedPhone = MOBILE_LAYOUT.matches ? null : (conversations[0]?.phone || null);
    }

    if (activeSection !== "chat" && !MOBILE_LAYOUT.matches && !selectedPhone && conversations[0]?.phone) {
      selectedPhone = conversations[0].phone;
    }

    renderConversationList();

    if (selectedPhone) {
      await loadMessages(selectedPhone, { silent });
    } else {
      activeMessages = [];
      renderChatHeader();
      renderMessages();
    }

    if (silent && previousSnapshot.size) {
      notifyConversationChanges(conversations, previousSnapshot);
    } else {
      lastConversationSnapshot = getConversationSnapshot(conversations);
    }
  } catch (error) {
    if (!silent) {
      conversations = [];
      selectedPhone = null;
      activeMessages = [];
      conversationMeta.textContent = "No se pudieron cargar conversaciones";
      conversationList.innerHTML = renderEmptyState({ iconName: "message-circle", title: "No fue posible cargar la bandeja", copy: error.message });
      renderChatHeader();
      renderMessages();
      showChatFeedback(error.message, "error");
    }
  } finally {
    if (source === "poll") {
      conversationsPollingInFlight = false;
    }
  }
}

async function loadMessages(phone, options = {}) {
  const { silent = false } = options;
  visibleMessagesLimit = 60;
  chatMessages.className = "chat-messages";
  chatMessages.innerHTML = Array.from({ length: 3 }).map((_, index) => `
    <div class="message-row ${index % 2 === 0 ? "in" : "out"}"><div class="skeleton" style="height: 76px; width: ${index % 2 === 0 ? "68%" : "54%"}; border-radius: 22px;"></div></div>
  `).join("");

  try {
    const response = await fetch(`/conversations/${encodeURIComponent(phone)}/messages`, { cache: "no-store" });
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
    if (!silent) {
      showChatFeedback(error.message, "error");
    }
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
    historyList.innerHTML = renderEmptyState({ iconName: "history", title: "No existe historial", copy: error.message });
    historyDetail.innerHTML = renderEmptyState({ iconName: "file-search", title: "Historial no disponible", copy: "No fue posible cargar el historial." });
  }
}

async function loadHealth() {
  try {
    const response = await fetch("/health", { cache: "no-store" });
    const payload = await response.json();
    if (response.ok && payload.ok) {
      healthState = payload;
      renderSettings();
      renderConversationList();
      renderChatHeader();
    }
  } catch (_error) {
    // noop
  }
}

async function loadCustomers(options = {}) {
  const { silent = false } = options;
  const query = customerSearchQuery.trim();
  const requestQuery = query ? `?q=${encodeURIComponent(query)}` : "";

  if (!silent && customersMeta) {
    customersMeta.textContent = "Cargando clientes...";
  }

  try {
    const response = await fetch(`/admin/customers${requestQuery}`, { cache: "no-store" });
    const payload = await response.json();

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (!response.ok || !payload.ok) {
      throw new Error(payload.detalle || payload.error || "No se pudieron cargar los clientes");
    }

    customers = payload.customers || [];
    if (selectedCustomerId && !customers.some((customer) => customer.id === selectedCustomerId)) {
      resetCustomerForm();
    }
    renderCustomers();
  } catch (error) {
    customers = [];
    renderCustomers();
    if (!silent) {
      showCustomersFeedback(error.message, "error");
    }
  }
}

async function submitCustomerForm(event) {
  event.preventDefault();
  hideCustomersFeedback();

  const payload = {
    name: customerNameInput?.value?.trim() || "",
    phone: customerPhoneInput?.value?.trim() || "",
    customerType: customerTypeInput?.value || "public",
    notes: customerNotesInput?.value?.trim() || ""
  };

  customerSubmitButton.disabled = true;

  try {
    const isEdit = Boolean(customerIdInput?.value);
    const response = await fetch(isEdit ? `/admin/customers/${encodeURIComponent(customerIdInput.value)}` : "/admin/customers", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (!response.ok || !result.ok) {
      throw new Error(result.detalle || result.error || "No se pudo guardar el cliente");
    }

    showCustomersFeedback(isEdit ? "Cliente actualizado correctamente." : "Cliente creado correctamente.", "success");
    showToast(isEdit ? "Cliente actualizado." : "Cliente creado.", "success");
    resetCustomerForm();
    await loadCustomers({ silent: true });
  } catch (error) {
    showCustomersFeedback(error.message, "error");
    showToast(error.message, "error");
  } finally {
    customerSubmitButton.disabled = false;
  }
}

async function updateCustomerStatus(customerId, isActive) {
  hideCustomersFeedback();

  try {
    const response = await fetch(`/admin/customers/${encodeURIComponent(customerId)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive })
    });
    const result = await response.json();

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (!response.ok || !result.ok) {
      throw new Error(result.detalle || result.error || "No se pudo actualizar el cliente");
    }

    showToast(isActive ? "Cliente activado." : "Cliente desactivado.", "success");
    await loadCustomers({ silent: true });
  } catch (error) {
    showCustomersFeedback(error.message, "error");
    showToast(error.message, "error");
  }
}

async function removeCustomer(customerId) {
  hideCustomersFeedback();

  try {
    const response = await fetch(`/admin/customers/${encodeURIComponent(customerId)}`, { method: "DELETE" });
    const result = await response.json();

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (!response.ok || !result.ok) {
      throw new Error(result.detalle || result.error || "No se pudo eliminar el cliente");
    }

    showToast("Cliente eliminado.", "success");
    resetCustomerForm();
    await loadCustomers({ silent: true });
  } catch (error) {
    showCustomersFeedback(error.message, "error");
    showToast(error.message, "error");
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
    syncOrderDetailSaveState();
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
    chatMessageInput.style.height = "auto";
    showChatFeedback(payload.delivery?.simulated ? "Mensaje guardado y envío simulado correctamente." : "Mensaje enviado correctamente.", "success");
    showToast("Mensaje enviado desde Chat de Abi.", "success");
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
    await Promise.all([loadOrders(), loadConversations(), loadHistory(), loadHealth(), loadCustomers()]);
  } finally {
    closeDayButton.disabled = false;
    hideAppLoader();
  }
}

document.addEventListener("click", (event) => {
  const openDetailButton = event.target.closest("button[data-open-order-detail]");
  if (openDetailButton) {
    openOrderDetailModal(openDetailButton.dataset.openOrderDetail);
    return;
  }

  const row = event.target.closest("tr[data-order-id]");
  if (row && !event.target.closest("button") && !event.target.closest("select")) {
    openOrderDetailModal(row.dataset.orderId);
    return;
  }

  const conversationItem = event.target.closest(".conversation-item[data-phone]");
  if (conversationItem) {
    selectedPhone = conversationItem.dataset.phone;
    hideChatFeedback();
    loadMessages(selectedPhone);
    renderConversationList();
    if (activeSection !== "chat") {
      showSection("chat");
    }
    syncChatWorkspaceState();
    return;
  }

  const historyCard = event.target.closest(".history-card[data-closure-id]");
  if (historyCard && !event.target.closest("a")) {
    selectedClosureId = historyCard.dataset.closureId;
    renderHistory();
    return;
  }

  const customerCard = event.target.closest(".customer-card[data-customer-id]");
  if (customerCard && !event.target.closest("button")) {
    fillCustomerForm(getCustomerById(customerCard.dataset.customerId));
    renderCustomers();
    return;
  }

  const editCustomerButton = event.target.closest("button[data-edit-customer]");
  if (editCustomerButton) {
    fillCustomerForm(getCustomerById(editCustomerButton.dataset.editCustomer));
    renderCustomers();
    return;
  }

  const toggleCustomerButton = event.target.closest("button[data-toggle-customer]");
  if (toggleCustomerButton) {
    updateCustomerStatus(toggleCustomerButton.dataset.toggleCustomer, toggleCustomerButton.dataset.nextActive === "true");
    return;
  }

  const deleteCustomerButton = event.target.closest("button[data-delete-customer]");
  if (deleteCustomerButton) {
    const customer = getCustomerById(deleteCustomerButton.dataset.deleteCustomer);
    const shouldDelete = window.confirm(`¿Eliminar a ${customer?.name || "este cliente"}? Esta acción no se puede deshacer.`);
    if (shouldDelete) {
      removeCustomer(deleteCustomerButton.dataset.deleteCustomer);
    }
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
    return;
  }

  if (event.target.closest("[data-toggle-sounds]")) {
    toggleUiSounds();
  }
});

sidebarToggle?.addEventListener("click", toggleSidebar);
sidebarBackdrop?.addEventListener("click", closeMobileSidebar);
MOBILE_LAYOUT.addEventListener("change", () => {
  mobileSidebarOpen = false;
  syncSidebarState();
  syncChatWorkspaceState();
});

statusFilter.addEventListener("change", () => {
  hideFeedback();
  loadOrders();
});

conversationSearchInput?.addEventListener("input", (event) => {
  window.clearTimeout(conversationSearchDebounce);
  conversationSearchQuery = event.target.value || "";
  conversationSearchDebounce = window.setTimeout(() => {
    loadConversations();
  }, 220);
});

customerSearchInput?.addEventListener("input", (event) => {
  window.clearTimeout(customerSearchDebounce);
  customerSearchQuery = event.target.value || "";
  customerSearchDebounce = window.setTimeout(() => {
    loadCustomers();
  }, 220);
});

chatBackButton?.addEventListener("click", () => {
  selectedPhone = null;
  activeMessages = [];
  renderConversationList();
  renderChatHeader();
  renderMessages();
  syncChatWorkspaceState();
});

themeToggleButton?.addEventListener("click", () => {
  applyTheme(currentTheme === "dark" ? "light" : "dark");
  storeThemePreference();
  syncThemeToggleState();
  showToast(currentTheme === "dark" ? "Tema oscuro activado." : "Tema claro activado.", "info");
});

soundToggleButton?.addEventListener("click", toggleUiSounds);

document.addEventListener("pointerdown", primeAudioPlayback, { passive: true });
document.addEventListener("keydown", primeAudioPlayback);

closeDayButton?.addEventListener("click", openFinalizeModal);
closeModalButton?.addEventListener("click", closeFinalizeModal);
cancelCloseDayButton?.addEventListener("click", closeFinalizeModal);
confirmCloseDayButton?.addEventListener("click", confirmCloseDay);
orderDetailCloseButton?.addEventListener("click", closeOrderDetailModal);
orderDetailSaveButton?.addEventListener("click", () => {
  if (!selectedOrderId || orderDetailSaveButton.disabled) {
    return;
  }

  updateOrderStatus(selectedOrderId, orderDetailStatusSelect.value, orderDetailSaveButton);
});
orderDetailStatusSelect?.addEventListener("change", syncOrderDetailSaveState);
closeDayModal?.addEventListener("click", (event) => {
  if (event.target === closeDayModal) {
    closeFinalizeModal();
  }
});
orderDetailModal?.addEventListener("click", (event) => {
  if (event.target === orderDetailModal) {
    closeOrderDetailModal();
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

  if (orderDetailModalOpen) {
    closeOrderDetailModal();
    return;
  }

  if (MOBILE_LAYOUT.matches && selectedPhone) {
    selectedPhone = null;
    activeMessages = [];
    renderConversationList();
    renderChatHeader();
    renderMessages();
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
document.addEventListener("visibilitychange", handleOrdersAutoRefreshVisibility);

chatMessageInput?.addEventListener("input", () => {
  chatMessageInput.style.height = "auto";
  chatMessageInput.style.height = `${Math.min(chatMessageInput.scrollHeight, 140)}px`;
});

chatComposer.addEventListener("submit", sendChatMessage);
customerForm?.addEventListener("submit", submitCustomerForm);
customerFormResetButton?.addEventListener("click", resetCustomerForm);

applyTheme(currentTheme);
initSidebarState();
initSectionState();
syncThemeToggleState();
syncSoundToggleState();
resetCustomerForm();
updateOrdersRefreshMeta();

(async () => {
  const authenticated = await initSessionGuard();
  if (authenticated) {
    await loadDashboard();
    startOrdersAutoRefresh();
  }
})();
