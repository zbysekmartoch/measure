# build.js — Podrobná dokumentace

## Účel

`build.js` je CLI skript pro **generování DOCX (a volitelně PDF) reportů** z datových podkladů (JSON) a DOCX šablon. Využívá knihovnu **Docxtemplater** s rozšířením pro obrázky. Skript je součástí systému ÚOHS/Measure — laboratorního prostředí „RB" (Report Builder).

## Spuštění

```bash
node build.js [RESULT_ROOT] [WORKFLOW_ROOT] [LAB_ROOT]
```

- `RESULT_ROOT` — kořenová složka výsledků, obsahuje `environment.json`, datové soubory a výstupní dokumenty
- `WORKFLOW_ROOT` — (momentálně ignorován)
- `LAB_ROOT` — kořenová složka laboratoře, obsahuje DOCX šablony

Pokud parametry nejsou zadány, oba (`RESULT_ROOT` i `LAB_ROOT`) defaultují na složku skriptu (`__dirname`) — to je pro účely lokálního testování.

---

## Architektura a tok dat

```
environment.json ──┐
                    │
data.json ─────────┼──▶ build.js ──▶ report.docx (→ report.pdf)
                    │        ▲
šablona.docx ──────┘        │
                         img/ (obrázky)
```

### Hlavní kroky (`main()`)

1. **Načtení konfigurace** — `loadEnvironment()` čte `RESULT_ROOT/environment.json`.
2. **Konfigurace dokumentů** — čte `environment.report.doc[]` (pole konfigurací). Pokud chybí, použije fallback `template.docx → report.docx`.
3. **Pro každý dokument:**
   - Načte datový soubor (`data`) relativně k `RESULT_ROOT`.
   - Načte DOCX šablonu (`template`) relativně k `LAB_ROOT`.
   - Připraví obrázky z `RESULT_ROOT/img/`.
   - Data obalí do **Proxy** (`createDeepIntrospectingGetLoggerProxy`) pro inline parametrizaci tagů.
   - Vytvoří `ImageModule` s vlastní logikou nalezení a měření obrázků.
   - Zavolá `doc.render(virtualData)`.
   - Výsledný DOCX zapíše do `RESULT_ROOT` dle `renderTo`.
   - Pokud je `exportPDF: true`, zkonvertuje DOCX na PDF přes LibreOffice (`soffice --headless`).

---

## Konfigurace (`environment.json`)

Soubor `environment.json` v `RESULT_ROOT` obsahuje klíč `report.doc`:

```json
{
  "report": {
    "doc": [
      {
        "template": "cesta/k/sablone.docx",
        "renderTo": "vystupni/slozka/report.docx",
        "data": "cesta/k/data.json",
        "exportPDF": true
      }
    ]
  }
}
```

| Klíč | Popis | Relativní k |
|---|---|---|
| `template` | Cesta k DOCX šabloně | `LAB_ROOT` |
| `renderTo` | Cesta k výstupnímu souboru | `RESULT_ROOT` |
| `data` | Cesta k datovému JSON souboru (default `data.json`) | `RESULT_ROOT` |
| `exportPDF` | Volitelné — po uložení DOCX zkonvertuje na PDF | — |

Pokud `report.doc` chybí, generuje se jeden dokument z `template.docx` do `report.docx`.

---

## Klíčové komponenty

### `loadEnvironment()`
Synchronně čte a parsuje `RESULT_ROOT/environment.json`. Při chybě ukončí proces.

### `loadData(dataFilePath)`
Synchronně čte a parsuje datový JSON soubor. Cesta je předána jako parametr.

### `enhanceProducts(products)`
Ke každému produktu přidá pole `characteristics` — mapuje statistické klíče (`N`, `Pmin`, `Pmax`, `Pp`, `Pmed`, …) na objekty `{ key: český_popis, value }`. Slouží pro tabulky v šablonách.

### `buildImageModule(allProducts)`
Vytváří instanci `docxtemplater-image-module-free` se dvěma callbacky:

- **`getImage(tagValue)`** — z globálního pole `gImgParams` zjistí cestu k souboru. Hledá soubor v `RESULT_ROOT`. Pokud obrázek neexistuje, vrátí 1×1 transparentní PNG.
- **`getSize(img, tagValue)`** — vrátí `[width, height]` z parametrů tagu. Výchozí velikost je 500×400 px.

### `convertDocxToPdf(inputPath, outDir)`
Konvertuje DOCX na PDF přes LibreOffice v headless režimu (`soffice`). Vrací Promise s cestou k PDF.

### `createDeepIntrospectingGetLoggerProxy(rootObj)`
Obalí datový objekt do ES6 **Proxy**, který:

- **Parsuje inline parametry v názvech vlastností** — šablonový tag jako `[[datum{"dateFormat":"dd.MM.yyyy"}]]` se rozloží na název vlastnosti `datum` a parametry `{ dateFormat: "dd.MM.yyyy" }`.
- **Volá `customizeValue()`** — aplikuje transformace podle parametrů (formátování data, registrace obrázku).
- **Rekurzivně proxynuje** vnořené objekty (s cache přes `WeakMap`).

### `normalizeProp(prop)`
Rozdělí řetězec tvaru `nazev{"param":"value"}` na tuple `[nazev, { param: "value" }]`. Před parsováním normalizuje typografické uvozovky na standardní `"`.

### `formatTemplateDate(iso, options)`
Formátuje SQL datetime řetězec přes Luxon s výchozím českým locale a pražskou timezone. Formát je konfigurovatelný z parametrů tagu.

### `customizeValue(value, params, pathArr)`
Router transformací:
- Pokud `params.dateFormat` existuje → formátuje datum.
- Pokud poslední segment cesty je `img` → zaregistruje obrázek do `gImgParams` a vrátí jeho index.

---

## Šablonový systém

Šablony jsou DOCX soubory s **vlastními delimitery `[[ ]]`** (místo výchozích `{{ }}`).

### Tagy v šablonách

| Syntaxe | Význam |
|---|---|
| `[[nazev]]` | Jednoduchá substituce hodnoty |
| `[[nazev{"dateFormat":"dd.MM.yyyy"}]]` | Hodnota s inline parametry (formát data) |
| `[[#products]]...[[/products]]` | Loop přes pole produktů |
| `[[%img{"path":"subdir","width":600,"height":400}]]` | Vložení obrázku s parametry |

### Obrázky

Obrázky se hledají v `RESULT_ROOT/img/` dle parametru `filename` v tagu. Systém podporuje PNG a JPG formáty.

---

## Závislosti

| Balíček | Verze | Účel |
|---|---|---|
| `docxtemplater` | ^3.65.3 | Šablonový engine pro DOCX |
| `docxtemplater-image-module-free` | ^1.1.1 | Vkládání obrázků do šablon |
| `pizzip` | ^3.2.0 | ZIP manipulace (čtení/zápis DOCX) |
| `luxon` | ^3.7.2 | Formátování datumů |
| `mysql2` | ^3.14.3 | MySQL klient (zakomentovaný import, zatím nepoužitý) |

Systémový požadavek: `soffice` (LibreOffice) pro volitelný export do PDF.
