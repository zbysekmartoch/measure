// fix_types.js
import fs from "fs";
import path from "path";

function toNumberIfNumeric(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === "number") return v;

  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return v;

    // povolí: 123, -123, 12.34, -12.34, 1e-3
    if (!/^[+-]?(?:\d+\.?\d*|\d*\.?\d+)(?:[eE][+-]?\d+)?$/.test(s)) return v;

    const n = Number(s);
    return Number.isFinite(n) ? n : v;
  }

  return v;
}

function castSelectedFields(obj, fields) {
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(obj, f)) {
      obj[f] = toNumberIfNumeric(obj[f]);
    }
  }
  return obj;
}

const workingDir = process.argv[2];
if (!workingDir) {
  console.error("Použití: node fix_types.js /cesta/k/pracovnimu/adresari");
  process.exit(1);
}

const dataPath = path.join(workingDir, "data.json");
const raw = fs.readFileSync(dataPath, "utf-8");
const data = JSON.parse(raw);

// zde si řekneš, co přesně chceš přetypovat v products
const productNumericFields = [
  "id",      // pokud chceš id jako number, nech; jinak smaž
  "N",
  "T0",
  "determ",
  // případně další, které se ti občas vrací jako string:
  // "Nmin","Nmax","Pmin","Pmax","Pmode","Pp","Pmed","PmodeAll","Nmode"
];

if (Array.isArray(data.products)) {
  data.products = data.products.map(p => castSelectedFields({ ...p }, productNumericFields));
}

fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), "utf-8");
console.log("Hotovo: přetypování proběhlo a data.json je uložené.");
