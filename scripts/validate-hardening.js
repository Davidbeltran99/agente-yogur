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

function countOrdersByPhone(db, phone) {
  return Number(db.prepare("SELECT COUNT(*) AS total FROM orders WHERE telefono = ?").get(phone)?.total || 0);
}

async function main() {
  const db = new DatabaseSync(dbPath);
  const dirtyCases = [
    { label: "mora_incompleto", mensaje: "quiero 2 de mora pa ya", response: /(me falta confirmar|revisa el catálogo|envíame el nombre exacto|no pude validar el precio)/i },
    { label: "siempre", mensaje: "mandame lo de siempre", response: /(me falta confirmar|lo que capté|envíame)/i },
    { label: "otro_normal", mensaje: "2 aloe y lo otro normal", response: /(me falta confirmar|revisa el catálogo|envíame el nombre exacto)/i },
    { label: "ayer", mensaje: "lo mismo de ayer", response: /(me falta confirmar|lo que capté|envíame)/i },
    { label: "hola", mensaje: "hola", response: /(catálogo|envíame el producto|productos aquí)/i }
  ];

  const dirtyResults = [];

  for (const [index, testCase] of dirtyCases.entries()) {
    const phone = `5736${Date.now().toString().slice(-6)}${index}`.slice(0, 10);
    const response = await api.post("/simulate-message", { telefono: phone, mensaje: testCase.mensaje });

    assert(response.data.ok === true, `${testCase.label}: ok debía ser true`);
    assert(response.data.order === null, `${testCase.label}: no debía guardar order`);
    assert(typeof response.data.respuesta === "string" && response.data.respuesta.length > 0, `${testCase.label}: debía responder algo útil`);
    assert(testCase.response.test(response.data.respuesta), `${testCase.label}: respuesta inesperada -> ${response.data.respuesta}`);
    assert(countOrdersByPhone(db, phone) === 0, `${testCase.label}: no debía escribirse en SQLite`);

    dirtyResults.push({
      label: testCase.label,
      phone,
      respuesta: response.data.respuesta,
      evaluacion: response.data.evaluacion
    });
  }

  const totalPhone = `5737${Date.now().toString().slice(-6)}`.slice(0, 10);
  const totalMessage = "Quiero 3 aloe litro, 2 café litro y 1 ancheta. Dirección Calle 10 #20-30. Pago transferencia.";
  const totalResponse = await api.post("/simulate-message", { telefono: totalPhone, mensaje: totalMessage });
  assert(totalResponse.data.order?.id, "Caso de totales debía crear order");
  assert(Number(totalResponse.data.order?.total) === 105000, `Total esperado 105000 y llegó ${totalResponse.data.order?.total}`);
  assert(/Total:\s*\$105\.000/i.test(totalResponse.data.respuesta), `Respuesta no mostró el total esperado: ${totalResponse.data.respuesta}`);

  const dbOrder = db.prepare("SELECT total FROM orders WHERE id = ?").get(totalResponse.data.order.id);
  assert(Number(dbOrder?.total) === 105000, `SQLite debía guardar total 105000 y guardó ${dbOrder?.total}`);

  const dedupePhone = `5738${Date.now().toString().slice(-6)}`.slice(0, 10);
  const dedupeMessage = "Quiero 1 aloe litro. Dirección Calle 1 #2-3. Pago efectivo.";
  const first = await api.post("/simulate-message", { telefono: dedupePhone, mensaje: dedupeMessage });
  const second = await api.post("/simulate-message", { telefono: dedupePhone, mensaje: dedupeMessage });
  assert(first.data.order?.id, "Dedupe: primer mensaje debía crear order");
  assert(second.data.ignored === true, "Dedupe: segundo mensaje debía ignorarse");
  assert(countOrdersByPhone(db, dedupePhone) === 1, "Dedupe: SQLite debía quedar con un solo order");

  const ratePhone = `5739${Date.now().toString().slice(-6)}`.slice(0, 10);
  const rateResults = [];
  for (let i = 0; i < 6; i += 1) {
    rateResults.push(await api.post("/simulate-message", { telefono: ratePhone, mensaje: `hola ${i}` }));
  }
  assert(rateResults.some((result) => result.data.ignoredReason === "rate_limit"), "Rate limit debía activarse en al menos un mensaje");

  db.close();

  console.log(JSON.stringify({
    dirtyResults,
    totals: {
      phone: totalPhone,
      orderId: totalResponse.data.order.id,
      total: totalResponse.data.order.total,
      respuesta: totalResponse.data.respuesta
    },
    dedupe: {
      phone: dedupePhone,
      firstOrderId: first.data.order.id,
      secondIgnored: second.data.ignored,
      secondReason: second.data.ignoredReason
    },
    rateLimit: rateResults.map((result) => ({
      ignored: result.data.ignored || false,
      ignoredReason: result.data.ignoredReason || null,
      respuesta: result.data.respuesta || null
    }))
  }, null, 2));
}

main().catch((error) => {
  console.error(error.response?.data || error.stack || error.message);
  process.exit(1);
});
