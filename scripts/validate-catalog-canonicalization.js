const axios = require("axios");

const port = Number(process.env.PORT || 3000);
const api = axios.create({ baseURL: `http://127.0.0.1:${port}`, timeout: 180000 });

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function simulateMessage(mensaje, suffix) {
  const response = await api.post("/simulate-message", {
    telefono: `5732${String(Date.now() + suffix).slice(-8)}`,
    mensaje,
    sourceMessageId: `canonical_${Date.now()}_${suffix}`
  });

  return response.data;
}

async function main() {
  const aloeValido = await simulateMessage("quiero 1 aloe litro para Calle 10 #20-30 pago nequi", 1);
  assert(aloeValido.order?.id, "aloe válido debía crear order");
  assert(aloeValido.respuesta.includes("Perfecto 😊 Ya registré tu pedido:"), "respuesta válida no quedó conversacional");

  const aloeGarrafa = await simulateMessage("quiero 1 aloe garrafa", 2);
  assert(aloeGarrafa.order === null, "aloe garrafa no debía crear order");
  assert(aloeGarrafa.evaluacion?.catalogStatus === "ambiguous", "aloe garrafa debía ser ambiguous");
  assert(aloeGarrafa.respuesta.includes("Encontré varias opciones"), "aloe garrafa debía pedir aclaración natural");
  assert(aloeGarrafa.respuesta.includes("Aloe Garrafa 1800 ml — $13.700"), "faltó opción Aloe Garrafa 1800 ml");
  assert(aloeGarrafa.respuesta.includes("Aloe Garrafa 1800 ml. — $18.000"), "faltó opción Aloe Garrafa 1800 ml.");

  const aloeLitro = await simulateMessage("quiero 1 aloe litro", 3);
  assert(aloeLitro.order === null, "aloe litro sin dirección no debía crear order");
  assert(aloeLitro.evaluacion?.catalogStatus === "ok", "aloe litro exacto no debía quedar ambiguous");
  assert(aloeLitro.pedido?.productos?.[0]?.producto === "Aloe Litro", "aloe litro exacto no resolvió Aloe Litro");
  assert(aloeLitro.respuesta.includes("Solo me falta tu dirección"), "aloe litro sin dirección debía pedir dirección");

  const cafeGarrafa = await simulateMessage("quiero 1 cafe garrafa 1800 ml", 4);
  assert(cafeGarrafa.order === null, "café garrafa no debía crear order");
  assert(cafeGarrafa.evaluacion?.catalogStatus === "ambiguous", "café garrafa debía ser ambiguous");
  assert(cafeGarrafa.respuesta.includes("Café garrafa 1.8Ml — $18.000"), "faltó opción café 1.8Ml");
  assert(cafeGarrafa.respuesta.includes("Café Garrafa 1800 ml — $13.700"), "faltó opción café 1800 ml");

  const ancheta = await simulateMessage("quiero 1 ancheta", 5);
  assert(ancheta.order === null, "ancheta ambigua no debía crear order");
  assert(ancheta.evaluacion?.catalogStatus === "ambiguous", "ancheta debía ser ambiguous");
  assert(ancheta.respuesta.includes("Encontré varias opciones para “ancheta”"), "ancheta debía pedir aclaración");
  assert(ancheta.respuesta.includes("Ancheta — $45.000"), "faltó opción Ancheta");
  assert(ancheta.respuesta.includes("Ancheta 1 — $38.000"), "faltó opción Ancheta 1");

  const inexistente = await simulateMessage("quiero 1 yogur de mora", 6);
  assert(inexistente.order === null, "producto inexistente no debía crear order");
  assert(inexistente.evaluacion?.catalogStatus === "not_found", "producto inexistente debía quedar not_found");
  assert(inexistente.respuesta.includes("No encontré ese producto en el catálogo"), "producto inexistente debía responder no encontrado");

  const aloeLitroPrice = await simulateMessage("quiero Aloe Litro de 12000", 7);
  assert(aloeLitroPrice.pedido?.productos?.[0]?.producto === "Aloe Litro", "Aloe Litro por precio no resolvió producto correcto");
  assert(aloeLitroPrice.pedido?.productos?.[0]?.cantidad === 1, "Aloe Litro por precio debía mantener cantidad 1");

  const aloeLitro1000 = await simulateMessage("quiero Aloe Litro 1000 ml", 8);
  assert(aloeLitro1000.pedido?.productos?.[0]?.producto === "Aloe Litro 1000 ml", "Aloe Litro 1000 ml no resolvió producto correcto");
  assert(aloeLitro1000.pedido?.productos?.[0]?.cantidad === 1, "Aloe Litro 1000 ml debía mantener cantidad 1");

  console.log(JSON.stringify({
    port,
    tests: {
      aloeValido: aloeValido.order.id,
      aloeGarrafa: aloeGarrafa.evaluacion.catalogStatus,
      aloeLitroSinDireccion: aloeLitro.respuesta,
      cafeGarrafa: cafeGarrafa.evaluacion.catalogStatus,
      ancheta: ancheta.evaluacion.catalogStatus,
      inexistente: inexistente.evaluacion.catalogStatus,
      aloeLitroPrice: aloeLitroPrice.pedido.productos[0],
      aloeLitro1000: aloeLitro1000.pedido.productos[0]
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error.response?.data || error.stack || error.message);
  process.exit(1);
});
