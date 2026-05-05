const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "state", "treinta-catalog.html"), "utf8");

const snippets = [];
for (const match of html.matchAll(/(?:Aloe|Cafe|Caf\u00e9|Café|Ancheta|Arequipe|Quesos|garrafa|litro)[\s\S]{0,300}/gi)) {
  snippets.push(match[0]);
  if (snippets.length >= 40) break;
}

const possibleJsons = [];
for (const match of html.matchAll(/\{[^{}]{0,500}(?:price|precio|name|nombre|category|categoria|product)[^{}]{0,500}\}/gi)) {
  possibleJsons.push(match[0]);
  if (possibleJsons.length >= 80) break;
}

console.log(JSON.stringify({
  snippets,
  possibleJsonsCount: possibleJsons.length,
  possibleJsons: possibleJsons.slice(0, 20)
}, null, 2));
