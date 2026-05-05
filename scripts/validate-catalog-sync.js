const axios = require("axios");
const { DatabaseSync } = require("node:sqlite");
const path = require("path");

const api = axios.create({ baseURL: "http://127.0.0.1:3000", timeout: 180000 });
const dbPath = path.join(__dirname, "..", "data", "agente-yogur.sqlite");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getDbSnapshot(db) {
  const ordersCount = Number(db.prepare("SELECT COUNT(*) AS total FROM orders").get()?.total || 0);
  const orderItemsCount = Number(db.prepare("SELECT COUNT(*) AS total FROM order_items").get()?.total || 0);
  const sampleOrder = db.prepare("SELECT id FROM orders ORDER BY datetime(created_at) DESC LIMIT 1").get();
  const sampleOrderId = sampleOrder?.id || null;
  const sampleItems = sampleOrderId
    ? db.prepare(`SELECT producto, sabor, cantidad, precio_unitario, subtotal FROM order_items WHERE order_id = ? ORDER BY rowid ASC`).all(sampleOrderId)
    : [];

  return {
    ordersCount,
    orderItemsCount,
    sampleOrderId,
    sampleItems: JSON.stringify(sampleItems)
  };
}

async function main() {
  const db = new DatabaseSync(dbPath);
  const before = getDbSnapshot(db);

  const syncResponse = await api.post("/admin/catalog/sync");
  assert(syncResponse.data.ok === true, "El endpoint /admin/catalog/sync no respondió ok=true");
  assert(syncResponse.data.total >= 12, `Se esperaban al menos 12 productos totales y llegaron ${syncResponse.data.total}`);
  assert(syncResponse.data.active >= 12, `Se esperaban al menos 12 productos activos y llegaron ${syncResponse.data.active}`);
  assert(typeof syncResponse.data.inactive === "number", "inactive debe ser numérico");
  assert(syncResponse.data.syncedAt, "syncedAt es obligatorio");

  const catalogRows = db.prepare(`SELECT nombre, precio, activo FROM catalog_products ORDER BY LOWER(nombre) ASC`).all();
  assert(catalogRows.some((row) => row.nombre === "Aloe Litro" && Number(row.precio) === 12000 && Number(row.activo) === 1), "Aloe Litro no quedó activo con precio correcto");
  assert(catalogRows.some((row) => row.nombre === "Café litro" && Number(row.precio) === 12000 && Number(row.activo) === 1), "Café litro no quedó activo con precio correcto");

  const afterSync = getDbSnapshot(db);
  assert(afterSync.ordersCount === before.ordersCount, "El sync del catálogo no debía cambiar la cantidad de orders");
  assert(afterSync.orderItemsCount === before.orderItemsCount, "El sync del catálogo no debía cambiar la cantidad de order_items");
  assert(afterSync.sampleItems === before.sampleItems, "El sync del catálogo alteró items de pedidos existentes");

  const health = await api.get("/health");
  assert(health.data.ok === true, "Health endpoint no respondió ok=true");
  assert(health.data.catalogProducts === syncResponse.data.active, "Health no refleja la cantidad activa del catálogo");

  const phone = `5732${Date.now().toString().slice(-8)}`;
  const message = "Quiero 3 aloe litro, 2 café litro y 1 ancheta. Dirección Calle 10 #20-30. Pago Nequi.";
  const simulate = await api.post("/simulate-message", { telefono: phone, mensaje: message });

  assert(simulate.data.ok === true, "El parser dejó de funcionar después del sync");
  assert(simulate.data.order?.id, "No se creó order después del sync");
  assert(simulate.data.order?.resumenItems === "3 Aloe Litro, 2 Café litro, 1 Ancheta", `Resumen inesperado tras sync: ${simulate.data.order?.resumenItems}`);
  assert(simulate.data.sheets?.saved === true, "Sheets no guardó el pedido tras sync");
  assert(simulate.data.sheets?.rowsWritten === 3, `Sheets debía escribir 3 filas y escribió ${simulate.data.sheets?.rowsWritten}`);

  const crm = await api.get(`/conversations/${phone}/messages`);
  assert(crm.data.total === 2, `CRM debía tener 2 mensajes y tiene ${crm.data.total}`);
  assert(crm.data.messages.every((item) => item.orderId === simulate.data.order.id), "CRM no mantuvo order_id después del sync");

  const createdRows = db.prepare(`SELECT producto, cantidad, precio_unitario, subtotal FROM order_items WHERE order_id = ? ORDER BY rowid ASC`).all(simulate.data.order.id);
  assert(createdRows.length === 3, `El pedido nuevo debía tener 3 items y tiene ${createdRows.length}`);
  assert(createdRows.some((row) => row.producto === "Aloe Litro" && Number(row.subtotal) === 36000), "Subtotal incorrecto para Aloe Litro tras sync");
  assert(createdRows.some((row) => row.producto === "Café litro" && Number(row.subtotal) === 24000), "Subtotal incorrecto para Café litro tras sync");
  assert(createdRows.some((row) => row.producto === "Ancheta" && Number(row.subtotal) === 45000), "Subtotal incorrecto para Ancheta tras sync");

  db.close();

  console.log(JSON.stringify({
    sync: syncResponse.data,
    parser: {
      phone,
      orderId: simulate.data.order.id,
      resumenItems: simulate.data.order.resumenItems,
      sheets: simulate.data.sheets
    },
    crm: {
      phone,
      totalMessages: crm.data.total,
      orderIds: [...new Set(crm.data.messages.map((item) => item.orderId))]
    },
    integrity: {
      ordersBeforeSync: before.ordersCount,
      orderItemsBeforeSync: before.orderItemsCount,
      sampleOrderId: before.sampleOrderId,
      preserved: true
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error.response?.data || error.stack || error.message);
  process.exit(1);
});
