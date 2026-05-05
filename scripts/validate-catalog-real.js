const axios = require("axios");
const { DatabaseSync } = require("node:sqlite");
const path = require("path");

const port = Number(process.env.PORT || 3000);
const api = axios.create({ baseURL: `http://127.0.0.1:${port}`, timeout: 180000 });
const dbPath = path.join(__dirname, "..", "data", "agente-yogur.sqlite");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const db = new DatabaseSync(dbPath);
  const catalogRows = db.prepare(`SELECT id, nombre, precio, activo FROM catalog_products WHERE activo = 1 ORDER BY nombre ASC`).all();
  assert(catalogRows.length >= 12, `Se esperaban al menos 12 productos activos y hay ${catalogRows.length}`);
  assert(catalogRows.some((row) => row.nombre === "Aloe Litro" && Number(row.precio) === 12000), "No se encontró Aloe Litro con precio correcto en catalog_products");
  assert(catalogRows.some((row) => row.nombre === "Café litro" && Number(row.precio) === 12000), "No se encontró Café litro con precio correcto en catalog_products");

  const validPhone = `5732${Date.now().toString().slice(-8)}`;
  const validMessage = "Quiero 3 aloe litro, 2 café litro y 1 ancheta. Dirección Calle 10 #20-30. Pago Nequi.";
  const valid = await api.post("/simulate-message", { telefono: validPhone, mensaje: validMessage });
  assert(valid.data.ok === true, "Caso válido no respondió ok=true");
  assert(valid.data.order?.id, "Caso válido no creó order");
  assert(valid.data.order?.items?.length === 3, `Caso válido esperaba 3 items y recibió ${valid.data.order?.items?.length}`);
  assert(valid.data.order?.resumenItems === "3 Aloe Litro, 2 Café litro, 1 Ancheta", `Resumen inesperado: ${valid.data.order?.resumenItems}`);

  const quantities = Object.fromEntries(valid.data.order.items.map((item) => [item.producto, item.cantidad]));
  assert(quantities["Aloe Litro"] === 3, "Cantidad incorrecta para Aloe Litro");
  assert(quantities["Café litro"] === 2, "Cantidad incorrecta para Café litro");
  assert(quantities["Ancheta"] === 1, "Cantidad incorrecta para Ancheta");

  const prices = Object.fromEntries(valid.data.order.items.map((item) => [item.producto, item.precioUnitario]));
  assert(prices["Aloe Litro"] === 12000, "Precio incorrecto para Aloe Litro");
  assert(prices["Café litro"] === 12000, "Precio incorrecto para Café litro");
  assert(prices["Ancheta"] === 45000, "Precio incorrecto para Ancheta");
  assert(Number(valid.data.order?.total) === 105000, `Total incorrecto para el pedido válido: ${valid.data.order?.total}`);

  const crm = await api.get(`/conversations/${validPhone}/messages`);
  assert(crm.data.total === 2, `CRM debía tener 2 mensajes y tiene ${crm.data.total}`);
  assert(crm.data.messages.every((message) => message.orderId === valid.data.order.id), "CRM no mantuvo order_id en el caso válido");

  const dbItems = db.prepare(`SELECT producto, cantidad, precio_unitario, subtotal FROM order_items WHERE order_id = ? ORDER BY rowid ASC`).all(valid.data.order.id);
  const dbOrder = db.prepare(`SELECT total FROM orders WHERE id = ?`).get(valid.data.order.id);
  assert(dbItems.length === 3, `SQLite debía tener 3 items y tiene ${dbItems.length}`);
  assert(dbItems.some((row) => row.producto === "Aloe Litro" && Number(row.subtotal) === 36000), "Subtotal incorrecto para Aloe Litro");
  assert(dbItems.some((row) => row.producto === "Café litro" && Number(row.subtotal) === 24000), "Subtotal incorrecto para Café litro");
  assert(dbItems.some((row) => row.producto === "Ancheta" && Number(row.subtotal) === 45000), "Subtotal incorrecto para Ancheta");
  assert(Number(dbOrder?.total) === 105000, `Total incorrecto en SQLite: ${dbOrder?.total}`);

  const invalidPhone = `5732${(Date.now() + 1).toString().slice(-8)}`;
  const invalid = await api.post("/simulate-message", { telefono: invalidPhone, mensaje: "Quiero 1 producto inventado. Dirección Calle 1 #2-3. Pago Nequi." });
  assert(invalid.data.order === null, "Caso inválido no debía crear order");
  assert(invalid.data.evaluacion?.catalogStatus === "not_found", "Caso inválido debía quedar not_found");
  assert(invalid.data.respuesta === "No encontré ese producto exacto en el catálogo. Puedes revisarlo aquí: https://catalogo.treinta.co/tellolac y enviarme el nombre como aparece.", "Respuesta inválida inesperada");

  const ambiguousPhone = `5732${(Date.now() + 2).toString().slice(-8)}`;
  const ambiguous = await api.post("/simulate-message", { telefono: ambiguousPhone, mensaje: "Quiero 1 aloe garrafa. Dirección Calle 1 #2-3. Pago Nequi." });
  assert(ambiguous.data.order === null, "Caso ambiguo no debía crear order");
  assert(ambiguous.data.evaluacion?.catalogStatus === "ambiguous", "Caso ambiguo debía quedar ambiguous");
  assert((ambiguous.data.evaluacion?.ambiguousProducts || [])[0]?.options?.includes("Aloe garrafa 1.8 Ml"), "Caso ambiguo no devolvió opciones esperadas");

  db.close();

  console.log(JSON.stringify({
    port,
    catalogCount: catalogRows.length,
    valid: {
      phone: validPhone,
      orderId: valid.data.order.id,
      resumenItems: valid.data.order.resumenItems,
      total: valid.data.order.total,
      items: valid.data.order.items
    },
    invalid: {
      phone: invalidPhone,
      catalogStatus: invalid.data.evaluacion.catalogStatus,
      respuesta: invalid.data.respuesta
    },
    ambiguous: {
      phone: ambiguousPhone,
      catalogStatus: ambiguous.data.evaluacion.catalogStatus,
      options: ambiguous.data.evaluacion.ambiguousProducts
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error.response?.data || error.stack || error.message);
  process.exit(1);
});
