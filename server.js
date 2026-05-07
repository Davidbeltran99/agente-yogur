require("dotenv").config();

const { createHash, createHmac, timingSafeEqual } = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { structuredLog } = require("./logger");
const { procesarMensaje, OPENAI_MODEL } = require("./ollama");
const {
  leerPedidosDesdeSheets,
  actualizarEstadoPedidoEnSheets,
  sincronizarPedidoDesdeDbEnSheets,
  reconstruirSheetsDesdeOrders
} = require("./sheets");
const {
  databasePath,
  ESTADOS_VALIDOS,
  saveOrder,
  listOrders,
  listOrdersIncludingArchived,
  updateOrderStatus,
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
  createDailyClosure,
  listDailyClosures,
  getDailyClosureById
} = require("./db");
const { generateDailyClosurePdf } = require("./reports");
const {
  DEFAULT_CATALOG_URL,
  fetchCatalogProducts,
  normalizeCatalogText
} = require("./catalog");
const {
  enviarMensajeWhatsApp,
  construirRespuestaPedido,
  construirRespuestaCatalogoInicial,
  construirRespuestaCatalogoInformativo,
  construirRespuestaNombreRegistrado,
  construirRespuestaIdentidad,
  construirRespuestaDespedida,
  construirRespuestaConfirmacion,
  construirRespuestaCasual,
  construirLineaCatalogoSugerido,
  CATALOG_URL
} = require("./whatsapp");

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
const panelLoginAttemptState = new Map();

app.set("trust proxy", 1);
app.use(express.json());
app.use("/assets", express.static(path.join(publicDir, "assets")));
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
const ADDRESS_KEYWORDS = /(calle|cll|carrera|cra|cr|avenida|av\.?|barrio|manzana|mz|casa|apartamento|apto|torre|bloque|conjunto)/i;
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

function esMensajeBienvenida(texto) {
  const normalized = normalizarTextoAnalisis(texto);
  return /^(hola|buenas|buenos dias|buenas tardes|buenas noches)$/.test(normalized);
}

function esIntencionInfoCatalogo(texto) {
  const normalized = normalizarTextoAnalisis(texto);
  if (!normalized) {
    return false;
  }

  if (/\b(quiero|quisiera|necesito|pedido|pedir|ordeno|encargo|comprar|me regalas|dame|enviame|enviarme)\b/i.test(normalized)) {
    return false;
  }

  return /^(info|informacion|información|menu|menú|catalogo|catálogo|precios|portafolio)$/.test(normalized)
    || /\b(que venden|que productos tienen|que manejan|catalogo|catálogo|menu|menú|precios|informacion|información|portafolio)\b/.test(normalized);
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

  return /^(gracias|muchas gracias|mil gracias|listo gracias|ok gracias|perfecto gracias|bye|chao|adios|hasta luego|hablamos|gracias bye)$/.test(normalized);
}

function esConfirmacionCasual(texto) {
  const normalized = normalizarTextoAnalisis(texto);
  if (!normalized) {
    return false;
  }

  return /^(listo|ok|dale|perfecto|esta bien|está bien|bueno)$/.test(normalized);
}

function detectarIntencionConversacional(texto, { hasDraftContext = false } = {}) {
  if (esPreguntaIdentidad(texto)) {
    return "identidad";
  }

  if (esIntencionNombre(texto)) {
    return "nombre";
  }

  if (esDespedida(texto)) {
    return "despedida";
  }

  if (detectarIntencionPedido(texto)) {
    return "pedido";
  }

  if (esIntencionInfoCatalogo(texto)) {
    return "info_catalogo";
  }

  if (esMensajeBienvenida(texto)) {
    return "saludo";
  }

  if (esConfirmacionCasual(texto)) {
    return "confirmacion";
  }

  if (hasDraftContext) {
    return "faltan_datos";
  }

  return "conversacion_general";
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
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCatalogFamilyName(value) {
  return normalizeCanonicalCatalogName(value)
    .replace(/\b(1800 ml|1000 ml)\b/g, " ")
    .replace(/\b\d+\b$/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

function limpiarTextoProductoSolicitado(valor) {
  return normalizeCatalogText(valor)
    .replace(/\b(quiero|quisiera|necesito|pedido|pedir|ordeno|encargo|comprar|me regalas|dame|enviame|enviarme|por favor|para|llevo|agrégame|agregame)\b/g, " ")
    .replace(/\b(de|del|la|el|los|las)\b/g, " ")
    .replace(/^\s*(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b\s*/g, "")
    .replace(/\b\d{2,3}\.\d{3}\b(?!\s*ml\b)/g, " ")
    .replace(/\b\d{4,6}\b(?!\s*ml\b)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function puntuarCoincidenciaCatalogo(candidate, alias) {
  if (!candidate || !alias) {
    return 0;
  }

  if (candidate === alias) {
    return 140 + alias.length / 100;
  }

  if (candidate.includes(alias)) {
    return 115 + alias.length / 100;
  }

  if (alias.includes(candidate) && candidate.length >= 5) {
    return 92 + candidate.length / 100;
  }

  const candidateTokens = candidate.split(" ").filter((token) => token.length >= 2);
  const aliasTokens = alias.split(" ").filter((token) => token.length >= 2);

  if (!candidateTokens.length || !aliasTokens.length) {
    return 0;
  }

  const overlap = candidateTokens.filter((token) => aliasTokens.includes(token));
  if (!overlap.length) {
    return 0;
  }

  const ratio = overlap.length / Math.max(candidateTokens.length, aliasTokens.length);
  const candidateCovered = overlap.length / candidateTokens.length;

  if (candidateCovered >= 1) {
    return 82 + ratio * 10;
  }

  if (ratio >= 0.66) {
    return 72 + ratio * 10;
  }

  return 0;
}

function encontrarCoincidenciasCatalogo(texto, { minScore = 70, limit = 5 } = {}) {
  const candidate = limpiarTextoProductoSolicitado(texto);
  if (!candidate) {
    return [];
  }

  const matches = [];

  for (const product of getCatalogProductsCache()) {
    let bestScore = 0;

    for (const alias of product.aliases || []) {
      bestScore = Math.max(bestScore, puntuarCoincidenciaCatalogo(candidate, alias));
    }

    if (bestScore >= minScore) {
      matches.push({ product, score: bestScore });
    }
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
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
  return products
    .filter(Boolean)
    .filter((product, index, list) => list.findIndex((entry) => entry.id === product.id) === index)
    .map((product) => ({
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

function shouldAskFamilyClarificationForRootQuery(product, familyMatches, normalizedCandidate) {
  if (!product || !familyMatches.length || normalizedCandidate !== product.nombre_familia) {
    return false;
  }

  return familyMatches.some((entry) => entry.id !== product.id && new RegExp(`^${escapeRegex(product.nombre_familia)}\\s+\\d+$`).test(entry.nombre_canonico || ""));
}

function resolverProductoCatalogo(texto) {
  const candidate = limpiarTextoProductoSolicitado(texto);
  const requestedPrice = extractRequestedPrice(texto);
  const candidateCanonical = normalizeCanonicalCatalogName(candidate);
  const candidateFamily = normalizeCatalogFamilyName(candidate);
  const catalog = getCatalogProductsCache();

  if (!candidate) {
    return {
      status: "not_found",
      candidate: limpiarTexto(texto)
    };
  }

  const exactMatches = catalog.filter((product) => {
    const originalName = normalizeCatalogText(product.producto_original || product.nombre);
    return originalName === candidate || product.nombre_canonico === candidateCanonical || (product.aliases || []).includes(candidate);
  });

  if (exactMatches.length > 1) {
    const pricedMatch = resolveCatalogProductByPrice(exactMatches, requestedPrice);
    if (pricedMatch) {
      return {
        status: "matched",
        candidate: limpiarTexto(texto),
        product: pricedMatch
      };
    }

    return {
      status: "ambiguous",
      candidate: limpiarTexto(texto),
      matches: buildCatalogAmbiguityOptions(exactMatches)
    };
  }

  if (exactMatches.length === 1) {
    const exactMatch = exactMatches[0];
    const canonicalMatches = catalog.filter((product) => product.nombre_canonico === exactMatch.nombre_canonico);
    if (canonicalMatches.length > 1) {
      const pricedMatch = resolveCatalogProductByPrice(canonicalMatches, requestedPrice);
      if (pricedMatch) {
        return {
          status: "matched",
          candidate: limpiarTexto(texto),
          product: pricedMatch
        };
      }

      return {
        status: "ambiguous",
        candidate: limpiarTexto(texto),
        matches: buildCatalogAmbiguityOptions(canonicalMatches)
      };
    }

    const familyMatches = catalog.filter((product) => product.nombre_familia === exactMatch.nombre_familia);
    if (shouldAskFamilyClarificationForRootQuery(exactMatch, familyMatches, candidate)) {
      return {
        status: "ambiguous",
        candidate: limpiarTexto(texto),
        matches: buildCatalogAmbiguityOptions(familyMatches)
      };
    }

    return {
      status: "matched",
      candidate: limpiarTexto(texto),
      product: exactMatch
    };
  }

  const familyMatches = catalog.filter((product) => product.nombre_familia === candidateFamily);
  if (familyMatches.length > 1) {
    const pricedMatch = resolveCatalogProductByPrice(familyMatches, requestedPrice);
    if (pricedMatch) {
      return {
        status: "matched",
        candidate: limpiarTexto(texto),
        product: pricedMatch
      };
    }

    return {
      status: "ambiguous",
      candidate: limpiarTexto(texto),
      matches: buildCatalogAmbiguityOptions(familyMatches)
    };
  }

  if (familyMatches.length === 1) {
    return {
      status: "matched",
      candidate: limpiarTexto(texto),
      product: familyMatches[0]
    };
  }

  const matches = encontrarCoincidenciasCatalogo(texto, { minScore: 70, limit: 3 });

  if (!matches.length) {
    return {
      status: "not_found",
      candidate: limpiarTexto(texto)
    };
  }

  const [best, second] = matches;
  if (second && Math.abs(best.score - second.score) <= 6) {
    const sameFamilyMatches = matches.filter((entry) => entry.product?.nombre_familia === best.product?.nombre_familia);
    const ambiguityPool = sameFamilyMatches.length >= 2 ? sameFamilyMatches : matches;

    return {
      status: "ambiguous",
      candidate: limpiarTexto(texto),
      matches: buildCatalogAmbiguityOptions(ambiguityPool.map((entry) => entry.product))
    };
  }

  return {
    status: "matched",
    candidate: limpiarTexto(texto),
    product: best.product
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
    const cantidad = Number.isFinite(Number(item?.cantidad)) && Number(item.cantidad) > 0
      ? Number(item.cantidad)
      : null;
    const precioUnitario = parseOptionalNumber(item?.precioUnitario ?? item?.precio_unitario);
    const subtotal = parseOptionalNumber(item?.subtotal);

    if (!producto && !sabor && !cantidad) {
      continue;
    }

    const key = `${producto || "sin-producto"}::${sabor || "sin-sabor"}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        producto: producto || null,
        sabor: sabor || null,
        cantidad: cantidad || 0,
        precio_unitario: precioUnitario,
        subtotal: subtotal
      });
      continue;
    }

    const current = grouped.get(key);
    current.cantidad += cantidad || 0;
    current.precio_unitario = current.precio_unitario ?? precioUnitario;
    current.subtotal = (current.subtotal ?? 0) + (subtotal ?? 0);
  }

  return Array.from(grouped.values()).map((item) => ({
    ...item,
    cantidad: item.cantidad || null,
    subtotal: item.subtotal || null
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

function extraerDireccionDesdeTexto(texto) {
  const raw = String(texto || "").trim();
  const labeledMatch = raw.match(/(?:direcci[oó]n|direccion)\s*[:\-]?\s*(.+?)(?=(?:\.|,|\s+pago\b|\s+nequi\b|\s+daviplata\b|\s+efectivo\b|\s+transferencia\b|$))/i);

  if (labeledMatch?.[1]) {
    return limpiarTexto(labeledMatch[1]);
  }

  const keywordMatch = raw.match(new RegExp(`((?:calle|cll|carrera|cra|cr|avenida|av\\.?|barrio|manzana|mz|casa|apartamento|apto|torre|bloque)[^,.]+)`, "i"));
  return limpiarTexto(keywordMatch?.[1] || null);
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
  const match = String(segmentoNormalizado || "").match(/(?:^|\b(?:quiero|quisiera|necesito|pedido|pedir|ordeno|encargo|comprar|llevo|dame|enviame|enviarme)\s+)(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/i);
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

function esSegmentoNoProducto(segmento) {
  const normalized = normalizarTextoAnalisis(segmento);
  if (!normalized) {
    return true;
  }

  const hasPurchaseIntent = /\b(quiero|quisiera|necesito|pedido|pedir|ordeno|encargo|comprar|me regalas|dame|enviame|enviarme)\b/i.test(normalized);
  const hasQuantity = /\b(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/i.test(normalized);

  if (hasPurchaseIntent || hasQuantity) {
    return false;
  }

  return /\b(direccion|dirección|pago|nequi|daviplata|efectivo|transferencia|calle|carrera|cra|barrio|entrega|hoy|manana|mañana|pm|am)\b/i.test(normalized);
}

function analizarProductosCatalogoDesdeTexto(texto, aiProducts = []) {
  const segments = segmentarPosiblesProductos(texto);
  const items = [];
  const ambiguities = [];
  const unmatched = [];

  for (const segment of segments) {
    const quickMatches = encontrarCoincidenciasCatalogo(segment, { minScore: 70, limit: 2 });
    const hasQuantity = encontrarCantidadEnSegmento(normalizarTextoAnalisis(segment));

    if (esSegmentoNoProducto(segment) && !quickMatches.length && !hasQuantity) {
      continue;
    }

    if (!quickMatches.length && !hasQuantity) {
      continue;
    }

    const resolution = resolverProductoCatalogo(segment);
    if (resolution.status === "matched") {
      const cantidad = encontrarCantidadEnSegmento(normalizarTextoAnalisis(segment)) || 1;
      const precioUnitario = parseOptionalNumber(resolution.product.precio);

      items.push({
        producto: resolution.product.nombre,
        sabor: null,
        cantidad,
        precio_unitario: precioUnitario,
        subtotal: precioUnitario !== null ? precioUnitario * cantidad : null
      });
      continue;
    }

    if (resolution.status === "ambiguous") {
      ambiguities.push({
        input: segment,
        options: resolution.matches.slice(0, 3)
      });
      continue;
    }

    const localAliasResolution = resolverProductoAliasLocal(segment);
    if (localAliasResolution.status === "matched") {
      const cantidad = encontrarCantidadEnSegmento(normalizarTextoAnalisis(segment)) || 1;
      const catalogProduct = findCatalogProductForCanonicalAlias(localAliasResolution.canonical);

      if (!catalogProduct) {
        unmatched.push(segment);
        continue;
      }

      const precioUnitario = parseOptionalNumber(catalogProduct?.precio);

      items.push({
        producto: catalogProduct.nombre,
        sabor: null,
        cantidad,
        precio_unitario: precioUnitario,
        subtotal: precioUnitario !== null ? precioUnitario * cantidad : null
      });
      continue;
    }

    if (hasQuantity || quickMatches.length) {
      unmatched.push(segment);
    }
  }

  if (!items.length && !ambiguities.length && Array.isArray(aiProducts) && aiProducts.length) {
    for (const aiItem of aiProducts) {
      let resolved = false;

      for (const candidate of construirCandidatosProductoIA(aiItem)) {
        const resolution = resolverProductoCatalogo(candidate);
        if (resolution.status === "matched") {
          const cantidad = Number.isFinite(Number(aiItem?.cantidad)) && Number(aiItem.cantidad) > 0
            ? Number(aiItem.cantidad)
            : 1;
          const precioUnitario = parseOptionalNumber(resolution.product.precio);

          items.push({
            producto: resolution.product.nombre,
            sabor: null,
            cantidad,
            precio_unitario: precioUnitario,
            subtotal: precioUnitario !== null ? precioUnitario * cantidad : null
          });
          resolved = true;
          break;
        }

        if (resolution.status === "ambiguous") {
          ambiguities.push({
            input: candidate,
            options: resolution.matches.slice(0, 3)
          });
          resolved = true;
          break;
        }
      }

      if (!resolved) {
        const fallbackCandidate = construirCandidatosProductoIA(aiItem)[0];
        if (fallbackCandidate) {
          unmatched.push(fallbackCandidate);
        }
      }
    }
  }

  return {
    items: consolidarItemsPedido(items),
    ambiguities: ambiguities.filter((entry, index, list) => list.findIndex((candidate) => candidate.input === entry.input) === index),
    unmatched: [...new Set(unmatched.map((value) => limpiarTexto(value)).filter(Boolean))],
    possibleMatch: encontrarCoincidenciasCatalogo(texto, { minScore: 60, limit: 1 }).length > 0
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

  const analysis = analizarProductosCatalogoDesdeTexto(texto);
  const hasPurchaseVerb = /\b(quiero|quisiera|necesito|pedido|pedir|ordeno|encargo|comprar|me regalas|dame|enviame|enviarme)\b/i.test(normalized);
  const hasQuantity = /\b(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/i.test(normalized);
  const hasPaymentCue = Array.from(PAYMENT_ALIASES.keys()).some((alias) => normalized.includes(normalizarTextoAnalisis(alias)));
  const hasAddressCue = /\b(direccion|direccion:|entrega|enviar|envio|domicilio)\b/i.test(normalized) || ADDRESS_KEYWORDS.test(normalized);
  const hasProductCue = analysis.items.length > 0 || analysis.ambiguities.length > 0 || analysis.possibleMatch;
  const hasImplicitOrderReference = /\b(lo de siempre|lo mismo de ayer|lo mismo|de siempre|como siempre|lo otro|normal)\b/i.test(normalized);

  return (hasProductCue && (hasPurchaseVerb || hasQuantity || hasPaymentCue || hasAddressCue || hasImplicitOrderReference))
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

function buildCatalogFeaturedProducts() {
  const catalog = getCatalogProductsCache();
  const specs = [
    { key: "aloe", emoji: "🥛", label: "Aloe Litro", matcher: (product) => product.nombre_canonico?.includes("aloe litro") || product.nombre_familia?.includes("aloe") },
    { key: "cafe", emoji: "☕", label: "Café Litro", matcher: (product) => product.nombre_canonico?.includes("cafe litro") || product.nombre_familia?.includes("cafe") },
    { key: "ancheta", emoji: "🎁", label: "Anchetas", matcher: (product) => product.nombre_familia?.includes("ancheta"), pricePrefix: "desde" },
    { key: "bandeja", emoji: "🧀", label: "Bandejas con queso y arequipe", matcher: (product) => product.nombre_familia?.includes("bandeja") }
  ];

  return specs.map((spec) => {
    const matches = catalog.filter((product) => spec.matcher(product));
    if (!matches.length) {
      return null;
    }

    const prices = matches
      .map((product) => parseOptionalNumber(product.precio))
      .filter((price) => price !== null)
      .sort((a, b) => a - b);

    return {
      emoji: spec.emoji,
      label: spec.label,
      price: prices.length ? prices[0] : null,
      pricePrefix: spec.pricePrefix || null
    };
  }).filter(Boolean);
}

function enriquecerPedidoDetectado(pedido, textoCliente, catalogAnalysis = { items: [] }) {
  const fechaEntregaDetectada = extraerFechaEntregaDesdeTexto(textoCliente);
  const fechaEntregaIA = sanitizeFechaEntregaIA(pedido?.fecha_entrega, textoCliente);

  return {
    ...pedido,
    cliente: pedido?.cliente || extraerClienteDesdeTexto(textoCliente),
    productos: Array.isArray(catalogAnalysis.items) ? catalogAnalysis.items : [],
    direccion: pedido?.direccion || extraerDireccionDesdeTexto(textoCliente),
    fecha_entrega: fechaEntregaDetectada || fechaEntregaIA || null,
    metodo_pago: pedido?.metodo_pago || extraerMetodoPagoDesdeTexto(textoCliente),
    observaciones: pedido?.observaciones || null,
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
          subtotal: parseOptionalNumber(item?.subtotal)
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
  const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
  const productosConTotales = productos.map((item) => {
    const catalogProduct = findCatalogProductByName(item?.producto);
    const cantidad = Number.isFinite(Number(item?.cantidad)) && Number(item.cantidad) > 0
      ? Number(item.cantidad)
      : null;
    const precioUnitario = parseOptionalNumber(item?.precio_unitario)
      ?? parseOptionalNumber(item?.precioUnitario)
      ?? parseOptionalNumber(catalogProduct?.precio);
    const subtotal = cantidad && precioUnitario !== null
      ? cantidad * precioUnitario
      : null;

    return {
      producto: normalizarProducto(catalogProduct?.nombre || item?.producto),
      sabor: limpiarTexto(item?.sabor),
      cantidad,
      precio_unitario: precioUnitario,
      subtotal
    };
  }).filter((item) => item.producto || item.sabor || item.cantidad);

  const total = productosConTotales.reduce((sum, item) => {
    const subtotal = parseOptionalNumber(item.subtotal);
    return subtotal === null ? sum : sum + subtotal;
  }, 0);

  return {
    ...pedido,
    productos: productosConTotales,
    total: total > 0 ? total : null
  };
}

function evaluarPedido(pedido, catalogAnalysis = { ambiguities: [], unmatched: [] }) {
  const faltantes = [];
  const productos = Array.isArray(pedido.productos) ? pedido.productos : [];

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

  if (!pedido.direccion) {
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
    catalogStatus: hasCatalogMiss ? "not_found" : (hasCatalogAmbiguity ? "ambiguous" : "ok"),
    ambiguousProducts: Array.isArray(catalogAnalysis.ambiguities) ? catalogAnalysis.ambiguities : [],
    unmatchedProducts: Array.isArray(catalogAnalysis.unmatched) ? catalogAnalysis.unmatched : []
  };
}

function logEvent(event, details = {}, level = "info") {
  structuredLog(event, details, level);
}

function logRuntimeConfigSnapshot(context = "runtime") {
  const rawApiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const apiKeyPresent = Boolean(rawApiKey && rawApiKey !== "tu_api_key");
  const aiProvider = limpiarTexto(process.env.AI_PROVIDER) || null;

  logEvent("runtime_config_snapshot", {
    context,
    whatsappEnabled: WHATSAPP_ENABLED,
    openaiApiKeyPresent: apiKeyPresent,
    aiProvider,
    openaiModel: process.env.OPENAI_MODEL || OPENAI_MODEL
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

function buildOrderAvatarLabel(order) {
  const source = limpiarTexto(order?.cliente) || limpiarTexto(order?.telefono) || "CL";
  const parts = source.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("").slice(0, 2) || "CL";
}

function buildDashboardSummary(orders = []) {
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const todayOrders = orders.filter((order) => String(order.fechaRegistro || "").slice(0, 10) === todayKey);
  return buildOperationalSummary(todayOrders, todayKey);
}

function buildOperationalSummary(orders = [], dateKey = new Date().toISOString().slice(0, 10)) {
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

  if (!normalized) {
    return false;
  }

  const hasTemporalCue = /\b(hoy|manana|mañana|tarde|noche|am|pm|hora|horas|despues|después|antes)\b/.test(normalized)
    || /\b\d{1,2}(:\d{2})?\b/.test(textoCliente);
  const hasObservationCue = /\b(sin azucar|sin azúcar|con hielo|sin hielo|nota|observacion|observación|por favor no|sin tapa)\b/.test(normalized);
  const hasNameCue = /(?:soy|mi nombre es|habla)\s+/i.test(textoCliente);
  const missingCatalogMatch = !catalogAnalysis.items?.length && !catalogAnalysis.ambiguities?.length && !catalogAnalysis.unmatched?.length;

  if (missingCatalogMatch) {
    return false;
  }

  return hasTemporalCue || hasObservationCue || hasNameCue;
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
  const initialCatalogAnalysis = analizarProductosCatalogoDesdeTexto(textoCliente, []);
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
        error: error.message
      }, "error");

      return {
        pedido: fallbackPedidoIA,
        evaluacion: {
          esValido: false,
          faltantes: [],
          productosInvalidos: [],
          priceValidation: "ok",
          catalogStatus: "model_error",
          ambiguousProducts: [],
          unmatchedProducts: [],
          modelError: true
        },
        order: null,
        sheets: { saved: false, skipped: true, reason: "model_error" }
      };
    }
  }

  const pedidoNormalizado = normalizarPedido(pedidoIA);
  catalogAnalysis = analizarProductosCatalogoDesdeTexto(textoCliente, pedidoNormalizado.productos);
  const pedido = calcularTotalesPedido(enriquecerPedidoDetectado(pedidoNormalizado, textoCliente, catalogAnalysis));
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

function persistirMensaje({ phone, direction, messageText, whatsappMessageId = null, orderId = null }) {
  const message = saveMessage({
    phone,
    direction,
    messageText,
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

function obtenerEstadoConversacion(phone) {
  const key = limpiarTexto(phone);
  if (!key) {
    return { customerName: null, pendingPedido: null, pendingClarification: null };
  }

  if (!conversationMemoryState.has(key)) {
    conversationMemoryState.set(key, {
      customerName: inferirNombreDesdeConversacion(key),
      pendingPedido: null,
      pendingClarification: null
    });
  }

  return conversationMemoryState.get(key);
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

  const selectedIndex = extraerIndiceOpcionAclaracion(mensaje, clarification.opciones.length);
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
      intent: "aclaracion_producto"
    };
  }

  const selectedOption = clarification.opciones[selectedIndex];
  if (!selectedOption) {
    return null;
  }

  const pedidoResuelto = agregarProductoAPedido(clarification.pedido_parcial || {}, {
    producto: selectedOption.nombre,
    cantidad: clarification.cantidad || 1,
    precio_unitario: parseOptionalNumber(selectedOption.precio)
  });
  if (!pedidoResuelto.cliente && state.customerName) {
    pedidoResuelto.cliente = state.customerName;
  }

  const evaluacion = evaluarPedido(pedidoResuelto, { ambiguities: [], unmatched: [] });
  let order = null;
  let sheets = { saved: false, skipped: true, reason: "order_not_persisted" };
  const intent = evaluacion.esValido ? "pedido" : "faltan_datos";

  logEvent("product_disambiguation_resolved", {
    telefono,
    sourceMessageId,
    selectedIndex: selectedIndex + 1,
    selectedProduct: selectedOption.nombre
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
  const incomingProducts = Array.isArray(incoming.productos) ? incoming.productos.filter((item) => item?.producto || item?.cantidad) : [];
  const baseProducts = Array.isArray(base.productos) ? base.productos.filter((item) => item?.producto || item?.cantidad) : [];

  return calcularTotalesPedido({
    cliente: incoming.cliente || base.cliente || null,
    productos: incomingProducts.length ? incomingProducts : baseProducts,
    direccion: incoming.direccion || base.direccion || null,
    fecha_entrega: incoming.fecha_entrega || base.fecha_entrega || null,
    metodo_pago: incoming.metodo_pago || base.metodo_pago || null,
    observaciones: incoming.observaciones || base.observaciones || null,
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

  return { order, sheets };
}

async function responderAlCliente({ telefono, respuesta, simulated = false, orderId = null }) {
  logEvent("responder_al_cliente_called", {
    telefono,
    orderId,
    simulated,
    whatsappEnabled: WHATSAPP_ENABLED,
    textLength: String(respuesta || "").length
  });

  if (simulated || !WHATSAPP_ENABLED) {
    const simulatedMessageId = buildSimulatedSourceMessageId("simulate_out");
    const savedMessage = persistirMensaje({
      phone: telefono,
      direction: "out",
      messageText: respuesta,
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
      respuesta,
      message: savedMessage
    };
  }

  logEvent("whatsapp_send_started", {
    telefono,
    orderId,
    textLength: String(respuesta || "").length
  });

  try {
    const delivery = await enviarMensajeWhatsApp(telefono, respuesta);
    const whatsappMessageId = delivery?.messages?.[0]?.id || null;
    const savedMessage = persistirMensaje({
      phone: telefono,
      direction: "out",
      messageText: respuesta,
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
      respuesta,
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
      respuesta,
      message: null,
      whatsappMessageId: null,
      error: error.response?.data || error.message
    };
  }
}

async function ejecutarFlujoMensaje({ mensaje, telefono, sourceMessageId, origen = "webhook", simulated = false }) {
  logEvent("mensaje_recibido", { origen, telefono, sourceMessageId });

  const receivedAtMs = Date.now();

  if (excedeRateLimit(telefono, receivedAtMs)) {
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

  const previousMessageCount = countMessagesByPhone(telefono);
  const activeOrderBefore = getActiveOrderByPhone(telefono);
  const state = obtenerEstadoConversacion(telefono);
  const hasDraftContext = tieneBorradorPedido(state);
  const intent = detectarIntencionConversacional(mensaje, { hasDraftContext });
  const hasOrderIntent = intent === "pedido" || intent === "faltan_datos";
  const explicitName = intent === "nombre" ? extraerNombreExplícito(mensaje) : null;

  const inboundMessage = persistirMensaje({
    phone: telefono,
    direction: "in",
    messageText: mensaje,
    whatsappMessageId: sourceMessageId
  });

  logEvent("mensaje_extraido", {
    origen,
    telefono,
    sourceMessageId,
    textLength: String(mensaje || "").length,
    preview: String(mensaje || "").slice(0, 120)
  });

  logEvent("intencion_detectada", {
    telefono,
    sourceMessageId,
    intent,
    explicitName: explicitName || null,
    customerNameBefore: state.customerName || null
  });

  const aclaracionResuelta = await intentarResolverAclaracionPendiente({
    state,
    mensaje,
    telefono,
    sourceMessageId,
    simulated,
    inboundMessage
  });
  if (aclaracionResuelta) {
    return aclaracionResuelta;
  }

  if (intent === "saludo") {
    const respuesta = construirRespuestaCatalogoInicial({ customerName: state.customerName || null });
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });

    return { pedido: null, evaluacion: null, order: null, inboundMessage, respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent };
  }

  if (intent === "identidad") {
    const respuesta = construirRespuestaIdentidad();
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return { pedido: null, evaluacion: null, order: null, inboundMessage, respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent };
  }

  if (intent === "despedida") {
    state.pendingPedido = null;
    limpiarAclaracionPendiente(state);
    const respuesta = construirRespuestaDespedida();
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return { pedido: null, evaluacion: null, order: null, inboundMessage, respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent };
  }

  if (intent === "nombre" && explicitName) {
    state.customerName = explicitName;
    const respuesta = construirRespuestaNombreRegistrado({
      customerName: explicitName,
      featuredProducts: buildCatalogFeaturedProducts()
    });
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return { pedido: null, evaluacion: null, order: null, inboundMessage, respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent };
  }

  if (intent === "info_catalogo") {
    const respuesta = construirRespuestaCatalogoInformativo({
      customerName: state.customerName || null,
      featuredProducts: buildCatalogFeaturedProducts()
    });
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return { pedido: null, evaluacion: null, order: null, inboundMessage, respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent };
  }

  if (intent === "confirmacion") {
    const respuesta = construirRespuestaConfirmacion({ hasDraftContext });
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return { pedido: null, evaluacion: null, order: null, inboundMessage, respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent };
  }

  if (intent === "conversacion_general") {
    const respuesta = construirRespuestaCasual();
    const delivery = await responderAlCliente({ telefono, respuesta, simulated, orderId: null });
    return { pedido: null, evaluacion: null, order: null, inboundMessage, respuesta, delivery, firstContact: previousMessageCount === 0, activeOrderBefore: null, intent };
  }

  const resultadoActual = await procesarPedidoDesdeTexto(mensaje, {
    telefono,
    mensajeOriginal: mensaje,
    sourceMessageId,
    guardar: false
  });

  const pedidoCombinado = combinarPedidoParcial(state.pendingPedido || { cliente: state.customerName || null }, resultadoActual.pedido || {});
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

  let resultado = {
    pedido: pedidoCombinado,
    evaluacion: evaluacionCombinada,
    order: null,
    sheets: { saved: false, skipped: true, reason: "order_not_persisted" },
    intent: evaluacionCombinada.catalogStatus === "ambiguous" ? "aclaracion_producto" : (evaluacionCombinada.esValido ? "pedido" : "faltan_datos")
  };

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
    } else {
      limpiarAclaracionPendiente(state);
    }
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

  const respuesta = construirRespuestaPedido(resultado.pedido, resultado.evaluacion, {
    availableProducts: buildCatalogShortList(5)
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
    respuesta,
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
    panelAuthEnabled: PANEL_AUTH_ENABLED,
    sourceOfTruth: "sqlite",
    sheetsRole: SHEETS_BACKUP_ENABLED ? "reporting_backup" : "disabled"
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
      extractedTextPath: "req.body.entry[0].changes[0].value.messages[0].text.body"
    });

    if (!mensaje?.text?.body) {
      logEvent("webhook_early_return", {
        reason: "missing_text_body",
        messageType: mensaje?.type || null,
        sourceMessageId: mensaje?.id || null
      }, "warn");
      return res.sendStatus(200);
    }

    const textoCliente = mensaje.text.body;
    const numeroCliente = mensaje.from || value?.contacts?.[0]?.wa_id;

    logEvent("webhook_text_extracted", {
      sourceMessageId: mensaje.id || null,
      telefono: numeroCliente || null,
      textLength: textoCliente.length,
      preview: textoCliente.slice(0, 120),
      extractedFrom: "req.body.entry[0].changes[0].value.messages[0].text.body"
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

    if (!numeroCliente) {
      logEvent("webhook_missing_phone", { sourceMessageId: mensaje.id }, "warn");
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
      simulated: false
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
    const mensaje = req.body?.mensaje;
    const telefono = req.body?.telefono;

    if (!mensaje || !telefono) {
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
      simulated: true
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

startServer().catch((error) => {
  logEvent("server_start_error", { error: error.message }, "error");
  process.exit(1);
});
