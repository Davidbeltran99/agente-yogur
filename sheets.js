const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { google } = require("googleapis");

const PEDIDOS_RANGE = "Pedidos!A:N";
const PEDIDOS_HEADERS = [
  "Fecha",
  "Cliente",
  "Producto",
  "Sabor",
  "Cantidad",
  "Dirección",
  "Fecha entrega",
  "Método pago",
  "Observaciones",
  "Estado",
  "ID Pedido",
  "Precio unitario",
  "Subtotal",
  "Total pedido"
];
const ESTADOS_VALIDOS = new Set(["pendiente", "en proceso", "entregado", "cancelado"]);

function getAuth() {
  const clientEmail = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").trim();

  if (clientEmail && privateKey) {
    return new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey.replace(/\\n/g, "\n")
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
  }

  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!keyFile || !fs.existsSync(keyFile)) {
    throw new Error("No se encontraron credenciales de Google Sheets. Usa GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY o define GOOGLE_APPLICATION_CREDENTIALS fuera del repo.");
  }

  return new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
}

function getSpreadsheetId() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

  if (!spreadsheetId) {
    throw new Error("Falta GOOGLE_SHEETS_ID en .env");
  }

  return spreadsheetId;
}

function normalizeText(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeStatus(value) {
  const normalized = normalizeText(value)?.toLowerCase();

  if (!normalized) {
    return "pendiente";
  }

  if (normalized === "en proceso") {
    return "en proceso";
  }

  return ESTADOS_VALIDOS.has(normalized) ? normalized : "pendiente";
}

function humanizeStatus(value) {
  const status = normalizeStatus(value);
  const labels = {
    pendiente: "Pendiente",
    "en proceso": "En proceso",
    entregado: "Entregado",
    cancelado: "Cancelado"
  };

  return labels[status] || "Pendiente";
}

function slugify(value, fallback = "sin-dato") {
  const normalized = normalizeText(value)
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || fallback;
}

function generatePedidoId() {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `ped_${stamp}_${randomUUID().split("-")[0]}`;
}

function buildSyntheticPedidoId({ fechaRegistro, cliente, producto, rowNumber }) {
  return [
    slugify(fechaRegistro, "sin-fecha"),
    slugify(cliente, "sin-cliente"),
    slugify(producto, "sin-producto"),
    `fila-${rowNumber}`
  ].join("__");
}

function looksLikeHeaderRow(row = []) {
  const normalized = row
    .map((value) => normalizeText(value)?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() || "");

  return normalized[0] === "fecha"
    && normalized[1] === "cliente"
    && normalized[2] === "producto"
    && normalized[10] === "id pedido";
}

async function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

async function ensurePedidosHeader(sheets, spreadsheetId) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Pedidos!1:1"
  });

  const firstRow = response.data.values?.[0] || [];

  if (firstRow.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Pedidos!A1:N1",
      valueInputOption: "RAW",
      requestBody: {
        values: [PEDIDOS_HEADERS]
      }
    });
    return { hasHeader: true };
  }

  const hasKnownHeader = looksLikeHeaderRow(firstRow);
  const needsHeaderUpgrade = hasKnownHeader && (
    normalizeText(firstRow[10]) !== "ID Pedido"
    || normalizeText(firstRow[11]) !== "Precio unitario"
    || normalizeText(firstRow[12]) !== "Subtotal"
    || normalizeText(firstRow[13]) !== "Total pedido"
  );

  if (needsHeaderUpgrade) {
    const mergedHeaders = PEDIDOS_HEADERS.map((header, index) => firstRow[index] || header);
    mergedHeaders[10] = "ID Pedido";
    mergedHeaders[11] = "Precio unitario";
    mergedHeaders[12] = "Subtotal";
    mergedHeaders[13] = "Total pedido";

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Pedidos!A1:N1",
      valueInputOption: "RAW",
      requestBody: {
        values: [mergedHeaders]
      }
    });

    return { hasHeader: true };
  }

  return { hasHeader: hasKnownHeader };
}

function construirFilasPedido(pedido, opciones = {}) {
  const fechaRegistro = opciones.fechaRegistro || new Date().toISOString();
  const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
  const pedidoId = normalizeText(opciones.pedidoId) || generatePedidoId();

  if (productos.length === 0) {
    return {
      pedidoId,
      values: [[
        fechaRegistro,
        pedido.cliente || null,
        null,
        null,
        null,
        pedido.direccion || null,
        pedido.fecha_entrega || null,
        pedido.metodo_pago || null,
        pedido.observaciones || null,
        normalizeStatus(pedido.estado),
        pedidoId,
        null,
        null,
        pedido.total ?? null
      ]]
    };
  }

  return {
    pedidoId,
    values: productos.map((item) => [
      fechaRegistro,
      pedido.cliente || null,
      item.producto || null,
      item.sabor || null,
      item.cantidad || null,
      pedido.direccion || null,
      pedido.fecha_entrega || null,
      pedido.metodo_pago || null,
      pedido.observaciones || null,
      normalizeStatus(pedido.estado),
      pedidoId,
      item.precio_unitario ?? null,
      item.subtotal ?? null,
      pedido.total ?? null
    ])
  };
}

function construirFilasDesdeOrder(order = {}) {
  const fechaRegistro = normalizeText(order.fechaRegistro) || new Date().toISOString();
  const pedidoId = normalizeText(order.id) || generatePedidoId();
  const items = Array.isArray(order.items) ? order.items : [];

  if (!items.length) {
    return [[
      fechaRegistro,
      normalizeText(order.cliente),
      null,
      null,
      null,
      normalizeText(order.direccion),
      normalizeText(order.fechaEntrega),
      normalizeText(order.metodoPago),
      normalizeText(order.observaciones),
      normalizeStatus(order.estado),
      pedidoId,
      null,
      null,
      order.total ?? null
    ]];
  }

  return items.map((item) => [
    fechaRegistro,
    normalizeText(order.cliente),
    normalizeText(item.producto),
    normalizeText(item.sabor),
    item.cantidad ?? null,
    normalizeText(order.direccion),
    normalizeText(order.fechaEntrega),
    normalizeText(order.metodoPago),
    normalizeText(order.observaciones),
    normalizeStatus(order.estado),
    pedidoId,
    item.precioUnitario ?? item.precio_unitario ?? null,
    item.subtotal ?? null,
    order.total ?? null
  ]);
}

function parseSheetRows(rows = [], { hasHeader = false } = {}) {
  const startRow = hasHeader ? 2 : 1;
  const rawRows = hasHeader ? rows.slice(1) : rows;

  return rawRows
    .map((row, index) => {
      const rowNumber = startRow + index;
      const fechaRegistro = normalizeText(row[0]);
      const cliente = normalizeText(row[1]);
      const producto = normalizeText(row[2]);
      const sabor = normalizeText(row[3]);
      const cantidadRaw = normalizeText(row[4]);
      const direccion = normalizeText(row[5]);
      const fechaEntrega = normalizeText(row[6]);
      const metodoPago = normalizeText(row[7]);
      const observaciones = normalizeText(row[8]);
      const estado = normalizeStatus(row[9]);
      const idPedido = normalizeText(row[10]) || buildSyntheticPedidoId({ fechaRegistro, cliente, producto, rowNumber });
      const precioUnitarioRaw = normalizeText(row[11]);
      const subtotalRaw = normalizeText(row[12]);
      const totalPedidoRaw = normalizeText(row[13]);
      const cantidadNumber = Number(cantidadRaw);
      const precioUnitario = Number(precioUnitarioRaw);
      const subtotal = Number(subtotalRaw);
      const totalPedido = Number(totalPedidoRaw);

      if (![fechaRegistro, cliente, producto, sabor, cantidadRaw, direccion, fechaEntrega, metodoPago, observaciones, row[9], row[10], row[11], row[12], row[13]]
        .some((value) => normalizeText(value))) {
        return null;
      }

      return {
        id: idPedido,
        rowNumber,
        fechaRegistro,
        cliente,
        producto,
        sabor,
        cantidad: Number.isFinite(cantidadNumber) ? cantidadNumber : cantidadRaw,
        direccion,
        fechaEntrega,
        metodoPago,
        observaciones,
        precioUnitario: Number.isFinite(precioUnitario) ? precioUnitario : null,
        subtotal: Number.isFinite(subtotal) ? subtotal : null,
        totalPedido: Number.isFinite(totalPedido) ? totalPedido : null,
        estado,
        estadoLabel: humanizeStatus(estado)
      };
    })
    .filter(Boolean);
}

function buildOrderSummary(items = []) {
  const resumenItems = items.map((item) => {
    const partes = [item.cantidad ?? "?", item.producto, item.sabor].filter((value) => value !== null && value !== undefined && value !== "");
    return partes.join(" ");
  }).filter(Boolean);
  const productos = [...new Set(items.map((item) => item.producto).filter(Boolean))];
  const sabores = items.map((item) => item.sabor).filter(Boolean);
  const cantidades = items.map((item) => item.cantidad).filter((item) => item !== null && item !== undefined && item !== "");
  const totalCantidad = cantidades.every((item) => typeof item === "number")
    ? cantidades.reduce((sum, item) => sum + item, 0)
    : cantidades.join(", ");

  return {
    resumenItems: resumenItems.join(", ") || null,
    producto: productos.join(", ") || null,
    sabor: sabores.join(", ") || null,
    cantidad: totalCantidad || null,
    subtotal: items.reduce((sum, item) => sum + (Number.isFinite(Number(item.subtotal)) ? Number(item.subtotal) : 0), 0) || null,
    items: items.map((item) => ({
      producto: item.producto,
      sabor: item.sabor,
      cantidad: item.cantidad,
      precioUnitario: item.precioUnitario,
      subtotal: item.subtotal
    }))
  };
}

function groupOrders(parsedRows = []) {
  const grouped = new Map();

  for (const row of parsedRows) {
    if (!grouped.has(row.id)) {
      grouped.set(row.id, {
        id: row.id,
        fechaRegistro: row.fechaRegistro,
        cliente: row.cliente,
        direccion: row.direccion,
        fechaEntrega: row.fechaEntrega,
        metodoPago: row.metodoPago,
        observaciones: row.observaciones,
        estado: row.estado,
        estadoLabel: row.estadoLabel,
        sheetRows: [row.rowNumber],
        lineItems: [row]
      });
      continue;
    }

    const current = grouped.get(row.id);
    current.sheetRows.push(row.rowNumber);
    current.lineItems.push(row);
    current.estado = row.estado || current.estado;
    current.estadoLabel = row.estadoLabel || current.estadoLabel;
    current.observaciones = current.observaciones || row.observaciones;
    current.fechaEntrega = current.fechaEntrega || row.fechaEntrega;
  }

  return Array.from(grouped.values())
    .map((order) => {
      const summary = buildOrderSummary(order.lineItems);
      const lastRow = Math.max(...order.sheetRows);

      return {
        id: order.id,
        fechaRegistro: order.fechaRegistro,
        cliente: order.cliente,
        resumenItems: summary.resumenItems,
        producto: summary.producto,
        sabor: summary.sabor,
        cantidad: summary.cantidad,
        direccion: order.direccion,
        fechaEntrega: order.fechaEntrega,
        metodoPago: order.metodoPago,
        observaciones: order.observaciones,
        total: order.lineItems.find((item) => item.totalPedido !== null && item.totalPedido !== undefined)?.totalPedido ?? summary.subtotal,
        estado: order.estado,
        estadoLabel: order.estadoLabel,
        sheetRows: order.sheetRows,
        items: summary.items,
        itemCount: order.lineItems.length,
        sortRow: lastRow
      };
    })
    .sort((a, b) => {
      const dateDiff = new Date(b.fechaRegistro || 0).getTime() - new Date(a.fechaRegistro || 0).getTime();
      if (dateDiff !== 0) {
        return dateDiff;
      }

      return (b.sortRow || 0) - (a.sortRow || 0);
    });
}

async function leerPedidosDesdeSheets() {
  const spreadsheetId = getSpreadsheetId();
  const sheets = await getSheetsClient();
  const headerInfo = await ensurePedidosHeader(sheets, spreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: PEDIDOS_RANGE
  });

  const rows = response.data.values || [];
  const parsedRows = parseSheetRows(rows, headerInfo);

  return groupOrders(parsedRows);
}

async function guardarPedidoEnSheets(pedido, opciones = {}) {
  const spreadsheetId = getSpreadsheetId();
  const sheets = await getSheetsClient();
  await ensurePedidosHeader(sheets, spreadsheetId);
  const { values, pedidoId } = construirFilasPedido(pedido, opciones);
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: PEDIDOS_RANGE
  });
  const nextRow = (current.data.values?.length || 0) + 1;
  const endRow = nextRow + values.length - 1;

  await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Pedidos!A${nextRow}:N${endRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values
    }
  });

  return { pedidoId, nextRow, endRow };
}

async function actualizarEstadoPedidoEnSheets(orderId, nuevoEstado) {
  const spreadsheetId = getSpreadsheetId();
  const status = normalizeStatus(nuevoEstado);

  if (!ESTADOS_VALIDOS.has(status)) {
    throw new Error("Estado no válido");
  }

  const sheets = await getSheetsClient();
  const headerInfo = await ensurePedidosHeader(sheets, spreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: PEDIDOS_RANGE
  });

  const rows = response.data.values || [];
  const parsedRows = parseSheetRows(rows, headerInfo);
  const matches = parsedRows.filter((row) => row.id === orderId);

  if (!matches.length) {
    const error = new Error("Pedido no encontrado");
    error.code = "ORDER_NOT_FOUND";
    throw error;
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: matches.map((row) => ({
        range: `Pedidos!J${row.rowNumber}:K${row.rowNumber}`,
        values: [[status, row.id]]
      }))
    }
  });

  const orders = groupOrders(parsedRows.map((row) => {
    if (row.id !== orderId) {
      return row;
    }

    return {
      ...row,
      estado: status,
      estadoLabel: humanizeStatus(status)
    };
  }));

  return orders.find((order) => order.id === orderId);
}

async function sincronizarPedidoDesdeDbEnSheets(order) {
  if (!order?.id) {
    throw new Error("Pedido inválido para sincronizar en Sheets");
  }

  const spreadsheetId = getSpreadsheetId();
  const sheets = await getSheetsClient();
  await ensurePedidosHeader(sheets, spreadsheetId);
  const values = construirFilasDesdeOrder(order);
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: PEDIDOS_RANGE
  });
  const rows = current.data.values || [];
  const headerInfo = { hasHeader: looksLikeHeaderRow(rows[0] || []) };
  const parsedRows = parseSheetRows(rows, headerInfo);
  const matches = parsedRows.filter((row) => row.id === order.id);

  if (!matches.length) {
    const nextRow = rows.length + 1;
    const endRow = nextRow + values.length - 1;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Pedidos!A${nextRow}:N${endRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values }
    });

    return { synced: true, mode: "insert", rowsWritten: values.length };
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: matches.map((row, index) => ({
        range: `Pedidos!A${row.rowNumber}:N${row.rowNumber}`,
        values: [values[index] || values[values.length - 1]]
      }))
    }
  });

  return { synced: true, mode: "update", rowsWritten: matches.length };
}

async function reconstruirSheetsDesdeOrders(orders = []) {
  const spreadsheetId = getSpreadsheetId();
  const sheets = await getSheetsClient();
  const values = [PEDIDOS_HEADERS];

  for (const order of orders) {
    values.push(...construirFilasDesdeOrder(order));
  }

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: "Pedidos!A:N"
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Pedidos!A1:N${values.length}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values }
  });

  return { rowsWritten: Math.max(values.length - 1, 0) };
}

module.exports = {
  guardarPedidoEnSheets,
  construirFilasPedido,
  leerPedidosDesdeSheets,
  actualizarEstadoPedidoEnSheets,
  sincronizarPedidoDesdeDbEnSheets,
  reconstruirSheetsDesdeOrders,
  ESTADOS_VALIDOS
};
