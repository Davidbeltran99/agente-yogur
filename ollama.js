const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { structuredLog } = require("./logger");

const promptBase = fs.readFileSync(path.join(__dirname, "prompt.txt"), "utf-8");
const OPENAI_PROVIDER = "openai";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 30000);
const OPENAI_MAX_TOKENS = Number(process.env.OPENAI_MAX_TOKENS || 160);
const OPENAI_TEMPERATURE = Number(process.env.OPENAI_TEMPERATURE || 0.1);
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const OPENAI_TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";
const DEEPGRAM_BASE_URL = (process.env.DEEPGRAM_BASE_URL || "https://api.deepgram.com").replace(/\/$/, "");

function logEvent(event, details = {}, level = "info") {
  structuredLog(event, details, level);
}

function limpiarRespuestaJSON(texto) {
  const limpio = String(texto || "").trim();

  if (limpio.startsWith("```")) {
    return limpio
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();
  }

  return limpio;
}

function construirMensajes(mensaje) {
  return [
    {
      role: "system",
      content: promptBase
    },
    {
      role: "user",
      content: mensaje
    }
  ];
}

async function llamarOpenAIBase({ messages, temperature = OPENAI_TEMPERATURE, maxTokens = OPENAI_MAX_TOKENS, responseFormat = { type: "json_object" } }) {
  logEvent("PROVIDER_ACTIVE", {
    provider: OPENAI_PROVIDER,
    baseUrl: OPENAI_BASE_URL
  });
  logEvent("MODEL_ACTIVE", {
    provider: OPENAI_PROVIDER,
    model: OPENAI_MODEL,
    baseUrl: OPENAI_BASE_URL
  });
  logEvent("model_used", { provider: OPENAI_PROVIDER, model: OPENAI_MODEL, baseUrl: OPENAI_BASE_URL });

  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey || apiKey === "tu_api_key") {
    throw new Error("Falta OPENAI_API_KEY válida en .env");
  }

  const payload = {
    model: OPENAI_MODEL,
    temperature,
    max_completion_tokens: maxTokens,
    messages
  };

  if (responseFormat) {
    payload.response_format = responseFormat;
  }

  const response = await axios.post(
    `${OPENAI_BASE_URL}/chat/completions`,
    payload,
    {
      timeout: OPENAI_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data.choices?.[0]?.message?.content || "{}";
}

async function llamarOpenAI({ mensaje }) {
  return llamarOpenAIBase({ messages: construirMensajes(mensaje) });
}

function buildInlineImageDataUrl(buffer, mimeType = "image/jpeg") {
  if (!buffer) {
    throw new Error("Buffer de imagen obligatorio");
  }

  return `data:${mimeType || "image/jpeg"};base64,${Buffer.from(buffer).toString("base64")}`;
}

function normalizarIntentResult(payload = {}) {
  const allowedIntents = new Set(["order_request", "catalog_request", "add_item", "remove_item", "closing", "admin_query", "payment", "address", "general"]);
  const intent = allowedIntents.has(String(payload.intent || "").trim()) ? String(payload.intent).trim() : "general";
  const confidence = Math.max(0, Math.min(1, Number(payload.confidence) || 0));

  return {
    intent,
    confidence,
    products_mentioned: Array.isArray(payload.products_mentioned) ? payload.products_mentioned.slice(0, 8).map((item) => String(item || "").trim()).filter(Boolean) : [],
    requested_changes: Array.isArray(payload.requested_changes) ? payload.requested_changes.slice(0, 8).map((item) => String(item || "").trim()).filter(Boolean) : [],
    missing_data: Array.isArray(payload.missing_data) ? payload.missing_data.slice(0, 8).map((item) => String(item || "").trim()).filter(Boolean) : [],
    suggested_response_goal: String(payload.suggested_response_goal || "").trim().slice(0, 240)
  };
}

async function inferConversationIntent(contexto = {}) {
  const systemPrompt = [
    "Eres el orquestador conversacional de Abi para Tellolac.",
    "Tu trabajo es clasificar la intención del mensaje usando SOLO el contexto dado.",
    "No inventes productos, precios ni estados.",
    "Devuelve únicamente JSON válido.",
    "Usa intent solo de esta lista: order_request, catalog_request, add_item, remove_item, closing, admin_query, payment, address, general.",
    "confidence debe estar entre 0 y 1.",
    "products_mentioned y requested_changes deben ser listas cortas de texto.",
    "missing_data debe listar solo datos realmente faltantes si aplica.",
    "suggested_response_goal debe describir brevemente qué debería lograr la respuesta final."
  ].join(" ");

  const userPrompt = `Contexto:\n${JSON.stringify(contexto, null, 2)}\n\nClasifica la intención y devuelve el JSON.`;
  const content = await llamarOpenAIBase({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.1,
    maxTokens: 220,
    responseFormat: { type: "json_object" }
  });

  return normalizarIntentResult(JSON.parse(limpiarRespuestaJSON(content)));
}

function normalizarResultadoImagenPedido(payload = {}) {
  const items = Array.isArray(payload.items)
    ? payload.items.slice(0, 20).map((item) => {
        const quantity = Number(item?.quantity);
        const confidence = Math.max(0, Math.min(1, Number(item?.confidence) || 0));
        const rawText = String(item?.raw_text || "").trim().slice(0, 180);
        const productQuery = String(item?.product_query || "").trim().slice(0, 180);
        if (!rawText && !productQuery) {
          return null;
        }

        return {
          raw_text: rawText || productQuery,
          product_query: productQuery || rawText,
          quantity: Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1,
          confidence
        };
      }).filter(Boolean)
    : [];

  const uncertainLines = Array.isArray(payload.uncertain_lines)
    ? payload.uncertain_lines
      .slice(0, 12)
      .map((line) => {
        if (!line) {
          return null;
        }

        if (typeof line === "string") {
          return { text: line.trim().slice(0, 180), confidence: null };
        }

        const text = String(line.text || line.raw_text || line.rawText || "").trim().slice(0, 180);
        const confidence = Number(line.confidence);
        if (!text) {
          return null;
        }

        return {
          text,
          confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null
        };
      })
      .filter((line) => line?.text)
    : [];

  const extractedText = String(payload.extracted_text || payload.ocr_text || "").trim().slice(0, 2000) || null;
  const overallConfidence = items.length
    ? items.reduce((acc, item) => acc + (Number(item.confidence) || 0), 0) / items.length
    : 0;

  return {
    items,
    uncertain_lines: uncertainLines,
    extracted_text: extractedText,
    address: String(payload.address || payload.delivery_address || "").trim().slice(0, 240) || null,
    payment_method: String(payload.payment_method || payload.metodo_pago || "").trim().slice(0, 120) || null,
    overall_confidence: Math.max(0, Math.min(1, Number(payload.overall_confidence) || overallConfidence || 0))
  };
}

async function analizarImagenPedido({ buffer, mimeType = "image/jpeg", filename = "pedido.jpg", caption = null, language = "es" } = {}) {
  const systemPrompt = [
    "Lees imágenes de pedidos comerciales para Tellolac.",
    "Extrae SOLO lo visible en la imagen.",
    "No inventes productos, cantidades, sabores, direcciones ni pagos.",
    "Si algo no se entiende, márcalo en uncertain_lines.",
    "Devuelve únicamente JSON válido.",
    "Formato: { items: [{ raw_text, product_query, quantity, confidence }], uncertain_lines: [{ text, confidence }], extracted_text: string, address: string|null, payment_method: string|null, overall_confidence: number }.",
    "product_query debe ser una consulta comercial corta y útil para cruzar contra catálogo.",
    "confidence y overall_confidence deben estar entre 0 y 1.",
    "Idioma principal: español."
  ].join(" ");

  const userContent = [
    {
      type: "text",
      text: `Lee esta imagen de un pedido comercial escrito a mano. Extrae productos, cantidades, tamaños, sabores y presentaciones. Devuelve JSON estructurado. No inventes productos. Si algo no se entiende, márcalo como uncertain. Caption opcional: ${String(caption || "ninguno")}. Archivo: ${filename}. Idioma: ${language}.`
    },
    {
      type: "image_url",
      image_url: {
        url: buildInlineImageDataUrl(buffer, mimeType)
      }
    }
  ];

  const content = await llamarOpenAIBase({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent }
    ],
    temperature: 0.1,
    maxTokens: 500,
    responseFormat: { type: "json_object" }
  });

  return normalizarResultadoImagenPedido(JSON.parse(limpiarRespuestaJSON(content)));
}

async function generarRespuestaAbi(contexto = {}) {
  const systemPrompt = [
    "Eres Abi, asesora comercial de Tellolac.",
    "Responde en español natural, cálido, resolutivo y breve.",
    "Usa solo los datos entregados en el contexto.",
    "No inventes productos, precios, links ni estados.",
    "Resuelve por el cliente cuando la confianza ya sea suficiente y pregunta solo lo realmente ambiguo.",
    "Nunca expliques validaciones internas ni menciones catálogo no encontrado, errores técnicos, parser, coincidencias exactas o lógica del sistema.",
    "Si hay productos confirmados y uno ambiguo, avanza con lo confirmado y pregunta únicamente por ese punto.",
    "Si falta un dato del pedido, pide solo ese dato de forma puntual y amable.",
    "No uses frases quemadas como 'Estoy aquí para ayudarte', 'No encontré', 'Solo me falta' o 'Catálogo no tiene'.",
    "Si el backend ya validó productos, precios o total, respétalos exactamente.",
    "No calcules nada ni cambies cifras.",
    "Toma el fallback como base segura de negocio y, si lo mejoras, conserva exactamente los productos confirmados, sugerencias y faltantes.",
    "Devuelve solo texto plano para enviar al cliente."
  ].join(" ");

  const userPrompt = `Contexto seguro:\n${JSON.stringify(contexto, null, 2)}\n\nRedacta la respuesta final para el cliente sin exponer lógica interna.`;
  const content = await llamarOpenAIBase({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.45,
    maxTokens: 220,
    responseFormat: null
  });

  return String(content || "").trim();
}

async function procesarMensaje(mensaje) {
  try {
    const content = await llamarOpenAI({ mensaje });
    return JSON.parse(limpiarRespuestaJSON(content));
  } catch (error) {
    const detalle = error.response?.data?.error?.message || error.response?.data?.error || error.message || "Error desconocido";
    throw new Error(`Fallo procesando mensaje con ${OPENAI_PROVIDER}/${OPENAI_MODEL}: ${detalle}`);
  }
}

async function transcribirAudioOpenAI({ buffer, mimeType = "audio/ogg", filename = "audio.ogg", language = "es" }) {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey || apiKey === "tu_api_key") {
    throw new Error("Falta OPENAI_API_KEY válida en .env");
  }

  const form = new FormData();
  form.append("model", OPENAI_TRANSCRIPTION_MODEL);
  form.append("language", language);
  form.append("file", new Blob([buffer], { type: mimeType }), filename);

  const response = await fetch(`${OPENAI_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form,
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.error || `OpenAI transcription error ${response.status}`);
  }

  return String(data?.text || "").trim();
}

async function transcribirAudioDeepgram({ buffer, mimeType = "audio/ogg", language = "es" }) {
  const apiKey = (process.env.DEEPGRAM_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("Falta DEEPGRAM_API_KEY en .env");
  }

  const response = await axios.post(`${DEEPGRAM_BASE_URL}/v1/listen?model=nova-2&smart_format=true&detect_language=false&language=${encodeURIComponent(language)}`,
    buffer,
    {
      timeout: OPENAI_TIMEOUT_MS,
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": mimeType
      }
    }
  );

  return String(response.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "").trim();
}

async function transcribirAudio(params = {}) {
  const preferredProvider = String(process.env.AUDIO_TRANSCRIPTION_PROVIDER || "").trim().toLowerCase();
  const useDeepgram = preferredProvider === "deepgram" || (!preferredProvider && Boolean((process.env.DEEPGRAM_API_KEY || "").trim()));

  try {
    return useDeepgram
      ? await transcribirAudioDeepgram(params)
      : await transcribirAudioOpenAI(params);
  } catch (error) {
    if (!useDeepgram && (process.env.DEEPGRAM_API_KEY || "").trim()) {
      return transcribirAudioDeepgram(params);
    }

    throw error;
  }
}

module.exports = {
  analizarImagenPedido,
  inferConversationIntent,
  procesarMensaje,
  generarRespuestaAbi,
  transcribirAudio,
  OPENAI_PROVIDER,
  OPENAI_MODEL,
  OPENAI_BASE_URL
};
