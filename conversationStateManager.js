function createDefaultConversationState({ customerName = null, customerType = "public", registeredCustomerId = null } = {}) {
  return {
    customerName,
    customerType,
    registeredCustomerId,
    pendingPedido: null,
    pendingClarification: null,
    lastPaymentMethod: null,
    lastProductReference: null,
    lastIntent: null,
    awaitingName: false,
    hasShownOrderGuide: false,
    lastSuggestedProducts: null,
    activeOrderContext: null,
    recentHistory: [],
    lastResolvedOrder: null
  };
}

function getConversationState(store, key, { customerName = null, customerType = "public", registeredCustomerId = null } = {}) {
  if (!key) {
    return createDefaultConversationState({ customerName, customerType, registeredCustomerId });
  }

  if (!store.has(key)) {
    store.set(key, createDefaultConversationState({ customerName, customerType, registeredCustomerId }));
  }

  return store.get(key);
}

function appendRecentHistory(state, entry, limit = 8) {
  if (!state || !entry) {
    return;
  }

  const current = Array.isArray(state.recentHistory) ? state.recentHistory : [];
  state.recentHistory = [...current, {
    role: entry.role || "system",
    intent: entry.intent || null,
    text: String(entry.text || "").trim().slice(0, 220),
    timestamp: entry.timestamp || Date.now()
  }].slice(-limit);
}

module.exports = {
  createDefaultConversationState,
  getConversationState,
  appendRecentHistory
};
