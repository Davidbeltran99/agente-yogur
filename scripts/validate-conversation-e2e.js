const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { buildAliases } = require("../catalog");

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "conversation-e2e-fixtures.json"), "utf8"));
const port = Number(process.env.PORT || 3065);
const baseURL = `http://127.0.0.1:${port}`;
const api = axios.create({ baseURL, timeout: 180000 });

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 90000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await api.get("/health");
      if (response.data?.ok) {
        return response.data;
      }
    } catch (_error) {
      await sleep(500);
    }
  }

  throw new Error("Server did not become healthy in time");
}

async function send(phone, message, suffix) {
  const response = await api.post("/simulate-message", {
    telefono: phone,
    mensaje: message,
    sourceMessageId: `e2e_${Date.now()}_${suffix}`
  });

  return response.data;
}

function collectProducts(container) {
  if (!Array.isArray(container)) {
    return [];
  }

  return container.map((item) => item?.producto).filter(Boolean);
}

function findProduct(container, productName) {
  return Array.isArray(container)
    ? container.find((item) => item?.producto === productName)
    : null;
}

function assertStep(step, result, scenarioName, index) {
  const expect = step.expect || {};
  const label = `${scenarioName}#${index + 1}`;
  const pedidoProducts = collectProducts(result.pedido?.productos);
  const orderProducts = Array.isArray(result.order?.items) ? result.order.items.map((item) => item?.producto).filter(Boolean) : [];

  if (expect.intent) {
    assert(result.intent === expect.intent, `${label}: expected intent ${expect.intent}, got ${result.intent}`);
  }

  if (Array.isArray(expect.responseIncludes)) {
    for (const fragment of expect.responseIncludes) {
      assert(String(result.respuesta || "").toLowerCase().includes(String(fragment).toLowerCase()), `${label}: missing response fragment ${fragment}`);
    }
  }

  if (Array.isArray(expect.responseExcludes)) {
    for (const fragment of expect.responseExcludes) {
      assert(!String(result.respuesta || "").toLowerCase().includes(String(fragment).toLowerCase()), `${label}: unexpected response fragment ${fragment}`);
    }
  }

  if (Array.isArray(expect.pedidoProductsIncludes)) {
    for (const product of expect.pedidoProductsIncludes) {
      assert(pedidoProducts.includes(product), `${label}: missing pedido product ${product}`);
    }
  }

  if (Array.isArray(expect.pedidoProductsExcludes)) {
    for (const product of expect.pedidoProductsExcludes) {
      assert(!pedidoProducts.includes(product), `${label}: unexpected pedido product ${product}`);
    }
  }

  if (Array.isArray(expect.orderProductsIncludes)) {
    for (const product of expect.orderProductsIncludes) {
      assert(orderProducts.includes(product), `${label}: missing order product ${product}`);
    }
  }

  if (typeof expect.orderCreated === "boolean") {
    assert(Boolean(result.order?.id) === expect.orderCreated, `${label}: unexpected orderCreated=${Boolean(result.order?.id)}`);
  }

  if (expect.pedidoQuantityFor) {
    const target = (result.pedido?.productos || []).find((item) => item?.producto === expect.pedidoQuantityFor.product);
    assert(target, `${label}: missing quantity target ${expect.pedidoQuantityFor.product}`);
    assert(Number(target.cantidad) === Number(expect.pedidoQuantityFor.quantity), `${label}: expected quantity ${expect.pedidoQuantityFor.quantity}, got ${target.cantidad}`);
  }

  if (expect.pedidoProductNotesFor) {
    const target = findProduct(result.pedido?.productos || [], expect.pedidoProductNotesFor.product);
    assert(target, `${label}: missing notes target ${expect.pedidoProductNotesFor.product}`);
    const notes = target.product_notes || target.productNotes || null;
    assert(String(notes || "").toLowerCase().includes(String(expect.pedidoProductNotesFor.notes).toLowerCase()), `${label}: expected pedido notes ${expect.pedidoProductNotesFor.notes}, got ${notes}`);
  }

  if (expect.orderProductNotesFor) {
    const target = findProduct(result.order?.items || [], expect.orderProductNotesFor.product);
    assert(target, `${label}: missing order notes target ${expect.orderProductNotesFor.product}`);
    const notes = target.product_notes || target.productNotes || null;
    assert(String(notes || "").toLowerCase().includes(String(expect.orderProductNotesFor.notes).toLowerCase()), `${label}: expected order notes ${expect.orderProductNotesFor.notes}, got ${notes}`);
  }

  if (expect.firstPedidoProductNotesIncludes) {
    const firstItem = Array.isArray(result.pedido?.productos) ? result.pedido.productos[0] : null;
    const notes = firstItem?.product_notes || firstItem?.productNotes || null;
    assert(firstItem, `${label}: missing first pedido item`);
    assert(String(notes || "").toLowerCase().includes(String(expect.firstPedidoProductNotesIncludes).toLowerCase()), `${label}: expected first pedido notes ${expect.firstPedidoProductNotesIncludes}, got ${notes}`);
  }
}

async function runScenario(scenario, scenarioIndex) {
  const phone = `57320${String(Date.now() + scenarioIndex).slice(-7)}`;
  const outputs = [];

  for (let index = 0; index < scenario.steps.length; index += 1) {
    const step = scenario.steps[index];
    const result = await send(phone, step.message, `${scenarioIndex}_${index}`);
    assert(!result.ignored, `${scenario.name}#${index + 1}: message was ignored (${result.ignoredReason})`);
    assertStep(step, result, scenario.name, index);
    outputs.push({
      message: step.message,
      intent: result.intent,
      response: result.respuesta,
      pedido: result.pedido,
      orderId: result.order?.id || null
    });
    await sleep(120);
  }

  return { name: scenario.name, phone, outputs };
}

function runFuzzyFixtures() {
  return (fixtures.fuzzyFixtures || []).map((fixture) => {
    const aliases = buildAliases({ nombre: fixture.productName, aliases: [] });
    for (const expectedAlias of fixture.expectedAliases || []) {
      assert(aliases.includes(expectedAlias), `fuzzy fixture ${fixture.productName}: missing alias ${expectedAlias}`);
    }
    return { productName: fixture.productName, aliasCount: aliases.length };
  });
}

async function main() {
  const child = spawn("node", ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      WHATSAPP_ENABLED: "false",
      OPENAI_API_KEY: "",
      RATE_LIMIT_MAX_MESSAGES: "20"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk.toString(); });
  child.stderr.on("data", (chunk) => { logs += chunk.toString(); });

  try {
    await waitForHealth();
    const fuzzy = runFuzzyFixtures();
    const scenarios = [];

    for (let index = 0; index < (fixtures.scenarios || []).length; index += 1) {
      scenarios.push(await runScenario(fixtures.scenarios[index], index));
    }

    console.log(JSON.stringify({ ok: true, port, fuzzy, scenarios: scenarios.map((entry) => ({ name: entry.name, phone: entry.phone, steps: entry.outputs.length })) }, null, 2));
  } finally {
    child.kill();
    await sleep(400);
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
