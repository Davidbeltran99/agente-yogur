const axios = require("axios");
const fs = require("fs");
const path = require("path");

async function main() {
  const url = "https://catalogo.treinta.co/tellolac";
  const response = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    },
    timeout: 30000
  });

  const html = response.data;
  const outPath = path.join(__dirname, "..", "state", "treinta-catalog.html");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, "utf8");

  const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  const apiHints = Array.from(new Set((html.match(/https:\/\/[^"'\s<>]+|\/[_a-zA-Z0-9\-/.?=&]+/g) || [])
    .filter((item) => /catalog|producto|api|graphql|json|_next/i.test(item))
    .slice(0, 200)));

  console.log(JSON.stringify({
    savedTo: outPath,
    hasNextData: Boolean(nextDataMatch),
    apiHints: apiHints.slice(0, 80),
    head: html.slice(0, 4000)
  }, null, 2));
}

main().catch((error) => {
  console.error(error.response?.data || error.stack || error.message);
  process.exit(1);
});
