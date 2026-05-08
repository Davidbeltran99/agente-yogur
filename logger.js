const ALLOWED_EVENTS = new Set([
  "server_started",
  "webhook_received",
  "order_saved",
  "order_rejected",
  "whatsapp_send_error",
  "owner_notify_error",
  "MODEL_ACTIVE",
  "model_used",
  "runtime_config_snapshot",
  "runtime_config_warning",
  "MODEL_ERROR"
]);

const EVENT_ALIASES = {
  post_webhook_route_entered: "webhook_received",
  db_save_completed: "order_saved",
  pedido_no_guardado: "order_rejected"
};

function getLogger(level = "info") {
  if (level === "error") {
    return console.error;
  }

  if (level === "warn") {
    return console.warn;
  }

  return console.log;
}

function structuredLog(event, details = {}, level = "info") {
  const normalizedEvent = EVENT_ALIASES[event] || event;
  if (!ALLOWED_EVENTS.has(normalizedEvent)) {
    return;
  }

  getLogger(level)(JSON.stringify({
    level,
    event: normalizedEvent,
    ...details
  }));
}

module.exports = {
  ALLOWED_EVENTS,
  structuredLog
};
