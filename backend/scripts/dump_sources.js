import fs from "fs";
import path from "path";


// --- Načtení pracovního adresáře a data.json ---
const workingDir = process.argv[2];
if (!workingDir) {
  console.error('Chyba: Nebyl předán pracovní adresář jako parametr');
  process.exit(1);
}
// Globální objekt pro data
let data = {};

try {
  const dataPath = path.join(workingDir, 'data.json');
  const dataContent = fs.readFileSync(dataPath, 'utf-8');
  data = JSON.parse(dataContent);
  console.log('Data.json byl úspěšně načten');
  mergeFiles(data.workflow.map(s => s.trim()).filter(s => s !== "" && s.startsWith("analyzy")),{outputFile:'zdrojovy_kod_analyzy.txt'})
} catch (error) {
  console.error('Chyba při načítání data.json:', error.message);
  process.exit(1);
}

function mergeFiles(fileList, {
  baseDir = path.resolve(process.cwd(), "../../scripts"),
  separator = "\n\n====== ZACATEK DALSIHO SKRIPTU ========\n\n",
  outputFile = "merged.txt"
} = {}) {
//    console.log(`basedir ${baseDir}`);
  const contents = fileList.map(relPath => {
    const fullPath = path.resolve(baseDir, relPath);
    return fs.readFileSync(fullPath, "utf8");
  });

  const merged = contents.join(separator);
  fs.writeFileSync(outputFile, merged, "utf8");
}