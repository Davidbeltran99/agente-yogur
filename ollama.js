const axios = require("axios");
const fs = require("fs");
const path = require("path");

const promptBase = fs.readFileSync(path.join(__dirname, "prompt.txt"), "utf-8");
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 30000);
const OPENAI_MAX_TOKENS = Number(process.env.OPENAI_MAX_TOKENS || 160);
const OPENAI_TEMPERATURE = Number(process.env.OPENAI_TEMPERATURE || 0.1);
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

function logEvent(event, details = {}, level = "info") {
  const logger = level === "error"
    ? console.error
    : (level === "warn" ? console.warn : console.log);

  logger(JSON.stringify({ level, event, ...details }));
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
  logEvent("model_used", { model: OPENAI_MODEL });

  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey || apiKey === "tu_api_key") {
    throw new Error("Falta OPENAI_API_KEY válida en .env");
  }

  const response = await axios.post(
    `${OPENAI_BASE_URL}/chat/completions`,
    {
      model: OPENAI_MODEL,
      temperature: OPENAI_TEMPERATURE,
      max_tokens: OPENAI_MAX_TOKENS,
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
    throw new Error(`Fallo procesando mensaje con openai/${OPENAI_MODEL}: ${detalle}`);
  }
}

module.exports = {
  procesarMensaje,
  OPENAI_MODEL
};
