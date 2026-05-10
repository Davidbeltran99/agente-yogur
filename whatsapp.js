const axios = require("axios");
const { structuredLog } = require("./logger");

const APP_BASE_URL = String(
  process.env.CATALOG_BASE_URL
  || process.env.APP_BASE_URL
  || process.env.PUBLIC_BASE_URL
  || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "")
  || "https://agente-yogur-production.up.railway.app"
).trim().replace(/\/$/, "");
const CATALOG_URL = `${APP_BASE_URL}/catalogo`;
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
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("pdf")) return "pdf";
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

async function subirMediaWhatsApp({ buffer, mimeType = "application/octet-stream", filename = "media.bin" }) {
  const { token, phoneNumberId } = getWhatsAppApiConfig();
  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/media`;

  if (!buffer?.length) {
    throw new Error("Buffer obligatorio para subir media a WhatsApp");
  }

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", new Blob([buffer], { type: mimeType }), filename);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: form,
    signal: AbortSignal.timeout(60000)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.error || `WhatsApp media upload error ${response.status}`);
  }

  return {
    id: data?.id || null,
    phoneNumberId,
    filename,
    mimeType
  };
}

async function enviarAudioWhatsApp(para, { buffer, mimeType = "audio/mpeg", filename = "abi.mp3" } = {}) {
  const { token, phoneNumberId } = getWhatsAppApiConfig();
  const destino = normalizarDestinoWhatsApp(para);
  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;
  const uploaded = await subirMediaWhatsApp({ buffer, mimeType, filename });
  const payload = {
    messaging_product: "whatsapp",
    to: destino,
    type: "audio",
    audio: {
      id: uploaded.id
    }
  };

  logWhatsAppEvent("whatsapp_audio_send_payload_ready", {
    url,
    phoneNumberId,
    to: destino,
    mediaId: uploaded.id,
    mimeType,
    filename
  });

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    return {
      ...response.data,
      uploadedMediaId: uploaded.id,
      uploadedMimeType: mimeType,
      uploadedFilename: filename
    };
  } catch (error) {
    logWhatsAppEvent("whatsapp_audio_request_failed", {
      status: error.response?.status || null,
      data: error.response?.data || null,
      phoneNumberId,
      to: destino,
      url,
      mediaId: uploaded.id,
      mimeType,
      filename
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
    throw new Error("WhatsApp no devolvió URL de descarga para la media");
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
    filename: `whatsapp-media-${normalizedMediaId}.${inferWhatsAppMediaExtension(mimeType)}`,
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
  return `Aquí también puedes hacer tu pedido por catálogo:\n${CATALOG_URL}`;
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

function inferirSegmentoConversacional({ variantSeed = "", isDistributor = false } = {}) {
  const seed = String(variantSeed || "").toLowerCase();
  if (isDistributor || /\b(distribuidor|negocio|tienda|surtir|revender|por mayor|mayorista)\b/.test(seed)) {
    return isDistributor ? "distributor" : "store";
  }

  if (/\b(senor|señor|senora|señora|cordial|por favor|buenas tardes|buenas noches|usted)\b/.test(seed)) {
    return "formal";
  }

  if (/\b(veci|amiga|mi amor|reina|hola abi|alo|hey)\b/.test(seed)) {
    return "barrio";
  }

  return "general";
}

function construirSaludoNatural(nombreCliente = "") {
  const normalized = String(nombreCliente || "").trim();
  return normalized
    ? pickVariant(normalized, [`Perfecto ${normalized} 😊`, `Claro ${normalized} 😊`, `Listo ${normalized} 😊`])
    : pickVariant("sin-nombre", ["Perfecto 😊", "Claro 😊", "Listo 😊"]);
}

function construirPromptDireccion(nombreCliente = "") {
  const saludo = construirSaludoNatural(nombreCliente);
  return pickVariant(`direccion-${String(nombreCliente || "sin-nombre").trim().toLowerCase()}`, [
    `${saludo} ¿A qué dirección te lo enviamos?`,
    `${saludo} ¿Me compartes la dirección de entrega?`,
    `${saludo} ¿Cuál es la dirección de entrega?`
  ]);
}

function construirPromptDireccionParcial(nombreCliente = "") {
  const saludo = construirSaludoNatural(nombreCliente);
  return pickVariant(`direccion-parcial-${String(nombreCliente || "sin-nombre").trim().toLowerCase()}`, [
    `${saludo} ¿me confirmas el número de casa o una referencia?`,
    `${saludo} ¿me regalas el número de casa o una referencia?`,
    `${saludo} ¿qué número de casa o referencia le agregamos para ubicarte mejor?`
  ]);
}

function construirPromptMetodoPago(nombreCliente = "") {
  const saludo = construirSaludoNatural(nombreCliente);
  return pickVariant(`pago-${String(nombreCliente || "sin-nombre").trim().toLowerCase()}`, [
    `${saludo} ¿pagas por Nequi, efectivo o transferencia?`,
    `${saludo} ¿pagas por Nequi, efectivo o transferencia?`,
    `${saludo} ¿me confirmas si pagas por Nequi, efectivo o transferencia?`
  ]);
}

function construirRespuestaCatalogoInicial({ customerName = null, isDistributor = false, variantSeed = "catalogo-inicial" } = {}) {
  const segmento = inferirSegmentoConversacional({ variantSeed, isDistributor });
  if (customerName) {
    if (isDistributor) {
      return pickVariant(`${variantSeed}-${customerName}-dist`, [
        `¡Hola ${customerName}! 😊\nSoy Abi. Si quieres, te muestro tus precios de distribuidor o te ayudo con el pedido.`,
        `Hola ${customerName} 😊\nSoy Abi. Te apoyo con precios de distribuidor, productos y pedidos.`,
        `Qué bueno tenerte por aquí, ${customerName} 😊\nSi quieres, revisamos precios de distribuidor o armamos el pedido de una.`
      ]);
    }

    if (segmento === "barrio") {
      return pickVariant(`${variantSeed}-${customerName}-barrio`, [
        `¡Hola ${customerName}! 😊\nSoy Abi. Dime qué quieres pedir y te lo dejo armado de una.`,
        `Hola ${customerName} 😊\nEstoy pendiente por aquí. Si quieres catálogo, precios o pedido, te ayudo.`,
        `Qué más ${customerName} 😊\nCuéntame qué quieres llevar y te colaboro.`
      ]);
    }

    if (segmento === "formal") {
      return pickVariant(`${variantSeed}-${customerName}-formal`, [
        `Hola ${customerName} 😊\nSoy Abi. Con gusto le ayudo con productos, precios y pedidos.`,
        `Bienvenido, ${customerName} 😊\nEstoy pendiente para ayudarle con su pedido o con cualquier producto que quiera revisar.`,
        `Hola ${customerName} 😊\nCon mucho gusto le comparto catálogo, precios o le ayudo a dejar el pedido listo.`
      ]);
    }

    return pickVariant(`${variantSeed}-${customerName}-pub`, [
      `¡Hola ${customerName}! 😊\nMi nombre es Abi. Estoy pendiente de tu pedido o de cualquier producto que quieras revisar.`,
      `Hola ${customerName} 😊\nSoy Abi. Te ayudo con productos, precios y pedidos de Tellolac.`,
      `¡Hola ${customerName}! 😊\nCuéntame qué quieres pedir o qué producto quieres revisar y te ayudo.`
    ]);
  }

  return segmento === "formal"
    ? pickVariant(`${variantSeed}-sin-nombre-formal`, [
        "Hola 😊\nSoy Abi, de Tellolac. Con gusto le ayudo con catálogo, precios y pedidos.\n\n¿Me comparte su nombre para atenderle mejor?",
        "Bienvenido 😊\nLe atiende Abi. Puedo ayudarle con productos, precios y pedidos.\n\n¿Con qué nombre le atiendo?"
      ])
    : pickVariant(`${variantSeed}-sin-nombre`, [
        "Hola 😊\nMi nombre es Abi, la asistente virtual de Tellolac.\nSi quieres, te ayudo con productos, precios y pedidos.\n\n¿Me compartes tu nombre para atenderte mejor?",
        "Hola 😊\nSoy Abi, de Tellolac.\nPuedo ayudarte con catálogo, precios y pedidos.\n\n¿Con qué nombre te atiendo?",
        "Hola 😊\nTe atiende Abi.\nSi quieres, vemos productos, precios o dejamos tu pedido listo.\n\n¿Cómo te llamas?"
      ]);
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

function construirEjemplosPedidoBase() {
  return [
    "• 2 Aloe grandes",
    "• 1 Griego pequeño",
    "• 3 Café litro"
  ].join("\n");
}

function construirRespuestaGuiaPedido({ customerName = null, short = false } = {}) {
  const saludo = customerName ? `Claro ${customerName} 😊` : "Claro 😊";

  if (short) {
    return [
      saludo,
      "Puedes pedirme con producto + cantidad.",
      "Ejemplo: • 2 Aloe grandes\n• 1 Griego pequeño"
    ].join("\n\n");
  }

  return [
    saludo,
    "Puedes pedirme así:",
    construirEjemplosPedidoBase(),
    "Y si ya sabes la dirección y el pago, puedes escribirlo todo junto:",
    "“Quiero 2 Aloe grandes para la calle 10, pago Nequi”"
  ].join("\n\n");
}

function construirAyudaPedidoPuntual({ title = "ese producto", options = [] } = {}) {
  const normalizedTitle = String(title || "").trim().toLowerCase();

  if (/griego/.test(normalizedTitle)) {
    return "Puedes decirme: “quiero 2 griegos grandes” o “1 griego pequeño”.";
  }

  if (/cafe|café/.test(normalizedTitle)) {
    return "Puedes decirme: “1 café grande” o “2 café litro”.";
  }

  if (/aloe/.test(normalizedTitle)) {
    return "Puedes decirme: “2 aloe grandes” o “1 aloe litro”.";
  }

  if (/ancheta|regalo|detalle/.test(normalizedTitle)) {
    return "Puedes decirme: “1 ancheta barata” o “1 ancheta premium”.";
  }

  const first = options[0]?.nombre || options[0]?.productoOriginal || "1 unidad";
  const second = options[1]?.nombre || options[1]?.productoOriginal || null;
  return second
    ? `Puedes decirme: “1 ${first}” o “2 ${second}”.`
    : `Puedes decirme: “1 ${first}”.`;
}

function construirRespuestaCatalogoInformativo({ customerName = null, featuredProducts = [], priceLabel = "público", isDistributor = false, guideMode = "mini", variantSeed = "catalogo-info" } = {}) {
  const segmento = inferirSegmentoConversacional({ variantSeed, isDistributor });
  const saludo = customerName
    ? pickVariant(`${variantSeed}-${customerName}`, segmento === "formal"
      ? [`Claro ${customerName} 😊`, `Con gusto ${customerName} 😊`, `Perfecto ${customerName} 😊`]
      : [`Claro ${customerName} 😊`, `Listo ${customerName} 😊`, `Perfecto ${customerName} 😊`])
    : pickVariant(`${variantSeed}-sin-nombre`, segmento === "formal" ? ["Con gusto 😊", "Claro 😊", "Perfecto 😊"] : ["Claro 😊", "Listo 😊", "Perfecto 😊"]);
  const lines = construirLineasCatalogo(featuredProducts);
  const guide = guideMode === "full"
    ? [
        "Puedes pedirme así:",
        construirEjemplosPedidoBase(),
        "Si ya tienes dirección y pago, puedes escribirlo todo junto: “Quiero 2 Aloe grandes para la calle 10, pago Nequi”."
      ].join("\n")
    : (guideMode === "mini"
      ? "Puedes decirme, por ejemplo: “2 Aloe grandes” o “1 Griego pequeño”."
      : null);

  return [
    saludo,
    isDistributor ? `Te muestro precios de ${priceLabel}.` : `Te comparto algunos productos con precio ${priceLabel}.`,
    segmento === "store" ? "Estas opciones te pueden servir para surtir:" : "Algunos productos son:",
    lines.join("\n") || null,
    guide,
    `Aquí también puedes hacer tu pedido por catálogo:\n${CATALOG_URL}`,
    segmento === "formal"
      ? "Si quiere, se lo dejo armado de una. ¿Cuál le gustaría pedir?"
      : "Si quieres, te lo dejo armado de una. ¿Cuál te gustaría pedir?"
  ].filter(Boolean).join("\n\n");
}

function construirRespuestaNombreRegistrado({ customerName, featuredProducts = [], priceLabel = "público", isDistributor = false, variantSeed = "nombre-registrado" } = {}) {
  const segmento = inferirSegmentoConversacional({ variantSeed, isDistributor });
  const lines = construirLineasCatalogo(featuredProducts);
  return [
    pickVariant(`${variantSeed}-${customerName}`, segmento === "formal"
      ? [`Mucho gusto, ${customerName} 😊`, `Con gusto, ${customerName} 😊`, `Perfecto, ${customerName} 😊`]
      : [`Mucho gusto, ${customerName} 😊`, `Encantada, ${customerName} 😊`, `Perfecto, ${customerName} 😊`]),
    isDistributor ? `Te muestro tus precios de ${priceLabel}.` : `Te comparto algunos productos con precio ${priceLabel}.`,
    segmento === "store" ? "Manejamos productos que te pueden servir para surtir o vender." : "En Tellolac manejamos productos lácteos, aloe, café y anchetas.",
    "Algunos productos son:",
    lines.join("\n") || null,
    `Aquí también puedes hacer tu pedido por catálogo:\n${CATALOG_URL}`,
    segmento === "formal"
      ? "Si quiere, le dejo el pedido armado de una. ¿Le gustaría pedir alguno?"
      : "Si quieres, te dejo el pedido armado de una. ¿Te gustaría pedir alguno?"
  ].filter(Boolean).join("\n\n");
}

function construirRespuestaPreciosInformativo({ customerName = null, featuredProducts = [], queryLabel = "ese producto", priceLabel = "público", isDistributor = false, variantSeed = "precios-info" } = {}) {
  const segmento = inferirSegmentoConversacional({ variantSeed, isDistributor });
  const saludo = customerName
    ? pickVariant(`${variantSeed}-${customerName}`, segmento === "formal"
      ? [`Claro ${customerName} 😊`, `Con gusto ${customerName} 😊`, `Perfecto ${customerName} 😊`]
      : [`Claro ${customerName} 😊`, `Listo ${customerName} 😊`, `Perfecto ${customerName} 😊`])
    : pickVariant(`${variantSeed}-sin-nombre`, segmento === "formal" ? ["Con gusto 😊", "Claro 😊", "Perfecto 😊"] : ["Claro 😊", "Listo 😊", "Perfecto 😊"]);
  const lines = construirLineasCatalogo(featuredProducts);
  return [
    saludo,
    `Estos son los precios de ${priceLabel} que encontré para ${queryLabel}:`,
    lines.join("\n") || null,
    segmento === "formal"
      ? "Si quiere, se lo dejo agregado de una con la cantidad que necesite."
      : "Si quieres, te lo dejo agregado de una con la cantidad que necesites.",
    `Aquí también puedes hacer tu pedido por catálogo:\n${CATALOG_URL}`
  ].filter(Boolean).join("\n\n");
}

function construirRespuestaPrecioDistribuidorRestringido({ customerName = null, featuredProducts = [], queryLabel = "ese producto", variantSeed = "precio-distribuidor-restringido" } = {}) {
  const saludo = customerName
    ? pickVariant(`${variantSeed}-${customerName}`, [`Claro ${customerName} 😊`, `Listo ${customerName} 😊`, `Perfecto ${customerName} 😊`])
    : pickVariant(`${variantSeed}-sin-nombre`, ["Claro 😊", "Listo 😊", "Perfecto 😊"]);
  const lines = construirLineasCatalogo(featuredProducts);
  return [
    saludo,
    "Los precios de distribuidor los compartimos solo a clientes registrados.",
    lines.length ? `Mientras tanto te dejo precio público para ${queryLabel}:` : "Si quieres, te comparto precio público o te ayudo a dejar el pedido listo.",
    lines.join("\n") || null,
    "Si quieres, también te lo cotizo con precio público y te dejo el pedido armado.",
    "Si ya estás registrado con otro número, me lo indicas y lo revisamos.",
    `Aquí también puedes hacer tu pedido por catálogo:\n${CATALOG_URL}`
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

function construirTextoPersonalizacion(customizations = []) {
  const items = Array.isArray(customizations) ? customizations.filter((item) => item?.text) : [];
  if (!items.length) {
    return "";
  }

  if (items.length === 1) {
    return items[0].text;
  }

  if (items.length === 2) {
    return `${items[0].text} y ${items[1].text}`;
  }

  return `${items.slice(0, -1).map((item) => item.text).join(", ")} y ${items[items.length - 1].text}`;
}

function construirDetalleProductosAmable(productos = []) {
  if (!productos.length) {
    return null;
  }

  return productos.map((p) => {
    const cantidad = p.cantidad || "?";
    const nombre = [p.producto || "producto", p.sabor || null].filter(Boolean).join(" ");
    const subtotal = formatearMoneda(p.subtotal);
    const personalizacion = construirTextoPersonalizacion(p.customizations);
    const notes = p.product_notes || p.productNotes || null;
    return [
      `• ${cantidad} ${nombre}${subtotal ? ` — ${subtotal}` : ""}`,
      notes ? `  Nota: ${notes}` : (personalizacion ? `  Nota: ${personalizacion}` : null)
    ].filter(Boolean).join("\n");
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

function construirRespuestaDespedida({ customerName = null, variantSeed = "despedida" } = {}) {
  const nombre = String(customerName || "").trim();
  const segmento = inferirSegmentoConversacional({ variantSeed });
  return nombre
    ? pickVariant(`${variantSeed}-${nombre}`, segmento === "formal"
      ? [
          `Con gusto ${nombre} 😊\nQuedamos atentos. Que tenga un excelente día.`,
          `Listo ${nombre} 😊\nQuedamos pendientes. Que le vaya muy bien.`,
          `Perfecto ${nombre} 😊\nAquí quedamos atentos. Feliz día.`
        ]
      : [
          `Con gusto ${nombre} 😊\nQuedamos atentos. ¡Que tengas un excelente día!`,
          `Listo ${nombre} 😊\nQuedamos pendientes. Que te vaya súper bien.`,
          `Perfecto ${nombre} 😊\nAquí quedamos atentos. Que tengas un lindo día.`
        ])
    : pickVariant(`${variantSeed}-sin-nombre`, segmento === "formal"
      ? [
          "Con gusto 😊\nQuedamos atentos. Que tenga un excelente día.",
          "Listo 😊\nQuedamos pendientes. Que le vaya muy bien.",
          "Perfecto 😊\nAquí quedamos atentos. Feliz día."
        ]
      : [
          "Con gusto 😊\nQuedamos atentos. ¡Que tengas un excelente día!",
          "Listo 😊\nQuedamos pendientes. Que te vaya muy bien.",
          "Perfecto 😊\nAquí quedamos atentos. Que tengas un lindo día."
        ]);
}

function construirRespuestaConfirmacion({ hasDraftContext = false, isDistributor = false, variantSeed = "confirmacion" } = {}) {
  if (hasDraftContext) {
    return isDistributor
      ? pickVariant(`${variantSeed}-draft-distributor`, ["Perfecto 😊 Seguimos con tu pedido y te aplico precio distribuidor.", "Listo 😊 Aquí sigo para terminar tu pedido con precio distribuidor.", "De una 😊 Continuamos con tu pedido y te dejo precio distribuidor."])
      : pickVariant(`${variantSeed}-draft`, ["Perfecto 😊 Seguimos con tu pedido cuando quieras.", "Listo 😊 Aquí sigo para terminar tu pedido.", "De una 😊 Continuamos con tu pedido cuando quieras."]);
  }

  return isDistributor
    ? pickVariant(`${variantSeed}-general-distributor`, ["Perfecto 😊 Si quieres te muestro precios de distribuidor o te ayudo a pedir.", "Claro 😊 Te ayudo con productos y precios de distribuidor.", "Listo 😊 Si quieres revisamos precios de distribuidor o armamos tu pedido."])
    : pickVariant(`${variantSeed}-general`, ["Perfecto 😊 Cuando quieras te ayudo con productos o pedidos.", "Claro 😊 Si quieres te muestro productos o te ayudo a pedir.", "Listo 😊 Si quieres vemos precios, productos o armamos tu pedido."]);
}

function construirRespuestaCasual({ variantSeed = "casual" } = {}) {
  const segmento = inferirSegmentoConversacional({ variantSeed });
  if (segmento === "formal") {
    return pickVariant(variantSeed, [
      "Claro 😊 Puedo ayudarle con catálogo, precios o pedidos.",
      "Con gusto 😊 Si quiere, le muestro productos, precios o le ayudo a armar el pedido.",
      "Perfecto 😊 Le ayudo con catálogo, precios y pedidos."
    ]);
  }

  if (segmento === "barrio") {
    return pickVariant(variantSeed, [
      "Claro 😊 Te ayudo con catálogo, precios o pedidos.",
      "De una 😊 Si quieres, te muestro productos, precios o armamos el pedido.",
      "Listo 😊 Dime qué quieres y te colaboro."
    ]);
  }

  return pickVariant(variantSeed, [
    "Claro 😊 Puedo ayudarte con catálogo, precios o pedidos.",
    "De una 😊 Si quieres, te muestro productos, precios o armamos el pedido.",
    "Perfecto 😊 Te ayudo con catálogo, precios y pedidos.",
    "Listo 😊 Dime si quieres catálogo, precios o dejar un pedido armado."
  ]);
}

function construirRespuestaCorreccion({ pedido = null, variantSeed = "correccion" } = {}) {
  const detalle = construirDetalleProductosAmable(Array.isArray(pedido?.productos) ? pedido.productos : []);
  return [
    pickVariant(variantSeed, ["Tienes razón 😊", "Sí, tienes toda la razón 😊", "De una, corrijámoslo 😊"]),
    detalle ? `Por ahora te entendí esto:\n${detalle}` : null,
    "Dime qué ajustamos y lo corrijo de una."
  ].filter(Boolean).join("\n\n");
}

function construirRespuestaAyudaHumana({ variantSeed = "ayuda-humana" } = {}) {
  const segmento = inferirSegmentoConversacional({ variantSeed });
  return pickVariant(variantSeed, segmento === "formal"
    ? [
        "Claro 😊 Si prefiere atención humana, déjeme su duda o su pedido y lo dejamos listo para pasarlo al asesor.",
        "Con gusto 😊 Si quiere apoyo de un asesor, me deja el detalle y lo escalamos."
      ]
    : [
        "Claro 😊 Si prefieres atención humana, déjame tu duda o tu pedido y lo dejamos listo para pasarlo al asesor.",
        "De una 😊 Si quieres apoyo de un asesor, me dejas tu duda o tu pedido y lo escalamos.",
        "Listo 😊 Si prefieres que lo vea una persona, déjame el detalle y lo pasamos al asesor."
      ]);
}

function construirUpsellSuave(productos = []) {
  const first = String(productos?.[0]?.producto || "").toLowerCase();
  const hasMultiple = Array.isArray(productos) && productos.length > 1;

  if (hasMultiple) {
    return pickVariant(`upsell-multi-${first}`, [
      "Si quieres, también te sumo otra unidad o algo más del catálogo 😊",
      "Si te hace falta algo más, te lo agrego de una al pedido 😊"
    ]);
  }

  if (/aloe/.test(first)) {
    return pickVariant(`upsell-aloe-${first}`, [
      "Si quieres, también te dejo la presentación grande 😊",
      "Si quieres rendir más el pedido, también te puedo dejar la garrafa 😊"
    ]);
  }

  if (/griego/.test(first)) {
    return pickVariant(`upsell-griego-${first}`, [
      "Si quieres, también te lo dejo con fruta o en otra presentación 😊",
      "Si quieres, también te agrego otra presentación de griego para que compares 😊"
    ]);
  }

  if (/yogur|yogurt|kumis|kefir/.test(first)) {
    return pickVariant(`upsell-lacteo-${first}`, [
      "Si quieres, también te agrego otra unidad o otra presentación 😊",
      "Si quieres, te puedo sumar otro lácteo para aprovechar el envío 😊"
    ]);
  }

  if (/ancheta/.test(first)) {
    return pickVariant(`upsell-ancheta-${first}`, [
      "También tengo otra opción de ancheta por si quieres comparar ✨",
      "Si quieres, te muestro otra ancheta un poquito más completa ✨"
    ]);
  }

  if (/cafe|café/.test(first)) {
    return pickVariant(`upsell-cafe-${first}`, [
      "Ese sale bastante 😊 Si quieres, también te agrego otra unidad.",
      "Si quieres, también te dejo otra unidad para que aproveches el pedido 😊"
    ]);
  }

  return productos.length === 1
    ? pickVariant(`upsell-generic-${first}`, [
        "Si quieres, también puedo agregarte otra unidad o otra presentación 😊",
        "Si quieres complementar el pedido, te agrego algo más de una 😊"
      ])
    : null;
}

function construirCierreVenta({ nombreCliente = "", productos = [] } = {}) {
  const first = String(productos?.[0]?.producto || "").toLowerCase();
  const baseKey = `${nombreCliente}-${first || "general"}`;

  if (/ancheta/.test(first)) {
    return pickVariant(`cierre-ancheta-${baseKey}`, [
      "Te lo dejamos en curso y te confirmamos el despacho en un momento 🎁",
      "Ya queda programado y te confirmamos el despacho 🎁"
    ]);
  }

  if (/aloe/.test(first)) {
    return pickVariant(`cierre-aloe-${baseKey}`, [
      "En un momento te confirmamos el despacho 🚚",
      "Te confirmamos el despacho en un momento 🚚",
      "Queda en curso y te confirmamos el despacho en un momento 🚚"
    ]);
  }

  return pickVariant(`cierre-general-${baseKey}`, [
    "En un momento te confirmamos el despacho 🚚",
    "Ya te dejamos esto en curso 🚚",
    "Te confirmamos el despacho en un momento 🚚"
  ]);
}

function construirRespuestaPedido(pedido, evaluacion = { esValido: true, faltantes: [], productosInvalidos: [] }, options = {}) {
  const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
  const detalle = construirDetalleProductosAmable(productos);
  const listaProductosDisponibles = construirListaProductosDisponibles(options.availableProducts);
  const catalogUrl = String(options.catalogUrl || CATALOG_URL || "").trim() || null;
  const nombreCliente = String(pedido?.cliente || "").trim();
  const isDistributor = String(pedido?.customer_type_applied || pedido?.customerTypeApplied || pedido?.price_tier_applied || pedido?.priceTierApplied || "public").trim().toLowerCase() === "distributor";
  const guideMode = String(options.guideMode || "none").trim().toLowerCase();
  const fullGuide = guideMode === "full" ? construirRespuestaGuiaPedido({ customerName: nombreCliente || null }) : null;
  const shortGuide = guideMode === "short" ? construirRespuestaGuiaPedido({ customerName: nombreCliente || null, short: true }) : null;

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
        "Me falta confirmar otro producto para dejarlo bien 😊",
        shortGuide || listaProductosDisponibles,
        catalogUrl ? `Aquí también puedes hacer tu pedido por catálogo:\n${catalogUrl}` : null,
        "Si quieres, te ayudo a escribirlo con cantidad y presentación."
      ].filter(Boolean).join("\n\n");
    }

    return [
      "No encontré ese producto en el catálogo actual 😊",
      shortGuide || "Puedes pedirme con cantidad y presentación, por ejemplo: “1 aloe grande” o “2 griegos pequeños”.",
      catalogUrl ? `Aquí también puedes hacer tu pedido por catálogo:\n${catalogUrl}` : null,
      "Si quieres, te ayudo a encontrarlo."
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
        construirAyudaPedidoPuntual({ title: titulo, options: ambiguityOptions }),
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
      construirAyudaPedidoPuntual({ title: titulo, options: ambiguityOptions }),
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
        construirPromptDireccionParcial(nombreCliente)
      ].filter(Boolean).join("\n\n");
    }

    if (evaluacion.faltantes?.includes("direccion") && productos.length) {
      return [
        construirSaludoNatural(nombreCliente),
        productos.length > 1 ? "Te dejo esto por ahora:" : null,
        detalle,
        pedido.total ? `Subtotal: ${formatearMoneda(pedido.total)}` : null,
        construirUpsellSuave(productos),
        construirPromptDireccion(nombreCliente),
        "Ejemplo: Calle 10 #20-30, Barrio Centro"
      ].filter(Boolean).join("\n\n");
    }

    if (evaluacion.faltantes?.includes("metodo_pago") && productos.length && !evaluacion.faltantes?.includes("direccion")) {
      return [
        construirSaludoNatural(nombreCliente),
        detalle,
        pedido.total ? `Subtotal: ${formatearMoneda(pedido.total)}` : null,
        construirUpsellSuave(productos),
        construirPromptMetodoPago(nombreCliente)
      ].filter(Boolean).join("\n\n");
    }

    if (evaluacion.faltantes?.includes("productos")) {
      return fullGuide || shortGuide || "Claro 😊 ¿Qué producto deseas pedir?";
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

  const orderCustomizations = construirTextoPersonalizacion(pedido?.customizations);

  return [
    pickVariant(`${nombreCliente}-${pedido.total || "pedido"}`, [
      `${construirSaludoNatural(nombreCliente)} Ya te dejé el pedido registrado:`,
      `${construirSaludoNatural(nombreCliente)} Tu pedido quedó listo en sistema:`,
      `${construirSaludoNatural(nombreCliente)} Ya registré tu pedido:`
    ]),
    null,
    detalle,
    orderCustomizations ? `Observaciones: ${orderCustomizations}` : null,
    `📍 Dirección: ${pedido.direccion || "pendiente por confirmar"}`,
    `💳 Pago: ${pedido.metodo_pago || "pendiente por confirmar"}`,
    null,
    isDistributor ? "Te aplico precio distribuidor." : null,
    pedido.total ? `Total: ${formatearMoneda(pedido.total)}` : null,
    null,
    construirCierreVenta({ nombreCliente, productos }),
    "Si quieres sumar algo más, me dices y te lo agrego al pedido.",
    construirUpsellSuave(productos)
  ].filter((line) => line !== null).join("\n");
}

module.exports = {
  CATALOG_URL,
  enviarMensajeWhatsApp,
  enviarAudioWhatsApp,
  subirMediaWhatsApp,
  obtenerMediaWhatsApp,
  construirRespuestaGuiaPedido,
  construirRespuestaPedido,
  construirRespuestaCatalogoInicial,
  construirRespuestaCatalogoInformativo,
  construirRespuestaNombreRegistrado,
  construirRespuestaPreciosInformativo,
  construirRespuestaPrecioDistribuidorRestringido,
  construirRespuestaIdentidad,
  construirRespuestaDespedida,
  construirRespuestaConfirmacion,
  construirRespuestaCasual,
  construirRespuestaCorreccion,
  construirRespuestaAyudaHumana,
  construirLineaCatalogoSugerido
};
