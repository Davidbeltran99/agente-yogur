const statusFilter = document.getElementById("statusFilter");
const refreshButton = document.getElementById("refreshButton");
const ordersTableBody = document.getElementById("ordersTableBody");
const orderDetail = document.getElementById("orderDetail");
const tableMeta = document.getElementById("tableMeta");
const feedback = document.getElementById("feedback");

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

const STATUS_OPTIONS = ["pendiente", "en proceso", "entregado", "cancelado"];
let orders = [];
let selectedOrderId = null;
let conversations = [];
let selectedPhone = null;
let activeMessages = [];

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatTime(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatOrderItemsSummary(order) {
  if (order?.resumenItems) {
    return order.resumenItems;
  }

  if (!Array.isArray(order?.items) || !order.items.length) {
    return "-";
  }

  return order.items
    .map((item) => [item.cantidad ?? "?", item.producto || "producto", item.sabor || null].filter(Boolean).join(" "))
    .join(", ");
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

function getConversationByPhone(phone) {
  return conversations.find((item) => item.phone === phone) || null;
}

function getOrderById(orderId) {
  return orders.find((item) => item.id === orderId) || null;
}

async function loadOrders() {
  const status = statusFilter.value;
  const query = status ? `?status=${encodeURIComponent(status)}` : "";

  tableMeta.textContent = "Cargando pedidos...";

  try {
    const response = await fetch(`/orders${query}`);
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.detalle || payload.error || "No se pudieron cargar los pedidos");
    }

    orders = payload.orders || [];
    tableMeta.textContent = `${payload.total || orders.length} pedido(s) cargado(s)`;

    if (!orders.some((order) => order.id === selectedOrderId)) {
      selectedOrderId = orders[0]?.id || null;
    }

    renderOrders();
    renderDetail();
    renderConversationList();
    renderChatHeader();
  } catch (error) {
    orders = [];
    selectedOrderId = null;
    tableMeta.textContent = "No se pudieron cargar pedidos";
    ordersTableBody.innerHTML = '<tr><td colspan="7" class="empty">No fue posible cargar los pedidos.</td></tr>';
    orderDetail.innerHTML = `<div class="detail-empty"><p>${escapeHtml(error.message)}</p></div>`;
    showFeedback(error.message, "error");
  }
}

async function loadConversations() {
  conversationMeta.textContent = "Cargando conversaciones...";

  try {
    const response = await fetch("/conversations");
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.detalle || payload.error || "No se pudieron cargar las conversaciones");
    }

    conversations = payload.conversations || [];
    conversationMeta.textContent = `${payload.total || conversations.length} conversación(es) activa(s)`;

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

function renderOrders() {
  if (!orders.length) {
    ordersTableBody.innerHTML = '<tr><td colspan="7" class="empty">No hay pedidos para este filtro.</td></tr>';
    return;
  }

  ordersTableBody.innerHTML = orders.map((order) => {
    const activeClass = order.id === selectedOrderId ? "active" : "";
    const badgeClass = order.estado.replace(/\s+/g, "-");
    const itemsSummary = formatOrderItemsSummary(order);

    return `
      <tr data-order-id="${escapeHtml(order.id)}" class="${activeClass}">
        <td>${escapeHtml(formatDate(order.fechaRegistro))}</td>
        <td>${escapeHtml(order.cliente || "Sin nombre")}</td>
        <td>${escapeHtml(itemsSummary)}</td>
        <td>${escapeHtml(order.direccion || "-")}</td>
        <td>${escapeHtml(order.metodoPago || "-")}</td>
        <td><span class="badge ${badgeClass}">${escapeHtml(order.estadoLabel || order.estado)}</span></td>
        <td>
          <div class="row-actions">
            <select data-status-select="${escapeHtml(order.id)}">
              ${STATUS_OPTIONS.map((status) => `
                <option value="${status}" ${order.estado === status ? "selected" : ""}>
                  ${status === "en proceso" ? "En proceso" : status.charAt(0).toUpperCase() + status.slice(1)}
                </option>`).join("")}
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
          <div class="helper-text">Producto: ${escapeHtml(item.producto || "-")}</div>
          <div class="helper-text">Sabor: ${escapeHtml(item.sabor || "-")}</div>
          <div class="helper-text">Cantidad: ${escapeHtml(String(item.cantidad ?? "-"))}</div>
          ${(item.precioUnitario ?? item.precio_unitario) !== null && (item.precioUnitario ?? item.precio_unitario) !== undefined ? `<div class="helper-text">Precio unitario: ${escapeHtml(String(item.precioUnitario ?? item.precio_unitario))}</div>` : ""}
          ${item.subtotal !== null && item.subtotal !== undefined ? `<div class="helper-text">Subtotal: ${escapeHtml(String(item.subtotal))}</div>` : ""}
        </div>
      `).join("")
    : '<p class="helper-text">No hay detalle de productos disponible.</p>';

  orderDetail.innerHTML = `
    <div class="detail-grid">
      <div class="detail-card">
        <h3>Resumen</h3>
        <div class="meta-list">
          <div class="meta-item"><span>ID</span>${escapeHtml(order.id)}</div>
          <div class="meta-item"><span>Cliente</span>${escapeHtml(order.cliente || "Sin nombre")}</div>
          <div class="meta-item"><span>Teléfono</span>${escapeHtml(order.telefono || "-")}</div>
          <div class="meta-item"><span>Fecha</span>${escapeHtml(formatDate(order.fechaRegistro))}</div>
          <div class="meta-item"><span>Estado</span>${escapeHtml(order.estadoLabel || order.estado)}</div>
          <div class="meta-item"><span>Detalle</span>${escapeHtml(formatOrderItemsSummary(order))}</div>
        </div>
      </div>

      <div class="detail-card">
        <h3>Entrega y pago</h3>
        <div class="meta-list">
          <div class="meta-item"><span>Dirección</span>${escapeHtml(order.direccion || "-")}</div>
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
          <span class="badge light">Último msg pedido: ${escapeHtml(conversation.lastMessageOrderId || "ninguno")}</span>
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
    chatComposer.querySelector("textarea").disabled = true;
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
  chatComposer.querySelector("textarea").disabled = false;
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

async function updateOrderStatus(orderId, nextStatus, button) {
  button.disabled = true;
  hideFeedback();

  try {
    const response = await fetch(`/orders/${encodeURIComponent(orderId)}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status: nextStatus })
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.detalle || payload.error || "No se pudo actualizar el estado");
    }

    showFeedback(`Estado actualizado a ${payload.order?.estadoLabel || nextStatus}.`, "success");
    await loadOrders();
  } catch (error) {
    showFeedback(error.message, "error");
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
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message })
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.detalle || payload.error || "No se pudo enviar el mensaje");
    }

    chatMessageInput.value = "";
    showChatFeedback(payload.delivery?.simulated
      ? "Mensaje guardado y envío simulado correctamente."
      : "Mensaje enviado correctamente.", "success");
    await loadConversations();
  } catch (error) {
    showChatFeedback(error.message, "error");
  } finally {
    sendMessageButton.disabled = false;
  }
}

async function loadDashboard() {
  refreshButton.disabled = true;
  hideFeedback();
  hideChatFeedback();

  try {
    await Promise.all([loadOrders(), loadConversations()]);
  } finally {
    refreshButton.disabled = false;
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

  const saveButton = event.target.closest("button[data-save-status]");
  if (!saveButton) {
    return;
  }

  const orderId = saveButton.dataset.saveStatus;
  const select = document.querySelector(`select[data-status-select="${CSS.escape(orderId)}"]`);
  const nextStatus = select?.value;

  if (!nextStatus) {
    showFeedback("Selecciona un estado válido.", "error");
    return;
  }

  updateOrderStatus(orderId, nextStatus, saveButton);
});

statusFilter.addEventListener("change", () => {
  hideFeedback();
  loadOrders();
});

refreshButton.addEventListener("click", () => {
  loadDashboard();
});

chatComposer.addEventListener("submit", sendChatMessage);

loadDashboard();
