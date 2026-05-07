const axios = require("axios");

const port = Number(process.env.PORT || 3000);
const api = axios.create({ baseURL: `http://127.0.0.1:${port}`, timeout: 180000 });

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const goodbyePhone = `5732${String(Date.now() + 2).slice(-8)}`;
  const identityPhone = `5732${String(Date.now() + 3).slice(-8)}`;
  const invalidNamePhone = `5732${String(Date.now() + 4).slice(-8)}`;

  const saludo = await send(flowPhone, "Hola", 1);
  await sleep(2200);
  assert(saludo.order === null, "saludo no debía crear order");
  assert(saludo.intent === "saludo", "hola debía detectarse como saludo");
  assert(saludo.respuesta.includes("Mi nombre es Abby"), "saludo debía presentar a Abby");
  assert(saludo.respuesta.includes("tu nombre"), "saludo debía pedir nombre");

  const identidad = await send(identityPhone, "Quién eres", "1b");
  assert(identidad.intent === "identidad", "quién eres debía detectar identidad");
  assert(identidad.respuesta.includes("Soy Abby"), "identidad debía responder con Abby");

  const nombre = await send(flowPhone, "Mi nombre es Sandra", 2);
  await sleep(2200);
  assert(nombre.order === null, "nombre no debía crear order");
  assert(nombre.intent === "nombre", "mi nombre es Sandra debía detectarse como nombre");
  assert(nombre.respuesta.includes("Mucho gusto, Sandra"), "nombre debía guardarse y responder natural");
  assert(nombre.respuesta.includes("Catálogo completo:"), "tras guardar nombre debía compartir catálogo");

  const infoProductos = await send(flowPhone, "Qué productos tienen", "2b");
  await sleep(2200);
  assert(infoProductos.order === null, "pregunta de productos no debía crear order");
  assert(infoProductos.intent === "info_catalogo", "qué productos tienen debía ser info_catalogo");
  assert(infoProductos.respuesta.includes("Claro Sandra"), "respuesta informativa debía reutilizar nombre");

  const listo = await send(invalidNamePhone, "Listo", "3a");
  assert(listo.intent === "confirmacion", "listo debía ser confirmación");
  assert(!listo.respuesta.includes("Listo 😊"), "listo no debía tratarse como nombre");

  const jhoanPhone = `5732${String(Date.now() + 6).slice(-8)}`;
  const nombreJhoan = await send(jhoanPhone, "Mi nombre es Jhoan", "3aa");
  await sleep(2200);
  assert(nombreJhoan.intent === "nombre", "Mi nombre es Jhoan debía detectarse como nombre");
  const portafolio = await send(jhoanPhone, "Portafolio?", "3ab");
  assert(portafolio.intent === "info_catalogo", "Portafolio debía ir a info_catalogo");
  assert(portafolio.respuesta.includes("Claro Jhoan"), "Portafolio debía reutilizar Jhoan");
  assert(!portafolio.respuesta.includes("Mucho gusto, Portafolio"), "Portafolio no debía sobrescribir el nombre");

  const dimePortafolio = await send(jhoanPhone, "Dime portafolio", "3ac");
  assert(dimePortafolio.intent === "info_catalogo", "Dime portafolio debía ir a info_catalogo");
  assert(dimePortafolio.respuesta.includes("Claro Jhoan"), "Dime portafolio debía reutilizar Jhoan");

  const gracias = await send(goodbyePhone, "Gracias", "3b");
  assert(gracias.intent === "despedida", "gracias debía cerrar conversación");
  assert(gracias.respuesta.includes("Con mucho gusto"), "despedida debía sonar natural");

  const okGracias = await send(goodbyePhone, "Ok gracias", "3c");
  assert(okGracias.intent === "despedida", "ok gracias debía cerrar conversación");

  const bye = await send(goodbyePhone, "Bye", "3d");
  assert(bye.intent === "despedida", "bye debía cerrar conversación");

  const productos = await send(flowPhone, "Quiero 2 Aloe Litro", 4);
  await sleep(2200);
  assert(productos.order === null, "productos sin datos completos no debía crear order");
  assert(productos.pedido?.cliente === "Sandra", "debía reutilizar nombre");
  assert(productos.pedido?.productos?.[0]?.producto === "Aloe Litro", "debía detectar Aloe Litro");
  assert(productos.respuesta.includes("Escríbela así:"), "cuando falta dirección debía dar ejemplo");

  const direccion = await send(flowPhone, "Para la calle 10", 5);
  await sleep(2200);
  assert(direccion.order === null, "dirección sola no debía crear order todavía");

  const pago = await send(flowPhone, "Pago nequi", 6);
  assert(pago.order?.id, "con pago debía crear order");
  assert(pago.respuesta.includes("Perfecto Sandra 😊 Ya registré tu pedido:"), "pedido final debía usar nombre y sonar natural");

  await send(infoPhone, "Sandra", "7a");
  const menu = await send(infoPhone, "menu", "7b");
  assert(menu.intent === "info_catalogo", "menu debía ser info_catalogo");

  const ambiguousPhone = `5732${String(Date.now() + 5).slice(-8)}`;
  const ambiguo = await send(ambiguousPhone, "quiero 1 ancheta", 8);
  assert(ambiguo.order === null, "ancheta ambigua no debía crear order");
  assert(ambiguo.intent === "aclaracion_producto", "ancheta debía pedir aclaración de producto");
  assert(ambiguo.respuesta.includes("Responde con el número de la opción"), "aclaración debía pedir número");

  const opcionUno = await send(ambiguousPhone, "1", "8a");
  assert(opcionUno.order === null, "selección 1 sin datos completos no debía crear order todavía");
  assert(opcionUno.pedido?.productos?.[0]?.producto === "Ancheta", "selección 1 debía guardar Ancheta en borrador");
  const opcionUnoDireccion = await send(ambiguousPhone, "Calle 10 #20-30", "8aa");
  const opcionUnoPago = await send(ambiguousPhone, "Pago nequi", "8ab");
  assert(opcionUnoPago.order?.id, "selección 1 + datos faltantes debía crear order");
  assert(opcionUnoPago.order?.resumenItems?.includes("Ancheta"), "selección 1 debía guardar Ancheta");
  assert(opcionUnoPago.order?.total === 45000, "selección 1 debía usar precio de Ancheta");

  const ambiguousPhoneTwo = `5732${String(Date.now() + 7).slice(-8)}`;
  await send(ambiguousPhoneTwo, "quiero 1 ancheta", "8b");
  const opcionDos = await send(ambiguousPhoneTwo, "opción 2", "8c");
  assert(opcionDos.order === null, "selección 2 sin datos completos no debía crear order todavía");
  assert(opcionDos.pedido?.productos?.[0]?.producto === "Ancheta 1", "selección 2 debía guardar Ancheta 1 en borrador");
  await send(ambiguousPhoneTwo, "Calle 10 #20-30", "8ca");
  const opcionDosPago = await send(ambiguousPhoneTwo, "Pago nequi", "8cb");
  assert(opcionDosPago.order?.id, "selección opción 2 + datos faltantes debía crear order");
  assert(opcionDosPago.order?.resumenItems?.includes("Ancheta 1"), "selección 2 debía guardar Ancheta 1");
  assert(opcionDosPago.order?.total === 38000, "selección 2 debía usar precio de Ancheta 1");

  const ambiguousPhoneThree = `5732${String(Date.now() + 8).slice(-8)}`;
  await send(ambiguousPhoneThree, "quiero 1 ancheta", "8d");
  const primera = await send(ambiguousPhoneThree, "la primera", "8e");
  assert(primera.order === null, "la primera sin datos completos no debía crear order todavía");
  assert(primera.pedido?.productos?.[0]?.producto === "Ancheta", "la primera debía resolver la opción 1");

  const ambiguousPhoneInvalid = `5732${String(Date.now() + 9).slice(-8)}`;
  await send(ambiguousPhoneInvalid, "quiero 1 ancheta", "8f");
  const invalida = await send(ambiguousPhoneInvalid, "quiero esa", "8g");
  assert(invalida.order === null, "respuesta inválida no debía crear order");
  assert(invalida.intent === "aclaracion_producto", "respuesta inválida debía mantener aclaración");
  assert(invalida.respuesta.includes("Por favor responde con el número de la opción"), "respuesta inválida debía pedir número válido");

  console.log(JSON.stringify({
    port,
    phone: flowPhone,
    intents: {
      saludo: saludo.intent,
      identidad: identidad.intent,
      nombre: nombre.intent,
      infoProductos: infoProductos.intent,
      portafolio: portafolio.intent,
      dimePortafolio: dimePortafolio.intent,
      listo: listo.intent,
      gracias: gracias.intent,
      okGracias: okGracias.intent,
      bye: bye.intent,
      menu: menu.intent,
      ambiguo: ambiguo.intent
    },
    pedidoFinal: {
      orderId: pago.order.id,
      cliente: pago.order.cliente,
      total: pago.order.total
    },
    aclaracion: {
      opcionUno: opcionUnoPago.order?.total,
      opcionDos: opcionDosPago.order?.total,
      primera: primera.pedido?.productos?.[0]?.producto,
      invalida: invalida.intent
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error.response?.data || error.stack || error.message);
  process.exit(1);
});
