# Measure Environment

Tento dokument popisuje, jak v Measure funguje kaskádová konfigurace běhového prostředí.

## 1. Přehled

Measure používá dvě vrstvy konfigurace:

1. Zdrojové soubory `environment.json`
2. Vygenerovaný runtime soubor (`runtime.env` nebo `*.env`)

Skript při běhu nečte přímo všechny zdrojové soubory. Dostane už hotový runtime JSON jako druhý argument.

## 2. Kde se runtime soubor vytváří

### 2.1 Spuštění ze záložky Scripts (`Run`)

Při spuštění `.workflow` nebo jednoho skriptu se vedle spouštěného souboru vytvoří:

- `full_analysis.workflow.env`
- `draw_plots.py.env`
- `prepare_data.js.env`

Soubor se při každém spuštění přepíše.

### 2.2 Create debugging session

Při vytvoření debug session se v resultu vytvoří:

- `results/<id>/runtime.env`

Soubor se použije při následném spuštění resultu (Run/Debug z Results).
V nově vytvořených debug results se už nevytváří `results/<id>/environment.json`.

## 3. Odkud se runtime obsah bere

Runtime JSON vznikne hlubokým merge všech `environment.json` po cestě:

- od kořene `backend/labs`
- až do složky, kde leží spouštěný soubor

Příklad pro spuštění souboru:

- `backend/labs/4/scripts/analyzy/full_analysis.workflow`

Systém postupně vezme (pokud existují):

1. `backend/labs/environment.json`
2. `backend/labs/4/environment.json`
3. `backend/labs/4/scripts/environment.json`
4. `backend/labs/4/scripts/analyzy/environment.json`

A sloučí je do výsledného runtime JSON.

## 4. Pravidla merge

### 4.1 Objekty

Objekty se mergují rekurzivně.

Pokud má stejný klíč více souborů, bližší soubor (níž ve stromu) má prioritu.

### 4.2 Pole

Pokud je stejný klíč pole v obou vrstvách, pole se spojí (`concat`).

### 4.3 Skalární hodnoty

String/number/boolean/null se přepisují hodnotou z bližší vrstvy.

## 5. Co skript dostane v argumentech

Každý skript spuštěný workflow enginem dostává:

1. `RESULT_ROOT` (argument 1)
2. `RUNTIME_ENV_PATH` (argument 2)
3. `LAB_ROOT` (argument 3)

Python příklad:

```python
import sys

result_root = sys.argv[1]
runtime_env_path = sys.argv[2]
lab_root = sys.argv[3]
```

Node.js příklad:

```js
const resultRoot = process.argv[2];
const runtimeEnvPath = process.argv[3];
const labRoot = process.argv[4];
```

R příklad:

```r
args <- commandArgs(trailingOnly = TRUE)
result_root <- args[1]
runtime_env_path <- args[2]
lab_root <- args[3]
```

## 6. Klíč `run` v runtime env

Po vytvoření debug session i po produkčním spuštění (`Run`) obsahuje runtime env klíč `run`.

`run` obsahuje mimo jiné:

- `run.workflow` (zdroj kroků, ze kterého se workflow opravdu spouští)
- `run.mode` (`debug` nebo `production`)
- `run.workflowFile`, `run.name`, `run.author`
- interní metadata (`_usr_id`, `_workflowRoot`, `_scriptsRoot`, `_created`)

Spouštění workflow používá `run.workflow` z runtime env souboru.

## 7. Doporučená struktura konfigurace

Typická praxe:

- `backend/labs/<lab>/scripts/environment.json`: společné nastavení celé laboratoře
- `backend/labs/<lab>/scripts/<workflow-dir>/environment.json`: přepsání pro konkrétní workflow skupinu
- `backend/labs/<lab>/scripts/<workflow-dir>/<nested>/environment.json`: jemné doladění

Tak lze držet globální defaulty nahoře a specifika níž.

## 8. Vztah k result `environment.json`

U nových debug results se `environment.json` už nevytváří.

Legacy/historické výsledky mohou `environment.json` ještě obsahovat.

Nové runtime chování ale používá pro běh vždy runtime soubor:

- `results/<id>/runtime.env` pro result běhy
- `*.env` vedle spouštěného souboru pro Scripts Run

## 9. Časté chyby

- Neplatný JSON v některém `environment.json`.
	Runtime soubor se nevytvoří a běh skončí chybou.


- Očekávání, že pole se přepisují.
	Pole se nepřepisují, ale concatenují.


- Konfigurace uložená moc vysoko.
	Pokud je hodnota obecná, dej ji výš; pokud má platit jen pro konkrétní workflow, dej ji blíž ke spouštěnému souboru.

## 10. Praktický checklist

- Je `environment.json` validní JSON objekt?
- Je konfigurace umístěná ve správné složce (správná priorita)?
- Obsahuje runtime soubor očekávané klíče?
- Nezpůsobuje concat polí nechtěné duplicity?
