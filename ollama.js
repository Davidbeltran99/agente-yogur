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

async function llamarOpenAI({ mensaje }) {
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

  const response = await axios.post(
    `${OPENAI_BASE_URL}/chat/completions`,
    {
      model: OPENAI_MODEL,
      temperature: OPENAI_TEMPERATURE,
      max_completion_tokens: OPENAI_MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: construirMensajes(mensaje)
    },
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
  OPENAI_PROVIDER,
  OPENAI_MODEL,
  OPENAI_BASE_URL
};
