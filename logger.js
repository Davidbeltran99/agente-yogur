const ALLOWED_EVENTS = new Set([
  "server_started",
  "webhook_received",
  "order_saved",
  "order_rejected",
  "whatsapp_send_error",
  "owner_notify_error",
  "admin_notify_error",
  "MODEL_ACTIVE",
  "PROVIDER_ACTIVE",
  "model_used",
  "runtime_config_snapshot",
  "runtime_config_warning",
  "MODEL_ERROR",
  "INTENT_DETECTED",
  "RESPONSE_SOURCE",
  "ACTIVE_CONTEXT",
  "ACTIVE_ORDER_CONTEXT",
  "SUGGESTION_MEMORY",
  "PRODUCT_MEMORY",
  "PRODUCT_MATCH_CONFIDENCE",
  "FUZZY_MATCH_RESULT",
  "CONFIDENCE_LEVEL",
  "CONVERSATION_STATE",
  "MULTI_TURN_STATE",
  "LIST_ORDER_DETECTED",
  "PARSED_LINE_ITEMS",
  "ORDER_INTENT_CONFIDENCE",
  "missing_distributor_price",
  "SPECIAL_INSTRUCTION_DETECTED",
  "PRODUCT_NOTE_APPLIED",
  "SPECIAL_INSTRUCTION_SCOPE",
  "PRODUCT_FAMILY_LOCK",
  "FAMILY_CATALOG_FILTER",
  "PENDING_PRODUCT_RESOLVED",
  "PRODUCT_RESOLVER_INPUT",
  "PRODUCT_RESOLVER_CANDIDATES",
  "PRODUCT_RESOLVER_DECISION",
  "FULL_CATALOG_SCAN_STARTED",
  "FULL_CATALOG_SCAN_FINISHED",
  "CATALOG_ITEMS_SCANNED_COUNT",
  "MATCH_CANDIDATES",
  "FINAL_PRODUCT_MATCH",
  "IMAGE_REFERENCE_DETECTED",
  "LAST_IMAGE_CONTEXT_SET",
  "LAST_IMAGE_CONTEXT_FOUND",
  "IMAGE_MESSAGE_RECEIVED",
  "IMAGE_MEDIA_DOWNLOADED",
  "IMAGE_OCR_STARTED",
  "IMAGE_OCR_RESULT",
  "IMAGE_ORDER_PROCESS_STARTED",
  "IMAGE_ORDER_PROCESS_COMPLETED",
  "IMAGE_ORDER_PROCESS_FAILED",
  "IMAGE_ORDER_VALIDATED",
  "IMAGE_ORDER_UNCERTAIN",
  "AUDIO_MESSAGE_RECEIVED",
  "AUDIO_DOWNLOAD_STARTED",
  "AUDIO_DOWNLOAD_FINISHED",
  "AUDIO_TRANSCRIPTION_STARTED",
  "AUDIO_TRANSCRIPTION_SUCCESS",
  "AUDIO_TRANSCRIPTION_FAILED",
  "AUDIO_PIPELINE_ERROR",
  "FLOW_STATE_UPDATED"
]);

const EVENT_ALIASES = {
  post_webhook_route_entered: "webhook_received",
  db_save_completed: "order_saved",
  pedido_no_guardado: "order_rejected",
  intencion_detectada: "INTENT_DETECTED"
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
