const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const reportsDir = path.join(__dirname, "data", "closures");
fs.mkdirSync(reportsDir, { recursive: true });

function formatCurrency(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  }).format(number);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "-";
  }

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function safeText(value) {
  return String(value ?? "").replace(/[\u{1F300}-\u{1FAFF}]/gu, "").trim();
}

async function generateDailyClosurePdf({ closureId, summary }) {
  const filePath = path.join(reportsDir, `${closureId}.pdf`);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fontSize(22).fillColor("#19324d").text("Tellolac AI", { align: "left" });
    doc.moveDown(0.2);
    doc.fontSize(12).fillColor("#4b647f").text("Cierre de día · Powered by Abi AI");
    doc.moveDown();

    doc.fontSize(14).fillColor("#10243e").text(safeText(summary?.title || "Resumen operativo"));
    doc.fontSize(10).fillColor("#6b7b8d").text(`Generado: ${formatDate(summary?.generatedAt || new Date().toISOString())}`);
    doc.moveDown();

    const stats = summary?.stats || {};
    const paymentBreakdown = summary?.paymentBreakdown || [];
    const orders = Array.isArray(summary?.orders) ? summary.orders : [];

    doc.fontSize(12).fillColor("#10243e").text(`Pedidos archivados: ${stats.totalOrders || 0}`);
    doc.text(`Ventas del día: ${formatCurrency(stats.totalSales || 0)}`);
    doc.text(`Pendientes: ${stats.pending || 0}`);
    doc.text(`Entregados: ${stats.delivered || 0}`);
    doc.text(`Cancelados: ${stats.cancelled || 0}`);
    doc.moveDown();

    doc.fontSize(13).fillColor("#10243e").text("Métodos de pago");
    doc.moveDown(0.4);
    if (!paymentBreakdown.length) {
      doc.fontSize(10).fillColor("#6b7b8d").text("No hubo métodos de pago registrados.");
    } else {
      paymentBreakdown.forEach((item) => {
        doc.fontSize(10).fillColor("#23384d").text(`${safeText(item.label || "Sin definir")}: ${item.count || 0} pedido(s) · ${formatCurrency(item.total || 0)}`);
      });
    }

    doc.moveDown();
    doc.fontSize(13).fillColor("#10243e").text("Pedidos");
    doc.moveDown(0.4);

    if (!orders.length) {
      doc.fontSize(10).fillColor("#6b7b8d").text("No hubo pedidos para archivar.");
    } else {
      orders.forEach((order, index) => {
        if (doc.y > 700) {
          doc.addPage();
        }

        doc.fontSize(11).fillColor("#10243e").text(`${index + 1}. ${safeText(order.cliente || "Cliente sin nombre")} · ${formatCurrency(order.total || 0)}`);
        doc.fontSize(9).fillColor("#4b647f").text(`Estado: ${safeText(order.estadoLabel || order.estado || "Pendiente")}`);
        doc.text(`Pago: ${safeText(order.metodoPago || "Sin definir")}`);
        doc.text(`Detalle: ${safeText(order.resumenItems || "Sin detalle")}`);
        doc.text(`Teléfono: ${safeText(order.telefono || "-")}`);
        doc.text(`Fecha: ${formatDate(order.fechaRegistro)}`);
        doc.moveDown(0.6);
      });
    }

    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return filePath;
}

module.exports = {
  reportsDir,
  generateDailyClosurePdf
};
