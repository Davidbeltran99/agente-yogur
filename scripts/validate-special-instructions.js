const {
  bootstrapCatalogoDesdeTreinta,
  getCatalogProductsCache,
  setCatalogProductsCache,
  ejecutarFlujoMensaje
} = require("../server");
const {
  syncCatalogProducts,
  listCatalogProducts
} = require("../db");

function assert(condition, message, details = null) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function getResponse(result) {
  return result?.delivery?.respuesta || result?.respuesta || "";
}

function getFirstItem(result) {
  return Array.isArray(result?.pedido?.productos) ? result.pedido.productos[0] : null;
}

function responseMentionsProductNote(response = "", note = "") {
  const normalizedResponse = String(response || "").toLowerCase();
  const normalizedNote = String(note || "").toLowerCase();
  return normalizedResponse.includes(`nota: ${normalizedNote}`) || normalizedResponse.includes(normalizedNote);
}

async function send(phone, message, extra = {}) {
  return ejecutarFlujoMensaje({
    mensaje: message,
    telefono: phone,
    sourceMessageId: `special_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    origen: "script",
    simulated: true,
    skipRateLimit: true,
    ...extra
  });
}

async function seedSpecialInstructionProducts() {
  const sourceUrl = "test://special-instructions";
  syncCatalogProducts([
    {
      id: "test-kefir-natural-1000",
      nombre: "Kefir Natural",
      precio_publico: 12000,
      precio_distribuidor: 10000,
      categoria: "Kefir",
      presentacion: "1000 ml",
      aliases: ["kefir", "kefir natural", "kéfir", "kefir litro", "kefir 1000"],
      activo: true
    },
    {
      id: "test-kefir-garrafa-1800",
      nombre: "Kefir Garrafa 1800 ml",
      precio_publico: 18000,
      precio_distribuidor: 15500,
      categoria: "Kefir",
      presentacion: "1800 ml",
      aliases: ["kefir grande", "kefir garrafa", "kéfir grande"],
      activo: true
    },
    {
      id: "test-yogurt-natural-1000",
      nombre: "Yogurt Natural 1000 ml",
      precio_publico: 9000,
      precio_distribuidor: 7800,
      categoria: "Yogurt",
      presentacion: "1000 ml",
      aliases: ["yogurt", "yogur", "yogurt natural", "yogur natural", "yogurt litro"],
      activo: true
    },
    {
      id: "test-griego-fruta-120",
      nombre: "Griego Fruta Unidad 120gr",
      precio_publico: 4500,
      precio_distribuidor: 4000,
      categoria: "Griego",
      presentacion: "120 gr",
      aliases: ["griego con fruta", "griego fruta", "griego fruta unidad"],
      activo: true
    }
  ], { sourceUrl });
  setCatalogProductsCache(listCatalogProducts({ activeOnly: true }));
}

async function run() {
  await bootstrapCatalogoDesdeTreinta();
  await seedSpecialInstructionProducts();

  const checks = [];

  const phone1 = `57310001${Date.now().toString().slice(-4)}`;
  const case1 = await send(phone1, "kefir sin azucar");
  const case1Item = getFirstItem(case1);
  assert(/kefir/i.test(case1Item?.producto || ""), "1. kefir sin azucar debe mantenerse en familia kefir", case1);
  assert(/sin azúcar/i.test(case1Item?.product_notes || ""), "1. kefir sin azucar debe guardar nota en el item", case1);
  assert(/nota: sin azúcar/i.test(getResponse(case1)), "1. respuesta debe mostrar la nota sin azúcar", case1);
  assert(!/presentación exacta/i.test(getResponse(case1)), "1. no debe pedir presentación exacta", case1);
  checks.push({ case: 1, ok: true, result: { producto: case1Item.producto, nota: case1Item.product_notes } });

  const phone2 = `57310002${Date.now().toString().slice(-4)}`;
  const case2 = await send(phone2, "1 yogurt con poca azucar");
  const case2Item = getFirstItem(case2);
  assert(case2Item?.producto === "Yogurt Natural 1000 ml", "2. yogurt con poca azucar debe resolver yogurt base", case2);
  assert(/poca azúcar/i.test(case2Item?.product_notes || ""), "2. yogurt con poca azucar debe guardar nota", case2);
  checks.push({ case: 2, ok: true, result: { producto: case2Item.producto, nota: case2Item.product_notes } });

  const phone3 = `57310003${Date.now().toString().slice(-4)}`;
  const case3 = await send(phone3, "2 kefir con poco colorante");
  const case3Item = getFirstItem(case3);
  assert(/kefir/i.test(case3Item?.producto || ""), "3. kefir con poco colorante debe mantenerse en familia kefir", case3);
  assert(Number(case3Item?.cantidad) === 2, "3. kefir con poco colorante debe conservar cantidad", case3);
  assert(/poco colorante/i.test(case3Item?.product_notes || ""), "3. kefir con poco colorante debe guardar nota", case3);
  checks.push({ case: 3, ok: true, result: { producto: case3Item.producto, cantidad: case3Item.cantidad, nota: case3Item.product_notes } });

  const phone4 = `57310004${Date.now().toString().slice(-4)}`;
  const case4 = await send(phone4, "yogurt sin colorante");
  const case4Item = getFirstItem(case4);
  assert(case4Item?.producto === "Yogurt Natural 1000 ml", "4. yogurt sin colorante debe resolver yogurt base", case4);
  assert(/sin colorante/i.test(case4Item?.product_notes || ""), "4. yogurt sin colorante debe guardar nota", case4);
  checks.push({ case: 4, ok: true, result: { producto: case4Item.producto, nota: case4Item.product_notes } });

  const phone5 = `57310005${Date.now().toString().slice(-4)}`;
  const case5 = await send(phone5, "griego con fruta");
  const case5Item = getFirstItem(case5);
  assert(case5Item?.producto === "Griego Fruta Unidad 120gr", "5. griego con fruta debe usar variante exacta", case5);
  assert(!case5Item?.product_notes, "5. griego con fruta no debe degradarse a nota si existe variante exacta", case5);
  checks.push({ case: 5, ok: true, result: { producto: case5Item.producto, nota: case5Item.product_notes || null } });

  const simulatedImageAnalysis = {
    items: [
      { raw_text: "2 griego 500", product_query: "griego 500 g", quantity: 2, confidence: 0.96 },
      { raw_text: "1 aloe litro", product_query: "aloe litro", quantity: 1, confidence: 0.91 }
    ],
    uncertain_lines: [],
    extracted_text: "2 griego 500\n1 aloe litro",
    address: null,
    payment_method: null,
    overall_confidence: 0.9
  };

  const phone6 = `57310006${Date.now().toString().slice(-4)}`;
  await send(phone6, "", {
    messageType: "image",
    mediaId: `img_${Date.now()}`,
    mediaBuffer: Buffer.from("special-image"),
    mediaMimeType: "image/jpeg",
    mediaFilename: "special.jpg",
    imageAnalysisOverride: simulatedImageAnalysis
  });
  const case6 = await send(phone6, "agrega kefir sin azucar");
  const kefirItem = (case6?.pedido?.productos || []).find((item) => /kefir/i.test(item?.producto || ""));
  assert(kefirItem, "6. después de imagen debe permitir agregar kefir con instrucción especial", case6);
  assert(/sin azúcar/i.test(kefirItem?.product_notes || ""), "6. kefir agregado tras imagen debe guardar nota", case6);
  assert(responseMentionsProductNote(getResponse(case6), "sin azúcar"), "6. respuesta tras imagen debe mencionar la nota", case6);
  checks.push({ case: 6, ok: true, result: (case6.pedido?.productos || []).map((item) => ({ producto: item.producto, nota: item.product_notes || null })) });

  const phone7 = `57310007${Date.now().toString().slice(-4)}`;
  const case7 = await send(phone7, "1 kefir grande sin azucar, 2 cafe litro y 5 griego grande");
  const case7Items = case7?.pedido?.productos || [];
  const case7Kefir = case7Items.find((item) => /kefir/i.test(item?.producto || ""));
  const case7Cafe = case7Items.find((item) => /caf[eé]/i.test(item?.producto || ""));
  const case7Griego = case7Items.find((item) => /griego/i.test(item?.producto || ""));
  assert(case7Kefir && /sin azúcar/i.test(case7Kefir?.product_notes || ""), "7. kefir debe conservar la nota sin azúcar", case7);
  assert(case7Cafe && !(case7Cafe?.product_notes || ""), "7. café no debe heredar nota", case7);
  assert(case7Griego && !(case7Griego?.product_notes || ""), "7. griego no debe heredar nota", case7);
  assert(/1800 ml|garrafa/i.test(case7Kefir?.producto || ""), "7. kefir grande debe preferir presentación grande", case7);
  checks.push({ case: 7, ok: true, result: case7Items.map((item) => ({ producto: item.producto, nota: item.product_notes || null })) });

  const phone8 = `57310008${Date.now().toString().slice(-4)}`;
  const case8 = await send(phone8, "kefir de qué presentación tienes");
  assert(/kefir/i.test(getResponse(case8)), "8. catálogo dirigido de kefir debe mencionarlo", case8);
  assert(!/aloe|ancheta|caf[eé] litro/i.test(getResponse(case8)), "8. catálogo dirigido de kefir no debe mostrar catálogo general", case8);
  checks.push({ case: 8, ok: true, result: getResponse(case8) });

  const phone9 = `57310009${Date.now().toString().slice(-4)}`;
  const case9 = await send(phone9, "agrega 1 kefir de 1000");
  const case9Item = getFirstItem(case9);
  assert(case9Item?.producto === "Kefir Natural", "9. kefir de 1000 debe resolver solo en familia kefir", case9);
  assert(Number(case9Item?.cantidad) === 1, "9. kefir de 1000 no debe usar 1000 como cantidad", case9);
  checks.push({ case: 9, ok: true, result: { producto: case9Item.producto, cantidad: case9Item.cantidad } });

  const phone10 = `57310010${Date.now().toString().slice(-4)}`;
  const case10 = await send(phone10, "agrega un kefir grande");
  const case10Item = getFirstItem(case10);
  assert(/kefir/i.test(case10Item?.producto || ""), "10. kefir grande debe mantenerse en familia kefir", case10);
  assert(/1800 ml|garrafa/i.test(case10Item?.producto || ""), "10. kefir grande debe usar presentación grande", case10);
  checks.push({ case: 10, ok: true, result: { producto: case10Item.producto, cantidad: case10Item.cantidad } });

  const phone11 = `57310011${Date.now().toString().slice(-4)}`;
  await send(phone11, "necesito un KEFIR");
  const case11 = await send(phone11, "grande");
  const case11Item = getFirstItem(case11);
  assert(/kefir/i.test(case11Item?.producto || ""), "11. respuesta pendiente 'grande' debe resolverse a kefir", case11);
  assert(!/griego|aloe|caf[eé]|ancheta/i.test(case11Item?.producto || ""), "11. kefir pendiente nunca debe resolverse como otra familia", case11);
  checks.push({ case: 11, ok: true, result: { producto: case11Item.producto, cantidad: case11Item.cantidad } });

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
}

run().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, details: error.details || null }, null, 2));
  process.exit(1);
});
