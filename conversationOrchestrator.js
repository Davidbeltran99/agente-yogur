function clipText(value, max = 220) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function normalizeHistoryEntry(entry = {}) {
  return {
    role: entry.role || entry.direction || "system",
    intent: entry.intent || null,
    text: clipText(entry.text || entry.messageText || "", 220),
    messageType: entry.messageType || null,
    timestamp: entry.timestamp || entry.createdAt || null
  };
}

function summarizeProduct(item = {}) {
  const name = item.producto || item.product || item.nombre || item.label || null;
  if (!name) {
    return null;
  }

  return {
    name,
    quantity: Number(item.cantidad || item.quantity || 1) || 1,
    price: Number(item.precio_unitario || item.precioUnitario || item.price || item.unitPrice || 0) || 0,
    subtotal: Number(item.subtotal || 0) || 0,
    notes: item.product_notes || item.productNotes || item.notes || null,
    customizations: Array.isArray(item.customizations)
      ? item.customizations.slice(0, 5).map((customization) => ({
          key: customization?.key || null,
          label: customization?.label || null,
          value: customization?.value || null,
          text: customization?.text || null
        }))
      : []
  };
}

function summarizeOrder(order = null) {
  if (!order) {
    return null;
  }

  const products = Array.isArray(order.productos)
    ? order.productos.map(summarizeProduct).filter(Boolean)
    : Array.isArray(order.items)
      ? order.items.map(summarizeProduct).filter(Boolean)
      : [];

  return {
    id: order.id || null,
    customerName: order.cliente || null,
    address: order.direccion || null,
    paymentMethod: order.metodo_pago || order.metodoPago || null,
    notes: order.notes || null,
    observations: order.observaciones || null,
    status: order.estado || null,
    total: Number(order.total || 0) || 0,
    customerType: order.customer_type_applied || order.customerTypeApplied || order.price_tier_applied || order.priceTierApplied || null,
    products
  };
}

function normalizeCatalogProduct(product = {}) {
  const name = product.nombre || product.name || product.label || null;
  if (!name) {
    return null;
  }

  return {
    name,
    family: product.nombre_familia || product.family || null,
    presentation: product.presentacion || null,
    price: Number(product.precio ?? product.price ?? product.unitPrice ?? 0) || 0,
    priceLabel: product.priceLabel || null,
    customerType: product.customerType || null,
    score: Number(product.score || product.confidence || 0) || 0,
    source: product.source || null
  };
}

function collectRecentProducts({ activeOrder = null, pendingOrder = null, lastResolvedOrder = null, suggestions = [] } = {}) {
  const values = [
    ...(summarizeOrder(activeOrder)?.products || []),
    ...(summarizeOrder(pendingOrder)?.products || []),
    ...(summarizeOrder(lastResolvedOrder)?.products || []),
    ...((Array.isArray(suggestions) ? suggestions : []).map((item) => ({ name: item?.nombre || item?.name || item?.label || null })))
  ];

  const seen = new Set();
  return values.filter((item) => {
    const key = String(item?.name || "").trim().toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).slice(0, 10);
}

function summarizeState(state = {}) {
  return {
    lastIntent: state?.lastIntent || null,
    awaitingName: Boolean(state?.awaitingName),
    hasPendingOrder: Boolean(state?.pendingPedido),
    hasPendingClarification: Boolean(state?.pendingClarification),
    lastPaymentMethod: state?.lastPaymentMethod || null,
    lastProductReference: state?.lastProductReference?.nombre || null,
    recentImage: state?.lastImageContext
      ? {
          status: state.lastImageContext.status || null,
          timestamp: state.lastImageContext.timestamp || null,
          hasImage: true,
          hasVisionResult: Boolean(state.lastImageContext.analysis)
        }
      : null
  };
}

function estimateTokenUsage(payload) {
  const serialized = JSON.stringify(payload || {});
  return Math.max(1, Math.ceil(serialized.length / 4));
}

function buildConversationOrchestratorContext({
  currentMessage,
  messageType = "text",
  transcription = null,
  customerName = null,
  phone = null,
  customerType = "public",
  activeOrder = null,
  pendingOrder = null,
  lastResolvedOrder = null,
  recentSuggestions = [],
  relevantCatalog = [],
  recentMessages = [],
  state = null,
  address = null,
  paymentMethod = null,
  notes = null,
  customizations = [],
  businessHours = null,
  isAdmin = false,
  adminCommandAuthorized = false
} = {}) {
  const context = {
    currentMessage: {
      text: clipText(currentMessage, 420),
      messageType,
      transcription: transcription ? clipText(transcription, 420) : null
    },
    customer: {
      name: customerName,
      phone,
      type: customerType,
      isAdmin,
      adminCommandAuthorized
    },
    businessHours: businessHours || null,
    activeOrder: summarizeOrder(activeOrder),
    pendingOrder: summarizeOrder(pendingOrder),
    lastResolvedOrder: summarizeOrder(lastResolvedOrder),
    recentProducts: collectRecentProducts({
      activeOrder,
      pendingOrder,
      lastResolvedOrder,
      suggestions: recentSuggestions
    }),
    recentSuggestions: (Array.isArray(recentSuggestions) ? recentSuggestions : [])
      .map((item) => ({ name: item?.nombre || item?.name || item?.label || null }))
      .filter((item) => item.name)
      .slice(0, 10),
    relevantCatalog: (Array.isArray(relevantCatalog) ? relevantCatalog : [])
      .map(normalizeCatalogProduct)
      .filter(Boolean)
      .slice(0, 15),
    recentMessages: (Array.isArray(recentMessages) ? recentMessages : [])
      .map(normalizeHistoryEntry)
      .filter((item) => item.text)
      .slice(-5),
    state: summarizeState(state),
    knownData: {
      address: address || pendingOrder?.direccion || activeOrder?.direccion || null,
      paymentMethod: paymentMethod || pendingOrder?.metodo_pago || activeOrder?.metodo_pago || null,
      notes: notes || pendingOrder?.notes || activeOrder?.notes || null,
      customizations: Array.isArray(customizations) ? customizations.slice(0, 8) : []
    },
    responseStyle: {
      persona: "Abi",
      tone: ["calida", "natural", "comercial", "breve", "whatsapp"],
      hardRules: [
        "No inventar productos",
        "No inventar precios",
        "No inventar totales",
        "No inventar descuentos",
        "No inventar estados"
      ]
    }
  };

  return {
    context,
    tokenEstimate: estimateTokenUsage(context)
  };
}

module.exports = {
  buildConversationOrchestratorContext,
  estimateTokenUsage
};
