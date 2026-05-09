const axios = require("axios");

const DEFAULT_CATALOG_URL = "https://catalogo.treinta.co/tellolac";

function normalizeText(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeCatalogText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/(\d)\s*[.,]\s*(\d)/g, "$1.$2")
    .toLowerCase()
    .replace(/[^a-z0-9.+\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMaybeJsonObject(rawObject) {
  if (!rawObject) {
    return null;
  }

  try {
    return JSON.parse(rawObject.replace(/\\\"/g, '"').replace(/\\\\/g, "\\"));
  } catch (_error) {
    return null;
  }
}

function normalizeVolumeAliases(name) {
  const aliases = new Set();
  const normalized = normalizeCatalogText(name);

  if (!normalized) {
    return aliases;
  }

  aliases.add(normalized);
  aliases.add(normalized.replace(/\s*\+\s*/g, " + "));

  if (/1\s*[.,]\s*8\s*ml/.test(normalized)) {
    aliases.add(normalized.replace(/1\s*[.,]\s*8\s*ml/g, "1800 ml"));
    aliases.add(normalized.replace(/1\s*[.,]\s*8\s*ml/g, "1800ml"));
    aliases.add(normalized.replace(/1\s*[.,]\s*8\s*ml/g, "1.8 ml"));
    aliases.add(normalized.replace(/1\s*[.,]\s*8\s*ml/g, "1.8ml"));
  }

  if (/1800\s*ml/.test(normalized)) {
    aliases.add(normalized.replace(/1800\s*ml/g, "1.8 ml"));
    aliases.add(normalized.replace(/1800\s*ml/g, "1.8ml"));
    aliases.add(normalized.replace(/1800\s*ml/g, "1800ml"));
  }

  if (/1000\s*ml/.test(normalized)) {
    aliases.add(normalized.replace(/1000\s*ml/g, "1000ml"));
  }

  aliases.add(normalized.replace(/\s+/g, " "));
  aliases.add(normalized.replace(/\s+/g, ""));

  return new Set(Array.from(aliases).map((alias) => alias.trim()).filter(Boolean));
}

function buildSizeSemanticAliases(name) {
  const aliases = new Set();
  const normalized = normalizeCatalogText(name);

  if (!normalized) {
    return aliases;
  }

  const familyBase = normalized
    .replace(/\b(1800\s*ml|1800ml|1000\s*ml|1000ml|1000\s*g|1000g|500\s*g|500g|250\s*g|250g|1\s*kg|1kg|kilo|kg|gramos?|gr|ml|lt|litro|garrafa)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!familyBase) {
    return aliases;
  }

  if (/\b(1800\s*ml|1800ml|1\s*[.,]?\s*8\s*ml|garrafa)\b/.test(normalized)) {
    aliases.add(`${familyBase} grande`);
    aliases.add(`${familyBase} garrafa`);
    aliases.add(`${familyBase} familiar`);
  }

  if (/\b(1000\s*ml|1000ml|litro)\b/.test(normalized)) {
    aliases.add(`${familyBase} litro`);
    aliases.add(`${familyBase} 1000 ml`);
    aliases.add(`${familyBase} 1000ml`);
    aliases.add(`${familyBase} pequeno`);
  }

  if (/\b(1000\s*g|1000g|1\s*kg|1kg|kilo|kg)\b/.test(normalized)) {
    aliases.add(`${familyBase} grande`);
    aliases.add(`${familyBase} de kilo`);
    aliases.add(`${familyBase} kilo`);
    aliases.add(`${familyBase} 1 kilo`);
    aliases.add(`${familyBase} 1kg`);
    aliases.add(`${familyBase} 1000 g`);
    aliases.add(`${familyBase} 1000g`);
  }

  if (/\b(500\s*g|500g|medio\s*kilo)\b/.test(normalized)) {
    aliases.add(`${familyBase} pequeno`);
    aliases.add(`${familyBase} medio kilo`);
    aliases.add(`${familyBase} 500 g`);
    aliases.add(`${familyBase} 500g`);
  }

  return new Set(Array.from(aliases).map((alias) => alias.trim()).filter(Boolean));
}

function buildConversationalAliases(name) {
  const aliases = new Set();
  const normalized = normalizeCatalogText(name);

  if (!normalized) {
    return aliases;
  }

  const variants = new Set([normalized]);

  if (/\byogurt\b/.test(normalized)) {
    variants.add(normalized.replace(/\byogurt\b/g, "yogur"));
    variants.add(normalized.replace(/\byogurt\b/g, "yoghurt"));
    variants.add(normalized.replace(/\byogurt\b/g, "yogourt"));
  }

  if (/\byogur\b/.test(normalized)) {
    variants.add(normalized.replace(/\byogur\b/g, "yogurt"));
    variants.add(normalized.replace(/\byogur\b/g, "yoghurt"));
    variants.add(normalized.replace(/\byogur\b/g, "yogourt"));
  }

  if (/\bkefir\b/.test(normalized)) {
    variants.add(normalized.replace(/\bkefir\b/g, "kefyr"));
    variants.add(normalized.replace(/\bkefir\b/g, "kefir"));
  }

  if (/\bcafe\b/.test(normalized)) {
    variants.add(normalized.replace(/\bcafe\b/g, "cafee"));
    variants.add(normalized.replace(/\bcafe\b/g, "cafecito"));
  }

  if (/\baloe\b/.test(normalized)) {
    variants.add(normalized.replace(/\baloe\b/g, "aloee"));
    variants.add(normalized.replace(/\baloe\b/g, "sabila"));
  }

  if (/\bgriego\b/.test(normalized) && !/\byogur|\byogurt|\byogourt|\byoghurt/.test(normalized)) {
    variants.add(`yogur ${normalized}`);
    variants.add(`yogurt ${normalized}`);
    variants.add(`yogourt ${normalized}`);
  }

  for (const variant of variants) {
    aliases.add(variant);
    aliases.add(variant.replace(/(.)\1{2,}/g, "$1$1"));
  }

  return new Set(Array.from(aliases).map((alias) => alias.trim()).filter(Boolean));
}

function buildAliases(product) {
  const aliases = new Set();
  const explicitAliases = Array.isArray(product?.aliases) ? product.aliases : [];

  for (const alias of explicitAliases) {
    const normalized = normalizeCatalogText(alias);
    if (normalized) {
      aliases.add(normalized);
    }
  }

  for (const alias of normalizeVolumeAliases(product?.nombre)) {
    aliases.add(alias);
  }

  for (const alias of buildSizeSemanticAliases(product?.nombre)) {
    aliases.add(alias);
  }

  for (const alias of buildConversationalAliases(product?.nombre)) {
    aliases.add(alias);
  }

  return Array.from(aliases);
}

function cleanCategory(value) {
  const normalized = normalizeText(value);
  if (!normalized || normalized === "$undefined") {
    return null;
  }

  return normalized;
}

function inferPresentation(name) {
  const normalized = normalizeCatalogText(name);
  if (!normalized) {
    return null;
  }

  const volumeMatch = normalized.match(/\b(1800\s*ml|1000\s*ml|500\s*g|250\s*g|1\s*kg|1\.8\s*ml)\b/);
  if (volumeMatch?.[1]) {
    return volumeMatch[1].replace(/\s+/g, " ").trim();
  }

  if (/\bgarrafa\b/.test(normalized)) {
    return "garrafa";
  }

  if (/\blitro\b/.test(normalized)) {
    return "litro";
  }

  if (/\bkilo\b/.test(normalized)) {
    return "kilo";
  }

  return null;
}

function buildCatalogGroupingKey(name) {
  return normalizeCatalogText(name)
    .replace(/\b(publico|public|distribuidor|distributor)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickPreferredProduct(products = []) {
  return [...products].sort((a, b) => {
    const aScore = String(a?.nombre || "").includes(".") ? 0 : 1;
    const bScore = String(b?.nombre || "").includes(".") ? 0 : 1;
    if (aScore !== bScore) {
      return bScore - aScore;
    }

    return String(b?.nombre || "").length - String(a?.nombre || "").length;
  })[0] || products[0] || null;
}

function mergeCatalogProductsByPriceTier(products = []) {
  const grouped = new Map();

  for (const product of products) {
    const key = buildCatalogGroupingKey(product?.nombre);
    if (!key) {
      continue;
    }

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key).push(product);
  }

  return Array.from(grouped.values()).map((group) => {
    const preferred = pickPreferredProduct(group);
    const prices = group
      .map((item) => Number(item?.precio))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
    const stocks = group
      .map((item) => Number(item?.stock))
      .filter((value) => Number.isFinite(value));
    const aliases = new Set();

    for (const item of group) {
      for (const alias of buildAliases(item)) {
        aliases.add(alias);
      }

      const normalizedName = normalizeCatalogText(item?.nombre);
      if (normalizedName) {
        aliases.add(normalizedName);
      }
    }

    const precioDistribuidor = prices.length > 1 ? prices[0] : null;
    const precioPublico = prices.length ? prices[prices.length - 1] : null;

    return {
      id: preferred?.id,
      nombre: preferred?.nombre,
      precio: precioPublico,
      precio_publico: precioPublico,
      precio_distribuidor: precioDistribuidor,
      categoria: cleanCategory(preferred?.categoria),
      presentacion: normalizeText(preferred?.presentacion) || inferPresentation(preferred?.nombre),
      aliases: Array.from(aliases),
      activo: group.some((item) => item?.activo !== false),
      stock: stocks.length ? Math.max(...stocks) : (preferred?.stock ?? null)
    };
  }).filter((product) => product.id && product.nombre);
}

function parseInitialProductsFromHtml(html) {
  const products = [];
  const seen = new Set();
  const productPattern = /\{"id":"([^\"]+)","name":"([^\"]+)","description":"[^\"]*","price":([0-9.]+),"category":(\"[^\"]*\"|\$undefined|null),"imageUrl":"[^\"]*","imageUrls":[^,]*,"isVisible":(\d+),"stock":(-?\d+)/g;

  for (const match of html.matchAll(productPattern)) {
    const id = normalizeText(match[1]);
    const nombre = normalizeText(match[2]);
    const precio = Number(String(match[3] || "").replace(/\./g, ""));
    const categoriaRaw = String(match[4] || "").replace(/^\"|\"$/g, "");
    const isVisible = Number(match[5]);
    const stock = Number(match[6]);

    if (!id || !nombre || seen.has(id)) {
      continue;
    }

    seen.add(id);
    products.push({
      id,
      nombre,
      precio: Number.isFinite(precio) ? precio : null,
      categoria: cleanCategory(categoriaRaw),
      presentacion: inferPresentation(nombre),
      aliases: buildAliases({ nombre }),
      activo: isVisible !== 0,
      stock: Number.isFinite(stock) ? stock : null
    });
  }

  return products;
}

function parseCatalogProductsFromHtml(html) {
  const richProducts = parseInitialProductsFromHtml(html);
  if (richProducts.length) {
    return mergeCatalogProductsByPriceTier(richProducts);
  }

  const products = [];
  const seen = new Set();
  const cardPattern = /<a href="\/tellolac\/product\/([^"]+)">[\s\S]*?<h2[^>]*>([^<]+)<\/h2>[\s\S]*?<p[^>]*>\$[^0-9]*([0-9.]+)<\/p>/gi;

  for (const match of html.matchAll(cardPattern)) {
    const id = normalizeText(match[1]);
    const nombre = normalizeText(match[2]);
    const precio = Number(String(match[3] || "").replace(/\./g, ""));

    if (!id || !nombre || seen.has(id)) {
      continue;
    }

    seen.add(id);
    products.push({
      id,
      nombre,
      precio: Number.isFinite(precio) ? precio : null,
      categoria: null,
      presentacion: inferPresentation(nombre),
      aliases: [],
      activo: true,
      stock: null
    });
  }

  return mergeCatalogProductsByPriceTier(products.map((product) => ({
    ...product,
    aliases: buildAliases(product)
  })));
}

async function fetchCatalogProducts(catalogUrl = DEFAULT_CATALOG_URL) {
  const response = await axios.get(catalogUrl, {
    timeout: 30000,
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  const products = parseCatalogProductsFromHtml(String(response.data || ""));
  return {
    catalogUrl,
    fetchedAt: new Date().toISOString(),
    products
  };
}

module.exports = {
  DEFAULT_CATALOG_URL,
  normalizeCatalogText,
  buildAliases,
  parseCatalogProductsFromHtml,
  fetchCatalogProducts
};
