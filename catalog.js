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

  return Array.from(aliases);
}

function cleanCategory(value) {
  const normalized = normalizeText(value);
  if (!normalized || normalized === "$undefined") {
    return null;
  }

  return normalized;
}

function parseCatalogProductsFromHtml(html) {
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
      aliases: [],
      activo: true,
      stock: null
    });
  }

  return products.map((product) => ({
    ...product,
    aliases: buildAliases(product)
  }));
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
