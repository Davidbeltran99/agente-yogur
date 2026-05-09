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
      aliases: ["kefir", "kefir natural", "kéfir", "kefir litro"],
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
  assert(case1Item?.producto === "Kefir Natural", "1. kefir sin azucar debe resolver el producto base", case1);
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
  assert(case3Item?.producto === "Kefir Natural", "3. kefir con poco colorante debe resolver kefir base", case3);
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
  const kefirItem = (case6?.pedido?.productos || []).find((item) => item?.producto === "Kefir Natural");
  assert(kefirItem, "6. después de imagen debe permitir agregar kefir con instrucción especial", case6);
  assert(/sin azúcar/i.test(kefirItem?.product_notes || ""), "6. kefir agregado tras imagen debe guardar nota", case6);
  assert(responseMentionsProductNote(getResponse(case6), "sin azúcar"), "6. respuesta tras imagen debe mencionar la nota", case6);
  checks.push({ case: 6, ok: true, result: (case6.pedido?.productos || []).map((item) => ({ producto: item.producto, nota: item.product_notes || null })) });

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
}

run().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, details: error.details || null }, null, 2));
  process.exit(1);
});
