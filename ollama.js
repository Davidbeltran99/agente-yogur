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

module.exports = {
  procesarMensaje,
  generarRespuestaAbi,
  OPENAI_PROVIDER,
  OPENAI_MODEL,
  OPENAI_BASE_URL
};
