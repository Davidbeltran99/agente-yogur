const {
  bootstrapCatalogoDesdeTreinta,
  resolverProductoCatalogo,
  analizarProductosCatalogoDesdeTexto,
  ejecutarFlujoMensaje,
  obtenerEstadoConversacion
} = require("../server");

function assert(condition, message, details = null) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function byName(result) {
  return result?.product?.nombre || null;
}

function itemNames(analysis) {
  return (analysis?.items || []).map((item) => `${item.cantidad || 1} x ${item.producto}`);
}

async function run() {
  await bootstrapCatalogoDesdeTreinta();

  const checks = [];

  const case1 = resolverProductoCatalogo("griego grande");
  assert(case1.status === "matched" && byName(case1) === "Griego 500 g", "1. griego grande debe resolver a Griego 500 g", case1);
  checks.push({ case: 1, ok: true, result: byName(case1) });

  const case2 = resolverProductoCatalogo("griego de 500ml");
  assert(case2.status === "matched" && byName(case2) === "Griego 500 g", "2. griego de 500ml debe resolver a Griego 500 g", case2);
  checks.push({ case: 2, ok: true, result: byName(case2) });

  const case3 = resolverProductoCatalogo("griego pequeño");
  assert(case3.status === "matched" && byName(case3) === "Griego 250 g", "3. griego pequeño debe resolver a Griego 250 g", case3);
  checks.push({ case: 3, ok: true, result: byName(case3) });

  const case4 = analizarProductosCatalogoDesdeTexto("2 griego grande");
  assert(case4.items.length === 1 && case4.items[0].producto === "Griego 500 g" && case4.items[0].cantidad === 2, "4. 2 griego grande debe resolver 2 x Griego 500 g", case4);
  checks.push({ case: 4, ok: true, result: itemNames(case4) });

  const case5 = resolverProductoCatalogo("1 cafe grande");
  assert(case5.status === "matched" && byName(case5) === "Cafe Garrafa 1800 ml", "5. 1 cafe grande debe resolver a Cafe Garrafa 1800 ml", case5);
  checks.push({ case: 5, ok: true, result: byName(case5) });

  const case6 = resolverProductoCatalogo("1 aloe grande");
  assert(case6.status === "matched" && byName(case6) === "Áloe Garrafa 1800 ml", "6. 1 aloe grande debe resolver a Áloe Garrafa 1800 ml", case6);
  checks.push({ case: 6, ok: true, result: byName(case6) });

  const case7 = resolverProductoCatalogo("1 ancheta barata");
  assert(case7.status === "matched" && byName(case7) === "Ancheta 1", "7. 1 ancheta barata debe resolver a Ancheta 1", case7);
  checks.push({ case: 7, ok: true, result: byName(case7) });

  const case8 = analizarProductosCatalogoDesdeTexto("quiero un yogur de cafe grande\n2 griego grande\n1 ancheta barata");
  const case8Names = case8.items.map((item) => item.producto);
  assert(case8Names.includes("Griego 500 g"), "8. multi-item no debe perder Griego 500 g", case8);
  assert(case8Names.includes("Ancheta 1"), "8. multi-item no debe perder Ancheta 1", case8);
  checks.push({ case: 8, ok: true, result: itemNames(case8), unmatched: case8.unmatched, ambiguities: case8.ambiguities.map((entry) => entry.input) });

  const phone9 = `57300003${Date.now().toString().slice(-4)}`;
  const first9 = await ejecutarFlujoMensaje({ mensaje: "griego", telefono: phone9, sourceMessageId: `test9a_${Date.now()}`, origen: "script", simulated: true, skipRateLimit: true });
  assert(/griego 250 g/i.test(first9.delivery?.respuesta || first9.respuesta || "") && /griego 500 g/i.test(first9.delivery?.respuesta || first9.respuesta || ""), "9. griego debe abrir modo sugerencia con opciones reales", first9);
  const second9 = await ejecutarFlujoMensaje({ mensaje: "borra ese", telefono: phone9, sourceMessageId: `test9b_${Date.now()}`, origen: "script", simulated: true, skipRateLimit: true });
  assert(second9.intent === "remove_item" || /borr|quit/i.test(second9.delivery?.respuesta || second9.respuesta || ""), "9. borra ese debe mantenerse como remoción contextual", second9);
  checks.push({ case: 9, ok: true, result: second9.intent || second9.delivery?.respuesta || second9.respuesta });

  const phone10 = `57300004${Date.now().toString().slice(-4)}`;
  const first10 = await ejecutarFlujoMensaje({ mensaje: "1 cafe grande calle 1 # 1-1 pago nequi", telefono: phone10, sourceMessageId: `test10a_${Date.now()}`, origen: "script", simulated: true, skipRateLimit: true });
  assert(first10.pedido?.productos?.some((item) => item.producto === "Cafe Garrafa 1800 ml"), "10. primer pedido debe guardar cafe", first10);
  const second10 = await ejecutarFlujoMensaje({ mensaje: "quiero otra cosa 1 griego grande", telefono: phone10, sourceMessageId: `test10b_${Date.now()}`, origen: "script", simulated: true, skipRateLimit: true });
  const second10Products = second10.pedido?.productos || [];
  assert(second10Products.some((item) => item.producto === "Cafe Garrafa 1800 ml"), "10. al agregar otra cosa no debe perder el cafe original", second10);
  assert(second10Products.some((item) => item.producto === "Griego 500 g"), "10. quiero otra cosa debe agregar Griego 500 g", second10);
  const cafeCount = second10Products.filter((item) => item.producto === "Cafe Garrafa 1800 ml").length;
  assert(cafeCount === 1, "10. no debe duplicar el producto anterior al agregar otra cosa", second10Products);
  checks.push({ case: 10, ok: true, result: second10Products.map((item) => `${item.cantidad || 1} x ${item.producto}`) });

  const phone11 = `57300005${Date.now().toString().slice(-4)}`;
  const case11 = await ejecutarFlujoMensaje({ mensaje: "cómo pido", telefono: phone11, sourceMessageId: `test11_${Date.now()}`, origen: "script", simulated: true, skipRateLimit: true });
  const case11Text = case11.delivery?.respuesta || case11.respuesta || "";
  assert(/2 aloe grandes/i.test(case11Text) && /1 griego pequeño/i.test(case11Text) && /pago nequi/i.test(case11Text), "11. cómo pido debe enseñar con ejemplos simples", case11);
  checks.push({ case: 11, ok: true, result: case11Text });

  const phone12 = `57300006${Date.now().toString().slice(-4)}`;
  const case12 = await ejecutarFlujoMensaje({ mensaje: "griego", telefono: phone12, sourceMessageId: `test12_${Date.now()}`, origen: "script", simulated: true, skipRateLimit: true });
  const case12Text = case12.delivery?.respuesta || case12.respuesta || "";
  assert(/griego 250 g/i.test(case12Text) && /griego 500 g/i.test(case12Text) && /griegos grandes|griego pequeño/i.test(case12Text), "12. griego ambiguo debe incluir ayuda puntual", case12);
  checks.push({ case: 12, ok: true, result: case12Text });

  const simulatedImageAnalysis = {
    items: [
      { raw_text: "2 griego 500", product_query: "griego 500 g", quantity: 2, confidence: 0.96 },
      { raw_text: "1 aloe litro", product_query: "aloe litro", quantity: 1, confidence: 0.91 }
    ],
    uncertain_lines: [{ text: "cafe grande?", confidence: 0.42 }],
    extracted_text: "2 griego 500\n1 aloe litro\ncafe grande?",
    address: null,
    payment_method: null,
    overall_confidence: 0.82
  };

  const phone13 = `57300007${Date.now().toString().slice(-4)}`;
  const case13 = await ejecutarFlujoMensaje({ mensaje: "", telefono: phone13, sourceMessageId: `test13_${Date.now()}`, origen: "script", simulated: true, messageType: "image", mediaId: `img_${Date.now()}`, mediaBuffer: Buffer.from("fake-image"), mediaMimeType: "image/jpeg", mediaFilename: "pedido.jpg", imageAnalysisOverride: simulatedImageAnalysis, skipRateLimit: true });
  const case13Text = case13.delivery?.respuesta || case13.respuesta || "";
  assert(/recibí la imagen/i.test(case13Text) && /revisando/i.test(case13Text), "13. imagen sola debe quedar en revisión", case13);
  checks.push({ case: 13, ok: true, result: case13Text });

  const case14 = await ejecutarFlujoMensaje({ mensaje: "puedes leer mi imagen?", telefono: phone13, sourceMessageId: `test14_${Date.now()}`, origen: "script", simulated: true, skipRateLimit: true });
  const case14Text = case14.delivery?.respuesta || case14.respuesta || "";
  assert(/griego 500 g/i.test(case14Text) && /aloe litro 1000 ml|aloe litro/i.test(case14Text) && !/no puedo leer imágenes|no puedo leer imagenes/i.test(case14Text), "14. follow-up de imagen debe usar OCR reciente", case14);
  checks.push({ case: 14, ok: true, result: case14Text });

  const phone15 = `57300008${Date.now().toString().slice(-4)}`;
  await ejecutarFlujoMensaje({ mensaje: "", telefono: phone15, sourceMessageId: `test15a_${Date.now()}`, origen: "script", simulated: true, messageType: "image", mediaId: `img_${Date.now()}`, mediaBuffer: Buffer.from("fake-image-2"), mediaMimeType: "image/jpeg", mediaFilename: "pedido2.jpg", imageAnalysisOverride: simulatedImageAnalysis, skipRateLimit: true });
  const case15 = await ejecutarFlujoMensaje({ mensaje: "sí, es un pedido", telefono: phone15, sourceMessageId: `test15b_${Date.now()}`, origen: "script", simulated: true, skipRateLimit: true });
  const case15Text = case15.delivery?.respuesta || case15.respuesta || "";
  assert(/griego 500 g/i.test(case15Text) && /aloe litro 1000 ml|aloe litro/i.test(case15Text), "15. confirmar que es pedido debe procesar la última imagen", case15);
  checks.push({ case: 15, ok: true, result: case15Text });

  const handwrittenAnalysis = {
    items: [{ raw_text: "3 aloe litro", product_query: "aloe litro", quantity: 3, confidence: 0.88 }],
    uncertain_lines: [],
    extracted_text: "3 aloe litro",
    address: null,
    payment_method: null,
    overall_confidence: 0.88
  };
  const phone16 = `57300009${Date.now().toString().slice(-4)}`;
  await ejecutarFlujoMensaje({ mensaje: "", telefono: phone16, sourceMessageId: `test16a_${Date.now()}`, origen: "script", simulated: true, messageType: "image", mediaId: `img_${Date.now()}`, mediaBuffer: Buffer.from("handwritten-image"), mediaMimeType: "image/jpeg", mediaFilename: "pedido3.jpg", imageAnalysisOverride: handwrittenAnalysis, skipRateLimit: true });
  const case16 = await ejecutarFlujoMensaje({ mensaje: "lee la foto", telefono: phone16, sourceMessageId: `test16b_${Date.now()}`, origen: "script", simulated: true, skipRateLimit: true });
  const case16Text = case16.delivery?.respuesta || case16.respuesta || "";
  assert(/3 Aloe Litro 1000 ml|3 aloe litro/i.test(case16Text), "16. imagen manuscrita debe producir items validados", case16);
  checks.push({ case: 16, ok: true, result: case16Text });

  const blurryAnalysis = {
    items: [],
    uncertain_lines: [{ text: "pedido borroso", confidence: 0.2 }],
    extracted_text: "pedido borroso",
    address: null,
    payment_method: null,
    overall_confidence: 0.2
  };
  const phone17 = `57300010${Date.now().toString().slice(-4)}`;
  await ejecutarFlujoMensaje({ mensaje: "", telefono: phone17, sourceMessageId: `test17a_${Date.now()}`, origen: "script", simulated: true, messageType: "image", mediaId: `img_${Date.now()}`, mediaBuffer: Buffer.from("blurry-image"), mediaMimeType: "image/jpeg", mediaFilename: "pedido4.jpg", imageAnalysisOverride: blurryAnalysis, skipRateLimit: true });
  const case17 = await ejecutarFlujoMensaje({ mensaje: "revisa la imagen", telefono: phone17, sourceMessageId: `test17b_${Date.now()}`, origen: "script", simulated: true, skipRateLimit: true });
  const case17Text = case17.delivery?.respuesta || case17.respuesta || "";
  assert(/quiero confirmar|está correcto|pedido borroso/i.test(case17Text), "17. imagen borrosa debe pedir confirmación", case17);
  checks.push({ case: 17, ok: true, result: case17Text });

  const emptyAnalysis = {
    items: [],
    uncertain_lines: [],
    extracted_text: "",
    address: null,
    payment_method: null,
    overall_confidence: 0
  };
  const phone18 = `57300011${Date.now().toString().slice(-4)}`;
  await ejecutarFlujoMensaje({ mensaje: "", telefono: phone18, sourceMessageId: `test18a_${Date.now()}`, origen: "script", simulated: true, messageType: "image", mediaId: `img_${Date.now()}`, mediaBuffer: Buffer.from("empty-image"), mediaMimeType: "image/jpeg", mediaFilename: "pedido5.jpg", imageAnalysisOverride: emptyAnalysis, skipRateLimit: true });
  const case18 = await ejecutarFlujoMensaje({ mensaje: "puedes leer mi imagen?", telefono: phone18, sourceMessageId: `test18b_${Date.now()}`, origen: "script", simulated: true, skipRateLimit: true });
  const case18Text = case18.delivery?.respuesta || case18.respuesta || "";
  assert(/no alcancé a leer bien la imagen/i.test(case18Text), "18. imagen sin productos debe pedir una imagen más clara o texto", case18);
  checks.push({ case: 18, ok: true, result: case18Text });

  const phone19 = `57300012${Date.now().toString().slice(-4)}`;
  await ejecutarFlujoMensaje({ mensaje: "", telefono: phone19, sourceMessageId: `test19a_${Date.now()}`, origen: "script", simulated: true, messageType: "image", mediaId: `img_${Date.now()}`, mediaBuffer: Buffer.from("image-order-link"), mediaMimeType: "image/jpeg", mediaFilename: "pedido6.jpg", imageAnalysisOverride: simulatedImageAnalysis, skipRateLimit: true });
  await ejecutarFlujoMensaje({ mensaje: "cl 41 - 08 28 . Efectivo", telefono: phone19, sourceMessageId: `test19b_${Date.now()}`, origen: "script", simulated: true, skipRateLimit: true });
  const case19 = await ejecutarFlujoMensaje({ mensaje: "los de la imagen", telefono: phone19, sourceMessageId: `test19c_${Date.now()}`, origen: "script", simulated: true, skipRateLimit: true });
  const case19Text = case19.delivery?.respuesta || case19.respuesta || "";
  assert(/griego 500 g/i.test(case19Text) && /aloe litro 1000 ml|aloe litro/i.test(case19Text) && /dirección: cl 41 - 08 28/i.test(case19Text) && /pago: efectivo/i.test(case19Text) && /confirmas/i.test(case19Text), "19. imagen previa debe enlazarse al contexto activo con dirección y pago", case19);
  checks.push({ case: 19, ok: true, result: case19Text });

  const phone20 = `57300013${Date.now().toString().slice(-4)}`;
  await ejecutarFlujoMensaje({ mensaje: "", telefono: phone20, sourceMessageId: `test20a_${Date.now()}`, origen: "script", simulated: true, messageType: "image", mediaId: `img_${Date.now()}`, mediaBuffer: Buffer.from("image-order-es-pedido"), mediaMimeType: "image/jpeg", mediaFilename: "pedido7.jpg", imageAnalysisOverride: simulatedImageAnalysis, skipRateLimit: true });
  const case20 = await ejecutarFlujoMensaje({ mensaje: "es un pedido", telefono: phone20, sourceMessageId: `test20b_${Date.now()}`, origen: "script", simulated: true, skipRateLimit: true });
  const case20Text = case20.delivery?.respuesta || case20.respuesta || "";
  assert(/griego 500 g/i.test(case20Text) && /aloe litro 1000 ml|aloe litro/i.test(case20Text), "20. imagen previa + 'es un pedido' debe ejecutar OCR", case20);
  checks.push({ case: 20, ok: true, result: case20Text });

  const phone21 = `57300014${Date.now().toString().slice(-4)}`;
  const case21 = await ejecutarFlujoMensaje({ mensaje: "los de la imagen", telefono: phone21, sourceMessageId: `test21_${Date.now()}`, origen: "script", simulated: true, skipRateLimit: true });
  const case21Text = case21.delivery?.respuesta || case21.respuesta || "";
  assert(/envíame la imagen del pedido y la reviso/i.test(case21Text), "21. sin imagen previa debe pedir la imagen", case21);
  checks.push({ case: 21, ok: true, result: case21Text });

  const phone22 = `57300015${Date.now().toString().slice(-4)}`;
  await ejecutarFlujoMensaje({ mensaje: "", telefono: phone22, sourceMessageId: `test22a_${Date.now()}`, origen: "script", simulated: true, messageType: "image", mediaId: `img_${Date.now()}`, mediaBuffer: Buffer.from("expired-image"), mediaMimeType: "image/jpeg", mediaFilename: "pedido8.jpg", imageAnalysisOverride: simulatedImageAnalysis, skipRateLimit: true });
  const state22 = obtenerEstadoConversacion(phone22);
  if (state22?.lastImageContext) {
    state22.lastImageContext.timestamp = Date.now() - (60 * 60 * 1000);
    state22.lastImageTimestamp = state22.lastImageContext.timestamp;
  }
  const case22 = await ejecutarFlujoMensaje({ mensaje: "la foto", telefono: phone22, sourceMessageId: `test22b_${Date.now()}`, origen: "script", simulated: true, skipRateLimit: true });
  const case22Text = case22.delivery?.respuesta || case22.respuesta || "";
  assert(/envíame la imagen del pedido y la reviso/i.test(case22Text), "22. imagen expirada debe pedir una nueva imagen", case22);
  checks.push({ case: 22, ok: true, result: case22Text });

  const phone23 = `57300016${Date.now().toString().slice(-4)}`;
  await ejecutarFlujoMensaje({ mensaje: "", telefono: phone23, sourceMessageId: `test23a_${Date.now()}`, origen: "script", simulated: true, messageType: "image", mediaId: `img_${Date.now()}`, mediaBuffer: Buffer.from("confirm-image"), mediaMimeType: "image/jpeg", mediaFilename: "pedido9.jpg", imageAnalysisOverride: handwrittenAnalysis, skipRateLimit: true });
  await ejecutarFlujoMensaje({ mensaje: "cl 41 - 08 28 efectivo", telefono: phone23, sourceMessageId: `test23b_${Date.now()}`, origen: "script", simulated: true, skipRateLimit: true });
  const step23 = await ejecutarFlujoMensaje({ mensaje: "los de la imagen", telefono: phone23, sourceMessageId: `test23c_${Date.now()}`, origen: "script", simulated: true, skipRateLimit: true });
  const step23Text = step23.delivery?.respuesta || step23.respuesta || "";
  assert(/confirmas/i.test(step23Text), "23. antes de guardar con imagen debe pedir confirmación", step23);
  const case23 = await ejecutarFlujoMensaje({ mensaje: "sí", telefono: phone23, sourceMessageId: `test23d_${Date.now()}`, origen: "script", simulated: true, skipRateLimit: true });
  assert(Boolean(case23.order?.id), "23. tras confirmación debe guardar el pedido", case23);
  checks.push({ case: 23, ok: true, result: case23.order?.id || null });

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
}

run().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, details: error.details || null }, null, 2));
  process.exit(1);
});
