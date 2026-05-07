const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const APP_URL = process.env.APP_URL || "http://127.0.0.1:3000/";
const DEBUG_PORT = Number(process.env.DEBUG_PORT || 9224);
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

async function startBrowser() {
  const executable = getBrowserExecutable();
  if (!executable) {
    throw new Error("No encontré Edge/Chrome. Define EDGE_PATH o CHROME_PATH si hace falta.");
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tellolac-responsive-"));
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
    fs.rmSync(userDataDir, { recursive: true, force: true });
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
    browserSession = await startBrowser();
    const page = await connectToPage(browserSession.target);
    ws = page.ws;

    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    });
    await page.send("Page.navigate", { url: APP_URL });

    await waitFor(async () => {
      const ready = await page.evaluate("document.readyState === 'complete'");
      return ready ? true : null;
    }, { errorMessage: "La página no terminó de cargar" });

    const result = await page.evaluate(`(() => ({
      title: document.title,
      navCount: document.querySelectorAll('.nav-link[data-target]').length,
      hasHeader: Boolean(document.querySelector('.app-header')),
      viewportWidth: window.innerWidth,
      bodyWidth: document.body.scrollWidth,
      hasKpis: document.querySelectorAll('.kpi-card').length,
      hasOrdersTable: Boolean(document.querySelector('#ordersTableBody')),
      hasHistory: Boolean(document.querySelector('#historyList')),
      hasResponsiveLayout: Boolean(window.innerWidth <= 430 && document.querySelector('.sidebar') && document.querySelector('.main-shell'))
    }))()`);

    console.log(JSON.stringify(result, null, 2));
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
