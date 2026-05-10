const { ejecutarFlujoMensaje } = require("../server");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function send(phone, mensaje, suffix) {
  const response = await ejecutarFlujoMensaje({
    telefono: phone,
    mensaje,
    sourceMessageId: `conv_${Date.now()}_${suffix}`,
    origen: "script",
    simulated: true,
    skipRateLimit: true
  });

  await sleep(50);
  return response;
}

async function main() {
  const flowPhone = `5732${String(Date.now()).slice(-8)}`;
  const infoPhone = `5732${String(Date.now() + 1).slice(-8)}`;
  const goodbyePhone = `5732${String(Date.now() + 2).slice(-8)}`;
  const identityPhone = `5732${String(Date.now() + 3).slice(-8)}`;
  const invalidNamePhone = `5732${String(Date.now() + 4).slice(-8)}`;

  const saludo = await send(flowPhone, "Hola", 1);
  assert(saludo.order === null, "saludo no debía crear order");
  assert(saludo.intent === "greeting", "hola debía detectarse como greeting");
  assert(saludo.respuesta.includes("Mi nombre es Abi"), "saludo debía presentar a Abi");
  assert(saludo.respuesta.includes("tu nombre"), "saludo debía pedir nombre");

  const identidad = await send(identityPhone, "Quién eres", "1b");
  assert(identidad.intent === "identity", "quién eres debía detectar identity");
  assert(identidad.respuesta.includes("Soy Abi"), "identidad debía responder con Abi");

  const nombre = await send(flowPhone, "Mi nombre es Sandra", 2);
  assert(nombre.order === null, "nombre no debía crear order");
  assert(nombre.intent === "provide_name", "mi nombre es Sandra debía detectarse como provide_name");
  assert(nombre.respuesta.includes("Mucho gusto, Sandra"), "nombre debía guardarse y responder natural");
  assert(nombre.respuesta.includes("Catálogo completo:"), "tras guardar nombre debía compartir catálogo");

  const infoProductos = await send(flowPhone, "Qué productos tienen", "2b");
  assert(infoProductos.order === null, "pregunta de productos no debía crear order");
  assert(infoProductos.intent === "catalog_request", "qué productos tienen debía ser catalog_request");
  assert(infoProductos.respuesta.includes("Claro Sandra"), "respuesta informativa debía reutilizar nombre");

  const listo = await send(invalidNamePhone, "Listo", "3a");
  assert(listo.intent === "general_chat", "listo sin contexto debía quedarse en general_chat");
  assert(!listo.respuesta.includes("Listo 😊"), "listo no debía tratarse como nombre");

  const jhoanPhone = `5732${String(Date.now() + 6).slice(-8)}`;
  const nombreJhoan = await send(jhoanPhone, "Mi nombre es Jhoan", "3aa");
  assert(nombreJhoan.intent === "provide_name", "Mi nombre es Jhoan debía detectarse como provide_name");
  const portafolio = await send(jhoanPhone, "Portafolio?", "3ab");
  assert(portafolio.intent === "catalog_request", "Portafolio debía ir a catalog_request");
  assert(portafolio.respuesta.includes("Claro Jhoan"), "Portafolio debía reutilizar Jhoan");
  assert(!portafolio.respuesta.includes("Mucho gusto, Portafolio"), "Portafolio no debía sobrescribir el nombre");

  const dimePortafolio = await send(jhoanPhone, "Dime portafolio", "3ac");
  assert(dimePortafolio.intent === "catalog_request", "Dime portafolio debía ir a catalog_request");
  assert(dimePortafolio.respuesta.includes("Claro Jhoan"), "Dime portafolio debía reutilizar Jhoan");

  const gracias = await send(goodbyePhone, "Gracias", "3b");
  assert(gracias.intent === "closing", "gracias debía cerrar conversación");
  assert(typeof gracias.respuesta === "string" && gracias.respuesta.trim().length > 0, "despedida debía responder algo útil");

  const okGracias = await send(goodbyePhone, "Ok gracias", "3c");
  assert(okGracias.intent === "closing", "ok gracias debía cerrar conversación");

  const bye = await send(goodbyePhone, "Bye", "3d");
  assert(bye.intent === "closing", "bye debía cerrar conversación");

  const productos = await send(flowPhone, "Quiero 2 Aloe Litro", 4);
  assert(productos.order === null, "productos sin datos completos no debía crear order");
  assert(productos.pedido?.cliente === "Sandra", "debía reutilizar nombre");
  assert(productos.pedido?.productos?.[0]?.producto === "Aloe Litro", "debía detectar Aloe Litro");
  assert(/direccion|dirección/i.test(productos.respuesta), "cuando falta dirección debía pedir la dirección");

  const direccion = await send(flowPhone, "Para la calle 10", 5);
  assert(direccion.order === null, "dirección sola no debía crear order todavía");

  const pago = await send(flowPhone, "Pago nequi", 6);
  assert(pago.order === null, "con pago primero debía quedar pendiente de completar/corroborar la dirección final");
  assert(/nequi|transferencia/i.test(pago.respuesta) && /direccion|dirección|referencia|casa/i.test(pago.respuesta), "con pago debía pedir completar o corroborar la dirección final");
  const referencia = await send(flowPhone, "Casa 4", "6a");
  assert(referencia.order === null, "con referencia debía quedar pendiente de confirmación final");
  assert(/si esta bien|sí|registrado/i.test(referencia.respuesta.toLowerCase()), "con referencia debía pedir confirmación final");
  const confirmacionFinal = await send(flowPhone, "Sí", "6b");
  assert(confirmacionFinal.order?.id, "tras confirmar el resumen debía crear order");
  assert(confirmacionFinal.respuesta.includes("Sandra") && /pedido/i.test(confirmacionFinal.respuesta), "pedido final debía usar nombre y confirmar el pedido");

  await send(infoPhone, "Sandra", "7a");
  const menu = await send(infoPhone, "menu", "7b");
  assert(menu.intent === "catalog_request", "menu debía ser catalog_request");

  const ambiguousPhone = `5732${String(Date.now() + 5).slice(-8)}`;
  const ambiguo = await send(ambiguousPhone, "quiero 1 griego", 8);
  assert(ambiguo.order === null, "griego ambiguo no debía crear order");
  assert(ambiguo.intent === "ambiguous_product", "griego debía pedir aclaración de tamaño");
  assert(/numero|número|opcion|opción|1|2/i.test(ambiguo.respuesta), "aclaración debía pedir número");

  const opcionUno = await send(ambiguousPhone, "1", "8a");
  assert(opcionUno.order === null, "selección 1 sin datos completos no debía crear order todavía");
  assert(opcionUno.pedido?.productos?.[0]?.producto === "Griego 250 g", "selección 1 debía guardar Griego 250 g en borrador");
  await send(ambiguousPhone, "Calle 10 #20-30", "8aa");
  const opcionUnoPago = await send(ambiguousPhone, "Pago nequi", "8ab");
  assert(opcionUnoPago.order === null, "selección 1 + pago debía quedar pendiente de confirmación final");
  const opcionUnoConfirmacion = await send(ambiguousPhone, "Sí", "8ad");
  assert(opcionUnoConfirmacion.order?.id, "selección 1 + confirmación final debía crear order");
  assert(opcionUnoConfirmacion.order?.resumenItems?.includes("Griego 250 g"), "selección 1 debía guardar Griego 250 g");
  assert(opcionUnoConfirmacion.order?.total === 6500, "selección 1 debía usar precio público de Griego 250 g");

  const ambiguousPhoneTwo = `5732${String(Date.now() + 7).slice(-8)}`;
  await send(ambiguousPhoneTwo, "quiero 1 griego", "8b");
  const opcionDos = await send(ambiguousPhoneTwo, "opción 2", "8c");
  assert(opcionDos.order === null, "selección 2 sin datos completos no debía crear order todavía");
  assert(opcionDos.pedido?.productos?.[0]?.producto === "Griego 500 g", "selección 2 debía guardar Griego 500 g en borrador");
  await send(ambiguousPhoneTwo, "Calle 10 #20-30", "8ca");
  const opcionDosPago = await send(ambiguousPhoneTwo, "Pago nequi", "8cb");
  assert(opcionDosPago.order === null, "selección opción 2 + pago debía quedar pendiente de confirmación final");
  const opcionDosConfirmacion = await send(ambiguousPhoneTwo, "Sí", "8cd");
  assert(opcionDosConfirmacion.order?.id, "selección opción 2 + confirmación final debía crear order");
  assert(opcionDosConfirmacion.order?.resumenItems?.includes("Griego 500 g"), "selección 2 debía guardar Griego 500 g");
  assert(opcionDosConfirmacion.order?.total === 10500, "selección 2 debía usar precio público de Griego 500 g");

  const ambiguousPhoneThree = `5732${String(Date.now() + 8).slice(-8)}`;
  await send(ambiguousPhoneThree, "quiero 1 griego", "8d");
  const primera = await send(ambiguousPhoneThree, "la primera", "8e");
  assert(primera.order === null, "la primera sin datos completos no debía crear order todavía");
  assert(primera.pedido?.productos?.[0]?.producto === "Griego 250 g", "la primera debía resolver la opción 1");

  const ambiguousPhoneInvalid = `5732${String(Date.now() + 9).slice(-8)}`;
  await send(ambiguousPhoneInvalid, "quiero 1 griego", "8f");
  const invalida = await send(ambiguousPhoneInvalid, "quiero esa", "8g");
  assert(invalida.order === null, "respuesta inválida no debía crear order");
  assert(invalida.intent === "ambiguous_product", "respuesta inválida debía mantener aclaración");
  assert(/numero|número|opcion|opción/i.test(invalida.respuesta), "respuesta inválida debía pedir número válido");

  console.log(JSON.stringify({
    simulated: true,
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
      orderId: confirmacionFinal.order.id,
      cliente: confirmacionFinal.order.cliente,
      total: confirmacionFinal.order.total
    },
    aclaracion: {
      opcionUno: opcionUnoConfirmacion.order?.total,
      opcionDos: opcionDosConfirmacion.order?.total,
      primera: primera.pedido?.productos?.[0]?.producto,
      invalida: invalida.intent
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.details || error.stack || error.message);
  process.exit(1);
});
