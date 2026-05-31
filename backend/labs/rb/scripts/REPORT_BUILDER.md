# Report Builder (`build2.js`) — uživatelská a technická dokumentace

Tento dokument popisuje **aktuální** řešení generování reportů skriptem build2.js který je umístěn v laboratoři "report builder" s aliasem RB pomocí kterého jde spouštět z jiné laboratoře.
Cílová skupina jsou pokročilí uživatelé, kteří:

- navrhují DOCX šablony,
- upravují nastavení generování reportu ve zdrojových `environment.json` souborech,
- potřebují rozumět i internímu chování renderu (formátování, obrázky, LaTeX, chyby).

## 1) Co je Report Builder dnes

Report Builder je Node.js skript `build2.js`, který:

- načte konfiguraci z runtime env JSON souboru (`runtime.env` nebo `*.env`),
- načte data (JSON),
- vyrenderuje DOCX šablonu přes Docxtemplater,
- volitelně udělá export do PDF přes LibreOffice (`soffice`).

V produkčním workflow se obvykle volá jako krok:

```text
<RB>/build2.js
```

Např. ve workflow souboru:

```text
reports/generuj_report.workflow
```

obsahuje právě:

```text
<RB>/build2.js
```

## 2) Spuštění

### 2.1 Přímé CLI spuštění

```bash
node build2.js [RESULT_ROOT] [RUNTIME_ENV_PATH] [LAB_ROOT]
```

Parametry:

- `RESULT_ROOT`: kořen běhu/výsledků (sem se zapisuje výstup)
- `RUNTIME_ENV_PATH`: absolutní cesta k runtime env JSON souboru (odtud se čte konfigurace)
- `LAB_ROOT`: kořen laboratoře (typicky složka se šablonami a skripty)

Pokud parametry chybí, skript použije `__dirname`.
Pokud není předán `RUNTIME_ENV_PATH`, skript zkusí nejdřív `RESULT_ROOT/runtime.env` a potom fallback `RESULT_ROOT/environment.json` (legacy kompatibilita).

### 2.2 Spuštění přes workflow engine

V Measure je `RUNTIME_ENV_PATH` generován automaticky:

- při spuštění ze záložky Scripts: `spousteny_soubor.ext.env` vedle spouštěného souboru,
- při vytvoření debug session: `results/<id>/runtime.env`.

Obsah tohoto runtime souboru vzniká hlubokým merge všech `environment.json` od kořene `labs/` směrem ke spouštěnému souboru.

Skript se ve workflow typicky volá například:

```json
{
  "run": {
    "workflow": [
      "<RB>/build2.js"
    ]
  }
}
```

## 3) Tok dat (high-level)

```text
runtime env JSON (vytvořený z kaskády environment.json) -> report.doc[] -> (template + data + format) -> Docxtemplater -> output.docx -> (volitelně) PDF
```

Per dokument (`report.doc[i]`) probíhá:

1. Vyřešení cest (`template`, `data`, `renderTo`, `format`).
2. Načtení dat (`data`) do objektu.
3. Vytvoření proxy vrstvy nad daty (parametry tagů, formátování, globals).
4. Render DOCX (`doc.render(virtualData)`).
5. Uložení DOCX.
6. Pokud `exportPDF: true`, převod přes `soffice --headless`.

## 4) Konfigurace runtime env JSON

Hlavní konfigurace je v `report.doc[]`.
Prakticky ji nastavuješ ve zdrojových `environment.json` souborech; runtime soubor pak obsahuje jejich sloučený výsledek.

### 4.1 Minimální příklad

```json
{
  "report": {
    "doc": [
      {
        "template": "reports/SeznamOsobTemplate.docx",
        "renderTo": "SeznamOsob.docx",
        "data": "Data/fyzici.json",
        "exportPDF": true
      }
    ]
  }
}
```

### 4.2 Rozšířený příklad (format, globals, defaults)

```json
{
  "report": {
    "doc": [
      {
        "template": "Templates/template_ZZ_SS02.docx",
        "renderTo": "reports/final-report.docx",
        "data": "Outputs/full_statistics.json",
        "dataInResult": true,
        "format": "Templates/format-settings.json",
        "formatInResult": false,
        "ignoreFormatErrors": false,
        "globals": {
          "OT": true,
          "censorText1": "[...obchodni tajemstvi...]"
        },
        "defaults": {
          "mexpr": { "scale": 0.072 },
          "img": { "scale": 0.6 }
        },
        "exportPDF": true
      }
    ]
  }
}
```

### 4.3 Význam klíčů

| Klíč | Povinný | Význam |
|---|---|---|
| `template` | Ano | Cesta k DOCX šabloně |
| `renderTo` | Ano | Cesta výsledného DOCX |
| `data` | Ne | Datový JSON; pokud chybí, renderuje se s prázdnými daty |
| `dataInResult` | Ne | Pokud `true`, `data` se hledá primárně v `RESULT_ROOT` |
| `format` | Ne | JSON s pravidly formátování |
| `formatInResult` | Ne | Pokud `true`, `format` se hledá primárně v `RESULT_ROOT` |
| `ignoreFormatErrors` | Ne | Chování při formátovacích chybách |
| `globals` | Ne | Globální proměnné pro šablonu (mají prioritu nad daty) |
| `defaults` | Ne | Výchozí rozměry/scale pro `img` a `mexpr` |
| `exportPDF` | Ne | Po DOCX renderu se spustí konverze do PDF |

## 5) Rozlišení cest a aliasy

Skript umí:

- absolutní cesty,
- relativní cesty,
- alias syntaxi `<ALIAS>/...`.

Alias se bere z `labs/aliases.json` a mapuje na:

```text
<labs_root>/<alias_target>/scripts/...
```

To platí pro `template`, `data`, `renderTo` i `format`.

### Důležité kořeny

- `template`: relativně k `LAB_ROOT`
- `renderTo`: relativně k `RESULT_ROOT`
- `data`: relativně k `LAB_ROOT`, nebo k `RESULT_ROOT` pokud `dataInResult: true`
- `format`: primárně `LAB_ROOT` (nebo `RESULT_ROOT`, pokud `formatInResult: true`), sekundárně se zkouší i druhý root

## 6) Syntaxe šablon (DOCX)

Docxtemplater používá delimitery:

```text
[[ ... ]]
```

### 6.1 Základní tagy

```text
[[title]]
[[company.name]]
[[meta.generatedAt]]
```

### 6.2 Cykly

```text
[[#items]]
- [[name]]: [[price]]
[[/items]]
```

### 6.3 Cykly se sort parametrem `orderBy`

`orderBy` funguje na pole a podporuje více klíčů.

```text
[[#items orderBy=name]] ... [[/items]]
[[#items orderBy=score desc,name]] ... [[/items]]
```

Poznámka: řazení probíhá `in-place` (mutuje původní pole), takže ovlivní i další použití stejného pole ve stejné šabloně.

### 6.4 Podmíněné bloky (`#` a `^`)

Docxtemplater podporuje sekce:

- `[[#X]] ... [[/X]]`: blok se vykreslí, když je `X` truthy.
- `[[^X]] ... [[/X]]`: invertovaný blok, vykreslí se jen když je `X` falsy (falsish).

Praktický příklad pro přepínání textu s obchodním tajemstvím:

```text
[[^OT]]tajny text s obchodnim tajemstvim[[/OT]]
[[#OT]][[censorText1]][[/OT]]
```

Význam:

- pokud je `OT = false`, vykreslí se tajný text,
- pokud je `OT` truthy, tajný text se skryje a místo něj se vykreslí hodnota `censorText1`.

Tím lze z jedné šablony generovat dvě varianty dokumentu (s obchodním tajemstvím a bez něj) pouze změnou `globals.OT` ve zdrojovém `environment.json` (resp. v runtime env po sloučení).

### 6.5 Obrázky

Image tag je přes `%`:

```text
[[%img filename="img/logo.png" width=260]]
[[%img filename="charts/plot1.png" scale=0.5]]
```

Podporované parametry v praxi:

- `filename`
- `width`
- `height`
- `scale`
- `expr` (viz mexpr níže)

`filename` může být i relativní k aktuálnímu datovému uzlu (začíná tečkou):

```text
[[#people]]
[[name]]
[[%img filename=".photo" width=180]]
[[/people]]
```

Při nenalezení obrázku render nespadne, vrací se 1x1 transparentní PNG.

### 6.6 Mexpr (LaTeX matematika)

RB umí vykreslit matematický výraz jako obrázek dvěma cestami:

1. Ze souboru `.mexpr` / `.expr`:

```text
[[%img filename="eq/regression.mexpr" scale=0.8]]
```
.mexpr soubor je textový soubor obsahující LaTeX výraz. Znamená Measure Expression

2. Inline LaTeX přímo v tagu:

```text
[[%$\\frac{-b \pm \sqrt{b^2-4ac}}{2a}$ width=280]]
```

3. Nebo z dat přes `expr`:

```text
[[%img expr=".formula" width=260]]
```

Interně se LaTeX převádí na PNG (kvůli kompatibilitě s Wordem) a výsledek se cachuje.

## 7) Parametry tagů: dva zápisy

Skript umí dva styly parametrů:

1. JSON styl

```text
[[value {"use":"coef4"}]]
[[value {"number":{"minDecimals":4,"maxDecimals":4}}]]
```

2. Jednoduchý `key=value` styl

```text
[[#items orderBy=score desc,name]]
[[%img filename="img/a.png" width=200 height=120]]
```

Tip:

- JSON styl je vhodný pro vnořené objekty (`number`, `date`, `format`).
- `key=value` styl je pohodlný pro jednoduché string parametry.
- Typografické uvozovky z Wordu (např. “ ”) se normalizují na klasické `"`.

## 8) Formátování hodnot (format engine)

Pro detailní popis existuje i `FORMATING.md`, ale níže je praktické minimum.

### 8.1 Kde se zapíná

V `report.doc[i]` nastavíš:

- `format`: cesta na JSON,
- `ignoreFormatErrors`: režim chyb.

### 8.2 Struktura format JSON

- `formatStyles`: pojmenované reusable styly.
- `format`: pole pravidel s `path` (+ volitelně `use`, `number`, `date`, ...).

Podpora wildcardů v `path`:

- `*` = jeden segment,
- `**` = libovolně hluboko.

### 8.3 Number režimy

Podporované `number.mode`:

- `number`
- `percent`
- `currency`
- `scientific`
- `star`

`star` mapuje např. p-value na `***`, `**`, `*`.

Poznámka: `currency` je aktuálně jen konfigurační hodnota mode; speciální měnová logika není implementována samostatně, běžně se používá kombinace `prefix`/`suffix`.

### 8.4 Date formátování

Date formát bere:

- ISO stringy,
- SQL date/datetime.

Konfigurace přes:

- `pattern` (nebo `dateFormat`),
- `locale`,
- `zone`,
- `nullText`.

### 8.5 Lokální override přímo v tagu

```text
[[amount {"number":{"minDecimals":2,"maxDecimals":2,"suffix":" Kc"}}]]
[[createdAt {"date":{"pattern":"d. LLLL yyyy","locale":"cs","zone":"Europe/Prague"}}]]
[[renderedAt {"use":"csDateLongTime"}]]
```

Lokální override má nejvyšší prioritu.

### 8.6 Chyby formátování

- `ignoreFormatErrors: false` (výchozí): do výstupu jde text typu `[FORMAT_ERROR ...]`.
- `ignoreFormatErrors: true`: hodnota zůstane původní, chyba jde do stderr (`[FORMAT] ...`).

## 9) Globals a systémové proměnné

`globals` v `report.doc[i]` jsou dostupné jako běžné tagy.

```json
"globals": {
  "semester": "LS 2025/2026",
  "reportTitle": "Ekonometricky report"
}
```

Použití:

```text
[[reportTitle]]
[[semester]]
```

Příklad pro podmíněné vykreslení obsahu podle obchodního tajemství:

```json
"globals": {
  "OT": true,
  "censorText1": "[...obchodni tajemstvi...]"
}
```

```text
[[^OT]]tajny text s obchodnim tajemstvim[[/OT]]
[[#OT]][[censorText1]][[/OT]]
```

Chování:

- Pokud klíč existuje v `globals`, má přednost před daty.
- Hodnoty z `globals` jsou dostupné i uvnitř zanořených cyklů/objektů, tedy bez ohledu na aktuální datový kontext.
- Systém přidává `renderedAt` (ISO čas renderu).

## 10) Jak funguje render uvnitř (pro pokročilé)

Pipeline při čtení tagu:

1. Parse názvu property + parametrů (`normalizeProp`).
2. Volitelně detekce inline LaTeX (`$...$`) pro image cestu.
3. Výběr hodnoty (nejdřív `globals`, jinak data).
4. Aplikace formátovacích pravidel (`formatSettings` + lokální override).
5. `customizeValue`:
   - `orderBy` pro pole,
   - registrace image tagů (`img`) do interní mapy.
6. Rekurzivní proxy pro vnořené objekty.

Důsledek: syntaxe tagů je velmi flexibilní, ale při kombinaci více mechanismů je dobré testovat šablony na reprezentativních datech.

## 11) Chování při chybách a exit code

- Fatální chyba renderu dokumentu nastaví interní `failed=true`.
- Na konci skript vrací exit code `1`, pokud se některý dokument nepodařilo vytvořit.
- Chyby formátování samy o sobě render neshazují (viz `ignoreFormatErrors`).

## 12) Závislosti

Lokální `package.json` skriptu (`rb/scripts`) používá:

- `docxtemplater`
- `docxtemplater-image-module-free`
- `pizzip`
- `luxon`
- `image-size`
- `mysql2` (v `build2.js` aktuálně nepoužité)

Systémové nástroje:

- `soffice` (LibreOffice) pro PDF export
- `latex` + `dvipng` (a případně `dvisvgm`) pro mexpr/LaTeX render

## 13) Praktické doporučení pro autory šablon

1. Pro složitější parametry používej JSON zápis v tagu.
2. Pro formátování na více místech používej `formatStyles` + `use`.
3. U opakovaných bloků používej `orderBy`, ale počítej s mutací pořadí.
4. Pro obrázky preferuj explicitní `width`/`height` nebo `scale`.
5. Pokud debugguješ format rules, nech `ignoreFormatErrors: false`, aby byly chyby vidět přímo v dokumentu.

## 14) Rychlý checklist před spuštěním

- Existuje runtime env soubor na `RUNTIME_ENV_PATH`?
- Sedí cesty `template` / `data` / `renderTo`?
- Pokud používáš `format`, je soubor validní JSON objekt?
