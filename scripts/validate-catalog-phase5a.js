const axios = require("axios");
const { CATALOG_URL } = require("../whatsapp");

const api = axios.create({ baseURL: "http://127.0.0.1:3000", timeout: 150000 });

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const genericPhone = `57322${Date.now().toString().slice(-7)}`;
  const orderPhone = `57323${Date.now().toString().slice(-7)}`;

  const genericPayload = {
    telefono: genericPhone,
    mensaje: "Hola 👋"
  };

  const genericResponse = await api.post("/simulate-message", genericPayload);
  const genericMessages = await api.get(`/conversations/${genericPhone}/messages`);

  assert(genericResponse.data.ok === true, "La simulación genérica no respondió ok=true");
  assert(genericResponse.data.order === null, "La simulación genérica no debía crear order");
  assert(typeof genericResponse.data.respuesta === "string" && genericResponse.data.respuesta.includes(CATALOG_URL), "La respuesta inicial no incluye el catálogo");
  assert(genericMessages.data.total === 2, "La conversación genérica debía tener 2 mensajes");
  assert(genericMessages.data.messages[1]?.messageText?.includes(CATALOG_URL), "El mensaje saliente del catálogo no quedó en CRM");

  const orderPayload = {
    telefono: orderPhone,
    mensaje: "Hola, soy Laura. Quiero 2 yogures de mora y 1 de fresa. Dirección Calle 10 # 20-30. Pago por Nequi."
  };

  const orderResponse = await api.post("/simulate-message", orderPayload);
  const orderMessages = await api.get(`/conversations/${orderPhone}/messages`);

  assert(orderResponse.data.ok === true, "La simulación de pedido no respondió ok=true");
  assert(orderResponse.data.order?.id, "La simulación de pedido no creó un order");
  assert(orderResponse.data.order?.telefono === orderPhone, "El order quedó con teléfono incorrecto");
  assert(orderResponse.data.inboundMessage?.orderId === orderResponse.data.order.id, "El mensaje inbound no quedó vinculado al order_id");
  assert(orderResponse.data.delivery?.message?.orderId === orderResponse.data.order.id, "El mensaje outbound no quedó vinculado al order_id");
  assert(orderMessages.data.total === 2, "La conversación de pedido debía tener 2 mensajes");
  assert(orderMessages.data.messages[0]?.orderId === orderResponse.data.order.id, "CRM inbound sin order_id correcto");
  assert(orderMessages.data.messages[1]?.orderId === orderResponse.data.order.id, "CRM outbound sin order_id correcto");
  assert(/Pedido registrado/i.test(orderResponse.data.respuesta), "La respuesta del pedido no fue de confirmación");

  const conversations = await api.get(`/conversations?q=${orderPhone}`);
  assert(conversations.data.total >= 1, "La conversación del pedido no aparece en CRM");
  assert(conversations.data.conversations[0]?.lastMessageOrderId === orderResponse.data.order.id, "lastMessageOrderId no coincide con el order creado");
  assert(conversations.data.conversations[0]?.lastOrderId === orderResponse.data.order.id, "lastOrderId no coincide con el order creado");

  console.log(JSON.stringify({
    genericFlow: {
      phone: genericPhone,
      response: genericResponse.data.respuesta,
      messages: genericMessages.data.messages
    },
    orderFlow: {
      phone: orderPhone,
      orderId: orderResponse.data.order.id,
      pedido: orderResponse.data.pedido,
      evaluacion: orderResponse.data.evaluacion,
      response: orderResponse.data.respuesta,
      messages: orderMessages.data.messages,
      conversation: conversations.data.conversations[0]
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error.response?.data || error.stack || error.message);
  process.exit(1);
});
