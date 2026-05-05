const axios = require("axios");

const api = axios.create({ baseURL: "http://127.0.0.1:3000", timeout: 180000 });
const DELIVERY_TIMEZONE_OFFSET_MINUTES = Number(process.env.DELIVERY_TIMEZONE_OFFSET_MINUTES || -300);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getServiceDateParts(baseDate = new Date()) {
  const shifted = new Date(baseDate.getTime() + (DELIVERY_TIMEZONE_OFFSET_MINUTES * 60 * 1000));

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay()
  };
}

function toServiceIso(year, month, day, hour, minute = 0) {
  return new Date(Date.UTC(year, month, day, hour, minute, 0, 0) - (DELIVERY_TIMEZONE_OFFSET_MINUTES * 60 * 1000)).toISOString();
}

function expectedTodayAt(hour, minute = 0) {
  const parts = getServiceDateParts();
  return toServiceIso(parts.year, parts.month, parts.day, hour, minute);
}

function expectedTomorrowMorning() {
  const parts = getServiceDateParts();
  return toServiceIso(parts.year, parts.month, parts.day + 1, 9, 0);
}

function expectedUpcomingFridayMorning() {
  const parts = getServiceDateParts();
  const currentWeekday = parts.weekday;
  let delta = (5 - currentWeekday + 7) % 7;

  if (delta === 0) {
    delta = 7;
  }

  return toServiceIso(parts.year, parts.month, parts.day + delta, 9, 0);
}

async function simulate(mensaje) {
  const phone = `5732${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`.slice(0, 12);
  const response = await api.post("/simulate-message", { telefono: phone, mensaje });
  return { phone, data: response.data };
}

async function main() {
  const today = await simulate("Hola, soy Laura. Quiero 2 Aloe Litro para hoy a las 4 pm. Dirección Calle 10 #20-30. Pago Nequi.");
  assert(today.data.ok === true, "Caso hoy 4 pm no respondió ok=true");
  assert(today.data.pedido?.fecha_entrega === expectedTodayAt(16, 0), `Fecha incorrecta para hoy 4 pm: ${today.data.pedido?.fecha_entrega}`);

  const tomorrow = await simulate("Hola, soy Laura. Quiero 1 Aloe Litro para mañana en la mañana. Dirección Calle 10 #20-30. Pago Nequi.");
  assert(tomorrow.data.ok === true, "Caso mañana en la mañana no respondió ok=true");
  assert(tomorrow.data.pedido?.fecha_entrega === expectedTomorrowMorning(), `Fecha incorrecta para mañana en la mañana: ${tomorrow.data.pedido?.fecha_entrega}`);

  const friday = await simulate("Hola, soy Laura. Quiero 1 Aloe Litro para el viernes. Dirección Calle 10 #20-30. Pago Nequi.");
  assert(friday.data.ok === true, "Caso el viernes no respondió ok=true");
  assert(friday.data.pedido?.fecha_entrega === expectedUpcomingFridayMorning(), `Fecha incorrecta para el viernes: ${friday.data.pedido?.fecha_entrega}`);

  const noDate = await simulate("Hola, soy Laura. Quiero 1 Aloe Litro. Dirección Calle 10 #20-30. Pago Nequi.");
  assert(noDate.data.ok === true, "Caso sin fecha no respondió ok=true");
  assert(noDate.data.pedido?.fecha_entrega === null, `Sin fecha debía quedar null y llegó ${noDate.data.pedido?.fecha_entrega}`);

  console.log(JSON.stringify({
    today: {
      phone: today.phone,
      fecha_entrega: today.data.pedido.fecha_entrega,
      expected: expectedTodayAt(16, 0)
    },
    tomorrow: {
      phone: tomorrow.phone,
      fecha_entrega: tomorrow.data.pedido.fecha_entrega,
      expected: expectedTomorrowMorning()
    },
    friday: {
      phone: friday.phone,
      fecha_entrega: friday.data.pedido.fecha_entrega,
      expected: expectedUpcomingFridayMorning()
    },
    noDate: {
      phone: noDate.phone,
      fecha_entrega: noDate.data.pedido.fecha_entrega
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error.response?.data || error.stack || error.message);
  process.exit(1);
});
