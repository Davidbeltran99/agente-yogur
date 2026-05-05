require("dotenv").config();

const { procesarMensaje } = require("../ollama");

async function main() {
  const mensaje = process.argv.slice(2).join(" ") || "Hola, soy Laura. Quiero 2 yogures de mora y 1 de fresa. Me los envías hoy a las 4 pm a Barrio Centro. Pago por Nequi.";

  const pedido = await procesarMensaje(mensaje);
  console.log(JSON.stringify(pedido, null, 2));
}

main().catch((error) => {
  console.error("Error probando mensaje:", error.response?.data || error.message);
  process.exit(1);
});
