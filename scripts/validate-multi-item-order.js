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
  const phone = `57325${Date.now().toString().slice(-7)}`;
  const mensaje = "Hola soy Laura, quiero 3 aloe litro, 2 café litro y 1 ancheta 1. Dirección Calle 10 #20-30. Pago Nequi.";

  const simulate = await api.post("/simulate-message", { telefono: phone, mensaje });
  const orderId = simulate.data.order?.id;
  assert(simulate.data.ok === true, "simulate-message no respondió ok=true");
  assert(orderId, "No se creó order");
  assert(Array.isArray(simulate.data.order?.items), "El order no trae items");
  assert(simulate.data.order.items.length === 3, `Se esperaban 3 items y llegaron ${simulate.data.order.items.length}`);

  const byProduct = Object.fromEntries(simulate.data.order.items.map((item) => [item.producto, item.cantidad]));
  assert(byProduct['Aloe Litro'] === 3, "Cantidad incorrecta para Aloe Litro");
  assert(byProduct['Café litro'] === 2, "Cantidad incorrecta para Café litro");
  assert(byProduct['Ancheta 1'] === 1, "Cantidad incorrecta para Ancheta 1");

  const apiTotal = (simulate.data.order.items || []).reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0);
  assert(Number(simulate.data.order.total) === apiTotal, `Total API inconsistente: ${simulate.data.order.total} vs ${apiTotal}`);

  const crm = await api.get(`/conversations/${phone}/messages`);
  assert(crm.data.total === 2, `CRM debía tener 2 mensajes y tiene ${crm.data.total}`);
  assert(crm.data.messages.every((message) => message.orderId === orderId), "CRM no mantuvo order_id en todos los mensajes");

  const orders = await api.get(`/orders`);
  const createdOrder = (orders.data.orders || []).find((order) => order.id === orderId);
  assert(createdOrder, "El order nuevo no apareció en /orders");
  assert(createdOrder.resumenItems === '3 Aloe Litro, 2 Café litro, 1 Ancheta 1', `Resumen inesperado: ${createdOrder.resumenItems}`);

  const db = new DatabaseSync(dbPath);
  const itemRows = db.prepare(`
    SELECT producto, sabor, cantidad, precio_unitario, subtotal
    FROM order_items
    WHERE order_id = ?
    ORDER BY rowid ASC
  `).all(orderId);
  const orderRow = db.prepare(`SELECT total FROM orders WHERE id = ?`).get(orderId);
  db.close();

  assert(itemRows.length === 3, `SQLite debía tener 3 order_items y tiene ${itemRows.length}`);
  const dbTotal = itemRows.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0);
  assert(Number(orderRow?.total) === dbTotal, `Total SQLite inconsistente: ${orderRow?.total} vs ${dbTotal}`);

  console.log(JSON.stringify({
    port,
    phone,
    orderId,
    resumenItems: createdOrder.resumenItems,
    total: simulate.data.order.total,
    pedido: simulate.data.pedido,
    order: simulate.data.order,
    crmMessages: crm.data.messages,
    dbItems: itemRows,
    dbTotal: orderRow?.total
  }, null, 2));
}

main().catch((error) => {
  console.error(error.response?.data || error.stack || error.message);
  process.exit(1);
});
