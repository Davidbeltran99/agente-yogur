const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const Database = require("better-sqlite3");

const ESTADOS_VALIDOS = new Set(["pendiente", "en proceso", "entregado", "cancelado"]);
const DEFAULT_DB_PATH = path.join(__dirname, "data", "agente-yogur.sqlite");

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

  if (normalized === "en camino") {
    return "en proceso";
  }

  return ESTADOS_VALIDOS.has(normalized) ? normalized : "pendiente";
}

function humanizeStatus(value) {
  const status = normalizeStatus(value);
  const labels = {
    pendiente: "🟡 Pendiente",
    "en proceso": "🔵 En camino",
    entregado: "🟢 Entregado",
    cancelado: "Cancelado"
  };

  return labels[status] || "🟡 Pendiente";
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getDatabasePath() {
  const configuredPath = normalizeText(process.env.SQLITE_DB_PATH);
  return configuredPath || DEFAULT_DB_PATH;
}

function ensureDatabaseDirectory(dbPath) {
  const directory = path.dirname(dbPath);
  fs.mkdirSync(directory, { recursive: true });
}

const databasePath = getDatabasePath();
ensureDatabaseDirectory(databasePath);

const db = new Database(databasePath);
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA journal_mode = WAL;");

function ensureColumn(tableName, columnName, columnDefinition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    cliente TEXT,
    telefono TEXT,
    mensaje_original TEXT,
    direccion TEXT,
    fecha_entrega TEXT,
    metodo_pago TEXT,
    observaciones TEXT,
    estado TEXT NOT NULL DEFAULT 'pendiente',
    total REAL,
    source_message_id TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    producto TEXT,
    sabor TEXT,
    cantidad REAL,
    precio_unitario REAL,
    subtotal REAL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    direction TEXT NOT NULL,
    message_text TEXT,
    whatsapp_message_id TEXT,
    created_at TEXT NOT NULL,
    order_id TEXT,
    FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE SET NULL,
    CHECK(direction IN ('in', 'out'))
  );

  CREATE TABLE IF NOT EXISTS catalog_products (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    precio REAL,
    categoria TEXT,
    aliases TEXT,
    activo INTEGER NOT NULL DEFAULT 1,
    source_url TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS daily_closures (
    id TEXT PRIMARY KEY,
    date_key TEXT NOT NULL,
    title TEXT,
    summary_json TEXT NOT NULL,
    pdf_path TEXT,
    archived_orders_count INTEGER NOT NULL DEFAULT 0,
    total_sales REAL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_orders_estado ON orders(estado);
  CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_orders_telefono ON orders(telefono);
  CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
  CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_phone_created_at ON messages(phone, created_at ASC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_whatsapp_message_id ON messages(whatsapp_message_id);
  CREATE INDEX IF NOT EXISTS idx_messages_order_id ON messages(order_id);
  CREATE INDEX IF NOT EXISTS idx_catalog_products_activo ON catalog_products(activo);
  CREATE INDEX IF NOT EXISTS idx_catalog_products_nombre ON catalog_products(nombre);
  CREATE INDEX IF NOT EXISTS idx_daily_closures_created_at ON daily_closures(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_daily_closures_date_key ON daily_closures(date_key DESC);
`);

ensureColumn("orders", "total", "REAL");
ensureColumn("order_items", "precio_unitario", "REAL");
ensureColumn("order_items", "subtotal", "REAL");
ensureColumn("orders", "archived_at", "TEXT");
ensureColumn("orders", "closure_id", "TEXT");

const insertOrderStatement = db.prepare(`
  INSERT INTO orders (
    id,
    cliente,
    telefono,
    mensaje_original,
    direccion,
    fecha_entrega,
    metodo_pago,
    observaciones,
    estado,
    total,
    source_message_id,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertOrderItemStatement = db.prepare(`
  INSERT INTO order_items (id, order_id, producto, sabor, cantidad, precio_unitario, subtotal, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const listOrderRowsBase = `
  SELECT
    o.id,
    o.cliente,
    o.telefono,
    o.mensaje_original,
    o.direccion,
    o.fecha_entrega,
    o.metodo_pago,
    o.observaciones,
    o.estado,
    o.total,
    o.source_message_id,
    o.created_at,
    o.updated_at,
    oi.id AS item_id,
    oi.producto,
    oi.sabor,
    oi.cantidad,
    oi.precio_unitario,
    oi.subtotal,
    oi.created_at AS item_created_at
  FROM orders o
  LEFT JOIN order_items oi ON oi.order_id = o.id
`;

const getOrderByIdStatement = db.prepare(`${listOrderRowsBase} WHERE o.id = ? ORDER BY datetime(o.created_at) DESC, datetime(oi.created_at) ASC`);
const getOrderBySourceMessageIdStatement = db.prepare(`${listOrderRowsBase} WHERE o.source_message_id = ? ORDER BY datetime(o.created_at) DESC, datetime(oi.created_at) ASC`);
const getActiveOrderByPhoneStatement = db.prepare(`${listOrderRowsBase} WHERE o.telefono = ? AND o.closure_id IS NULL AND o.estado IN ('pendiente', 'en proceso') ORDER BY datetime(o.created_at) DESC, datetime(oi.created_at) ASC`);
const listOrdersStatement = db.prepare(`${listOrderRowsBase} WHERE o.closure_id IS NULL ORDER BY datetime(o.created_at) DESC, datetime(oi.created_at) ASC`);
const listOrdersByStatusStatement = db.prepare(`${listOrderRowsBase} WHERE o.closure_id IS NULL AND o.estado = ? ORDER BY datetime(o.created_at) DESC, datetime(oi.created_at) ASC`);
const listOrdersIncludingArchivedStatement = db.prepare(`${listOrderRowsBase} ORDER BY datetime(o.created_at) DESC, datetime(oi.created_at) ASC`);
const listOrdersIncludingArchivedByStatusStatement = db.prepare(`${listOrderRowsBase} WHERE o.estado = ? ORDER BY datetime(o.created_at) DESC, datetime(oi.created_at) ASC`);
const updateOrderStatusStatement = db.prepare(`UPDATE orders SET estado = ?, updated_at = ? WHERE id = ?`);
const countOrdersStatement = db.prepare("SELECT COUNT(*) AS total FROM orders WHERE closure_id IS NULL");
const getOrderItemsCountStatement = db.prepare("SELECT COUNT(*) AS total FROM order_items WHERE order_id = ?");
const getOrderExistenceStatement = db.prepare("SELECT id FROM orders WHERE id = ?");
const insertMessageStatement = db.prepare(`
  INSERT INTO messages (id, phone, direction, message_text, whatsapp_message_id, created_at, order_id)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const getMessageByWhatsAppIdStatement = db.prepare(`
  SELECT id, phone, direction, message_text, whatsapp_message_id, created_at, order_id
  FROM messages
  WHERE whatsapp_message_id = ?
`);
const updateMessageOrderStatement = db.prepare(`UPDATE messages SET order_id = ? WHERE id = ?`);
const countMessagesByPhoneStatement = db.prepare(`SELECT COUNT(*) AS total FROM messages WHERE phone = ?`);
const listMessagesByPhoneStatement = db.prepare(`
  SELECT id, phone, direction, message_text, whatsapp_message_id, created_at, order_id
  FROM messages
  WHERE phone = ?
  ORDER BY datetime(created_at) ASC, rowid ASC
`);
const conversationExistsStatement = db.prepare(`SELECT 1 AS exists_flag FROM messages WHERE phone = ? LIMIT 1`);
const deactivateCatalogProductsBySourceStatement = db.prepare(`UPDATE catalog_products SET activo = 0, updated_at = ? WHERE source_url = ?`);
const upsertCatalogProductStatement = db.prepare(`
  INSERT INTO catalog_products (id, nombre, precio, categoria, aliases, activo, source_url, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    nombre = excluded.nombre,
    precio = excluded.precio,
    categoria = excluded.categoria,
    aliases = excluded.aliases,
    activo = excluded.activo,
    source_url = excluded.source_url,
    updated_at = excluded.updated_at
`);
const listCatalogProductsStatement = db.prepare(`
  SELECT id, nombre, precio, categoria, aliases, activo, source_url, updated_at
  FROM catalog_products
  ORDER BY LOWER(nombre) ASC, rowid ASC
`);
const listActiveCatalogProductsStatement = db.prepare(`
  SELECT id, nombre, precio, categoria, aliases, activo, source_url, updated_at
  FROM catalog_products
  WHERE activo = 1
  ORDER BY LOWER(nombre) ASC, rowid ASC
`);
const countCatalogProductsStatement = db.prepare(`SELECT COUNT(*) AS total FROM catalog_products WHERE activo = 1`);
const countAllCatalogProductsStatement = db.prepare(`SELECT COUNT(*) AS total FROM catalog_products`);
const countInactiveCatalogProductsStatement = db.prepare(`SELECT COUNT(*) AS total FROM catalog_products WHERE activo = 0`);
const insertDailyClosureStatement = db.prepare(`
  INSERT INTO daily_closures (id, date_key, title, summary_json, pdf_path, archived_orders_count, total_sales, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const listDailyClosuresStatement = db.prepare(`
  SELECT id, date_key, title, summary_json, pdf_path, archived_orders_count, total_sales, created_at
  FROM daily_closures
  ORDER BY datetime(created_at) DESC, rowid DESC
`);
const getDailyClosureByIdStatement = db.prepare(`
  SELECT id, date_key, title, summary_json, pdf_path, archived_orders_count, total_sales, created_at
  FROM daily_closures
  WHERE id = ?
  LIMIT 1
`);
const archiveOrdersByClosureStatement = db.prepare(`
  UPDATE orders
  SET closure_id = ?, archived_at = ?, updated_at = ?
  WHERE id = ?
`);

const LIST_CONVERSATIONS_BASE_QUERY = `
  WITH ranked_messages AS (
    SELECT
      m.phone,
      m.message_text,
      m.direction,
      m.created_at,
      m.order_id AS last_message_order_id,
      m.rowid AS message_rowid,
      ROW_NUMBER() OVER (
        PARTITION BY m.phone
        ORDER BY datetime(m.created_at) DESC, m.rowid DESC
      ) AS conversation_rank
    FROM messages m
  )
  SELECT
    rm.phone,
    rm.message_text,
    rm.direction,
    rm.created_at,
    rm.last_message_order_id,
    rm.message_rowid,
    (
      SELECT m2.order_id
      FROM messages m2
      WHERE m2.phone = rm.phone
        AND m2.order_id IS NOT NULL
      ORDER BY datetime(m2.created_at) DESC, m2.rowid DESC
      LIMIT 1
    ) AS last_order_id
  FROM ranked_messages rm
  WHERE rm.conversation_rank = 1
`;

function normalizeConversationSearchQuery(value) {
  const normalized = normalizeText(value);
  return normalized ? normalized.toLowerCase() : null;
}

function buildConversationSearchClause(query) {
  const normalizedQuery = normalizeConversationSearchQuery(query);

  if (!normalizedQuery) {
    return { clause: "", params: [] };
  }

  const likeValue = `%${normalizedQuery}%`;

  return {
    clause: `
      AND (
        LOWER(rm.phone) LIKE ?
        OR LOWER(COALESCE(rm.message_text, '')) LIKE ?
        OR EXISTS (
          SELECT 1
          FROM orders o
          WHERE o.telefono = rm.phone
            AND LOWER(COALESCE(o.cliente, '')) LIKE ?
        )
      )
    `,
    params: [likeValue, likeValue, likeValue]
  };
}

function buildConversationRowsQuery({ query, limit, offset } = {}) {
  const { clause, params } = buildConversationSearchClause(query);
  const sql = `${LIST_CONVERSATIONS_BASE_QUERY}
    ${clause}
    ORDER BY datetime(rm.created_at) DESC, rm.message_rowid DESC
    LIMIT ? OFFSET ?
  `;

  return {
    sql,
    params: [...params, limit, offset]
  };
}

function buildConversationCountQuery({ query } = {}) {
  const { clause, params } = buildConversationSearchClause(query);
  return {
    sql: `SELECT COUNT(*) AS total FROM (${LIST_CONVERSATIONS_BASE_QUERY} ${clause}) conversation_rows`,
    params
  };
}

function hydrateOrders(rows = []) {
  const grouped = new Map();

  for (const row of rows) {
    if (!grouped.has(row.id)) {
      grouped.set(row.id, {
        id: row.id,
        cliente: row.cliente,
        telefono: row.telefono,
        mensajeOriginal: row.mensaje_original,
        direccion: row.direccion,
        fechaEntrega: row.fecha_entrega,
        metodoPago: row.metodo_pago,
        observaciones: row.observaciones,
        estado: normalizeStatus(row.estado),
        estadoLabel: humanizeStatus(row.estado),
        total: parseOptionalNumber(row.total),
        sourceMessageId: row.source_message_id,
        fechaRegistro: row.created_at,
        updatedAt: row.updated_at,
        items: []
      });
    }

    const order = grouped.get(row.id);

    if (row.item_id) {
      const cantidad = row.cantidad;
      order.items.push({
        id: row.item_id,
        producto: normalizeText(row.producto),
        sabor: normalizeText(row.sabor),
        cantidad: Number.isFinite(Number(cantidad)) ? Number(cantidad) : cantidad,
        precioUnitario: parseOptionalNumber(row.precio_unitario),
        subtotal: parseOptionalNumber(row.subtotal)
      });
    }
  }

  return Array.from(grouped.values()).map((order) => {
    const resumenItems = order.items.map((item) => {
      const cantidad = item.cantidad ?? "?";
      const partes = [String(cantidad), item.producto || "producto", item.sabor || null].filter(Boolean);
      return partes.join(" ");
    }).filter(Boolean);
    const productos = [...new Set(order.items.map((item) => item.producto).filter(Boolean))];
    const sabores = order.items.map((item) => item.sabor).filter(Boolean);
    const cantidades = order.items.map((item) => item.cantidad).filter((value) => value !== null && value !== undefined && value !== "");
    const totalCantidad = cantidades.length > 0 && cantidades.every((value) => typeof value === "number")
      ? cantidades.reduce((sum, value) => sum + value, 0)
      : (cantidades.join(", ") || null);
    const computedTotal = order.items.reduce((sum, item) => {
      const subtotal = parseOptionalNumber(item.subtotal);
      return subtotal === null ? sum : sum + subtotal;
    }, 0);

    return {
      id: order.id,
      fechaRegistro: order.fechaRegistro,
      updatedAt: order.updatedAt,
      cliente: order.cliente,
      telefono: order.telefono,
      mensajeOriginal: order.mensajeOriginal,
      resumenItems: resumenItems.join(", ") || null,
      producto: productos.join(", ") || null,
      sabor: sabores.join(", ") || null,
      cantidad: totalCantidad,
      direccion: order.direccion,
      fechaEntrega: order.fechaEntrega,
      metodoPago: order.metodoPago,
      observaciones: order.observaciones,
      estado: order.estado,
      estadoLabel: order.estadoLabel,
      total: order.total ?? (computedTotal > 0 ? computedTotal : null),
      sourceMessageId: order.sourceMessageId,
      items: order.items,
      itemCount: order.items.length
    };
  });
}

function validateOrderForPersistence(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];

  if (!items.length) {
    const error = new Error("No se puede guardar un pedido sin productos");
    error.code = "INVALID_ORDER_PERSISTENCE";
    throw error;
  }

  if (!payload?.direccion) {
    const error = new Error("No se puede guardar un pedido sin dirección");
    error.code = "INVALID_ORDER_PERSISTENCE";
    throw error;
  }

  if (!payload?.metodoPago) {
    const error = new Error("No se puede guardar un pedido sin método de pago");
    error.code = "INVALID_ORDER_PERSISTENCE";
    throw error;
  }

  const invalidItem = items.find((item) => (
    !item.producto
    || !Number.isFinite(Number(item.cantidad))
    || Number(item.cantidad) <= 0
    || parseOptionalNumber(item.precioUnitario) === null
    || parseOptionalNumber(item.subtotal) === null
  ));

  if (invalidItem) {
    const error = new Error("No se puede guardar un pedido con items incompletos o sin precio válido");
    error.code = "INVALID_ORDER_PERSISTENCE";
    throw error;
  }

  const total = parseOptionalNumber(payload.total);
  if (total === null || total <= 0) {
    const error = new Error("No se puede guardar un pedido sin total válido");
    error.code = "INVALID_ORDER_PERSISTENCE";
    throw error;
  }
}

function listOrders({ status } = {}) {
  const normalizedStatus = normalizeText(status) ? normalizeStatus(status) : null;
  const rows = normalizedStatus
    ? listOrdersByStatusStatement.all(normalizedStatus)
    : listOrdersStatement.all();

  return hydrateOrders(rows);
}

function listOrdersIncludingArchived({ status } = {}) {
  const normalizedStatus = normalizeText(status) ? normalizeStatus(status) : null;
  const rows = normalizedStatus
    ? listOrdersIncludingArchivedByStatusStatement.all(normalizedStatus)
    : listOrdersIncludingArchivedStatement.all();

  return hydrateOrders(rows);
}

function getOrderById(orderId) {
  const rows = getOrderByIdStatement.all(orderId);
  return hydrateOrders(rows)[0] || null;
}

function countOrders() {
  const result = countOrdersStatement.get();
  return Number(result?.total || 0);
}

function getActiveOrderByPhone(phone) {
  const rows = getActiveOrderByPhoneStatement.all(normalizeText(phone));
  return hydrateOrders(rows)[0] || null;
}

function runInTransaction(work) {
  db.exec("BEGIN");

  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function saveOrder({
  id = randomUUID(),
  pedido,
  telefono = null,
  mensajeOriginal = null,
  sourceMessageId = null,
  createdAt = new Date().toISOString()
}) {
  const payload = {
    id,
    cliente: normalizeText(pedido?.cliente),
    telefono: normalizeText(telefono),
    mensajeOriginal: normalizeText(mensajeOriginal),
    direccion: normalizeText(pedido?.direccion),
    fechaEntrega: normalizeText(pedido?.fecha_entrega),
    metodoPago: normalizeText(pedido?.metodo_pago),
    observaciones: normalizeText(pedido?.observaciones),
    estado: normalizeStatus(pedido?.estado),
    total: parseOptionalNumber(pedido?.total),
    sourceMessageId: normalizeText(sourceMessageId),
    createdAt,
    updatedAt: createdAt,
    items: (Array.isArray(pedido?.productos) ? pedido.productos : []).map((item) => ({
      id: randomUUID(),
      producto: normalizeText(item?.producto),
      sabor: normalizeText(item?.sabor),
      cantidad: Number.isFinite(Number(item?.cantidad)) ? Number(item.cantidad) : null,
      precioUnitario: parseOptionalNumber(item?.precio_unitario),
      subtotal: parseOptionalNumber(item?.subtotal),
      createdAt
    }))
  };

  try {
    validateOrderForPersistence(payload);

    runInTransaction(() => {
      insertOrderStatement.run(
        payload.id,
        payload.cliente,
        payload.telefono,
        payload.mensajeOriginal,
        payload.direccion,
        payload.fechaEntrega,
        payload.metodoPago,
        payload.observaciones,
        payload.estado,
        payload.total,
        payload.sourceMessageId,
        payload.createdAt,
        payload.updatedAt
      );

      for (const item of payload.items) {
        insertOrderItemStatement.run(
          item.id,
          payload.id,
          item.producto,
          item.sabor,
          item.cantidad,
          item.precioUnitario,
          item.subtotal,
          item.createdAt
        );
      }
    });

    return getOrderById(payload.id);
  } catch (error) {
    if (String(error.message).includes("UNIQUE constraint failed: orders.source_message_id") && payload.sourceMessageId) {
      const rows = getOrderBySourceMessageIdStatement.all(payload.sourceMessageId);
      return hydrateOrders(rows)[0] || null;
    }

    throw error;
  }
}

function updateOrderStatus(orderId, newStatus) {
  const status = normalizeStatus(newStatus);

  if (!ESTADOS_VALIDOS.has(status)) {
    throw new Error("Estado no válido");
  }

  const info = updateOrderStatusStatement.run(status, new Date().toISOString(), orderId);

  if (!info.changes) {
    const error = new Error("Pedido no encontrado");
    error.code = "ORDER_NOT_FOUND";
    throw error;
  }

  return getOrderById(orderId);
}

function importOrders(orders = []) {
  if (!Array.isArray(orders) || orders.length === 0) {
    return { imported: 0 };
  }

  runInTransaction(() => {
    for (const order of orders) {
      const orderId = normalizeText(order.id) || randomUUID();
      const exists = getOrderExistenceStatement.get(orderId);

      const items = Array.isArray(order.items) ? order.items : [];
      const computedTotal = items.reduce((sum, item) => sum + (parseOptionalNumber(item.subtotal) || 0), 0);

      if (!exists) {
        insertOrderStatement.run(
          orderId,
          normalizeText(order.cliente),
          normalizeText(order.telefono),
          normalizeText(order.mensajeOriginal),
          normalizeText(order.direccion),
          normalizeText(order.fechaEntrega),
          normalizeText(order.metodoPago),
          normalizeText(order.observaciones),
          normalizeStatus(order.estado),
          parseOptionalNumber(order.total) ?? (computedTotal > 0 ? computedTotal : null),
          normalizeText(order.sourceMessageId),
          normalizeText(order.fechaRegistro) || new Date().toISOString(),
          normalizeText(order.updatedAt) || normalizeText(order.fechaRegistro) || new Date().toISOString()
        );
      }

      const itemCount = Number(getOrderItemsCountStatement.get(orderId)?.total || 0);
      if (itemCount > 0) {
        continue;
      }

      const createdAt = normalizeText(order.fechaRegistro) || new Date().toISOString();

      for (const item of items) {
        insertOrderItemStatement.run(
          normalizeText(item.id) || randomUUID(),
          orderId,
          normalizeText(item.producto),
          normalizeText(item.sabor),
          Number.isFinite(Number(item.cantidad)) ? Number(item.cantidad) : null,
          parseOptionalNumber(item.precioUnitario ?? item.precio_unitario),
          parseOptionalNumber(item.subtotal),
          createdAt
        );
      }
    }
  });

  return { imported: orders.length };
}

function hydrateMessage(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    phone: row.phone,
    direction: row.direction,
    messageText: row.message_text,
    whatsappMessageId: row.whatsapp_message_id,
    createdAt: row.created_at,
    orderId: row.order_id
  };
}

function hydrateCatalogProduct(row) {
  if (!row) {
    return null;
  }

  let aliases = [];

  if (row.aliases) {
    try {
      const parsed = JSON.parse(row.aliases);
      if (Array.isArray(parsed)) {
        aliases = parsed.map((value) => normalizeText(value)).filter(Boolean);
      }
    } catch (_error) {
      aliases = [];
    }
  }

  return {
    id: row.id,
    nombre: normalizeText(row.nombre),
    precio: parseOptionalNumber(row.precio),
    categoria: normalizeText(row.categoria),
    aliases,
    activo: Boolean(row.activo),
    sourceUrl: normalizeText(row.source_url),
    updatedAt: row.updated_at
  };
}

function syncCatalogProducts(products = [], { sourceUrl = null } = {}) {
  const normalizedSourceUrl = normalizeText(sourceUrl);
  const updatedAt = new Date().toISOString();
  const safeProducts = Array.isArray(products) ? products : [];

  runInTransaction(() => {
    if (normalizedSourceUrl) {
      deactivateCatalogProductsBySourceStatement.run(updatedAt, normalizedSourceUrl);
    }

    for (const product of safeProducts) {
      const id = normalizeText(product?.id);
      const nombre = normalizeText(product?.nombre);

      if (!id || !nombre) {
        continue;
      }

      const aliases = Array.isArray(product?.aliases)
        ? product.aliases.map((value) => normalizeText(value)).filter(Boolean)
        : [];

      upsertCatalogProductStatement.run(
        id,
        nombre,
        parseOptionalNumber(product?.precio),
        normalizeText(product?.categoria),
        JSON.stringify(aliases),
        product?.activo === false ? 0 : 1,
        normalizedSourceUrl,
        updatedAt
      );
    }
  });

  return {
    total: safeProducts.length,
    active: countCatalogProducts()
  };
}

function listCatalogProducts({ activeOnly = true } = {}) {
  const rows = activeOnly ? listActiveCatalogProductsStatement.all() : listCatalogProductsStatement.all();
  return rows.map(hydrateCatalogProduct);
}

function countCatalogProducts() {
  const result = countCatalogProductsStatement.get();
  return Number(result?.total || 0);
}

function countAllCatalogProducts() {
  const result = countAllCatalogProductsStatement.get();
  return Number(result?.total || 0);
}

function countInactiveCatalogProducts() {
  const result = countInactiveCatalogProductsStatement.get();
  return Number(result?.total || 0);
}

function listConversations({ limit = 20, offset = 0, query = null } = {}) {
  const safeLimit = Number.isInteger(limit) ? limit : 20;
  const safeOffset = Number.isInteger(offset) ? offset : 0;
  const rowsQuery = buildConversationRowsQuery({ query, limit: safeLimit, offset: safeOffset });
  const countQuery = buildConversationCountQuery({ query });
  const rows = db.prepare(rowsQuery.sql).all(...rowsQuery.params);
  const countRow = db.prepare(countQuery.sql).get(...countQuery.params);

  return {
    total: Number(countRow?.total || 0),
    conversations: rows.map((row) => ({
      phone: row.phone,
      lastMessage: row.message_text,
      lastMessageDirection: row.direction,
      lastMessageAt: row.created_at,
      lastMessageOrderId: row.last_message_order_id || null,
      lastOrderId: row.last_order_id || null,
      orderId: row.last_message_order_id || null
    }))
  };
}

function listMessagesByPhone(phone) {
  return listMessagesByPhoneStatement.all(normalizeText(phone)).map(hydrateMessage);
}

function countMessagesByPhone(phone) {
  const result = countMessagesByPhoneStatement.get(normalizeText(phone));
  return Number(result?.total || 0);
}

function conversationExists(phone) {
  return Boolean(conversationExistsStatement.get(normalizeText(phone))?.exists_flag);
}

function saveMessage({
  id = randomUUID(),
  phone,
  direction,
  messageText,
  whatsappMessageId = null,
  createdAt = new Date().toISOString(),
  orderId = null
}) {
  const payload = {
    id,
    phone: normalizeText(phone),
    direction: normalizeText(direction),
    messageText: normalizeText(messageText),
    whatsappMessageId: normalizeText(whatsappMessageId),
    createdAt,
    orderId: normalizeText(orderId)
  };

  if (!payload.phone) {
    throw new Error("Telefono requerido para guardar mensaje");
  }

  if (!["in", "out"].includes(payload.direction)) {
    throw new Error("Direction inválido para mensaje");
  }

  try {
    insertMessageStatement.run(
      payload.id,
      payload.phone,
      payload.direction,
      payload.messageText,
      payload.whatsappMessageId,
      payload.createdAt,
      payload.orderId
    );

    return {
      id: payload.id,
      phone: payload.phone,
      direction: payload.direction,
      messageText: payload.messageText,
      whatsappMessageId: payload.whatsappMessageId,
      createdAt: payload.createdAt,
      orderId: payload.orderId
    };
  } catch (error) {
    if (String(error.message).includes("UNIQUE constraint failed: messages.whatsapp_message_id") && payload.whatsappMessageId) {
      const existing = getMessageByWhatsAppIdStatement.get(payload.whatsappMessageId);
      return hydrateMessage(existing);
    }

    throw error;
  }
}

function updateMessageOrder(messageId, orderId) {
  updateMessageOrderStatement.run(normalizeText(orderId), messageId);
}

function hydrateDailyClosure(row) {
  if (!row) {
    return null;
  }

  let summary = null;

  if (row.summary_json) {
    try {
      summary = JSON.parse(row.summary_json);
    } catch (_error) {
      summary = null;
    }
  }

  return {
    id: row.id,
    dateKey: row.date_key,
    title: row.title,
    summary,
    pdfPath: row.pdf_path,
    archivedOrdersCount: Number(row.archived_orders_count || 0),
    totalSales: parseOptionalNumber(row.total_sales),
    createdAt: row.created_at
  };
}

function createDailyClosure({
  id = randomUUID(),
  dateKey,
  title = null,
  summary,
  pdfPath = null,
  orderIds = [],
  createdAt = new Date().toISOString()
}) {
  const safeSummary = summary && typeof summary === "object" ? summary : {};
  const safeOrderIds = Array.isArray(orderIds)
    ? [...new Set(orderIds.map((value) => normalizeText(value)).filter(Boolean))]
    : [];

  runInTransaction(() => {
    insertDailyClosureStatement.run(
      id,
      normalizeText(dateKey) || createdAt.slice(0, 10),
      normalizeText(title),
      JSON.stringify(safeSummary),
      normalizeText(pdfPath),
      safeOrderIds.length,
      parseOptionalNumber(safeSummary?.stats?.totalSales ?? safeSummary?.totalSales),
      createdAt
    );

    for (const orderId of safeOrderIds) {
      archiveOrdersByClosureStatement.run(id, createdAt, createdAt, orderId);
    }
  });

  return getDailyClosureById(id);
}

function listDailyClosures() {
  return listDailyClosuresStatement.all().map(hydrateDailyClosure);
}

function getDailyClosureById(id) {
  return hydrateDailyClosure(getDailyClosureByIdStatement.get(id));
}

module.exports = {
  db,
  databasePath,
  ESTADOS_VALIDOS,
  normalizeStatus,
  humanizeStatus,
  saveOrder,
  listOrders,
  listOrdersIncludingArchived,
  getOrderById,
  updateOrderStatus,
  countOrders,
  getActiveOrderByPhone,
  importOrders,
  saveMessage,
  updateMessageOrder,
  syncCatalogProducts,
  listCatalogProducts,
  countCatalogProducts,
  countAllCatalogProducts,
  countInactiveCatalogProducts,
  listConversations,
  listMessagesByPhone,
  countMessagesByPhone,
  conversationExists,
  createDailyClosure,
  listDailyClosures,
  getDailyClosureById
};
