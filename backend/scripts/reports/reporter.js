import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
//import mysql from 'mysql2/promise';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import ImageModule from 'docxtemplater-image-module-free';
import dotenv from 'dotenv';
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


dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

var IMAGES_DIR;
var PRODUCT_IMG_DIR;
// --- Načtení pracovního adresáře a data.json ---
const workingDir = process.argv[2];
if (!workingDir) {
    console.error('Chyba: Nebyl předán pracovní adresář jako parametr');
    process.exit(1);
}

let gImgParams=[]; // globální pole parametrů obrázků
gImgParams.push('a');

// Globální objekt pro data
let data = {};

function loadData() {
    try {
        const dataPath = path.join(workingDir, 'data.json');
        const dataContent = fs.readFileSync(dataPath, 'utf-8');
        data = JSON.parse(dataContent);
        console.log('Data.json byl úspěšně načten');
    } catch (error) {
        console.error('Chyba při načítání data.json:', error.message);
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
            let filename = gImgParams[tagValue]?.params?.filename;
            
            let index = gImgParams[tagValue]?.pathArr.slice(-2,-1)[0]; // předposlední část path je mozna index v poli
            let key = gImgParams[tagValue]?.pathArr.slice(-3,-2)[0]; // predpředposlední část path je mozna klic
            let imgPath;
            
            if (data?.[key]?.[index]?.id) {
                filename = data[key][index].id;
            }
            if (subFolderName) {
                imgPath = path.join(`${IMAGES_DIR}/${subFolderName}/${filename}`);
            } else {
                imgPath = path.join(`${IMAGES_DIR}/${filename}`);
            }
            
            if (gImgParams[tagValue]?.params?.product) { // je to obrazek produktu
                imgPath = path.join(`${PRODUCT_IMG_DIR}/product_${filename}`);
            }

            
             
 
            // Pokud je tagValue přímo buffer nebo cesta k souboru, použij to
   
            if (fs.existsSync(imgPath + '.png')) {
                return fs.readFileSync(imgPath + '.png');
            }


            if (fs.existsSync(imgPath + '.jpg')) {
                return fs.readFileSync(imgPath + '.jpg');
            }

            // Bez obrázku vrať 1×1 transparentní PNG (aby se generování nezastavilo)
            const emptyPng = Buffer.from(
                '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C63600000020001' +
                '0001055DF2A00000000049454E44AE426082', 'hex'
            );
            return emptyPng;
        },
        getSize: function (img, tagValue, tagName) {
            // Šířka × výška v px; Word si to přepočítá. Uprav dle potřeby (např. 1100×650).
            
            return [gImgParams[tagValue]?.params?.width||500, 
            gImgParams[tagValue]?.params?.height||400];

            
            if (tagName == 'img_product') return [189, 189]
            return [500, 400];
            return [600, 480];
            return [640, 512];
            return [900, 720];
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

async function main() {


    loadData();

    // 2) Připrav data
    let reportData = data;

    enhanceProducts(reportData.products);

    IMAGES_DIR = path.join(workingDir, 'img');
    // Předpokládáme, že v pracovním adresáři je podsložka img s podsložkami pro různé typy obrázků
    PRODUCT_IMG_DIR = path.join(workingDir, '../../common/img/products');

    let imgKeys = getSubfolders(IMAGES_DIR).map(e => 'img_' + e); // podsložky v workdir/img
    imgKeys.push('img_product'); // přidej i složku img_product pro hlavní obrázek produktu


    // Přidej do každého produktu pole `image`, které image modul pochopí (tady použijeme index produktu)

    reportData.products = reportData.products.map(p => ({ ...p, ...makeObjectFromKeys(imgKeys, p.id) }));




    // const templatePath = path.join(__dirname, 'template.docx');
    // const content = fs.readFileSync(templatePath, 'binary');

    //let zip = new PizZip(content);
    //fixTagsAndData(zip,reportData);
    
   
   

    // 3) Zpracuj konfigurace dokumentů
    let docConfigs = [];
    
    // Kontrola zda existuje report.doc v datech
    if (reportData.report && reportData.report.doc && Array.isArray(reportData.report.doc)) {
        docConfigs = reportData.report.doc;
        console.log(`Nalezeno ${docConfigs.length} konfigurací dokumentů v data.json`);
    } else {
        // Fallback na výchozí konfiguraci pro zpětnou kompatibilitu
        console.log('Konfigurace report.doc nenalezena, použiji výchozí template.docx');
        docConfigs = [{
            template: 'template.docx',
            renderTo: 'report.docx'
        }];
    }

    // 4) Zpracuj každý dokument
    for (const docConfig of docConfigs) {
        const templateName = docConfig.template;
        const outputName = docConfig.renderTo;
        
        console.log(`\nZpracovávám dokument: ${templateName} -> ${outputName}`);
        
        //try {
            // Načti šablonu
            const templatePath = path.join(__dirname, templateName);
            
            let virtualData = createDeepIntrospectingGetLoggerProxy(reportData);
            if (!fs.existsSync(templatePath)) {
                console.error(`Chyba: Šablona ${templateName} nebyla nalezena v ${__dirname}`);
                continue; // Pokračuj dalším dokumentem
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

            // Ulož dokument
            const buf = doc.getZip().generate({ type: 'nodebuffer' });
            const outPath = path.join(workingDir, outputName);
            fs.writeFileSync(outPath, buf);
            
            console.log(`✓ Dokument vytvořen: ${outPath}`);
          /*  
        } catch (error) {
            console.error(`✗ Chyba při zpracování dokumentu ${templateName}:`, error.message);
            // Pokračuj dalším dokumentem místo ukončení celého scriptu
        }*/
    }
    
    console.log(`\n=== Generování dokumentů dokončeno ===`);



    /*
    // 4) Renderuj s daty
    try {
        doc.render(virtualData);  //reportData
    } catch (error) {
        console.error('Chyba při renderu:', error);
        throw error;
    }

    // 5) Ulož
    const buf = doc.getZip().generate({ type: 'nodebuffer' });
    const outPath = path.join(workingDir, 'report.docx');
    fs.writeFileSync(outPath, buf);
    console.log(`Hotovo: ${outPath}`);

    */
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
    if (iso.includes('T')) return DateTime.fromISO(iso, { zone: usedZone }).setLocale(usedLocale).toFormat(usedFormat);
    return DateTime.fromSQL(iso, { zone: usedZone }).setLocale(usedLocale).toFormat(usedFormat);
}

function formatNumber(value, {
  locale = 'cs-CZ',
  minDecimals = 0,
  maxDecimals = 5,
  useGrouping = true
} = {}) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
    useGrouping
  }).format(value);
}

function customizeValue(value, params, pathArr) {
    // Upraví value dle params (např. formátování data)
    let ret = value;
    if (params.dateFormat) {  // ok jde o formátování datumu
        ret = formatTemplateDate(value, params);
    }

    if (params.numFormat) {  // ok jde o formátování datumu
        ret = formatNumber(value, params.numFormat);
    }
    // pokud je poslední část pathArr "img", tak jde o obrázek a  vrátíme pathArr
    if (pathArr[pathArr.length - 1]=='img') {
        gImgParams.push({params,pathArr});
        ret=gImgParams.length -1;
    }

    if (params.orderBy && Array.isArray(value)) {
        ret = [...value]; // clone
        // podporuje víceúrovňové řazení. params.orderby je string "key1,key2 desc,key3"
        const orderBys = params.orderBy.split(',').map(s => {
            const [key, dir] = s.trim().split(' ');
            return { key, desc: dir && dir.toLowerCase() === 'desc' };
        });

        ret.sort((a, b) => {
            for (const { key, desc } of orderBys) {
                if (a[key] < b[key]) return desc ? 1 : -1;
                if (a[key] > b[key]) return desc ? -1 : 1;
            }
            return 0;
        }); 
        
    }

    return ret;
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
        console.log(`[${labelGet}]`, pathToString(nextPath));

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