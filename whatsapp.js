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

function getWhatsAppApiConfig() {
  const token = (process.env.WHATSAPP_TOKEN || "").trim();
  const phoneNumberId = (process.env.PHONE_NUMBER_ID || "").trim();

  if (!token || !phoneNumberId) {
    throw new Error("Faltan WHATSAPP_TOKEN o PHONE_NUMBER_ID en .env");
  }

  return {
    token,
    phoneNumberId
  };
}

function inferWhatsAppMediaExtension(mimeType = "") {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("mp4")) return "mp4";
  if (normalized.includes("webm")) return "webm";
  return "bin";
}

async function enviarMensajeWhatsApp(para, texto) {
  const { token, phoneNumberId } = getWhatsAppApiConfig();
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

async function obtenerMediaWhatsApp(mediaId) {
  const { token } = getWhatsAppApiConfig();
  const normalizedMediaId = String(mediaId || "").trim();

  if (!normalizedMediaId) {
    throw new Error("mediaId es obligatorio para descargar media de WhatsApp");
  }

  const metadataUrl = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${normalizedMediaId}`;
  const metadataResponse = await axios.get(metadataUrl, {
    timeout: 30000,
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const mediaUrl = metadataResponse.data?.url;
  const mimeType = metadataResponse.data?.mime_type || metadataResponse.data?.mimeType || "application/octet-stream";

  if (!mediaUrl) {
    throw new Error("WhatsApp no devolvió URL de descarga para el audio");
  }

  const binaryResponse = await axios.get(mediaUrl, {
    timeout: 60000,
    responseType: "arraybuffer",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  return {
    mediaId: normalizedMediaId,
    mimeType,
    sha256: metadataResponse.data?.sha256 || null,
    fileSize: metadataResponse.data?.file_size || null,
    filename: `whatsapp-audio-${normalizedMediaId}.${inferWhatsAppMediaExtension(mimeType)}`,
    buffer: Buffer.from(binaryResponse.data)
  };
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
  if (valor === null || valor === undefined || valor === "") {
    return null;
  }

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

function construirRespuestaCatalogoInicial({ customerName = null, isDistributor = false } = {}) {
  return customerName
    ? (isDistributor
      ? `¡Hola ${customerName}! 😊\nSoy Abi. Si quieres, te muestro precios de distribuidor o te ayudo con tu pedido.`
      : `¡Hola ${customerName}! 😊\nMi nombre es Abi. Estoy pendiente de tu pedido o de cualquier producto que quieras revisar.`)
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

function construirRespuestaCatalogoInformativo({ customerName = null, featuredProducts = [], priceLabel = "público", isDistributor = false } = {}) {
  const saludo = customerName ? `Claro ${customerName} 😊` : "Claro 😊";
  const lines = construirLineasCatalogo(featuredProducts);

  return [
    saludo,
    isDistributor ? `Te muestro precios de ${priceLabel}.` : `Te comparto algunos productos con precio ${priceLabel}.`,
    "En Tellolac manejamos productos lácteos, aloe, café y anchetas.",
    "Algunos productos son:",
    lines.join("\n") || null,
    `También puedes ver el catálogo completo aquí:\n${CATALOG_URL}`,
    "¿Te gustaría pedir alguno?"
  ].filter(Boolean).join("\n\n");
}

function construirRespuestaNombreRegistrado({ customerName, featuredProducts = [], priceLabel = "público", isDistributor = false } = {}) {
  const lines = construirLineasCatalogo(featuredProducts);
  return [
    `Mucho gusto, ${customerName} 😊`,
    isDistributor ? `Te muestro tus precios de ${priceLabel}.` : `Te comparto algunos productos con precio ${priceLabel}.`,
    "En Tellolac manejamos productos lácteos, aloe, café y anchetas.",
    "Algunos productos son:",
    lines.join("\n") || null,
    `Catálogo completo:\n${CATALOG_URL}`,
    "¿Te gustaría pedir alguno?"
  ].filter(Boolean).join("\n\n");
}

function construirRespuestaPreciosInformativo({ customerName = null, featuredProducts = [], queryLabel = "ese producto", priceLabel = "público", isDistributor = false } = {}) {
  const saludo = customerName ? `Claro ${customerName} 😊` : "Claro 😊";
  const lines = construirLineasCatalogo(featuredProducts);
  return [
    saludo,
    isDistributor ? `Estos son los precios de ${priceLabel} que encontré para ${queryLabel}:` : `Estos son los precios que encontré para ${queryLabel}:`,
    lines.join("\n") || null,
    `Catálogo completo:\n${CATALOG_URL}`
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

  const showNumber = Number.isInteger(index) && index >= 0;
  const nombre = option.nombre || option.productoOriginal || (showNumber ? `Opción ${index + 1}` : "Opción sugerida");
  const precio = formatearMoneda(option.precio);
  return `${showNumber ? `${index + 1}. ` : ""}${nombre}${precio ? ` — ${precio}` : ""}`;
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

function construirRespuestaDespedida({ customerName = null } = {}) {
  const nombre = String(customerName || "").trim();
  return nombre
    ? `Con gusto ${nombre} 😊\nQuedamos atentos. ¡Que tengas un excelente día!`
    : "Con gusto 😊\nQuedamos atentos. ¡Que tengas un excelente día!";
}

function construirRespuestaConfirmacion({ hasDraftContext = false, isDistributor = false } = {}) {
  if (hasDraftContext) {
    return isDistributor
      ? pickVariant("draft-distributor", ["Perfecto 😊 Seguimos con tu pedido y te aplico precio distribuidor.", "Listo 😊 Aquí sigo para terminar tu pedido con precio distribuidor."])
      : pickVariant("draft", ["Perfecto 😊 Seguimos con tu pedido cuando quieras.", "Listo 😊 Aquí sigo para terminar tu pedido."]);
  }

  return isDistributor
    ? pickVariant("general-distributor", ["Perfecto 😊 Si quieres te muestro precios de distribuidor o te ayudo a pedir.", "Claro 😊 Te ayudo con productos y precios de distribuidor."])
    : pickVariant("general", ["Perfecto 😊 Cuando quieras te ayudo con productos o pedidos.", "Claro 😊 Si quieres te muestro productos o te ayudo a pedir."]);
}

function construirRespuestaCasual() {
  return pickVariant("casual", [
    "Claro 😊 Puedo ayudarte con catálogo, precios o pedidos.",
    "De una 😊 Si quieres, te muestro productos, precios o armamos el pedido.",
    "Perfecto 😊 Te ayudo con catálogo, precios y pedidos."
  ]);
}

function construirRespuestaCorreccion({ pedido = null } = {}) {
  const detalle = construirDetalleProductosAmable(Array.isArray(pedido?.productos) ? pedido.productos : []);
  return [
    "Tienes razón 😊",
    detalle ? `Por ahora te entendí esto:\n${detalle}` : null,
    "Dime qué ajustamos y lo corrijo."
  ].filter(Boolean).join("\n\n");
}

function construirRespuestaAyudaHumana() {
  return "Claro 😊 Si prefieres atención humana, déjame tu duda o tu pedido y lo dejamos listo para pasarlo al asesor.";
}

function construirUpsellSuave(productos = []) {
  const first = String(productos?.[0]?.producto || "").toLowerCase();

  if (/aloe/.test(first)) {
    return "Si quieres también te dejo la presentación grande 😊";
  }

  if (/ancheta/.test(first)) {
    return "También tengo otra opción de ancheta por si quieres comparar ✨";
  }

  if (/cafe|café/.test(first)) {
    return "Ese sale bastante 😊 Si quieres también te agrego otra unidad.";
  }

  return productos.length === 1 ? "Si quieres también puedo agregarte otra unidad o otra presentación 😊" : null;
}

function construirRespuestaPedido(pedido, evaluacion = { esValido: true, faltantes: [], productosInvalidos: [] }, options = {}) {
  const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
  const detalle = construirDetalleProductosAmable(productos);
  const listaProductosDisponibles = construirListaProductosDisponibles(options.availableProducts);
  const catalogUrl = String(options.catalogUrl || CATALOG_URL || "").trim() || null;
  const nombreCliente = String(pedido?.cliente || "").trim();
  const isDistributor = String(pedido?.customer_type_applied || pedido?.customerTypeApplied || pedido?.price_tier_applied || pedido?.priceTierApplied || "public").trim().toLowerCase() === "distributor";

  if (evaluacion.modelError) {
    return "Se me cruzó el mensaje un momento 😕 ¿me lo puedes reenviar?";
  }

  if (evaluacion.catalogStatus === "not_found") {
    if (productos.length) {
      return [
        construirSaludoNatural(nombreCliente),
        "Te entendí esto por ahora:",
        detalle,
        pedido.total ? `Subtotal parcial: ${formatearMoneda(pedido.total)}` : null,
        "Pero me falta confirmar otro producto para dejarte el pedido bien 😊",
        listaProductosDisponibles,
        catalogUrl ? `Catálogo completo:\n${catalogUrl}` : null,
        "¿Me lo escribes como aparece en el catálogo o me dices cuál producto exacto quieres?"
      ].filter(Boolean).join("\n\n");
    }

    return [
      "No encontré ese producto en el catálogo actual 😊",
      catalogUrl ? `Revísalo aquí:\n${catalogUrl}` : null,
      "Si quieres, escríbeme el nombre exacto y te ayudo a pedirlo."
    ].filter(Boolean).join("\n\n");
  }

  if (evaluacion.priceValidation === "missing_price") {
    if (productos.length) {
      return [
        construirSaludoNatural(nombreCliente),
        "Te entendí este pedido:",
        detalle,
        "¿Me compartes la dirección y el método de pago para dejarlo listo?"
      ].filter(Boolean).join("\n\n");
    }

    return "No alcancé a confirmar el precio exacto. ¿Me lo envías como aparece en el catálogo para dejarlo bien?";
  }

  if (evaluacion.catalogStatus === "ambiguous") {
    const firstAmbiguity = (evaluacion.ambiguousProducts || [])[0] || null;
    const titulo = construirTituloAmbiguo(firstAmbiguity?.input);
    const ambiguityOptions = (firstAmbiguity?.options || []).slice(0, 4);
    const ambiguityLines = ambiguityOptions
      .map((option, index) => construirLineaOpcionAmbigua(option, ambiguityOptions.length === 1 ? -1 : index))
      .filter(Boolean)
      .join("\n");
    const optionNumbers = ambiguityOptions.map((_, index) => index + 1).join(" o ");

    if (productos.length) {
      return [
        construirSaludoNatural(nombreCliente),
        "Te entendí esto:",
        detalle,
        pedido.total ? `Subtotal parcial: ${formatearMoneda(pedido.total)}` : null,
        firstAmbiguity?.soft && ambiguityOptions.length === 1
          ? `Sobre “${titulo}” quiero confirmar algo 😊`
          : `Para dejarlo perfecto, ayúdame con este punto 😊`,
        firstAmbiguity?.soft && ambiguityOptions.length === 1
          ? `¿Te refieres a:\n${ambiguityLines}`
          : ambiguityLines,
        evaluacion.faltantes?.includes("direccion") ? "Y también me compartes la dirección para enviarte el pedido ✨" : null,
        !firstAmbiguity?.soft || ambiguityOptions.length > 1 ? `Puedes responder ${optionNumbers}.` : null
      ].filter(Boolean).join("\n\n");
    }

    return [
      firstAmbiguity?.soft && ambiguityOptions.length === 1
        ? `Sobre “${titulo}” quiero confirmar algo 😊`
        : `Quiero confirmar este producto contigo 😊`,
      firstAmbiguity?.soft && ambiguityOptions.length === 1
        ? `¿Te refieres a:\n${ambiguityLines}`
        : ambiguityLines,
      !firstAmbiguity?.soft || ambiguityOptions.length > 1 ? `Puedes responder ${optionNumbers}.` : null
    ].filter(Boolean).join("\n\n");
  }

  if (!evaluacion.esValido) {
    if (evaluacion.addressStatus === "partial" && productos.length) {
      return [
        construirSaludoNatural(nombreCliente),
        detalle,
        pedido.total ? `Subtotal: ${formatearMoneda(pedido.total)}` : null,
        `Tengo esta dirección: ${pedido.direccion}`,
        "Perfecto 😊 ¿me confirmas el número de casa o una referencia?"
      ].filter(Boolean).join("\n\n");
    }

    if (evaluacion.faltantes?.includes("direccion") && productos.length) {
      return [
        construirSaludoNatural(nombreCliente),
        productos.length > 1 ? "Te dejo esto por ahora:" : null,
        detalle,
        pedido.total ? `Subtotal: ${formatearMoneda(pedido.total)}` : null,
        construirUpsellSuave(productos),
        "Perfecto 😊 ¿A qué dirección te lo enviamos?",
        "Ejemplo: Calle 10 #20-30, Barrio Centro"
      ].filter(Boolean).join("\n\n");
    }

    if (evaluacion.faltantes?.includes("metodo_pago") && productos.length && !evaluacion.faltantes?.includes("direccion")) {
      return [
        construirSaludoNatural(nombreCliente),
        detalle,
        pedido.total ? `Subtotal: ${formatearMoneda(pedido.total)}` : null,
        construirUpsellSuave(productos),
        "Listo, ¿pagas por Nequi, efectivo o transferencia?"
      ].filter(Boolean).join("\n\n");
    }

    if (evaluacion.faltantes?.includes("productos")) {
      return "Claro 😊 ¿Qué producto deseas pedir?";
    }

    const faltantes = evaluacion.faltantes.map(formatearFaltante).join(", ");

    return [
      construirSaludoNatural(nombreCliente),
      detalle,
      pedido.metodo_pago ? `💳 Pago: ${pedido.metodo_pago}` : null,
      pedido.direccion ? `📍 Dirección: ${pedido.direccion}` : null,
      `Falta confirmar: ${faltantes}.`
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
    isDistributor ? "Te aplico precio distribuidor." : null,
    pedido.total ? `Total: ${formatearMoneda(pedido.total)}` : null,
    null,
    pickVariant(`${nombreCliente}-${pedido.total}`, ["En un momento te confirmamos el despacho 🚚", "Ya te dejamos esto en curso 🚚", "Te confirmamos el despacho en un momento 🚚"]),
    construirUpsellSuave(productos)
  ].filter((line) => line !== null).join("\n");
}

module.exports = {
  CATALOG_URL,
  enviarMensajeWhatsApp,
  obtenerMediaWhatsApp,
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
  construirLineaCatalogoSugerido
};
