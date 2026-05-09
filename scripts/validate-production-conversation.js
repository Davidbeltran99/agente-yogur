const {
  bootstrapCatalogoDesdeTreinta,
  resolverProductoCatalogo,
  analizarProductosCatalogoDesdeTexto,
  ejecutarFlujoMensaje
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

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
}

run().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, details: error.details || null }, null, 2));
  process.exit(1);
});
