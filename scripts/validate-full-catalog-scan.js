const {
  ejecutarFlujoMensaje,
  resolverProductoCatalogo,
  setCatalogProductsCache
} = require("../server");
const { syncCatalogProducts, listCatalogProducts } = require("../db");

function assert(condition, message, details = null) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hasProduct(items = [], query = "") {
  const target = normalize(query);
  return items.some((item) => normalize(item?.producto).includes(target));
}

function getProducts(result) {
  return result?.pedido?.productos || [];
}

function responseIncludes(result, query = "") {
  return normalize(result?.respuesta || result?.delivery?.respuesta || "").includes(normalize(query));
}

async function send(phone, mensaje, extra = {}) {
  return ejecutarFlujoMensaje({
    mensaje,
    telefono: phone,
    sourceMessageId: extra.sourceMessageId || `fullscan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    origen: "script",
    simulated: true,
    skipRateLimit: true,
    ...extra
  });
}

async function seedCatalog() {
  syncCatalogProducts([
    {
      id: "scan-aloe-garrafa-1800",
      nombre: "Aloe Garrafa 1800 ml",
      precio_publico: 18000,
      precio_distribuidor: 16000,
      categoria: "Aloe",
      presentacion: "1800 ml",
      aliases: ["aloe", "aloe garrafa", "aloe grande", "aloe 1800"],
      activo: true
    },
    {
      id: "scan-fresa-fit-litro-1000",
      nombre: "Fresa Fit Litro 1000 ml",
      precio_publico: 14000,
      precio_distribuidor: 12500,
      categoria: "Yogurt",
      presentacion: "1000 ml",
      aliases: ["fresa fit", "fresa fit litro", "fit litro", "fresa fit 1000"],
      activo: true
    },
    {
      id: "scan-fresa-galon-4l",
      nombre: "Fresa Galón 4 Litros",
      precio_publico: 36000,
      precio_distribuidor: 32000,
      categoria: "Yogurt",
      presentacion: "4 litros",
      aliases: ["fresa galon", "fresa galon 4 litros", "galon 4 litros", "galon fresa"],
      activo: true
    },
    {
      id: "scan-frutos-rojos-garrafa-1800",
      nombre: "Frutos Rojos Garrafa 1800 ml",
      precio_publico: 18500,
      precio_distribuidor: 16500,
      categoria: "Yogurt",
      presentacion: "1800 ml",
      aliases: ["frutos rojos", "frutos rojos garrafa", "frutos rojos grande", "garrafa frutos rojos"],
      activo: true
    },
    {
      id: "scan-griego-250",
      nombre: "Griego 250 g",
      precio_publico: 6500,
      precio_distribuidor: 5800,
      categoria: "Griego",
      presentacion: "250 g",
      aliases: ["griego 250", "griego pequeno"],
      activo: true
    }
  ], { sourceUrl: "test://full-catalog-scan" });
  const catalog = listCatalogProducts({ activeOnly: true }).filter((product) => String(product?.id || "").startsWith("scan-"));
  setCatalogProductsCache(catalog);
}

async function run() {
  await seedCatalog();
  const checks = [];

  const direct1 = resolverProductoCatalogo("frutos rojos");
  assert(direct1.status === "matched" && /frutos rojos/i.test(direct1.product?.nombre || ""), "1. frutos rojos debe recorrer todo el catálogo", direct1);
  checks.push({ case: 1, ok: true, result: direct1.product?.nombre || null });

  const direct2 = resolverProductoCatalogo("fresa fit litro");
  assert(direct2.status === "matched" && /fresa fit/i.test(direct2.product?.nombre || ""), "2. fresa fit litro debe recorrer todo el catálogo", direct2);
  checks.push({ case: 2, ok: true, result: direct2.product?.nombre || null });

  const direct3 = resolverProductoCatalogo("galon 4 litros");
  assert(direct3.status === "matched" && /galon 4 litros/i.test(normalize(direct3.product?.nombre || "")), "3. galón 4 litros debe resolver el producto real", direct3);
  checks.push({ case: 3, ok: true, result: direct3.product?.nombre || null });

  const phone4 = `57320004${Date.now().toString().slice(-4)}`;
  const imageAnalysis = {
    items: [
      { raw_text: "Griego 250 g", product_query: "griego 250 g", quantity: 1, confidence: 0.31 },
      { raw_text: "Aloe Garrafa 1800 ml", product_query: "aloe garrafa 1800 ml", quantity: 1, confidence: 0.96 }
    ],
    uncertain_lines: [
      { text: "Fresa Fit Litro 1000 ml", confidence: 0.72 },
      { text: "Fresa Galón 4 Litros", confidence: 0.7 },
      { text: "Frutos Rojos Garrafa 1800 ml", confidence: 0.75 }
    ],
    extracted_text: "Aloe Garrafa 1800 ml\nFresa Fit Litro 1000 ml\nFresa Galón 4 Litros\nFrutos Rojos Garrafa 1800 ml",
    address: null,
    payment_method: null,
    overall_confidence: 0.78
  };
  await send(phone4, "", {
    messageType: "image",
    mediaId: `img_${Date.now()}`,
    mediaBuffer: Buffer.from("full-cart"),
    mediaMimeType: "image/jpeg",
    mediaFilename: "carrito.jpg",
    imageAnalysisOverride: imageAnalysis
  });
  const case4 = await send(phone4, "es un pedido");
  const case4Items = getProducts(case4);
  assert(hasProduct(case4Items, "aloe garrafa 1800 ml"), "4. imagen debe conservar aloe", case4);
  assert(hasProduct(case4Items, "fresa fit litro 1000 ml"), "4. imagen debe rescatar fresa fit desde OCR completo", case4);
  assert(hasProduct(case4Items, "fresa galon 4 litros"), "4. imagen debe rescatar fresa galón desde OCR completo", case4);
  assert(hasProduct(case4Items, "frutos rojos garrafa 1800 ml"), "4. imagen debe rescatar frutos rojos desde OCR completo", case4);
  assert(!hasProduct(case4Items, "griego 250 g"), "4. imagen no debe quedarse con el match parcial equivocado", case4);
  checks.push({ case: 4, ok: true, result: case4Items.map((item) => item.producto) });

  const phone5 = `57320005${Date.now().toString().slice(-4)}`;
  await send(phone5, "1 aloe garrafa 1800 ml", { messageType: "text" });
  const case5 = await send(phone5, "agrega frutos rojos", {
    messageType: "audio",
    transcription: "agrega frutos rojos",
    mediaId: `aud_${Date.now()}`
  });
  const case5Items = getProducts(case5);
  assert(
    (hasProduct(case5Items, "aloe garrafa 1800 ml") || responseIncludes(case5, "aloe garrafa 1800 ml"))
      && (hasProduct(case5Items, "frutos rojos garrafa 1800 ml") || responseIncludes(case5, "frutos rojos garrafa 1800 ml")),
    "5. audio frutos rojos debe entrar al mismo pipeline completo",
    case5
  );
  checks.push({ case: 5, ok: true, result: case5Items.map((item) => item.producto) });

  const phone6 = `57320006${Date.now().toString().slice(-4)}`;
  await send(phone6, "1 aloe garrafa 1800 ml", { messageType: "text" });
  const case6 = await send(phone6, "agrega fresa fit litro", {
    messageType: "audio",
    transcription: "agrega fresa fit litro",
    mediaId: `aud_${Date.now()}_fit`
  });
  const case6Items = getProducts(case6);
  assert(
    hasProduct(case6Items, "fresa fit litro 1000 ml") || responseIncludes(case6, "fresa fit litro 1000 ml"),
    "6. audio fresa fit debe recorrer todo el catálogo",
    case6
  );
  checks.push({ case: 6, ok: true, result: case6Items.map((item) => item.producto) });

  const phone7 = `57320007${Date.now().toString().slice(-4)}`;
  await send(phone7, "1 aloe garrafa 1800 ml", { messageType: "text" });
  const case7 = await send(phone7, "agrega galon 4 litros", {
    messageType: "audio",
    transcription: "agrega galon 4 litros",
    mediaId: `aud_${Date.now()}_galon`
  });
  const case7Items = getProducts(case7);
  assert(
    hasProduct(case7Items, "fresa galon 4 litros") || responseIncludes(case7, "fresa galon 4 litros"),
    "7. audio galón 4 litros debe resolver el producto real",
    case7
  );
  checks.push({ case: 7, ok: true, result: case7Items.map((item) => item.producto) });

  const phone8 = `57320008${Date.now().toString().slice(-4)}`;
  const partialImage = {
    items: [
      { raw_text: "Aloe Garrafa 1800 ml", product_query: "aloe garrafa 1800 ml", quantity: 1, confidence: 0.96 },
      { raw_text: "Fresa Fit Litro 1000 ml", product_query: "fresa fit litro 1000 ml", quantity: 1, confidence: 0.93 }
    ],
    uncertain_lines: [],
    extracted_text: "Aloe Garrafa 1800 ml\nFresa Fit Litro 1000 ml",
    address: null,
    payment_method: null,
    overall_confidence: 0.9
  };
  await send(phone8, "", {
    messageType: "image",
    mediaId: `img_${Date.now()}_partial`,
    mediaBuffer: Buffer.from("partial-cart"),
    mediaMimeType: "image/jpeg",
    mediaFilename: "carrito-parcial.jpg",
    imageAnalysisOverride: partialImage
  });
  await send(phone8, "es un pedido");
  await send(phone8, "agrega frutos rojos", {
    messageType: "audio",
    transcription: "agrega frutos rojos",
    mediaId: `aud_${Date.now()}_mix1`
  });
  const case8 = await send(phone8, "agrega galon 4 litros", {
    messageType: "audio",
    transcription: "agrega galon 4 litros",
    mediaId: `aud_${Date.now()}_mix2`
  });
  const case8Items = getProducts(case8);
  assert(hasProduct(case8Items, "aloe garrafa 1800 ml") || responseIncludes(case8, "aloe garrafa 1800 ml"), "8. mix imagen+audio debe mantener aloe", case8);
  assert(hasProduct(case8Items, "fresa fit litro 1000 ml") || responseIncludes(case8, "fresa fit litro 1000 ml"), "8. mix imagen+audio debe mantener fresa fit", case8);
  assert(hasProduct(case8Items, "frutos rojos garrafa 1800 ml") || responseIncludes(case8, "frutos rojos garrafa 1800 ml"), "8. mix imagen+audio debe sumar frutos rojos", case8);
  assert(hasProduct(case8Items, "fresa galon 4 litros") || responseIncludes(case8, "fresa galon 4 litros"), "8. mix imagen+audio debe sumar galón 4 litros", case8);
  checks.push({ case: 8, ok: true, result: case8Items.map((item) => item.producto) });

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
}

run().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, details: error.details || null }, null, 2));
  process.exit(1);
});
