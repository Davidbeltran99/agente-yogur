require("dotenv").config();

const { createHash, createHmac, timingSafeEqual } = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { structuredLog } = require("./logger");
const { analizarImagenPedido, inferConversationIntent, procesarMensaje, generarRespuestaAbi, transcribirAudio, OPENAI_PROVIDER, OPENAI_MODEL, OPENAI_BASE_URL } = require("./ollama");
const {
  leerPedidosDesdeSheets,
  actualizarEstadoPedidoEnSheets,
  sincronizarPedidoDesdeDbEnSheets,
  reconstruirSheetsDesdeOrders
} = require("./sheets");
const {
  databasePath,
  ESTADOS_VALIDOS,
  normalizeCustomerType,
  normalizePhone,
  saveOrder,
  listOrders,
  listOrdersIncludingArchived,
  updateOrderStatus,
  attachReceiptToOrder,
  countOrders,
  getActiveOrderByPhone,
  importOrders,
  saveMessage,
  updateMessageOrder,
  syncCatalogProducts,
  listCatalogProducts,
  countCatalogProducts,
  countAllCatalogProducts,
  countInactiveCatalogProducts,
  listConversations,
  listMessagesByPhone,
  countMessagesByPhone,
  conversationExists,
  listCustomers,
  getCustomerById,
  getCustomerByPhone,
  createCustomer,
  updateCustomer,
  setCustomerStatus,
  deleteCustomer,
  createDailyClosure,
  listDailyClosures,
  getDailyClosureById
} = require("./db");
const { generateDailyClosurePdf } = require("./reports");
const {
  DEFAULT_CATALOG_URL,
  fetchCatalogProducts,
  loadCatalogSnapshotProducts,
  normalizeCatalogText
} = require("./catalog");
const {
  enviarMensajeWhatsApp,
  obtenerMediaWhatsApp,
  construirRespuestaGuiaPedido,
  construirRespuestaPedido,
  construirRespuestaCatalogoInicial,
  construirRespuestaCatalogoInformativo,
  construirRespuestaNombreRegistrado,
  construirRespuestaPreciosInformativo,
  construirRespuestaIdentidad,
  construirRespuestaDespedida,
  construirRespuestaConfirmacion,
  construirRespuestaCasual,
  construirRespuestaCorreccion,
  construirRespuestaAyudaHumana,
  construirLineaCatalogoSugerido,
  CATALOG_URL
} = require("./whatsapp");
const {
  createDefaultConversationState,
  getConversationState,
  appendRecentHistory
} = require("./conversationStateManager");
const { buildConversationOrchestratorContext } = require("./conversationOrchestrator");

const app = express();
const port = process.env.PORT || 3000;
const APP_VERSION = (process.env.RAILWAY_GIT_COMMIT_SHA || process.env.APP_VERSION || "local").trim();
const publicDir = path.join(__dirname, "public");
const PANEL_AUTH_COOKIE = "tellolac_admin_session";
const PANEL_AUTH_USERNAME = String(process.env.PANEL_AUTH_USERNAME || "admin").trim() || "admin";
const PANEL_AUTH_PASSWORD = String(process.env.PANEL_AUTH_PASSWORD || "").trim();
const PANEL_AUTH_SECRET = String(process.env.PANEL_AUTH_SECRET || process.env.WEBHOOK_VERIFY_TOKEN || "dev-panel-secret").trim();
const PANEL_AUTH_ENABLED = Boolean(PANEL_AUTH_PASSWORD);
const PANEL_AUTH_TTL_MS = Number(process.env.PANEL_AUTH_TTL_MS || 1000 * 60 * 60 * 12);
const PANEL_LOGIN_PATH = normalizePanelLoginPath(process.env.PANEL_LOGIN_PATH || "/portal");
const PANEL_LOGIN_RATE_LIMIT_WINDOW_MS = Number(process.env.PANEL_LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const PANEL_LOGIN_RATE_LIMIT_MAX_ATTEMPTS = Number(process.env.PANEL_LOGIN_RATE_LIMIT_MAX_ATTEMPTS || 5);
const PANEL_AUTH_COOKIE_SECURE = parseBooleanEnv(process.env.PANEL_AUTH_COOKIE_SECURE, String(process.env.NODE_ENV || "").trim().toLowerCase() === "production");
const PRODUCT_DISAMBIGUATION_TTL_MS = Number(process.env.PRODUCT_DISAMBIGUATION_TTL_MS || 15 * 60 * 1000);
const ORDER_MEDIA_DIR = path.join(__dirname, "data", "order-media");
const ADMIN_WHATSAPP_NUMBERS = new Set(String(process.env.ADMIN_WHATSAPP_NUMBERS || "")
  .split(",")
  .map((value) => normalizePhone(value))
  .filter(Boolean));
const ADMIN_NOTIFY_ENABLED = parseBooleanEnv(process.env.ADMIN_NOTIFY_ENABLED, false);
const BUSINESS_HOURS_ENABLED = parseBooleanEnv(process.env.BUSINESS_HOURS_ENABLED, false);
const BUSINESS_OPEN_HOUR = Number(process.env.BUSINESS_OPEN_HOUR || 7);
const BUSINESS_CLOSE_HOUR = Number(process.env.BUSINESS_CLOSE_HOUR || 20);
const BUSINESS_TIMEZONE = String(process.env.BUSINESS_TIMEZONE || "America/Bogota").trim() || "America/Bogota";
const panelLoginAttemptState = new Map();

fs.mkdirSync(ORDER_MEDIA_DIR, { recursive: true });

app.set("trust proxy", 1);
app.use(express.json());
app.use("/assets", express.static(path.join(publicDir, "assets")));
app.use("/order-media", express.static(ORDER_MEDIA_DIR));
app.get("/styles.css", (_req, res) => res.sendFile(path.join(publicDir, "styles.css")));
app.get("/app.js", (_req, res) => {
  const runtimeConfig = [
    `window.__PANEL_LOGIN_PATH__ = ${JSON.stringify(PANEL_LOGIN_PATH)};`,
    `window.__PANEL_AUTH_TTL_MS__ = ${JSON.stringify(PANEL_AUTH_TTL_MS)};`
  ].join("\n");
  const script = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
  res.type("application/javascript").send(`${runtimeConfig}\n${script}`);
});

const GENERIC_PRODUCT_ALIASES = new Map([
  ["yogur", "yogur"],
  ["yogurt", "yogur"],
  ["yoghurt", "yogur"],
  ["yogures", "yogur"],
  ["yogurts", "yogur"],
  ["kumis", "kumis"]
]);
const PRODUCT_NORMALIZATION = {
  "yogur de mora": ["yogur de mora", "yogurt de mora", "yogur mora", "yogurt mora", "mora"],
  "yogur de fresa": ["yogur de fresa", "yogurt de fresa", "yogur fresa", "yogurt fresa", "fresa"],
  kumis: ["kumis", "kumises"]
};
const PRODUCT_CANONICAL_DETAILS = {
  "yogur de mora": { producto: "yogur", sabor: "mora" },
  "yogur de fresa": { producto: "yogur", sabor: "fresa" },
  kumis: { producto: "kumis", sabor: null }
};
const ALLOWED_PRODUCTS = new Set(["yogur", "kumis"]);
const PAYMENT_ALIASES = new Map([
  ["nequi", "Transferencia"],
  ["daviplata", "Transferencia"],
  ["efectivo", "Efectivo"],
  ["transferencia", "Transferencia"],
  ["transferencia bancaria", "Transferencia"],
  ["contra entrega", "Efectivo"]
]);
const processedMessageIds = new Map();
const processedMessageContentHashes = new Map();
const userRateLimitState = new Map();
const rateLimitNoticeState = new Map();
const conversationMemoryState = new Map();
const MESSAGE_ID_TTL_MS = 6 * 60 * 60 * 1000;
const CONTENT_DEDUPE_WINDOW_MS = Number(process.env.CONTENT_DEDUPE_WINDOW_MS || 45000);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 10000);
const RATE_LIMIT_MAX_MESSAGES = Number(process.env.RATE_LIMIT_MAX_MESSAGES || 5);
const SHEETS_BACKUP_ENABLED = String(process.env.SHEETS_BACKUP_ENABLED || "true").trim().toLowerCase() !== "false";
const WHATSAPP_ENABLED = String(process.env.WHATSAPP_ENABLED || "false").trim().toLowerCase() === "true";
const CONVERSATIONS_DEFAULT_LIMIT = 20;
const CONVERSATIONS_MAX_LIMIT = 100;
const MANUAL_MESSAGE_MAX_LENGTH = 1000;
let catalogProductsCache = [];
const DELIVERY_TIMEZONE_OFFSET_MINUTES = Number(process.env.DELIVERY_TIMEZONE_OFFSET_MINUTES || -300);
const NUMBER_WORDS = new Map([
  ["un", 1],
  ["uno", 1],
  ["una", 1],
  ["dos", 2],
  ["tres", 3],
  ["cuatro", 4],
  ["cinco", 5],
  ["seis", 6],
  ["siete", 7],
  ["ocho", 8],
  ["nueve", 9],
  ["diez", 10]
]);
const WEEKDAY_INDEX = new Map([
  ["domingo", 0],
  ["lunes", 1],
  ["martes", 2],
  ["miercoles", 3],
  ["miércoles", 3],
  ["jueves", 4],
  ["viernes", 5],
  ["sabado", 6],
  ["sábado", 6]
]);
const MONTH_INDEX = new Map([
  ["enero", 0],
  ["febrero", 1],
  ["marzo", 2],
  ["abril", 3],
  ["mayo", 4],
  ["junio", 5],
  ["julio", 6],
  ["agosto", 7],
  ["septiembre", 8],
  ["setiembre", 8],
  ["octubre", 9],
  ["noviembre", 10],
  ["diciembre", 11]
]);
const ADDRESS_KEYWORDS = /(calle|cll|cl|carrera|cra|cr|avenida|av\.?|barrio|manzana|mz|casa|apartamento|apto|torre|bloque|conjunto|centro)/i;
const PRODUCT_ALIAS_INDEX = (() => {
  const index = new Map();

  for (const [canonical, aliases] of Object.entries(PRODUCT_NORMALIZATION)) {
    for (const alias of aliases) {
      index.set(normalizarTextoAnalisis(alias), canonical);
    }
  }

  return index;
})();
const NON_NAME_TERMS = new Set([
  "listo", "ok", "okei", "oki", "dale", "perfecto", "gracias", "hola", "buenas", "menu", "catalogo",
  "informacion", "info", "yo", "si", "no", "bye", "adios", "chao", "hasta", "luego", "hablamos",
  "quien", "eres", "abby", "abi", "precios", "precio", "portafolio", "productos", "producto",
  "venden", "catalogo", "menu", "pedido", "pedidos"
]);
const CATALOG_TOKEN_STOPWORDS = new Set([
  "quiero", "quisiera", "necesito", "pedido", "pedir", "ordeno", "encargo", "comprar", "me", "regalas",
  "dame", "enviame", "enviarme", "por", "favor", "para", "llevo", "agregame", "agrégame", "de", "del",
  "la", "el", "los", "las", "uno", "una", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete",
  "ocho", "nueve", "diez", "y", "con", "sin", "porfa", "porfis", "porfavor", "quiera", "favorcito",
  "producto", "productos", "pedido", "pedidos", "favor", "envio", "domicilio"
]);
const GENERIC_CATALOG_TOKENS = new Set(["yogur", "yogurt", "yoghurt", "bebida", "sabor", "cosa", "detalle"]);
const SIZE_SMALL_TOKENS = ["pequeno", "pequeño", "pequenito", "chico", "personal", "litro", "1000", "1000ml", "1000 ml", "500g", "500 g", "medio kilo", "media libra"];
const SIZE_LARGE_TOKENS = ["grande", "grandecito", "garrafa", "familiar", "1800", "1800ml", "1800 ml", "1 8", "1.8", "1.8ml", "1.8 ml", "kilo", "1 kilo", "1kg", "kg", "1000g", "1000 g", "de kilo"];
const LIST_ORDER_NON_IDENTITY_TOKENS = new Set([
  ...SIZE_SMALL_TOKENS,
  ...SIZE_LARGE_TOKENS,
  "ml",
  "g",
  "gr",
  "gramos"
].flatMap((value) => normalizeCatalogText(value).split(" ").filter(Boolean)));
const PRICE_VALUE_TOKENS = ["barato", "barata", "baratos", "baratas", "economico", "económico", "economica", "económica", "economicos", "económicos", "economicas", "económicas", "asequible", "asequibles"];
const SAME_PRODUCT_TOKENS = ["lo mismo", "el mismo", "la misma", "ese", "esa", "el de siempre", "la de siempre", "como siempre"];
const PARTIAL_ADDRESS_REFERENCE_TOKENS = ["la misma direccion", "la misma dirección", "misma direccion", "misma dirección", "donde siempre"];
const RECEIPT_IMAGE_KEYWORDS = ["comprobante", "pago", "transferencia", "nequi", "daviplata", "consignacion", "consignación", "soporte", "recibo"];
const SUGGESTION_MEMORY_TTL_MS = Number(process.env.SUGGESTION_MEMORY_TTL_MS || 20 * 60 * 1000);
const ACTIVE_ORDER_CONTEXT_TTL_MS = Number(process.env.ACTIVE_ORDER_CONTEXT_TTL_MS || 45 * 60 * 1000);
const IMAGE_CONTEXT_TTL_MS = Number(process.env.IMAGE_CONTEXT_TTL_MS || 45 * 60 * 1000);
const IMAGE_ORDER_AUTO_PERSIST_ON_HIGH_CONFIDENCE = String(process.env.IMAGE_ORDER_AUTO_PERSIST_ON_HIGH_CONFIDENCE || "false").toLowerCase() === "true";
const IMAGE_ORDER_AUTO_PERSIST_MIN_CONFIDENCE = Number(process.env.IMAGE_ORDER_AUTO_PERSIST_MIN_CONFIDENCE || 0.94);
const CATALOG_SNAPSHOT_SOURCE_URL = "local://catalog_snapshot.json";
const SEMANTIC_FAMILY_KEYWORDS = new Map([
  ["aloe", ["aloe", "sabila", "sábila"]],
  ["cafe", ["cafe", "café", "cafecito"]],
  ["griego", ["griego", "yogur griego", "yogurt griego", "griego de kilo", "griego grande"]],
  ["yogur", ["yogur", "yogurt", "yoghurt", "yogourt"]],
  ["kefir", ["kefir", "kefyr", "kéfir"]],
  ["kumis", ["kumis"]],
  ["queso", ["queso", "quesitos"]],
  ["ancheta", ["ancheta", "regalo", "detalle", "combo", "combo regalo"]],
  ["bandeja queso arequipe", ["bandeja", "queso", "arequipe", "tabla"]]
]);
const PRODUCT_RESOLUTION_FAMILY_RULES = {
  griego: {
    subtypeTokens: ["fruta", "surtido", "unidad"],
    variants: [
      { key: "500", aliases: ["500", "500 g", "500g", "500ml", "500 ml", "grande"], pattern: /\b500\s*g\b/ },
      { key: "250", aliases: ["250", "250 g", "250g", "pequeno", "pequeño", "pequenito", "chico"], pattern: /\b250\s*g\b/ }
    ]
  },
  cafe: {
    variants: [
      { key: "1800", aliases: ["1800", "1800 ml", "1800ml", "grande", "garrafa", "familiar"], pattern: /\b(1800\s*ml|garrafa)\b/ },
      { key: "1000", aliases: ["1000", "1000 ml", "1000ml", "litro", "pequeno", "pequeño"], pattern: /\b(1000\s*ml|litro)\b/ }
    ]
  },
  aloe: {
    variants: [
      { key: "1800", aliases: ["1800", "1800 ml", "1800ml", "grande", "garrafa", "familiar"], pattern: /\b(1800\s*ml|garrafa)\b/ },
      { key: "1000", aliases: ["1000", "1000 ml", "1000ml", "litro", "pequeno", "pequeño"], pattern: /\b(1000\s*ml|litro)\b/ }
    ]
  },
  ancheta: {
    variants: [
      { key: "value", aliases: ["barata", "barato", "economica", "económica", "economico", "económico", "asequible"], pattern: /\b(ancheta\s*1|ancheta\s*uno|ancheta\s+1)\b/ },
      { key: "premium", aliases: ["premium", "grande"], pattern: /\b(premium|ancheta)\b/ }
    ]
  },
  yogur: {
    flavorTokens: ["mora", "fresa", "durazno", "cafe", "café"],
    variants: [
      { key: "1800", aliases: ["1800", "1800 ml", "1800ml", "garrafa", "grande"], pattern: /\b(1800\s*ml|garrafa)\b/ },
      { key: "1000", aliases: ["1000", "1000 ml", "1000ml", "litro", "pequeno", "pequeño"], pattern: /\b(1000\s*ml|litro)\b/ },
      { key: "500", aliases: ["500", "500 g", "500g"], pattern: /\b500\s*(g|ml)\b/ }
    ]
  },
  kefir: {
    variants: [
      { key: "1000", aliases: ["1000", "1000 ml", "1000ml", "litro"], pattern: /\b(1000\s*ml|litro)\b/ }
    ]
  },
  kumis: {
    variants: [
      { key: "1000", aliases: ["1000", "1000 ml", "1000ml", "litro"], pattern: /\b(1000\s*ml|litro)\b/ }
    ]
  },
  queso: {
    variants: []
  }
};

function limpiarTexto(valor) {
  if (typeof valor !== "string") {
    return null;
  }

  const limpio = valor.trim();
  return limpio ? limpio : null;
}

function capitalizarNombre(valor) {
  return String(valor || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1).toLowerCase())
    .join(" ");
}

function esNombreHumanoValido(texto) {
  const normalized = normalizarTextoAnalisis(texto);
  if (!normalized) {
    return false;
  }

  const tokens = normalized.split(" ").filter(Boolean);
  if (!tokens.length || tokens.length > 2) {
    return false;
  }

  if (tokens.some((token) => NON_NAME_TERMS.has(token) || !/^[a-z]{2,20}$/i.test(token))) {
    return false;
  }

  return true;
}

function extraerNombreExplícito(texto) {
  const raw = String(texto || "").trim();
  if (!raw) {
    return null;
  }

  const explicitMatch = raw.match(/(?:me llamo|mi nombre es|soy|puedes llamarme)\s+([a-zA-ZÁÉÍÓÚáéíóúñÑ ]{2,40})$/i);
  if (!explicitMatch?.[1]) {
    return null;
  }

  return esNombreHumanoValido(explicitMatch[1]) ? capitalizarNombre(explicitMatch[1]) : null;
}

function esIntencionNombre(texto) {
  return Boolean(extraerNombreExplícito(texto));
}

function esNombreDirectoValido(texto) {
  const raw = String(texto || "").trim();
  if (!raw) {
    return false;
  }

  const normalized = normalizarTextoAnalisis(raw);
  const tokens = normalized.split(" ").filter(Boolean);
  return tokens.length <= 2 && esNombreHumanoValido(raw);
}

function extraerNombreConversacional(texto) {
  const explicit = extraerNombreExplícito(texto);
  if (explicit) {
    return explicit;
  }

  const raw = String(texto || "").trim();
  const casualMatch = raw.match(/^(?:soy|habla)\s+([a-zA-ZÁÉÍÓÚáéíóúñÑ ]{2,40})$/i);
  if (!casualMatch?.[1]) {
    return null;
  }

  return esNombreHumanoValido(casualMatch[1]) ? capitalizarNombre(casualMatch[1]) : null;
}

function esMensajeBienvenida(texto) {
  const normalized = normalizarTextoAnalisis(texto);
  return /^(hola|buenas|buenos dias|buenas tardes|buenas noches)$/.test(normalized);
}

function esIntencionInfoCatalogo(texto) {
  const normalized = normalizarTextoAnalisis(texto);
  if (!normalized) {
    return false;
  }

  return /^(info|informacion|menu|catalogo|precios|portafolio|productos)$/.test(normalized)
    || /\b(ver|mostrar|muestrame|quiero ver)\s+(el\s+)?(portafolio|catalogo|menu)\b/.test(normalized)
    || /\b(que venden|que productos tienen|que manejan|catalogo|menu|precios|informacion|portafolio|productos)\b/.test(normalized);
}

function esIntencionPrecio(texto) {
  const normalized = normalizarTextoAnalisis(texto);
  if (!normalized) {
    return false;
  }

  return /\b(precio|precios|cuanto vale|cuanto cuesta|valor|vale)\b/.test(normalized);
}

function esPreguntaIdentidad(texto) {
  const normalized = normalizarTextoAnalisis(texto);
  return /^(quien eres|quien me atiende|como te llamas|como se llama la asesora|quien atiende)$/.test(normalized);
}

function esDespedida(texto) {
  const normalized = normalizarTextoAnalisis(texto);
  if (!normalized) {
    return false;
  }

  return /^(gracias|muchas gracias|mil gracias|listo gracias|ok gracias|okey gracias|perfecto gracias|bye|chao|adios|hasta luego|hablamos|gracias bye|okey bye|ok bye)$/.test(normalized);
}

function esConfirmacionCasual(texto) {
  const normalized = normalizarTextoAnalisis(texto);
  if (!normalized) {
    return false;
  }

  return /^(si|sí|correcto|correcta|confirmo|confirmado|listo|ok|dale|perfecto|esta bien|está bien|bueno)$/.test(normalized);
}

function esIntencionAyudaHumana(texto) {
  const normalized = normalizarTextoAnalisis(texto);
  return /\b(hablar con asesor|asesor humano|atencion humana|atencion por favor|persona real|humano)\b/.test(normalized);
}

function esIntencionCorreccion(texto) {
  const normalized = normalizarTextoAnalisis(texto);
  return /\b(no entendiste|eso no era|te equivocaste|no ese|no era ese|el otro|me equivoque|me equivoqué|corrige|corregir)\b/.test(normalized);
}

function esIntencionReorden(texto) {
  const normalized = normalizarTextoAnalisis(texto);
  return /\b(lo mismo de ayer|lo mismo de la otra vez|lo de siempre|el pedido anterior|lo mismo)\b/.test(normalized);
}

function esIntencionRemoverItem(texto) {
  const normalized = normalizarTextoAnalisis(texto);
  return /\b(quita|quitame|quítame|elimina|borra|ya no quiero)\b/.test(normalized);
}

function esIntencionModificarCantidad(texto) {
  const normalized = normalizarTextoAnalisis(texto);
  if (!normalized) {
    return false;
  }

  return /\b(mejor|solo|deja|dejalo|déjalo|pon|ponme|agrega|agregale|suma|sumale|cambia a)\b/.test(normalized)
    || new RegExp(`^${QUANTITY_TOKEN_PATTERN}$`, "i").test(normalized)
    || new RegExp(`^(?:dame|mandame|mándame|quiero)\s+${QUANTITY_TOKEN_PATTERN}$`, "i").test(normalized)
    || /\b(una mas|uno mas|dos mas|3 mas|4 mas|5 mas|mas)\b/.test(normalized);
}

function esIntencionMetodoPago(texto) {
  return Boolean(extraerMetodoPagoDesdeTexto(texto));
}

function esIntencionDireccion(texto) {
  return Boolean(extraerDireccionDesdeTexto(texto));
}

function esReferenciaDireccionPersistida(texto, state) {
  const normalized = normalizarTextoAnalisis(texto);
  if (!normalized) {
    return false;
  }

  const hasStoredAddress = Boolean(state?.lastResolvedOrder?.direccion || state?.activeOrderContext?.direccion || state?.pendingPedido?.direccion);
  return hasStoredAddress && PARTIAL_ADDRESS_REFERENCE_TOKENS.some((token) => normalized.includes(normalizarTextoAnalisis(token)));
}

function esReferenciaAmbigua(texto, state) {
  const normalized = normalizarTextoAnalisis(texto);
  if (!normalized) {
    return false;
  }

  const hasReferenceCue = /\b(el primero|la primera|el segundo|el grande|el pequeno|el pequeño|el barato|ese|esa|el otro)\b/.test(normalized);
  if (!hasReferenceCue) {
    return false;
  }

  const suggestionMemory = obtenerSuggestionMemoryActiva(state);
  const activeContext = obtenerActiveOrderContext(state);
  return Boolean((suggestionMemory?.options || []).length || (activeContext?.products || []).length || state?.lastProductReference?.nombre);
}

function detectarIntencionConversacional(texto, { hasDraftContext = false, hasActiveContext = false, customerName = null, awaitingName = false, state = null } = {}) {
  const listOrderAnalysis = analizarPedidoFormatoLista(texto);

  if (esPreguntaIdentidad(texto)) {
    return "identity";
  }

  if (esIntencionAyudaHumana(texto)) {
    return "human_help";
  }

  if (esIntencionCorreccion(texto)) {
    return "complaint_confusion";
  }

  if (esDespedida(texto)) {
    return "closing";
  }

  if (esIntencionNombre(texto) || (awaitingName && !customerName && esNombreDirectoValido(texto))) {
    return "provide_name";
  }

  if (esIntencionMetodoPago(texto) && (hasDraftContext || hasActiveContext)) {
    return "payment_method";
  }

  if ((esIntencionDireccion(texto) && (hasDraftContext || hasActiveContext)) || esReferenciaDireccionPersistida(texto, state)) {
    return "address_provided";
  }

  if (esIntencionRemoverItem(texto) && (hasDraftContext || hasActiveContext)) {
    return "remove_item";
  }

  if (esIntencionModificarCantidad(texto) && (hasDraftContext || hasActiveContext)) {
    return "modify_quantity";
  }

  if (listOrderAnalysis.detected) {
    if ((hasDraftContext || hasActiveContext) && listOrderAnalysis.parsedCount === 1) {
      const firstItem = listOrderAnalysis.items?.[0];
      const parsedProductText = normalizarTextoAnalisis(firstItem?.productText || "");
      if (parsedProductText && /^(dame|quiero|mandame|mándame|ponme|agrega|agregame|agrégame)$/.test(parsedProductText)) {
        return "modify_quantity";
      }
    }

    logEvent("LIST_ORDER_DETECTED", {
      multiLine: listOrderAnalysis.multiLine,
      lines: listOrderAnalysis.lineCount,
      parsed: listOrderAnalysis.parsedCount
    });
    logEvent("ORDER_INTENT_CONFIDENCE", {
      source: "list_order_parser",
      confidence: listOrderAnalysis.confidence,
      items: listOrderAnalysis.items.map((item) => `${item.cantidad} ${item.productText}`)
    });
    logConfidenceLevel({
      source: "list_order_parser",
      stage: "intent_detection",
      confidence: listOrderAnalysis.confidence
    });
    return hasDraftContext ? "order_missing_data" : "order_request";
  }

  if (esIntencionReorden(texto)) {
    return "reorder_memory";
  }

  if (esReferenciaAmbigua(texto, state) && hasActiveContext) {
    return "ambiguous_reference";
  }

  if (esIntencionInfoCatalogo(texto)) {
    return "catalog_request";
  }

  if (esIntencionPrecio(texto)) {
    return "price_request";
  }

  if (esMensajeBienvenida(texto)) {
    return customerName ? "general_chat" : "greeting";
  }

  if (detectarIntencionPedido(texto)) {
    return hasDraftContext ? "order_missing_data" : "order_request";
  }

  if (esConfirmacionCasual(texto)) {
    return (hasDraftContext || hasActiveContext) ? "order_missing_data" : "general_chat";
  }

  if (hasDraftContext || hasActiveContext) {
    return "order_missing_data";
  }

  return "general_chat";
}

function normalizarTextoAnalisis(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9#@\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const QUANTITY_TOKEN_PATTERN = "(?:\\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)";
const SEGMENT_START_TOKENS_PATTERN = Array.from(new Set([
  ...SEMANTIC_FAMILY_KEYWORDS.keys(),
  ...Array.from(SEMANTIC_FAMILY_KEYWORDS.values()).flat(),
  ...GENERIC_CATALOG_TOKENS,
  "yogur",
  "yogurt",
  "yoghurt"
].flatMap((alias) => {
  const value = String(alias || "").trim();
  if (!value) {
    return [];
  }

  const variants = [value];
  if (!/s$/i.test(value) && value.length >= 4) {
    variants.push(`${value}s`);
  }
  if (!/es$/i.test(value) && /z$/i.test(value)) {
    variants.push(`${value.slice(0, -1)}ces`);
  }
  return variants;
})))
  .map((alias) => String(alias || "").trim())
  .filter(Boolean)
  .sort((a, b) => b.length - a.length)
  .map((alias) => escapeRegex(alias).replace(/\s+/g, "\\s+"))
  .join("|");
const SEMANTIC_FAMILY_ALIAS_PATTERN = Array.from(new Set([
  ...SEMANTIC_FAMILY_KEYWORDS.keys(),
  ...Array.from(SEMANTIC_FAMILY_KEYWORDS.values()).flat()
]))
  .map((alias) => String(alias || "").trim())
  .filter(Boolean)
  .sort((a, b) => b.length - a.length)
  .map((alias) => escapeRegex(alias).replace(/\s+/g, "\\s+"))
  .join("|");

function obtenerNumeroDesdeToken(token) {
  const limpio = normalizarTextoAnalisis(token);

  if (!limpio) {
    return null;
  }

  if (/^\d+$/.test(limpio)) {
    return Number(limpio);
  }

  return NUMBER_WORDS.get(limpio) || null;
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeCanonicalCatalogName(value) {
  return normalizeCatalogText(value)
    .replace(/\b1\s*[.,]\s*8\s*ml\b/g, "1800 ml")
    .replace(/\b1800ml\b/g, "1800 ml")
    .replace(/\b1000ml\b/g, "1000 ml")
    .replace(/\b1000g\b/g, "1000 g")
    .replace(/\b1kg\b/g, "1 kg")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCatalogFamilyName(value) {
  return normalizeCanonicalCatalogName(value)
    .replace(/\b(1800 ml|1000 ml|1000 g|1 kg|500 g|250 g)\b/g, " ")
    .replace(/\b\d+\b$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCatalogSemanticFamilyName(value) {
  return normalizeCatalogFamilyName(value)
    .replace(/\b(garrafa|litro|kilo|kg|gramos?|gr)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesCatalogFamily(product, familyName) {
  const normalizedFamily = normalizeCatalogText(familyName);
  if (!normalizedFamily || !product) {
    return false;
  }

  const familyAliases = SEMANTIC_FAMILY_KEYWORDS.get(normalizedFamily) || [normalizedFamily];
  const haystacks = [
    product?.nombre_raiz_familia,
    product?.nombre_familia,
    product?.categoria,
    product?.nombre,
    ...(Array.isArray(product?.aliases) ? product.aliases : [])
  ].map((value) => normalizeCatalogText(value)).filter(Boolean);

  return haystacks.some((value) => value === normalizedFamily)
    || haystacks.some((value) => familyAliases.some((alias) => value.includes(normalizeCatalogText(alias))));
}

function tokenizarCatalogo(valor, { keepGeneric = false } = {}) {
  const normalized = normalizeCatalogText(valor);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !CATALOG_TOKEN_STOPWORDS.has(token))
    .filter((token) => keepGeneric || !GENERIC_CATALOG_TOKENS.has(token));
}

function extractCatalogIdentityTokens(value, { keepGeneric = false } = {}) {
  return tokenizarCatalogo(value, { keepGeneric })
    .map((token) => normalizeFuzzyCatalogToken(token))
    .filter(Boolean)
    .filter((token) => !LIST_ORDER_NON_IDENTITY_TOKENS.has(token))
    .filter((token) => !PRICE_VALUE_TOKENS.includes(token));
}

function productHasCatalogIdentityOverlap(query, product) {
  const queryTokens = extractCatalogIdentityTokens(query, { keepGeneric: true });
  if (!queryTokens.length) {
    return true;
  }

  const productTokens = new Set([
    ...extractCatalogIdentityTokens(product?.nombre, { keepGeneric: true }),
    ...extractCatalogIdentityTokens(product?.nombre_canonico, { keepGeneric: true }),
    ...extractCatalogIdentityTokens(product?.nombre_familia, { keepGeneric: true }),
    ...extractCatalogIdentityTokens(product?.nombre_raiz_familia, { keepGeneric: true }),
    ...((product?.aliases || []).flatMap((alias) => extractCatalogIdentityTokens(alias, { keepGeneric: true })))
  ]);

  return queryTokens.some((token) => productTokens.has(token));
}

function esConsultaProductoProbable(segmento) {
  const normalized = normalizarTextoAnalisis(segmento);
  if (!normalized) {
    return false;
  }

  if (esSegmentoNoProducto(segmento)) {
    return false;
  }

  const identityTokens = extractCatalogIdentityTokens(segmento, { keepGeneric: true });
  return identityTokens.length > 0 && normalized.split(" ").filter(Boolean).length <= 6;
}

function includesAnyToken(texto, tokens = []) {
  const normalized = normalizeCatalogText(texto);
  return tokens.some((token) => normalized.includes(normalizeCatalogText(token)));
}

function extractSemanticCatalogPreferences(texto) {
  const normalized = normalizeCatalogText(texto);
  const tokens = tokenizarCatalogo(normalized, { keepGeneric: false });
  const rawTokens = tokenizarCatalogo(normalized, { keepGeneric: true });
  const genericTokens = rawTokens.filter((token) => GENERIC_CATALOG_TOKENS.has(token));
  const families = new Set();

  for (const [family, aliases] of SEMANTIC_FAMILY_KEYWORDS.entries()) {
    const familyMatched = aliases.some((alias) => {
      const normalizedAlias = normalizeCatalogText(alias);
      if (normalized.includes(normalizedAlias)) {
        return true;
      }

      return rawTokens.some((token) => levenshteinDistance(token, normalizedAlias) <= 1);
    });

    if (familyMatched) {
      families.add(family);
    }
  }

  return {
    normalized,
    tokens,
    rawTokens,
    genericTokens,
    families,
    wantsSmall: includesAnyToken(normalized, SIZE_SMALL_TOKENS),
    wantsLarge: includesAnyToken(normalized, SIZE_LARGE_TOKENS),
    wantsValue: includesAnyToken(normalized, PRICE_VALUE_TOKENS),
    wantsSame: includesAnyToken(normalized, SAME_PRODUCT_TOKENS),
    hasFamilyCue: families.size > 0
  };
}

function buildProductSemanticTokens(product) {
  const tokens = new Set([
    ...tokenizarCatalogo(product?.nombre, { keepGeneric: true }),
    ...tokenizarCatalogo(product?.nombre_canonico, { keepGeneric: true }),
    ...tokenizarCatalogo(product?.nombre_familia, { keepGeneric: true })
  ]);

  for (const alias of product?.aliases || []) {
    for (const token of tokenizarCatalogo(alias, { keepGeneric: true })) {
      tokens.add(token);
    }
  }

  for (const [family, aliases] of SEMANTIC_FAMILY_KEYWORDS.entries()) {
    if (family === product?.nombre_raiz_familia || family === product?.nombre_familia) {
      aliases.forEach((alias) => tokens.add(normalizeCatalogText(alias)));
    }
  }

  return Array.from(tokens).filter(Boolean);
}

function isSmallVariant(product) {
  const canonical = normalizeCanonicalCatalogName(product?.nombre_canonico || product?.nombre);
  return /\b(1000 ml|500 g|250 g)\b/.test(canonical);
}

function isStandardVariant(product) {
  const canonical = normalizeCanonicalCatalogName(product?.nombre_canonico || product?.nombre);
  return /\b(litro|griego|yogurt|yogur)\b/.test(canonical) && !/\b(1000 ml|1800 ml|1000 g|1 kg|500 g|250 g)\b/.test(canonical) && !/\bgarrafa\b/.test(canonical);
}

function isLargeVariant(product) {
  const canonical = normalizeCanonicalCatalogName(product?.nombre_canonico || product?.nombre);
  return /\b(1800 ml|1000 g|1 kg)\b/.test(canonical) || /\b(garrafa|kilo)\b/.test(canonical);
}

function getFamilyPriceStats(familyName) {
  const familyProducts = getCatalogProductsCache().filter((product) => matchesCatalogFamily(product, familyName));
  const prices = familyProducts
    .map((product) => parseOptionalNumber(product?.precio))
    .filter((price) => price !== null)
    .sort((a, b) => a - b);

  return {
    min: prices[0] ?? null,
    max: prices[prices.length - 1] ?? null
  };
}

function puntuarCoincidenciaSemanticaCatalogo(texto, product) {
  const preferences = extractSemanticCatalogPreferences(texto);
  if (!preferences.tokens.length && !preferences.hasFamilyCue && !preferences.wantsSmall && !preferences.wantsLarge && !preferences.wantsValue) {
    return 0;
  }

  const productTokens = buildProductSemanticTokens(product);
  const overlap = preferences.tokens.filter((token) => productTokens.includes(token));
  const familyKey = product?.nombre_raiz_familia || product?.nombre_familia;
  const familyHit = preferences.families.has(familyKey);
  const price = parseOptionalNumber(product?.precio);
  const familyPriceStats = getFamilyPriceStats(familyKey);

  let score = 0;

  if (familyHit) {
    score += 74;
  }

  if (overlap.length) {
    score += Math.min(14, overlap.length * 8);
  }

  if (familyHit && !preferences.wantsSmall && !preferences.wantsLarge) {
    score += isStandardVariant(product) ? 10 : 0;
  }

  if (preferences.wantsSmall) {
    if (isSmallVariant(product)) {
      score += 22;
    } else if (isStandardVariant(product)) {
      score += 6;
    } else {
      score -= 8;
    }
  }

  if (preferences.wantsLarge) {
    score += isLargeVariant(product) ? 18 : -6;
  }

  if (preferences.wantsValue && price !== null && familyPriceStats.min !== null) {
    score += price === familyPriceStats.min ? 18 : -8;
  }

  if (preferences.wantsSame && preferences.hasFamilyCue && normalizeCatalogSemanticFamilyName(product?.nombre_raiz_familia || product?.nombre_familia) === Array.from(preferences.families)[0]) {
    score += 8;
  }

  return Math.max(score, 0);
}

function extractRequestedPrice(texto) {
  const raw = String(texto || "");
  const match = raw.match(/\$?\s*(\d{2,3}(?:\.\d{3})+|\d{4,6})\b(?!\s*ml\b)/i);
  if (!match?.[1]) {
    return null;
  }

  const price = Number(String(match[1]).replace(/\./g, ""));
  return Number.isFinite(price) && price >= 5000 ? price : null;
}

function setCatalogProductsCache(products = []) {
  catalogProductsCache = Array.isArray(products)
    ? products.map((product) => {
        const productoOriginal = limpiarTexto(product?.nombre);
        const nombreCanonico = normalizeCanonicalCatalogName(productoOriginal);
        const nombreFamilia = normalizeCatalogFamilyName(productoOriginal);

        return {
          ...product,
          producto_original: productoOriginal,
          nombre_canonico: nombreCanonico,
          nombre_familia: nombreFamilia,
          nombre_raiz_familia: normalizeCatalogSemanticFamilyName(productoOriginal),
          aliases: [...new Set([
            normalizeCatalogText(product?.nombre),
            nombreCanonico,
            ...(Array.isArray(product?.aliases) ? product.aliases.map((alias) => normalizeCatalogText(alias)) : [])
          ].filter(Boolean))]
        };
      })
    : [];
}

function getCatalogProductsCache() {
  if (!catalogProductsCache.length) {
    setCatalogProductsCache(listCatalogProducts({ activeOnly: true }));
  }

  return catalogProductsCache;
}

function resolveCustomerProfile(phone) {
  const customer = getCustomerByPhone(phone);
  const customerType = customer?.isActive ? normalizeCustomerType(customer.customerType, "public") : "public";
  return {
    customer,
    customerName: customer?.isActive ? customer.name : null,
    customerType,
    isDistributor: customerType === "distributor",
    priceLabel: customerType === "distributor" ? "distribuidor" : "público"
  };
}

function resolveCatalogPriceForCustomer(product, customerType = "public") {
  const normalizedType = normalizeCustomerType(customerType, "public");
  const publicPrice = parseOptionalNumber(product?.precio_publico ?? product?.precio);
  const distributorPrice = parseOptionalNumber(product?.precio_distribuidor);

  if (normalizedType === "distributor" && distributorPrice !== null) {
    return { unitPrice: distributorPrice, priceSource: "distributor", priceTierApplied: "distributor" };
  }

  if (normalizedType === "distributor" && distributorPrice === null) {
    logEvent("missing_distributor_price", {
      productId: product?.id || null,
      productName: product?.nombre || null,
      fallback: "public"
    });
  }

  return { unitPrice: publicPrice, priceSource: "public", priceTierApplied: distributorPrice !== null && normalizedType === "distributor" ? "distributor" : "public" };
}

function buildCatalogPricingContext(customerType = "public") {
  const normalizedType = normalizeCustomerType(customerType, "public");
  return {
    customerType: normalizedType,
    isDistributor: normalizedType === "distributor",
    priceLabel: normalizedType === "distributor" ? "distribuidor" : "público"
  };
}

function limpiarTextoProductoSolicitado(valor) {
  return normalizeCatalogText(valor)
    .replace(/\b(quiero|quisiera|necesito|pedido|pedir|ordeno|encargo|comprar|me regalas|dame|enviame|enviarme|por favor|para|llevo|agrégame|agregame)\b/g, " ")
    .replace(/\b(de|del|la|el|los|las)\b/g, " ")
    .replace(/^\s*(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b\s*/g, "")
    .replace(/\b\d{2,3}\.\d{3}\b(?!\s*ml\b)/g, " ")
    .replace(/(?<!\bde\s)\b\d{4,6}\b(?!\s*ml\b)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(a = "", b = "") {
  const source = String(a);
  const target = String(b);

  if (!source.length) {
    return target.length;
  }

  if (!target.length) {
    return source.length;
  }

  const matrix = Array.from({ length: source.length + 1 }, () => new Array(target.length + 1).fill(0));

  for (let i = 0; i <= source.length; i += 1) {
    matrix[i][0] = i;
  }

  for (let j = 0; j <= target.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= source.length; i += 1) {
    for (let j = 1; j <= target.length; j += 1) {
      const cost = source[i - 1] === target[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[source.length][target.length];
}

function normalizeFuzzyCatalogToken(token = "") {
  return String(token || "")
    .trim()
    .toLowerCase()
    .replace(/(.)\1{2,}/g, "$1$1")
    .replace(/^yogur(?:t|th)?$/i, "yogurt")
    .replace(/^yogou?rt$/i, "yogurt")
    .replace(/^griegos?$/i, "griego")
    .replace(/^kefyr$/i, "kefir")
    .replace(/^cafee$/i, "cafe")
    .replace(/^aloee$/i, "aloe")
    .replace(/(es|s)$/i, "");
}

function normalizeFuzzyCatalogPhrase(value = "") {
  return normalizeCatalogText(value)
    .replace(/(.)\1{2,}/g, "$1$1")
    .replace(/\byogou?rt\b/g, "yogurt")
    .replace(/\byogurth\b/g, "yogurt")
    .replace(/\byogur\b/g, "yogurt")
    .replace(/\bgri+ego\b/g, "griego")
    .replace(/\bkefyr\b/g, "kefir")
    .replace(/\bkefír\b/g, "kefir")
    .replace(/\bcafee\b/g, "cafe")
    .replace(/\baloee\b/g, "aloe")
    .replace(/\bsabila\b/g, "aloe")
    .trim();
}

function logFuzzyMatchResult(details = {}) {
  logEvent("FUZZY_MATCH_RESULT", {
    query: details.query || null,
    normalizedQuery: details.normalizedQuery || null,
    match: details.match || null,
    confidence: Number.isFinite(Number(details.confidence)) ? Number(details.confidence) : null,
    score: Number.isFinite(Number(details.score)) ? Number(details.score) : null,
    status: details.status || null
  });
}

function buildCharacterNgrams(value = "", size = 3) {
  const normalized = normalizeCatalogText(value).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const source = normalized.length < size ? normalized : normalized;
  const grams = new Set();
  for (let index = 0; index <= Math.max(0, source.length - size); index += 1) {
    grams.add(source.slice(index, index + size));
  }

  if (!grams.size) {
    grams.add(source);
  }

  return Array.from(grams);
}

function puntuarCoincidenciaSimilaridad(candidate, alias) {
  const candidateGrams = buildCharacterNgrams(candidate);
  const aliasGrams = buildCharacterNgrams(alias);
  if (!candidateGrams.length || !aliasGrams.length) {
    return 0;
  }

  const overlap = candidateGrams.filter((gram) => aliasGrams.includes(gram)).length;
  if (!overlap) {
    return 0;
  }

  const ratio = overlap / Math.max(candidateGrams.length, aliasGrams.length);
  return ratio >= 0.45 ? 58 + ratio * 18 : 0;
}

function puntuarCoincidenciaTipografica(candidateTokens = [], aliasTokens = []) {
  if (!candidateTokens.length || !aliasTokens.length) {
    return 0;
  }

  let fuzzyHits = 0;

  for (const candidateToken of candidateTokens) {
    const found = aliasTokens.some((aliasToken) => {
      const normalizedCandidateToken = normalizeFuzzyCatalogToken(candidateToken);
      const normalizedAliasToken = normalizeFuzzyCatalogToken(aliasToken);

      if (candidateToken === aliasToken || normalizedCandidateToken === normalizedAliasToken) {
        return true;
      }

      const distance = levenshteinDistance(normalizedCandidateToken, normalizedAliasToken);
      const longest = Math.max(normalizedCandidateToken.length, normalizedAliasToken.length);
      const maxDistance = longest >= 7 ? 2 : 1;
      return longest >= 4 && distance > 0 && distance <= maxDistance;
    });

    if (found) {
      fuzzyHits += 1;
    }
  }

  if (!fuzzyHits) {
    return 0;
  }

  const ratio = fuzzyHits / Math.max(candidateTokens.length, aliasTokens.length);
  return ratio >= 0.5 ? 66 + ratio * 12 : 0;
}

function puntuarCoincidenciaCatalogo(candidate, alias) {
  if (!candidate || !alias) {
    return 0;
  }

  const candidateValue = normalizeFuzzyCatalogPhrase(candidate);
  const aliasValue = normalizeFuzzyCatalogPhrase(alias);

  if (candidateValue === aliasValue) {
    return 140 + alias.length / 100;
  }

  if (candidateValue.includes(aliasValue)) {
    return 115 + alias.length / 100;
  }

  if (aliasValue.includes(candidateValue) && candidateValue.length >= 5) {
    return 92 + candidate.length / 100;
  }

  const candidateTokens = candidateValue.split(" ").filter((token) => token.length >= 2);
  const aliasTokens = aliasValue.split(" ").filter((token) => token.length >= 2);
  const normalizedCandidateTokens = candidateTokens.map((token) => normalizeFuzzyCatalogToken(token));
  const normalizedAliasTokens = aliasTokens.map((token) => normalizeFuzzyCatalogToken(token));

  if (!candidateTokens.length || !aliasTokens.length) {
    return 0;
  }

  const overlap = normalizedCandidateTokens.filter((token) => normalizedAliasTokens.includes(token));
  const typoScore = puntuarCoincidenciaTipografica(candidateTokens, aliasTokens);
  if (!overlap.length) {
    return typoScore;
  }

  const ratio = overlap.length / Math.max(candidateTokens.length, aliasTokens.length);
  const candidateCovered = overlap.length / candidateTokens.length;

  if (candidateCovered >= 1) {
    return 82 + ratio * 10;
  }

  if (ratio >= 0.66) {
    return Math.max(72 + ratio * 10, typoScore);
  }

  return Math.max(typoScore, puntuarCoincidenciaSimilaridad(candidate, alias));
}

function normalizarScoreAConfianza(score = 0) {
  if (score >= 130) return 98;
  if (score >= 115) return 92;
  if (score >= 100) return 86;
  if (score >= 90) return 80;
  if (score >= 80) return 72;
  if (score >= 70) return 62;
  if (score >= 60) return 54;
  if (score >= 50) return 50;
  return 32;
}

function encontrarCoincidenciasCatalogo(texto, { minScore = 70, limit = 5 } = {}) {
  const candidate = limpiarTextoProductoSolicitado(texto);
  if (!candidate) {
    return [];
  }

  const normalizedCandidate = normalizeFuzzyCatalogPhrase(candidate);

  const matches = [];

  for (const product of getCatalogProductsCache()) {
    let bestScore = 0;

    for (const alias of product.aliases || []) {
      bestScore = Math.max(bestScore, puntuarCoincidenciaCatalogo(normalizedCandidate, alias));
    }

    bestScore = Math.max(bestScore, puntuarCoincidenciaSemanticaCatalogo(texto, product));

    if (bestScore >= minScore) {
      matches.push({ product, score: bestScore, confidence: normalizarScoreAConfianza(bestScore) });
    }
  }

  const sortedMatches = matches
    .sort((a, b) => (b.score - a.score)
      || ((a.product?.nombre_canonico || a.product?.nombre || "").length - (b.product?.nombre_canonico || b.product?.nombre || "").length)
      || ((parseOptionalNumber(a.product?.precio) ?? Number.MAX_SAFE_INTEGER) - (parseOptionalNumber(b.product?.precio) ?? Number.MAX_SAFE_INTEGER)))
    .slice(0, limit);

  const bestMatch = sortedMatches[0] || null;
  logFuzzyMatchResult({
    query: candidate,
    normalizedQuery: normalizedCandidate,
    match: bestMatch?.product?.nombre || null,
    confidence: bestMatch?.confidence || null,
    score: bestMatch?.score || null,
    status: bestMatch ? "matched" : "not_found"
  });

  return sortedMatches;
}

function buildCanonicalCatalogEntries() {
  const groups = new Map();

  for (const product of getCatalogProductsCache()) {
    const key = product.nombre_canonico || normalizeCanonicalCatalogName(product.nombre);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(product);
  }

  return Array.from(groups.entries()).map(([nombreCanonico, products]) => ({
    nombre_canonico: nombreCanonico,
    productos: products.map((product) => ({
      producto_original: product.producto_original || product.nombre,
      precio: parseOptionalNumber(product.precio),
      aliases: product.aliases || []
    }))
  }));
}

function buildCatalogAmbiguityOptions(products = []) {
  const grouped = new Map();

  for (const product of products.filter(Boolean)) {
    const key = product.nombre_canonico || normalizeCanonicalCatalogName(product.nombre);
    const current = grouped.get(key);
    if (!current || (parseOptionalNumber(product.precio) ?? Number.MAX_SAFE_INTEGER) < (parseOptionalNumber(current.precio) ?? Number.MAX_SAFE_INTEGER)) {
      grouped.set(key, product);
    }
  }

  return Array.from(grouped.values()).map((product) => ({
    id: product.id,
    nombre: product.nombre,
    precio: parseOptionalNumber(product.precio),
    nombreCanonico: product.nombre_canonico || normalizeCanonicalCatalogName(product.nombre),
    productoOriginal: product.producto_original || product.nombre,
    aliases: product.aliases || []
  }));
}

function resolveCatalogProductByPrice(products = [], requestedPrice = null) {
  if (requestedPrice === null) {
    return null;
  }

  const matches = products.filter((product) => parseOptionalNumber(product?.precio) === requestedPrice);
  return matches.length === 1 ? matches[0] : null;
}

function resolveDedupedCatalogAmbiguity(products = []) {
  const options = buildCatalogAmbiguityOptions(products);
  if (options.length === 1) {
    const matchedProduct = products.find((product) => product?.id === options[0].id) || products[0] || null;
    return matchedProduct ? { status: "matched", product: matchedProduct } : { status: "not_found", product: null };
  }

  return { status: "ambiguous", matches: options };
}

function shouldAskFamilyClarificationForRootQuery(product, familyMatches, normalizedCandidate) {
  if (!product || !familyMatches.length || normalizedCandidate !== product.nombre_familia) {
    return false;
  }

  return familyMatches.some((entry) => entry.id !== product.id && new RegExp(`^${escapeRegex(product.nombre_familia)}\\s+\\d+$`).test(entry.nombre_canonico || ""));
}

function pickPreferredFamilyProduct(products = [], preference = "default") {
  const sorted = products.slice().sort((a, b) => {
    const aPrice = parseOptionalNumber(a?.precio) ?? Number.MAX_SAFE_INTEGER;
    const bPrice = parseOptionalNumber(b?.precio) ?? Number.MAX_SAFE_INTEGER;
    return aPrice - bPrice;
  });

  if (!sorted.length) {
    return null;
  }

  if (preference === "value") {
    return sorted[0];
  }

  if (preference === "large") {
    return sorted.find((product) => isLargeVariant(product)) || sorted[sorted.length - 1];
  }

  if (preference === "small") {
    return sorted.find((product) => isSmallVariant(product)) || sorted.find((product) => isStandardVariant(product)) || sorted[0];
  }

  return sorted.find((product) => isStandardVariant(product)) || sorted.find((product) => isSmallVariant(product)) || sorted[0];
}

function resolverProductoSemanticoPorPreferencias(texto, catalog = getCatalogProductsCache()) {
  const preferences = extractSemanticCatalogPreferences(texto);
  if (!preferences.families.size) {
    return null;
  }

  const hasGenericProductCue = preferences.genericTokens.some((token) => ["yogur", "yogurt", "yoghurt", "bebida"].includes(token));

  const families = Array.from(preferences.families)
    .map((family) => ({ family, products: catalog.filter((product) => (product?.nombre_raiz_familia || product?.nombre_familia) === family) }))
    .filter((entry) => entry.products.length);

  if (!families.length) {
    return null;
  }

  if (families.length > 1) {
    return {
      status: "ambiguous",
      candidate: limpiarTexto(texto),
      matches: buildCatalogAmbiguityOptions(families.flatMap((entry) => entry.products))
    };
  }

  const familyProducts = families[0].products;
  const shouldSuggestFamilyOptions = !preferences.wantsSmall
    && !preferences.wantsLarge
    && !preferences.wantsValue
    && familyProducts.length > 1
    && preferences.genericTokens.length > 0;

  if (shouldSuggestFamilyOptions) {
    return {
      status: "ambiguous",
      candidate: limpiarTexto(texto),
      matches: buildCatalogAmbiguityOptions(familyProducts)
    };
  }

  const preference = preferences.wantsValue ? "value" : (preferences.wantsLarge ? "large" : (preferences.wantsSmall ? "small" : "default"));
  const preferred = pickPreferredFamilyProduct(familyProducts, preference);

  if (!preferred) {
    return null;
  }

  return hasGenericProductCue
    ? {
        status: "suggested",
        candidate: limpiarTexto(texto),
        matches: buildCatalogAmbiguityOptions([preferred]),
        confidence: 68,
        soft: true
      }
    : {
        status: "matched",
        candidate: limpiarTexto(texto),
        product: preferred,
        confidence: preferences.wantsLarge || preferences.wantsSmall || preferences.wantsValue ? 84 : 80
      };
}

function resolverProductoContextualPorFamilia(texto, familyName, catalog = getCatalogProductsCache()) {
  const normalizedFamily = normalizeCatalogSemanticFamilyName(familyName);
  if (!normalizedFamily) {
    return null;
  }

  const resolution = resolverProductoSemanticoPorPreferencias(`${normalizedFamily} ${texto}`.trim(), catalog);
  if (resolution?.status === "matched" && resolution.product?.nombre) {
    return resolution.product;
  }

  if (resolution?.status === "suggested" && Array.isArray(resolution.matches) && resolution.matches[0]?.nombre) {
    return findCatalogProductByName(resolution.matches[0].nombre);
  }

  return null;
}

function resolverCantidadContextual(texto, { defaultQuantity = null } = {}) {
  const normalized = normalizarTextoAnalisis(texto);
  const cantidad = encontrarCantidadEnSegmento(normalized);
  if (cantidad) {
    return cantidad;
  }

  if (/\b(otro|otra|mas|más)\b/.test(normalized)) {
    return defaultQuantity || 1;
  }

  return defaultQuantity;
}

function normalizeProductResolverQuery(texto) {
  const original = normalizeCanonicalCatalogName(String(texto || ""));
  const requestedVariants = Array.from(original.matchAll(/\b(1800|1000|500|250|120)\b/g)).map((match) => match[1]);
  let normalized = normalizeCanonicalCatalogName(limpiarTextoProductoSolicitado(texto))
    .replace(/\byogou?rt\b/g, "yogur")
    .replace(/\byogurth\b/g, "yogur")
    .replace(/\bgari?ego\b/g, "griego")
    .replace(/\bkefyr\b/g, "kefir")
    .replace(/\bcafecito\b/g, "cafe")
    .replace(/\baloee\b/g, "aloe")
    .replace(/\blts?\b/g, "litro")
    .replace(/\blitros\b/g, "litro")
    .replace(/\bgrs?\b/g, "g")
    .replace(/\bmls\b/g, "ml")
    .replace(/\b(detalles|detalle)\b/g, "ancheta")
    .replace(/\s+/g, " ")
    .trim();

  if (requestedVariants.length) {
    normalized = `${normalized} ${requestedVariants.filter((variant) => !normalized.includes(variant)).join(" ")}`.trim();
  }

  return normalized;
}

function detectProductResolverFamilies(normalizedQuery = "") {
  const families = new Set();

  for (const [family, aliases] of SEMANTIC_FAMILY_KEYWORDS.entries()) {
    if (aliases.some((alias) => normalizedQuery.includes(normalizeCatalogText(alias)))) {
      families.add(family);
    }
  }

  return families;
}

function getProductResolverTokens(normalizedQuery = "") {
  return extractCatalogIdentityTokens(normalizedQuery, { keepGeneric: true })
    .filter((token) => !SIZE_SMALL_TOKENS.includes(token))
    .filter((token) => !SIZE_LARGE_TOKENS.includes(token));
}

function getProductResolverVariantMatcher(familyName, normalizedQuery) {
  const rule = PRODUCT_RESOLUTION_FAMILY_RULES[familyName];
  if (!rule?.variants?.length) {
    return null;
  }

  for (const variant of rule.variants) {
    if (variant.aliases.some((alias) => normalizedQuery.includes(normalizeCatalogText(alias)))) {
      return variant;
    }
  }

  return null;
}

function filterFamilyProductsForResolver(products = [], familyName, normalizedQuery = "") {
  let filtered = products.slice();
  const rule = PRODUCT_RESOLUTION_FAMILY_RULES[familyName] || null;

  if (rule?.subtypeTokens?.length) {
    const queryHasSubtype = rule.subtypeTokens.some((token) => normalizedQuery.includes(normalizeCatalogText(token)));
    if (!queryHasSubtype) {
      const withoutSubtype = filtered.filter((product) => !rule.subtypeTokens.some((token) => normalizeCanonicalCatalogName(product?.nombre).includes(normalizeCatalogText(token))));
      if (withoutSubtype.length) {
        filtered = withoutSubtype;
      }
    }
  }

  if (Array.isArray(rule?.flavorTokens) && rule.flavorTokens.length) {
    const queryFlavorTokens = rule.flavorTokens.filter((token) => normalizedQuery.includes(normalizeCatalogText(token)));
    if (queryFlavorTokens.length) {
      const flavorMatches = filtered.filter((product) => {
        const haystack = [product?.nombre, ...(product?.aliases || [])].map((value) => normalizeCanonicalCatalogName(value)).join(" ");
        return queryFlavorTokens.every((token) => haystack.includes(normalizeCatalogText(token)));
      });

      if (flavorMatches.length) {
        filtered = flavorMatches;
      }
    }
  }

  return filtered;
}

function buildResolverCandidates(products = [], normalizedQuery = "", { families = new Set() } = {}) {
  const queryTokens = getProductResolverTokens(normalizedQuery);
  const requestedVariantNumbers = Array.from(normalizedQuery.matchAll(/\b(1800|1000|500|250|120)\b/g)).map((match) => match[1]);

  return products.map((product) => {
    const haystack = [
      product?.nombre,
      product?.nombre_canonico,
      product?.nombre_familia,
      product?.nombre_raiz_familia,
      ...(product?.aliases || [])
    ].map((value) => normalizeCanonicalCatalogName(value)).filter(Boolean);
    const productTokens = new Set(haystack.flatMap((value) => extractCatalogIdentityTokens(value, { keepGeneric: true })));
    const overlap = queryTokens.filter((token) => productTokens.has(token));
    const familyName = product?.nombre_raiz_familia || product?.nombre_familia;
    const familyHit = families.has(familyName);
    const exactAlias = haystack.some((value) => value === normalizedQuery);
    const containsHit = haystack.some((value) => normalizedQuery.includes(value) || value.includes(normalizedQuery));
    const variantHit = requestedVariantNumbers.length
      ? requestedVariantNumbers.every((variant) => haystack.some((value) => value.includes(variant)))
      : true;

    let score = 0;
    if (exactAlias) score += 120;
    if (familyHit) score += 55;
    if (containsHit) score += 32;
    score += overlap.length * 14;
    if (!variantHit) score -= 12;

    return {
      product,
      familyName,
      overlap,
      exactAlias,
      containsHit,
      variantHit,
      score,
      haystack
    };
  }).filter((entry) => entry.exactAlias || entry.containsHit || entry.overlap.length || entry.score > 0)
    .sort((a, b) => (b.score - a.score)
      || ((b.overlap.length || 0) - (a.overlap.length || 0))
      || ((parseOptionalNumber(a.product?.precio) ?? Number.MAX_SAFE_INTEGER) - (parseOptionalNumber(b.product?.precio) ?? Number.MAX_SAFE_INTEGER)));
}

function logProductResolverInput(details = {}) {
  logEvent("PRODUCT_RESOLVER_INPUT", details);
}

function logProductResolverCandidates(details = {}) {
  logEvent("PRODUCT_RESOLVER_CANDIDATES", details);
}

function logProductResolverDecision(details = {}) {
  logEvent("PRODUCT_RESOLVER_DECISION", details);
}

function resolveProductFromCatalog(query, context = {}) {
  const candidate = limpiarTexto(query);
  const normalizedQuery = normalizeProductResolverQuery(query);
  const catalog = Array.isArray(context.catalog) ? context.catalog : getCatalogProductsCache();
  const families = detectProductResolverFamilies(normalizedQuery);
  const lockedFamily = families.size === 1 ? Array.from(families)[0] : null;
  const directPool = families.size
    ? catalog.filter((product) => Array.from(families).some((family) => matchesCatalogFamily(product, family)))
    : catalog;
  const workingPool = lockedFamily
    ? filterFamilyProductsForResolver(directPool, lockedFamily, normalizedQuery)
    : directPool;
  const variantMatcher = lockedFamily ? getProductResolverVariantMatcher(lockedFamily, normalizedQuery) : null;

  if (lockedFamily) {
    logEvent("PRODUCT_FAMILY_LOCK", {
      query: candidate,
      family: lockedFamily,
      normalizedQuery
    });
    logEvent("FAMILY_CATALOG_FILTER", {
      query: candidate,
      family: lockedFamily,
      catalogSize: catalog.length,
      filteredSize: workingPool.length
    });
  }

  logProductResolverInput({
    query: candidate,
    normalizedQuery,
    families: Array.from(families),
    catalogSize: catalog.length,
    workingPoolSize: workingPool.length
  });

  if (!normalizedQuery) {
    const result = { status: "not_found", query: candidate, normalizedQuery, candidates: [], reason: "empty_query" };
    logProductResolverDecision(result);
    return result;
  }

  if (variantMatcher && workingPool.length) {
    const variantMatches = workingPool.filter((product) => variantMatcher.pattern.test(normalizeCanonicalCatalogName(product?.nombre)));
    if (variantMatches.length === 1) {
      const result = { status: "resolved", query: candidate, normalizedQuery, product: variantMatches[0], reason: `family_variant:${variantMatcher.key}`, confidence: 97 };
      logProductResolverCandidates({ query: candidate, mode: "family_variant", candidates: variantMatches.map((product) => product?.nombre) });
      logProductResolverDecision({ ...result, product: result.product?.nombre || null });
      return result;
    }

    if (variantMatches.length > 1) {
      const options = buildCatalogAmbiguityOptions(variantMatches);
      const result = { status: "ambiguous", query: candidate, normalizedQuery, candidates: options, reason: `family_variant_ambiguous:${variantMatcher.key}`, confidence: 82 };
      logProductResolverCandidates({ query: candidate, mode: "family_variant_ambiguous", candidates: options.map((product) => product?.nombre) });
      logProductResolverDecision({ ...result, candidates: options.map((product) => product?.nombre) });
      return result;
    }
  }

  const deterministicCandidates = buildResolverCandidates(workingPool, normalizedQuery, { families });
  logProductResolverCandidates({
    query: candidate,
    mode: "deterministic_contains",
    candidates: deterministicCandidates.slice(0, 5).map((entry) => ({
      product: entry.product?.nombre || null,
      score: entry.score,
      overlap: entry.overlap
    }))
  });

  if (deterministicCandidates.length === 1) {
    const winner = deterministicCandidates[0];
    const result = { status: "resolved", query: candidate, normalizedQuery, product: winner.product, reason: "deterministic_single", confidence: 95 };
    logProductResolverDecision({ ...result, product: winner.product?.nombre || null });
    return result;
  }

  if (deterministicCandidates.length > 1) {
    const [best, second] = deterministicCandidates;
    const exactAliasCandidates = deterministicCandidates.filter((entry) => entry.exactAlias);
    if (exactAliasCandidates.length === 1) {
      const result = { status: "resolved", query: candidate, normalizedQuery, product: exactAliasCandidates[0].product, reason: "deterministic_exact_alias", confidence: 97 };
      logProductResolverDecision({ ...result, product: result.product?.nombre || null });
      return result;
    }

    const exactOnly = deterministicCandidates.filter((entry) => entry.exactAlias || entry.containsHit || entry.overlap.length === best.overlap.length);
    const queryLooksGenericFamily = families.size === 1 && getProductResolverTokens(normalizedQuery).every((token) => normalizeCatalogText(Array.from(families)[0]).includes(token) || token === Array.from(families)[0]);

    if (!queryLooksGenericFamily && best.score >= ((second?.score || 0) + 18)) {
      const result = { status: "resolved", query: candidate, normalizedQuery, product: best.product, reason: "deterministic_best", confidence: 90 };
      logProductResolverDecision({ ...result, product: best.product?.nombre || null });
      return result;
    }

    const options = buildCatalogAmbiguityOptions((exactOnly.length ? exactOnly : deterministicCandidates).map((entry) => entry.product));
    if (options.length === 1) {
      const matchedProduct = workingPool.find((product) => product?.id === options[0].id) || best.product || null;
      const result = matchedProduct ? { status: "resolved", query: candidate, normalizedQuery, product: matchedProduct, reason: "deterministic_single_option", confidence: 90 } : { status: "not_found", query: candidate, normalizedQuery, candidates: [], reason: "deterministic_empty" };
      logProductResolverDecision({ ...result, product: result.product?.nombre || null });
      return result;
    }

    const result = { status: "ambiguous", query: candidate, normalizedQuery, candidates: options, reason: "deterministic_ambiguous", confidence: 78 };
    logProductResolverDecision({ ...result, candidates: options.map((product) => product?.nombre) });
    return result;
  }

  const fuzzyMatches = encontrarCoincidenciasCatalogo(query, {
    minScore: families.size ? 68 : 72,
    limit: 3
  }).filter((entry) => !families.size || Array.from(families).some((family) => matchesCatalogFamily(entry.product, family)));

  logProductResolverCandidates({
    query: candidate,
    mode: "fuzzy",
    candidates: fuzzyMatches.map((entry) => ({ product: entry.product?.nombre || null, score: entry.score, confidence: entry.confidence }))
  });

  if (!fuzzyMatches.length) {
    const result = { status: "not_found", query: candidate, normalizedQuery, candidates: [], reason: families.size ? "family_not_found" : "catalog_not_found" };
    logProductResolverDecision(result);
    return result;
  }

  if (fuzzyMatches.length === 1 || ((fuzzyMatches[0]?.score || 0) - (fuzzyMatches[1]?.score || 0)) >= 10) {
    const result = { status: "resolved", query: candidate, normalizedQuery, product: fuzzyMatches[0].product, reason: "fuzzy_best", confidence: fuzzyMatches[0].confidence };
    logProductResolverDecision({ ...result, product: result.product?.nombre || null });
    return result;
  }

  const options = buildCatalogAmbiguityOptions(fuzzyMatches.map((entry) => entry.product));
  if (options.length === 1) {
    const result = { status: "resolved", query: candidate, normalizedQuery, product: fuzzyMatches[0].product, reason: "fuzzy_single_option", confidence: fuzzyMatches[0].confidence };
    logProductResolverDecision({ ...result, product: result.product?.nombre || null });
    return result;
  }
  const result = { status: "ambiguous", query: candidate, normalizedQuery, candidates: options, reason: "fuzzy_ambiguous", confidence: fuzzyMatches[0].confidence };
  logProductResolverDecision({ ...result, candidates: options.map((product) => product?.nombre) });
  return result;
}

function resolverProductoCatalogo(texto) {
  const resolution = resolveProductFromCatalog(texto);
  const candidate = limpiarTexto(texto);

  if (resolution.status === "resolved") {
    return {
      status: "matched",
      candidate,
      product: resolution.product,
      confidence: resolution.confidence || 95
    };
  }

  if (resolution.status === "ambiguous") {
    return {
      status: "ambiguous",
      candidate,
      matches: resolution.candidates,
      confidence: resolution.confidence || 78,
      soft: false
    };
  }

  return {
    status: "not_found",
    candidate
  };
}

function resolverProductoAliasLocal(texto) {
  const normalized = normalizarTextoAnalisis(texto);

  if (!normalized) {
    return { status: "not_found" };
  }

  for (const [alias, canonical] of PRODUCT_ALIAS_INDEX.entries()) {
    const aliasPattern = new RegExp(`(^|\\b)${escapeRegex(alias)}(\\b|$)`, "i");

    if (aliasPattern.test(normalized) && PRODUCT_CANONICAL_DETAILS[canonical]) {
      return {
        status: "matched",
        canonical,
        details: PRODUCT_CANONICAL_DETAILS[canonical]
      };
    }
  }

  return { status: "not_found" };
}

function findCatalogProductForCanonicalAlias(canonical) {
  const aliases = PRODUCT_NORMALIZATION[canonical] || [];
  const normalizedAliases = aliases.map((alias) => normalizeCatalogText(alias)).filter(Boolean);

  if (!normalizedAliases.length) {
    return null;
  }

  return getCatalogProductsCache().find((product) => {
    const productAliases = Array.isArray(product.aliases) ? product.aliases : [];
    return normalizedAliases.some((alias) => productAliases.includes(alias));
  }) || null;
}

function consolidarItemsPedido(items = []) {
  const grouped = new Map();

  for (const item of items) {
    const producto = limpiarTexto(item?.producto);
    const sabor = limpiarTexto(item?.sabor);
    const itemCustomizations = mergeCustomizations([], Array.isArray(item?.customizations) ? item.customizations : []);
    const productNotes = limpiarTexto(item?.product_notes ?? item?.productNotes) || buildNotesFromCustomizations(itemCustomizations);
    const cantidad = Number.isFinite(Number(item?.cantidad)) && Number(item.cantidad) > 0
      ? Number(item.cantidad)
      : null;
    const precioUnitario = parseOptionalNumber(item?.precioUnitario ?? item?.precio_unitario);
    const subtotal = parseOptionalNumber(item?.subtotal);

    if (!producto && !sabor && !cantidad) {
      continue;
    }

    const key = `${producto || "sin-producto"}::${sabor || "sin-sabor"}::${productNotes || "sin-nota"}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        producto: producto || null,
        sabor: sabor || null,
        cantidad: cantidad || 0,
        precio_unitario: precioUnitario,
        subtotal: subtotal,
        product_notes: productNotes,
        customizations: itemCustomizations
      });
      continue;
    }

    const current = grouped.get(key);
    current.cantidad += cantidad || 0;
    current.precio_unitario = current.precio_unitario ?? precioUnitario;
    current.subtotal = (current.subtotal ?? 0) + (subtotal ?? 0);
    current.customizations = mergeCustomizations(current.customizations, itemCustomizations);
    current.product_notes = current.product_notes || productNotes || buildNotesFromCustomizations(current.customizations);
  }

  return Array.from(grouped.values()).map((item) => ({
    ...item,
    cantidad: item.cantidad || null,
    subtotal: item.subtotal || null,
    product_notes: item.product_notes || buildNotesFromCustomizations(item.customizations),
    customizations: mergeCustomizations([], item.customizations)
  }));
}

function extraerMetodoPagoDesdeTexto(texto) {
  const normalized = normalizarTextoAnalisis(texto);

  for (const [alias, canonical] of PAYMENT_ALIASES.entries()) {
    if (normalized.includes(normalizarTextoAnalisis(alias))) {
      return canonical;
    }
  }

  return null;
}

function esDireccionIncompleta(direccion) {
  const normalized = normalizarTextoAnalisis(direccion);
  if (!normalized) {
    return true;
  }

  if (/^(centro|barrio\s+.+)$/.test(normalized) && !/#|\d+\s*-\s*\d+/.test(normalized)) {
    return true;
  }

  if (/^(cl|cll|calle|cra|cr|carrera|av|avenida)\s+\d+[a-z]?$/.test(normalized)) {
    return true;
  }

  const hasExactPoint = /#|\b\d+\s*-\s*\d+\b|\b\d+\s+\d+\s+\d+\b/.test(normalized);
  const hasReference = /\b(frente|esquina|porton|porter[aí]a|referencia|casa|apto|apartamento|torre|bloque|conjunto)\b/.test(normalized);
  return !(hasExactPoint || hasReference);
}

function extraerDireccionDesdeTexto(texto, { lastAddress = null } = {}) {
  const raw = String(texto || "").trim();
  const normalized = normalizarTextoAnalisis(raw);

  if (!raw) {
    return null;
  }

  if (PARTIAL_ADDRESS_REFERENCE_TOKENS.some((token) => normalized.includes(normalizarTextoAnalisis(token)))) {
    return limpiarTexto(lastAddress || null);
  }

  const labeledMatch = raw.match(/(?:direcci[oó]n|direccion)\s*[:\-]?\s*(.+?)(?=(?:\.|,|\s+pago\b|\s+nequi\b|\s+daviplata\b|\s+efectivo\b|\s+transferencia\b|$))/i);

  if (labeledMatch?.[1]) {
    return limpiarTexto(labeledMatch[1]);
  }

  const keywordMatch = raw.match(new RegExp(`((?:calle|cll|cl|carrera|cra|cr|avenida|av\\.?|barrio|manzana|mz|casa|apartamento|apto|torre|bloque|centro)[^,.]*)`, "i"));
  if (keywordMatch?.[1]) {
    return limpiarTexto(String(keywordMatch[1]).replace(/\s+(?:pago|nequi|daviplata|efectivo|transferencia)\b.*$/i, ""));
  }

  if (/^(centro|barrio\s+.+)$/i.test(raw)) {
    return limpiarTexto(raw);
  }

  const compactStreetMatch = raw.match(/^(?:cl|cll|calle|cra|cr|carrera)\s*\d+[a-z]?(?:\s*(?:#|nro|numero)?\s*\d+[a-z]?(?:\s*[- ]\s*\d+[a-z]?)?)?$/i);
  if (compactStreetMatch?.[0]) {
    return limpiarTexto(compactStreetMatch[0]);
  }

  return null;
}

function extraerClienteDesdeTexto(texto) {
  const raw = String(texto || "").trim();
  const match = raw.match(/(?:soy|habla|mi nombre es)\s+([a-zA-ZÁÉÍÓÚáéíóúñÑ ]{2,40})/i);
  return limpiarTexto(match?.[1] || null);
}

function construirFechaLocal(baseDate, year, month, day, hour = 9, minute = 0) {
  void baseDate;
  return new Date(Date.UTC(year, month, day, hour, minute, 0, 0) - (DELIVERY_TIMEZONE_OFFSET_MINUTES * 60 * 1000));
}

function obtenerPartesFechaServicio(baseDate = new Date()) {
  const shifted = new Date(baseDate.getTime() + (DELIVERY_TIMEZONE_OFFSET_MINUTES * 60 * 1000));

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay()
  };
}

function parseHoraEntrega(raw) {
  const timeMatch = String(raw || "").match(/(?:\b(?:a\s+las|para\s+las|a\s+la|tipo|sobre\s+las)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b)|(?:\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b)/i);
  const normalized = normalizarTextoAnalisis(raw);

  if (timeMatch) {
    const hoursToken = timeMatch[1] || timeMatch[4];
    const minutesToken = timeMatch[2] || timeMatch[5];
    const meridiemToken = timeMatch[3] || timeMatch[6];
    let hours = Number(hoursToken);
    const minutes = Number(minutesToken || 0);
    const meridiem = String(meridiemToken || "").toLowerCase();

    if (meridiem === "pm" && hours < 12) {
      hours += 12;
    }

    if (meridiem === "am" && hours === 12) {
      hours = 0;
    }

    if (!meridiem) {
      if (/\bmanana\b/.test(normalized) && hours === 12) {
        hours = 12;
      } else if (/\b(tarde|noche)\b/.test(normalized) && hours >= 1 && hours <= 7) {
        hours += 12;
      }
    }

    return { hour: hours, minute: minutes, explicitTime: true };
  }

  if (/\b(en la )?manana\b/.test(normalized)) {
    return { hour: 9, minute: 0, explicitTime: false };
  }

  if (/\b(en la )?tarde\b/.test(normalized)) {
    return { hour: 15, minute: 0, explicitTime: false };
  }

  if (/\b(en la )?noche\b/.test(normalized)) {
    return { hour: 19, minute: 0, explicitTime: false };
  }

  return { hour: 9, minute: 0, explicitTime: false };
}

function parseFechaExplicita(raw, now = new Date()) {
  const slashMatch = String(raw || "").match(/(?<![#\d])(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  const timeInfo = parseHoraEntrega(raw);
  const nowParts = obtenerPartesFechaServicio(now);

  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]) - 1;
    const year = slashMatch[3]
      ? Number(String(slashMatch[3]).length === 2 ? `20${slashMatch[3]}` : slashMatch[3])
      : nowParts.year;

    if (day < 1 || day > 31 || month < 0 || month > 11) {
      return null;
    }

    return {
      value: construirFechaLocal(now, year, month, day, timeInfo.hour, timeInfo.minute).toISOString(),
      source: "explicit"
    };
  }

  const monthMatch = String(raw || "").match(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?\b/i);
  if (monthMatch) {
    const day = Number(monthMatch[1]);
    const month = MONTH_INDEX.get(normalizarTextoAnalisis(monthMatch[2]));
    const year = monthMatch[3] ? Number(monthMatch[3]) : nowParts.year;

    if (month !== undefined && day >= 1 && day <= 31) {
      return {
        value: construirFechaLocal(now, year, month, day, timeInfo.hour, timeInfo.minute).toISOString(),
        source: "explicit"
      };
    }
  }

  return null;
}

function parseFechaRelativa(raw, now = new Date()) {
  const normalized = normalizarTextoAnalisis(raw);
  if (!normalized) {
    return null;
  }

  const timeInfo = parseHoraEntrega(raw);
  const base = new Date(now);
  base.setSeconds(0, 0);
  const nowParts = obtenerPartesFechaServicio(now);

  if (/\bhoy\b/.test(normalized)) {
    const date = construirFechaLocal(base, nowParts.year, nowParts.month, nowParts.day, timeInfo.hour, timeInfo.minute);
    return date >= now ? { value: date.toISOString(), source: "relative" } : null;
  }

  if (/\bmanana\b/.test(normalized)) {
    const tomorrow = construirFechaLocal(base, nowParts.year, nowParts.month, nowParts.day + 1, timeInfo.hour, timeInfo.minute);
    const date = new Date(tomorrow);
    return { value: date.toISOString(), source: "relative" };
  }

  const weekdayMatch = normalized.match(/\b(?:el|este|pr[oó]ximo)?\s*(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/);
  if (weekdayMatch) {
    const targetWeekday = WEEKDAY_INDEX.get(weekdayMatch[1]);
    if (targetWeekday !== undefined) {
      const currentWeekday = nowParts.weekday;
      let delta = (targetWeekday - currentWeekday + 7) % 7;
      if (delta === 0 && (timeInfo.explicitTime ? construirFechaLocal(base, nowParts.year, nowParts.month, nowParts.day, timeInfo.hour, timeInfo.minute) < now : false)) {
        delta = 7;
      }
      if (delta === 0 && !/\bhoy\b/.test(normalized)) {
        delta = 7;
      }
      const date = construirFechaLocal(base, nowParts.year, nowParts.month, nowParts.day + delta, timeInfo.hour, timeInfo.minute);
      return { value: date.toISOString(), source: "relative" };
    }
  }

  return null;
}

function sanitizeFechaEntregaIA(value, raw, now = new Date()) {
  const cleaned = limpiarTexto(value);
  if (!cleaned) {
    return null;
  }

  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (parseFechaExplicita(raw, now)) {
    return parsed.toISOString();
  }

  return parsed >= now ? parsed.toISOString() : null;
}

function extraerFechaEntregaDesdeTexto(texto) {
  const raw = String(texto || "").trim();
  const now = new Date();

  return parseFechaExplicita(raw, now)?.value
    || parseFechaRelativa(raw, now)?.value
    || null;
}

function encontrarCantidadEnSegmento(segmentoNormalizado) {
  const match = String(segmentoNormalizado || "").match(new RegExp(`(?:^|\\b(?:quiero|quisiera|necesito|pedido|pedir|ordeno|encargo|comprar|llevo|dame|enviame|enviarme|agrega|agregame|agregale|suma|sumale|ponme|mandame)\\s+)(${QUANTITY_TOKEN_PATTERN})\\b`, "i"));
  return obtenerNumeroDesdeToken(match?.[1] || null);
}

function construirCandidatosProductoIA(item = {}) {
  const candidates = [
    [item.producto, item.sabor].filter(Boolean).join(" "),
    item.producto,
    item.sabor
  ];

  return [...new Set(candidates.map((value) => limpiarTexto(value)).filter(Boolean))];
}

function segmentarPosiblesProductos(texto) {
  return String(texto || "")
    .split(/(?:,|;|\n|\.|\s+y\s+)/i)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function parseListOrderLine(segmento) {
  const raw = String(segmento || "").trim();
  if (!raw) {
    return null;
  }

  const verbStartMatch = raw.match(new RegExp(`^(?:quiero|necesito|agrega(?:me)?|agrégame|dame|mandame|mándame|ponme|enviame|envíame)\\s+(${QUANTITY_TOKEN_PATTERN})\\b\\s+(.+)$`, "i"));
  if (verbStartMatch?.[1] && verbStartMatch?.[2]) {
    const cantidad = obtenerNumeroDesdeToken(verbStartMatch[1]);
    const producto = limpiarTexto(verbStartMatch[2]);
    if (cantidad && producto) {
      return { raw, cantidad, productText: producto, quantityPosition: "verb_start" };
    }
  }

  const startMatch = raw.match(new RegExp(`^(${QUANTITY_TOKEN_PATTERN})\\b\\s+(.+)$`, "i"));
  if (startMatch?.[1] && startMatch?.[2]) {
    const cantidad = obtenerNumeroDesdeToken(startMatch[1]);
    const producto = limpiarTexto(startMatch[2]);
    if (cantidad && producto) {
      return { raw, cantidad, productText: producto, quantityPosition: "start" };
    }
  }

  const endMatch = raw.match(new RegExp(`^(.+?)\\s+(${QUANTITY_TOKEN_PATTERN})$`, "i"));
  if (endMatch?.[1] && endMatch?.[2]) {
    const cantidad = obtenerNumeroDesdeToken(endMatch[2]);
    const producto = limpiarTexto(endMatch[1]);
    const looksLikePresentationTail = /\\bde\\s*$/i.test(producto || "") || /\\b(ml|g|gr|litro|garrafa|kilo|kg)\\s*$/i.test(producto || "") || cantidad > 24;
    if (cantidad && producto && !looksLikePresentationTail) {
      return { raw, cantidad, productText: producto, quantityPosition: "end" };
    }
  }

  return null;
}
function analizarPedidoFormatoLista(texto) {
  const lines = String(texto || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const parsedItems = lines
    .map((line) => parseListOrderLine(line))
    .filter(Boolean)
    .map((item) => ({
      ...item,
      hasCatalogHint: encontrarCoincidenciasCatalogo(item.productText, { minScore: 55, limit: 1 }).length > 0
    }));

  const multiLine = lines.length > 1;
  const parsedCount = parsedItems.length;
  const confidence = multiLine
    ? (parsedCount === lines.length ? 98 : (parsedCount >= 2 ? 90 : 0))
    : (parsedCount === 1 ? 84 : 0);

  return {
    detected: confidence >= 84,
    confidence,
    multiLine,
    lineCount: lines.length,
    parsedCount,
    items: parsedItems
  };
}

function esCoincidenciaConfiableParaLineaPedido(parsedLineItem, product) {
  if (!parsedLineItem || !product) {
    return true;
  }

  const customizations = extractCustomizationsFromText(parsedLineItem.productText || "");
  const baseProductText = stripCustomizationsFromText(parsedLineItem.productText || "", customizations) || parsedLineItem.productText;
  const requestedTokens = tokenizarCatalogo(baseProductText, { keepGeneric: false })
    .filter((token) => !LIST_ORDER_NON_IDENTITY_TOKENS.has(token));
  if (!requestedTokens.length) {
    return true;
  }

  const productTokens = new Set([
    ...tokenizarCatalogo(product?.nombre, { keepGeneric: false }),
    ...tokenizarCatalogo(product?.nombre_canonico, { keepGeneric: false }),
    ...tokenizarCatalogo(product?.nombre_familia, { keepGeneric: false }),
    ...tokenizarCatalogo(product?.nombre_raiz_familia, { keepGeneric: false }),
    ...((product?.aliases || []).flatMap((alias) => tokenizarCatalogo(alias, { keepGeneric: false })))
  ].filter((token) => !LIST_ORDER_NON_IDENTITY_TOKENS.has(token)));

  return requestedTokens.some((token) => productTokens.has(token));
}

function expandirSegmentoMultiProducto(segmento) {
  const raw = String(segmento || "").trim();
  if (!raw) {
    return [];
  }

  const itemStartPattern = new RegExp(`(?:^|\\s)(${QUANTITY_TOKEN_PATTERN})\\s+(?=(?:${SEGMENT_START_TOKENS_PATTERN})\\b)`, "gi");
  const starts = Array.from(raw.matchAll(itemStartPattern)).map((match) => {
    const token = match[1] || "";
    return (match.index || 0) + match[0].lastIndexOf(token);
  });

  if (starts.length <= 1) {
    return [raw];
  }

  return starts.map((start, index) => {
    const end = index < starts.length - 1 ? starts[index + 1] : raw.length;
    const prefix = index === 0 ? raw.slice(0, start) : "";
    return `${prefix}${raw.slice(start, end)}`.trim();
  }).filter(Boolean);
}

function esSegmentoNoProducto(segmento) {
  const normalized = normalizarTextoAnalisis(segmento);
  if (!normalized) {
    return true;
  }

  const hasPurchaseIntent = /\b(quiero|quisiera|necesito|pedido|pedir|ordeno|encargo|comprar|me regalas|dame|enviame|enviarme|agrega|agregame|agregale|suma|sumale|ponme|mandame)\b/i.test(normalized);
  const hasQuantity = /\b(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/i.test(normalized);

  if (hasPurchaseIntent || hasQuantity) {
    return false;
  }

  return /\b(direccion|dirección|pago|nequi|daviplata|efectivo|transferencia|calle|carrera|cra|barrio|entrega|hoy|manana|mañana|pm|am)\b/i.test(normalized);
}

function analizarProductosCatalogoDesdeTexto(texto, aiProducts = [], customerType = "public") {
  const segments = segmentarPosiblesProductos(texto).flatMap((segment) => expandirSegmentoMultiProducto(segment));
  const items = [];
  const ambiguities = [];
  const unmatched = [];

  const parsedLineItems = analizarPedidoFormatoLista(texto);
  if (parsedLineItems.parsedCount) {
    logEvent("PARSED_LINE_ITEMS", {
      totalLines: parsedLineItems.lineCount,
      parsedCount: parsedLineItems.parsedCount,
      items: parsedLineItems.items.map((item) => ({ raw: item.raw, quantity: item.cantidad, productText: item.productText, position: item.quantityPosition }))
    });
  }

  for (const segment of segments) {
    const parsedLineItem = parseListOrderLine(segment);
    const resolutionInput = parsedLineItem?.productText || segment;
    const segmentCustomizations = extractCustomizationsFromText(segment);
    const baseResolutionInput = stripCustomizationsFromText(resolutionInput, segmentCustomizations) || resolutionInput;
    const quickMatches = encontrarCoincidenciasCatalogo(baseResolutionInput, { minScore: 70, limit: 2 });
    const hasQuantity = parsedLineItem?.cantidad || encontrarCantidadEnSegmento(normalizarTextoAnalisis(segment));
    const looksLikeProductQuery = esConsultaProductoProbable(baseResolutionInput);

    if (esSegmentoNoProducto(segment) && !quickMatches.length && !hasQuantity) {
      continue;
    }

    if (!quickMatches.length && !hasQuantity && !looksLikeProductQuery) {
      continue;
    }

    const directResolution = resolverProductoCatalogo(resolutionInput);
    const usedBaseResolution = baseResolutionInput !== resolutionInput && directResolution.status === "not_found";
    const resolution = usedBaseResolution ? resolverProductoCatalogo(baseResolutionInput) : directResolution;
    const noteSourceText = usedBaseResolution ? segment : null;
    const noteBaseQuery = usedBaseResolution ? baseResolutionInput : null;
    const shouldApplySegmentCustomizations = segmentCustomizations.length > 0 && !productAlreadySatisfiesCustomizations(resolution.product, segmentCustomizations);
    if (resolution.status === "matched" && esCoincidenciaConfiableParaLineaPedido(parsedLineItem, resolution.product)) {
      logEvent("PRODUCT_MATCH_CONFIDENCE", {
        input: usedBaseResolution ? baseResolutionInput : resolutionInput,
        status: resolution.status,
        confidence: resolution.confidence || 100,
        product: resolution.product?.nombre || null
      });
      logConfidenceLevel({ source: "catalog_match", stage: "line_item", confidence: resolution.confidence || 100, input: usedBaseResolution ? baseResolutionInput : resolutionInput });
      const cantidad = parsedLineItem?.cantidad || encontrarCantidadEnSegmento(normalizarTextoAnalisis(segment)) || 1;
      const resolvedPrice = resolveCatalogPriceForCustomer(resolution.product, customerType);
      const precioUnitario = parseOptionalNumber(resolvedPrice.unitPrice);

      const resolvedItem = {
        producto: resolution.product.nombre,
        sabor: null,
        cantidad,
        precio_unitario: precioUnitario,
        subtotal: precioUnitario !== null ? precioUnitario * cantidad : null,
        price_source: resolvedPrice.priceSource
      };
      if (shouldApplySegmentCustomizations) {
        logSpecialInstructionScope({ sourceText: noteSourceText || segment, product: resolvedItem.producto, customizations: segmentCustomizations });
      }
      items.push(shouldApplySegmentCustomizations
        ? applyProductCustomizations(resolvedItem, segmentCustomizations, { sourceText: noteSourceText || segment, baseQuery: noteBaseQuery || baseResolutionInput })
        : resolvedItem);
      continue;
    }

    if ((resolution.status === "ambiguous" || resolution.status === "suggested") && Array.isArray(resolution.matches) && resolution.matches.length === 1) {
      const singleOption = resolution.matches[0];
      const matchedProduct = findCatalogProductByName(singleOption?.nombre);
      if (matchedProduct) {
        const cantidad = parsedLineItem?.cantidad || encontrarCantidadEnSegmento(normalizarTextoAnalisis(segment)) || 1;
        const resolvedPrice = resolveCatalogPriceForCustomer(matchedProduct, customerType);
        const precioUnitario = parseOptionalNumber(resolvedPrice.unitPrice);
        const resolvedItem = {
          producto: matchedProduct.nombre,
          sabor: null,
          cantidad,
          precio_unitario: precioUnitario,
          subtotal: precioUnitario !== null ? precioUnitario * cantidad : null,
          price_source: resolvedPrice.priceSource
        };
        logEvent("PRODUCT_MATCH_CONFIDENCE", {
          input: usedBaseResolution ? baseResolutionInput : resolutionInput,
          status: "matched",
          confidence: resolution.confidence || 82,
          product: matchedProduct.nombre
        });
        if (shouldApplySegmentCustomizations) {
          logSpecialInstructionScope({ sourceText: noteSourceText || segment, product: resolvedItem.producto, customizations: segmentCustomizations });
        }
        items.push(shouldApplySegmentCustomizations
          ? applyProductCustomizations(resolvedItem, segmentCustomizations, { sourceText: noteSourceText || segment, baseQuery: noteBaseQuery || baseResolutionInput })
          : resolvedItem);
        continue;
      }
    }

    if (resolution.status === "ambiguous" || resolution.status === "suggested") {
      logEvent("PRODUCT_MATCH_CONFIDENCE", {
        input: usedBaseResolution ? baseResolutionInput : resolutionInput,
        status: resolution.status,
        confidence: resolution.confidence || null,
        options: (resolution.matches || []).map((option) => option?.nombre).filter(Boolean)
      });
      logConfidenceLevel({ source: "catalog_match", stage: "line_item", confidence: resolution.confidence || 55, input: usedBaseResolution ? baseResolutionInput : resolutionInput });
      ambiguities.push({
        input: usedBaseResolution ? baseResolutionInput : resolutionInput,
        options: (resolution.matches || (resolution.product ? [resolution.product] : [])).slice(0, 3),
        soft: Boolean(resolution.soft || resolution.status === "suggested"),
        confidence: resolution.confidence || null,
        customizations: shouldApplySegmentCustomizations ? segmentCustomizations : []
      });
      continue;
    }

    const localAliasResolution = resolverProductoAliasLocal(baseResolutionInput);
    if (localAliasResolution.status === "matched") {
      const cantidad = parsedLineItem?.cantidad || encontrarCantidadEnSegmento(normalizarTextoAnalisis(segment)) || 1;
      const catalogProduct = findCatalogProductForCanonicalAlias(localAliasResolution.canonical);

      if (!catalogProduct || !esCoincidenciaConfiableParaLineaPedido(parsedLineItem, catalogProduct)) {
        unmatched.push(resolutionInput);
        continue;
      }

      const resolvedPrice = resolveCatalogPriceForCustomer(catalogProduct, customerType);
      const precioUnitario = parseOptionalNumber(resolvedPrice.unitPrice);

      const resolvedItem = {
        producto: catalogProduct.nombre,
        sabor: null,
        cantidad,
        precio_unitario: precioUnitario,
        subtotal: precioUnitario !== null ? precioUnitario * cantidad : null,
        price_source: resolvedPrice.priceSource
      };
      if (segmentCustomizations.length && !productAlreadySatisfiesCustomizations(catalogProduct, segmentCustomizations)) {
        logSpecialInstructionScope({ sourceText: segment, product: resolvedItem.producto, customizations: segmentCustomizations });
      }
      items.push(segmentCustomizations.length && !productAlreadySatisfiesCustomizations(catalogProduct, segmentCustomizations)
        ? applyProductCustomizations(resolvedItem, segmentCustomizations, { sourceText: segment, baseQuery: baseResolutionInput })
        : resolvedItem);
      continue;
    }

    if (hasQuantity || quickMatches.length || looksLikeProductQuery) {
      logEvent("PRODUCT_MATCH_CONFIDENCE", {
        input: baseResolutionInput,
        status: "not_found",
        confidence: 0,
        options: quickMatches.map((entry) => entry.product?.nombre).filter(Boolean)
      });
      logConfidenceLevel({ source: "catalog_match", stage: "line_item", confidence: 0, input: baseResolutionInput });
      unmatched.push(baseResolutionInput);
    }
  }

  if (Array.isArray(aiProducts) && aiProducts.length && (!items.length || ambiguities.length || unmatched.length || items.length < aiProducts.length)) {
    for (const aiItem of aiProducts) {
      let resolved = false;
      const candidateSegments = [...new Set(construirCandidatosProductoIA(aiItem).flatMap((candidate) => expandirSegmentoMultiProducto(candidate)).map((candidate) => limpiarTexto(candidate)).filter(Boolean))];

      for (const candidate of candidateSegments) {
        const candidateCustomizations = extractCustomizationsFromText(candidate);
        const baseCandidate = stripCustomizationsFromText(candidate, candidateCustomizations) || candidate;
        const directResolution = resolverProductoCatalogo(candidate);
        const usedBaseResolution = baseCandidate !== candidate && directResolution.status === "not_found";
        const resolution = usedBaseResolution ? resolverProductoCatalogo(baseCandidate) : directResolution;
        if (resolution.status === "matched") {
          const cantidadDetectada = encontrarCantidadEnSegmento(normalizarTextoAnalisis(candidate));
          const cantidad = cantidadDetectada || (Number.isFinite(Number(aiItem?.cantidad)) && Number(aiItem.cantidad) > 0
            ? Number(aiItem.cantidad)
            : 1);
          const resolvedPrice = resolveCatalogPriceForCustomer(resolution.product, customerType);
          const precioUnitario = parseOptionalNumber(resolvedPrice.unitPrice);
          const expectedNotes = usedBaseResolution ? buildNotesFromCustomizations(candidateCustomizations) : null;
          const alreadyPresent = items.some((item) => normalizeCatalogText(item?.producto) === normalizeCatalogText(resolution.product.nombre)
            && limpiarTexto(item?.product_notes ?? item?.productNotes) === limpiarTexto(expectedNotes));

          if (!alreadyPresent) {
          const resolvedItem = {
            producto: resolution.product.nombre,
            sabor: null,
            cantidad,
            precio_unitario: precioUnitario,
            subtotal: precioUnitario !== null ? precioUnitario * cantidad : null,
            price_source: resolvedPrice.priceSource
          };
            if (candidateCustomizations.length && !productAlreadySatisfiesCustomizations(resolution.product, candidateCustomizations)) {
              logSpecialInstructionScope({ sourceText: candidate, product: resolvedItem.producto, customizations: candidateCustomizations });
            }
            items.push(candidateCustomizations.length && !productAlreadySatisfiesCustomizations(resolution.product, candidateCustomizations)
              ? applyProductCustomizations(resolvedItem, candidateCustomizations, { sourceText: candidate, baseQuery: baseCandidate })
              : resolvedItem);
          }

          for (let index = unmatched.length - 1; index >= 0; index -= 1) {
            if (encontrarCoincidenciasCatalogo(unmatched[index], { minScore: 60, limit: 1 }).some((entry) => entry.product?.id === resolution.product.id)) {
              unmatched.splice(index, 1);
            }
          }

          resolved = true;
          continue;
        }

        if (resolution.status === "ambiguous" || resolution.status === "suggested") {
          const resolutionOptions = (resolution.matches || (resolution.product ? [resolution.product] : [])).slice(0, 3);
          const ambiguityAlreadyCovered = resolutionOptions.some((option) => items.some((item) => normalizeCatalogText(item?.producto) === normalizeCatalogText(option?.nombre))) && !/\b(?:y|,|;|\n)\b/i.test(candidate);
          const alreadyAmbiguous = ambiguities.some((entry) => normalizeCatalogText(entry?.input) === normalizeCatalogText(candidate));
          if (!ambiguityAlreadyCovered && !alreadyAmbiguous) {
            ambiguities.push({
              input: usedBaseResolution ? baseCandidate : candidate,
              options: resolutionOptions,
              soft: Boolean(resolution.soft || resolution.status === "suggested"),
              confidence: resolution.confidence || null,
              customizations: usedBaseResolution ? candidateCustomizations : []
            });
          }
          resolved = true;
        }
      }

      if (!resolved) {
        const fallbackCandidate = candidateSegments[0] || construirCandidatosProductoIA(aiItem)[0];
        if (fallbackCandidate && !unmatched.some((entry) => normalizeCatalogText(entry) === normalizeCatalogText(fallbackCandidate))) {
          unmatched.push(fallbackCandidate);
        }
      }
    }
  }

  const normalizedSource = normalizarTextoAnalisis(texto);
  const hasDanglingSecondaryReference = /\b(lo otro|el otro|otro normal)\b/.test(normalizedSource);
  if (hasDanglingSecondaryReference && items.length && !ambiguities.length && !unmatched.length) {
    unmatched.push("lo otro");
  }

  const consolidatedItems = consolidarItemsPedido(items);
  logEvent("VALIDATED_ORDER_ITEMS", {
    sourceText: limpiarTexto(texto),
    itemCount: consolidatedItems.length,
    items: consolidatedItems.map((item) => ({ producto: item?.producto || null, cantidad: item?.cantidad || null, precio_unitario: item?.precio_unitario || null })),
    ambiguityCount: ambiguities.length,
    unmatchedCount: unmatched.length
  });

  return {
    items: consolidatedItems,
    ambiguities: ambiguities.filter((entry, index, list) => {
      const currentKey = `${String(entry?.input || "").replace(new RegExp(`^${QUANTITY_TOKEN_PATTERN}\\s+`, "i"), "").trim()}|${(entry?.options || []).map((option) => option?.nombreCanonico || option?.nombre || "").join("|")}`;
      return list.findIndex((candidate) => {
        const candidateKey = `${String(candidate?.input || "").replace(new RegExp(`^${QUANTITY_TOKEN_PATTERN}\\s+`, "i"), "").trim()}|${(candidate?.options || []).map((option) => option?.nombreCanonico || option?.nombre || "").join("|")}`;
        return candidateKey === currentKey;
      }) === index;
    }),
    unmatched: [...new Set(unmatched.map((value) => limpiarTexto(value)).filter(Boolean))],
    possibleMatch: ambiguities.length > 0 || unmatched.length > 0 || encontrarCoincidenciasCatalogo(texto, { minScore: 60, limit: 1 }).length > 0
  };
}

function extraerProductosDesdeTexto(texto, aiProducts = []) {
  return analizarProductosCatalogoDesdeTexto(texto, aiProducts).items;
}

function detectarIntencionPedido(texto) {
  const normalized = normalizarTextoAnalisis(texto);
  if (!normalized) {
    return false;
  }

  const listOrderAnalysis = analizarPedidoFormatoLista(texto);
  if (listOrderAnalysis.detected) {
    logEvent("LIST_ORDER_DETECTED", {
      multiLine: listOrderAnalysis.multiLine,
      lines: listOrderAnalysis.lineCount,
      parsed: listOrderAnalysis.parsedCount
    });
    logEvent("ORDER_INTENT_CONFIDENCE", {
      source: "list_order_parser",
      confidence: listOrderAnalysis.confidence,
      items: listOrderAnalysis.items.map((item) => `${item.cantidad} ${item.productText}`)
    });
    logConfidenceLevel({
      source: "list_order_parser",
      stage: "order_resolution",
      confidence: listOrderAnalysis.confidence
    });
    return true;
  }

  const analysis = analizarProductosCatalogoDesdeTexto(texto);
  const hasPurchaseVerb = /\b(quiero|quisiera|necesito|pedido|pedir|ordeno|encargo|comprar|me regalas|dame|enviame|enviarme|agrega|agregame|agregale|suma|sumale|ponme|mandame)\b/i.test(normalized);
  const hasQuantity = /\b(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/i.test(normalized);
  const hasPaymentCue = Array.from(PAYMENT_ALIASES.keys()).some((alias) => normalized.includes(normalizarTextoAnalisis(alias)));
  const hasAddressCue = /\b(direccion|direccion:|entrega|enviar|envio|domicilio)\b/i.test(normalized) || ADDRESS_KEYWORDS.test(normalized);
  const hasProductCue = analysis.items.length > 0 || analysis.ambiguities.length > 0 || analysis.possibleMatch;
  const hasImplicitOrderReference = /\b(lo de siempre|lo mismo de ayer|lo mismo|de siempre|como siempre|lo otro|normal)\b/i.test(normalized);
  const hasSemanticPreferenceCue = /\b(pequeno|pequeño|grande|barato|barata|economico|económica|garrafa|litro)\b/i.test(normalized);
  const hasPureCatalogIntent = hasProductCue && normalized.split(" ").filter(Boolean).length <= 4;
  const hasSpecialInstructionOrderCue = hasResolvableSpecialInstructionOrder(texto);

  const confidence = hasProductCue && (hasPurchaseVerb || hasQuantity || hasImplicitOrderReference || hasSemanticPreferenceCue || hasSpecialInstructionOrderCue)
    ? 82
    : (hasProductCue ? 64 : 28);
  logEvent("ORDER_INTENT_CONFIDENCE", {
    source: "default_order_detector",
    confidence,
    hasProductCue,
    hasPurchaseVerb,
    hasQuantity,
    hasSpecialInstructionOrderCue
  });
  logConfidenceLevel({
    source: "default_order_detector",
    stage: "intent_detection",
    confidence
  });

  return (hasProductCue && (hasPurchaseVerb || hasQuantity || hasPaymentCue || hasAddressCue || hasImplicitOrderReference || hasSemanticPreferenceCue || hasPureCatalogIntent || hasSpecialInstructionOrderCue))
    || (hasPurchaseVerb && (hasQuantity || hasPaymentCue || hasAddressCue || hasImplicitOrderReference))
    || hasImplicitOrderReference;
}

function buildCatalogShortList(limit = 5) {
  return getCatalogProductsCache()
    .map((product) => limpiarTexto(product?.nombre))
    .filter(Boolean)
    .filter((name, index, list) => list.indexOf(name) === index)
    .slice(0, limit);
}

function isExplicitOrderGuideRequest(texto = "") {
  const normalized = normalizarTextoAnalisis(texto);
  if (!normalized) {
    return false;
  }

  return [
    /\bcomo\s+(pido|pedir|hago\s+el\s+pedido|compro)\b/i,
    /\bquiero\s+pedir\b/i,
    /\b(ayudame|ayudame\s+a|ayuda|me\s+ayudas)\s+(a\s+)?pedir\b/i,
    /\bno\s+se\s+(como\s+pedir|pedir|que\s+pedir)\b/i,
    /^no\s+se$/i
  ].some((pattern) => pattern.test(normalized));
}

function getOrderGuideMode({ texto = "", routingIntent = null, state = null, evaluacion = null } = {}) {
  const normalized = normalizarTextoAnalisis(texto);
  const hasShownGuide = Boolean(state?.hasShownOrderGuide);

  if (routingIntent === "catalog_request") {
    return hasShownGuide ? "mini" : "full";
  }

  if (isExplicitOrderGuideRequest(normalized)) {
    return hasShownGuide ? "short" : "full";
  }

  if (evaluacion?.faltantes?.includes("productos")) {
    return hasShownGuide ? "short" : "full";
  }

  if (evaluacion?.catalogStatus === "ambiguous") {
    return "short";
  }

  return "none";
}

function rememberOrderGuideShown(state, guideMode) {
  if (!state) {
    return;
  }

  if (["full", "mini"].includes(guideMode)) {
    state.hasShownOrderGuide = true;
  }
}

function buildCatalogFeaturedProducts(customerType = "public") {
  const catalog = getCatalogProductsCache();
  const specs = [
    { emoji: "🥛", label: "Aloe Litro", exactName: "aloe litro" },
    { emoji: "☕", label: "Café Litro", exactName: "cafe litro" },
    { emoji: "🎁", label: "Anchetas", familyName: "ancheta", pricePrefix: "desde" },
    { emoji: "🧀", label: "Bandejas con queso y arequipe", exactName: "bandeja con queso y arequipe" }
  ];

  return specs.map((spec) => {
    const matches = catalog.filter((product) => {
      const canonical = normalizeCanonicalCatalogName(product?.nombre_canonico || product?.nombre);
      const normalizedName = normalizeCanonicalCatalogName(product?.nombre);
      const family = normalizeCatalogSemanticFamilyName(product?.nombre_raiz_familia || product?.nombre_familia || product?.nombre);
      return spec.exactName
        ? canonical === spec.exactName || normalizedName.includes(spec.exactName)
        : family === spec.familyName;
    });
    if (!matches.length) {
      return null;
    }

    const prices = matches
      .map((product) => resolveCatalogPriceForCustomer(product, customerType).unitPrice)
      .filter((price) => price !== null)
      .sort((a, b) => a - b);

    return {
      emoji: spec.emoji,
      label: spec.label,
      catalogName: matches[0]?.nombre || spec.label,
      price: prices.length ? prices[0] : null,
      pricePrefix: spec.pricePrefix || null
    };
  }).filter(Boolean);
}

function buildPriceRequestProducts(texto, limit = 4, customerType = "public") {
  const deterministicResolution = resolveProductFromCatalog(texto);
  if (deterministicResolution.status === "ambiguous") {
    return deterministicResolution.candidates.slice(0, limit).map((product) => ({
      emoji: product.nombreCanonico?.includes("cafe") ? "☕" : (product.nombreCanonico?.includes("ancheta") ? "🎁" : "🥛"),
      label: product.nombre,
      price: resolveCatalogPriceForCustomer(findCatalogProductByName(product.nombre), customerType).unitPrice,
      pricePrefix: null
    }));
  }

  if (deterministicResolution.status === "resolved" && deterministicResolution.product) {
    return [{
      emoji: deterministicResolution.product.nombre_canonico?.includes("cafe") ? "☕" : (deterministicResolution.product.nombre_canonico?.includes("ancheta") ? "🎁" : "🥛"),
      label: deterministicResolution.product.nombre,
      price: resolveCatalogPriceForCustomer(deterministicResolution.product, customerType).unitPrice,
      pricePrefix: null
    }];
  }

  const catalog = getCatalogProductsCache();
  const preferences = extractSemanticCatalogPreferences(texto);
  const familyMatches = catalog.filter((product) => Array.from(preferences.families || []).some((family) => matchesCatalogFamily(product, family)));
  const matches = (familyMatches.length ? familyMatches : encontrarCoincidenciasCatalogo(texto, { minScore: 60, limit }).map((entry) => entry.product))
    .filter(Boolean);

  return buildCatalogAmbiguityOptions(matches).slice(0, limit).map((product) => ({
    emoji: product.nombreCanonico?.includes("cafe") ? "☕" : (product.nombreCanonico?.includes("ancheta") ? "🎁" : "🥛"),
    label: product.nombre,
    price: resolveCatalogPriceForCustomer(product, customerType).unitPrice,
    pricePrefix: null
  }));
}

function buildRelevantCatalogForOrchestrator(texto, state, customerType = "public", limit = 12) {
  const catalogCache = getCatalogProductsCache();
  const deterministicResolution = resolveProductFromCatalog(texto);
  const deterministicMatches = deterministicResolution.status === "ambiguous"
    ? deterministicResolution.candidates
      .map((option) => findCatalogProductByName(option?.nombre))
      .filter(Boolean)
    : (deterministicResolution.status === "resolved" && deterministicResolution.product ? [deterministicResolution.product] : []);
  const matches = (deterministicMatches.length
    ? deterministicMatches.map((product) => ({ product, confidence: 95, score: 95 }))
    : encontrarCoincidenciasCatalogo(texto, { minScore: 55, limit: Math.min(limit, 8) }))
    .map((entry) => ({
    nombre: entry.product?.nombre,
    nombre_familia: entry.product?.nombre_familia || null,
    presentacion: entry.product?.presentacion || null,
    precio: resolveCatalogPriceForCustomer(entry.product, customerType).unitPrice,
    customerType,
    score: entry.confidence || entry.score || 0,
    source: "match"
  }));
  const suggested = (obtenerSuggestionMemoryActiva(state)?.options || [])
    .map((option) => catalogCache.find((product) => normalizarTextoAnalisis(product?.nombre) === normalizarTextoAnalisis(option?.nombre || option?.label || option)))
    .filter(Boolean)
    .map((product) => ({
      nombre: product.nombre,
      nombre_familia: product.nombre_familia || null,
      presentacion: product.presentacion || null,
      precio: resolveCatalogPriceForCustomer(product, customerType).unitPrice,
      customerType,
      score: 0,
      source: "suggestion"
    }));
  const contextualProducts = [
    ...(Array.isArray(state?.pendingPedido?.productos) ? state.pendingPedido.productos : []),
    ...(Array.isArray(state?.lastResolvedOrder?.productos) ? state.lastResolvedOrder.productos : [])
  ]
    .map((item) => catalogCache.find((product) => normalizarTextoAnalisis(product?.nombre) === normalizarTextoAnalisis(item?.producto)))
    .filter(Boolean)
    .map((product) => ({
      nombre: product.nombre,
      nombre_familia: product.nombre_familia || null,
      presentacion: product.presentacion || null,
      precio: resolveCatalogPriceForCustomer(product, customerType).unitPrice,
      customerType,
      score: 0,
      source: "context"
    }));

  const deduped = [];
  const seen = new Set();
  for (const product of [...contextualProducts, ...suggested, ...matches]) {
    const key = normalizarTextoAnalisis(product?.nombre);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(product);
    if (deduped.length >= limit) {
      break;
    }
  }

  return deduped;
}

function buildRecentMessagesForOrchestrator(telefono, limit = 5) {
  return listMessagesByPhone(telefono)
    .slice(-limit)
    .map((message) => ({
      role: message.direction === "out" ? "assistant" : "user",
      text: message.messageText,
      intent: null,
      messageType: message.messageType,
      createdAt: message.createdAt
    }));
}

function mapGptIntentToRoutingIntent(intent, { hasDraftContext = false, hasActiveContext = false } = {}) {
  switch (intent) {
    case "order_request":
      return hasDraftContext ? "order_missing_data" : "order_request";
    case "add_item":
      return (hasDraftContext || hasActiveContext) ? "order_missing_data" : "order_request";
    case "remove_item":
      return "remove_item";
    case "closing":
      return "closing";
    case "admin_query":
      return "admin_query";
    case "payment":
      return "payment_method";
    case "address":
      return "address_provided";
    case "catalog_request":
      return "catalog_request";
    default:
      return "general_chat";
  }
}

function resolveRoutingIntentWithGpt({ heuristicIntent, gptIntent, hasDraftContext = false, hasActiveContext = false }) {
  const protectedIntents = new Set(["greeting", "identity", "provide_name", "human_help", "complaint_confusion", "reorder_memory", "price_request"]);
  if (protectedIntents.has(heuristicIntent)) {
    return heuristicIntent;
  }

  if (gptIntent?.intent && Number(gptIntent.confidence || 0) >= 0.58) {
    return mapGptIntentToRoutingIntent(gptIntent.intent, { hasDraftContext, hasActiveContext });
  }

  return heuristicIntent;
}

function sanitizeAiResponseAgainstFallback(response, fallback, { routingIntent, context } = {}) {
  const text = limpiarTexto(response);
  if (!text) {
    logEvent("GPT_RESPONSE_SANITIZED", { routingIntent, reason: "empty_response", usedFallback: true });
    return fallback;
  }

  if (/\b(descuent|rebaja|gratis|obsequio)\b/i.test(text)) {
    logEvent("GPT_RESPONSE_SANITIZED", { routingIntent, reason: "pricing_policy", usedFallback: true, responsePreview: text.slice(0, 160) });
    return fallback;
  }

  if ((context?.imageAnalysis || context?.recentImage) && /no\s+puedo\s+(leer|ver|revisar).{0,20}(imagen|foto)|en\s+este\s+chat\s+no\s+puedo\s+leer\s+imagenes?/i.test(text)) {
    logEvent("GPT_RESPONSE_SANITIZED", { routingIntent, reason: "image_capability_mismatch", usedFallback: true, responsePreview: text.slice(0, 160) });
    return fallback;
  }

  if (["order_request", "order_missing_data", "ambiguous_product", "admin_query", "payment_method", "address_provided"].includes(routingIntent)) {
    const confirmedProducts = Array.isArray(context?.validated?.confirmedProducts)
      ? context.validated.confirmedProducts.map((item) => normalizarTextoAnalisis(item?.name || item?.producto || "")).filter(Boolean)
      : [];
    if (confirmedProducts.length && !confirmedProducts.some((name) => normalizarTextoAnalisis(text).includes(name))) {
      logEvent("GPT_RESPONSE_SANITIZED", { routingIntent, reason: "validated_items_mismatch", usedFallback: true, responsePreview: text.slice(0, 160) });
      return fallback;
    }
  }

  logEvent("GPT_RESPONSE_SANITIZED", { routingIntent, reason: "accepted", usedFallback: false, responsePreview: text.slice(0, 160) });
  return text;
}

function buildValidatedResponseContext({ orchestratorContext, gptIntent, pedido = null, evaluacion = null, adminSummary = null, fallback = null, customerName = null, userMessage = null, availableProducts = [], catalogUrl = null, activeIntent = null, imageAnalysis = null, recentImage = null }) {
  const confirmedProducts = Array.isArray(pedido?.productos)
    ? pedido.productos.map((item) => ({
        name: item.producto,
        quantity: item.cantidad || 1,
        unitPrice: item.precio_unitario || 0,
        subtotal: item.subtotal || 0,
        notes: item.product_notes || null,
        customizations: item.customizations || []
      }))
    : [];

  return {
    orchestrator: orchestratorContext,
    intent: activeIntent,
    gptIntent,
    customerName,
    userMessage,
    fallback,
    validated: {
      confirmedProducts,
      ambiguousProducts: evaluacion?.ambiguousProducts || [],
      notFoundProducts: evaluacion?.unmatchedProducts || [],
      missingData: evaluacion?.faltantes || [],
      total: pedido?.total ?? null,
      address: pedido?.direccion || null,
      paymentMethod: pedido?.metodo_pago || null,
      customerType: pedido?.customer_type_applied || pedido?.price_tier_applied || null,
      notes: pedido?.notes || null,
      observations: pedido?.observaciones || null,
      receipt: pedido?.receipt || null,
      adminSummary
    },
    availableProducts,
    catalogUrl,
    imageAnalysis: imageAnalysis
      ? {
          extractedItems: imageAnalysis.items || [],
          uncertainLines: imageAnalysis.uncertain_lines || [],
          overallConfidence: imageAnalysis.overall_confidence || 0
        }
      : null,
    recentImage: recentImage
      ? {
          status: recentImage.status || null,
          timestamp: recentImage.timestamp || null,
          hasImage: true,
          hasVisionResult: Boolean(recentImage.analysis)
        }
      : null,
    tone: "Abi cálida, natural, comercial, corta y estilo WhatsApp"
  };
}

async function generarRespuestaConversacional({ telefono, sourceMessageId, routingIntent, fallback, context }) {
  logEvent("TOKEN_USAGE_ESTIMATE", {
    telefono,
    sourceMessageId,
    stage: "final_response_context",
    estimatedTokens: Math.max(1, Math.ceil(JSON.stringify({ intent: routingIntent, fallback, context }).length / 4))
  });

  try {
    const respuesta = sanitizeAiResponseAgainstFallback(
      await generarRespuestaAbi({ intent: routingIntent, ...context, fallback }),
      fallback,
      { routingIntent, context }
    );
    if (respuesta) {
      logEvent("GPT_FINAL_RESPONSE_USED", {
        telefono,
        sourceMessageId,
        intent: routingIntent,
        usedFallback: respuesta === fallback
      });
      logEvent("RESPONSE_SOURCE", { telefono, sourceMessageId, intent: routingIntent, source: "ai" });
      return respuesta;
    }
  } catch (_error) {
    // fallback below
  }

  logEvent("GPT_FINAL_RESPONSE_USED", {
    telefono,
    sourceMessageId,
    intent: routingIntent,
    usedFallback: true
  });
  logEvent("RESPONSE_SOURCE", { telefono, sourceMessageId, intent: routingIntent, source: "template" });
  return fallback;
}

function enriquecerPedidoDetectado(pedido, textoCliente, catalogAnalysis = { items: [] }) {
  const fechaEntregaDetectada = extraerFechaEntregaDesdeTexto(textoCliente);
  const fechaEntregaIA = sanitizeFechaEntregaIA(pedido?.fecha_entrega, textoCliente);
  const catalogItems = Array.isArray(catalogAnalysis?.items) ? catalogAnalysis.items : [];
  const hasItemLevelCustomizations = Array.isArray(catalogAnalysis?.items)
    && catalogAnalysis.items.some((item) => Array.isArray(item?.customizations) && item.customizations.length);
  const extractedOrderCustomizations = hasItemLevelCustomizations ? [] : extractOrderCustomizations(textoCliente);
  const orderLevelCustomizations = shouldKeepOrderLevelCustomizations(catalogItems, extractedOrderCustomizations)
    ? extractedOrderCustomizations
    : [];
  const customizations = mergeCustomizations(pedido?.customizations, orderLevelCustomizations);
  const observacionesCustom = buildObservacionesFromCustomizations(customizations);

  return {
    ...pedido,
    customer_type_applied: normalizeCustomerType(pedido?.customer_type_applied ?? pedido?.customerTypeApplied, "public"),
    price_tier_applied: normalizeCustomerType(pedido?.price_tier_applied ?? pedido?.priceTierApplied ?? pedido?.customer_type_applied ?? pedido?.customerTypeApplied, "public"),
    cliente: pedido?.cliente || extraerClienteDesdeTexto(textoCliente),
    productos: applyCustomizationsToProducts(catalogItems, customizations),
    direccion: pedido?.direccion || extraerDireccionDesdeTexto(textoCliente),
    fecha_entrega: fechaEntregaDetectada || fechaEntregaIA || null,
    metodo_pago: pedido?.metodo_pago || extraerMetodoPagoDesdeTexto(textoCliente),
    observaciones: pedido?.observaciones || observacionesCustom || null,
    notes: pedido?.notes || buildNotesFromCustomizations(customizations),
    customizations,
    estado: pedido?.estado || "pendiente"
  };
}

function normalizarProducto(valor) {
  const limpio = limpiarTexto(valor);
  if (!limpio) {
    return null;
  }

  const normalized = normalizarTextoAnalisis(limpio);
  if (GENERIC_PRODUCT_ALIASES.has(normalized)) {
    return GENERIC_PRODUCT_ALIASES.get(normalized);
  }

  const canonical = PRODUCT_ALIAS_INDEX.get(normalized);
  if (canonical && PRODUCT_CANONICAL_DETAILS[canonical]?.producto) {
    return PRODUCT_CANONICAL_DETAILS[canonical].producto;
  }

  return limpio;
}

function normalizarMetodoPago(valor) {
  const limpio = limpiarTexto(valor);
  if (!limpio) {
    return null;
  }

  const clave = limpio.toLowerCase();
  return PAYMENT_ALIASES.get(clave) || limpio;
}

function limpiarMapaExpirado(map, ttlMs) {
  const ahora = Date.now();

  for (const [key, timestamp] of map.entries()) {
    if (ahora - timestamp > ttlMs) {
      map.delete(key);
    }
  }
}

function limpiarMensajesProcesados() {
  limpiarMapaExpirado(processedMessageIds, MESSAGE_ID_TTL_MS);
  limpiarMapaExpirado(processedMessageContentHashes, CONTENT_DEDUPE_WINDOW_MS);
}

function buildContentDedupeHashes({ telefono, mensaje, receivedAtMs = Date.now() }) {
  const normalizedPhone = limpiarTexto(telefono) || "sin-telefono";
  const normalizedMessage = normalizarTextoAnalisis(mensaje);

  if (!normalizedMessage) {
    return [];
  }

  const currentBucket = Math.floor(receivedAtMs / CONTENT_DEDUPE_WINDOW_MS);

  return [currentBucket, currentBucket - 1].map((bucket) => createHash("sha1")
    .update(`${normalizedPhone}|${normalizedMessage}|${bucket}`)
    .digest("hex"));
}

function registrarMensajeProcesado({ messageId, telefono, mensaje, receivedAtMs = Date.now() }) {
  limpiarMensajesProcesados();

  if (messageId && processedMessageIds.has(messageId)) {
    return { duplicated: true, reason: "message_id" };
  }

  const contentHashes = buildContentDedupeHashes({ telefono, mensaje, receivedAtMs });
  if (contentHashes.some((hash) => processedMessageContentHashes.has(hash))) {
    return { duplicated: true, reason: "content_hash" };
  }

  if (messageId) {
    processedMessageIds.set(messageId, receivedAtMs);
  }

  if (contentHashes.length) {
    processedMessageContentHashes.set(contentHashes[0], receivedAtMs);
  }

  return { duplicated: false, reason: null };
}

function excedeRateLimit(telefono, receivedAtMs = Date.now()) {
  const normalizedPhone = limpiarTexto(telefono);
  if (!normalizedPhone) {
    return false;
  }

  const history = Array.isArray(userRateLimitState.get(normalizedPhone))
    ? userRateLimitState.get(normalizedPhone).filter((timestamp) => receivedAtMs - timestamp <= RATE_LIMIT_WINDOW_MS)
    : [];

  history.push(receivedAtMs);
  userRateLimitState.set(normalizedPhone, history);

  return history.length > RATE_LIMIT_MAX_MESSAGES;
}

function debeNotificarRateLimit(telefono, receivedAtMs = Date.now()) {
  const normalizedPhone = limpiarTexto(telefono);
  if (!normalizedPhone) {
    return false;
  }

  const lastNoticeAt = rateLimitNoticeState.get(normalizedPhone) || 0;
  if (receivedAtMs - lastNoticeAt <= RATE_LIMIT_WINDOW_MS) {
    return false;
  }

  rateLimitNoticeState.set(normalizedPhone, receivedAtMs);
  return true;
}

function normalizarPedido(pedido = {}) {
  const productos = Array.isArray(pedido.productos)
    ? pedido.productos
        .map((item) => ({
          producto: normalizarProducto(item?.producto),
          sabor: limpiarTexto(item?.sabor),
          cantidad: Number.isFinite(Number(item?.cantidad)) && Number(item?.cantidad) > 0
            ? Number(item.cantidad)
            : null,
          precio_unitario: parseOptionalNumber(item?.precio_unitario),
          subtotal: parseOptionalNumber(item?.subtotal),
          product_notes: limpiarTexto(item?.product_notes ?? item?.productNotes),
          customizations: mergeCustomizations([], Array.isArray(item?.customizations) ? item.customizations : [])
        }))
        .filter((item) => item.producto || item.sabor || item.cantidad)
    : [];

  return {
    cliente: limpiarTexto(pedido.cliente),
    productos,
    direccion: limpiarTexto(pedido.direccion),
    fecha_entrega: limpiarTexto(pedido.fecha_entrega),
    metodo_pago: normalizarMetodoPago(pedido.metodo_pago),
    observaciones: limpiarTexto(pedido.observaciones),
    notes: limpiarTexto(pedido.notes),
    customizations: mergeCustomizations([], Array.isArray(pedido.customizations) ? pedido.customizations : []),
    receipt: pedido?.receipt && typeof pedido.receipt === "object"
      ? {
          mediaId: limpiarTexto(pedido.receipt.mediaId),
          path: limpiarTexto(pedido.receipt.path),
          mimeType: limpiarTexto(pedido.receipt.mimeType)
        }
      : null,
    estado: limpiarTexto(pedido.estado) || "pendiente"
  };
}

function findCatalogProductByName(nombre) {
  const normalized = normalizeCatalogText(nombre);
  if (!normalized) {
    return null;
  }

  return getCatalogProductsCache().find((product) => (product.aliases || []).includes(normalized)) || null;
}

function calcularTotalesPedido(pedido = {}) {
  const customerType = normalizeCustomerType(pedido?.customer_type_applied ?? pedido?.customerTypeApplied, "public");
  const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
  const productosConTotales = productos.map((item) => {
    const catalogProduct = findCatalogProductByName(item?.producto);
    const cantidad = Number.isFinite(Number(item?.cantidad)) && Number(item.cantidad) > 0
      ? Number(item.cantidad)
      : null;
    const resolvedPrice = resolveCatalogPriceForCustomer(catalogProduct, customerType);
    const precioUnitario = parseOptionalNumber(item?.precio_unitario)
      ?? parseOptionalNumber(item?.precioUnitario)
      ?? resolvedPrice.unitPrice;
    const subtotal = cantidad && precioUnitario !== null
      ? cantidad * precioUnitario
      : null;
    const priceSource = limpiarTexto(item?.price_source) || (parseOptionalNumber(item?.precio_unitario ?? item?.precioUnitario) !== null ? (resolvedPrice.priceSource || "public") : resolvedPrice.priceSource);

    const itemCustomizations = mergeCustomizations(item?.customizations, []);

    return {
      producto: normalizarProducto(catalogProduct?.nombre || item?.producto),
      sabor: limpiarTexto(item?.sabor),
      cantidad,
      precio_unitario: precioUnitario,
      subtotal,
      price_source: priceSource || "public",
      product_notes: limpiarTexto(item?.product_notes ?? item?.productNotes) || buildNotesFromCustomizations(itemCustomizations),
      customizations: itemCustomizations
    };
  }).filter((item) => item.producto || item.sabor || item.cantidad);

  const total = productosConTotales.reduce((sum, item) => {
    const subtotal = parseOptionalNumber(item.subtotal);
    return subtotal === null ? sum : sum + subtotal;
  }, 0);

  return {
    ...pedido,
    customer_type_applied: customerType,
    price_tier_applied: customerType,
    productos: productosConTotales,
    total: total > 0 ? total : null
  };
}

function evaluarPedido(pedido, catalogAnalysis = { ambiguities: [], unmatched: [] }) {
  const faltantes = [];
  const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
  const addressStatus = !pedido.direccion ? "missing" : (esDireccionIncompleta(pedido.direccion) ? "partial" : "complete");

  const hasCatalogAmbiguity = Array.isArray(catalogAnalysis.ambiguities) && catalogAnalysis.ambiguities.length > 0;
  const hasCatalogMiss = Array.isArray(catalogAnalysis.unmatched) && catalogAnalysis.unmatched.length > 0;

  if (!productos.length) {
    faltantes.push("productos");
  }

  const productosIncompletos = productos.some((item) => !item.producto || !item.cantidad);
  if (productosIncompletos) {
    faltantes.push("detalle_productos");
  }

  const missingPrice = productos.some((item) => parseOptionalNumber(item?.precio_unitario) === null);
  if (missingPrice) {
    faltantes.push("precio_producto");
  }

  if (hasCatalogAmbiguity) {
    faltantes.push("confirmacion_catalogo");
  }

  if (hasCatalogMiss) {
    faltantes.push("productos_catalogo");
  }

  if (addressStatus !== "complete") {
    faltantes.push("direccion");
  }

  if (!pedido.metodo_pago) {
    faltantes.push("metodo_pago");
  }

  if (parseOptionalNumber(pedido.total) === null || Number(pedido.total) <= 0) {
    faltantes.push("total");
  }

  return {
    esValido: faltantes.length === 0 && !hasCatalogAmbiguity && !hasCatalogMiss,
    faltantes,
    productosInvalidos: [],
    priceValidation: missingPrice ? "missing_price" : "ok",
    addressStatus,
    catalogStatus: hasCatalogMiss ? "not_found" : (hasCatalogAmbiguity ? "ambiguous" : "ok"),
    ambiguousProducts: Array.isArray(catalogAnalysis.ambiguities) ? catalogAnalysis.ambiguities : [],
    unmatchedProducts: Array.isArray(catalogAnalysis.unmatched) ? catalogAnalysis.unmatched : []
  };
}

function logEvent(event, details = {}, level = "info") {
  structuredLog(event, details, level);
}

function resolveConfidenceLevel(confidence) {
  const value = Number(confidence);
  if (!Number.isFinite(value)) {
    return null;
  }

  if (value >= 85) {
    return "high";
  }

  if (value >= 60) {
    return "medium";
  }

  return "low";
}

function logConfidenceLevel(details = {}) {
  const numericConfidence = Number(details.confidence);
  logEvent("CONFIDENCE_LEVEL", {
    ...details,
    confidence: Number.isFinite(numericConfidence) ? numericConfidence : null,
    level: details.level || resolveConfidenceLevel(numericConfidence)
  });
}

function logProductMemory(state, reason = null) {
  logEvent("PRODUCT_MEMORY", {
    reason,
    lastProduct: state?.lastProductReference?.nombre || null,
    family: state?.lastProductReference?.familia || null,
    hasSuggestionMemory: Boolean(obtenerSuggestionMemoryActiva(state)),
    lastResolvedItems: Array.isArray(state?.lastResolvedOrder?.productos) ? state.lastResolvedOrder.productos.length : 0
  });
}

function logMultiTurnState(state, details = {}) {
  logEvent("MULTI_TURN_STATE", {
    ...details,
    customerName: (details.customerName ?? state?.customerName) || null,
    lastIntent: (details.lastIntent ?? state?.lastIntent) || null,
    awaitingName: details.awaitingName ?? state?.awaitingName ?? false,
    hasShownOrderGuide: details.hasShownOrderGuide ?? state?.hasShownOrderGuide ?? false,
    lastImageStatus: details.lastImageStatus ?? state?.lastImageContext?.status ?? null,
    pendingItems: details.pendingItems ?? (Array.isArray(state?.pendingPedido?.productos) ? state.pendingPedido.productos.length : 0),
    hasSuggestionMemory: details.hasSuggestionMemory ?? Boolean(obtenerSuggestionMemoryActiva(state)),
    hasActiveOrderContext: details.hasActiveOrderContext ?? Boolean(obtenerActiveOrderContext(state)),
    lastProduct: (details.lastProduct ?? state?.lastProductReference?.nombre) || null,
    lastPaymentMethod: state?.lastPaymentMethod || null
  });
}

function logRuntimeConfigSnapshot(context = "runtime") {
  const rawApiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const apiKeyPresent = Boolean(rawApiKey && rawApiKey !== "tu_api_key");
  const aiProvider = limpiarTexto(process.env.AI_PROVIDER) || OPENAI_PROVIDER;

  logEvent("runtime_config_snapshot", {
    context,
    whatsappEnabled: WHATSAPP_ENABLED,
    adminNotifyEnabled: ADMIN_NOTIFY_ENABLED,
    adminWhatsappCount: getAdminWhatsappNumbers().length,
    openaiApiKeyPresent: apiKeyPresent,
    aiProvider,
    openaiModel: process.env.OPENAI_MODEL || OPENAI_MODEL,
    openaiBaseUrl: OPENAI_BASE_URL
  });

  logEvent("PROVIDER_ACTIVE", {
    context,
    provider: OPENAI_PROVIDER,
    baseUrl: OPENAI_BASE_URL,
    apiKeyPresent
  });

  logEvent("MODEL_ACTIVE", {
    context,
    provider: OPENAI_PROVIDER,
    model: process.env.OPENAI_MODEL || OPENAI_MODEL,
    baseUrl: OPENAI_BASE_URL,
    apiKeyPresent
  });

  if (aiProvider && aiProvider.toLowerCase() !== "openai") {
    logEvent("runtime_config_warning", {
      context,
      message: "AI_PROVIDER distinto de openai; el servicio solo usa OpenAI en esta versión.",
      aiProvider
    }, "warn");
  }
}

function parseBooleanEnv(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  return String(value).trim().toLowerCase() === "true";
}

function formatCurrency(value) {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  }).format(numeric);
}

function getAdminWhatsappNumbers() {
  return Array.from(ADMIN_WHATSAPP_NUMBERS).filter(Boolean);
}

function shouldSendAdminNotifications() {
  return ADMIN_NOTIFY_ENABLED && WHATSAPP_ENABLED && getAdminWhatsappNumbers().length > 0;
}

function buildAdminOrderItemsText(order) {
  if (Array.isArray(order?.items) && order.items.length) {
    return order.items.map((item) => {
      const note = limpiarTexto(item?.productNotes || item?.product_notes);
      return `• ${item?.cantidad || 1} ${item?.producto || "Producto"}${note ? `\n  Nota: ${note}` : ""}`;
    }).join("\n");
  }

  return limpiarTexto(order?.resumenItems) || "• Sin detalle";
}

function buildAdminNewOrderMessage(order) {
  return [
    "📦 Nuevo pedido Tellolac",
    "",
    `Cliente: ${limpiarTexto(order?.cliente) || "Sin nombre"}`,
    `Teléfono: ${normalizePhone(order?.telefono) || "Sin teléfono"}`,
    "",
    "Pedido:",
    buildAdminOrderItemsText(order),
    "",
    `Dirección: ${limpiarTexto(order?.direccion) || "Pendiente"}`,
    `Pago: ${limpiarTexto(order?.metodoPago) || "Pendiente"}`,
    `Total: ${formatCurrency(order?.total || 0)}`,
    "",
    `Estado: ${limpiarTexto(order?.estado) || "pendiente"}`
  ].join("\n");
}

function buildAdminCloseDayMessage(summary, closure = null) {
  return [
    "📊 Resumen cierre Tellolac",
    "",
    `Fecha: ${summary?.dateKey || "Sin fecha"}`,
    `Pedidos: ${summary?.stats?.totalOrders || 0}`,
    `Ventas: ${formatCurrency(summary?.stats?.totalSales || 0)}`,
    `Pendientes: ${summary?.stats?.pending || 0}`,
    `En proceso: ${summary?.stats?.inTransit || 0}`,
    `Entregados: ${summary?.stats?.delivered || 0}`,
    `Cancelados: ${summary?.stats?.cancelled || 0}`,
    closure?.id ? `Cierre: ${closure.id}` : null
  ].filter(Boolean).join("\n");
}

async function notifyAdminWhatsAppNumbers({ message, context = "general", metadata = {} } = {}) {
  if (!shouldSendAdminNotifications()) {
    return { sent: 0, skipped: true, reason: "disabled_or_missing_admins" };
  }

  const text = String(message || "").trim();
  if (!text) {
    return { sent: 0, skipped: true, reason: "empty_message" };
  }

  const admins = getAdminWhatsappNumbers();
  const results = await Promise.allSettled(admins.map((phone) => enviarMensajeWhatsApp(phone, text)));

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      return;
    }

    logEvent("admin_notify_error", {
      adminPhone: admins[index],
      context,
      status: result.reason?.response?.status || null,
      error: result.reason?.response?.data || result.reason?.message || String(result.reason || "unknown_error"),
      ...metadata
    }, "error");
  });

  return {
    sent: results.filter((result) => result.status === "fulfilled").length,
    skipped: false,
    total: admins.length
  };
}

async function notifyAdminCriticalAlert({ title = "Alerta crítica Tellolac", message = "Se detectó un error crítico.", metadata = {} } = {}) {
  return notifyAdminWhatsAppNumbers({
    message: [`🚨 ${title}`, "", String(message || "").trim()].join("\n"),
    context: "critical_error",
    metadata
  });
}

function getDatePartsInTimeZone(date = new Date(), timeZone = BUSINESS_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    if (part.type !== "literal") {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});

  return {
    year: Number(parts.year || 0),
    month: Number(parts.month || 0),
    day: Number(parts.day || 0),
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
    dateKey: `${parts.year || "0000"}-${parts.month || "00"}-${parts.day || "00"}`
  };
}

function getDateKeyInTimeZone(date = new Date(), timeZone = BUSINESS_TIMEZONE) {
  return getDatePartsInTimeZone(date, timeZone).dateKey;
}

function isDateInTimeZone(value, dateKey, timeZone = BUSINESS_TIMEZONE) {
  if (!value || !dateKey) {
    return false;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value || "").slice(0, 10) === dateKey;
  }

  return getDateKeyInTimeZone(date, timeZone) === dateKey;
}

function getBusinessHoursContext(now = new Date()) {
  const parts = getDatePartsInTimeZone(now, BUSINESS_TIMEZONE);
  const outsideBusinessHours = BUSINESS_HOURS_ENABLED
    ? (parts.hour < BUSINESS_OPEN_HOUR || parts.hour >= BUSINESS_CLOSE_HOUR)
    : false;

  return {
    ...parts,
    enabled: BUSINESS_HOURS_ENABLED,
    outsideBusinessHours
  };
}

function appendBusinessHoursNotice(text) {
  if (!text || !getBusinessHoursContext().outsideBusinessHours) {
    return text;
  }

  const notice = "Gracias 😊 Te dejo el pedido registrado. Será revisado en nuestro horario de atención.";
  return String(text).includes(notice) ? text : `${text}\n\n${notice}`;
}

const CUSTOMIZATION_DEFINITIONS = [
  { key: "azucar", label: "Azúcar", value: "21%", pattern: /\b(\d{1,2})\s*%\s*(?:de\s*)?az[uú]car\b/i, text: (match) => `${match[1]}% de azúcar`, valueFromMatch: (match) => `${match[1]}%` },
  { key: "azucar", label: "Azúcar", value: "sin", pattern: /\bsin\s+az[uú]car\b/i, text: () => "sin azúcar" },
  { key: "azucar", label: "Azúcar", value: "poca", pattern: /\b(?:con\s+)?poca\s+az[uú]car\b/i, text: () => "con poca azúcar" },
  { key: "azucar", label: "Azúcar", value: "baja", pattern: /\bbajo\s+en\s+az[uú]car\b/i, text: () => "bajo en azúcar" },
  { key: "azucar", label: "Azúcar", value: "menos", pattern: /\bmenos\s+az[uú]car\b/i, text: () => "menos azúcar" },
  { key: "dulzor", label: "Dulzor", value: "más", pattern: /\bm[aá]s\s+dulce\b/i, text: () => "más dulce" },
  { key: "dulzor", label: "Dulzor", value: "poco", pattern: /\bpoco\s+dulce\b/i, text: () => "poco dulce" },
  { key: "colorante", label: "Colorante", value: "poco", pattern: /\b(?:con\s+)?poco\s+colorante\b/i, text: () => "con poco colorante" },
  { key: "colorante", label: "Colorante", value: "poquito", pattern: /\bpoquito\s+colorante\b/i, text: () => "poquito colorante" },
  { key: "colorante", label: "Colorante", value: "sin", pattern: /\bsin\s+colorante\b/i, text: () => "sin colorante" },
  { key: "base", label: "Base", value: "natural", pattern: /\bnatural\b/i, text: () => "natural" },
  { key: "fruta", label: "Fruta", value: "con", pattern: /\bcon\s+fruta\b/i, text: () => "con fruta" },
  { key: "fruta", label: "Fruta", value: "sin", pattern: /\bsin\s+fruta\b/i, text: () => "sin fruta" },
  { key: "presentacion", label: "Presentación", value: "surtido", pattern: /\bsurtido\b/i, text: () => "surtido" }
];

function mergeCustomizations(base = [], incoming = []) {
  const merged = new Map();
  for (const item of [...(Array.isArray(base) ? base : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!item?.key) {
      continue;
    }

    merged.set(item.key, item);
  }

  return Array.from(merged.values());
}

function extractOrderCustomizations(texto = "") {
  const normalized = String(texto || "");
  const segments = segmentarPosiblesProductos(normalized).flatMap((segment) => expandirSegmentoMultiProducto(segment)).filter(Boolean);
  if (segments.length > 1) {
    return [];
  }

  return extractCustomizationsFromText(texto);
}

function extractCustomizationsFromText(texto = "") {
  const customizations = [];
  const source = String(texto || "");

  for (const definition of CUSTOMIZATION_DEFINITIONS) {
    const match = source.match(definition.pattern);
    if (!match) {
      continue;
    }

    customizations.push({
      key: definition.key,
      label: definition.label,
      value: typeof definition.valueFromMatch === "function" ? definition.valueFromMatch(match) : definition.value,
      text: typeof definition.text === "function" ? definition.text(match) : definition.text
    });
  }

  return mergeCustomizations([], customizations);
}

function stripCustomizationsFromText(texto = "", customizations = []) {
  let stripped = String(texto || "");

  for (const customization of Array.isArray(customizations) ? customizations : []) {
    const definition = CUSTOMIZATION_DEFINITIONS.find((entry) => entry.key === customization?.key && entry.value === customization?.value);
    if (!definition) {
      continue;
    }

    stripped = stripped.replace(definition.pattern, " ");
  }

  return limpiarTexto(stripped.replace(/\s+/g, " ").replace(/\b(con|sin|tambien|también|tambien un|también un)\b\s*$/i, "").trim()) || null;
}

function productAlreadySatisfiesCustomizations(product, customizations = []) {
  if (!product || !Array.isArray(customizations) || !customizations.length) {
    return false;
  }

  const haystack = [
    product?.nombre,
    product?.producto,
    product?.product_name,
    product?.nombre_canonico,
    ...(Array.isArray(product?.aliases) ? product.aliases : [])
  ].map((value) => normalizeCatalogText(value)).filter(Boolean).join(" ");

  return customizations.every((customization) => {
    const text = normalizeCatalogText(customization?.text);
    if (text && haystack.includes(text)) {
      return true;
    }

    if (customization?.key === "fruta" && customization?.value === "con") {
      return haystack.includes("fruta");
    }

    if (customization?.key === "natural") {
      return haystack.includes("natural");
    }

    if (customization?.key === "surtido") {
      return haystack.includes("surtido");
    }

    return false;
  });
}

function shouldKeepOrderLevelCustomizations(productos = [], customizations = []) {
  if (!Array.isArray(customizations) || !customizations.length) {
    return false;
  }

  if (!Array.isArray(productos) || !productos.length) {
    return true;
  }

  return productos.some((item) => !productAlreadySatisfiesCustomizations(item, customizations));
}

function logSpecialInstructionDetected({ sourceText = null, baseQuery = null, customizations = [] } = {}) {
  if (!Array.isArray(customizations) || !customizations.length) {
    return;
  }

  logEvent("SPECIAL_INSTRUCTION_DETECTED", {
    sourceText: limpiarTexto(sourceText) || null,
    baseQuery: limpiarTexto(baseQuery) || null,
    instructions: customizations.map((item) => item?.text || item?.value).filter(Boolean)
  });
}

function logSpecialInstructionScope({ sourceText = null, product = null, customizations = [] } = {}) {
  if (!Array.isArray(customizations) || !customizations.length) {
    return;
  }

  logEvent("SPECIAL_INSTRUCTION_SCOPE", {
    sourceText: limpiarTexto(sourceText) || null,
    product: limpiarTexto(product) || null,
    instructions: customizations.map((item) => item?.text || item?.value).filter(Boolean)
  });
}

function applyProductCustomizations(item = {}, customizations = [], { sourceText = null, baseQuery = null } = {}) {
  const mergedCustomizations = mergeCustomizations(item?.customizations, customizations);
  if (!mergedCustomizations.length) {
    return item;
  }

  logSpecialInstructionDetected({ sourceText, baseQuery, customizations: mergedCustomizations });
  logEvent("PRODUCT_NOTE_APPLIED", {
    product: item?.producto || null,
    baseQuery: limpiarTexto(baseQuery) || null,
    instructions: mergedCustomizations.map((entry) => entry?.text || entry?.value).filter(Boolean)
  });

  return {
    ...item,
    product_notes: buildNotesFromCustomizations(mergedCustomizations),
    customizations: mergedCustomizations
  };
}

function hasResolvableSpecialInstructionOrder(texto = "") {
  const customizations = extractCustomizationsFromText(texto);
  if (!customizations.length) {
    return false;
  }

  const baseQuery = stripCustomizationsFromText(texto, customizations);
  if (!baseQuery) {
    return false;
  }

  const catalogResolution = resolverProductoCatalogo(baseQuery);
  if (["matched", "ambiguous", "suggested"].includes(catalogResolution.status)) {
    return true;
  }

  const aliasResolution = resolverProductoAliasLocal(baseQuery);
  if (aliasResolution.status === "matched") {
    return true;
  }

  if (encontrarCoincidenciasCatalogo(baseQuery, { minScore: 70, limit: 1 }).length) {
    return true;
  }

  return Boolean(resolverProductoSemanticoPorPreferencias(baseQuery));
}

function buildObservacionesFromCustomizations(customizations = []) {
  if (!Array.isArray(customizations) || !customizations.length) {
    return null;
  }

  return customizations.map((item) => `- ${item.text || `${item.label}: ${item.value}`}`).join("\n");
}

function buildNotesFromCustomizations(customizations = []) {
  if (!Array.isArray(customizations) || !customizations.length) {
    return null;
  }

  return customizations.map((item) => item.text || `${item.label}: ${item.value}`).join(" | ");
}

function applyCustomizationsToProducts(productos = [], customizations = []) {
  if (!Array.isArray(productos) || !productos.length) {
    return [];
  }

  return productos.map((item) => {
    if (productAlreadySatisfiesCustomizations(item, customizations)) {
      return {
        ...item,
        product_notes: item?.product_notes || null,
        customizations: Array.isArray(item?.customizations) ? item.customizations : []
      };
    }

    const mergedCustomizations = mergeCustomizations(item?.customizations, customizations);
    return {
      ...item,
      product_notes: buildNotesFromCustomizations(mergedCustomizations),
      customizations: mergedCustomizations
    };
  });
}

function buildOrderAvatarLabel(order) {
  const source = limpiarTexto(order?.cliente) || limpiarTexto(order?.telefono) || "CL";
  const parts = source.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("").slice(0, 2) || "CL";
}

function buildDashboardSummary(orders = []) {
  const todayKey = getDateKeyInTimeZone(new Date(), BUSINESS_TIMEZONE);
  const todayOrders = orders.filter((order) => isDateInTimeZone(order.fechaRegistro, todayKey, BUSINESS_TIMEZONE));
  return buildOperationalSummary(todayOrders, todayKey);
}

function buildOperationalSummary(orders = [], dateKey = getDateKeyInTimeZone(new Date(), BUSINESS_TIMEZONE)) {
  const stats = {
    totalOrders: orders.length,
    totalSales: orders.reduce((sum, order) => sum + (Number(order.total) || 0), 0),
    pending: orders.filter((order) => order.estado === "pendiente").length,
    delivered: orders.filter((order) => order.estado === "entregado").length,
    cancelled: orders.filter((order) => order.estado === "cancelado").length,
    inTransit: orders.filter((order) => order.estado === "en proceso").length
  };

  const paymentMap = new Map();
  for (const order of orders) {
    const key = limpiarTexto(order.metodoPago) || "Sin definir";
    const current = paymentMap.get(key) || { label: key, count: 0, total: 0 };
    current.count += 1;
    current.total += Number(order.total) || 0;
    paymentMap.set(key, current);
  }

  return {
    dateKey,
    generatedAt: new Date().toISOString(),
    stats,
    paymentBreakdown: Array.from(paymentMap.values()).sort((a, b) => b.total - a.total),
    orders: orders.map((order) => ({
      ...order,
      customerTypeLabel: normalizeCustomerType(order.customerTypeApplied ?? order.customer_type_applied, "public") === "distributor" ? "Distribuidor" : "Público",
      priceTierLabel: normalizeCustomerType(order.priceTierApplied ?? order.price_tier_applied, "public") === "distributor" ? "Distribuidor" : "Público",
      avatarLabel: buildOrderAvatarLabel(order),
      totalLabel: formatCurrency(order.total || 0)
    }))
  };
}

function normalizePanelLoginPath(value) {
  const normalized = String(value || "portal")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  return normalized ? `/${normalized}` : "/portal";
}

function parseCookies(req) {
  const header = String(req.headers.cookie || "");
  return header.split(";").reduce((acc, chunk) => {
    const [rawKey, ...rest] = chunk.split("=");
    const key = String(rawKey || "").trim();
    if (!key) {
      return acc;
    }

    acc[key] = decodeURIComponent(rest.join("=").trim());
    return acc;
  }, {});
}

function getRequestIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || "unknown";
}

function pruneLoginAttempts(state, now = Date.now()) {
  const cutoff = now - PANEL_LOGIN_RATE_LIMIT_WINDOW_MS;

  for (const [ip, attempts] of state.entries()) {
    const recent = attempts.filter((timestamp) => timestamp > cutoff);
    if (recent.length) {
      state.set(ip, recent);
    } else {
      state.delete(ip);
    }
  }
}

function getLoginAttempts(ip, now = Date.now()) {
  pruneLoginAttempts(panelLoginAttemptState, now);
  return panelLoginAttemptState.get(ip) || [];
}

function registerFailedLoginAttempt(ip, now = Date.now()) {
  const attempts = getLoginAttempts(ip, now);
  const nextAttempts = [...attempts, now];
  panelLoginAttemptState.set(ip, nextAttempts);
  return nextAttempts;
}

function clearFailedLoginAttempts(ip) {
  panelLoginAttemptState.delete(ip);
}

function getLoginRateLimitStatus(ip, now = Date.now()) {
  const attempts = getLoginAttempts(ip, now);
  const remaining = Math.max(PANEL_LOGIN_RATE_LIMIT_MAX_ATTEMPTS - attempts.length, 0);
  const oldest = attempts[0] || now;
  const retryAfterMs = attempts.length >= PANEL_LOGIN_RATE_LIMIT_MAX_ATTEMPTS
    ? Math.max(PANEL_LOGIN_RATE_LIMIT_WINDOW_MS - (now - oldest), 0)
    : 0;

  return {
    attempts,
    remaining,
    retryAfterMs,
    limited: attempts.length >= PANEL_LOGIN_RATE_LIMIT_MAX_ATTEMPTS
  };
}

function createPanelSessionToken(username) {
  const expiresAt = Date.now() + PANEL_AUTH_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ username, expiresAt })).toString("base64url");
  const signature = createHmac("sha256", PANEL_AUTH_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyPanelSessionToken(token) {
  if (!token || !token.includes(".")) {
    return null;
  }

  const [payload, signature] = token.split(".");
  const expected = createHmac("sha256", PANEL_AUTH_SECRET).update(payload).digest("base64url");

  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return null;
    }

    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!decoded?.username || !decoded?.expiresAt || decoded.expiresAt < Date.now()) {
      return null;
    }

    return decoded;
  } catch (_error) {
    return null;
  }
}

function buildPanelSessionCookie(token, maxAgeSeconds) {
  const parts = [
    `${PANEL_AUTH_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];

  if (PANEL_AUTH_COOKIE_SECURE) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function setPanelSessionCookie(res, username) {
  const token = createPanelSessionToken(username);
  const maxAge = Math.floor(PANEL_AUTH_TTL_MS / 1000);
  res.setHeader("Set-Cookie", buildPanelSessionCookie(token, maxAge));
}

function clearPanelSessionCookie(res) {
  res.setHeader("Set-Cookie", buildPanelSessionCookie("", 0));
}

function requirePanelAuth(req, res, next) {
  if (!PANEL_AUTH_ENABLED) {
    return next();
  }

  const cookies = parseCookies(req);
  const session = verifyPanelSessionToken(cookies[PANEL_AUTH_COOKIE]);
  if (session) {
    req.panelSession = session;
    return next();
  }

  const wantsHtml = String(req.headers.accept || "").includes("text/html");
  if (wantsHtml && req.method === "GET") {
    return res.redirect(`${PANEL_LOGIN_PATH}?next=${encodeURIComponent(req.originalUrl || "/")}`);
  }

  return res.status(401).json({ ok: false, error: "No autorizado" });
}

function sendError(res, statusCode, errorMessage) {
  return res.status(statusCode).json({ ok: false, error: errorMessage });
}

function handleCustomerApiError(res, error, { fallbackMessage = "No se pudo procesar el cliente" } = {}) {
  if (error?.code === "INVALID_CUSTOMER_PHONE" || error?.code === "INVALID_CUSTOMER_NAME" || error?.code === "INVALID_CUSTOMER_TYPE") {
    return res.status(400).json({ ok: false, error: error.message, code: error.code });
  }

  if (error?.code === "CUSTOMER_NOT_FOUND") {
    return res.status(404).json({ ok: false, error: error.message, code: error.code });
  }

  if (String(error?.message || "").includes("UNIQUE constraint failed: customers.phone")) {
    return res.status(409).json({ ok: false, error: "Ya existe un cliente con ese teléfono", code: "CUSTOMER_PHONE_DUPLICATE" });
  }

  return res.status(500).json({ ok: false, error: fallbackMessage, detalle: error?.message || null });
}

function parseNonNegativeInteger(value, { defaultValue = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const parsed = Number.parseInt(String(value), 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  return Math.min(parsed, max);
}

function runDeliveryHook(_payload) {
  return null;
}

async function respaldarPedidoEnSheets(order) {
  if (!SHEETS_BACKUP_ENABLED || !order?.id) {
    return { saved: false, skipped: true, reason: "sheets_backup_disabled_or_missing_order" };
  }

  try {
    const result = await sincronizarPedidoDesdeDbEnSheets(order);
    logEvent("pedido_sincronizado_sheets", {
      id: order.id,
      mode: result.mode,
      rowsWritten: result.rowsWritten
    });
    return { saved: true, skipped: false, mode: result.mode, rowsWritten: result.rowsWritten };
  } catch (error) {
    logEvent("sheets_sync_error", { id: order?.id || null, error: error.response?.data || error.message }, "warn");
    return { saved: false, skipped: false, error: error.message };
  }
}

async function sincronizarEstadoEnSheets(orderId, status) {
  if (!SHEETS_BACKUP_ENABLED) {
    return { synced: false, skipped: true, reason: "sheets_backup_disabled" };
  }

  try {
    await actualizarEstadoPedidoEnSheets(orderId, status);
    logEvent("estado_sincronizado_sheets", { id: orderId, estado: status });
    return { synced: true, skipped: false };
  } catch (error) {
    logEvent("sheets_status_sync_error", { id: orderId, estado: status, error: error.response?.data || error.message }, "warn");
    return { synced: false, skipped: false, error: error.message };
  }
}

function shouldUseOpenAIForPedido(textoCliente, catalogAnalysis = { items: [] }) {
  const normalized = normalizarTextoAnalisis(textoCliente);
  const listOrderAnalysis = analizarPedidoFormatoLista(textoCliente);

  if (!normalized) {
    return false;
  }

  if (listOrderAnalysis.detected) {
    return false;
  }

  const hasTemporalCue = /\b(hoy|manana|mañana|tarde|noche|am|pm|hora|horas|despues|después|antes)\b/.test(normalized)
    || /\b\d{1,2}(:\d{2})?\b/.test(textoCliente);
  const hasObservationCue = /\b(sin azucar|sin azúcar|poca azucar|poca azúcar|bajo en azucar|bajo en azúcar|sin colorante|poco colorante|con fruta|sin fruta|natural|surtido|con hielo|sin hielo|nota|observacion|observación|por favor no|sin tapa)\b/.test(normalized);
  const hasNameCue = /(?:soy|mi nombre es|habla)\s+/i.test(textoCliente);
  const quantityMatches = normalized.match(new RegExp(`\\b${QUANTITY_TOKEN_PATTERN}\\b`, "g")) || [];
  const hasMultipleItemCue = quantityMatches.length >= 2;
  const missingCatalogMatch = !catalogAnalysis.items?.length && !catalogAnalysis.ambiguities?.length && !catalogAnalysis.unmatched?.length;

  if (missingCatalogMatch) {
    return false;
  }

  return hasTemporalCue || hasObservationCue || hasNameCue || hasMultipleItemCue;
}

async function procesarPedidoDesdeTexto(textoCliente, opciones = {}) {
  const fallbackPedidoIA = {
    cliente: null,
    productos: [],
    direccion: null,
    fecha_entrega: null,
    metodo_pago: null,
    observaciones: null,
    estado: "pendiente",
    total: null
  };
  const initialCatalogAnalysis = analizarProductosCatalogoDesdeTexto(textoCliente, [], opciones.customerType || "public");
  const pricingContext = buildCatalogPricingContext(opciones.customerType || "public");
  let pedidoIA = fallbackPedidoIA;
  let catalogAnalysis = initialCatalogAnalysis;

  logEvent("parser_iniciado", {
    telefono: opciones.telefono || null,
    sourceMessageId: opciones.sourceMessageId || null,
    textLength: String(textoCliente || "").length,
    willUseOpenAI: shouldUseOpenAIForPedido(textoCliente, initialCatalogAnalysis),
    catalogItemsDetected: initialCatalogAnalysis.items?.length || 0,
    catalogAmbiguities: initialCatalogAnalysis.ambiguities?.length || 0,
    catalogUnmatched: initialCatalogAnalysis.unmatched?.length || 0
  });

  if (shouldUseOpenAIForPedido(textoCliente, initialCatalogAnalysis)) {
    try {
      pedidoIA = await procesarMensaje(textoCliente);
      logEvent("respuesta_ia_recibida", {
        telefono: opciones.telefono || null,
        sourceMessageId: opciones.sourceMessageId || null,
        model: OPENAI_MODEL,
        hasCliente: Boolean(pedidoIA?.cliente),
        productos: Array.isArray(pedidoIA?.productos) ? pedidoIA.productos.length : 0,
        hasDireccion: Boolean(pedidoIA?.direccion),
        hasMetodoPago: Boolean(pedidoIA?.metodo_pago),
        hasTotal: parseOptionalNumber(pedidoIA?.total) !== null
      });
    } catch (error) {
      logEvent("MODEL_ERROR", {
        model: OPENAI_MODEL,
        error: error.message,
        fallback: "catalog_analysis"
      }, "error");
      pedidoIA = fallbackPedidoIA;
    }
  }

  const pedidoNormalizado = normalizarPedido(pedidoIA);
  catalogAnalysis = analizarProductosCatalogoDesdeTexto(textoCliente, pedidoNormalizado.productos, opciones.customerType || "public");
  const pedido = calcularTotalesPedido({
    ...enriquecerPedidoDetectado(pedidoNormalizado, textoCliente, catalogAnalysis),
    customer_type_applied: pricingContext.customerType,
    price_tier_applied: pricingContext.customerType
  });
  const evaluacion = evaluarPedido(pedido, catalogAnalysis);
  let order = null;
  let sheets = { saved: false, skipped: true, reason: "order_not_persisted" };

  logEvent("pedido_validado", {
    telefono: opciones.telefono || null,
    sourceMessageId: opciones.sourceMessageId || null,
    esValido: evaluacion.esValido,
    faltantes: evaluacion.faltantes,
    catalogStatus: evaluacion.catalogStatus,
    priceValidation: evaluacion.priceValidation,
    total: pedido.total,
    items: Array.isArray(pedido.productos) ? pedido.productos.length : 0
  });

  logEvent("BACKEND_VALIDATION_RESULT", {
    telefono: opciones.telefono || null,
    sourceMessageId: opciones.sourceMessageId || null,
    customerType: opciones.customerType || "public",
    esValido: evaluacion.esValido,
    faltantes: evaluacion.faltantes,
    catalogStatus: evaluacion.catalogStatus,
    total: pedido.total,
    confirmedProducts: Array.isArray(pedido.productos) ? pedido.productos.map((item) => item?.producto).filter(Boolean) : []
  });

  logEvent("total_calculado", {
    telefono: opciones.telefono || null,
    total: pedido.total,
    items: Array.isArray(pedido.productos) ? pedido.productos.length : 0
  });

  if (evaluacion.esValido && opciones.guardar !== false) {
    try {
      ({ order, sheets } = await persistirPedidoFinal({
        pedido,
        telefono: opciones.telefono,
        mensajeOriginal: opciones.mensajeOriginal || textoCliente,
        sourceMessageId: opciones.sourceMessageId
      }));
    } catch (error) {
      if (error.code === "INVALID_ORDER_PERSISTENCE") {
        evaluacion.esValido = false;
        evaluacion.faltantes = [...new Set([...(evaluacion.faltantes || []), "detalle_productos", "direccion", "metodo_pago", "precio_producto", "total"])];
        logEvent("order_persistence_blocked", {
          telefono: opciones.telefono || null,
          error: error.message
        }, "warn");
      } else {
        throw error;
      }
    }
  }

  return {
    pedido,
    evaluacion,
    order,
    sheets
  };
}

function normalizarEstadoPanel(valor) {
  const status = String(valor || "").trim().toLowerCase();
  if (status === "en camino") {
    return "en proceso";
  }

  return ESTADOS_VALIDOS.has(status) ? status : null;
}

async function bootstrapDbDesdeSheets() {
  if (listOrdersIncludingArchived().length > 0) {
    return;
  }

  try {
    const orders = await leerPedidosDesdeSheets();
    if (!orders.length) {
      return;
    }

    importOrders(orders);
    logEvent("bootstrap_db_from_sheets", { imported: orders.length });
  } catch (error) {
    logEvent("bootstrap_db_from_sheets_error", { error: error.response?.data || error.message }, "warn");
  }
}

async function bootstrapCatalogoDesdeTreinta() {
  try {
    const stats = await sincronizarCatalogoDesdeTreinta();
    logEvent("catalogo_sincronizado_treinta", { active: stats.active, total: stats.total, inactive: stats.inactive });
  } catch (error) {
    const snapshotProducts = loadCatalogSnapshotProducts();
    if (snapshotProducts.length) {
      syncCatalogProducts(snapshotProducts, { sourceUrl: CATALOG_SNAPSHOT_SOURCE_URL });
      setCatalogProductsCache(listCatalogProducts({ activeOnly: true }));
      logEvent("catalog_snapshot_loaded", { total: snapshotProducts.length, sourceUrl: CATALOG_SNAPSHOT_SOURCE_URL }, "warn");
    }

    setCatalogProductsCache(listCatalogProducts({ activeOnly: true }));

    if (!catalogProductsCache.length) {
      throw new Error(`No se pudo cargar el catálogo de Treinta y no hay caché local: ${error.message}`);
    }

    logEvent("catalogo_sync_warning_local_cache", { error: error.message, active: catalogProductsCache.length }, "warn");
  }
}

async function sincronizarCatalogoDesdeTreinta() {
  const result = await fetchCatalogProducts(CATALOG_URL || DEFAULT_CATALOG_URL);
  syncCatalogProducts(result.products, { sourceUrl: result.catalogUrl });
  setCatalogProductsCache(listCatalogProducts({ activeOnly: true }));

  return {
    ok: true,
    total: countAllCatalogProducts(),
    active: countCatalogProducts(),
    inactive: countInactiveCatalogProducts(),
    syncedAt: result.fetchedAt,
    sourceUrl: result.catalogUrl
  };
}

function buildSimulatedSourceMessageId(prefix = "simulate") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function persistirMensaje({ phone, direction, messageText, messageType = "text", transcription = null, mediaId = null, whatsappMessageId = null, orderId = null }) {
  const message = saveMessage({
    phone,
    direction,
    messageType,
    messageText,
    transcription,
    mediaId,
    whatsappMessageId,
    orderId
  });

  logEvent(direction === "in" ? "mensaje_entrante_guardado" : "mensaje_saliente_guardado", {
    id: message?.id || null,
    phone,
    orderId: orderId || null,
    whatsappMessageId: whatsappMessageId || null
  });

  return message;
}

function normalizeAdminCommand(texto = "") {
  return normalizarTextoAnalisis(texto).replace(/\s+/g, " ").trim();
}

function isAdminWhatsAppNumber(phone) {
  return ADMIN_WHATSAPP_NUMBERS.has(normalizePhone(phone));
}

function buildAdminWhatsappResponse(command, phone) {
  if (!isAdminWhatsAppNumber(phone)) {
    return { handled: false, unauthorized: false, response: null };
  }

  const normalizedCommand = normalizeAdminCommand(command);
  const todayKey = getDateKeyInTimeZone(new Date(), BUSINESS_TIMEZONE);
  const todayOrders = listOrdersIncludingArchived().filter((order) => isDateInTimeZone(order.fechaRegistro, todayKey, BUSINESS_TIMEZONE));
  const totalSales = todayOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
  const pending = todayOrders.filter((order) => order.estado === "pendiente").length;
  const distributor = todayOrders.filter((order) => normalizeCustomerType(order.customerTypeApplied || order.priceTierApplied, "public") === "distributor").length;
  const publicOrders = todayOrders.length - distributor;

  switch (normalizedCommand) {
    case "ventas hoy":
    case "total ventas":
      return { handled: true, unauthorized: false, response: `💰 Ventas de hoy: ${formatCurrency(totalSales)}` };
    case "pedidos pendientes":
      return { handled: true, unauthorized: false, response: `🟡 Pedidos pendientes hoy: ${pending}` };
    case "pedidos distribuidor":
      return { handled: true, unauthorized: false, response: `📦 Pedidos distribuidor hoy: ${distributor}` };
    case "pedidos publico":
    case "pedidos público":
      return { handled: true, unauthorized: false, response: `🛍️ Pedidos público hoy: ${publicOrders}` };
    case "resumen hoy":
      return {
        handled: true,
        unauthorized: false,
        response: [
          "📊 Resumen de hoy:",
          `Pedidos: ${todayOrders.length}`,
          `Ventas: ${formatCurrency(totalSales)}`,
          `Pendientes: ${pending}`,
          `Distribuidor: ${distributor}`,
          `Público: ${publicOrders}`
        ].join("\n")
      };
    default:
      return { handled: false, unauthorized: false, response: null };
  }
}

function isKnownAdminCommand(texto = "") {
  return ["ventas hoy", "total ventas", "pedidos pendientes", "pedidos distribuidor", "pedidos publico", "pedidos público", "resumen hoy"].includes(normalizeAdminCommand(texto));
}

function persistOrderMediaFile({ phone, mediaId, mimeType, filename, buffer }) {
  const extension = path.extname(filename || "") || `.${String((mimeType || "application/octet-stream").split("/").pop() || "bin").replace(/[^a-z0-9]+/gi, "")}`;
  const safePhone = normalizePhone(phone) || "cliente";
  const safeMediaId = String(mediaId || Date.now()).replace(/[^a-zA-Z0-9_-]+/g, "");
  const fileName = `${safePhone}-${safeMediaId}${extension.startsWith(".") ? extension : `.${extension}`}`;
  const absolutePath = path.join(ORDER_MEDIA_DIR, fileName);
  fs.writeFileSync(absolutePath, buffer);
  return {
    mediaId,
    mimeType,
    path: `/order-media/${fileName}`,
    absolutePath
  };
}

async function handleIncomingReceiptImage({ telefono, sourceMessageId, simulated = false, mediaId = null, mediaBuffer = null, mediaMimeType = null, mediaFilename = null, caption = null }) {
  const activeOrder = getActiveOrderByPhone(telefono);
  const receipt = mediaBuffer
    ? persistOrderMediaFile({ phone: telefono, mediaId, mimeType: mediaMimeType, filename: mediaFilename, buffer: mediaBuffer })
    : { mediaId, mimeType: mediaMimeType, path: null, absolutePath: null };
  const order = activeOrder ? attachReceiptToOrder(activeOrder.id, receipt) : null;
  const inboundMessage = persistirMensaje({
    phone: telefono,
    direction: "in",
    messageText: limpiarTexto(caption) || (order ? "Comprobante recibido" : "Imagen recibida"),
    messageType: "image",
    transcription: null,
    mediaId,
    whatsappMessageId: sourceMessageId,
    orderId: order?.id || null
  });
  const respuesta = order
    ? "Listo 😊 recibí el comprobante y lo asocié a tu pedido."
    : "Listo 😊 recibí tu imagen. Cuando tenga un pedido activo la asocio como comprobante.";
  const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: order?.id || null });
  return {
    ignored: false,
    ignoredReason: null,
    intent: "receipt_image",
    pedido: order ? construirPedidoDesdeOrder(order) : null,
    evaluacion: null,
    order,
    inboundMessage,
    respuesta,
    delivery,
    sheets: { saved: false, skipped: true, reason: "receipt_only" }
  };
}

function buildImageOrderNormalizedText(imageAnalysis = {}, caption = null) {
  const itemLines = (Array.isArray(imageAnalysis.items) ? imageAnalysis.items : [])
    .map((item) => `${Math.max(1, Number(item?.quantity) || 1)} ${limpiarTexto(item?.product_query || item?.raw_text || "")}`.trim())
    .filter(Boolean);
  const normalizedCaption = normalizarTextoAnalisis(caption);
  const shouldIncludeCaption = Boolean(normalizedCaption)
    && !["imagen recibida", "pedido de imagen", "imagen", "foto"].includes(normalizedCaption)
    && !RECEIPT_IMAGE_KEYWORDS.some((keyword) => normalizedCaption.includes(normalizarTextoAnalisis(keyword)));
  const extras = [shouldIncludeCaption ? limpiarTexto(caption) : null].filter(Boolean);

  return [...itemLines, ...extras].join("\n").trim() || null;
}

function buildImageOrderConfidence(imageAnalysis = {}) {
  const confidences = (Array.isArray(imageAnalysis.items) ? imageAnalysis.items : [])
    .map((item) => Number(item?.confidence))
    .filter((value) => Number.isFinite(value));

  if (!confidences.length) {
    return Math.max(0, Math.min(1, Number(imageAnalysis?.overall_confidence) || 0));
  }

  return confidences.reduce((acc, value) => acc + value, 0) / confidences.length;
}

function buildStoredImageContext({ telefono, sourceMessageId, mediaId = null, mediaBuffer = null, mediaMimeType = null, mediaFilename = null, caption = null, persistedMedia = null, analysis = null, status = "pending" } = {}) {
  return {
    phone: telefono,
    sourceMessageId,
    mediaId: mediaId || null,
    mimeType: mediaMimeType || null,
    filename: mediaFilename || null,
    caption: limpiarTexto(caption) || null,
    path: persistedMedia?.path || null,
    absolutePath: persistedMedia?.absolutePath || null,
    timestamp: Date.now(),
    status,
    analysis: analysis || null
  };
}

function clearLastImageContext(state) {
  if (state) {
    state.lastImageMediaId = null;
    state.lastImageTimestamp = null;
    state.lastImageStatus = null;
    state.lastImageCaption = null;
    state.lastImageLocalPath = null;
    state.lastImageContext = null;
  }
}

function getLastImageContext(state, now = Date.now()) {
  if (!state?.lastImageContext) {
    return null;
  }

  if (Number(state.lastImageContext.timestamp || 0) + IMAGE_CONTEXT_TTL_MS <= now) {
    clearLastImageContext(state);
    return null;
  }

  return state.lastImageContext;
}

function setLastImageContext(state, imageContext = null) {
  if (!state || !imageContext) {
    return;
  }

  state.lastImageMediaId = imageContext.mediaId || null;
  state.lastImageTimestamp = imageContext.timestamp || Date.now();
  state.lastImageStatus = imageContext.status || null;
  state.lastImageCaption = imageContext.caption || null;
  state.lastImageLocalPath = imageContext.absolutePath || imageContext.path || null;
  state.lastImageContext = imageContext;
  logEvent("LAST_IMAGE_CONTEXT_SET", {
    telefono: imageContext.phone || null,
    sourceMessageId: imageContext.sourceMessageId || null,
    mediaId: imageContext.mediaId || null,
    status: imageContext.status || null,
    hasPath: Boolean(imageContext.path || imageContext.absolutePath),
    hasAnalysis: Boolean(imageContext.analysis),
    timestamp: imageContext.timestamp || Date.now()
  });
}

function hasPendingImageConfirmation(state = null) {
  const imageContext = getLastImageContext(state);
  return Boolean(
    imageContext?.status === "ocr_completed"
    && Array.isArray(state?.pendingPedido?.productos)
    && state.pendingPedido.productos.length
    && state.pendingPedido?.direccion
    && state.pendingPedido?.metodo_pago
  );
}

function isImageReferencePhrase(texto = "") {
  const normalized = normalizarTextoAnalisis(texto);
  if (!normalized) {
    return false;
  }

  return [
    /\b(puedes|puede|podrias|podrías)\s+(leer|revisar)\s+(mi\s+)?(imagen|foto)\b/i,
    /\b(lee|revisa)\s+(la\s+)?(imagen|foto)\b/i,
    /\b(los|lo)\s+de\s+la\s+imagen\b/i,
    /\bel\s+pedido\s+de\s+la\s+foto\b/i,
    /^la\s+(foto|imagen)$/i,
    /^eso$/i,
    /\b(esa|eso)\s+es\s+un\s+pedido\b/i,
    /\bes\s+un\s+pedido\b/i,
    /\bnecesito\s+eso\b/i,
    /\bsi[,\s]+es\s+un\s+pedido\b/i,
    /\bs[ií]\s*,?\s+es\s+un\s+pedido\b/i,
    /\brevisa\s+mi\s+imagen\b/i
  ].some((pattern) => pattern.test(normalized));
}

function isImageReviewRequest(texto = "", state = null) {
  return Boolean(getLastImageContext(state)) && isImageReferencePhrase(texto);
}

function logLastImageContextFound(imageContext = null, telefono = null, sourceMessageId = null) {
  if (!imageContext) {
    return;
  }

  logEvent("LAST_IMAGE_CONTEXT_FOUND", {
    telefono: telefono || imageContext.phone || null,
    sourceMessageId: sourceMessageId || imageContext.sourceMessageId || null,
    mediaId: imageContext.mediaId || null,
    status: imageContext.status || null,
    timestamp: imageContext.timestamp || null,
    hasAnalysis: Boolean(imageContext.analysis)
  });
}

async function processImageOrder(image = null) {
  if (!image) {
    return {
      items: [],
      uncertain_lines: [],
      extracted_text: null,
      address: null,
      payment_method: null,
      overall_confidence: 0
    };
  }

  if (image.analysis) {
    return image.analysis;
  }

  let buffer = null;
  if (image.absolutePath && fs.existsSync(image.absolutePath)) {
    buffer = fs.readFileSync(image.absolutePath);
  }

  if (!buffer?.length) {
    return {
      items: [],
      uncertain_lines: [],
      extracted_text: null,
      address: null,
      payment_method: null,
      overall_confidence: 0
    };
  }

  logEvent("IMAGE_OCR_STARTED", {
    telefono: image.phone || null,
    sourceMessageId: image.sourceMessageId || null,
    mediaId: image.mediaId || null,
    mimeType: image.mimeType || null,
    filename: image.filename || null
  });

  const imageAnalysis = await analizarImagenPedido({
    buffer,
    mimeType: image.mimeType || "image/jpeg",
    filename: image.filename || "pedido.jpg",
    caption: image.caption,
    language: "es"
  });

  logEvent("IMAGE_OCR_RESULT", {
    telefono: image.phone || null,
    sourceMessageId: image.sourceMessageId || null,
    items: imageAnalysis.items.length,
    uncertainLines: imageAnalysis.uncertain_lines.length,
    overallConfidence: imageAnalysis.overall_confidence,
    extractedTextPreview: limpiarTexto(imageAnalysis.extracted_text)?.slice(0, 180) || null
  });

  if (imageAnalysis.uncertain_lines?.length) {
    logEvent("IMAGE_ORDER_UNCERTAIN", {
      telefono: image.phone || null,
      sourceMessageId: image.sourceMessageId || null,
      uncertainLines: imageAnalysis.uncertain_lines.map((line) => line?.text).filter(Boolean).slice(0, 6)
    }, "warn");
  }

  return imageAnalysis;
}

function shouldTreatImageAsReceipt({ caption = null, activeOrder = null, imageAnalysis = null } = {}) {
  const normalizedCaption = normalizarTextoAnalisis(caption);
  const hasReceiptCue = normalizedCaption
    ? RECEIPT_IMAGE_KEYWORDS.some((keyword) => normalizedCaption.includes(normalizarTextoAnalisis(keyword)))
    : false;
  const hasItems = Boolean(imageAnalysis?.items?.length);
  const hasUncertain = Boolean(imageAnalysis?.uncertain_lines?.length);

  if (activeOrder && hasReceiptCue) {
    return true;
  }

  return false;
}

async function executeRecentImageReview({ telefono, sourceMessageId, origen = "webhook", simulated = false, inboundMessage = null, state = null, imageContext = null, triggerText = null, requireConfirmation = false }) {
  let imageAnalysis = {
    items: [],
    uncertain_lines: [],
    extracted_text: null,
    address: null,
    payment_method: null,
    overall_confidence: 0
  };

  logEvent("IMAGE_ORDER_PROCESS_STARTED", {
    telefono,
    sourceMessageId,
    mediaId: imageContext?.mediaId || null,
    triggerText: limpiarTexto(triggerText) || null,
    requireConfirmation
  });

  try {
    imageAnalysis = await processImageOrder(imageContext);
  } catch (error) {
    logEvent("IMAGE_ORDER_PROCESS_FAILED", {
      telefono,
      sourceMessageId,
      mediaId: imageContext?.mediaId || null,
      error: error.message
    }, "warn");
    logEvent("MODEL_ERROR", {
      model: OPENAI_MODEL,
      error: error.message,
      fallback: "image_order_ocr"
    }, "warn");
  }

  if (state && imageContext) {
    setLastImageContext(state, {
      ...imageContext,
      analysis: imageAnalysis,
      status: "ocr_completed",
      timestamp: Date.now()
    });
  }

  logEvent("IMAGE_ORDER_PROCESS_COMPLETED", {
    telefono,
    sourceMessageId,
    mediaId: imageContext?.mediaId || null,
    items: imageAnalysis.items.length,
    uncertainLines: imageAnalysis.uncertain_lines.length,
    overallConfidence: imageAnalysis.overall_confidence,
    requireConfirmation
  });

  const normalizedText = buildImageOrderNormalizedText(imageAnalysis, imageContext?.caption || null);
  if (!normalizedText) {
    const respuesta = buildImageOrderFallback({ pedido: null, evaluacion: { faltantes: [] }, imageAnalysis });
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return {
      pedido: null,
      evaluacion: { esValido: false, faltantes: ["confirmacion_catalogo"], catalogStatus: "not_found" },
      order: null,
      inboundMessage,
      respuesta,
      delivery,
      intent: "image_order_review",
      sheets: { saved: false, skipped: true, reason: "image_ocr_unresolved" }
    };
  }

  return ejecutarFlujoMensaje({
    mensaje: normalizedText,
    telefono,
    sourceMessageId,
    origen,
    simulated,
    messageType: "image",
    transcription: limpiarTexto(imageAnalysis.extracted_text) || normalizedText,
    mediaId: imageContext?.mediaId || null,
    mediaMimeType: imageContext?.mimeType || null,
    mediaFilename: imageContext?.filename || null,
    skipRateLimit: true,
    skipImageHandling: true,
    skipInboundPersist: Boolean(inboundMessage),
    existingInboundMessage: inboundMessage,
    imageAnalysis,
    imageRequiresConfirmation: requireConfirmation,
    imageCaption: imageContext?.caption || null
  });
}

function buildImageOrderFallback({ pedido = null, evaluacion = null, imageAnalysis = null }) {
  const productLines = Array.isArray(pedido?.productos)
    ? pedido.productos.map((item) => `• ${item.cantidad || 1} ${item.producto}`)
    : [];
  const uncertainLines = Array.isArray(imageAnalysis?.uncertain_lines)
    ? imageAnalysis.uncertain_lines.map((line) => `• ${line.text}`)
    : [];
  const lines = [];

  if (productLines.length) {
    lines.push("Listo 😊 Leí la imagen y entendí este pedido:", "", ...productLines);
  }

  if (uncertainLines.length) {
    if (lines.length) {
      lines.push("");
    }
    lines.push(
      uncertainLines.length > 1 ? "Hay unas líneas que quiero confirmar:" : "Hay una línea que quiero confirmar:",
      ...uncertainLines
    );
  }

  const missingData = Array.isArray(evaluacion?.faltantes) ? evaluacion.faltantes : [];
  const requiresConfirmation = missingData.includes("confirmacion_imagen") || missingData.includes("confirmacion_catalogo");
  if (missingData.includes("direccion")) {
    if (lines.length) {
      lines.push("");
    }
    lines.push("¿Me compartes la dirección de entrega?");
  }
  if (!missingData.includes("direccion") && missingData.includes("metodo_pago")) {
    if (lines.length) {
      lines.push("");
    }
    lines.push("¿Qué método de pago vas a usar?");
  }

  if (!missingData.includes("direccion") && pedido?.direccion) {
    if (lines.length) {
      lines.push("");
    }
    lines.push(`Dirección: ${pedido.direccion}`);
  }

  if (!missingData.includes("metodo_pago") && pedido?.metodo_pago) {
    lines.push(`Pago: ${pedido.metodo_pago}`);
  }

  if (!lines.length) {
    return "No alcancé a leer bien la imagen 😊 ¿Me la envías un poco más clara o me escribes el pedido?";
  }

  if (requiresConfirmation) {
    lines.push("", "¿Me confirmas si está correcto?");
  }

  return lines.join("\n");
}

async function handleIncomingImageMessage({ telefono, sourceMessageId, origen = "webhook", simulated = false, mediaId = null, mediaBuffer = null, mediaMimeType = null, mediaFilename = null, caption = null, imageAnalysisOverride = null }) {
  logEvent("IMAGE_MESSAGE_RECEIVED", {
    telefono,
    sourceMessageId,
    hasCaption: Boolean(limpiarTexto(caption)),
    mediaId: mediaId || null,
    mimeType: mediaMimeType || null
  });

  if (mediaBuffer?.length) {
    logEvent("IMAGE_MEDIA_DOWNLOADED", {
      telefono,
      sourceMessageId,
      mediaId: mediaId || null,
      bytes: mediaBuffer.length,
      mimeType: mediaMimeType || null,
      simulated
    });
  }

  const state = obtenerEstadoConversacion(telefono);
  const activeOrder = getActiveOrderByPhone(telefono);
  const persistedMedia = mediaBuffer?.length
    ? persistOrderMediaFile({ phone: telefono, mediaId, mimeType: mediaMimeType, filename: mediaFilename, buffer: mediaBuffer })
    : { mediaId, mimeType: mediaMimeType, path: null, absolutePath: null };
  const storedImageContext = buildStoredImageContext({
    telefono,
    sourceMessageId,
    mediaId,
    mediaBuffer,
    mediaMimeType,
    mediaFilename,
    caption,
    persistedMedia,
    analysis: imageAnalysisOverride,
    status: "pending"
  });
  setLastImageContext(state, storedImageContext);

  if (shouldTreatImageAsReceipt({ caption, activeOrder, imageAnalysis: imageAnalysisOverride })) {
    return handleIncomingReceiptImage({ telefono, sourceMessageId, simulated, mediaId, mediaBuffer, mediaMimeType, mediaFilename, caption });
  }

  const inboundMessage = persistirMensaje({
    phone: telefono,
    direction: "in",
    messageType: "image",
    messageText: limpiarTexto(caption) || "Imagen recibida",
    transcription: null,
    mediaId,
    whatsappMessageId: sourceMessageId
  });

  const normalizedCaption = normalizarTextoAnalisis(caption);
  const shouldProcessImmediately = Boolean(normalizedCaption)
    && !["imagen recibida", "imagen", "foto"].includes(normalizedCaption)
    && !/\b(puedes|puede|podrias|podrías)\s+(leer|revisar)\b/i.test(normalizedCaption);

  if (!shouldProcessImmediately) {
    const respuesta = "Listo 😊 recibí la imagen. La estoy revisando para sacar el pedido.";
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return {
      pedido: null,
      evaluacion: null,
      order: null,
      inboundMessage,
      respuesta,
      delivery,
      intent: "image_received",
      sheets: { saved: false, skipped: true, reason: "image_pending_ocr" }
    };
  }

  return executeRecentImageReview({
    telefono,
    sourceMessageId,
    origen,
    simulated,
    inboundMessage,
    state,
    imageContext: storedImageContext,
    triggerText: caption,
    requireConfirmation: false
  });
}

function inferirNombreDesdeConversacion(phone) {
  const messages = listMessagesByPhone(phone)
    .filter((message) => message.direction === "in")
    .slice()
    .reverse();

  for (const message of messages) {
    const detectedName = extraerNombreConversacional(message.messageText);
    if (detectedName) {
      return detectedName;
    }
  }

  return null;
}

function buildProductReference(productName) {
  const product = findCatalogProductByName(productName);
  if (!product) {
    return null;
  }

  const inferredFamilies = Array.from(detectProductResolverFamilies(normalizeCatalogText([
    product?.nombre,
    product?.nombre_canonico,
    ...(Array.isArray(product?.aliases) ? product.aliases : [])
  ].filter(Boolean).join(" "))));
  const family = inferredFamilies[0] || normalizeCatalogSemanticFamilyName(product.nombre_raiz_familia || product.nombre_familia) || product.nombre_raiz_familia || product.nombre_familia;

  return {
    id: product.id,
    nombre: product.nombre,
    nombreCanonico: product.nombre_canonico,
    familia: family,
    variant: isLargeVariant(product) ? "large" : (isSmallVariant(product) ? "small" : null)
  };
}

function buildSuggestedProductEntry(option, index = 0) {
  if (!option) {
    return null;
  }

  const reference = buildProductReference(option?.nombre || option?.productoOriginal || option);
  if (!reference) {
    return null;
  }

  return {
    indice: index + 1,
    id: reference.id,
    nombre: reference.nombre,
    nombreCanonico: reference.nombreCanonico,
    familia: reference.familia,
    variant: reference.variant,
    precio: parseOptionalNumber(option?.precio),
    aliases: Array.isArray(option?.aliases) ? option.aliases : []
  };
}

function getRequestedCatalogFamily(texto = "") {
  const families = Array.from(extractSemanticCatalogPreferences(texto).families || []);
  return families.length === 1 ? families[0] : null;
}

function getCatalogProductsForFamily(familyName, customerType = "public") {
  const family = normalizeCatalogSemanticFamilyName(familyName);
  if (!family) {
    return [];
  }

  return getCatalogProductsCache()
    .filter((product) => matchesCatalogFamily(product, family))
    .map((product) => {
      const resolvedPrice = resolveCatalogPriceForCustomer(product, customerType);
      return {
        ...product,
        precio_resuelto: parseOptionalNumber(resolvedPrice.unitPrice),
        price_source: resolvedPrice.priceSource
      };
    })
    .sort((a, b) => {
      const aLarge = isLargeVariant(a) ? 1 : 0;
      const bLarge = isLargeVariant(b) ? 1 : 0;
      if (bLarge !== aLarge) {
        return bLarge - aLarge;
      }

      const aPrice = a.precio_resuelto ?? parseOptionalNumber(a?.precio) ?? Number.MAX_SAFE_INTEGER;
      const bPrice = b.precio_resuelto ?? parseOptionalNumber(b?.precio) ?? Number.MAX_SAFE_INTEGER;
      return bPrice - aPrice;
    });
}

function buildFamilyCatalogResponse({ familyName, customerName = null, customerType = "public" } = {}) {
  const familyProducts = getCatalogProductsForFamily(familyName, customerType);
  const familyLabel = familyName === "kefir" ? "kéfir" : familyName;

  if (!familyProducts.length) {
    return {
      response: `No veo ${familyLabel} disponible en el catálogo actual. ¿Quieres que revise otra opción?`,
      products: []
    };
  }

  const saludo = customerName ? `Claro ${customerName} 😊` : "Claro 😊";
  const lines = familyProducts.map((product) => {
    const price = formatCurrency(product?.precio_resuelto ?? product?.precio ?? 0);
    const presentation = limpiarTexto(product?.presentacion);
    return `• ${product.nombre}${presentation && !normalizeCatalogText(product.nombre).includes(normalizeCatalogText(presentation)) ? ` ${presentation}` : ""}${price ? ` — ${price}` : ""}`;
  });

  return {
    response: [
      saludo,
      `De ${familyLabel} tenemos estas opciones:`,
      "",
      lines.join("\n"),
      "",
      "¿Cuál deseas agregar?"
    ].join("\n"),
    products: familyProducts
  };
}

function limpiarSuggestionMemory(state) {
  if (state) {
    state.lastSuggestedProducts = null;
  }
}

function obtenerSuggestionMemoryActiva(state, now = Date.now()) {
  if (!state?.lastSuggestedProducts) {
    return null;
  }

  if (Number(state.lastSuggestedProducts.expires_at) <= now) {
    limpiarSuggestionMemory(state);
    return null;
  }

  return state.lastSuggestedProducts;
}

function guardarSuggestionMemory(state, products = [], meta = {}) {
  if (!state) {
    return null;
  }

  const options = products
    .map((product, index) => buildSuggestedProductEntry(product, index))
    .filter(Boolean);

  if (!options.length) {
    limpiarSuggestionMemory(state);
    return null;
  }

  const createdAt = Date.now();
  state.lastSuggestedProducts = {
    tipo: meta.type || "suggested_products",
    reason: meta.reason || null,
    options,
    created_at: createdAt,
    expires_at: createdAt + SUGGESTION_MEMORY_TTL_MS
  };

  logEvent("SUGGESTION_MEMORY", {
    type: state.lastSuggestedProducts.tipo,
    reason: state.lastSuggestedProducts.reason,
    count: options.length,
    options: options.map((option) => option.nombre)
  });

  return state.lastSuggestedProducts;
}

function actualizarActiveOrderContext(state, { pedido = null, intent = null } = {}) {
  if (!state) {
    return;
  }

  const suggestionMemory = obtenerSuggestionMemoryActiva(state);
  const productos = Array.isArray(pedido?.productos)
    ? pedido.productos.filter((item) => item?.producto)
    : (Array.isArray(state.pendingPedido?.productos) ? state.pendingPedido.productos.filter((item) => item?.producto) : []);

  const updatedAt = Date.now();
  state.activeOrderContext = {
    products: productos.map((item) => ({
      producto: item.producto,
      cantidad: Number(item.cantidad) || 1
    })),
    suggestions: suggestionMemory?.options?.map((option) => option.nombre) || [],
    direccion: pedido?.direccion || state.pendingPedido?.direccion || state.activeOrderContext?.direccion || null,
    metodo_pago: pedido?.metodo_pago || state.lastPaymentMethod || state.pendingPedido?.metodo_pago || null,
    customerName: pedido?.cliente || state.customerName || null,
    intent: intent || state.lastIntent || null,
    updated_at: updatedAt,
    expires_at: updatedAt + ACTIVE_ORDER_CONTEXT_TTL_MS
  };

  logEvent("ACTIVE_CONTEXT", {
    intent: state.activeOrderContext.intent,
    products: state.activeOrderContext.products.map((item) => `${item.cantidad} ${item.producto}`),
    suggestions: state.activeOrderContext.suggestions,
    hasAddress: Boolean(state.activeOrderContext.direccion),
    hasPayment: Boolean(state.activeOrderContext.metodo_pago)
  });

  logEvent("ACTIVE_ORDER_CONTEXT", {
    intent: state.activeOrderContext.intent,
    products: state.activeOrderContext.products.map((item) => `${item.cantidad} ${item.producto}`),
    suggestions: state.activeOrderContext.suggestions,
    hasAddress: Boolean(state.activeOrderContext.direccion),
    hasPayment: Boolean(state.activeOrderContext.metodo_pago),
    customerName: state.activeOrderContext.customerName || null
  });
}

function obtenerActiveOrderContext(state, now = Date.now()) {
  if (!state?.activeOrderContext) {
    return null;
  }

  if (Number(state.activeOrderContext.expires_at) <= now) {
    state.activeOrderContext = null;
    return null;
  }

  return state.activeOrderContext;
}

function esIntencionAgregarMas(texto) {
  const normalized = normalizarTextoAnalisis(texto);
  if (!normalized) {
    return false;
  }

  return (/\b(agrega|agregame|agregale|suma|sumale|ponme|mandame|dame)\b/.test(normalized)
      && /\b(mas|más|otro|otra|otros|otras)\b/.test(normalized))
    || /^(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)?\s*(mas|más|otro|otra)$/.test(normalized)
    || /^(agrega|suma)\s+(otro|otra)$/.test(normalized);
}

function resolverReferenciaProductoEnOpciones(texto, options = []) {
  const normalized = normalizarTextoAnalisis(texto);
  if (!normalized || !options.length) {
    return null;
  }

  const selectedIndex = extraerIndiceOpcionAclaracion(texto, options.length);
  const sameReference = SAME_PRODUCT_TOKENS.some((token) => normalized.includes(normalizarTextoAnalisis(token)));
  const explicitQuantity = encontrarCantidadEnSegmento(normalized);
  if (selectedIndex !== null && selectedIndex >= 0 && options[selectedIndex] && !(sameReference && explicitQuantity !== null)) {
    return { option: options[selectedIndex], index: selectedIndex, reason: "ordinal_reference", confidence: 96 };
  }
  if (sameReference && options.length === 1) {
    return { option: options[0], index: 0, reason: "same_reference_single_option", confidence: 94 };
  }

  const familyMatches = options.filter((option) => {
    const family = normalizeCatalogSemanticFamilyName(option?.familia || option?.nombreCanonico || option?.nombre);
    return family && normalized.includes(family);
  });
  const wantsLarge = includesAnyToken(normalized, SIZE_LARGE_TOKENS);
  const wantsSmall = includesAnyToken(normalized, SIZE_SMALL_TOKENS);
  const wantsValue = includesAnyToken(normalized, PRICE_VALUE_TOKENS);

  if (familyMatches.length === 1) {
    const option = familyMatches[0];
    return { option, index: options.findIndex((candidate) => candidate?.id === option?.id), reason: "family_reference", confidence: 90 };
  }

  if (familyMatches.length > 1 && !wantsLarge && !wantsSmall && !wantsValue) {
    const option = familyMatches[0];
    return { option, index: options.findIndex((candidate) => candidate?.id === option?.id), reason: "family_reference_ranked", confidence: 78 };
  }

  const matchingPool = familyMatches.length ? familyMatches : options;

  if (wantsLarge) {
    const option = matchingPool.find((entry) => entry.variant === "large") || matchingPool[matchingPool.length - 1] || null;
    if (option) {
      return { option, index: options.findIndex((candidate) => candidate?.id === option?.id), reason: "variant_large_reference", confidence: 88 };
    }
  }

  if (wantsSmall) {
    const option = matchingPool.find((entry) => entry.variant === "small") || matchingPool[0] || null;
    if (option) {
      return { option, index: options.findIndex((candidate) => candidate?.id === option?.id), reason: "variant_small_reference", confidence: 88 };
    }
  }

  if (wantsValue) {
    const option = matchingPool.slice().sort((a, b) => (a.precio ?? Number.MAX_SAFE_INTEGER) - (b.precio ?? Number.MAX_SAFE_INTEGER))[0] || null;
    if (option) {
      return { option, index: options.findIndex((candidate) => candidate?.id === option?.id), reason: "value_reference", confidence: 86 };
    }
  }

  if (sameReference) {
    const option = matchingPool[0] || options[0] || null;
    if (option) {
      return { option, index: options.findIndex((candidate) => candidate?.id === option?.id), reason: "same_reference_ranked", confidence: 82 };
    }
  }

  const aliasMatches = options
    .map((option, index) => {
      const candidates = [option?.nombre, option?.nombreCanonico, ...(option?.aliases || [])].filter(Boolean);
      let bestScore = 0;
      for (const candidate of candidates) {
        bestScore = Math.max(bestScore, puntuarCoincidenciaCatalogo(limpiarTextoProductoSolicitado(texto), normalizeCatalogText(candidate)));
      }
      return { option, index, score: bestScore };
    })
    .sort((a, b) => b.score - a.score);

  if (aliasMatches[0]?.score >= 72) {
    return { option: aliasMatches[0].option, index: aliasMatches[0].index, reason: "fuzzy_option_reference", confidence: normalizarScoreAConfianza(aliasMatches[0].score) };
  }

  if (sameReference && options.length > 0) {
    return { option: options[0], index: 0, reason: "same_reference_fallback", confidence: 74 };
  }

  return null;
}

function actualizarMemoriaConversacional(state, { pedido = null, evaluacion = null, intent = null } = {}) {
  if (!state) {
    return;
  }

  appendRecentHistory(state, {
    role: "assistant_state",
    intent,
    text: Array.isArray(pedido?.productos) && pedido.productos.length
      ? pedido.productos.map((item) => `${item.cantidad || 1} ${item.producto || "producto"}`).join(", ")
      : intent || "state_update"
  });

  if (pedido?.cliente) {
    state.customerName = pedido.cliente;
    state.awaitingName = false;
  }

  if (pedido?.metodo_pago) {
    state.lastPaymentMethod = pedido.metodo_pago;
  }

  const productos = Array.isArray(pedido?.productos) ? pedido.productos : [];
  const lastProduct = productos[productos.length - 1];
  const lastReference = buildProductReference(lastProduct?.producto);
  if (lastReference) {
    state.lastProductReference = lastReference;
    logProductMemory(state, "last_product_from_order");
  }

  if (evaluacion?.catalogStatus === "ambiguous" && evaluacion.ambiguousProducts?.length) {
    const firstAmbiguity = evaluacion.ambiguousProducts[0];
    guardarSuggestionMemory(state, firstAmbiguity?.options || [], {
      type: firstAmbiguity?.soft ? "soft_suggestion" : "ambiguity_suggestion",
      reason: firstAmbiguity?.input || null
    });

    const firstOption = firstAmbiguity?.options?.[0];
    const ambiguityReference = buildProductReference(firstOption?.nombre);
    if (ambiguityReference) {
      state.lastProductReference = ambiguityReference;
      logProductMemory(state, "ambiguity_resolution_seed");
    }
  }

  if (evaluacion?.esValido && Array.isArray(pedido?.productos) && pedido.productos.length) {
    state.lastResolvedOrder = {
      cliente: pedido.cliente || state.customerName || null,
      productos: pedido.productos,
      direccion: pedido.direccion || null,
      metodo_pago: pedido.metodo_pago || null,
      total: pedido.total || null,
      updated_at: Date.now()
    };
  }

  if (intent) {
    state.lastIntent = intent;
    if (intent === "greeting" && !state.customerName) {
      state.awaitingName = true;
    } else if (intent !== "provide_name") {
      state.awaitingName = false;
    }
  }

  actualizarActiveOrderContext(state, { pedido, intent });

  logEvent("CONVERSATION_STATE", {
    customerName: state.customerName || null,
    lastIntent: state.lastIntent || null,
    awaitingName: state.awaitingName || false,
    hasShownOrderGuide: state.hasShownOrderGuide || false,
    lastImageStatus: state.lastImageContext?.status || null,
    pendingItems: Array.isArray(state.pendingPedido?.productos) ? state.pendingPedido.productos.length : 0,
    hasSuggestionMemory: Boolean(obtenerSuggestionMemoryActiva(state)),
    lastProduct: state.lastProductReference?.nombre || null
  });

  logMultiTurnState(state);
}

function aplicarContextoProductoAMensaje(texto, state) {
  const raw = String(texto || "").trim();
  if (!raw) {
    return { text: raw, used: false };
  }

  const normalized = normalizarTextoAnalisis(raw);
  if (!normalized) {
    return { text: raw, used: false };
  }

  const activeContext = obtenerActiveOrderContext(state);
  const lastActiveProduct = activeContext?.products?.[activeContext.products.length - 1]?.producto || state?.lastProductReference?.nombre || null;
  if (esIntencionReorden(raw)) {
    return { text: raw, used: false };
  }

  if (new RegExp(`^${QUANTITY_TOKEN_PATTERN}$`, "i").test(normalized) && lastActiveProduct) {
    return {
      text: `${resolverCantidadContextual(normalized, { defaultQuantity: 1 })} ${lastActiveProduct}`,
      used: true,
      reason: "quantity_for_active_product",
      selectedProduct: lastActiveProduct,
      appendProducts: false
    };
  }

  if (lastActiveProduct && new RegExp(`^(?:dame|mandame|mándame|ponme|agrega|agregame|agrégame|quiero)\s+${QUANTITY_TOKEN_PATTERN}$`, "i").test(normalized)) {
    return {
      text: `${resolverCantidadContextual(normalized, { defaultQuantity: 1 })} ${lastActiveProduct}`,
      used: true,
      reason: "verb_quantity_for_active_product",
      selectedProduct: lastActiveProduct,
      appendProducts: false
    };
  }

  if (esIntencionAgregarMas(raw) && lastActiveProduct) {
    return {
      text: `${resolverCantidadContextual(normalized, { defaultQuantity: 1 })} ${lastActiveProduct}`,
      used: true,
      reason: "active_order_append_reference",
      selectedProduct: lastActiveProduct,
      appendProducts: true
    };
  }

  const sameProductReference = state?.lastProductReference?.nombre || lastActiveProduct || null;
  if (sameProductReference && SAME_PRODUCT_TOKENS.some((token) => normalized.includes(normalizarTextoAnalisis(token)))) {
    return {
      text: `${resolverCantidadContextual(normalized, { defaultQuantity: 1 })} ${sameProductReference}`,
      used: true,
      reason: "same_product_reference",
      selectedProduct: sameProductReference,
      appendProducts: esIntencionAgregarMas(raw)
    };
  }

  const hasFamilyReference = Boolean(state?.lastProductReference?.familia);
  const hasVariantCue = includesAnyToken(normalized, [...SIZE_SMALL_TOKENS, ...SIZE_LARGE_TOKENS]);
  const hasValueCue = includesAnyToken(normalized, PRICE_VALUE_TOKENS);
  if (hasFamilyReference) {
    const alreadyMentionsFamily = getCatalogProductsCache().some((product) => {
      const family = normalizeCatalogSemanticFamilyName(product?.nombre_raiz_familia || product?.nombre_familia);
      return family && normalized.includes(family);
    });

    if (!alreadyMentionsFamily && (hasVariantCue || hasValueCue)) {
      const contextualProduct = resolverProductoContextualPorFamilia(raw, state.lastProductReference.familia);
      if (contextualProduct?.nombre) {
        logEvent("PENDING_PRODUCT_RESOLVED", {
          input: raw,
          family: state.lastProductReference.familia,
          product: contextualProduct.nombre,
          reason: hasValueCue ? "family_value_context_reference" : "family_variant_context_reference"
        });
        return {
          text: `${resolverCantidadContextual(normalized, { defaultQuantity: 1 })} ${contextualProduct.nombre}`,
          used: true,
          reason: hasValueCue ? "family_value_context_reference" : "family_variant_context_reference",
          selectedProduct: contextualProduct.nombre,
          appendProducts: esIntencionAgregarMas(raw)
        };
      }

      logEvent("PENDING_PRODUCT_RESOLVED", {
        input: raw,
        family: state.lastProductReference.familia,
        product: null,
        reason: "family_context_reference"
      });
      return {
        text: `${state.lastProductReference.familia} ${raw}`.trim(),
        used: true,
        reason: "family_context_reference",
        appendProducts: esIntencionAgregarMas(raw)
      };
    }

    if (alreadyMentionsFamily) {
      return { text: raw, used: false };
    }
  }

  const suggestionMemory = obtenerSuggestionMemoryActiva(state);
  const suggestionResolution = resolverReferenciaProductoEnOpciones(raw, suggestionMemory?.options || []);
  if (suggestionResolution?.option?.nombre) {
    logEvent("PRODUCT_MATCH_CONFIDENCE", {
      input: raw,
      status: "suggestion_resolved",
      confidence: suggestionResolution.confidence,
      product: suggestionResolution.option.nombre,
      reason: suggestionResolution.reason
    });
    logConfidenceLevel({ source: "suggestion_memory", stage: "context_resolution", confidence: suggestionResolution.confidence, input: raw });

    return {
      text: `${resolverCantidadContextual(normalized, { defaultQuantity: 1 })} ${suggestionResolution.option.nombre}`,
      used: true,
      reason: suggestionResolution.reason,
      selectedProduct: suggestionResolution.option.nombre,
      appendProducts: esIntencionAgregarMas(raw)
    };
  }

  return { text: raw, used: false };
}

function obtenerEstadoConversacion(phone) {
  const key = limpiarTexto(phone);
  if (!key) {
    return createDefaultConversationState();
  }

  return getConversationState(conversationMemoryState, key, { customerName: inferirNombreDesdeConversacion(key) });
}

function limpiarAclaracionPendiente(state) {
  if (state) {
    state.pendingClarification = null;
  }
}

function obtenerAclaracionPendienteActiva(state, now = Date.now()) {
  if (!state?.pendingClarification) {
    return null;
  }

  if (Number(state.pendingClarification.expires_at) <= now) {
    limpiarAclaracionPendiente(state);
    return null;
  }

  return state.pendingClarification;
}

function construirEstadoAclaracionProducto({ ambiguity, pedidoParcial }) {
  const createdAt = Date.now();
  const ambiguityCustomizations = mergeCustomizations([], ambiguity?.customizations || []);

  return {
    phone: null,
    tipo: "product_disambiguation",
    opciones: (ambiguity?.options || []).map((option, index) => ({
      indice: index + 1,
      id: option.id,
      nombre: option.nombre,
      precio: parseOptionalNumber(option.precio),
      productoOriginal: option.productoOriginal || option.nombre,
      nombreCanonico: option.nombreCanonico || normalizeCanonicalCatalogName(option.nombre),
      aliases: option.aliases || []
    })),
    pedido_parcial: normalizarPedido(pedidoParcial || {}),
    cantidad: encontrarCantidadEnSegmento(normalizarTextoAnalisis(ambiguity?.input || "")) || 1,
    customizations: ambiguityCustomizations,
    created_at: createdAt,
    expires_at: createdAt + PRODUCT_DISAMBIGUATION_TTL_MS
  };
}

function extraerIndiceOpcionAclaracion(texto, totalOpciones = 0) {
  const normalized = normalizarTextoAnalisis(texto);
  if (!normalized || totalOpciones <= 0) {
    return null;
  }

  const numericMatch = normalized.match(/(?:^|\b)(\d+)(?:$|\b)/);
  if (numericMatch) {
    const index = Number.parseInt(numericMatch[1], 10);
    return index >= 1 && index <= totalOpciones ? index - 1 : -1;
  }

  const ordinalMap = new Map([
    ["primera", 0], ["primero", 0],
    ["segunda", 1], ["segundo", 1],
    ["tercera", 2], ["tercero", 2],
    ["cuarta", 3], ["cuarto", 3]
  ]);

  for (const [token, index] of ordinalMap.entries()) {
    if (normalized.includes(token)) {
      return index < totalOpciones ? index : -1;
    }
  }

  return null;
}

function construirPedidoDesdeEstado(state) {
  if (state?.pendingPedido) {
    return normalizarPedido(state.pendingPedido);
  }

  const activeContext = obtenerActiveOrderContext(state);
  const customerType = normalizeCustomerType(state?.customerType, "public");
  if (!activeContext?.products?.length) {
    return normalizarPedido({ cliente: state?.customerName || null, customer_type_applied: customerType, price_tier_applied: customerType });
  }

  return calcularTotalesPedido({
    cliente: state?.customerName || activeContext.customerName || null,
    customer_type_applied: customerType,
    price_tier_applied: customerType,
    productos: activeContext.products.map((item) => ({
      producto: item.producto,
      cantidad: item.cantidad || 1
    })),
    direccion: activeContext.direccion || null,
    metodo_pago: activeContext.metodo_pago || null,
    estado: "pendiente"
  });
}

function buscarUltimoPedidoCliente(telefono) {
  return listOrdersIncludingArchived()
    .filter((order) => limpiarTexto(order?.telefono) === limpiarTexto(telefono))
    .sort((a, b) => new Date(b?.fechaRegistro || 0).getTime() - new Date(a?.fechaRegistro || 0).getTime())[0] || null;
}

function construirPedidoDesdeOrder(order) {
  if (!order) {
    return null;
  }

  return calcularTotalesPedido({
    cliente: order.cliente || null,
    customer_type_applied: normalizeCustomerType(order.customerTypeApplied ?? order.customer_type_applied, "public"),
    price_tier_applied: normalizeCustomerType(order.priceTierApplied ?? order.price_tier_applied, "public"),
    productos: (order.items || []).map((item) => ({
      producto: item.producto,
      sabor: item.sabor || null,
      cantidad: item.cantidad || 1,
      precio_unitario: item.precioUnitario,
      subtotal: item.subtotal,
      price_source: item.priceSource || item.price_source || "public",
      product_notes: item.productNotes || item.product_notes || null,
      customizations: mergeCustomizations([], item.customizations)
    })),
    direccion: order.direccion || null,
    metodo_pago: order.metodoPago || null,
    observaciones: order.observaciones || null,
    notes: order.notes || null,
    customizations: mergeCustomizations([], order.customizations),
    receipt: order.receipt || null,
    estado: order.estado || "pendiente"
  });
}

function encontrarIndiceProductoEnPedido(pedido, texto, state) {
  const productos = Array.isArray(pedido?.productos) ? pedido.productos : [];
  if (!productos.length) {
    return -1;
  }

  const normalized = normalizarTextoAnalisis(texto);
  const explicitMatches = productos
    .map((item, index) => ({ item, index, score: puntuarCoincidenciaCatalogo(normalizeCatalogText(texto), normalizeCatalogText(item?.producto)) }))
    .sort((a, b) => b.score - a.score);

  if (explicitMatches[0]?.score >= 72) {
    return explicitMatches[0].index;
  }

  const lastProduct = state?.lastProductReference?.nombre;
  if (/\b(ese|esa|el otro|el grande|el pequeno|el pequeño|el barato|primero|segunda?|tercero)\b/.test(normalized)) {
    if (SAME_PRODUCT_TOKENS.some((token) => normalized.includes(normalizarTextoAnalisis(token))) && lastProduct) {
      const sameIdx = productos.findIndex((item) => normalizeCatalogText(item?.producto) === normalizeCatalogText(lastProduct));
      if (sameIdx >= 0) {
        return sameIdx;
      }
    }

    const options = productos.map((item, index) => ({
      id: String(index + 1),
      nombre: item.producto,
      precio: item.precio_unitario,
      variant: /\b(garrafa|grande|kilo|1800 ml|1000 g)\b/i.test(item.producto) ? "large" : (/\b(litro|500 g|250 g|pequeno|pequeño)\b/i.test(item.producto) ? "small" : null)
    }));
    const resolution = resolverReferenciaProductoEnOpciones(texto, options);
    if (resolution?.index !== null && resolution?.index !== undefined) {
      return resolution.index;
    }
  }

  if (lastProduct) {
    const idx = productos.findIndex((item) => normalizeCatalogText(item?.producto) === normalizeCatalogText(lastProduct));
    if (idx >= 0) {
      return idx;
    }
  }

  return productos.length === 1 ? 0 : productos.length - 1;
}

function quitarProductoDePedido(pedido, texto, state) {
  const productos = Array.isArray(pedido?.productos) ? [...pedido.productos] : [];
  const index = encontrarIndiceProductoEnPedido(pedido, texto, state);
  if (index < 0 || !productos[index]) {
    return { pedido, removed: null };
  }

  const [removed] = productos.splice(index, 1);
  return {
    pedido: calcularTotalesPedido({ ...pedido, productos }),
    removed
  };
}

function actualizarCantidadPedido(pedido, texto, state) {
  const productos = Array.isArray(pedido?.productos) ? [...pedido.productos] : [];
  const normalized = normalizarTextoAnalisis(texto);
  const index = encontrarIndiceProductoEnPedido(pedido, texto, state);
  const isIncrement = /\b(mas|más|agrega|suma|otro|otra)\b/.test(normalized) && !/\bsolo\b/.test(normalized);
  const cantidad = resolverCantidadContextual(normalized, { defaultQuantity: isIncrement ? 1 : null });
  if (index < 0 || !productos[index] || !cantidad) {
    return { pedido, updated: null };
  }

  productos[index] = {
    ...productos[index],
    cantidad: isIncrement ? (Number(productos[index].cantidad) || 0) + cantidad : cantidad
  };

  return {
    pedido: calcularTotalesPedido({ ...pedido, productos }),
    updated: productos[index]
  };
}

function agregarProductoAPedido(pedidoBase = {}, item = {}) {
  const productosBase = Array.isArray(pedidoBase.productos) ? pedidoBase.productos : [];
  return calcularTotalesPedido({
    ...pedidoBase,
    productos: [...productosBase, item]
  });
}

async function intentarResolverAclaracionPendiente({ state, mensaje, telefono, sourceMessageId, simulated, inboundMessage }) {
  const clarification = obtenerAclaracionPendienteActiva(state);
  if (!clarification || clarification.tipo !== "product_disambiguation") {
    return null;
  }

  const resolution = resolverReferenciaProductoEnOpciones(mensaje, clarification.opciones);
  const selectedIndex = resolution?.index ?? null;
  if (selectedIndex === null || selectedIndex < 0) {
    const respuesta = `Por favor responde con el número de la opción: ${clarification.opciones.map((option) => option.indice).join(" o ")}.`;
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return {
      pedido: clarification.pedido_parcial,
      evaluacion: null,
      order: null,
      inboundMessage,
      respuesta,
      delivery,
      sheets: { saved: false, skipped: true, reason: "awaiting_valid_disambiguation_choice" },
      intent: "ambiguous_product"
    };
  }

  const selectedOption = resolution?.option || clarification.opciones[selectedIndex];
  if (!selectedOption) {
    return null;
  }

  logEvent("PENDING_PRODUCT_RESOLVED", {
    input: mensaje,
    family: buildProductReference(selectedOption.nombre)?.familia || null,
    product: selectedOption.nombre,
    reason: resolution?.reason || "pending_clarification"
  });

  const pedidoResuelto = agregarProductoAPedido(clarification.pedido_parcial || {}, {
    producto: selectedOption.nombre,
    cantidad: clarification.cantidad || 1,
    precio_unitario: parseOptionalNumber(selectedOption.precio),
    product_notes: buildNotesFromCustomizations(clarification.customizations || []),
    customizations: mergeCustomizations([], clarification.customizations || [])
  });
  if (!pedidoResuelto.cliente && state.customerName) {
    pedidoResuelto.cliente = state.customerName;
  }

  const evaluacion = evaluarPedido(pedidoResuelto, { ambiguities: [], unmatched: [] });
  let order = null;
  let sheets = { saved: false, skipped: true, reason: "order_not_persisted" };
  const intent = evaluacion.esValido ? "order_request" : "order_missing_data";

  logEvent("product_disambiguation_resolved", {
    telefono,
    sourceMessageId,
    selectedIndex: selectedIndex + 1,
    selectedProduct: selectedOption.nombre,
    reason: resolution?.reason || "numeric_choice",
    confidence: resolution?.confidence || null
  });

  if (evaluacion.esValido) {
    const persisted = await persistirPedidoFinal({
      pedido: pedidoResuelto,
      telefono,
      mensajeOriginal: mensaje,
      sourceMessageId
    });
    order = persisted.order;
    sheets = persisted.sheets;
    state.pendingPedido = null;
  } else {
    state.pendingPedido = pedidoResuelto;
  }

  actualizarMemoriaConversacional(state, { pedido: pedidoResuelto, evaluacion, intent });

  limpiarAclaracionPendiente(state);

  if (order?.id && inboundMessage?.id) {
    updateMessageOrder(inboundMessage.id, order.id);
    inboundMessage.orderId = order.id;
  }

  const respuesta = construirRespuestaPedido(pedidoResuelto, evaluacion, {
    availableProducts: buildCatalogShortList(5)
  });
  const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: order?.id || null });

  return {
    pedido: pedidoResuelto,
    evaluacion,
    order,
    inboundMessage,
    respuesta,
    delivery,
    sheets,
    intent
  };
}

function tieneBorradorPedido(state) {
  return Boolean(state?.pendingPedido && (
    (Array.isArray(state.pendingPedido.productos) && state.pendingPedido.productos.length)
    || state.pendingPedido.direccion
    || state.pendingPedido.metodo_pago
    || state.pendingPedido.fecha_entrega
  ));
}

function combinarPedidoParcial(base = {}, incoming = {}) {
  return combinarPedidoParcialConOpciones(base, incoming, { appendProducts: false });
}

function combinarPedidoParcialConOpciones(base = {}, incoming = {}, { appendProducts = false } = {}) {
  const incomingProducts = Array.isArray(incoming.productos) ? incoming.productos.filter((item) => item?.producto || item?.cantidad) : [];
  const baseProducts = Array.isArray(base.productos) ? base.productos.filter((item) => item?.producto || item?.cantidad) : [];
  const mergedProducts = appendProducts
    ? consolidarItemsPedido([...baseProducts, ...incomingProducts])
    : (incomingProducts.length ? incomingProducts : baseProducts);

  return calcularTotalesPedido({
    cliente: incoming.cliente || base.cliente || null,
    productos: mergedProducts,
    direccion: incoming.direccion || base.direccion || null,
    fecha_entrega: incoming.fecha_entrega || base.fecha_entrega || null,
    metodo_pago: incoming.metodo_pago || base.metodo_pago || null,
    observaciones: incoming.observaciones || base.observaciones || null,
    notes: incoming.notes || base.notes || null,
    customizations: mergeCustomizations(base.customizations, incoming.customizations),
    receipt: incoming.receipt || base.receipt || null,
    estado: incoming.estado || base.estado || "pendiente",
    total: null
  });
}

async function persistirPedidoFinal({ pedido, telefono, mensajeOriginal, sourceMessageId }) {
  logEvent("db_save_started", {
    telefono: telefono || null,
    sourceMessageId: sourceMessageId || null,
    total: pedido.total,
    items: Array.isArray(pedido.productos) ? pedido.productos.length : 0
  });

  const order = saveOrder({
    pedido,
    telefono,
    mensajeOriginal,
    sourceMessageId
  });

  logEvent("order_saved", {
    id: order.id,
    telefono: order.telefono,
    estado: order.estado,
    total: order.total,
    items: order.itemCount,
    createdAt: order.fechaRegistro
  });

  logEvent("sheets_sync_started", {
    orderId: order.id,
    telefono: order.telefono
  });

  const sheets = await respaldarPedidoEnSheets(order);
  logEvent("sheets_sync_completed", {
    orderId: order.id,
    telefono: order.telefono,
    saved: sheets.saved,
    skipped: sheets.skipped,
    mode: sheets.mode || null,
    rowsWritten: sheets.rowsWritten || 0,
    reason: sheets.reason || null,
    error: sheets.error || null
  });

  if (!String(sourceMessageId || "").startsWith("simulate_")) {
    await notifyAdminWhatsAppNumbers({
      message: buildAdminNewOrderMessage(order),
      context: "new_order",
      metadata: {
        orderId: order.id,
        telefono: order.telefono
      }
    });
  }

  return { order, sheets };
}

async function responderAlCliente({ telefono, respuesta, simulated = false, orderId = null }) {
  const respuestaFinal = orderId ? appendBusinessHoursNotice(respuesta) : respuesta;

  logEvent("responder_al_cliente_called", {
    telefono,
    orderId,
    simulated,
    whatsappEnabled: WHATSAPP_ENABLED,
    textLength: String(respuestaFinal || "").length
  });

  if (simulated || !WHATSAPP_ENABLED) {
    const simulatedMessageId = buildSimulatedSourceMessageId("simulate_out");
    const savedMessage = persistirMensaje({
      phone: telefono,
      direction: "out",
      messageText: respuestaFinal,
      whatsappMessageId: simulatedMessageId,
      orderId
    });

    logEvent("simulated_send", {
      telefono,
      whatsappEnabled: WHATSAPP_ENABLED,
      simulated,
      messageId: savedMessage?.id || null,
      whatsappMessageId: simulatedMessageId,
      orderId
    });

    runDeliveryHook({
      mode: "simulated",
      telefono,
      orderId,
      messageId: savedMessage?.id || null,
      whatsappMessageId: simulatedMessageId
    });

    return {
      sent: false,
      simulated: true,
      reason: simulated ? "simulate_endpoint" : "whatsapp_disabled",
      respuesta: respuestaFinal,
      message: savedMessage
    };
  }

  logEvent("whatsapp_send_started", {
    telefono,
    orderId,
    textLength: String(respuestaFinal || "").length
  });

  try {
    const delivery = await enviarMensajeWhatsApp(telefono, respuestaFinal);
    const whatsappMessageId = delivery?.messages?.[0]?.id || null;
    const savedMessage = persistirMensaje({
      phone: telefono,
      direction: "out",
      messageText: respuestaFinal,
      whatsappMessageId,
      orderId
    });

    logEvent("whatsapp_send_completed", {
      telefono,
      messageId: savedMessage?.id || null,
      whatsappMessageId,
      orderId
    });

    runDeliveryHook({
      mode: "real",
      telefono,
      orderId,
      messageId: savedMessage?.id || null,
      whatsappMessageId,
      delivery
    });

    return {
      sent: true,
      simulated: false,
      respuesta: respuestaFinal,
      message: savedMessage,
      whatsappMessageId
    };
  } catch (error) {
    logEvent("whatsapp_send_error", {
      telefono,
      orderId,
      status: error.response?.status || null,
      error: error.response?.data || error.message
    }, "error");

    return {
      sent: false,
      simulated: false,
      respuesta: respuestaFinal,
      message: null,
      whatsappMessageId: null,
      error: error.response?.data || error.message
    };
  }
}

async function ejecutarFlujoMensaje({ mensaje, telefono, sourceMessageId, origen = "webhook", simulated = false, messageType = "text", transcription = null, mediaId = null, mediaBuffer = null, mediaMimeType = null, mediaFilename = null, skipRateLimit = false, skipImageHandling = false, skipInboundPersist = false, existingInboundMessage = null, imageAnalysis = null, imageAnalysisOverride = null, imageRequiresConfirmation = false, imageCaption = null }) {
  logEvent("mensaje_recibido", { origen, telefono, sourceMessageId, messageType, mediaId: mediaId || null });

  const receivedAtMs = Date.now();

  if (!skipRateLimit && excedeRateLimit(telefono, receivedAtMs)) {
    logEvent("rate_limit_exceeded", { telefono, origen, sourceMessageId }, "warn");

    if (debeNotificarRateLimit(telefono, receivedAtMs)) {
      const respuesta = "Estoy recibiendo muchos mensajes seguidos 😅. Envíame uno solo con producto, dirección y pago, y te ayudo.";
      const delivery = await responderAlCliente({
        telefono,
        respuesta,
        simulated,
        orderId: null
      });

      return {
        pedido: null,
        evaluacion: null,
        order: null,
        inboundMessage: null,
        respuesta,
        delivery,
        ignored: true,
        ignoredReason: "rate_limit"
      };
    }

    return {
      pedido: null,
      evaluacion: null,
      order: null,
      inboundMessage: null,
      respuesta: null,
      delivery: null,
      ignored: true,
      ignoredReason: "rate_limit"
    };
  }

  if (messageType === "image" && !skipImageHandling) {
    return handleIncomingImageMessage({
      telefono,
      sourceMessageId,
      origen,
      simulated,
      mediaId,
      mediaBuffer,
      mediaMimeType,
      mediaFilename,
      caption: mensaje,
      imageAnalysisOverride
    });
  }

  const previousMessageCount = countMessagesByPhone(telefono);
  const activeOrderBefore = getActiveOrderByPhone(telefono);
  const state = obtenerEstadoConversacion(telefono);
  const customerProfile = resolveCustomerProfile(telefono);
  if (customerProfile.customerName) {
    state.customerName = customerProfile.customerName;
    state.awaitingName = false;
  }
  state.customerType = customerProfile.customerType;
  state.registeredCustomerId = customerProfile.customer?.id || null;
  const contextualizedMessage = aplicarContextoProductoAMensaje(mensaje, state);
  const hasDraftContext = tieneBorradorPedido(state);
  const hasSuggestionContext = Boolean(obtenerSuggestionMemoryActiva(state));
  const hasActiveOrderContext = Boolean(obtenerActiveOrderContext(state));
  const heuristicIntent = detectarIntencionConversacional(mensaje, {
    hasDraftContext,
    hasActiveContext: hasSuggestionContext || hasActiveOrderContext || Boolean(contextualizedMessage.used),
    customerName: state.customerName || null,
    awaitingName: state.awaitingName || false,
    state
  });

  const inboundMessage = skipInboundPersist
    ? existingInboundMessage
    : persistirMensaje({
        phone: telefono,
        direction: "in",
        messageType: messageType === "image" ? "image" : messageType,
        messageText: messageType === "image" ? (limpiarTexto(imageCaption) || "Imagen recibida") : mensaje,
        transcription: messageType === "image" ? (limpiarTexto(transcription) || limpiarTexto(mensaje)) : transcription,
        mediaId,
        whatsappMessageId: sourceMessageId
      });

  const lastImageContext = getLastImageContext(state);
  if (messageType === "text" && esConfirmacionCasual(mensaje) && hasPendingImageConfirmation(state)) {
    logLastImageContextFound(lastImageContext, telefono, sourceMessageId);
    const pedidoConfirmado = calcularTotalesPedido({
      ...state.pendingPedido,
      customer_type_applied: customerProfile.customerType,
      price_tier_applied: customerProfile.customerType
    });
    const evaluacionConfirmada = evaluarPedido(pedidoConfirmado, { ambiguities: [], unmatched: [] });
    const persisted = await persistirPedidoFinal({
      pedido: pedidoConfirmado,
      telefono,
      mensajeOriginal: mensaje,
      sourceMessageId
    });
    state.pendingPedido = null;
    limpiarAclaracionPendiente(state);
    actualizarMemoriaConversacional(state, { pedido: pedidoConfirmado, evaluacion: evaluacionConfirmada, intent: "order_request" });
    const respuesta = construirRespuestaPedido(pedidoConfirmado, evaluacionConfirmada, { availableProducts: buildCatalogShortList(5) });
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: persisted.order?.id || null });
    return {
      pedido: pedidoConfirmado,
      evaluacion: evaluacionConfirmada,
      order: persisted.order,
      inboundMessage,
      respuesta: delivery?.respuesta || respuesta,
      delivery,
      intent: "order_request",
      sheets: persisted.sheets
    };
  }
  if (messageType === "text" && isImageReferencePhrase(mensaje)) {
    logEvent("IMAGE_REFERENCE_DETECTED", {
      telefono,
      sourceMessageId,
      hasLastImage: Boolean(lastImageContext),
      text: limpiarTexto(mensaje)?.slice(0, 120) || null
    });
  }
  if (messageType === "text" && isImageReferencePhrase(mensaje) && !lastImageContext) {
    const respuesta = "Claro 😊 envíame la imagen del pedido y la reviso.";
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return {
      pedido: state.pendingPedido || null,
      evaluacion: state.pendingPedido ? evaluarPedido(state.pendingPedido, { ambiguities: [], unmatched: [] }) : null,
      order: null,
      inboundMessage,
      respuesta,
      delivery,
      intent: "image_reference_missing",
      sheets: { saved: false, skipped: true, reason: "missing_recent_image" }
    };
  }
  if (messageType === "text" && isImageReviewRequest(mensaje, state) && lastImageContext) {
    logLastImageContextFound(lastImageContext, telefono, sourceMessageId);
    return executeRecentImageReview({
      telefono,
      sourceMessageId,
      origen,
      simulated,
      inboundMessage,
      state,
      imageContext: lastImageContext,
      triggerText: mensaje,
      requireConfirmation: true
    });
  }

  const orchestratorPayload = buildConversationOrchestratorContext({
    currentMessage: mensaje,
    messageType,
    transcription,
    customerName: state.customerName || customerProfile.customerName || null,
    phone: telefono,
    customerType: customerProfile.customerType,
    activeOrder: activeOrderBefore,
    pendingOrder: state.pendingPedido,
    lastResolvedOrder: state.lastResolvedOrder,
    recentSuggestions: obtenerSuggestionMemoryActiva(state)?.options || [],
    relevantCatalog: buildRelevantCatalogForOrchestrator(contextualizedMessage.text || mensaje, state, customerProfile.customerType),
    recentMessages: buildRecentMessagesForOrchestrator(telefono, 5),
    state,
    address: state.pendingPedido?.direccion || activeOrderBefore?.direccion || null,
    paymentMethod: state.pendingPedido?.metodo_pago || state.lastPaymentMethod || activeOrderBefore?.metodoPago || null,
    notes: state.pendingPedido?.notes || activeOrderBefore?.notes || null,
    customizations: state.pendingPedido?.customizations || activeOrderBefore?.customizations || [],
    businessHours: getBusinessHoursContext(),
    isAdmin: isAdminWhatsAppNumber(telefono),
    adminCommandAuthorized: isKnownAdminCommand(mensaje) && isAdminWhatsAppNumber(telefono)
  });

  logEvent("ORCHESTRATOR_CONTEXT_READY", {
    telefono,
    sourceMessageId,
    customerType: customerProfile.customerType,
    relevantCatalog: orchestratorPayload.context.relevantCatalog.length,
    recentMessages: orchestratorPayload.context.recentMessages.length,
    hasPendingOrder: Boolean(orchestratorPayload.context.pendingOrder),
    hasActiveOrder: Boolean(orchestratorPayload.context.activeOrder)
  });
  logEvent("TOKEN_USAGE_ESTIMATE", {
    telefono,
    sourceMessageId,
    stage: "orchestrator_context",
    estimatedTokens: orchestratorPayload.tokenEstimate
  });

  let gptIntent = {
    intent: "general",
    confidence: 0,
    products_mentioned: [],
    requested_changes: [],
    missing_data: [],
    suggested_response_goal: ""
  };

  try {
    gptIntent = await inferConversationIntent(orchestratorPayload.context);
  } catch (error) {
    logEvent("MODEL_ERROR", {
      model: OPENAI_MODEL,
      error: error.message,
      fallback: "heuristic_intent"
    }, "warn");
  }

  const routingIntent = resolveRoutingIntentWithGpt({
    heuristicIntent,
    gptIntent,
    hasDraftContext,
    hasActiveContext: hasSuggestionContext || hasActiveOrderContext || Boolean(contextualizedMessage.used)
  });
  const shouldForceOrderFlow = contextualizedMessage.used
    || esReferenciaAmbigua(mensaje, state)
    || gptIntent.intent === "add_item"
    || hasResolvableSpecialInstructionOrder(mensaje);
  const effectiveRoutingIntent = shouldForceOrderFlow && ["general_chat", "catalog_request", "price_request"].includes(routingIntent)
    ? "order_missing_data"
    : routingIntent;
  const hasOrderIntent = effectiveRoutingIntent === "order_request" || effectiveRoutingIntent === "order_missing_data";
  const explicitName = effectiveRoutingIntent === "provide_name"
    ? (extraerNombreExplícito(mensaje) || ((state.awaitingName && !state.customerName && esNombreDirectoValido(mensaje)) ? capitalizarNombre(mensaje) : null))
    : null;

  logEvent("GPT_INTENT_RESULT", {
    telefono,
    sourceMessageId,
    heuristicIntent,
    resolvedIntent: effectiveRoutingIntent,
    gptIntent: gptIntent.intent,
    confidence: gptIntent.confidence,
    productsMentioned: gptIntent.products_mentioned,
    requestedChanges: gptIntent.requested_changes,
    missingData: gptIntent.missing_data
  });

  const routingIntentFinal = effectiveRoutingIntent;

  appendRecentHistory(state, { role: "user", intent: routingIntentFinal, text: mensaje });

  if (routingIntentFinal === "admin_query" || isKnownAdminCommand(mensaje)) {
    const adminCommand = buildAdminWhatsappResponse(mensaje, telefono);
    const respuesta = adminCommand.handled
      ? await generarRespuestaConversacional({
          telefono,
          sourceMessageId,
          routingIntent: "admin_query",
          fallback: adminCommand.response,
          context: buildValidatedResponseContext({
            orchestratorContext: orchestratorPayload.context,
            gptIntent,
            fallback: adminCommand.response,
            customerName: state.customerName || null,
            userMessage: mensaje,
            adminSummary: { rawResponse: adminCommand.response },
            activeIntent: "admin_query"
          })
        })
      : "Este comando no está disponible para este número.";
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return {
      pedido: null,
      evaluacion: null,
      order: null,
      inboundMessage,
      respuesta,
      delivery,
      firstContact: previousMessageCount === 0,
      activeOrderBefore,
      intent: adminCommand.handled ? "admin_command" : "admin_command_denied"
    };
  }

  logEvent("mensaje_extraido", {
    origen,
    telefono,
    sourceMessageId,
    textLength: String(mensaje || "").length,
    preview: String(mensaje || "").slice(0, 120)
  });

  logEvent("INTENT_DETECTED", {
    telefono,
    sourceMessageId,
    intent: routingIntentFinal,
    contextApplied: contextualizedMessage.used || false,
    contextReason: contextualizedMessage.reason || null,
    explicitName: explicitName || null,
    customerNameBefore: state.customerName || null,
    awaitingName: state.awaitingName || false
  });

  logEvent("CONVERSATION_STATE", {
    telefono,
    intent: routingIntentFinal,
    hasDraftContext,
    hasSuggestionContext,
    hasActiveOrderContext,
    contextReason: contextualizedMessage.reason || null,
    selectedProduct: contextualizedMessage.selectedProduct || null
  });

  logMultiTurnState(state, {
    telefono,
    intent: routingIntentFinal,
    hasDraftContext,
    hasSuggestionContext,
    hasActiveOrderContext,
    contextReason: contextualizedMessage.reason || null,
    selectedProduct: contextualizedMessage.selectedProduct || null
  });

  const aclaracionResuelta = await intentarResolverAclaracionPendiente({
    state,
    mensaje: contextualizedMessage.used && contextualizedMessage.text ? contextualizedMessage.text : mensaje,
    telefono,
    sourceMessageId,
    simulated,
    inboundMessage
  });
  if (aclaracionResuelta) {
    return aclaracionResuelta;
  }

  if (routingIntentFinal === "greeting") {
    state.lastIntent = routingIntentFinal;
    state.awaitingName = !state.customerName;
    actualizarActiveOrderContext(state, { intent: routingIntentFinal });
    const fallback = construirRespuestaCatalogoInicial({ customerName: state.customerName || null, isDistributor: customerProfile.isDistributor });
    const respuesta = fallback;
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return { pedido: null, evaluacion: null, order: null, inboundMessage, respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent: routingIntentFinal };
  }

  if (routingIntentFinal === "identity") {
    state.lastIntent = routingIntentFinal;
    actualizarActiveOrderContext(state, { intent: routingIntentFinal });
    const fallback = construirRespuestaIdentidad();
    const respuesta = await generarRespuestaConversacional({
      telefono,
      sourceMessageId,
      routingIntent: routingIntentFinal,
      fallback,
      context: buildValidatedResponseContext({
        orchestratorContext: orchestratorPayload.context,
        gptIntent,
        fallback,
        customerName: state.customerName || null,
        userMessage: mensaje,
        activeIntent: routingIntentFinal
      })
    });
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return { pedido: null, evaluacion: null, order: null, inboundMessage, respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent: routingIntentFinal };
  }

  if (routingIntentFinal === "closing") {
    state.pendingPedido = null;
    state.lastIntent = routingIntentFinal;
    state.awaitingName = false;
    limpiarAclaracionPendiente(state);
    limpiarSuggestionMemory(state);
    actualizarActiveOrderContext(state, { intent: routingIntentFinal });
    const respuesta = construirRespuestaDespedida({ customerName: state.customerName || null });
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return { pedido: null, evaluacion: null, order: null, inboundMessage, respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent: routingIntentFinal };
  }

  if (routingIntentFinal === "provide_name" && explicitName) {
    state.customerName = explicitName;
    state.customerType = "public";
    state.awaitingName = false;
    state.lastIntent = routingIntentFinal;
    actualizarActiveOrderContext(state, { intent: routingIntentFinal });
    const fallback = construirRespuestaNombreRegistrado({ customerName: explicitName, featuredProducts: buildCatalogFeaturedProducts(customerProfile.customerType), priceLabel: customerProfile.priceLabel, isDistributor: customerProfile.isDistributor });
    const respuesta = fallback;
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return { pedido: null, evaluacion: null, order: null, inboundMessage, respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent: routingIntentFinal };
  }

  if (routingIntentFinal === "human_help") {
    state.lastIntent = routingIntentFinal;
    const fallback = construirRespuestaAyudaHumana();
    const respuesta = await generarRespuestaConversacional({
      telefono,
      sourceMessageId,
      routingIntent: routingIntentFinal,
      fallback,
      context: buildValidatedResponseContext({
        orchestratorContext: orchestratorPayload.context,
        gptIntent,
        fallback,
        customerName: state.customerName || null,
        userMessage: mensaje,
        activeIntent: routingIntentFinal
      })
    });
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return { pedido: null, evaluacion: null, order: null, inboundMessage, respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent: routingIntentFinal };
  }

  if (routingIntentFinal === "complaint_confusion") {
    state.lastIntent = routingIntentFinal;
    const pedidoActual = construirPedidoDesdeEstado(state);
    const fallback = construirRespuestaCorreccion({ pedido: pedidoActual });
    const respuesta = await generarRespuestaConversacional({
      telefono,
      sourceMessageId,
      routingIntent: routingIntentFinal,
      fallback,
      context: buildValidatedResponseContext({
        orchestratorContext: orchestratorPayload.context,
        gptIntent,
        pedido: pedidoActual,
        fallback,
        customerName: state.customerName || null,
        userMessage: mensaje,
        activeIntent: routingIntentFinal
      })
    });
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return { pedido: pedidoActual, evaluacion: null, order: null, inboundMessage, respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent: routingIntentFinal };
  }

  if (routingIntentFinal === "reorder_memory") {
    const lastOrder = buscarUltimoPedidoCliente(telefono);
    if (lastOrder?.items?.length) {
      const pedidoRecordado = construirPedidoDesdeOrder(lastOrder);
      state.pendingPedido = pedidoRecordado;
      actualizarMemoriaConversacional(state, { pedido: pedidoRecordado, evaluacion: evaluarPedido(pedidoRecordado, { ambiguities: [], unmatched: [] }), intent: "order_missing_data" });
      const evaluacionRecordada = evaluarPedido(pedidoRecordado, { ambiguities: [], unmatched: [] });
      const fallback = construirRespuestaPedido(pedidoRecordado, evaluacionRecordada, { availableProducts: buildCatalogShortList(5) });
      const respuesta = await generarRespuestaConversacional({
        telefono,
        sourceMessageId,
        routingIntent: "order_missing_data",
        fallback,
        context: buildValidatedResponseContext({
          orchestratorContext: orchestratorPayload.context,
          gptIntent,
          pedido: pedidoRecordado,
          evaluacion: evaluacionRecordada,
          fallback,
          customerName: state.customerName || null,
          userMessage: mensaje,
          availableProducts: buildCatalogShortList(5),
          catalogUrl: CATALOG_URL,
          activeIntent: "order_missing_data"
        })
      });
      const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
      return { pedido: pedidoRecordado, evaluacion: evaluacionRecordada, order: null, inboundMessage, respuesta: delivery?.respuesta || respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent: routingIntentFinal };
    }

    const fallback = "No veo un pedido reciente listo para repetir. Escríbeme qué quieres y te lo armo 😊";
    const respuesta = await generarRespuestaConversacional({
      telefono,
      sourceMessageId,
      routingIntent: routingIntentFinal,
      fallback,
      context: buildValidatedResponseContext({
        orchestratorContext: orchestratorPayload.context,
        gptIntent,
        fallback,
        customerName: state.customerName || null,
        userMessage: mensaje,
        activeIntent: routingIntentFinal
      })
    });
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return { pedido: null, evaluacion: null, order: null, inboundMessage, respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent: routingIntentFinal };
  }

  if (["payment_method", "address_provided", "remove_item", "modify_quantity"].includes(routingIntentFinal)) {
    let pedidoActual = {
      ...construirPedidoDesdeEstado(state),
      customer_type_applied: customerProfile.customerType,
      price_tier_applied: customerProfile.customerType
    };

    if (routingIntentFinal === "payment_method") {
      pedidoActual = calcularTotalesPedido({
        ...pedidoActual,
        metodo_pago: extraerMetodoPagoDesdeTexto(mensaje) || pedidoActual.metodo_pago || null,
        direccion: extraerDireccionDesdeTexto(mensaje, {
          lastAddress: pedidoActual.direccion || state.lastResolvedOrder?.direccion || null
        }) || pedidoActual.direccion || state.lastResolvedOrder?.direccion || null
      });
    }

    if (routingIntentFinal === "address_provided") {
      pedidoActual = calcularTotalesPedido({
        ...pedidoActual,
        direccion: extraerDireccionDesdeTexto(mensaje, {
          lastAddress: pedidoActual.direccion || state.lastResolvedOrder?.direccion || null
        }) || pedidoActual.direccion || state.lastResolvedOrder?.direccion || null,
        metodo_pago: extraerMetodoPagoDesdeTexto(mensaje) || pedidoActual.metodo_pago || null
      });
    }

    if (routingIntentFinal === "remove_item") {
      pedidoActual = quitarProductoDePedido(pedidoActual, mensaje, state).pedido;
    }

    if (routingIntentFinal === "modify_quantity") {
      pedidoActual = actualizarCantidadPedido(pedidoActual, mensaje, state).pedido;
    }

    state.pendingPedido = pedidoActual;
    const evaluacionContextual = evaluarPedido(pedidoActual, { ambiguities: [], unmatched: [] });
    actualizarMemoriaConversacional(state, { pedido: pedidoActual, evaluacion: evaluacionContextual, intent: "order_missing_data" });

    if (evaluacionContextual.esValido && ["payment_method", "address_provided"].includes(routingIntentFinal)) {
      const persisted = await persistirPedidoFinal({
        pedido: pedidoActual,
        telefono,
        mensajeOriginal: mensaje,
        sourceMessageId
      });
      state.pendingPedido = null;
      actualizarMemoriaConversacional(state, { pedido: pedidoActual, evaluacion: evaluacionContextual, intent: "order_request" });
      const fallback = construirRespuestaPedido(pedidoActual, evaluacionContextual, { availableProducts: buildCatalogShortList(5) });
      const respuesta = await generarRespuestaConversacional({
        telefono,
        sourceMessageId,
        routingIntent: "order_request",
        fallback,
        context: buildValidatedResponseContext({
          orchestratorContext: orchestratorPayload.context,
          gptIntent,
          pedido: pedidoActual,
          evaluacion: evaluacionContextual,
          fallback,
          customerName: state.customerName || null,
          userMessage: mensaje,
          availableProducts: buildCatalogShortList(5),
          catalogUrl: CATALOG_URL,
          activeIntent: "order_request"
        })
      });
      const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: persisted.order?.id || null });
      return { pedido: pedidoActual, evaluacion: evaluacionContextual, order: persisted.order, inboundMessage, respuesta: delivery?.respuesta || respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent: "order_request" };
    }

    const fallback = construirRespuestaPedido(pedidoActual, evaluacionContextual, { availableProducts: buildCatalogShortList(5) });
      const respuesta = await generarRespuestaConversacional({
        telefono,
        sourceMessageId,
        routingIntent: routingIntentFinal,
      fallback,
      context: buildValidatedResponseContext({
        orchestratorContext: orchestratorPayload.context,
        gptIntent,
        pedido: pedidoActual,
        evaluacion: evaluacionContextual,
        fallback,
        customerName: state.customerName || null,
        userMessage: mensaje,
        availableProducts: buildCatalogShortList(5),
        catalogUrl: CATALOG_URL,
          activeIntent: routingIntentFinal
        })
      });
      const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return { pedido: pedidoActual, evaluacion: evaluacionContextual, order: null, inboundMessage, respuesta: delivery?.respuesta || respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent: routingIntentFinal };
  }

  if (isExplicitOrderGuideRequest(contextualizedMessage.text || mensaje)) {
    state.lastIntent = "general_chat";
    state.awaitingName = false;
    const guideMode = state.hasShownOrderGuide ? "short" : "full";
    const respuesta = construirRespuestaGuiaPedido({ customerName: state.customerName || null, short: guideMode !== "full" });
    rememberOrderGuideShown(state, guideMode);
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return { pedido: null, evaluacion: null, order: null, inboundMessage, respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent: "general_chat" };
  }

  if (routingIntentFinal === "catalog_request") {
    state.lastIntent = routingIntentFinal;
    state.awaitingName = false;
    const pricingContext = buildCatalogPricingContext(customerProfile.customerType);
    const featuredCatalog = buildCatalogFeaturedProducts(customerProfile.customerType);
    const normalizedCatalogQuery = normalizarTextoAnalisis(contextualizedMessage.text || mensaje);
    const explicitCatalogAsk = /\b(catalogo|catalogo|catalog|productos|portafolio)\b/i.test(normalizedCatalogQuery);
    const requestedFamily = getRequestedCatalogFamily(contextualizedMessage.text || mensaje);
    const targetedCatalogResolution = explicitCatalogAsk ? null : resolveProductFromCatalog(contextualizedMessage.text || mensaje);
    const guideMode = getOrderGuideMode({ texto: mensaje, routingIntent: routingIntentFinal, state });

    if (requestedFamily) {
      const familyCatalog = buildFamilyCatalogResponse({
        familyName: requestedFamily,
        customerName: state.customerName || null,
        customerType: customerProfile.customerType
      });
      guardarSuggestionMemory(state, familyCatalog.products.map((product) => ({ nombre: product?.nombre || product })), { type: "catalog_family", reason: requestedFamily });
      if (familyCatalog.products[0]) {
        state.lastProductReference = {
          id: familyCatalog.products[0].id,
          nombre: familyCatalog.products[0].nombre,
          nombreCanonico: familyCatalog.products[0].nombre_canonico,
          familia: requestedFamily,
          variant: isLargeVariant(familyCatalog.products[0]) ? "large" : (isSmallVariant(familyCatalog.products[0]) ? "small" : null)
        };
      }
      actualizarActiveOrderContext(state, { intent: routingIntentFinal });
      const respuesta = familyCatalog.response;
      const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
      return { pedido: null, evaluacion: null, order: null, inboundMessage, respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent: routingIntentFinal };
    }

    if (targetedCatalogResolution?.status === "ambiguous" && targetedCatalogResolution.candidates?.length) {
      guardarSuggestionMemory(state, targetedCatalogResolution.candidates, { type: "ambiguity_suggestion", reason: contextualizedMessage.text || mensaje });
      actualizarActiveOrderContext(state, { intent: "ambiguous_product" });
      const respuesta = construirRespuestaPedido({
        cliente: state.customerName || null,
        productos: [],
        customer_type_applied: customerProfile.customerType,
        price_tier_applied: customerProfile.customerType
      }, {
        esValido: false,
        faltantes: ["productos"],
        productosInvalidos: [],
        priceValidation: "ok",
        addressStatus: "incomplete",
        catalogStatus: "ambiguous",
        ambiguousProducts: [{ input: contextualizedMessage.text || mensaje, options: targetedCatalogResolution.candidates, soft: false }],
        unmatchedProducts: []
      }, {
        availableProducts: buildCatalogShortList(5),
        guideMode: "short"
      });
      const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
      return { pedido: null, evaluacion: null, order: null, inboundMessage, respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent: "ambiguous_product" };
    }

    guardarSuggestionMemory(state, featuredCatalog.map((product) => ({ nombre: product?.catalogName || product?.label || product })), { type: "catalog_featured", reason: "catalog_request" });
    actualizarActiveOrderContext(state, { intent: routingIntentFinal });
    const respuesta = construirRespuestaCatalogoInformativo({ customerName: state.customerName || null, featuredProducts: featuredCatalog, priceLabel: pricingContext.priceLabel, isDistributor: pricingContext.isDistributor, guideMode });
    rememberOrderGuideShown(state, guideMode);
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return { pedido: null, evaluacion: null, order: null, inboundMessage, respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent: routingIntentFinal };
  }

  if (routingIntentFinal === "price_request") {
    state.lastIntent = routingIntentFinal;
    state.awaitingName = false;
    const pricingContext = buildCatalogPricingContext(customerProfile.customerType);
    const featuredProducts = buildPriceRequestProducts(contextualizedMessage.text || mensaje, 4, customerProfile.customerType);
    const fallbackProducts = featuredProducts.length ? featuredProducts : buildCatalogFeaturedProducts(customerProfile.customerType);
    guardarSuggestionMemory(state, fallbackProducts.map((product) => ({ nombre: product.label || product })), { type: "price_suggestion", reason: "price_request" });
    actualizarActiveOrderContext(state, { intent: routingIntentFinal });
    const queryLabel = limpiarTextoProductoSolicitado(contextualizedMessage.text || mensaje) || "ese producto";
    const fallback = construirRespuestaPreciosInformativo({
      customerName: state.customerName || null,
      featuredProducts: fallbackProducts,
      queryLabel,
      priceLabel: pricingContext.priceLabel,
      isDistributor: pricingContext.isDistributor
    });
    const respuesta = await generarRespuestaConversacional({
      telefono,
      sourceMessageId,
      routingIntent: routingIntentFinal,
      fallback,
      context: buildValidatedResponseContext({
        orchestratorContext: orchestratorPayload.context,
        gptIntent,
        fallback,
        customerName: state.customerName || null,
        userMessage: mensaje,
        availableProducts: fallbackProducts,
        catalogUrl: CATALOG_URL,
        activeIntent: routingIntentFinal
      })
    });
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return { pedido: null, evaluacion: null, order: null, inboundMessage, respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent: routingIntentFinal };
  }

  if (routingIntentFinal === "general_chat" && !(contextualizedMessage.used || ["add_item", "order_request"].includes(gptIntent.intent))) {
    state.lastIntent = routingIntentFinal;
    state.awaitingName = false;
    const explicitGuideMode = getOrderGuideMode({ texto: mensaje, routingIntent: routingIntentFinal, state });
    if (explicitGuideMode !== "none") {
      const respuesta = construirRespuestaGuiaPedido({ customerName: state.customerName || null, short: explicitGuideMode !== "full" });
      rememberOrderGuideShown(state, explicitGuideMode);
      const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
      return { pedido: null, evaluacion: null, order: null, inboundMessage, respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent: routingIntentFinal };
    }

    const activeContext = obtenerActiveOrderContext(state);
    const fallback = activeContext?.products?.length
      ? construirRespuestaPedido(state.pendingPedido || {
          cliente: state.customerName || null,
          productos: activeContext.products,
          direccion: activeContext.direccion || null,
          metodo_pago: activeContext.metodo_pago || null,
          total: null
        }, {
          esValido: false,
          faltantes: [!activeContext.direccion ? "direccion" : null, !activeContext.metodo_pago ? "metodo_pago" : null].filter(Boolean),
          productosInvalidos: [],
          priceValidation: "ok",
          catalogStatus: "ok",
          ambiguousProducts: [],
          unmatchedProducts: []
        }, { availableProducts: buildCatalogShortList(5) })
      : construirRespuestaConfirmacion({ hasDraftContext, isDistributor: customerProfile.isDistributor });
    const respuesta = activeContext?.products?.length
      ? await generarRespuestaConversacional({
          telefono,
          sourceMessageId,
          routingIntent: routingIntentFinal,
          fallback,
          context: buildValidatedResponseContext({
            orchestratorContext: orchestratorPayload.context,
            gptIntent,
            pedido: state.pendingPedido,
            fallback,
            customerName: state.customerName || null,
            userMessage: mensaje,
            availableProducts: buildCatalogShortList(5),
            catalogUrl: CATALOG_URL,
            activeIntent: routingIntentFinal
          })
        })
      : fallback;
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return { pedido: null, evaluacion: null, order: null, inboundMessage, respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent: routingIntentFinal };
  }

  const resultadoActual = await procesarPedidoDesdeTexto(contextualizedMessage.text || mensaje, {
    telefono,
    mensajeOriginal: mensaje,
    sourceMessageId,
    guardar: false,
    customerType: customerProfile.customerType
  });

  const basePedido = state.pendingPedido
    || ((contextualizedMessage.appendProducts || gptIntent.intent === "add_item" || /\bdonde siempre\b/i.test(normalizarTextoAnalisis(mensaje)))
      ? construirPedidoDesdeOrder(activeOrderBefore || state.lastResolvedOrder)
      : null)
    || { cliente: state.customerName || null, customer_type_applied: customerProfile.customerType, price_tier_applied: customerProfile.customerType };
  const pedidoCombinado = combinarPedidoParcialConOpciones(basePedido, resultadoActual.pedido || {}, {
    appendProducts: Boolean(contextualizedMessage.appendProducts || gptIntent.intent === "add_item")
  });
  if (imageAnalysis?.address && !pedidoCombinado.direccion) {
    pedidoCombinado.direccion = imageAnalysis.address;
  }
  if (imageAnalysis?.payment_method && !pedidoCombinado.metodo_pago) {
    pedidoCombinado.metodo_pago = extraerMetodoPagoDesdeTexto(imageAnalysis.payment_method) || imageAnalysis.payment_method;
  }
  pedidoCombinado.customer_type_applied = customerProfile.customerType;
  pedidoCombinado.price_tier_applied = customerProfile.customerType;
  if (!pedidoCombinado.cliente && state.customerName) {
    pedidoCombinado.cliente = state.customerName;
  }
  if (!state.customerName && pedidoCombinado.cliente) {
    state.customerName = pedidoCombinado.cliente;
  }

  const evaluacionCombinada = evaluarPedido(pedidoCombinado, {
    ambiguities: resultadoActual.evaluacion?.catalogStatus === "ambiguous" ? (resultadoActual.evaluacion?.ambiguousProducts || []) : [],
    unmatched: resultadoActual.evaluacion?.catalogStatus === "not_found" ? (resultadoActual.evaluacion?.unmatchedProducts || ["catalogo"]) : []
  });

  if (imageAnalysis) {
    const requiresConfirmation = Boolean(imageAnalysis.uncertain_lines?.length);
    if (requiresConfirmation) {
      evaluacionCombinada.esValido = false;
      evaluacionCombinada.catalogStatus = evaluacionCombinada.catalogStatus === "ok" ? "partial" : evaluacionCombinada.catalogStatus;
      evaluacionCombinada.faltantes = [...new Set([...(evaluacionCombinada.faltantes || []), "confirmacion_catalogo"] )];
      logEvent("IMAGE_ORDER_UNCERTAIN", {
        telefono,
        sourceMessageId,
        uncertainLines: imageAnalysis.uncertain_lines.map((line) => line?.text).filter(Boolean).slice(0, 6)
      }, "warn");
    }

    logEvent("IMAGE_ORDER_VALIDATED", {
      telefono,
      sourceMessageId,
      confirmedProducts: Array.isArray(pedidoCombinado.productos) ? pedidoCombinado.productos.map((item) => item?.producto).filter(Boolean) : [],
      uncertainLines: imageAnalysis.uncertain_lines?.length || 0,
      esValido: evaluacionCombinada.esValido,
      faltantes: evaluacionCombinada.faltantes || []
    });
  }

  const imageOrderConfidence = imageAnalysis ? buildImageOrderConfidence(imageAnalysis) : 0;
  const shouldRequireImageConfirmation = Boolean(
    imageAnalysis
    && imageRequiresConfirmation
    && pedidoCombinado?.productos?.length
    && pedidoCombinado?.direccion
    && pedidoCombinado?.metodo_pago
    && (!IMAGE_ORDER_AUTO_PERSIST_ON_HIGH_CONFIDENCE
      || !evaluacionCombinada.esValido
      || Boolean(imageAnalysis?.uncertain_lines?.length)
      || imageOrderConfidence < IMAGE_ORDER_AUTO_PERSIST_MIN_CONFIDENCE)
  );

  if (shouldRequireImageConfirmation) {
    evaluacionCombinada.esValido = false;
    evaluacionCombinada.faltantes = [...new Set([...(evaluacionCombinada.faltantes || []), "confirmacion_imagen"] )];
    logEvent("IMAGE_ORDER_VALIDATED", {
      telefono,
      sourceMessageId,
      confirmedProducts: Array.isArray(pedidoCombinado.productos) ? pedidoCombinado.productos.map((item) => item?.producto).filter(Boolean) : [],
      uncertainLines: imageAnalysis?.uncertain_lines?.length || 0,
      esValido: evaluacionCombinada.esValido,
      faltantes: evaluacionCombinada.faltantes || [],
      reason: "awaiting_image_confirmation"
    });
  }

  let resultado = {
    pedido: pedidoCombinado,
    evaluacion: evaluacionCombinada,
    order: null,
    sheets: { saved: false, skipped: true, reason: "order_not_persisted" },
    intent: evaluacionCombinada.catalogStatus === "ambiguous" ? "ambiguous_product" : (evaluacionCombinada.esValido ? "order_request" : "order_missing_data")
  };

  actualizarMemoriaConversacional(state, { pedido: pedidoCombinado, evaluacion: evaluacionCombinada, intent: resultado.intent });

  if (evaluacionCombinada.esValido) {
    try {
      const persisted = await persistirPedidoFinal({
        pedido: pedidoCombinado,
        telefono,
        mensajeOriginal: mensaje,
        sourceMessageId
      });
      resultado.order = persisted.order;
      resultado.sheets = persisted.sheets;
      state.pendingPedido = null;
      limpiarAclaracionPendiente(state);
      actualizarMemoriaConversacional(state, { pedido: pedidoCombinado, evaluacion: evaluacionCombinada, intent: "order_request" });
    } catch (error) {
      throw error;
    }
  } else {
    state.pendingPedido = pedidoCombinado;
    if (evaluacionCombinada.catalogStatus === "ambiguous" && evaluacionCombinada.ambiguousProducts?.length) {
      state.pendingClarification = construirEstadoAclaracionProducto({
        ambiguity: evaluacionCombinada.ambiguousProducts[0],
        pedidoParcial: pedidoCombinado
      });
      guardarSuggestionMemory(state, evaluacionCombinada.ambiguousProducts[0]?.options || [], {
        type: evaluacionCombinada.ambiguousProducts[0]?.soft ? "soft_suggestion" : "ambiguity_suggestion",
        reason: evaluacionCombinada.ambiguousProducts[0]?.input || null
      });
    } else {
      limpiarAclaracionPendiente(state);
    }

    actualizarMemoriaConversacional(state, { pedido: pedidoCombinado, evaluacion: evaluacionCombinada, intent: resultado.intent });
  }

  logEvent("resultado_procesamiento", {
    origen,
    cliente: resultado.pedido.cliente,
    productos: Array.isArray(resultado.pedido.productos) ? resultado.pedido.productos.length : 0,
    valido: resultado.evaluacion.esValido,
    faltantes: resultado.evaluacion.faltantes
  });

  if (!resultado.order) {
    logEvent("pedido_no_guardado", {
      origen,
      motivo: resultado.evaluacion?.modelError
        ? "model_error"
        : "pedido_incompleto_o_invalido",
      faltantes: resultado.evaluacion?.faltantes || [],
      catalogStatus: resultado.evaluacion?.catalogStatus || null
    });
  }

  if (resultado.order?.id && inboundMessage?.id) {
    updateMessageOrder(inboundMessage.id, resultado.order.id);
    inboundMessage.orderId = resultado.order.id;
  }

  const orderGuideMode = imageAnalysis
    ? "none"
    : getOrderGuideMode({ texto: mensaje, routingIntent: resultado.intent, state, evaluacion: resultado.evaluacion });
  const fallbackRespuesta = imageAnalysis
    ? buildImageOrderFallback({ pedido: resultado.pedido, evaluacion: resultado.evaluacion, imageAnalysis })
    : construirRespuestaPedido(resultado.pedido, resultado.evaluacion, {
        availableProducts: buildCatalogShortList(5),
        guideMode: orderGuideMode
      });
  rememberOrderGuideShown(state, orderGuideMode);
  const shouldBypassAiForImage = Boolean(
    imageAnalysis
    && (imageRequiresConfirmation
      || imageAnalysis?.uncertain_lines?.length
      || resultado?.evaluacion?.faltantes?.includes("confirmacion_imagen")
      || resultado?.evaluacion?.faltantes?.includes("confirmacion_catalogo"))
  );
  const respuesta = orderGuideMode !== "none" || shouldBypassAiForImage
    ? fallbackRespuesta
    : await generarRespuestaConversacional({
        telefono,
        sourceMessageId,
        routingIntent: resultado.intent,
        fallback: fallbackRespuesta,
        context: buildValidatedResponseContext({
          orchestratorContext: orchestratorPayload.context,
          gptIntent,
          pedido: resultado.pedido,
          evaluacion: resultado.evaluacion,
          fallback: fallbackRespuesta,
          customerName: state.customerName || resultado.pedido?.cliente || null,
          userMessage: mensaje,
          availableProducts: buildCatalogShortList(5),
          catalogUrl: CATALOG_URL,
          activeIntent: resultado.intent,
          imageAnalysis
        })
      });
  const delivery = await responderAlCliente({
    telefono,
    respuesta,
    simulated,
    orderId: resultado.order?.id || null
  });

  return {
    ...resultado,
    inboundMessage,
    respuesta: delivery?.respuesta || respuesta,
    delivery
  };
}

app.get(PANEL_LOGIN_PATH, (req, res) => {
  if (!PANEL_AUTH_ENABLED) {
    return res.redirect("/");
  }

  const session = verifyPanelSessionToken(parseCookies(req)[PANEL_AUTH_COOKIE]);
  if (session) {
    return res.redirect("/");
  }

  return res.sendFile(path.join(publicDir, "login.html"));
});

app.get("/auth/session", (req, res) => {
  const session = verifyPanelSessionToken(parseCookies(req)[PANEL_AUTH_COOKIE]);
  return res.json({
    ok: true,
    authEnabled: PANEL_AUTH_ENABLED,
    authenticated: Boolean(session) || !PANEL_AUTH_ENABLED,
    username: session?.username || (PANEL_AUTH_ENABLED ? null : PANEL_AUTH_USERNAME),
    expiresAt: session?.expiresAt || null,
    ttlMs: PANEL_AUTH_TTL_MS
  });
});

app.post("/auth/login", (req, res) => {
  if (!PANEL_AUTH_ENABLED) {
    return res.json({ ok: true, authEnabled: false, authenticated: true, ttlMs: PANEL_AUTH_TTL_MS });
  }

  const ip = getRequestIp(req);
  const rateLimit = getLoginRateLimitStatus(ip);
  if (rateLimit.limited) {
    const retryAfterSeconds = Math.ceil(rateLimit.retryAfterMs / 1000);
    res.setHeader("Retry-After", String(retryAfterSeconds));
    return res.status(429).json({
      ok: false,
      error: "Demasiados intentos. Intenta más tarde.",
      retryAfterSeconds
    });
  }

  const username = limpiarTexto(req.body?.username);
  const password = String(req.body?.password || "");
  if (username !== PANEL_AUTH_USERNAME || password !== PANEL_AUTH_PASSWORD) {
    const attempts = registerFailedLoginAttempt(ip);
    const remaining = Math.max(PANEL_LOGIN_RATE_LIMIT_MAX_ATTEMPTS - attempts.length, 0);
    return res.status(401).json({ ok: false, error: "Credenciales inválidas", remainingAttempts: remaining });
  }

  clearFailedLoginAttempts(ip);
  setPanelSessionCookie(res, username);
  return res.json({ ok: true, authenticated: true, username, ttlMs: PANEL_AUTH_TTL_MS });
});

app.post("/auth/logout", (_req, res) => {
  clearPanelSessionCookie(res);
  return res.json({ ok: true });
});

app.get("/", requirePanelAuth, (_req, res) => {
  return res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "tellolac-ai",
    appVersion: APP_VERSION,
    storage: "sqlite",
    dbPath: databasePath,
    catalogProducts: countCatalogProducts(),
    whatsappEnabled: WHATSAPP_ENABLED,
    adminNotifyEnabled: ADMIN_NOTIFY_ENABLED,
    adminWhatsappCount: getAdminWhatsappNumbers().length,
    panelAuthEnabled: PANEL_AUTH_ENABLED,
    sourceOfTruth: "sqlite",
    sheetsRole: SHEETS_BACKUP_ENABLED ? "reporting_backup" : "disabled",
    aiProvider: OPENAI_PROVIDER,
    aiModel: process.env.OPENAI_MODEL || OPENAI_MODEL,
    aiBaseUrl: OPENAI_BASE_URL
  });
});

app.get("/orders", requirePanelAuth, (req, res) => {
  try {
    const status = normalizarEstadoPanel(req.query.status);
    const orders = listOrders({ status });
    const summary = buildDashboardSummary(orders);

    return res.json({
      ok: true,
      total: orders.length,
      orders,
      summary
    });
  } catch (error) {
    logEvent("orders_read_error", { error: error.message }, "error");
    return res.status(500).json({
      ok: false,
      error: "No se pudieron leer los pedidos",
      detalle: error.message
    });
  }
});

app.get("/history/closures", requirePanelAuth, (_req, res) => {
  try {
    const closures = listDailyClosures().map((closure) => ({
      ...closure,
      downloadUrl: closure.pdfPath ? `/history/closures/${encodeURIComponent(closure.id)}/pdf` : null
    }));

    return res.json({
      ok: true,
      total: closures.length,
      closures
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "No se pudo cargar el historial", detalle: error.message });
  }
});

app.get("/history/closures/:id/pdf", requirePanelAuth, (req, res) => {
  try {
    const closure = getDailyClosureById(req.params.id);
    if (!closure) {
      return res.status(404).json({ ok: false, error: "Cierre no encontrado" });
    }

    if (!closure.pdfPath || !fs.existsSync(closure.pdfPath)) {
      return res.status(404).json({ ok: false, error: "PDF no disponible" });
    }

    return res.download(closure.pdfPath, path.basename(closure.pdfPath));
  } catch (error) {
    return res.status(500).json({ ok: false, error: "No se pudo descargar el PDF", detalle: error.message });
  }
});

app.post("/admin/close-day", requirePanelAuth, async (_req, res) => {
  try {
    const activeOrders = listOrders();
    const summary = buildOperationalSummary(activeOrders);
    const closureTitle = `Cierre ${summary.dateKey}`;
    const closureId = `closure_${Date.now()}`;

    const pdfPath = await generateDailyClosurePdf({
      closureId,
      summary: {
        ...summary,
        title: closureTitle
      }
    });

    const closure = createDailyClosure({
      id: closureId,
      dateKey: summary.dateKey,
      title: closureTitle,
      summary: {
        ...summary,
        title: closureTitle
      },
      pdfPath,
      orderIds: summary.orders.map((order) => order.id)
    });

    await notifyAdminWhatsAppNumbers({
      message: buildAdminCloseDayMessage(summary, closure),
      context: "close_day",
      metadata: {
        closureId,
        dateKey: summary.dateKey
      }
    });

    return res.json({
      ok: true,
      closure: {
        ...closure,
        downloadUrl: closure.pdfPath ? `/history/closures/${encodeURIComponent(closure.id)}/pdf` : null
      },
      archivedOrders: summary.orders.length,
      remainingOrders: listOrders().length
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "No se pudo finalizar el día", detalle: error.message });
  }
});

app.patch("/orders/:id/status", requirePanelAuth, async (req, res) => {
  try {
    const status = normalizarEstadoPanel(req.body?.status);

    if (!status) {
      return res.status(400).json({
        ok: false,
        error: "Estado no válido",
        estadosPermitidos: Array.from(ESTADOS_VALIDOS)
      });
    }

    const order = updateOrderStatus(req.params.id, status);
    logEvent("estado_actualizado_db", { id: req.params.id, estado: status });
    await sincronizarEstadoEnSheets(req.params.id, status);
    return res.json({ ok: true, order });
  } catch (error) {
    if (error.code === "ORDER_NOT_FOUND") {
      return res.status(404).json({ ok: false, error: "Pedido no encontrado" });
    }

    logEvent("order_status_update_error", { id: req.params.id, error: error.message }, "error");
    return res.status(500).json({
      ok: false,
      error: "No se pudo actualizar el estado",
      detalle: error.message
    });
  }
});

app.post("/admin/rebuild-sheets", requirePanelAuth, async (_req, res) => {
  try {
    const orders = listOrders();
    const result = await reconstruirSheetsDesdeOrders(orders);
    logEvent("sheets_rebuild_from_db", { rowsWritten: result.rowsWritten, orders: orders.length });
    return res.json({ ok: true, rows_written: result.rowsWritten });
  } catch (error) {
    logEvent("sheets_rebuild_error", { error: error.response?.data || error.message }, "error");
    return res.status(500).json({ ok: false, error: "No se pudo reconstruir Sheets", detalle: error.message });
  }
});

app.post("/admin/catalog/sync", requirePanelAuth, async (_req, res) => {
  try {
    const result = await sincronizarCatalogoDesdeTreinta();
    logEvent("catalogo_sincronizado_manual", {
      total: result.total,
      active: result.active,
      inactive: result.inactive,
      syncedAt: result.syncedAt
    });

    return res.json({
      ok: true,
      total: result.total,
      active: result.active,
      inactive: result.inactive,
      syncedAt: result.syncedAt
    });
  } catch (error) {
    logEvent("catalogo_sync_error", { error: error.response?.data || error.message }, "error");
    return res.status(500).json({ ok: false, error: "No se pudo sincronizar el catálogo", detalle: error.message });
  }
});

app.get("/admin/customers", requirePanelAuth, (req, res) => {
  try {
    const query = limpiarTexto(req.query.q || req.query.query || "");
    const customers = listCustomers({ query });
    return res.json({ ok: true, total: customers.length, customers });
  } catch (error) {
    logEvent("customers_list_error", { error: error.message }, "error");
    return res.status(500).json({ ok: false, error: "No se pudieron cargar los clientes", detalle: error.message });
  }
});

app.post("/admin/customers", requirePanelAuth, (req, res) => {
  try {
    const customer = createCustomer(req.body || {});
    return res.status(201).json({ ok: true, customer });
  } catch (error) {
    logEvent("customer_create_error", { error: error.message }, "warn");
    return handleCustomerApiError(res, error, { fallbackMessage: "No se pudo crear el cliente" });
  }
});

app.patch("/admin/customers/:id", requirePanelAuth, (req, res) => {
  try {
    const customer = updateCustomer(req.params.id, req.body || {});
    return res.json({ ok: true, customer });
  } catch (error) {
    logEvent("customer_update_error", { id: req.params.id, error: error.message }, "warn");
    return handleCustomerApiError(res, error, { fallbackMessage: "No se pudo actualizar el cliente" });
  }
});

app.patch("/admin/customers/:id/status", requirePanelAuth, (req, res) => {
  try {
    if (typeof req.body?.isActive !== "boolean") {
      return res.status(400).json({ ok: false, error: "isActive debe ser booleano" });
    }

    const customer = setCustomerStatus(req.params.id, req.body.isActive);
    return res.json({ ok: true, customer });
  } catch (error) {
    logEvent("customer_status_error", { id: req.params.id, error: error.message }, "warn");
    return handleCustomerApiError(res, error, { fallbackMessage: "No se pudo actualizar el estado del cliente" });
  }
});

app.delete("/admin/customers/:id", requirePanelAuth, (req, res) => {
  try {
    const customer = deleteCustomer(req.params.id);
    return res.json({ ok: true, customer });
  } catch (error) {
    logEvent("customer_delete_error", { id: req.params.id, error: error.message }, "warn");
    return handleCustomerApiError(res, error, { fallbackMessage: "No se pudo eliminar el cliente" });
  }
});

app.get("/conversations", requirePanelAuth, (_req, res) => {
  try {
    const limit = parseNonNegativeInteger(_req.query.limit, {
      defaultValue: CONVERSATIONS_DEFAULT_LIMIT,
      max: CONVERSATIONS_MAX_LIMIT
    });
    const offset = parseNonNegativeInteger(_req.query.offset, { defaultValue: 0 });

    if (limit === null) {
      return sendError(res, 400, "limit debe ser un entero >= 0");
    }

    if (offset === null) {
      return sendError(res, 400, "offset debe ser un entero >= 0");
    }

    const q = limpiarTexto(_req.query.q);
    const result = listConversations({ limit, offset, query: q });

    return res.json({
      ok: true,
      total: result.total,
      limit,
      offset,
      q,
      deprecated: {
        orderId: "Alias de lastMessageOrderId; usar lastMessageOrderId en nuevas integraciones"
      },
      conversations: result.conversations
    });
  } catch (error) {
    logEvent("conversations_read_error", { error: error.message }, "error");
    return sendError(res, 500, "No se pudieron leer las conversaciones");
  }
});

function responderMensajesConversacion(req, res) {
  try {
    const phone = limpiarTexto(req.params.phone);

    if (!phone) {
      return sendError(res, 400, "phone es obligatorio");
    }

    if (!conversationExists(phone)) {
      return sendError(res, 404, "Conversación no encontrada");
    }

    const messages = listMessagesByPhone(phone);

    return res.json({
      ok: true,
      phone,
      total: messages.length,
      messages
    });
  } catch (error) {
    logEvent("conversation_messages_read_error", { phone, error: error.message }, "error");
    return sendError(res, 500, "No se pudieron leer los mensajes");
  }
}

app.get("/conversations/:phone", requirePanelAuth, responderMensajesConversacion);
app.get("/conversations/:phone/messages", requirePanelAuth, responderMensajesConversacion);

app.post("/conversations/:phone/send", requirePanelAuth, async (req, res) => {
  try {
    const phone = limpiarTexto(req.params.phone);
    const messageText = limpiarTexto(req.body?.message || req.body?.mensaje);

    if (!phone) {
      return sendError(res, 400, "phone es obligatorio");
    }

    if (!conversationExists(phone)) {
      return sendError(res, 404, "Conversación no encontrada");
    }

    if (!messageText) {
      return sendError(res, 400, "message no puede estar vacío");
    }

    if (messageText.length > MANUAL_MESSAGE_MAX_LENGTH) {
      return sendError(res, 400, `message supera el máximo de ${MANUAL_MESSAGE_MAX_LENGTH} caracteres`);
    }

    const normalizedOrderId = limpiarTexto(req.body?.orderId);

    const delivery = await responderAlCliente({
      telefono: phone,
      respuesta: messageText,
      simulated: false,
      orderId: normalizedOrderId
    });
    const savedMessage = delivery?.message || null;

    return res.json({
      ok: true,
      messageId: savedMessage?.id || null,
      delivery,
      message: savedMessage
    });
  } catch (error) {
    logEvent("manual_message_send_error", { error: error.response?.data || error.message }, "error");
    return sendError(res, 500, "No se pudo enviar el mensaje");
  }
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = String(req.query["hub.verify_token"] || "").trim();
  const challenge = req.query["hub.challenge"];
  const verifyToken = String(process.env.WHATSAPP_VERIFY_TOKEN || "").trim();

  if (mode === "subscribe" && token === verifyToken) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

async function extraerContenidoMensajeWhatsApp(mensaje) {
  if (mensaje?.text?.body) {
    return {
      messageType: "text",
      text: String(mensaje.text.body || "").trim(),
      transcription: null,
      mediaId: null,
      mimeType: null,
      mediaBuffer: null,
      filename: null
    };
  }

  if (mensaje?.type === "audio" && mensaje?.audio?.id) {
    const media = await obtenerMediaWhatsApp(mensaje.audio.id);
    const transcription = await transcribirAudio({
      buffer: media.buffer,
      mimeType: media.mimeType,
      filename: media.filename,
      language: "es"
    });

    return {
      messageType: "audio",
      text: transcription,
      transcription,
      mediaId: media.mediaId,
      mimeType: media.mimeType,
      mediaBuffer: media.buffer,
      filename: media.filename
    };
  }

  if (mensaje?.type === "image" && mensaje?.image?.id) {
    const media = await obtenerMediaWhatsApp(mensaje.image.id);
    logEvent("IMAGE_MEDIA_DOWNLOADED", {
      sourceMessageId: mensaje?.id || null,
      mediaId: media.mediaId,
      bytes: media.buffer?.length || 0,
      mimeType: media.mimeType || null,
      simulated: false
    });
    return {
      messageType: "image",
      text: String(mensaje.image.caption || "").trim() || "Imagen recibida",
      transcription: null,
      mediaId: media.mediaId,
      mimeType: media.mimeType,
      mediaBuffer: media.buffer,
      filename: media.filename
    };
  }

  return {
    messageType: mensaje?.type || null,
    text: null,
    transcription: null,
    mediaId: mensaje?.audio?.id || mensaje?.image?.id || null,
    mimeType: null,
    mediaBuffer: null,
    filename: null
  };
}

app.post("/webhook", async (req, res) => {
  try {
    logRuntimeConfigSnapshot("webhook");

    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const mensaje = value?.messages?.[0];

    logEvent("webhook_received", {
      appVersion: APP_VERSION,
      sourceMessageId: mensaje?.id || null,
      messageType: mensaje?.type || null,
      hasTextBody: Boolean(mensaje?.text?.body)
    });

    logEvent("webhook_payload_inspected", {
      hasEntry: Boolean(entry),
      hasChange: Boolean(change),
      hasValue: Boolean(value),
      messageType: mensaje?.type || null,
      sourceMessageId: mensaje?.id || null,
      hasTextBody: Boolean(mensaje?.text?.body),
      extractedTextPath: mensaje?.type === "audio"
        ? "req.body.entry[0].changes[0].value.messages[0].audio.id -> media download -> transcription"
        : mensaje?.type === "image"
          ? "req.body.entry[0].changes[0].value.messages[0].image.id -> media download -> vision/ocr"
          : "req.body.entry[0].changes[0].value.messages[0].text.body"
    });

    const numeroCliente = mensaje.from || value?.contacts?.[0]?.wa_id;

    if (!numeroCliente) {
      logEvent("webhook_missing_phone", { sourceMessageId: mensaje?.id || null }, "warn");
      return res.sendStatus(200);
    }

    let extracted;
    try {
      extracted = await extraerContenidoMensajeWhatsApp(mensaje);
    } catch (error) {
      logEvent("webhook_media_processing_error", {
        sourceMessageId: mensaje?.id || null,
        messageType: mensaje?.type || null,
        mediaId: mensaje?.audio?.id || mensaje?.image?.id || null,
        error: error.response?.data || error.message
      }, "error");

      if (mensaje?.type === "audio") {
        await responderAlCliente({
          telefono: numeroCliente,
          respuesta: "No pude procesar tu audio. ¿Me lo envías en texto, por favor?",
          simulated: false,
          orderId: null
        });
        return res.sendStatus(200);
      }

      throw error;
    }

    const textoCliente = limpiarTexto(extracted.text);

    if (!textoCliente) {
      logEvent("webhook_early_return", {
        reason: extracted.messageType === "audio" ? "empty_audio_transcription" : "missing_supported_content",
        messageType: extracted.messageType,
        sourceMessageId: mensaje?.id || null,
        mediaId: extracted.mediaId || null
      }, "warn");

      if (extracted.messageType === "audio") {
        await responderAlCliente({
          telefono: numeroCliente,
          respuesta: "No pude transcribir tu audio. ¿Me lo envías en texto, por favor?",
          simulated: false,
          orderId: null
        });
      }

      if (extracted.messageType !== "image") {
        return res.sendStatus(200);
      }
    }

    logEvent("webhook_text_extracted", {
      sourceMessageId: mensaje.id || null,
      telefono: numeroCliente || null,
      messageType: extracted.messageType,
      textLength: String(textoCliente || "").length,
      preview: String(textoCliente || "").slice(0, 120),
      extractedFrom: extracted.messageType === "audio"
        ? "whatsapp_audio_transcription"
        : extracted.messageType === "image"
          ? "whatsapp_image_caption_or_ocr_pipeline"
        : "req.body.entry[0].changes[0].value.messages[0].text.body"
    });

    const dedupe = registrarMensajeProcesado({
      messageId: mensaje.id,
      telefono: numeroCliente,
      mensaje: textoCliente,
      receivedAtMs: Number(mensaje.timestamp) ? Number(mensaje.timestamp) * 1000 : Date.now()
    });

    if (dedupe.duplicated) {
      logEvent("mensaje_duplicado_omitido", { sourceMessageId: mensaje.id, telefono: numeroCliente, dedupeReason: dedupe.reason }, "warn");
      return res.sendStatus(200);
    }

    logEvent("webhook_handler_dispatch", {
      sourceMessageId: mensaje.id,
      telefono: numeroCliente,
      handler: "ejecutarFlujoMensaje"
    });

    logEvent("before_ejecutar_flujo", {
      appVersion: APP_VERSION,
      sourceMessageId: mensaje.id,
      telefono: numeroCliente
    });

    const resultado = await ejecutarFlujoMensaje({
      mensaje: textoCliente,
      telefono: numeroCliente,
      sourceMessageId: mensaje.id,
      origen: "webhook",
      simulated: false,
      messageType: extracted.messageType,
      transcription: extracted.transcription,
      mediaId: extracted.mediaId,
      mediaBuffer: extracted.mediaBuffer,
      mediaMimeType: extracted.mimeType,
      mediaFilename: extracted.filename
    });

    logEvent("after_ejecutar_flujo", {
      appVersion: APP_VERSION,
      sourceMessageId: mensaje.id,
      telefono: numeroCliente,
      orderId: resultado.order?.id || null,
      ignored: resultado.ignored || false,
      ignoredReason: resultado.ignoredReason || null
    });

    logEvent("pedido_procesado", {
      orderId: resultado.order?.id || null,
      inboundMessageId: resultado.inboundMessage?.id || null,
      telefono: numeroCliente,
      valido: resultado.evaluacion?.esValido ?? null,
      ignored: resultado.ignored || false,
      ignoredReason: resultado.ignoredReason || null
    });

    return res.sendStatus(200);
  } catch (error) {
    logEvent("webhook_process_error", { error: error.response?.data || error.message }, "error");
    return res.sendStatus(500);
  }
});

app.post("/simulate-message", async (req, res) => {
  try {
    const messageType = limpiarTexto(req.body?.tipo || req.body?.messageType) || "text";
    const transcription = limpiarTexto(req.body?.transcripcion || req.body?.transcription);
    const mensaje = limpiarTexto(req.body?.mensaje || req.body?.caption) || transcription || (messageType === "image" ? "Imagen recibida" : null);
    const telefono = req.body?.telefono;
    const mediaId = limpiarTexto(req.body?.mediaId) || (["audio", "image"].includes(messageType) ? buildSimulatedSourceMessageId(messageType) : null);
    const mediaMimeType = limpiarTexto(req.body?.mimeType) || (messageType === "image" ? "image/jpeg" : null);
    const mediaFilename = limpiarTexto(req.body?.filename) || (messageType === "image" ? "simulated-image.jpg" : null);
    const mediaBuffer = messageType === "image"
      ? (req.body?.imageBase64 ? Buffer.from(String(req.body.imageBase64), "base64") : Buffer.from("simulated-image"))
      : null;

    if ((!mensaje && messageType !== "image") || !telefono) {
      return res.status(400).json({
        ok: false,
        error: "Faltan mensaje o telefono"
      });
    }

    const sourceMessageId = limpiarTexto(req.body?.sourceMessageId) || buildSimulatedSourceMessageId();
    const dedupe = registrarMensajeProcesado({
      messageId: sourceMessageId,
      telefono,
      mensaje,
      receivedAtMs: Date.now()
    });

    if (dedupe.duplicated) {
      return res.json({
        ok: true,
        simulated: true,
        ignored: true,
        ignoredReason: dedupe.reason,
        order: null,
        inboundMessage: null,
        pedido: null,
        evaluacion: null,
        respuesta: null,
        delivery: null,
        sheets: { saved: false, skipped: true, reason: "duplicate_message" }
      });
    }

    const resultado = await ejecutarFlujoMensaje({
      mensaje,
      telefono,
      sourceMessageId,
      origen: "simulate-message",
      simulated: true,
      messageType,
      transcription: messageType === "audio" ? (transcription || mensaje) : null,
      mediaId,
      mediaBuffer,
      mediaMimeType,
      mediaFilename
    });

    return res.json({
      ok: true,
      simulated: true,
      ignored: resultado.ignored || false,
      ignoredReason: resultado.ignoredReason || null,
      intent: resultado.intent || null,
      order: resultado.order,
      inboundMessage: resultado.inboundMessage,
      pedido: resultado.pedido,
      evaluacion: resultado.evaluacion,
      respuesta: resultado.respuesta,
      delivery: resultado.delivery,
      sheets: resultado.sheets
    });
  } catch (error) {
    logEvent("simulate_message_error", { error: error.response?.data || error.message }, "error");
    return res.status(500).json({ ok: false, error: "No se pudo simular el mensaje", detalle: error.message });
  }
});

app.post("/debug-webhook", (_req, res) => {
  return res.sendStatus(200);
});

app.post("/debug-send-whatsapp", requirePanelAuth, async (req, res) => {
  try {
    const to = limpiarTexto(req.body?.to);
    const message = limpiarTexto(req.body?.message);

    if (!to || !message) {
      return res.status(400).json({ ok: false, error: "to y message son obligatorios" });
    }

    logEvent("debug_send_whatsapp_started", {
      to,
      textLength: message.length,
      whatsappEnabled: WHATSAPP_ENABLED,
      phoneNumberId: process.env.PHONE_NUMBER_ID || null
    });

    const delivery = await enviarMensajeWhatsApp(to, message);

    logEvent("debug_send_whatsapp_completed", {
      to,
      whatsappMessageId: delivery?.messages?.[0]?.id || null
    });

    return res.json({ ok: true, delivery });
  } catch (error) {
    logEvent("debug_send_whatsapp_error", {
      status: error.response?.status || null,
      error: error.response?.data || error.message
    }, "error");

    return res.status(500).json({
      ok: false,
      status: error.response?.status || null,
      error: error.response?.data || error.message
    });
  }
});

app.post("/pedido/manual", requirePanelAuth, async (req, res) => {
  try {
    const mensaje = req.body.message;

    if (!mensaje) {
      return res.status(400).json({ error: "Falta el campo message" });
    }

    const resultado = await procesarPedidoDesdeTexto(mensaje, { guardar: false });
    return res.json(resultado);
  } catch (error) {
    logEvent("pedido_manual_error", { error: error.response?.data || error.message }, "error");
    return res.status(500).json({ error: "No se pudo procesar el mensaje", detalle: error.message });
  }
});

async function startServer() {
  await bootstrapDbDesdeSheets();
  await bootstrapCatalogoDesdeTreinta();

  app.listen(port, () => {
    logEvent("app_version_started", { commit: APP_VERSION });
    logRuntimeConfigSnapshot("startup");
    logEvent("server_started", { port, databasePath, appVersion: APP_VERSION });
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    logEvent("server_start_error", { error: error.message }, "error");
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer,
  bootstrapCatalogoDesdeTreinta,
  sincronizarCatalogoDesdeTreinta,
  setCatalogProductsCache,
  getCatalogProductsCache,
  processImageOrder,
  resolveProductFromCatalog,
  resolverProductoCatalogo,
  analizarProductosCatalogoDesdeTexto,
  obtenerEstadoConversacion,
  ejecutarFlujoMensaje,
  sanitizeAiResponseAgainstFallback,
  buildValidatedResponseContext
};
