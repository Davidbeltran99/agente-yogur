const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const APP_URL = process.env.APP_URL || "http://127.0.0.1:3000/";
const APP_ORIGIN = new URL(APP_URL).origin;
const DEBUG_PORT = Number(process.env.DEBUG_PORT || 9225);
const DEBUG_BASE_URL = `http://127.0.0.1:${DEBUG_PORT}`;

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

async function seedOrders() {
  const samples = [
    {
      telefono: "573200110001",
      mensaje: "Hola soy Laura, quiero 2 aloe litro. Dirección Calle 10 #20-30. Pago Nequi.",
      sourceMessageId: `validate_finalize_${Date.now()}_1`
    },
    {
      telefono: "573200110002",
      mensaje: "Hola soy Carlos, quiero 1 cafe litro. Dirección Carrera 12 #15-18. Pago efectivo.",
      sourceMessageId: `validate_finalize_${Date.now()}_2`
    }
  ];

  for (const sample of samples) {
    const response = await fetch(`${APP_ORIGIN}/simulate-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sample)
    });

    if (!response.ok) {
      throw new Error(`No pude sembrar pedido de prueba (${response.status})`);
    }
  }
}

async function startBrowser() {
  const executable = getBrowserExecutable();
  if (!executable) {
    throw new Error("No encontré Edge/Chrome. Define EDGE_PATH o CHROME_PATH si hace falta.");
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tellolac-finalize-modal-"));
  const child = spawn(executable, [
    "--headless=new",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    APP_URL
  ], { stdio: "ignore" });

  await waitFor(async () => {
    const version = await fetchJson(`${DEBUG_BASE_URL}/json/version`);
    return version?.Browser ? version : null;
  }, { errorMessage: "No se pudo iniciar el navegador headless" });

  const target = await waitFor(async () => {
    const targets = await fetchJson(`${DEBUG_BASE_URL}/json/list`);
    return targets.find((item) => String(item.url).startsWith(APP_URL));
  }, { errorMessage: `No apareció una pestaña para ${APP_URL}` });

  return { child, userDataDir, target };
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
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (_error) {
      // noop
    }
  }
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

async function main() {
  let browserSession = null;
  let ws = null;

  try {
    await seedOrders();
    browserSession = await startBrowser();
    const page = await connectToPage(browserSession.target);
    ws = page.ws;

    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Page.navigate", { url: APP_URL });

    await waitFor(async () => {
      const ready = await page.evaluate("document.readyState === 'complete'");
      return ready ? true : null;
    }, { errorMessage: "La página no terminó de cargar" });

    await waitFor(async () => {
      const loaded = await page.evaluate("document.querySelector('#tableMeta')?.textContent && !document.querySelector('#tableMeta').textContent.includes('Cargando')");
      return loaded ? true : null;
    }, { errorMessage: "El panel no terminó de cargar pedidos" });

    const openModal = () => page.evaluate(`(() => { document.getElementById('closeDayButton').click(); return true; })()`);
    const closeWithButton = () => page.evaluate(`(() => { document.getElementById('closeModalButton').click(); return true; })()`);
    const cancelWithButton = () => page.evaluate(`(() => { document.getElementById('cancelCloseDayButton').click(); return true; })()`);
    const closeWithOverlay = () => page.evaluate(`(() => { document.getElementById('closeDayModal').click(); return true; })()`);
    const closeWithEsc = () => page.evaluate(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
    const confirmClose = () => page.evaluate(`(() => { document.getElementById('confirmCloseDayButton').click(); return true; })()`);

    const getModalState = () => page.evaluate(`(() => {
      const modal = document.getElementById('closeDayModal');
      const summaryCards = document.querySelectorAll('#closeDaySummary .modal-summary-card').length;
      return {
        hidden: modal.hidden,
        ariaHidden: modal.getAttribute('aria-hidden'),
        display: getComputedStyle(modal).display,
        bodyLocked: document.body.classList.contains('modal-open'),
        summaryCards,
        summaryText: document.getElementById('closeDaySummary')?.textContent.trim() || '',
        confirmDisabled: document.getElementById('confirmCloseDayButton')?.disabled || false,
        activeOrdersText: document.getElementById('tableMeta')?.textContent.trim() || ''
      };
    })()`);

    await openModal();
    const opened = await waitFor(async () => {
      const state = await getModalState();
      return !state.hidden && state.bodyLocked ? state : null;
    }, { errorMessage: "La modal no abrió" });

    await closeWithButton();
    const closedWithButton = await waitFor(async () => {
      const state = await getModalState();
      return state.hidden && !state.bodyLocked && state.display === 'none' ? state : null;
    }, { errorMessage: "Cerrar no cerró la modal" });

    await openModal();
    await waitFor(async () => {
      const state = await getModalState();
      return !state.hidden ? state : null;
    });
    await cancelWithButton();
    const closedWithCancel = await waitFor(async () => {
      const state = await getModalState();
      return state.hidden && !state.bodyLocked ? state : null;
    }, { errorMessage: "Cancelar no cerró la modal" });

    await openModal();
    await waitFor(async () => {
      const state = await getModalState();
      return !state.hidden ? state : null;
    });
    await closeWithEsc();
    const closedWithEsc = await waitFor(async () => {
      const state = await getModalState();
      return state.hidden && !state.bodyLocked ? state : null;
    }, { errorMessage: "ESC no cerró la modal" });

    await openModal();
    await waitFor(async () => {
      const state = await getModalState();
      return !state.hidden ? state : null;
    });
    await closeWithOverlay();
    const closedWithOverlay = await waitFor(async () => {
      const state = await getModalState();
      return state.hidden && !state.bodyLocked ? state : null;
    }, { errorMessage: "Click afuera no cerró la modal" });

    await openModal();
    await waitFor(async () => {
      const state = await getModalState();
      return !state.hidden ? state : null;
    });
    await confirmClose();
    const afterConfirm = await waitFor(async () => {
      const state = await getModalState();
      return state.hidden && !state.bodyLocked && /0 pedido\(s\) activos/i.test(state.activeOrdersText) ? state : null;
    }, { timeoutMs: 30000, errorMessage: "Confirmar cierre no limpió el panel o dejó overlay pegado" });

    await openModal();
    const emptyState = await waitFor(async () => {
      const state = await getModalState();
      return !state.hidden && state.confirmDisabled && state.summaryText.includes('No hay pedidos activos para cerrar hoy.') ? state : null;
    }, { errorMessage: "No se mostró el empty state tras cerrar el día" });

    console.log(JSON.stringify({
      opened,
      closedWithButton,
      closedWithCancel,
      closedWithEsc,
      closedWithOverlay,
      afterConfirm,
      emptyState
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
