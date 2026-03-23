import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
//import mysql from 'mysql2/promise';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import ImageModule from 'docxtemplater-image-module-free';
import { DateTime } from "luxon";

const DEFAULT_LOCALE = "cs";
const DEFAULT_ZONE = "Europe/Prague";
const DEFAULT_PATTERN = "dd. MM. yyyy";

// tokeny, které laikům dávají smysl a pokryjí datum+čas+jazyk
const ALLOWED_TOKENS = new Set([
  "yyyy",
  "MM", "dd", "M", "d",
  "HH", "mm", "ss",
  "ccc", "cccc",     // den v týdnu (krátký / dlouhý)
  "LLL", "LLLL"      // měsíc textem (krátký / dlouhý)
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let IMAGES_DIR;
// --- Načtení parametrů ---
// argv[2] = RESULT_ROOT, argv[3] = WORKFLOW_ROOT (ignorován), argv[4] = LAB_ROOT
// Pokud nejsou zadány, použije se složka skriptu (pro testování)
const RESULT_ROOT = process.argv[2] || __dirname;
const LAB_ROOT = process.argv[4] || __dirname;

console.log(`RESULT_ROOT: ${RESULT_ROOT}`);
console.log(`LAB_ROOT:    ${LAB_ROOT}`);

let gImgParams=[]; // globální pole parametrů obrázků

// Globální objekt pro data
let data = {};

function loadData(dataFilePath) {
    try {
        const dataContent = fs.readFileSync(dataFilePath, 'utf-8');
        data = JSON.parse(dataContent);
        console.log(`Data načtena: ${dataFilePath}`);
    } catch (error) {
        console.error(`Chyba při načítání ${dataFilePath}:`, error.message);
        process.exit(1);
    }
}

function loadEnvironment() {
    const envPath = path.join(RESULT_ROOT, 'environment.json');
    try {
        const content = fs.readFileSync(envPath, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        console.error(`Chyba při načítání environment.json: ${error.message}`);
        process.exit(1);
    }
}



function getSubfolders(dirPath) {
    return fs.readdirSync(dirPath, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
}

function makeObjectFromKeys(keys, value) {
    return Object.fromEntries(keys.map(k => [k, value]));
}


function enhanceProducts(products) {
    products.forEach(p => {
         let charCaptions = {
            N: 'N - Počet pozorování za vybrané období',
            Nmin: 'Nmin - minimální počet nenulového denního pozorování',
            Nmax: 'Nmax - maximální počet nenulového denního pozorování',
            Pmin: 'Pmin - minimální cena za vybrané období',
            Pmax: 'Pmax - maximální cena za vybrané období',
            PmodeAll: 'Pmode - Nejnižší nejčastější cena za vybrané období',
            Pp: 'Pp - Průměrná cena za  vybrané období',
            Pmed: 'Pmed - Mediánová cena za vybrané období',
            Nmode: 'Počet výskytů Pmode za vybrané období',
            T0: 'Počet dní s žádnou pozorovanou cenou',
            determ: 'Hodnota determinace cen'
        }
        let characteristics = Object.keys(p)
            .filter(k => ['N', 'Nmin', 'Nmax', 'Pmin', 'Pmax', 'PmodeAll', 'Nmode', 'T0', 'Pp', 'Pmed', 'determ'].includes(k))
            .map(k => ({ key: charCaptions[k], value: p[k] ?? '' }));

        p.characteristics = characteristics;
    });
}


// --- Image module config pro Docxtemplater ---
function buildImageModule(allProducts) {
    // Mapuj index → buffer obrázku (vyřešíme dopředu, ať v getImage jen sáhne do cache)

    return new ImageModule({
        centered: false,
        getImage: function (tagValue, tagName) {
            // tagValue očekáváme jako index produktu (číslo) nebo přímo buffer/filepath
            // V šabloně použijeme {{{img/slozka}}} a do data vložíme id → tady z cache vrátíme buffer.
            let subFolderName = gImgParams[tagValue]?.params?.path;
            let index = gImgParams[tagValue]?.pathArr.slice(-2,-1)[0]; // předposlední část path je index v poli
            let filename = gImgParams[tagValue]?.params?.filename;
            let imgPath = path.join(`${RESULT_ROOT}/${filename}`);
 
            // Pokud je tagValue přímo buffer nebo cesta k souboru, použij to
   
            if (fs.existsSync(imgPath)) {
                return fs.readFileSync(imgPath);
            }

            // Bez obrázku vrať 1×1 transparentní PNG (aby se generování nezastavilo)
            const emptyPng = Buffer.from(
                '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C63600000020001' +
                '0001055DF2A00000000049454E44AE426082', 'hex'
            );
            return emptyPng;
        },
        getSize: function (img, tagValue, tagName) {
            return [gImgParams[tagValue]?.params?.width||500, 
            gImgParams[tagValue]?.params?.height||400];
        },
    });
}

function ISO2CZ(date) {
    const [year, month, day] = date.split('-');
    const formatted = `${parseInt(day)}.${parseInt(month)}.${year}`;
    return formatted;
}

function  fixTagsAndData(zip, reportData) {

}

function convertDocxToPdf(inputPath, outDir) {
    return new Promise((resolve, reject) => {
        execFile(
            'soffice',
            [
                '--headless',
                '--nologo',
                '--nofirststartwizard',
                '--norestore',
                '--convert-to', 'pdf',
                '--outdir', outDir,
                inputPath
            ],
            (error, stdout, stderr) => {
                if (error) return reject(error);
                const pdfName = path.basename(inputPath, '.docx') + '.pdf';
                const pdfPath = path.join(outDir, pdfName);
                resolve(pdfPath);
            }
        );
    });
}

async function main() {

    // 1) Načti konfiguraci z environment.json
    const environment = loadEnvironment();

    IMAGES_DIR = path.join(RESULT_ROOT, 'img');

    // 2) Zjisti konfigurace dokumentů
    let docConfigs = [];
    
    if (environment.report && environment.report.doc && Array.isArray(environment.report.doc)) {
        docConfigs = environment.report.doc;
        console.log(`Nalezeno ${docConfigs.length} konfigurací dokumentů v environment.json`);
    } else {
        // Fallback na výchozí konfiguraci pro zpětnou kompatibilitu
        console.log('Konfigurace report.doc nenalezena, použiji výchozí template.docx');
        docConfigs = [{
            template: 'template.docx',
            renderTo: 'report.docx',
            data: 'data.json'
        }];
    }

    // 3) Zpracuj každý dokument
    for (const docConfig of docConfigs) {
        const templateRelPath = docConfig.template;
        const outputRelPath = docConfig.renderTo;
        const dataRelPath = docConfig.data || 'data.json';
        gImgParams = []; // reset pro každý dokument
        gImgParams.push({params:{},pathArr:[]}); // rezervuj index 0 pro případ, že by nějaký tag měl přímo buffer/cestu
        
        // Cesty: template relativní k LAB_ROOT, data a output relativní k RESULT_ROOT
        const templatePath = path.resolve(LAB_ROOT, templateRelPath);
        const dataPath = path.resolve(RESULT_ROOT, dataRelPath);
        const outPath = path.resolve(RESULT_ROOT, outputRelPath);

        console.log(`\nZpracovávám dokument:`);
        console.log(`  šablona: ${templatePath}`);
        console.log(`  data:    ${dataPath}`);
        console.log(`  výstup:  ${outPath}`);
        
        try {
            // Načti data pro tento dokument
            loadData(dataPath);
            let reportData = data;

            // Obrázky – podsložky v RESULT_ROOT/img
            if (fs.existsSync(IMAGES_DIR)) {
                let imgKeys = getSubfolders(IMAGES_DIR).map(e => 'img_' + e);
                imgKeys.push('img_product');
                if (reportData.products) {
                    reportData.products = reportData.products.map(p => ({ ...p, ...makeObjectFromKeys(imgKeys, p.id) }));
                }
            }

            let virtualData = createDeepIntrospectingGetLoggerProxy(reportData);

            if (!fs.existsSync(templatePath)) {
                console.error(`Chyba: Šablona nebyla nalezena: ${templatePath}`);
                continue;
            }
            
            const content = fs.readFileSync(templatePath, 'binary');
            const zip = new PizZip(content);

            const imageModule = buildImageModule(reportData.products);
            
            const doc = new Docxtemplater(zip, {
                modules: [imageModule],
                paragraphLoop: true,
                linebreaks: true,
                delimiters: { start: '[[', end: ']]' },
            });

            // Renderuj s daty
            doc.render(virtualData);

            // Vytvoř výstupní adresář pokud neexistuje
            const outDir = path.dirname(outPath);
            if (!fs.existsSync(outDir)) {
                fs.mkdirSync(outDir, { recursive: true });
            }

            // Ulož dokument
            const buf = doc.getZip().generate({ type: 'nodebuffer' });
            fs.writeFileSync(outPath, buf);
            
            console.log(`✓ Dokument vytvořen: ${outPath}`);

            // Export do PDF pokud je požadován
            if (docConfig.exportPDF) {
                const pdfPath = await convertDocxToPdf(outPath, outDir);
                console.log(`✓ PDF vytvořen: ${pdfPath}`);
            }
        } catch (error) {
            console.error(`✗ Chyba při zpracování dokumentu ${templateRelPath}:`, error.message);
        }
    }
    
    console.log(`\n=== Generování dokumentů dokončeno ===`);
}



main().catch(err => {
    console.error(err);
    process.exit(1);
});




function normalizeQuotes(str) {
  return str.replace(/[“”„‟«»‹›]/g, '"');
}


function normalizeProp(prop) {
/* Rozdělí prop na název a případné parametry ve formátu JSON objektu
   Vrací [propName, paramsObject|null]
*/    
    let params = null;
    let paramStr;
    if (typeof prop === "string") {
        paramStr=prop.split('{').slice(1).join('{');
        paramStr=normalizeQuotes(paramStr);
    }
    if (paramStr) {
        try {
            params = JSON.parse(`{${paramStr}`);
        } catch (e) {
            console.warn("Chyba při parsování parametrů ", paramStr);
        }
    }
    if (paramStr) {
        prop=prop.split('{')[0];
    }   
    return [prop, params];
}


function formatTemplateDate(iso, { dateFormat, locale, zone } = {}) {
    const usedFormat = dateFormat ?? DEFAULT_PATTERN;
    const usedLocale = locale ?? DEFAULT_LOCALE;
    const usedZone = zone ?? DEFAULT_ZONE;
    
    return DateTime.fromSQL(iso, { zone: usedZone }).setLocale(usedLocale).toFormat(usedFormat);
}

function customizeValue(value, params, pathArr) {
    // Upraví value dle params (např. formátování data)
    if (params.dateFormat) {  // ok jde o formátování datumu
        value = formatTemplateDate(value, params);
    }
    // pokud je poslední část pathArr "img", tak jde o obrázek a  vrátíme pathArr
    if (pathArr[pathArr.length - 1]=='img') {
        gImgParams.push({params,pathArr});
        value=gImgParams.length -1;
    }

    return value;
}



/**
 * Deep logging Proxy (transparentní pro většinu introspekce):
 * - get: loguje a vrací reálná data (vnořené objekty proxynuje dál)
 * - has: pro `prop in obj`
 * - getOwnPropertyDescriptor + ownKeys: pro `hasOwnProperty`, `Object.getOwnPropertyDescriptors`, `Object.keys`, `for...in`, …
 *
 * Pozn.: Identita objektu se změní (proxy !== target). Jinak se to chová jako target.
 */

function createDeepIntrospectingGetLoggerProxy(rootObj, {
  labelGet = "GET",
  labelHas = "HAS",
  labelKeys = "KEYS",
  labelDesc = "DESC",
  logSymbols = true,
} = {}) {
  if (rootObj === null || (typeof rootObj !== "object" && typeof rootObj !== "function")) {
    throw new TypeError("rootObj musí být objekt nebo funkce");
  }

  const cacheByTargetAndPath = new WeakMap(); // target -> Map(pathString -> proxy)

  const isObjectLike = (v) => v !== null && (typeof v === "object" || typeof v === "function");

  const keyToString = (k) => {
    if (typeof k === "symbol") return logSymbols ? k.toString() : "[symbol]";
    return String(k);
  };

  const pathToString = (pathArr) => pathArr.map(keyToString).join(".");

  const getProxy = (target, pathArr) => {
    let map = cacheByTargetAndPath.get(target);
    if (!map) {
      map = new Map();
      cacheByTargetAndPath.set(target, map);
    }

    const pathKey = pathToString(pathArr);
    if (map.has(pathKey)) return map.get(pathKey);

    const proxy = new Proxy(target, {
      get(t, prop, receiver) {
        // minimal special-casing: ať runtime nešílí při debug/inspect
        if (prop === Symbol.toStringTag) return Reflect.get(t, prop, receiver);

        let params;
        [prop,params]=normalizeProp(prop)

        const nextPath = pathArr.concat([prop]);
    //    console.log(`[${labelGet}]`, pathToString(nextPath));

        let value = Reflect.get(t, prop, receiver);
        if (params) {
            value=customizeValue(value,params,nextPath);
        }

        // metody: zachovej this (receiver = proxy)
        if (typeof value === "function") return value.bind(receiver);

        // vnořené objekty proxynout
        if (isObjectLike(value)) return getProxy(value, nextPath);

        return value;
      },

      has(t, prop) {
        // `prop in obj`
        const nextPath = pathArr.concat([prop]);
        console.log(`[${labelHas}]`, pathToString(nextPath));
        return Reflect.has(t, prop);
      },

      ownKeys(t) {
        // `for...in`, `Object.keys`, `Object.getOwnPropertyNames`, …
        console.log(`[${labelKeys}]`, pathToString(pathArr) || "<root>");
        return Reflect.ownKeys(t);
      },

      getOwnPropertyDescriptor(t, prop) {
        // `hasOwnProperty`, `Object.getOwnPropertyDescriptor(s)`, …
        const nextPath = pathArr.concat([prop]);
        console.log(`[${labelDesc}]`, pathToString(nextPath));
        return Reflect.getOwnPropertyDescriptor(t, prop);
      },
    });

    map.set(pathKey, proxy);
    return proxy;
  };

  return getProxy(rootObj, []);
}