# Reporter.js - Dokumentace generování reportů

## Přehled

Script `reporter.js` generuje Word dokumenty (.docx) ze šablon s dynamickými daty. Podporuje generování více dokumentů z různých šablon v jednom běhu.

## Instalace

### Node.js Dependencies

Reporter má vlastní `package.json` s potřebnými knihovnami.

```bash
cd scripts/reports
npm install
```

**Dependencies:**
- `docxtemplater` (^3.65.3) - Šablonový engine pro DOCX
- `docxtemplater-image-module-free` (^1.1.1) - Podpora pro obrázky
- `pizzip` (^3.2.0) - ZIP/DOCX handling
- `dotenv` (^17.2.1) - Environment variables
- `mysql2` (^3.14.3) - MySQL database connector

### Automatická Instalace

Při prvním použití na serveru:

```bash
cd scripts/reports
npm install
cd ../..
```

## Použití

```bash
node scripts/reports/reporter.js <workingDirectory>
```

**Parametry:**
- `workingDirectory` - Cesta k adresáři obsahujícímu `data.json` a výstupní složky

## Konfigurace v data.json

### Základní struktura

```json
{
  "dateFrom": "2025-01-01",
  "dateTo": "2025-12-31",
  "products": [...],
  "report": {
    "doc": [
      {
        "template": "templateM.docx",
        "renderTo": "Manažerský výstup.docx"
      },
      {
        "template": "templateUZ.docx",
        "renderTo": "Záznam o provedení analýzy.docx"
      }
    ]
  }
}
```

### Report konfigurace

**`report.doc`** - Pole objektů s konfigurací dokumentů

Každý objekt obsahuje:
- **`template`** (string, povinné) - Název šablony v `scripts/reports/`
- **`renderTo`** (string, povinné) - Název výstupního souboru v `workingDirectory`

### Příklad - více dokumentů

```json
{
  "report": {
    "doc": [
      {
        "template": "templateManazerskyShrnuty.docx",
        "renderTo": "Manažerské shrnutí.docx"
      },
      {
        "template": "templateDetailniAnalyza.docx",
        "renderTo": "Detailní analýza.docx"
      },
      {
        "template": "templateZaznamAnalyzy.docx",
        "renderTo": "Záznam o provedení analýzy.docx"
      }
    ]
  }
}
```

### Příklad - jeden dokument

```json
{
  "report": {
    "doc": [
      {
        "template": "template.docx",
        "renderTo": "report.docx"
      }
    ]
  }
}
```

## Zpětná kompatibilita

Pokud `report.doc` není v `data.json` definováno, script použije výchozí konfiguraci:

```javascript
{
  template: 'template.docx',
  renderTo: 'report.docx'
}
```

## Šablony

### Umístění šablon

Všechny šablony musí být v adresáři:
```
scripts/reports/
├── template.docx
├── templateM.docx
├── templateUZ.docx
└── reporter.js
```

### Syntaxe šablony

Reporter používá `docxtemplater` s vlastními delimitery:

**Základní proměnné:**
```
[[nazevPromenne]]
```

**Smyčky:**
```
[[#products]]
  [[name]] - [[price]]
[[/products]]
```

**Podmínky:**
```
[[#isActive]]
  Aktivní
[[/isActive]]
[[^isActive]]
  Neaktivní
[[/isActive]]
```

**Obrázky:**
```
[[img_slozka:productId]]
[[img_product:productId]]
```

### Dostupná data v šablonách

```javascript
{
  dateFrom: "2025-01-01",           // Původní formát
  dateTo: "2025-12-31",             // Původní formát
  dateFromDMY: "1.1.2025",          // Český formát
  dateToDMY: "31.12.2025",          // Český formát
  products: [
    {
      id: 1,
      name: "Produkt",
      // ... další vlastnosti produktu
      characteristics: [             // Charakteristiky pro tabulky
        { key: "Popis", value: "Hodnota" }
      ],
      img_graf: 1,                   // ID pro obrázky
      img_product: 1,
      // ... další img_* podle složek
    }
  ],
  // ... další data z data.json
}
```

## Obrázky

### Struktura složek

```
workingDirectory/
├── data.json
├── img/
│   ├── graf/
│   │   ├── 1.png
│   │   └── 2.jpg
│   ├── diagram/
│   │   └── 1.png
│   └── screenshot/
│       └── 1.png
└── ../../common/img/products/
    ├── product_1.jpg
    └── product_2.png
```

### Použití v šablonách

**Obrázky v podsložkách (produktové):**
```
[[img_graf:productId]]      → img/graf/{productId}.png|jpg
[[img_diagram:productId]]   → img/diagram/{productId}.png|jpg
[[img_product:productId]]   → common/img/products/product_{productId}.jpg|png
```

**Obrázky přímo v img/ složce (ABSOLUTE):**
```
[[img_chart]]               → img/chart.png|jpg
[[img_summary]]             → img/summary.png|jpg
[[img_logo]]                → img/logo.png|jpg
```

Při použití ABSOLUTE módu:
- Název tagu odpovídá názvu souboru bez přípony
- Hledá se přímo v `img/` složce (ne v podsložkách)
- Automaticky detekováno funkcí `addImgTags()`

### Velikosti obrázků

- **Produktové obrázky:** 189×189 px
- **Grafy/diagramy:** 500×400 px

Pokud obrázek není nalezen, použije se transparentní 1×1 PNG.

## Workflow

1. **Načtení data.json** z `workingDirectory`
2. **Zpracování dat:**
   - Konverze datumů do CZ formátu
   - Příprava charakteristik produktů
   - Mapování odkazů na obrázky v podsložkách
   - **Automatické přidání img tagů** (`addImgTags`)
     - Skenuje všechny PNG/JPG přímo v `img/` složce
     - Vytvoří `img_nazevsouboru = "ABSOLUTE"` atributy
     - Umožňuje použití těchto obrázků v šablonách
3. **Pro každou konfiguraci v report.doc:**
   - Načtení šablony
   - Render s daty (včetně ABSOLUTE obrázků)
   - Uložení výstupního dokumentu
4. **Výstup** - Všechny dokumenty v `workingDirectory`

## Error Handling

### Chybějící šablona

```
Chyba: Šablona templateXYZ.docx nebyla nalezena v /path/to/scripts/reports
```

**Řešení:**
- Zkontroluj název šablony v `data.json`
- Ověř že šablona existuje v `scripts/reports/`

### Chybějící data.json

```
Chyba při načítání data.json: ENOENT: no such file or directory
```

**Řešení:**
- Zkontroluj že `workingDirectory` obsahuje `data.json`
- Ověř správnou cestu k pracovnímu adresáři

### Render error

```
Chyba při zpracování dokumentu template.docx: Unclosed tag
```

**Řešení:**
- Zkontroluj syntax v šabloně
- Ověř že všechny tagy jsou uzavřené: `[[#tag]] ... [[/tag]]`
- Zkontroluj delimitery: `[[` a `]]`

### Chybějící obrázek

Není chyba - použije se transparentní placeholder

## Funkce addImgTags

### Účel

Automaticky přidává img atributy do reportData pro všechny obrázky přímo v `img/` složce.

### Jak funguje

1. Skenuje všechny soubory v `IMAGES_DIR` (ne rekurzivně)
2. Filtruje pouze `.png` a `.jpg` soubory
3. Pro každý obrázek vytvoří atribut:
   - Název: `img_{nazevsouboru}` (bez přípony)
   - Hodnota: `"ABSOLUTE"`

### Příklad

**Struktura složek:**
```
workingDirectory/img/
├── chart.png
├── logo.jpg
├── summary.png
└── graf/            (složka - ignorována)
    └── 1.png
```

**Výsledné atributy v reportData:**
```javascript
{
  img_chart: "ABSOLUTE",
  img_logo: "ABSOLUTE",
  img_summary: "ABSOLUTE",
  // ... ostatní data
}
```

**Použití v šabloně:**
```
[[img_chart]]     → img/chart.png
[[img_logo]]      → img/logo.jpg
[[img_summary]]   → img/summary.png
```

### Console output

```
Nalezeno 3 obrázků v /path/to/workingDirectory/img
  + img_chart = "ABSOLUTE"
  + img_logo = "ABSOLUTE"
  + img_summary = "ABSOLUTE"
```

### Podporované formáty

- ✅ `.png` (case-insensitive)
- ✅ `.jpg` (case-insensitive)
- ❌ Složky (ignorovány)
- ❌ Jiné formáty (ignorovány)

### Error handling

- Pokud `IMAGES_DIR` neexistuje → varování + pokračování
- Pokud obrázek v šabloně není nalezen → placeholder
- Chyba při čtení složky → error log + pokračování

## Příklady použití

### Jednoduchý report

**data.json:**
```json
{
  "dateFrom": "2025-01-01",
  "dateTo": "2025-12-31",
  "products": [
    { "id": 1, "name": "Produkt A", "price": 100 }
  ],
  "report": {
    "doc": [
      {
        "template": "simple.docx",
        "renderTo": "output.docx"
      }
    ]
  }
}
```

**Spuštění:**
```bash
node scripts/reports/reporter.js /path/to/results/123
```

**Výstup:**
```
Data.json byl úspěšně načten
Nalezeno 1 konfigurací dokumentů v data.json

Zpracovávám dokument: simple.docx -> output.docx
✓ Dokument vytvořen: /path/to/results/123/output.docx

=== Generování dokumentů dokončeno ===
```

### Více reportů

**data.json:**
```json
{
  "report": {
    "doc": [
      {
        "template": "executive.docx",
        "renderTo": "Executive Summary.docx"
      },
      {
        "template": "detailed.docx",
        "renderTo": "Detailed Analysis.docx"
      },
      {
        "template": "appendix.docx",
        "renderTo": "Appendix.docx"
      }
    ]
  }
}
```

**Výstup:**
```
Nalezeno 3 konfigurací dokumentů v data.json

Zpracovávám dokument: executive.docx -> Executive Summary.docx
✓ Dokument vytvořen: .../Executive Summary.docx

Zpracovávám dokument: detailed.docx -> Detailed Analysis.docx
✓ Dokument vytvořen: .../Detailed Analysis.docx

Zpracovávám dokument: appendix.docx -> Appendix.docx
✓ Dokument vytvořen: .../Appendix.docx

=== Generování dokumentů dokončeno ===
```

### Chyba v jedné šabloně

```
Nalezeno 3 konfigurací dokumentů v data.json

Zpracovávám dokument: valid.docx -> output1.docx
✓ Dokument vytvořen: .../output1.docx

Zpracovávám dokument: missing.docx -> output2.docx
Chyba: Šablona missing.docx nebyla nalezena

Zpracovávám dokument: valid2.docx -> output3.docx
✓ Dokument vytvořen: .../output3.docx

=== Generování dokumentů dokončeno ===
```

**Poznámka:** Script pokračuje i při chybě v jedné šabloně.

## Best Practices

### 1. Konzistentní pojmenování

```json
{
  "doc": [
    {
      "template": "template_managersky_2025.docx",
      "renderTo": "Manažerské shrnutí 2025.docx"
    }
  ]
}
```

### 2. Testování šablon

Před nasazením otestuj každou šablonu samostatně:

```json
{
  "doc": [
    {
      "template": "new_template.docx",
      "renderTo": "test_output.docx"
    }
  ]
}
```

### 3. Verze šablon

```json
{
  "doc": [
    {
      "template": "template_v2.docx",
      "renderTo": "Report v2.docx"
    }
  ]
}
```

### 4. Chybové stavy

Script neukončuje běh při chybě jedné šablony - umožňuje generování zbylých dokumentů.

## Integrace s workflow

Reporter.js je typicky volán z analysis workflow:

**Příklad workflow:**
```
prepare_stats.py
plot_graf.py
plot_diagram.py
reports/reporter.js
```

**V config.json:**
```json
{
  "scriptCommands": {
    ".js": {
      "command": "node",
      "description": "Node.js scripts"
    }
  }
}
```

## Troubleshooting

### Problém: Prázdný dokument

**Příčina:** Nesprávné delimitery nebo chybějící data

**Řešení:**
1. Zkontroluj že šablona používá `[[` a `]]`
2. Ověř že data existují v `data.json`
3. Zkontroluj console log pro render errors

### Problém: Obrázky se nezobrazují

**Příčina:** Chybějící soubory nebo špatné cesty

**Řešení:**
1. Ověř že složka `img/` existuje v `workingDirectory`
2. Zkontroluj že obrázky mají správné názvy (např. `1.png`, ne `product_1.png`)
3. Podporované formáty: `.png`, `.jpg`

### Problém: Dokument se negeneruje

**Příčina:** Chyba v šabloně nebo datech

**Řešení:**
1. Spusť s `node --trace-warnings`
2. Zkontroluj error log
3. Validuj `data.json` (JSON syntax)
4. Otestuj šablonu s minimálními daty

## Dependencies

Reporter má vlastní `package.json` v `scripts/reports/`:

```json
{
  "name": "reporter",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "docxtemplater": "^3.65.3",
    "docxtemplater-image-module-free": "^1.1.1",
    "pizzip": "^3.2.0",
    "dotenv": "^17.2.1",
    "mysql2": "^3.14.3"
  }
}
```

**Instalace:**
```bash
cd scripts/reports
npm install
```

## Changelog

### v2.0 - Multiple Documents Support
- ✅ Podpora více dokumentů v jednom běhu
- ✅ Konfigurace přes `report.doc` array
- ✅ Zpětná kompatibilita s původní verzí
- ✅ Lepší error handling
- ✅ Pokračování při chybě jedné šablony

### v1.0 - Initial Version
- ✅ Základní generování z jedné šablony
- ✅ Podpora obrázků
- ✅ Docxtemplater integrace
