const axios = require("axios");

const CATALOG_URL = "https://catalogo.treinta.co/tellolac";
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || "v20.0";

function logWhatsAppEvent(event, details = {}, level = "info") {
  const logger = level === "error"
    ? console.error
    : (level === "warn" ? console.warn : console.log);

  logger(JSON.stringify({ level, event, ...details }));
}

function normalizarDestinoWhatsApp(valor) {
  return String(valor || "").replace(/\D/g, "");
}

async function enviarMensajeWhatsApp(para, texto) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = (process.env.PHONE_NUMBER_ID || "").trim();
  const destino = normalizarDestinoWhatsApp(para);
  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: destino,
    type: "text",
    text: {
      body: texto
    }
  };

  if (!token || !phoneNumberId) {
    throw new Error("Faltan WHATSAPP_TOKEN o PHONE_NUMBER_ID en .env");
  }

  logWhatsAppEvent("whatsapp_request_prepared", {
    url,
    phoneNumberId,
    to: destino,
    textLength: String(texto || "").length
  });

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    return response.data;
  } catch (error) {
    logWhatsAppEvent("whatsapp_request_failed", {
      status: error.response?.status || null,
      data: error.response?.data || null,
      phoneNumberId,
      to: destino,
      url
    }, "error");
    throw error;
  }
}

function formatearFaltante(campo) {
  const etiquetas = {
    productos: "qué productos quieres",
    detalle_productos: "cantidades o productos claros",
    productos_catalogo: "productos tal como aparecen en el catálogo",
    confirmacion_catalogo: "confirmar el producto exacto del catálogo",
    precio_producto: "el precio validado del producto",
    direccion: "la dirección de entrega",
    metodo_pago: "el método de pago",
    total: "el total del pedido"
  };

  return etiquetas[campo] || campo;
}

function construirLineaCatalogoSugerido() {
  return `También puedes ver todo el catálogo aquí:\n${CATALOG_URL}`;
}

function construirRespuestaCatalogoInicial() {
  return [
    "Hola 👋 puedes ver nuestros productos aquí:",
    CATALOG_URL,
    "Envíame el producto, cantidad, dirección y forma de pago."
  ].join("\n");
}

function formatearMoneda(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) {
    return null;
  }

  return `$${Math.round(numero).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

function construirDetalleProductos(productos = []) {
  if (!productos.length) {
    return "- No se identificaron productos claramente";
  }

  return productos.map((p) => {
    const cantidad = p.cantidad || "?";
    const nombre = [p.producto || "producto", p.sabor || null].filter(Boolean).join(" ");
    const subtotal = formatearMoneda(p.subtotal);
    return subtotal
      ? `- ${cantidad} ${nombre} → ${subtotal}`
      : `- ${cantidad} ${nombre}`;
  }).join("\n");
}

function construirListaProductosDisponibles(availableProducts = []) {
  if (!Array.isArray(availableProducts) || !availableProducts.length) {
    return null;
  }

  return [
    "Productos disponibles ahora:",
    ...availableProducts.map((product) => `- ${product}`)
  ].join("\n");
}

function construirLineaOpcionAmbigua(option, index) {
  if (!option) {
    return null;
  }

  const nombre = option.nombre || option.productoOriginal || `Opción ${index + 1}`;
  const precio = formatearMoneda(option.precio);
  return `${index + 1}. ${nombre}${precio ? ` — ${precio}` : ""}`;
}

function construirRespuestaPedido(pedido, evaluacion = { esValido: true, faltantes: [], productosInvalidos: [] }, options = {}) {
  const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
  const detalle = construirDetalleProductos(productos);
  const listaProductosDisponibles = construirListaProductosDisponibles(options.availableProducts);

  if (evaluacion.modelError) {
    return "Hubo un problema procesando tu pedido. ¿Puedes repetirlo por favor?";
  }

  if (evaluacion.priceValidation === "missing_price") {
    return "No pude validar el precio del producto, ¿puedes confirmarlo?";
  }

  if (evaluacion.catalogStatus === "not_found") {
    return [
      "No encontré ese producto en el catálogo. ¿Quieres que te comparta los productos disponibles?",
      listaProductosDisponibles,
      `También puedes revisar el catálogo aquí: ${CATALOG_URL}`
    ].filter(Boolean).join("\n");
  }

  if (evaluacion.catalogStatus === "ambiguous") {
    const firstAmbiguity = (evaluacion.ambiguousProducts || [])[0] || null;
    const ambiguityLines = (firstAmbiguity?.options || [])
      .slice(0, 4)
      .map((option, index) => construirLineaOpcionAmbigua(option, index))
      .filter(Boolean)
      .join("\n");

    return [
      "Tenemos varias opciones:",
      ambiguityLines || null,
      "¿Cuál deseas?"
    ].filter(Boolean).join("\n\n");
  }

  if (!evaluacion.esValido) {
    if (evaluacion.faltantes?.includes("direccion") && productos.length) {
      return [
        "Ya identifiqué los productos de tu pedido 👍",
        "🧾 Lo que capté:",
        detalle,
        pedido.metodo_pago ? `💳 Pago: ${pedido.metodo_pago}` : null,
        "Me falta la dirección de entrega para registrarlo.",
        "Envíamela y te lo dejo listo."
      ].filter(Boolean).join("\n");
    }

    const faltantes = evaluacion.faltantes.map(formatearFaltante).join(", ");

    return [
      "👋 Ya entendí una parte de tu pedido.",
      "🧾 Lo que capté:",
      detalle,
      pedido.direccion ? `📍 Dirección: ${pedido.direccion}` : null,
      pedido.metodo_pago ? `💳 Pago: ${pedido.metodo_pago}` : null,
      `Me falta confirmar: ${faltantes}.`,
      "Respóndeme con esos datos y te lo dejo listo.",
      construirLineaCatalogoSugerido()
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "✅ Pedido recibido",
    "Productos:",
    detalle,
    pedido.total ? `Total: ${formatearMoneda(pedido.total)}` : null,
    `📍 Dirección: ${pedido.direccion || "pendiente por confirmar"}`,
    pedido.fecha_entrega ? `🕒 Entrega: ${pedido.fecha_entrega}` : null,
    `💳 Pago: ${pedido.metodo_pago || "pendiente por confirmar"}`,
    construirLineaCatalogoSugerido()
  ]
    .filter(Boolean)
    .join("\n");
}

module.exports = {
  CATALOG_URL,
  enviarMensajeWhatsApp,
  construirRespuestaPedido,
  construirRespuestaCatalogoInicial,
  construirLineaCatalogoSugerido
};
