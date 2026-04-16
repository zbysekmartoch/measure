import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile, execFileSync } from 'child_process';
//import mysql from 'mysql2/promise';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import ImageModule from 'docxtemplater-image-module-free';
import { DateTime } from "luxon";
import {  imageSize  } from 'image-size';
import os from 'os';

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
let gData; // globální pro případ potřeby v customizeValue
let IMAGES_DIR;
// --- Načtení parametrů ---
// argv[2] = RESULT_ROOT, argv[3] = WORKFLOW_ROOT (ignorován), argv[4] = LAB_ROOT
// Pokud nejsou zadány, použije se složka skriptu (pro testování)
const RESULT_ROOT = process.argv[2] || __dirname;
const WORKFLOW_ROOT = process.argv[3] || __dirname;
const LAB_ROOT = process.argv[4] || __dirname;

///console.log(`RESULT_ROOT: ${RESULT_ROOT}`);
///console.log(`LAB_ROOT:    ${LAB_ROOT}`);

let gImgParams=[]; // globální pole parametrů obrázků


let formulaCache = new Map();

// Globální objekt pro data
//let data = {};

let failed=false; // indikátor, zda se něco nepodařilo vytvořit (pro exit code)

function loadData(dataFilePath) {
    let data= {};
    try {
        const dataContent = fs.readFileSync(dataFilePath, 'utf-8');
        data = JSON.parse(dataContent);
        console.log(`Data načtena: ${dataFilePath}`);
    } catch (error) {
        console.error(`Chyba při načítání ${dataFilePath}:`, error.message);
        //process.exit(1);
    }
    return data;
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


function getValueFromData(propName, tagValue) {
    /* pokud propName začíná tečkou tak obsahuje název property (i více oddělené tečkou) 
    např. ".foto" v objektu gData od místa které má adresu v gImgParams[tagValue].pathArr, 
    např. "osoba.2" takže se podíváme do gData.osoba[2].foto a použijeme jeho hodnotu jako filename.
    
    */

    const propPath = propName.slice(1).split('.'); // ["foto"]
    const basePath = gImgParams[tagValue]?.pathArr.slice(0,-1) || []; // ["osoba", "2"]
    const fullPath = basePath.concat(propPath); // ["osoba", "2", "foto"]
    let current = gData;
    for (const p of fullPath) {
        if (current == null) break;
        current = current[p];
    }
    if (typeof current === 'string') {
        return current;
    } else {
        console.warn(`neplatná cesta ${fullPath.join('.')} ale našel jsem:`, current);
        return null;
    }
}

// --- Image module config pro Docxtemplater ---
function buildImageModule() {
    // Mapuj index → buffer obrázku (vyřešíme dopředu, ať v getImage jen sáhne do cache)

    return new ImageModule({
        centered: false,
        getImage: function (tagValue, tagName) {
            // tagValue očekáváme jako index produktu (číslo) nebo přímo buffer/filepath
            let filename = gImgParams[tagValue]?.params?.filename;
            if (filename && filename.startsWith('.')) {
                filename=getValueFromData(filename, tagValue);
            }

            let imgPath = path.join(`${RESULT_ROOT}/${filename}`);
            let buffer;
            let params=gImgParams[tagValue]?.params||{}
            if (filename && fs.existsSync(imgPath)) {
                buffer = fs.readFileSync(imgPath);
                if (filename.endsWith(".mexpr") || filename.endsWith(".expr")) {
                    buffer = latexToSvgCached(buffer.toString());
                }
            }
            if (!filename && params.expr) {
                let expr=params.expr;
                if (expr.startsWith('.')) {
                    expr=getValueFromData(expr, tagValue);
                }

                // Pokud máme LaTeX výraz, převedeme ho na SVG
                expr=expr.replaceAll('–','-'); // nahradíme dlouhé pomlčky, které tam word často cpe
                buffer = latexToSvgCached(expr);
                
            }
            if (buffer) {
                const dimensions = imageSize(buffer);
                // pokud není nastaven params.width ani params.height, použij skutečné rozměry obrázku
                if (!params.width && !params.height) {  
                    params.width = dimensions.width;
                    params.height = dimensions.height;
                }
                // pokud je nastaven jen jeden z rozměrů, dopočítej druhý pro zachování poměru
                if (params.width && !params.height) {
                    params.height = Math.round(dimensions.height * (params.width / dimensions.width));
                } else if (!params.width && params.height) {
                    params.width = Math.round(dimensions.width * (params.height / dimensions.height));
                }
                gImgParams[tagValue].params=params;
                
                return buffer;
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
            renderTo: 'report.docx'
        }];
    }

    // 3) Zpracuj každý dokument
    for (const docConfig of docConfigs) {
        const templateRelPath = docConfig.template;
        const outputRelPath = docConfig.renderTo;
        const dataRelPath = docConfig.data ;
        gImgParams = []; // reset pro každý dokument
        gImgParams.push({params:{},pathArr:[]}); // rezervuj index 0 pro případ, že by nějaký tag měl přímo buffer/cestu
        
        // Cesty: template relativní k LAB_ROOT a output relativní k RESULT_ROOT
        // data pokud není, tak data nepotřebuje, pokud je v docConfig nastaven atribut dataInResult tak hledáme data relativně k RESULT_ROOT, jinak relativně k LAB_ROOT   

        const templatePath = path.resolve(LAB_ROOT, templateRelPath);
        const dataPath = dataRelPath ? path.resolve(docConfig.dataInResult ? RESULT_ROOT : LAB_ROOT, dataRelPath) : null;  
        const outPath = path.resolve(RESULT_ROOT, outputRelPath);

        console.log(`\nZpracovávám dokument:`);
        console.log(`  šablona: ${templatePath}`);
        console.log(`  data:    ${dataPath}`);
        console.log(`  výstup:  ${outPath}`);
        
        try {
            // Načti data pro tento dokument
            let reportData = {}; 
            if (dataRelPath) { // pokud je zadáno, načti data, jinak nech reportData prázdný (ne všechny dokumenty musí mít data)
                reportData=loadData(dataPath);
            }
/*
            // Obrázky – podsložky v RESULT_ROOT/img
            if (fs.existsSync(IMAGES_DIR)) {
                let imgKeys = getSubfolders(IMAGES_DIR).map(e => 'img_' + e);
                imgKeys.push('img_product');
                if (reportData.products) {
                    reportData.products = reportData.products.map(p => ({ ...p, ...makeObjectFromKeys(imgKeys, p.id) }));
                }
            }*/
            gData=reportData; // globální pro případ potřeby v customizeValue
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
            console.log(error?.properties?.errors.map(e=>e?.properties?.explanation));
            console.error(error?.properties?.errors.map(e=>e?.properties?.explanation));
            
            failed=true
        }
    }
    
    console.log(`\n=== Generování dokumentů dokončeno ===`);
    if (failed) {
        console.log(`Některé dokumenty se nepodařilo vytvořit. Zkontrolujte chybový výstup.`);
        process.exit(1);
    }
}



main().catch(err => {
    console.error(err);
    process.exit(1);
});




function normalizeQuotes(str) {
  return str.replace(/[“”„‟«»‹›]/g, '"');
}

/*
function normalizeProp(prop) {
// Rozdělí prop na název a případné parametry ve formátu JSON objektu
//   Vrací [propName, paramsObject|null]
    
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
*/

function formatTemplateDate(iso, { dateFormat, locale, zone } = {}) {
    const usedFormat = dateFormat ?? DEFAULT_PATTERN;
    const usedLocale = locale ?? DEFAULT_LOCALE;
    const usedZone = zone ?? DEFAULT_ZONE;
    
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
    let ret;
    if (params.dateFormat) {  // ok jde o formátování datumu
        ret = formatTemplateDate(value, params);
    }

    if (params.numFormat) {  // ok jde o formátování datumu
        ret = formatNumber(value, params.numFormat);
    }

    if (params.orderBy && Array.isArray(value)) {
        //ret = [...value]; // clone
        ret=value;
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
    // pokud je poslední část pathArr "img", tak jde o obrázek a  vrátíme pathArr
    if (pathArr[pathArr.length - 1]=='img') {
        gImgParams.push({params,pathArr});
        ret=gImgParams.length -1;
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
        let latexSplit = splitLatexExpression(prop);
        if (latexSplit) {  // je to LaTeX math výraz. pro účely parsování parametrů ho dočasně nahradíme placeholderem
            // uděláme z toho img tag a do parametru expr dáme původní LaTeX, ať to projde do customizeValue, kde poznáme že jde o obrázek s LaTeXem a v getImageModule to zase poznáme a převedeme na SVG
            [prop, params] = normalizeProp(`img ${latexSplit[1]}`);
            if (!params) params={};
            params.expr=latexSplit[0];
            
        } else {
            [prop, params] = normalizeProp(prop);
        }

        if (typeof prop === "string" && prop.includes(".")) {
            const lastDot = prop.lastIndexOf(".");
            const parentPath = prop.slice(0, lastDot);
            const lastProp = prop.slice(lastDot + 1);

            const parentValue = Reflect.get(receiver, parentPath);

            if (parentValue == null) return undefined;

            return Reflect.get(parentValue, lastProp);
        }


        const nextPath = pathArr.concat([prop]);
   //     console.log(`[${labelGet}]`, pathToString(nextPath));

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
        //console.log(`[${labelHas}]`, pathToString(nextPath));
        return Reflect.has(t, prop);
      },

      ownKeys(t) {
        // `for...in`, `Object.keys`, `Object.getOwnPropertyNames`, …
        //console.log(`[${labelKeys}]`, pathToString(pathArr) || "<root>");
        return Reflect.ownKeys(t);
      },

      getOwnPropertyDescriptor(t, prop) {
        // `hasOwnProperty`, `Object.getOwnPropertyDescriptor(s)`, …
        const nextPath = pathArr.concat([prop]);
        ///console.log(`[${labelDesc}]`, pathToString(nextPath));
        return Reflect.getOwnPropertyDescriptor(t, prop);
      },
    });

    map.set(pathKey, proxy);
    return proxy;
  };

  return getProxy(rootObj, []);
}

/// ************************ params parser *******************

function splitLatexExpression(input) {
    // Rozdělí string na dvě části: 1) LaTeX výraz v $...$ a 2) zbytek textu
    if (typeof input !== "string") return null;

    const m = input.match(/^\s*(\$(?:\\.|[^$\\])*\$)\s*(.*)$/);
    if (!m) return null;

    return [m[1], m[2]];
}

function normalizeProp(prop) {
    /* Rozdělí prop na název a případné parametry

       Podporované zápisy:
       1) product.from {"dateFormat":"D.M.YYYY","color":"red"}
       2) product.from dateFormat="D.M.YYYY" color=red
       3) prop param1=ahoj param2 = 12, param3="delší text" param4= něco ; param5 ="1,2"

       Vrací [propName, paramsObject|null]
    */
    console.log(`normalizeProp: ${prop}`);
    if (typeof prop !== "string") {
        return [prop, null];
    }

    prop = prop.trim();

    if (!prop) {
        return ["", null];
    }

    const jsonResult = tryParseJsonSyntax(prop);
    if (jsonResult) {
        return jsonResult;
    }

    return parseSimpleSyntax(prop);
}

function tryParseJsonSyntax(prop) {
    const jsonStart = prop.indexOf("{");
    if (jsonStart === -1) {
        return null;
    }

    const propName = prop.slice(0, jsonStart).trim();
    let paramStr = prop.slice(jsonStart);

    paramStr = normalizeQuotes(paramStr);

    try {
        const params = JSON.parse(paramStr);
        return [propName, params];
    } catch (e) {
        console.warn("Chyba při parsování JSON parametrů:", paramStr);
        return [propName, null];
    }
}

function parseSimpleSyntax(prop) {
    const firstParamIndex = findFirstParamIndex(prop);

    if (firstParamIndex === -1) {
        return [prop.trim(), null];
    }

    const propName = prop.slice(0, firstParamIndex).trim();
    let paramPart = prop.slice(firstParamIndex).trim();

    paramPart = normalizeQuotes(paramPart);

    const protectedText = protectQuotedParts(paramPart);
    const normalized = normalizeSeparators(protectedText);
    const rawTokens = splitTokens(normalized);
    const joinedTokens = joinBrokenKeyValueTokens(rawTokens);
    const params = parseKeyValueTokens(joinedTokens);

    return [propName, Object.keys(params).length ? params : null];
}

function findFirstParamIndex(text) {
    const match = text.match(/\s+[A-Za-z0-9_]+\s*=/);
    return match ? match.index : -1;
}


function protectQuotedParts(text) {
    return text.replace(/"([^"\\]*(\\.[^"\\]*)*)"|'([^'\\]*(\\.[^'\\]*)*)'/g, (full) => {
        const inner = full.slice(1, -1);

        return inner
            .replaceAll(" ", "__SPACE__")
            .replaceAll(",", "__COMMA__")
            .replaceAll(";", "__SEMICOLON__")
            .replaceAll('"', "");
    });
}
function normalizeSeparators(text) {
    return text
        .replace(/[;,]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function splitTokens(text) {
    if (!text) {
        return [];
    }
    return text.split(" ").map(t => t.trim()).filter(Boolean);
}

function joinBrokenKeyValueTokens(tokens) {
    const result = [];
    let i = 0;

    while (i < tokens.length) {
        let token = tokens[i];

        if (token.includes("=")) {
            const parts = token.split("=");

            if (parts.length === 2 && parts[1] === "" && i + 1 < tokens.length) {
                token = token + tokens[i + 1];
                i += 2;
                result.push(token);
                continue;
            }
        } else if (
            i + 1 < tokens.length &&
            tokens[i + 1] === "=" &&
            i + 2 < tokens.length
        ) {
            token = tokens[i] + "=" + tokens[i + 2];
            i += 3;
            result.push(token);
            continue;
        }

        result.push(token);
        i++;
    }

    return result;
}

function parseKeyValueTokens(tokens) {
    const params = {};

    for (const t of tokens) {
        const i = t.indexOf("=");
        if (i === -1) continue;

        const key = t.slice(0, i).trim();
        let value = t.slice(i + 1).trim();

        value = restoreValue(value);

        if (key) {
            params[key] = value;
        }
    }

    return params;
}

function restoreValue(value) {
    return value
        .replaceAll("__SPACE__", " ")
        .replaceAll("__COMMA__", ",")
        .replaceAll("__SEMICOLON__", ";");
}

/// *************************** LaTeX → SVG (pro vzorce v dokumentu)


function latexToSvgCached(formula) {
  if (formulaCache.has(formula)) {
    return formulaCache.get(formula);
  }

  const buffer = latexToImg(formula,'png'); // pro větší kompatibilitu s Wordem použijeme PNG místo SVG
  formulaCache.set(formula, buffer);
  return buffer;
}


/**
 * Převede LaTeX výraz na SVG a vrátí ho jako Buffer.
 *
 * Požadavky v systému:
 *   sudo apt install texlive-latex-base texlive-latex-extra dvisvgm
 *
 * @param {string} formula
 *   Např. '$\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$'
 *   nebo '\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'
 *
 * @returns {Buffer}
 */
function latexToImg(formula,type='svg') {
  if (typeof formula !== "string" || !formula.trim()) {
    throw new Error("formula musí být neprázdný string");
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "latex-svg-"));

  try {
    const normalizedFormula = normalizeFormula(formula);

    const texContent = [
      "\\documentclass[preview]{standalone}",
      "\\usepackage[utf8]{inputenc}",
      "\\usepackage[T1]{fontenc}",
      "\\usepackage{amsmath,amssymb}",
      "\\begin{document}",
      normalizedFormula,
      "\\end{document}",
      ""
    ].join("\n");

    const texPath = path.join(workDir, "input.tex");
    const dviPath = path.join(workDir, "input.dvi");
    const imgPath = path.join(workDir, "output." + type);
    const logPath = path.join(workDir, "input.log");

    fs.writeFileSync(texPath, texContent, "utf8");

    execFileSync(
      "latex",
      ["-interaction=nonstopmode", "-halt-on-error", "input.tex"],
      {
        cwd: workDir,
        timeout: 15000,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    if (type === 'svg') { 
        execFileSync(
            "dvisvgm",
            ["--no-fonts", "--exact", dviPath, "-o", imgPath],
            {
                cwd: workDir,
                timeout: 15000,
                stdio: ["ignore", "pipe", "pipe"]
            }
        );
    } else if (type === 'png') {
        execFileSync(
            "dvipng",
            ["-T", "tight", "-D", "1200", "-o", imgPath, dviPath],  //TODO dát D do konfigu, nebo ho dynamicky přizpůsobit velikosti vzorce
            {
              cwd: workDir,
              timeout: 15000,
              stdio: ["ignore", "pipe", "pipe"]
            }
          );
    }
    return fs.readFileSync(imgPath);
  } catch (err) {
    let details = "";

    try {
      details = fs.readFileSync(logPath, "utf8");
    } catch {
      // ignorovat
    }

    const stderr = err && err.stderr ? err.stderr.toString("utf8") : "";
    const stdout = err && err.stdout ? err.stdout.toString("utf8") : "";

    throw new Error(
      [
        `Nepodařilo se převést LaTeX na ${type.toUpperCase()}.`,
        stderr ? `STDERR:\n${stderr}` : "",
        stdout ? `STDOUT:\n${stdout}` : "",
        details ? `LOG:\n${details}` : ""
      ]
        .filter(Boolean)
        .join("\n\n")
    );
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      // ignorovat
    }
  }
}

function normalizeFormula(formula) {
  const trimmed = formula.trim();

  if (
    trimmed.startsWith("$") ||
    trimmed.startsWith("\\(") ||
    trimmed.startsWith("\\[") ||
    trimmed.startsWith("\\begin{")
  ) {
    return trimmed;
  }

  return `$${trimmed}$`;
}
