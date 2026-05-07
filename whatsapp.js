const axios = require("axios");
const { structuredLog } = require("./logger");

const CATALOG_URL = "https://catalogo.treinta.co/tellolac";
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || "v20.0";

function logWhatsAppEvent(event, details = {}, level = "info") {
  structuredLog(event, details, level);
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

  logWhatsAppEvent("whatsapp_send_payload_ready", {
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

function construirRespuestaCatalogoInicial({ customerName = null } = {}) {
  return customerName
    ? `¡Hola ${customerName}! 😊\nSoy Abi, tu asistente de Tellolac AI.\n\nCuéntame en qué te puedo ayudar hoy.`
    : "Hola 😊\nMi nombre es Abi, soy tu asistente virtual de Tellolac.\n\nEstoy aquí para ayudarte con información de productos, precios y pedidos 🥛✨\n\n¿Me regalas tu nombre para atenderte mejor?";
}

function construirLineasCatalogo(featuredProducts = []) {
  return Array.isArray(featuredProducts)
    ? featuredProducts.map((product) => {
        if (!product?.label) {
          return null;
        }

        const price = formatearMoneda(product.price);
        const priceText = price
          ? (product.pricePrefix === "desde" ? ` desde ${price}` : ` — ${price}`)
          : "";

        return `${product.emoji || "•"} ${product.label}${priceText}`;
      }).filter(Boolean)
    : [];
}

function construirRespuestaCatalogoInformativo({ customerName = null, featuredProducts = [] } = {}) {
  const saludo = customerName ? `Claro ${customerName} 😊` : "Claro 😊";
  const lines = construirLineasCatalogo(featuredProducts);

  return [
    saludo,
    "Estos son algunos de nuestros productos más pedidos:",
    lines.join("\n") || null,
    `También puedes ver el catálogo completo aquí:\n${CATALOG_URL}`,
    "¿Te gustaría pedir alguno? ✨"
  ].filter(Boolean).join("\n\n");
}

function construirRespuestaNombreRegistrado({ customerName, featuredProducts = [] } = {}) {
  const lines = construirLineasCatalogo(featuredProducts);
  return [
    `Mucho gusto, ${customerName} 😊`,
    "Te comparto nuestro portafolio para que conozcas los productos:",
    lines.join("\n") || null,
    `Catálogo completo:\n${CATALOG_URL}`,
    "Si quieres pedir, me escribes producto, dirección y método de pago ✨"
  ].filter(Boolean).join("\n\n");
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

function construirDetalleProductosAmable(productos = []) {
  if (!productos.length) {
    return null;
  }

  return productos.map((p) => {
    const cantidad = p.cantidad || "?";
    const nombre = [p.producto || "producto", p.sabor || null].filter(Boolean).join(" ");
    const subtotal = formatearMoneda(p.subtotal);
    return `• ${cantidad} ${nombre}${subtotal ? ` — ${subtotal}` : ""}`;
  }).join("\n");
}

function construirTituloAmbiguo(input) {
  const texto = String(input || "").trim();
  const limpio = texto
    .replace(/^quiero\s+/i, "")
    .replace(/^(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+/i, "")
    .replace(/\s+para\s+.+$/i, "")
    .replace(/\s+pago\s+.+$/i, "")
    .trim();

  return limpio || "ese producto";
}

function construirRespuestaIdentidad() {
  return "Soy Abi 😊, tu asistente virtual de Tellolac. Te puedo ayudar con productos, precios y pedidos.";
}

function construirRespuestaDespedida() {
  return "Con mucho gusto 😊\nQuedamos atentos a tu pedido.\n¡Que tengas un excelente día! ✨";
}

function construirRespuestaConfirmacion({ hasDraftContext = false } = {}) {
  return hasDraftContext
    ? "Perfecto 😊 Cuando quieras seguimos con tu pedido."
    : "Perfecto 😊 Cuando quieras te ayudo con productos, precios o pedidos.";
}

function construirRespuestaCasual() {
  return "Claro 😊 Estoy aquí para ayudarte con productos, precios o pedidos.";
}

function construirRespuestaPedido(pedido, evaluacion = { esValido: true, faltantes: [], productosInvalidos: [] }, options = {}) {
  const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
  const detalle = construirDetalleProductosAmable(productos);
  const listaProductosDisponibles = construirListaProductosDisponibles(options.availableProducts);
  const nombreCliente = String(pedido?.cliente || "").trim();

  if (evaluacion.modelError) {
    return "Tuve un problema al procesar el mensaje 😕 ¿me lo puedes reenviar?";
  }

  if (evaluacion.priceValidation === "missing_price") {
    return "No pude confirmar el precio del producto. ¿Me ayudas enviándome el nombre exacto del catálogo?";
  }

  if (evaluacion.catalogStatus === "not_found") {
    return [
      "No encontré ese producto en el catálogo 😕",
      listaProductosDisponibles,
      `Si quieres, aquí puedes verlo completo: ${CATALOG_URL}`
    ].filter(Boolean).join("\n\n");
  }

  if (evaluacion.catalogStatus === "ambiguous") {
    const firstAmbiguity = (evaluacion.ambiguousProducts || [])[0] || null;
    const titulo = construirTituloAmbiguo(firstAmbiguity?.input);
    const options = (firstAmbiguity?.options || []).slice(0, 4);
    const ambiguityLines = options
      .map((option, index) => construirLineaOpcionAmbigua(option, index))
      .filter(Boolean)
      .join("\n");
    const optionNumbers = options.map((_, index) => index + 1).join(" o ");

    return [
      `Encontré varias opciones para “${titulo}” 😊`,
      ambiguityLines || null,
      `Responde con el número de la opción: ${optionNumbers}.`
    ].filter(Boolean).join("\n\n");
  }

  if (!evaluacion.esValido) {
    if (evaluacion.faltantes?.includes("direccion") && productos.length) {
      return [
        `¡Casi listo${nombreCliente ? `, ${nombreCliente}` : ""} 😊!`,
        "Solo me falta tu dirección de entrega para completar el pedido.",
        "Escríbela así:",
        "Dirección: Calle 10 #20-30, Barrio Centro"
      ].join("\n");
    }

    const faltantes = evaluacion.faltantes.map(formatearFaltante).join(", ");

    return [
      "Voy bien con tu pedido 😊",
      detalle,
      pedido.metodo_pago ? `💳 Pago: ${pedido.metodo_pago}` : null,
      pedido.direccion ? `📍 Dirección: ${pedido.direccion}` : null,
      `Solo me falta confirmar: ${faltantes}.`
    ].filter(Boolean).join("\n");
  }

  return [
    `Perfecto${nombreCliente ? ` ${nombreCliente}` : ""} 😊 Ya registré tu pedido:`,
    null,
    detalle,
    null,
    `📍 Dirección: ${pedido.direccion || "pendiente por confirmar"}`,
    `💳 Pago: ${pedido.metodo_pago || "pendiente por confirmar"}`,
    null,
    pedido.total ? `Total: ${formatearMoneda(pedido.total)}` : null,
    null,
    "En un momento te confirmamos el despacho 🚚"
  ].filter((line) => line !== null).join("\n");
}

module.exports = {
  CATALOG_URL,
  enviarMensajeWhatsApp,
  construirRespuestaPedido,
  construirRespuestaCatalogoInicial,
  construirRespuestaCatalogoInformativo,
  construirRespuestaNombreRegistrado,
  construirRespuestaIdentidad,
  construirRespuestaDespedida,
  construirRespuestaConfirmacion,
  construirRespuestaCasual,
  construirLineaCatalogoSugerido
};
