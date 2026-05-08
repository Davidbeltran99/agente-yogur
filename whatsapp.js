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

function formatearMoneda(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) {
    return null;
  }

  return `$${Math.round(numero).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

function pickVariant(seed, variants = []) {
  if (!variants.length) {
    return "";
  }

  const source = String(seed || "abi");
  const hash = Array.from(source).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return variants[hash % variants.length];
}

function construirSaludoNatural(nombreCliente = "") {
  const normalized = String(nombreCliente || "").trim();
  return normalized
    ? pickVariant(normalized, [`Perfecto ${normalized} 😊`, `Claro ${normalized} 😊`, `Listo ${normalized} 😊`])
    : pickVariant("sin-nombre", ["Perfecto 😊", "Claro 😊", "Listo 😊"]);
}

function construirRespuestaCatalogoInicial({ customerName = null } = {}) {
  return customerName
    ? `¡Hola ${customerName}! 😊\nMi nombre es Abi. Estoy pendiente de tu pedido o de cualquier producto que quieras revisar.`
    : "Hola 😊\nMi nombre es Abi, la asistente virtual de Tellolac.\nSi quieres, te ayudo con productos, precios y pedidos.\n\n¿Me compartes tu nombre para atenderte mejor?";
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
  const saludo = construirSaludoNatural(customerName);
  const lines = construirLineasCatalogo(featuredProducts);

  return [
    saludo,
    "Estos son algunos de los productos que más nos piden:",
    lines.join("\n") || null,
    `También puedes ver el catálogo completo aquí:\n${CATALOG_URL}`,
    "¿Te gustaría pedir alguno? ✨"
  ].filter(Boolean).join("\n\n");
}

function construirRespuestaNombreRegistrado({ customerName, featuredProducts = [] } = {}) {
  const lines = construirLineasCatalogo(featuredProducts);
  return [
    `Mucho gusto, ${customerName} 😊`,
    "Te dejo una muestra rápida de nuestro portafolio:",
    lines.join("\n") || null,
    `Catálogo completo:\n${CATALOG_URL}`,
    "Cuando quieras pedir, solo dime el producto y yo te voy guiando ✨"
  ].filter(Boolean).join("\n\n");
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
  return "Soy Abi 😊, la asistente virtual de Tellolac. Mi nombre es Abi y te ayudo con productos, precios y pedidos.";
}

function construirRespuestaDespedida() {
  return "Con gusto 😊\nQuedo atenta por aquí si quieres pedir algo más. ✨";
}

function construirRespuestaConfirmacion({ hasDraftContext = false } = {}) {
  return hasDraftContext
    ? pickVariant("draft", ["Perfecto 😊 Seguimos con tu pedido cuando quieras.", "Listo 😊 Aquí sigo para terminar tu pedido."])
    : pickVariant("general", ["Perfecto 😊 Cuando quieras te ayudo con productos o pedidos.", "Claro 😊 Si quieres te muestro productos o te ayudo a pedir."]);
}

function construirRespuestaCasual() {
  return pickVariant("casual", [
    "Claro 😊 Estoy aquí para ayudarte con productos, precios o pedidos.",
    "Sí 😊 Cuéntame qué necesitas y lo revisamos juntas/os.",
    "De una 😊 Si quieres, vemos productos o te ayudo a armar el pedido.",
    "Perfecto 😊 Dime qué te provoca y te voy guiando."
  ]);
}

function construirRespuestaPedido(pedido, evaluacion = { esValido: true, faltantes: [], productosInvalidos: [] }, options = {}) {
  const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
  const detalle = construirDetalleProductosAmable(productos);
  const listaProductosDisponibles = construirListaProductosDisponibles(options.availableProducts);
  const nombreCliente = String(pedido?.cliente || "").trim();

  if (evaluacion.modelError) {
    return "Se me cruzó el mensaje un momento 😕 ¿me lo puedes reenviar?";
  }

  if (evaluacion.priceValidation === "missing_price") {
    return "No alcancé a confirmar el precio exacto. ¿Me lo envías como aparece en el catálogo para dejarlo bien?";
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
    const ambiguityOptions = (firstAmbiguity?.options || []).slice(0, 4);
    const ambiguityLines = ambiguityOptions
      .map((option, index) => construirLineaOpcionAmbigua(option, index))
      .filter(Boolean)
      .join("\n");
    const optionNumbers = ambiguityOptions.map((_, index) => index + 1).join(" o ");

    return [
      pickVariant(titulo, [
        `😊 Creo que te refieres a alguno de estos productos para “${titulo}”:`,
        `😊 Puede que estés buscando alguno de estos productos para “${titulo}”:`,
        `😊 Te encontré estas opciones parecidas para “${titulo}”:`
      ]),
      ambiguityLines || null,
      `¿Cuál deseas pedir? Puedes responder ${optionNumbers}.`
    ].filter(Boolean).join("\n\n");
  }

  if (!evaluacion.esValido) {
    if (evaluacion.faltantes?.includes("direccion") && productos.length) {
      return [
        construirSaludoNatural(nombreCliente),
        productos.length > 1 ? "Te agrego:" : null,
        detalle,
        pedido.total ? `Subtotal: ${formatearMoneda(pedido.total)}` : null,
        pickVariant(`${nombreCliente}-${productos[0]?.producto || "direccion"}-${productos.length}`, [
          "¿A qué dirección te enviamos el pedido?",
          "Perfecto, ya tengo el pedido ✨ Ahora pásame la dirección para el envío.",
          "Súper 😊 Solo me falta la dirección para dejarlo listo."
        ]),
        "Ejemplo: Calle 10 #20-30, Barrio Centro"
      ].filter(Boolean).join("\n\n");
    }

    if (evaluacion.faltantes?.includes("metodo_pago") && productos.length) {
      return [
        construirSaludoNatural(nombreCliente),
        detalle,
        pickVariant(`${nombreCliente}-${pedido.total || "pago"}`, [
          "¿Cómo prefieres pagar: efectivo o transferencia?",
          "¿Te queda mejor pagar en efectivo o por transferencia?",
          "Cuéntame el método de pago y te lo dejo listo 😊"
        ])
      ].filter(Boolean).join("\n\n");
    }

    const faltantes = evaluacion.faltantes.map(formatearFaltante).join(", ");

    return [
      construirSaludoNatural(nombreCliente),
      detalle,
      pedido.metodo_pago ? `💳 Pago: ${pedido.metodo_pago}` : null,
      pedido.direccion ? `📍 Dirección: ${pedido.direccion}` : null,
      pickVariant(`${nombreCliente}-${faltantes}`, [
        `Para dejarlo listo solo me falta: ${faltantes}.`,
        `Voy bien 😊 Solo necesito esto para terminarlo: ${faltantes}.`,
        `Ya casi queda. Solo confírmame: ${faltantes}.`
      ])
    ].filter(Boolean).join("\n");
  }

  return [
    pickVariant(`${nombreCliente}-${pedido.total || "pedido"}`, [
      `${construirSaludoNatural(nombreCliente)} Ya te dejé el pedido registrado:`,
      `${construirSaludoNatural(nombreCliente)} Tu pedido quedó listo en sistema:`,
      `${construirSaludoNatural(nombreCliente)} Ya registré tu pedido:`
    ]),
    null,
    detalle,
    null,
    `📍 Dirección: ${pedido.direccion || "pendiente por confirmar"}`,
    `💳 Pago: ${pedido.metodo_pago || "pendiente por confirmar"}`,
    null,
    pedido.total ? `Total: ${formatearMoneda(pedido.total)}` : null,
    null,
    pickVariant(`${nombreCliente}-${pedido.total}`, ["En un momento te confirmamos el despacho 🚚", "Ya te dejamos esto en curso 🚚", "Te confirmamos el despacho en un momento 🚚"])
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
