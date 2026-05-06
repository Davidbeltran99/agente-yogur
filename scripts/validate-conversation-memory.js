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
  const phone = `5732${String(Date.now()).slice(-8)}`;

  const saludo = await send(phone, "Hola", 1);
  assert(saludo.order === null, "saludo no debía crear order");
  assert(saludo.respuesta.includes("Tellolac Productos Lácteos"), "saludo debía mencionar Tellolac");
  assert(saludo.respuesta.includes("tu nombre"), "saludo debía pedir nombre");

  const nombre = await send(phone, "Me llamo Juan", 2);
  assert(nombre.order === null, "nombre no debía crear order");
  assert(nombre.respuesta.includes("Mucho gusto, Juan"), "nombre debía guardarse y responder natural");

  const productos = await send(phone, "Quiero 2 Aloe Litro", 3);
  assert(productos.order === null, "productos sin datos completos no debía crear order");
  assert(productos.pedido?.cliente === "Juan", "debía reutilizar nombre");
  assert(productos.pedido?.productos?.[0]?.producto === "Aloe Litro", "debía detectar Aloe Litro");

  const direccion = await send(phone, "Para la Calle 10 #20-30", 4);
  assert(direccion.order === null, "dirección sola no debía crear order todavía");
  assert(direccion.respuesta.includes("Solo me falta confirmar"), "tras dirección debía pedir dato faltante");

  const pago = await send(phone, "Pago nequi", 5);
  assert(pago.order?.id, "con pago debía crear order");
  assert(pago.respuesta.includes("Perfecto Juan 😊 Ya registré tu pedido:"), "pedido final debía sonar natural");
  assert(pago.respuesta.includes("Juan"), "pedido final debía usar nombre");

  const ambiguo = await send(`5732${String(Date.now() + 1).slice(-8)}`, "Quiero una ancheta", 6);
  assert(ambiguo.order === null, "ancheta ambigua no debía crear order");
  assert(ambiguo.evaluacion?.catalogStatus === "ambiguous", "ancheta debía ser ambiguous");
  assert(ambiguo.respuesta.includes("¿Cuál prefieres?"), "ancheta debía pedir aclaración");

  console.log(JSON.stringify({
    port,
    phone,
    pedidoFinal: {
      orderId: pago.order.id,
      cliente: pago.order.cliente,
      total: pago.order.total
    },
    ambiguo: ambiguo.evaluacion.catalogStatus
  }, null, 2));
}

main().catch((error) => {
  console.error(error.response?.data || error.stack || error.message);
  process.exit(1);
});
