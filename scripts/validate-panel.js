async function main() {
  const targets = await fetch("http://127.0.0.1:9222/json/list").then((response) => response.json());
  const page = targets.find((target) => String(target.url).startsWith("http://127.0.0.1:3000/"));

  if (!page) {
    throw new Error("No page target found");
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let counter = 0;
  const pending = new Map();

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(JSON.stringify(message.error)));
      return;
    }
    resolve(message.result);
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = (event) => reject(event.error || new Error("WebSocket error"));
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++counter;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });

    return result.result?.value;
  };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (expression, timeoutMs = 12000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const value = await evaluate(expression);
      if (value) return value;
      await wait(250);
    }
    throw new Error(`Timeout waiting for: ${expression}`);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await evaluate("location.reload()");
  await waitFor("document.querySelectorAll('#ordersTableBody tr[data-order-id]').length > 0");

  const loaded = await evaluate(`(() => ({
    rows: document.querySelectorAll('#ordersTableBody tr[data-order-id]').length,
    headers: Array.from(document.querySelectorAll('thead th')).map((node) => node.textContent.trim()),
    firstId: document.querySelector('#ordersTableBody tr[data-order-id]')?.dataset.orderId || null,
    firstStatus: document.querySelector('#ordersTableBody tr[data-order-id] .badge')?.textContent.trim() || null
  }))()`);

  const orderId = loaded.firstId;

  await evaluate(`(() => {
    const select = document.querySelector('select[data-status-select="' + CSS.escape(${JSON.stringify("__ORDER_ID__")}) + '"]');
    const button = document.querySelector('button[data-save-status="' + CSS.escape(${JSON.stringify("__ORDER_ID__")}) + '"]');
    select.value = 'en proceso';
    button.click();
    return true;
  })()`.replace(/__ORDER_ID__/g, orderId));

  await waitFor(`document.querySelector('tr[data-order-id="' + CSS.escape(${JSON.stringify("__ORDER_ID__")}) + '"] .badge')?.textContent.includes('En proceso')`.replace(/__ORDER_ID__/g, orderId));

  const afterUpdate = await evaluate(`(() => ({
    badge: document.querySelector('tr[data-order-id="' + CSS.escape(${JSON.stringify("__ORDER_ID__")}) + '"] .badge')?.textContent.trim() || null,
    feedback: document.querySelector('#feedback')?.textContent.trim() || null
  }))()`.replace(/__ORDER_ID__/g, orderId));

  await evaluate(`(() => {
    const button = document.querySelector('#refreshButton');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelector('#tableMeta')?.textContent.trim() !== 'Cargando pedidos...'`);

  const afterRefresh = await evaluate(`(() => ({
    badge: document.querySelector('tr[data-order-id="' + CSS.escape(${JSON.stringify("__ORDER_ID__")}) + '"] .badge')?.textContent.trim() || null,
    meta: document.querySelector('#tableMeta')?.textContent.trim() || null
  }))()`.replace(/__ORDER_ID__/g, orderId));

  await evaluate(`(() => {
    const select = document.querySelector('select[data-status-select="' + CSS.escape(${JSON.stringify("__ORDER_ID__")}) + '"]');
    const button = document.querySelector('button[data-save-status="' + CSS.escape(${JSON.stringify("__ORDER_ID__")}) + '"]');
    select.value = 'pendiente';
    button.click();
    return true;
  })()`.replace(/__ORDER_ID__/g, orderId));

  await waitFor(`document.querySelector('tr[data-order-id="' + CSS.escape(${JSON.stringify("__ORDER_ID__")}) + '"] .badge')?.textContent.includes('Pendiente')`.replace(/__ORDER_ID__/g, orderId));

  const reverted = await evaluate(`(() => ({
    badge: document.querySelector('tr[data-order-id="' + CSS.escape(${JSON.stringify("__ORDER_ID__")}) + '"] .badge')?.textContent.trim() || null,
    feedback: document.querySelector('#feedback')?.textContent.trim() || null
  }))()`.replace(/__ORDER_ID__/g, orderId));

  console.log(JSON.stringify({ loaded, afterUpdate, afterRefresh, reverted }, null, 2));
  ws.close();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
