const axios = require("axios");

const CATALOG_URL = "https://catalogo.treinta.co/tellolac";

async function enviarMensajeWhatsApp(para, texto) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    throw new Error("Faltan WHATSAPP_TOKEN o PHONE_NUMBER_ID en .env");
  }

  const response = await axios.post(
    `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      to: para,
      type: "text",
      text: {
        body: texto
      }
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data;
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

function construirRespuestaPedido(pedido, evaluacion = { esValido: true, faltantes: [], productosInvalidos: [] }) {
  const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
  const detalle = construirDetalleProductos(productos);

  if (evaluacion.modelError) {
    return "Hubo un problema procesando tu pedido. ¿Puedes repetirlo por favor?";
  }

  if (evaluacion.priceValidation === "missing_price") {
    return "No pude validar el precio del producto, ¿puedes confirmarlo?";
  }

  if (evaluacion.catalogStatus === "not_found") {
    return `No encontré ese producto exacto en el catálogo. Puedes revisarlo aquí: ${CATALOG_URL} y enviarme el nombre como aparece.`;
  }

  if (evaluacion.catalogStatus === "ambiguous") {
    const ambiguityLines = (evaluacion.ambiguousProducts || [])
      .slice(0, 2)
      .map((entry) => `• ${entry.input}: ${entry.options.join(" / ")}`)
      .join("\n");

    return [
      "Encontré varias opciones parecidas en el catálogo y prefiero confirmarlo antes de registrar el pedido.",
      ambiguityLines || null,
      `Revisa el catálogo aquí: ${CATALOG_URL}`,
      "Envíame el nombre exacto como aparece y te lo dejo listo."
    ].filter(Boolean).join("\n");
  }

  if (!evaluacion.esValido) {
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
