const axios = require("axios");

const port = Number(process.env.PORT || 3000);
const api = axios.create({ baseURL: `http://127.0.0.1:${port}`, timeout: 180000 });

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function send(phone, mensaje, suffix) {
  const response = await api.post("/simulate-message", {
    telefono: phone,
    mensaje,
    sourceMessageId: `conv_${Date.now()}_${suffix}`
  });

  return response.data;
}

async function main() {
  const flowPhone = `5732${String(Date.now()).slice(-8)}`;
  const infoPhone = `5732${String(Date.now() + 1).slice(-8)}`;
  const preciosPhone = `5732${String(Date.now() + 2).slice(-8)}`;
  const menuPhone = `5732${String(Date.now() + 3).slice(-8)}`;

  const saludo = await send(flowPhone, "Hola", 1);
  assert(saludo.order === null, "saludo no debía crear order");
  assert(saludo.intent === "saludo", "hola debía detectarse como saludo");
  assert(saludo.respuesta.includes("Tellolac Productos Lácteos"), "saludo debía mencionar Tellolac");
  assert(saludo.respuesta.includes("tu nombre"), "saludo debía pedir nombre");

  const nombre = await send(flowPhone, "Me llamo Juan", 2);
  assert(nombre.order === null, "nombre no debía crear order");
  assert(nombre.respuesta.includes("Mucho gusto, Juan"), "nombre debía guardarse y responder natural");

  await send(infoPhone, "Sandra", "2a");
  const infoProductos = await send(infoPhone, "qué productos tienen", "2b");
  assert(infoProductos.order === null, "pregunta de productos no debía crear order");
  assert(infoProductos.intent === "info_catalogo", "qué productos tienen debía ser info_catalogo");
  assert(infoProductos.respuesta.includes("Claro Sandra"), "respuesta informativa debía reutilizar nombre");
  assert(infoProductos.respuesta.includes("Aloe Litro"), "respuesta informativa debía incluir productos");
  assert(infoProductos.respuesta.includes("catalogo.treinta.co/tellolac"), "respuesta informativa debía incluir catálogo");

  const precios = await send(preciosPhone, "precios", "2c");
  assert(precios.order === null, "precios no debía crear order");
  assert(precios.intent === "info_catalogo", "precios debía ser info_catalogo");

  const menu = await send(menuPhone, "menu", "2d");
  assert(menu.order === null, "menu no debía crear order");
  assert(menu.intent === "info_catalogo", "menu debía ser info_catalogo");

  const productos = await send(flowPhone, "Quiero 2 Aloe Litro", 3);
  assert(productos.order === null, "productos sin datos completos no debía crear order");
  assert(productos.pedido?.cliente === "Juan", "debía reutilizar nombre");
  assert(productos.pedido?.productos?.[0]?.producto === "Aloe Litro", "debía detectar Aloe Litro");

  const direccion = await send(flowPhone, "Para la Calle 10 #20-30", 4);
  assert(direccion.order === null, "dirección sola no debía crear order todavía");
  assert(direccion.respuesta.includes("Solo me falta confirmar"), "tras dirección debía pedir dato faltante");

  const pago = await send(flowPhone, "Pago nequi", 5);
  assert(pago.order?.id, "con pago debía crear order");
  assert(pago.respuesta.includes("Perfecto Juan 😊 Ya registré tu pedido:"), "pedido final debía sonar natural");
  assert(pago.respuesta.includes("Juan"), "pedido final debía usar nombre");

  const ambiguo = await send(`5732${String(Date.now() + 4).slice(-8)}`, "Quiero una ancheta", 6);
  assert(ambiguo.order === null, "ancheta ambigua no debía crear order");
  assert(ambiguo.intent === "aclaracion_producto", "ancheta debía pedir aclaración de producto");
  assert(ambiguo.evaluacion?.catalogStatus === "ambiguous", "ancheta debía ser ambiguous");
  assert(ambiguo.respuesta.includes("¿Cuál prefieres?"), "ancheta debía pedir aclaración");

  console.log(JSON.stringify({
    port,
    phone: flowPhone,
    intents: {
      saludo: saludo.intent,
      infoProductos: infoProductos.intent,
      precios: precios.intent,
      menu: menu.intent,
      ambiguo: ambiguo.intent
    },
    pedidoFinal: {
      orderId: pago.order.id,
      cliente: pago.order.cliente,
      total: pago.order.total
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error.response?.data || error.stack || error.message);
  process.exit(1);
});
