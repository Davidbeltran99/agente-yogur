const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { DatabaseSync } = require("node:sqlite");

const APP_URL = "http://127.0.0.1:3000/";
const HEALTH_URL = "http://127.0.0.1:3000/health";
const DEBUG_PORT = 9223;
const DEBUG_BASE_URL = `http://127.0.0.1:${DEBUG_PORT}`;
const DB_PATH = path.join(__dirname, "..", "data", "agente-yogur.sqlite");

function getBrowserExecutable() {
  const candidates = [
    process.env.EDGE_PATH,
    process.env.CHROME_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${url} responded with ${response.status}`);
  }
  return response.json();
}

async function waitFor(fn, { timeoutMs = 15000, intervalMs = 250, errorMessage = "Timeout" } = {}) {
  const start = Date.now();
  let lastError = null;

  while (Date.now() - start < timeoutMs) {
    try {
      const value = await fn();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error(errorMessage);
}

async function ensureServerReady() {
  await waitFor(async () => {
    const health = await fetchJson(HEALTH_URL);
    return health?.ok ? health : null;
  }, {
    timeoutMs: 10000,
    errorMessage: "El servidor no responde en /health. Arranca primero npm run dev"
  });
}

async function startBrowser() {
  const executable = getBrowserExecutable();
  if (!executable) {
    throw new Error("No encontré Edge/Chrome. Define EDGE_PATH o CHROME_PATH si hace falta.");
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agente-yogur-crm-"));
  const child = spawn(executable, [
    "--headless=new",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    APP_URL
  ], {
    stdio: "ignore"
  });

  await waitFor(async () => {
    const version = await fetchJson(`${DEBUG_BASE_URL}/json/version`);
    return version?.Browser ? version : null;
  }, {
    timeoutMs: 15000,
    errorMessage: "No se pudo iniciar el navegador headless con remote debugging"
  });

  const target = await waitFor(async () => {
    const targets = await fetchJson(`${DEBUG_BASE_URL}/json/list`);
    return targets.find((item) => String(item.url).startsWith(APP_URL));
  }, {
    timeoutMs: 15000,
    errorMessage: `No apareció una pestaña para ${APP_URL}`
  });

  return {
    child,
    userDataDir,
    target
  };
}

async function stopBrowser({ child, userDataDir }) {
  if (child && !child.killed) {
    try {
      child.kill();
    } catch (_error) {
      // noop
    }

    if (child.pid) {
      try {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } catch (_error) {
        // noop
      }
    }
  }

  if (userDataDir) {
    await waitFor(() => {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
        return true;
      } catch (_error) {
        return false;
      }
    }, {
      timeoutMs: 8000,
      intervalMs: 250,
      errorMessage: `No se pudo limpiar el perfil temporal: ${userDataDir}`
    });
  }
}

function createDb() {
  return new DatabaseSync(DB_PATH);
}

function getPersistedMessage(phone, messageText) {
  const db = createDb();
  const row = db.prepare(`
    SELECT id, phone, direction, message_text, whatsapp_message_id, created_at, order_id
    FROM messages
    WHERE phone = ? AND direction = 'out' AND message_text = ?
    ORDER BY datetime(created_at) DESC, rowid DESC
    LIMIT 1
  `).get(phone, messageText);
  db.close();
  return row || null;
}

function deletePersistedMessage(messageId) {
  const db = createDb();
  const result = db.prepare("DELETE FROM messages WHERE id = ?").run(messageId);
  db.close();
  return Boolean(result?.changes);
}

async function connectToPage(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let counter = 0;
  const pending = new Map();

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) {
      return;
    }

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

  return { ws, send, evaluate };
}

async function waitForEvaluate(evaluate, expression, timeoutMs = 15000) {
  return waitFor(async () => {
    const value = await evaluate(expression);
    return value || null;
  }, {
    timeoutMs,
    errorMessage: `Timeout esperando: ${expression}`
  });
}

async function main() {
  await ensureServerReady();

  let browserSession = null;
  let ws = null;

  try {
    browserSession = await startBrowser();
    const page = await connectToPage(browserSession.target);
    ws = page.ws;

    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Page.navigate", { url: APP_URL });

    await waitForEvaluate(page.evaluate, "document.readyState === 'complete'");
    await waitForEvaluate(page.evaluate, "document.title.includes('Tellolac AI')");
    await waitForEvaluate(page.evaluate, "document.querySelector('#conversationMeta')?.textContent && !document.querySelector('#conversationMeta').textContent.includes('Cargando')");
    await waitForEvaluate(page.evaluate, "document.querySelectorAll('.conversation-item[data-phone]').length > 0");

    const initial = await page.evaluate(`(() => ({
      title: document.title,
      conversationCount: document.querySelectorAll('.conversation-item[data-phone]').length,
      firstPhone: document.querySelector('.conversation-item[data-phone]')?.dataset.phone || null,
      meta: document.querySelector('#conversationMeta')?.textContent.trim() || null
    }))()`);

    const activePhone = initial.firstPhone;
    if (!activePhone) {
      throw new Error("No encontré conversaciones en la UI");
    }

    await page.evaluate(`(() => {
      const item = document.querySelector('.conversation-item[data-phone="${activePhone}"]');
      if (!item) return false;
      item.click();
      return true;
    })()`);

    await waitForEvaluate(page.evaluate, "document.querySelector('#chatTitle')?.textContent.trim() !== 'Selecciona una conversación'");
    await waitForEvaluate(page.evaluate, "document.querySelectorAll('#chatMessages .message-row').length > 0");
    await waitForEvaluate(page.evaluate, "Boolean(document.querySelector('#chatMessageInput')) && !document.querySelector('#chatMessageInput').disabled");

    const historyLoaded = await page.evaluate(`(() => ({
      chatTitle: document.querySelector('#chatTitle')?.textContent.trim() || null,
      chatSubtitle: document.querySelector('#chatSubtitle')?.textContent.trim() || null,
      messageCount: document.querySelectorAll('#chatMessages .message-row').length,
      composerEnabled: !document.querySelector('#chatMessageInput')?.disabled,
      sendEnabled: !document.querySelector('#sendMessageButton')?.disabled
    }))()`);

    const testMessage = `[crm-ui-check ${Date.now()}]`;

    await page.evaluate(`(() => {
      const textarea = document.querySelector('#chatMessageInput');
      const form = document.querySelector('#chatComposer');
      if (!textarea || !form) return false;
      textarea.value = ${JSON.stringify("__MSG__")};
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return true;
    })()`.replace("__MSG__", testMessage));

    await waitForEvaluate(page.evaluate, `Array.from(document.querySelectorAll('#chatMessages .message-row.out .message-bubble')).some((node) => node.textContent.includes(${JSON.stringify(testMessage)}))`);
    await waitForEvaluate(page.evaluate, "document.querySelector('#chatFeedback') && !document.querySelector('#chatFeedback').hidden");

    const persistedMessage = await waitFor(() => Promise.resolve(getPersistedMessage(activePhone, testMessage)), {
      timeoutMs: 10000,
      errorMessage: "El mensaje de prueba no quedó persistido en SQLite"
    });

    const sendResult = await page.evaluate(`(() => ({
      feedback: document.querySelector('#chatFeedback')?.textContent.trim() || null,
      lastOutgoing: Array.from(document.querySelectorAll('#chatMessages .message-row.out .message-bubble > div:first-child')).map((node) => node.textContent.trim()).at(-1) || null,
      totalMessages: document.querySelectorAll('#chatMessages .message-row').length
    }))()`);

    const cleanedUp = deletePersistedMessage(persistedMessage.id);
    const existsAfterCleanup = Boolean(getPersistedMessage(activePhone, testMessage));

    console.log(JSON.stringify({
      initial,
      historyLoaded,
      sendResult,
      persistence: {
        messageId: persistedMessage.id,
        phone: persistedMessage.phone,
        whatsappMessageId: persistedMessage.whatsapp_message_id,
        createdAt: persistedMessage.created_at,
        orderId: persistedMessage.order_id
      },
      cleanup: {
        cleanedUp,
        existsAfterCleanup,
        testMessage
      }
    }, null, 2));
  } finally {
    if (ws) {
      try {
        ws.close();
      } catch (_error) {
        // noop
      }
    }

    if (browserSession) {
      await stopBrowser(browserSession);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
