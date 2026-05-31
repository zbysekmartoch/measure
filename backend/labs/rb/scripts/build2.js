import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile, execFileSync } from 'child_process';
//import mysql from 'mysql2/promise';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
//import ImageModule from 'docxtemplater-image-module-free';
//import ImageModule from '@slosarek/docxtemplater-image-module-free';
import ImageModule from 'measure-docxtemplater-image-module';
import { DateTime } from "luxon";
import {  imageSize  } from 'image-size';
import os from 'os';

const DEFAULT_LOCALE = "cs";
const DEFAULT_ZONE = "Europe/Prague";
const DEFAULT_PATTERN = "dd. MM. yyyy";

const DEFAULT_REPORT_FORMAT = Object.freeze({
    number: {
        mode: "number",
        minDecimals: 0,
        maxDecimals: 2,
        decimalSeparator: ",",
        thousandSeparator: " ",
        useGrouping: true,
        prefix: "",
        suffix: "",
        nullText: "",
        nanText: "",
        infinityText: ""
    }
});

const SUPPORTED_NUMBER_MODES = new Set(["number", "percent", "currency", "scientific", "star"]);

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
// argv[2] = RESULT_ROOT, argv[3] = RUNTIME_ENV_PATH, argv[4] = LAB_ROOT
// Pokud nejsou zadány, použije se složka skriptu (pro testování)
const RESULT_ROOT = process.argv[2] || __dirname;
const runtimeEnvArgProvided = Boolean(process.argv[3]);
const RUNTIME_ENV_PATH = process.argv[3] || path.join(RESULT_ROOT, 'runtime.env');
const LAB_ROOT = process.argv[4] || __dirname;
const LABS_ROOT = path.resolve(LAB_ROOT, '..', '..');
const LAB_ALIASES_PATH = path.join(LABS_ROOT, 'aliases.json');

///console.log(`RESULT_ROOT: ${RESULT_ROOT}`);
///console.log(`LAB_ROOT:    ${LAB_ROOT}`);

let gImgParams=[]; // globální pole parametrů obrázků
let gLabAliasesCache = null;


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
    const candidatePaths = runtimeEnvArgProvided
        ? [RUNTIME_ENV_PATH]
        : [RUNTIME_ENV_PATH, path.join(RESULT_ROOT, 'environment.json')];

    for (const envPath of candidatePaths) {
        try {
            const content = fs.readFileSync(envPath, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            // Pokud soubor neexistuje, zkus další fallback cestu.
            if (error.code === 'ENOENT') {
                continue;
            }
            console.error(`Chyba při načítání runtime env souboru ${envPath}: ${error.message}`);
            process.exit(1);
        }
    }

    console.error(`Chyba při načítání runtime env: soubor nebyl nalezen. Zkoušel jsem: ${candidatePaths.join(', ')}`);
    process.exit(1);
}

function loadLabAliases() {
    if (gLabAliasesCache !== null) {
        return gLabAliasesCache;
    }

    if (!fs.existsSync(LAB_ALIASES_PATH)) {
        gLabAliasesCache = {};
        return gLabAliasesCache;
    }

    try {
        const content = fs.readFileSync(LAB_ALIASES_PATH, 'utf-8');
        const parsed = JSON.parse(content);
        if (!isPlainObject(parsed)) {
            throw new Error('soubor aliases.json musí obsahovat JSON objekt aliasů');
        }
        gLabAliasesCache = parsed;
        return gLabAliasesCache;
    } catch (error) {
        throw new Error(`Chyba při načítání aliases.json (${LAB_ALIASES_PATH}): ${error.message}`);
    }
}

function getAliasTarget(aliases, aliasName) {
    if (Object.prototype.hasOwnProperty.call(aliases, aliasName)) {
        return aliases[aliasName];
    }

    const upper = aliasName.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(aliases, upper)) {
        return aliases[upper];
    }

    return undefined;
}

function resolveAliasPathIfPresent(fileName) {
    if (typeof fileName !== 'string') {
        return null;
    }

    const normalizedFileName = fileName.trim();
    const aliasMatch = normalizedFileName.match(/^<([^<>]+)>(?:[\\/](.*))?$/);
    if (!aliasMatch) {
        return null;
    }

    const aliasName = aliasMatch[1].trim();
    if (!aliasName) {
        throw new Error(`Neplatná alias cesta "${fileName}": alias je prázdný.`);
    }

    const aliases = loadLabAliases();
    const aliasTarget = getAliasTarget(aliases, aliasName);
    if (aliasTarget === undefined || aliasTarget === null || String(aliasTarget).trim() === '') {
        throw new Error(`Neznámý alias laboratoře "${aliasName}" v cestě "${fileName}".`);
    }

    const aliasScriptsRoot = path.resolve(LABS_ROOT, String(aliasTarget), 'scripts');
    const relativeTail = (aliasMatch[2] ?? '').replace(/\\/g, '/');
    return relativeTail ? path.resolve(aliasScriptsRoot, relativeTail) : aliasScriptsRoot;
}

function resolveReportPath(fileName, defaultRoot, valueLabel = 'path') {
    if (typeof fileName !== 'string' || !fileName.trim()) {
        throw new Error(`Neplatná hodnota ${valueLabel}: očekávám neprázdný string.`);
    }

    const normalizedFileName = fileName.trim();
    if (path.isAbsolute(normalizedFileName)) {
        return normalizedFileName;
    }

    const aliasResolved = resolveAliasPathIfPresent(normalizedFileName);
    if (aliasResolved) {
        return aliasResolved;
    }

    return path.resolve(defaultRoot, normalizedFileName);
}

function resolveDocConfigPath(fileName, { preferResultRoot = false } = {}) {
    if (typeof fileName !== 'string' || !fileName.trim()) {
        throw new Error('Nazev konfiguracniho souboru musi byt neprázdný string.');
    }

    const normalizedFileName = fileName.trim();

    if (path.isAbsolute(normalizedFileName)) {
        return normalizedFileName;
    }

    const aliasResolved = resolveAliasPathIfPresent(normalizedFileName);
    if (aliasResolved) {
        return aliasResolved;
    }

    const primaryRoot = preferResultRoot ? RESULT_ROOT : LAB_ROOT;
    const secondaryRoot = preferResultRoot ? LAB_ROOT : RESULT_ROOT;
    const primaryPath = path.resolve(primaryRoot, normalizedFileName);
    if (fs.existsSync(primaryPath)) {
        return primaryPath;
    }

    const secondaryPath = path.resolve(secondaryRoot, normalizedFileName);
    if (fs.existsSync(secondaryPath)) {
        return secondaryPath;
    }

    return primaryPath;
}

function loadDocFormatSettings(docConfig = {}) {
    const formatFile = docConfig?.format;
    if (formatFile === undefined || formatFile === null || formatFile === '') {
        return { formatSettings: {}, formatPath: null, formatConfigError: null };
    }

    let formatPath;
    try {
        formatPath = resolveDocConfigPath(formatFile, {
            preferResultRoot: Boolean(docConfig?.formatInResult)
        });
    } catch (error) {
        return {
            formatSettings: {},
            formatPath: null,
            formatConfigError: `Neplatna hodnota report.doc.format: ${error.message}`
        };
    }

    if (!fs.existsSync(formatPath)) {
        return {
            formatSettings: {},
            formatPath,
            formatConfigError: `Format settings soubor nebyl nalezen: ${formatPath}`
        };
    }

    let parsed;
    try {
        const content = fs.readFileSync(formatPath, 'utf-8');
        parsed = JSON.parse(content);
    } catch (error) {
        return {
            formatSettings: {},
            formatPath,
            formatConfigError: `Chyba pri nacitani format settings (${formatPath}): ${error.message}`
        };
    }

    if (!isPlainObject(parsed)) {
        return {
            formatSettings: {},
            formatPath,
            formatConfigError: `Format settings v ${formatPath} musi byt JSON objekt.`
        };
    }

    if (parsed.formatStyles !== undefined && !isPlainObject(parsed.formatStyles)) {
        return {
            formatSettings: {},
            formatPath,
            formatConfigError: `Format settings v ${formatPath}: formatStyles musi byt objekt.`
        };
    }

    if (parsed.format !== undefined && !Array.isArray(parsed.format)) {
        return {
            formatSettings: {},
            formatPath,
            formatConfigError: `Format settings v ${formatPath}: format musi byt pole pravidel.`
        };
    }

    return { formatSettings: parsed, formatPath, formatConfigError: null };
}

function normalizeDocGlobals(docConfig = {}) {
    const rawGlobals = docConfig?.globals;
    if (rawGlobals === undefined || rawGlobals === null) {
        return {};
    }

    if (!isPlainObject(rawGlobals)) {
        console.error('report.doc.globals musi byt objekt. Budu ignorovat globals pro tento dokument.');
        return {};
    }

    return deepClone(rawGlobals);
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
            let imgPath;
            // pokud filename začíná řetězcem "LAB_ROOT" nebo "/" tak je relativní v LAB_ROOT, poku ne nebo začíná "RESULT_ROOT" tak je relativní v RESULT_ROOT
            if (filename && (filename.startsWith("LAB_ROOT/") || filename.startsWith("/"))) {    
                   //odstraní případný prefix "LAB_ROOT/" nebo "/" a zbytek spojí s LAB_ROOT
                   imgPath = path.join(LAB_ROOT, filename.replace(/^LAB_ROOT[\\/]/, '').replace(/^[\\/]/, ''));
                } else if (filename) {  
                    // jinak je relativní k RESULT_ROOT. odstraní případný prefix "RESULT_ROOT/" a zbytek spojí s RESULT_ROOT
                    imgPath = path.join(RESULT_ROOT, filename.replace(/^RESULT_ROOT[\\/]/, ''));
            }
            let buffer;
            let params=gImgParams[tagValue]?.params||{}
            let settingsType="img";
            if (filename && fs.existsSync(imgPath)) {
                buffer = fs.readFileSync(imgPath);
                if (filename.endsWith(".mexpr") || filename.endsWith(".expr")) {
                    buffer = latexToSvgCached(buffer.toString());
                    settingsType="mexpr";
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
                settingsType="mexpr";
            }
            if (buffer) {
                const dimensions = imageSize(buffer);
                // nejdřív zkusíme, zda je nastaven parametr "scale"
                if (params.scale) {
                    params.width = Math.round(dimensions.width * params.scale);
                    params.height = Math.round(dimensions.height * params.scale);
                }
                // pokud není nastaven params.width ani params.height, použij skutečné rozměry obrázku
                if (!params.width && !params.height) {  // není nastaveno přímo v parametrech tagu, zkusíme globální defaulty pro daný typ (img/mexpr), a pokud tam taky nejsou, tak použijeme skutečné rozměry
                    // zkusíme default scale pro daný typ
                    if (gDocDefualts[settingsType]?.scale) {
                        params.width = Math.round(dimensions.width * gDocDefualts[settingsType].scale);
                        params.height = Math.round(dimensions.height * gDocDefualts[settingsType].scale);
                    } else
                    if (!gDocDefualts[settingsType]?.width && !gDocDefualts[settingsType]?.height) { //neni ani v   globálních defaultech, tak použij skutečné rozměry 
                        params.width = dimensions.width;
                        params.height = dimensions.height;
                    } else {  // je v globálních defaultech, tak použij ty, a pokud tam není některá z dimenzí, tak ji dopočítej pro zachování poměru
                        params.width = gDocDefualts[settingsType]?.width;
                        params.height = gDocDefualts[settingsType]?.height;
                     }
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
var environment={};
var gDocDefualts={}; // globální pro případ potřeby v customizeValue
async function main() {

    // 1) Načti konfiguraci z runtime env JSON souboru
    environment = loadEnvironment();

    IMAGES_DIR = path.join(RESULT_ROOT, 'img');

    // 2) Zjisti konfigurace dokumentů
    let docConfigs = [];
    
    if (environment.report && environment.report.doc && Array.isArray(environment.report.doc)) {
        docConfigs = environment.report.doc;
        console.log(`Nalezeno ${docConfigs.length} konfigurací dokumentů v runtime env souboru`);
    } else {
        // Fallback na výchozí konfiguraci pro zpětnou kompatibilitu
        console.log('Konfigurace report.doc nenalezena v runtime env souboru, použiji výchozí template.docx');
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
        
        gDocDefualts=docConfig.defaults||{}; // globální pro případ potřeby v customizeValue
        
        try {
            // Cesty: podporují i alias syntaxi <ALIAS>/a/b/c, která míří na LAB_ROOT/../../<alias>/scripts/a/b/c
            const templatePath = resolveReportPath(templateRelPath, LAB_ROOT, 'template');
            const dataPath = dataRelPath
                ? resolveReportPath(dataRelPath, docConfig.dataInResult ? RESULT_ROOT : LAB_ROOT, 'data')
                : null;
            const outPath = resolveReportPath(outputRelPath, RESULT_ROOT, 'renderTo');

            const {
                formatSettings,
                formatPath,
                formatConfigError
            } = loadDocFormatSettings(docConfig);
            const ignoreFormatErrors = Boolean(docConfig?.ignoreFormatErrors);
            const docGlobals = normalizeDocGlobals(docConfig);

            // přidáme do docGlobals proměnnou s aktuálním datem a časem pro případ, že by ji někdo chtěl použít v šabloně
            docGlobals.renderedAt = (new Date()).toISOString();

            console.log(`\nZpracovavam dokument:`);
            console.log(`  sablona: ${templatePath}`);
            console.log(`  data:    ${dataPath}`);
            console.log(`  vystup:  ${outPath}`);
            console.log(`  format:  ${formatPath ?? '(nenastaveno)'}`);
            console.log(`  ignoreFormatErrors: ${ignoreFormatErrors}`);
            console.log(`  globals: ${Object.keys(docGlobals).length}`);

            // Načti data pro tento dokument
            let reportData = {}; 
            if (dataRelPath) { // pokud je zadáno, načti data, jinak nech reportData prázdný (ne všechny dokumenty musí mít data)
                reportData=loadData(dataPath);
            }

            gData=reportData; // globální pro případ potřeby v customizeValue
            let virtualData = createDeepIntrospectingGetLoggerProxy(reportData, {
                globals: docGlobals,
                formatSettings,
                ignoreFormatErrors,
                formatConfigError,
                formatErrorContext: `template=${templateRelPath}, renderTo=${outputRelPath}`
            });

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



function formatTemplateDate(iso, { dateFormat, locale, zone } = {}) {
    const usedFormat = dateFormat ?? DEFAULT_PATTERN;
    const usedLocale = locale ?? DEFAULT_LOCALE;
    const usedZone = zone ?? DEFAULT_ZONE;
    
    return DateTime.fromSQL(iso, { zone: usedZone }).setLocale(usedLocale).toFormat(usedFormat);
}

function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
}

function deepClone(value) {
    if (Array.isArray(value)) {
        return value.map(item => deepClone(item));
    }
    if (isPlainObject(value)) {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = deepClone(v);
        }
        return out;
    }
    return value;
}

function deepMergeReplaceArrays(target, source) {
    const base = isPlainObject(target) ? deepClone(target) : {};
    if (!isPlainObject(source)) {
        return source === undefined ? base : deepClone(source);
    }

    for (const [key, value] of Object.entries(source)) {
        if (Array.isArray(value)) {
            base[key] = deepClone(value);
            continue;
        }

        if (isPlainObject(value) && isPlainObject(base[key])) {
            base[key] = deepMergeReplaceArrays(base[key], value);
            continue;
        }

        if (isPlainObject(value)) {
            base[key] = deepMergeReplaceArrays({}, value);
            continue;
        }

        base[key] = value;
    }

    return base;
}

function normalizePathSegments(pathArr) {
    if (Array.isArray(pathArr)) {
        return pathArr.map(seg => typeof seg === 'symbol' ? seg.toString() : String(seg));
    }

    if (typeof pathArr === 'string') {
        if (!pathArr.trim()) {
            return [];
        }
        return pathArr.split('.').filter(Boolean);
    }

    throw new Error('Path musí být pole segmentů nebo string.');
}

function buildLocalFormatOverridesFromParams(params) {
    if (!isPlainObject(params)) {
        return null;
    }

    let hasOverrides = false;
    let overrides = {};

    if (isPlainObject(params.format)) {
        overrides = deepMergeReplaceArrays(overrides, params.format);
        hasOverrides = true;
    }

    const directUseStyles = normalizeUseStyles(params.use);
    if (directUseStyles.length > 0) {
        const existingUseStyles = normalizeUseStyles(overrides.use);
        const mergedUseStyles = [...new Set([...existingUseStyles, ...directUseStyles])];
        overrides = deepMergeReplaceArrays(overrides, { use: mergedUseStyles });
        hasOverrides = true;
    }

    if (isPlainObject(params.date)) {
        overrides = deepMergeReplaceArrays(overrides, { date: params.date });
        hasOverrides = true;
    }

    if (isPlainObject(params.number)) {
        overrides = deepMergeReplaceArrays(overrides, { number: params.number });
        hasOverrides = true;
    }

    return hasOverrides ? overrides : null;
}

function parsePathPattern(pattern) {
    if (typeof pattern !== 'string' || !pattern.trim()) {
        throw new Error('Neplatný path pattern: pattern musí být neprázdný string.');
    }

    const segments = pattern.split('.');
    for (const segment of segments) {
        if (!segment) {
            throw new Error(`Neplatný path pattern: ${pattern}`);
        }

        if (segment === '*' || segment === '**') {
            continue;
        }

        if (segment.includes('*')) {
            throw new Error(`Neplatný path pattern: ${pattern}`);
        }
    }

    return segments;
}

function matchesPathSegments(patternSegments, pathSegments, patternIndex = 0, pathIndex = 0) {
    while (patternIndex < patternSegments.length && pathIndex < pathSegments.length) {
        const patternSegment = patternSegments[patternIndex];

        if (patternSegment === '**') {
            if (patternIndex === patternSegments.length - 1) {
                return true;
            }

            for (let skip = pathIndex; skip <= pathSegments.length; skip += 1) {
                if (matchesPathSegments(patternSegments, pathSegments, patternIndex + 1, skip)) {
                    return true;
                }
            }

            return false;
        }

        if (patternSegment !== '*' && patternSegment !== pathSegments[pathIndex]) {
            return false;
        }

        patternIndex += 1;
        pathIndex += 1;
    }

    while (patternIndex < patternSegments.length && patternSegments[patternIndex] === '**') {
        patternIndex += 1;
    }

    return patternIndex === patternSegments.length && pathIndex === pathSegments.length;
}

function matchesPathPattern(pattern, pathArr) {
    const patternSegments = parsePathPattern(pattern);
    const pathSegments = normalizePathSegments(pathArr);
    return matchesPathSegments(patternSegments, pathSegments);
}

function removeControlProperties(rule, controlProperties = ['path', 'use']) {
    const out = {};

    for (const [key, value] of Object.entries(rule)) {
        if (controlProperties.includes(key)) {
            continue;
        }
        out[key] = value;
    }

    return out;
}

function normalizeUseStyles(useValue) {
    if (useValue === undefined || useValue === null) {
        return [];
    }

    if (typeof useValue === 'string') {
        return [useValue];
    }

    if (Array.isArray(useValue)) {
        for (const styleName of useValue) {
            if (typeof styleName !== 'string' || !styleName.trim()) {
                throw new Error('"use" musí být string nebo pole stringů.');
            }
        }
        return useValue;
    }

    throw new Error('"use" musí být string nebo pole stringů.');
}

function validateNumberFormat(numberFormat, context = 'number format') {
    if (numberFormat === undefined || numberFormat === null) {
        return;
    }

    if (!isPlainObject(numberFormat)) {
        throw new Error(`${context}: number musí být objekt.`);
    }

    if (numberFormat.mode !== undefined && !SUPPORTED_NUMBER_MODES.has(numberFormat.mode)) {
        throw new Error(`${context}: neznámý mode "${numberFormat.mode}".`);
    }

    const { minDecimals, maxDecimals } = numberFormat;
    if (minDecimals !== undefined && (!Number.isInteger(minDecimals) || minDecimals < 0)) {
        throw new Error(`${context}: minDecimals musí být celé číslo >= 0.`);
    }

    if (maxDecimals !== undefined && (!Number.isInteger(maxDecimals) || maxDecimals < 0)) {
        throw new Error(`${context}: maxDecimals musí být celé číslo >= 0.`);
    }

    if (minDecimals !== undefined && maxDecimals !== undefined && minDecimals > maxDecimals) {
        throw new Error(`${context}: musí platit 0 <= minDecimals <= maxDecimals.`);
    }
}

function validateFormatRule(rule, index) {
    if (!isPlainObject(rule)) {
        throw new Error(`Neplatné format pravidlo na indexu ${index}: pravidlo musí být objekt.`);
    }

    if (!Object.prototype.hasOwnProperty.call(rule, 'path')) {
        throw new Error(`Neplatné format pravidlo na indexu ${index}: chybí path.`);
    }

    parsePathPattern(rule.path);
    normalizeUseStyles(rule.use);
    validateNumberFormat(rule.number, `Pravidlo ${index}`);
}

function getDefaultFormat() {
    return deepMergeReplaceArrays({}, DEFAULT_REPORT_FORMAT);
}

function getFormatForPath(pathArr, formatSettings = {}, localOverrides = null) {
    const rules = formatSettings?.format;
    if (rules !== undefined && !Array.isArray(rules)) {
        throw new Error('formatSettings.format musí být pole pravidel.');
    }

    const styles = formatSettings?.formatStyles ?? {};
    let result = getDefaultFormat();

    for (const [index, rule] of (rules ?? []).entries()) {
        validateFormatRule(rule, index);

        if (!matchesPathPattern(rule.path, pathArr)) {
            continue;
        }

        let ruleFormat = {};

        for (const styleName of normalizeUseStyles(rule.use)) {
            const style = styles?.[styleName];
            if (!style) {
                throw new Error(`Unknown format style: ${styleName}`);
            }
            ruleFormat = deepMergeReplaceArrays(ruleFormat, style);
        }

        const inlineRuleFormat = removeControlProperties(rule, ['path', 'use']);
        ruleFormat = deepMergeReplaceArrays(ruleFormat, inlineRuleFormat);
        result = deepMergeReplaceArrays(result, ruleFormat);
    }

    if (localOverrides && isPlainObject(localOverrides)) {
        let localFormat = {};

        for (const styleName of normalizeUseStyles(localOverrides.use)) {
            const style = styles?.[styleName];
            if (!style) {
                throw new Error(`Unknown format style: ${styleName}`);
            }
            localFormat = deepMergeReplaceArrays(localFormat, style);
        }

        const inlineLocalFormat = removeControlProperties(localOverrides, ['use', 'path']);
        localFormat = deepMergeReplaceArrays(localFormat, inlineLocalFormat);
        result = deepMergeReplaceArrays(result, localFormat);
    }

    validateNumberFormat(result.number, 'Výsledné formátování');
    return result;
}

function formatNumberWithSettings(value, numberFormat = {}) {
    const settings = deepMergeReplaceArrays(DEFAULT_REPORT_FORMAT.number, numberFormat);
    validateNumberFormat(settings, 'Formátování čísla');

    if (value === null || value === undefined) {
        return settings.nullText ?? '';
    }

    if (typeof value !== 'number') {
        return value;
    }

    if (Number.isNaN(value)) {
        return settings.nanText ?? '';
    }

    if (!Number.isFinite(value)) {
        const infinityText = settings.infinityText ?? '';
        if (!infinityText) {
            return String(value);
        }
        return value < 0 ? `-${infinityText}` : infinityText;
    }

    let sourceValue = value;
    const mode = settings.mode ?? 'number';
    if (mode === 'percent') {
        const multiplier = typeof settings.multiplier === 'number' ? settings.multiplier : 100;
        sourceValue *= multiplier;
    }

    if (mode === 'star') {
        if (sourceValue >= 0 && sourceValue < 0.01) {
            return '***';
        }
        if (sourceValue >= 0 && sourceValue < 0.05) {
            return '**';
        }
        if (sourceValue >= 0 && sourceValue < 0.1) {
            return '*';
        }
        return '';
    }

    if (mode === 'scientific') {
        const scientificDecimals = settings.maxDecimals ?? settings.minDecimals ?? 2;
        const scientificText = sourceValue.toExponential(scientificDecimals);
        return `${settings.prefix ?? ''}${scientificText}${settings.suffix ?? ''}`;
    }

    const minDecimals = settings.minDecimals ?? 0;
    const maxDecimals = settings.maxDecimals ?? minDecimals;
    const decimalSeparator = settings.decimalSeparator ?? '.';
    const thousandSeparator = settings.thousandSeparator ?? ',';
    const useGrouping = settings.useGrouping !== false;

    let fixed = sourceValue.toFixed(maxDecimals);
    if (maxDecimals > minDecimals && fixed.includes('.')) {
        const [intPart, fracPart] = fixed.split('.');
        let trimmedFracPart = fracPart;
        while (trimmedFracPart.length > minDecimals && trimmedFracPart.endsWith('0')) {
            trimmedFracPart = trimmedFracPart.slice(0, -1);
        }
        fixed = trimmedFracPart ? `${intPart}.${trimmedFracPart}` : intPart;
    }

    let [integerPart, decimalPart = ''] = fixed.split('.');
    if (useGrouping) {
        const sign = integerPart.startsWith('-') ? '-' : '';
        const unsigned = sign ? integerPart.slice(1) : integerPart;
        integerPart = `${sign}${unsigned.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSeparator)}`;
    }

    const valueText = decimalPart ? `${integerPart}${decimalSeparator}${decimalPart}` : integerPart;
    return `${settings.prefix ?? ''}${valueText}${settings.suffix ?? ''}`;
}

function formatDateWithSettings(value, dateFormat = {}) {
    if (value === null || value === undefined) {
        return dateFormat.nullText ?? '';
    }

    const datePattern = dateFormat.pattern ?? dateFormat.dateFormat ?? DEFAULT_PATTERN;
    const locale = dateFormat.locale ?? DEFAULT_LOCALE;
    const zone = dateFormat.zone ?? DEFAULT_ZONE;

    if (value instanceof Date) {
        const dateTime = DateTime.fromJSDate(value, { zone });
        return dateTime.isValid ? dateTime.setLocale(locale).toFormat(datePattern) : value;
    }

    if (typeof value === 'string') {
        // Nejdřív zkus ISO (např. 2026-05-11T16:47:31.344Z), pak SQL formát.
        const isoDateTime = DateTime.fromISO(value, { setZone: true });
        if (isoDateTime.isValid) {
            const zoned = zone ? isoDateTime.setZone(zone) : isoDateTime;
            return zoned.setLocale(locale).toFormat(datePattern);
        }

        const sqlDateTime = DateTime.fromSQL(value, { zone });
        return sqlDateTime.isValid ? sqlDateTime.setLocale(locale).toFormat(datePattern) : value;
    }

    return value;
}

function applyResolvedFormat(value, resolvedFormat = {}, context = {}) {
    const pathArr = context.pathArr ?? [];
    const dateLogSource = context.dateLogSource ?? 'unknown';

    if (isPlainObject(resolvedFormat.number) && (typeof value === 'number' || value === null || value === undefined)) {
        return formatNumberWithSettings(value, resolvedFormat.number);
    }

    if (isPlainObject(resolvedFormat.date) && (value instanceof Date || typeof value === 'string' || value === null || value === undefined)) {
        /*if (dateLogSource === 'formatStyleOrRule') {
            const pathText = normalizePathSegments(pathArr).join('.') || '<root>';
            const pattern = resolvedFormat.date.pattern ?? resolvedFormat.date.dateFormat ?? DEFAULT_PATTERN;
            console.log(`[FORMAT][DATE] path=${pathText} source=formatStyleOrRule pattern=${pattern} value=${String(value)}`);
        }*/
        return formatDateWithSettings(value, resolvedFormat.date);
    }

    return value;
}

function formatValueByPath(pathArr, value, formatSettings = {}, localOverrides = null) {
    const resolvedFormat = getFormatForPath(pathArr, formatSettings, localOverrides);
    const hasLocalDateOverride = isPlainObject(localOverrides) && isPlainObject(localOverrides.date);
    const dateLogSource = hasLocalDateOverride ? 'localOverride' : 'formatStyleOrRule';
    return applyResolvedFormat(value, resolvedFormat, { pathArr, dateLogSource });
}

function isFormatErrorRenderableValue(value) {
    return value === null ||
        value === undefined ||
        typeof value === 'number' ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        typeof value === 'bigint' ||
        value instanceof Date;
}

function buildFormatErrorText(message, pathArr) {
    const pathText = normalizePathSegments(pathArr).join('.') || '<root>';
    return `[FORMAT_ERROR path=${pathText}] ${message}`;
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

    if (params.orderBy && Array.isArray(ret)) {
        //ret = [...value]; // clone
        ret = value;
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
    globals = {},
    formatSettings = {},
    ignoreFormatErrors = false,
    formatConfigError = null,
    formatErrorContext = "",
} = {}) {
  if (rootObj === null || (typeof rootObj !== "object" && typeof rootObj !== "function")) {
    throw new TypeError("rootObj musí být objekt nebo funkce");
  }

  const cacheByTargetAndPath = new WeakMap(); // target -> Map(pathString -> proxy)

  const isObjectLike = (v) => v !== null && (typeof v === "object" || typeof v === "function");
    const hasGlobalFormatRules = Array.isArray(formatSettings?.format) && formatSettings.format.length > 0;
    const formatErrorLogCache = new Set();
    const globalsObject = isPlainObject(globals) ? globals : {};
    const hasOwnGlobalProperty = (prop) => Object.prototype.hasOwnProperty.call(globalsObject, prop);

  const keyToString = (k) => {
    if (typeof k === "symbol") return logSymbols ? k.toString() : "[symbol]";
    return String(k);
  };

  const pathToString = (pathArr) => pathArr.map(keyToString).join(".");

    const reportFormatProblem = (pathArr, errorMessage, originalValue) => {
        const pathText = pathToString(pathArr) || "<root>";
        const composedMessage = formatErrorContext
            ? `${formatErrorContext} :: ${errorMessage} (path: ${pathText})`
            : `${errorMessage} (path: ${pathText})`;

        if (ignoreFormatErrors || !isFormatErrorRenderableValue(originalValue)) {
            if (!formatErrorLogCache.has(composedMessage)) {
                formatErrorLogCache.add(composedMessage);
                console.error(`[FORMAT] ${composedMessage}`);
            }
            return originalValue;
        }

        return buildFormatErrorText(errorMessage, pathArr);
    };

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

        if (!hasOwnGlobalProperty(prop) && typeof prop === "string" && prop.includes(".")) {
            const lastDot = prop.lastIndexOf(".");
            const parentPath = prop.slice(0, lastDot);
            const lastProp = prop.slice(lastDot + 1);

            const parentValue = Reflect.get(receiver, parentPath);

            if (parentValue == null) return undefined;

            return Reflect.get(parentValue, lastProp);
        }


        const nextPath = pathArr.concat([prop]);
   //     console.log(`[${labelGet}]`, pathToString(nextPath));

                let value = hasOwnGlobalProperty(prop)
                    ? Reflect.get(globalsObject, prop)
                    : Reflect.get(t, prop, receiver);
        let localFormatOverrides = null;
        if (params) {
            try {
                localFormatOverrides = buildLocalFormatOverridesFromParams(params);
            } catch (error) {
                value = reportFormatProblem(nextPath, `Neplatny lokalni format v tagu: ${error.message}`, value);
            }
        }

        if (formatConfigError) {
            value = reportFormatProblem(nextPath, formatConfigError, value);
        } else if (hasGlobalFormatRules || localFormatOverrides) {
            try {
                value = formatValueByPath(nextPath, value, formatSettings, localFormatOverrides);
            } catch (error) {
                value = reportFormatProblem(nextPath, error.message, value);
            }
        }

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
                return hasOwnGlobalProperty(prop) || Reflect.has(t, prop);
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
   /// console.log(`normalizeProp: ${prop}`);
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
      "\\documentclass[border=2pt]{standalone}",
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
            ["-T", "bbox", "-D", "1200", "-o"  , imgPath, "-bg", "Transparent", dviPath],  //TODO dát D do konfigu, nebo ho dynamicky přizpůsobit velikosti vzorce
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
