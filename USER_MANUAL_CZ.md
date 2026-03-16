# Uživatelská příručka — Measure

**Modular Extensible Analytical Stack for a Unified Research Environment**

---

## Obsah

1. [Filozofie projektu](#1-filozofie-projektu)
2. [Přehled aplikace](#2-přehled-aplikace)
3. [Přihlášení a správa účtu](#3-přihlášení-a-správa-účtu)
4. [Laboratoře (Labs)](#4-laboratoře-labs)
   - [Co je laboratoř](#41-co-je-laboratoř)
   - [Vytváření a správa laboratoří](#42-vytváření-a-správa-laboratoří)
   - [Sdílení laboratoří](#43-sdílení-laboratoří)
   - [Klonování laboratoří](#44-klonování-laboratoří)
   - [Aliasy laboratoří](#45-aliasy-laboratoří)
   - [Zálohy](#46-zálohy)
5. [Správce souborů (File Manager)](#5-správce-souborů-file-manager)
   - [Stromový prohlížeč](#51-stromový-prohlížeč)
   - [Operace se soubory a složkami](#52-operace-se-soubory-a-složkami)
   - [Náhled a editor souborů](#53-náhled-a-editor-souborů)
   - [Schránka (Clipboard)](#54-schránka-clipboard)
6. [Skripty](#6-skripty)
   - [Podporované jazyky](#61-podporované-jazyky)
   - [Pracovní adresář a argumenty](#62-pracovní-adresář-a-argumenty)
7. [Workflow](#7-workflow)
   - [Co je workflow](#71-co-je-workflow)
   - [Formát souboru .workflow](#72-formát-souboru-workflow)
   - [Soubor environment.json](#73-soubor-environmentjson)
   - [Spuštění workflow](#74-spuštění-workflow)
   - [Sledování průběhu v reálném čase](#75-sledování-průběhu-v-reálném-čase)
   - [Zastavení workflow](#76-zastavení-workflow)
   - [Cross-lab reference (aliasy)](#77-cross-lab-reference-aliasy)
8. [Výsledky (Results)](#8-výsledky-results)
   - [Struktura výsledků](#81-struktura-výsledků)
   - [Prohlížení výsledků](#82-prohlížení-výsledků)
   - [Publikování (Publish)](#83-publikování-publish)
9. [Debugger](#9-debugger)
   - [Jak funguje debugování](#91-jak-funguje-debugování)
   - [Breakpointy](#92-breakpointy)
   - [Ovládací panel debuggeru](#93-ovládací-panel-debuggeru)
   - [Proměnné a zásobník volání](#94-proměnné-a-zásobník-volání)
   - [Klávesové zkratky](#95-klávesové-zkratky)
10. [SQL Editor](#10-sql-editor)
11. [Nastavení aplikace](#11-nastavení-aplikace)
12. [Často kladené otázky](#12-často-kladené-otázky)

---

## 1. Filozofie projektu

Measure je **webový analytický nástroj**, který sjednocuje celý výzkumný a analytický pracovní postup do jednoho prostředí v prohlížeči. Klíčové principy:

- **Vše na jednom místě** — Správa souborů, psaní skriptů, spouštění analýz, prohlížení výsledků, debugování i SQL dotazy probíhají v jednom okně prohlížeče. Není potřeba přepínat mezi různými nástroji.

- **Organizace do laboratoří** — Každý analytický projekt je izolovaná laboratoř se svými vlastními skripty, výsledky a nastavením. Laboratoře jsou na sobě nezávislé a lze je sdílet.

- **Reprodukovatelnost** — Každé spuštění workflow vytvoří nový číslovaný výsledek. Historie výsledků se uchovává, takže lze zpětně porovnávat výstupy a sledovat vývoj analýzy.

- **Workflow jako sekvence skriptů** — Analytický postup se definuje jako sekvence skriptů v souboru `.workflow`. Jednotlivé kroky se vykonávají postupně, výstup každého kroku je uložen do společné složky výsledku. To umožňuje rozdělit složité analýzy na logické etapy.

- **Multi-jazyková flexibilita** — Skripty mohou být v Pythonu, R, Node.js nebo Shell. V rámci jednoho workflow lze kombinovat různé jazyky.

- **Integrovaný debugger** — Python skripty lze krokovat přímo v prohlížeči s breakpointy, inspekcí proměnných a zásobníkem volání.

- **Sdílení a spolupráce** — Laboratoře lze sdílet s dalšími uživateli. Sdílení umožňuje kolaborativní práci na analytických projektech.

---

## 2. Přehled aplikace

Measure je **single-page aplikace (SPA)** běžící v prohlížeči. Rozhraní je organizováno do záložek (tabů):

### Hlavní záložky

| Záložka | Popis |
|---------|-------|
| **My Labs** | Seznam vlastních laboratoří |
| **Shared Labs** | Laboratoře sdílené jinými uživateli |
| **Otevřené laboratoře** | Dynamické záložky — každá otevřená laboratoř má vlastní tab |
| **Settings** | Nastavení aplikace |

### Záhlaví aplikace

V horní liště se zobrazuje:
- Logo aplikace Measure
- Informace o backendu (server, databáze, verze API)
- Aktuálně přihlášený uživatel a tlačítko pro odhlášení

### Uchování stavu

Všechny záložky zůstávají v paměti i po přepnutí na jinou. Obsah editoru, pozice kurzoru, rozbalené složky i pozice scrollování se zachovávají.

### Standalone režim

Laboratoř lze otevřít v samostatném vyskakovacím okně pomocí URL parametru `?lab=<id>&standalone=1`. To je užitečné při práci na více monitorech. Schránka (clipboard) mezi standalone oknem a hlavním oknem funguje normálně — stejný uživatel = synchronizovaná schránka.

---

## 3. Přihlášení a správa účtu

### Registrace

1. Na přihlašovací stránce klikněte na odkaz pro registraci.
2. Vyplňte jméno, příjmení, email a heslo.
3. Po registraci se můžete ihned přihlásit.

### Přihlášení

1. Zadejte email a heslo.
2. Po úspěšném přihlášení jste přesměrováni do hlavního rozhraní.

### Obnova hesla

1. Na přihlašovací stránce klikněte na „Forgot password" / „Zapomenuté heslo".
2. Zadejte svůj email — na něj přijde odkaz pro nastavení nového hesla.
3. Klikněte na odkaz v emailu a zadejte nové heslo.

---

## 4. Laboratoře (Labs)

### 4.1 Co je laboratoř

Laboratoř je **základní organizační jednotka** v Measure. Představuje jeden analytický projekt. Každá laboratoř obsahuje:

```
laboratoř/
├── scripts/          ← Skripty a workflow soubory (váš zdrojový kód)
├── results/          ← Výsledky spuštění (číslované podsložky)
│   ├── 1/
│   ├── 2/
│   └── ...
├── current_output/   ← Publikované soubory (aktuální výstupy)
└── state/            ← Per-uživatelský stav UI
```

- **scripts/** — Zde žijí vaše skripty. Můžete vytvářet podsložky pro logické členění. Najdete tu Python soubory, workflow definice, podpůrné datové soubory apod.
- **results/** — Každé spuštění workflow vytvoří novou číslovanou podsložku (1, 2, 3…). Uvnitř jsou výstupní soubory, protokoly a metadta.
- **current_output/** — Sem se „publikují" důležité soubory z výsledků. Slouží jako stabilní místo pro aktuální verzi výstupů.
- **state/** — Automaticky spravovaný per-uživatelský stav rozhraní (není třeba editovat ručně).

### 4.2 Vytváření a správa laboratoří

#### Vytvoření nové laboratoře

1. Přejděte na záložku **My Labs**.
2. Klikněte na tlačítko pro vytvoření nové laboratoře.
3. Zadejte název a volitelně popis.
4. Nová laboratoř se vytvoří s prázdnou složkou `scripts/`.

#### Otevření laboratoře

- Dvojklikem na řádek laboratoře v seznamu, nebo kliknutím na tlačítko **Enter**.
- Laboratoř se otevře jako nová záložka v horní liště.

#### Nastavení laboratoře

V záložce **Settings** uvnitř laboratoře lze editovat:

- **Název** — pojmenování laboratoře
- **Popis** — delší textový popis účelu analýzy
- **Krátký název (Alias)** — unikátní zkratka velkými písmeny (např. `CENY`). Slouží pro cross-lab reference v workflow (viz kapitola 7.7).

Dole se zobrazují informace: ID, vlastník, datum vytvoření/aktualizace a velikost laboratoře na disku.

#### Smazání laboratoře

- Pouze vlastník může smazat laboratoř.
- Smazání je nevratné — odstraní se celá složka laboratoře včetně všech skriptů a výsledků.

### 4.3 Sdílení laboratoří

V záložce **Settings** laboratoře se v pravém sloupci zobrazuje seznam všech uživatelů systému. Zaškrtnutím políčka vedle jména uživatele mu udělíte přístup k laboratoři.

Sdílený přístup umožňuje:
- Prohlížet a editovat skripty
- Spouštět workflow
- Prohlížet výsledky
- Pracovat se soubory (upload, download, kopírování)

Sdílený uživatel **nemůže**:
- Smazat laboratoř
- Měnit metadata (název, popis)
- Měnit sdílení

### 4.4 Klonování laboratoří

Jakoukoliv laboratoř (vlastní i sdílenou) lze **klonovat**:

1. V seznamu laboratoří klikněte na tlačítko **Clone** u vybrané laboratoře.
2. Vytvoří se nová laboratoř, jejímž vlastníkem budete vy.
3. Zkopírují se všechny skripty. Výsledky a stav se **nevytvářejí** (začínáte s čistým listem).

Klonování je ideální pro:
- Vytvoření nové analýzy na základě existující šablony
- Experimentování bez rizika poškození originálu
- Převzetí sdílené laboratoře do vlastní správy

### 4.5 Aliasy laboratoří

Každé laboratoři lze přiřadit **alias** — krátký unikátní identifikátor velkými písmeny (např. `CENY`, `POROVNANI`).

Alias slouží pro **cross-lab reference** v workflow souborech. Ve workflow jedné laboratoře můžete odkazovat na skript z jiné laboratoře zápisem `<ALIAS>/cesta/ke/skriptu.py`. Systém automaticky rozliší, že se jedná o skript z jiné laboratoře, a spustí ho.

### 4.6 Zálohy

V záložce **Settings** lze nastavit automatické zálohy:

| Frekvence | Popis |
|-----------|-------|
| Vypnuto | Žádné automatické zálohy |
| Ruční | Pouze na vyžádání tlačítkem |
| Hodinová | Každou hodinu |
| Denní | Jednou denně |
| Týdenní | Jednou týdně |
| Měsíční | Jednou měsíčně |

Tlačítko **Backup now** spustí okamžitou zálohu. Systém automaticky přeskočí duplicitní zálohy (pokud se od poslední zálohy nic nezměnilo).

---

## 5. Správce souborů (File Manager)

Správce souborů se používá na dvou místech: v záložce **Scripts** (pro zdrojové soubory) a v záložce **Results** (pro výstupní soubory). Rozhraní je shodné — dvoupanelová rozložení s prohlížečem vlevo a náhledem/editorem vpravo. Šířku panelů lze upravit **přetažením oddělovače** (splitter) mezi nimi.

### 5.1 Stromový prohlížeč

Levý panel zobrazuje **stromovou strukturu souborů**:

- Složky lze rozbalovat/sbalovat kliknutím na šipku nebo na název složky.
- Soubory jsou řazeny abecedně, soubory před podsložkami.
- Každá složka zobrazuje **počet souborů** uvnitř.
- Ikony souborů se liší podle typu (textový soubor, obrázek, PDF apod.).
- **Změněné soubory** se dočasně zvýrazní žlutým pozadím (na cca 15 sekund po změně).
- **Složka Outputs** (nebo vlastní název z nastavení) je zvýrazněna **purpurově** s ikonou 📦 a značkou **TEMPLATE** — vizuálně odlišuje složku určenou pro šablony výstupů.
- Při najetí myší na soubor/složku se zobrazí **tooltip s celou cestou**.

### 5.2 Operace se soubory a složkami

#### Operace se složkami

| Akce | Popis |
|------|-------|
| 📝 Nový soubor | Vytvoří prázdný soubor v dané složce |
| 📁 Nová složka | Vytvoří podsložku |
| 📋 Kopírovat složku | Zkopíruje celou složku do schránky |
| 📌 Vložit | Vloží obsah schránky do složky |
| ⬆️ Upload | Nahraje soubory ze svého počítače (funguje i drag & drop) |
| 📦 Stáhnout jako ZIP | Stáhne celou složku jako ZIP archiv |
| ✏️ Přejmenovat | Přejmenuje složku |
| 🗑️ Smazat | Odstraní složku a veškerý její obsah |
| 📤 Publish | Zkopíruje složku do `current_output` |

#### Operace se soubory

| Akce | Popis |
|------|-------|
| ↗️ Otevřít v záložce | Otevře soubor jako samostatnou záložku v editoru |
| ✏️ Přejmenovat | Přejmenuje soubor |
| 📋 Kopírovat | Zkopíruje soubor do schránky |
| 📤 Publish | Zkopíruje do `current_output` |
| 🗑️ Smazat | Odstraní soubor |

### 5.3 Náhled a editor souborů

Pravý panel zobrazuje obsah vybraného souboru podle jeho typu:

| Typ souboru | Chování |
|-------------|---------|
| **Textové soubory** (`.py`, `.js`, `.json`, `.txt`, `.sh`, `.r`, `.workflow`, `.yaml`, `.xml`, `.html`, `.css`, `.sql`, `.md`, `.env` aj.) | Otevře se v **Monaco editoru** se zvýrazněním syntaxe |
| **Markdown** (`.md`) | Vykreslí se jako formátovaný HTML s podporou tabulek (GFM) a matematických vzorců (KaTeX) |
| **Obrázky** (`.png`, `.jpg`, `.gif`, `.svg` aj.) | Zobrazí se inline s možností přiblížení (zoom) a posunu (pan) |
| **PDF** (`.pdf`) | Zobrazí se v integrovaném PDF prohlížeči |
| **Binární soubory** | Nabídne se stažení |

#### Monaco editor

Monaco editor (stejný engine jako VS Code) nabízí:
- Zvýraznění syntaxe pro Python, JavaScript, SQL, JSON, Markdown, YAML a další
- Tlačítka **Edit** / **Save** / **Cancel** pro přepínání mezi čtením a editací
- Výběr motivu (Light, Dark, High Contrast)
- Možnost otevření souboru v novém okně
- Indikátor neuložených změn (tečka • u názvu záložky)

#### Automatické ukládání před spuštěním

Všechny neuložené (dirty) soubory se **automaticky uloží** před spuštěním workflow. Nemusíte se bát, že spustíte analýzu se starým kódem.

#### Varování při zavírání

Pokud máte neuložené změny a pokusíte se zavřít záložku laboratoře nebo celý prohlížeč, zobrazí se varovná zpráva.

### 5.4 Schránka (Clipboard)

Schránka pro kopírování souborů a složek je **uložena na serveru** a funguje napříč všemi okny prohlížeče:

- Zkopírujete soubor/složku v jednom okně → můžete ho vložit v jiném (i ve standalone okně).
- Schránka přežije obnovení stránky (refresh).
- Po zkopírování se zobrazí notifikace (toast).
- Schránka se synchronizuje přes BroadcastChannel API a server.

---

## 6. Skripty

### 6.1 Podporované jazyky

| Přípona | Jazyk | Příkaz |
|---------|-------|--------|
| `.py` | Python | Spouštěn přes virtuální prostředí (`labs/.venv/bin/python`) |
| `.js`, `.cjs` | Node.js | `node` |
| `.sh` | Shell | `bash` |
| `.r`, `.R` | R | `Rscript` |

Skripty se spouštějí jako samostatné procesy na serveru. Každý dostane jako argumenty cestu k výstupnímu adresáři výsledku a další kontextové informace.

### 6.3 Sdílená knihovna skriptů (`labs/lib/scripts`)

V adresáři `backend/labs/lib/scripts/` lze ukládat Python moduly, které budou automaticky dostupné všem laboratořím. Systém automaticky přidá tento adresář do `PYTHONPATH` při spouštění workflow.

```python
# Vytvořte sdílený modul: backend/labs/lib/scripts/data_helpers.py
def load_and_validate(path):
    import pandas as pd
    return pd.read_csv(path)

# V jakékoliv laboratoři pak můžete importovat:
from data_helpers import load_and_validate
data = load_and_validate('input.csv')
```

Toto funguje v režimu **Run** i **Debug** a pro všechny Python skripty ve všech laboratořích.

### 6.2 Pracovní adresář a argumenty

Při spuštění skriptu v rámci workflow dostává každý skript:

1. **Argument 1** — absolutní cesta k adresáři výsledku (`results/<číslo>/`), kam skript zapisuje své výstupy
2. **Argument 2** — relativní cesta ke kořenu workflow souboru v rámci `scripts/`
3. **Argument 3** — absolutní cesta ke kořenu `scripts/`

Python skript typicky pracuje takto:

```python
import sys
import os

result_dir = sys.argv[1]      # kam ukládat výstupy
workflow_root = sys.argv[2]    # adresář workflow souboru
scripts_root = sys.argv[3]    # kořen skriptů

# Uložení výstupu do výsledkové složky
output_path = os.path.join(result_dir, "report.csv")
```

Standardní výstup (stdout) se ukládá do `output.log` a chybový výstup (stderr) do `output.err` ve složce výsledku.

---

## 7. Workflow

### 7.1 Co je workflow

Workflow je **sekvence skriptů**, které se vykonávají postupně v definovaném pořadí. Je to základní mechanismus pro spouštění analýz v Measure.

Typický workflow vypadá například takto:

```
1. stáhni_data.py        ← stáhne vstupní CSV
2. zpracuj_data.py       ← vyčistí a transformuje data
3. analyzuj.py           ← provede statistickou analýzu
4. vygeneruj_report.py   ← vytvoří výstupní graf a tabulku
```

Každý krok workflow se provede sekvenčně. Pokud některý selže (nenulový návratový kód), lze nakonfigurovat, zda se workflow zastaví nebo pokračuje dalším krokem.

### 7.2 Formát souboru .workflow

Soubor `.workflow` je **prostý textový soubor** — jeden skript na řádek:

```
fetchCSV.py
computePerimeter.py
computeArea.py
generateReport.py
```

#### Deaktivace kroků

Řádky začínající znakem `#` jsou **zakomentované** — neprovádí se:

```
fetchCSV.py
# computePerimeter.py    ← tento krok se přeskočí
computeArea.py
generateReport.py
```

Toto je užitečné pro dočasné vypnutí části analýzy bez nutnosti mazat řádky.

#### Relativní cesty

Cesty ke skriptům v `.workflow` souboru jsou **relativní ke složce, kde leží workflow soubor**. Pokud je workflow umístěn v `scripts/analysis/main.workflow`, pak odkaz `preprocess.py` znamená `scripts/analysis/preprocess.py`.

### 7.3 Soubor environment.json

Při vytvoření nového spuštění (result) se do výsledkové složky zkopíruje soubor `environment.json` ze složky workflow souboru (pokud existuje). Tento soubor obsahuje:

- Definici workflow (pole skriptů nebo odkaz na `.workflow` soubor)
- Konfigurační parametry pro skripty
- Metadata o spuštění (uživatel, čas, cesty)

Struktura:

```json
{
  "workflow": "myAnalysis.workflow",
  "run": {
    "userId": 1,
    "startedAt": "2026-03-13T10:00:00Z",
    "_workflowRoot": "analysis/",
    "_scriptsRoot": "labs/5/scripts"
  }
}
```

Alternativně lze workflow definovat přímo jako pole:

```json
{
  "workflow": ["fetchCSV.py", "analyze.py", "report.py"]
}
```

### 7.4 Spuštění workflow

Existují dva způsoby spuštění:

#### A) Ze záložky Scripts

1. V prohlížeči souborů najděte soubor `.workflow`.
2. U souboru se zobrazí tlačítko 🛠️ **Debug Workflow**.
3. Po kliknutí se automaticky:
   - Vytvoří nový výsledek (results) s dalším pořadovým číslem
   - Zkopíruje se `environment.json` z adresáře workflow
   - Zkopíruje se obsah podsložky `outputs/` (pokud existuje)
   - Přepne se na záložku **Results** s novým výsledkem

#### B) Ze záložky Results

1. Přejděte na záložku **Results**.
2. Vyberte existující výsledek z rozbalovacího seznamu.
3. Klikněte na:
   - **Run** — spustí workflow bez debuggeru
   - **Debug** — spustí workflow s debuggerem (Python skripty se čekají na připojení debuggeru)

#### Volba „Stop on failure"

Zaškrtávací políčko **Stop on failure** určuje:
- **Zaškrtnuto** (výchozí) — Workflow se zastaví při prvním selhání skriptu.
- **Nezaškrtnuto** — Workflow pokračuje dalším krokem i po chybě.

### 7.5 Sledování průběhu v reálném čase

Po spuštění workflow se zobrazí **panel průběhu (Workflow Progress Pane)**. Tento panel v reálném čase zobrazuje stav každého kroku díky technologii Server-Sent Events (SSE).

#### Stavy kroků

| Ikona | Stav | Popis |
|-------|------|-------|
| ○ | Pending | Čeká na spuštění |
| ● (modrá, pulzuje) | Running | Právě se vykonává |
| ✓ (zelená) | Completed | Úspěšně dokončen |
| ! (červená) | Failed | Skript skončil s chybou |
| ⊘ (šedá) | Skipped | Přeskočen (kvůli předchozí chybě nebo přerušení) |
| ⏳ (oranžová, pulzuje) | Debug-waiting | Čeká na připojení debuggeru |
| ⏸ (červená, bliká) | Debug-stopped | Pozastaven na breakpointu |

#### Panel průběhu zobrazuje

- Celkový stav workflow (Idle / Running / Completed / Failed / Aborted)
- Počitadlo kroků (např. „3/5" nebo „3/5 (1✕)" pokud některý selhal)
- Celkový uplynulý čas
- U každého kroku jeho název, stav a dobu trvání
- Vertikální spojovací čáry mezi kroky pro vizuální přehlednost
- Tenký progress bar zobrazující procento dokončení

Panel lze zavřít tlačítkem — workflow běží dál na pozadí.

### 7.6 Zastavení workflow

Běžící workflow lze kdykoliv zastavit:
- Klikněte na tlačítko **Reset** / **Abort** v záložce Results.
- Aktuálně běžící proces se ukončí (kill).
- Zbývající kroky se označí jako **přeskočené (skipped)**.
- Vyšle se událost `workflow-aborted`.

### 7.7 Cross-lab reference (aliasy)

V `.workflow` souborech lze odkazovat na skripty z **jiných laboratoří** pomocí aliasů:

```
<CENY>/helpers/load_data.py
analyze.py
<POROVNANI>/export/generate_pdf.py
```

Syntaxe: `<ALIAS>/cesta/ke/skriptu`

Alias musí odpovídat krátkému názvu (alias) cílové laboratoře nastavenému v jejím Settings. Toto umožňuje sdílet společné utility skripty napříč laboratořemi bez duplikace kódu.

---

## 8. Výsledky (Results)

### 8.1 Struktura výsledků

Každé spuštění workflow vytvoří **nový výsledek** v číslované podsložce:

```
results/
├── 1/
│   ├── environment.json    ← konfigurační soubor (kopie z workflow adresáře)
│   ├── progress.json       ← stav workflow (stavy kroků, časování)
│   ├── output.log          ← standardní výstup (stdout)
│   ├── output.err          ← chybový výstup (stderr)
│   ├── report.csv          ← výstupní soubory vytvořené skripty
│   ├── chart.png           ← obrázky, grafy
│   └── ...                 ← cokoliv, co skripty vytvoří
├── 2/
│   └── ...
└── 3/
    └── ...
```

- **environment.json** — zachycuje workflow definici a metadata spuštění
- **progress.json** — automaticky aktualizovaný stav workflow (stavy jednotlivých kroků, časy spuštění a dokončení, návratové kódy)
- **output.log** / **output.err** — přímo ze stdout/stderr skriptů
- **Výstupní soubory** — cokoli, co skripty zapíší do výsledkového adresáře (tabulky, grafy, PDF, HTML reporty…)

### 8.2 Prohlížení výsledků

1. Otevřete laboratoř a přejděte na záložku **Results**.
2. V rozbalovacím seznamu nahoře vyberte číslo výsledku.
3. Zobrazí se:
   - Stav workflow (dokončeno, selhalo, běží…)
   - Souborový prohlížeč s výstupními soubory
4. Kliknutím na soubor zobrazíte jeho obsah:
   - Textové soubory v editoru (čtení i editace)
   - Obrázky s možností zoomu
   - PDF v integrovaném prohlížeči
   - CSV a další datové soubory v textovém editoru

### 8.3 Publikování (Publish)

Funkce **Publish** umožňuje zkopírovat vybraný soubor nebo složku z výsledku do adresáře `current_output/` laboratoře.

Účel:
- `current_output/` slouží jako **stabilní výstupní složka** s aktuálními výsledky
- Po každém úspěšném spuštění můžete publikovat nejnovější výstupy
- Ostatní uživatelé nebo systémy mohou odkazovat na `current_output/` bez znalosti čísla výsledku

Jak publikovat:
1. V záložce **Results** vyberte výsledek.
2. U souboru nebo složky klikněte na ikonu 📤 **Publish**.
3. Soubory se zkopírují do `current_output/`.

Obsah `current_output/` lze prohlížet v záložce **Current Output** uvnitř laboratoře.

---

## 9. Debugger

Measure obsahuje integrovaný **DAP debugger** (Debug Adapter Protocol), který umožňuje krokování Python skriptů přímo v prohlížeči.

### 9.1 Jak funguje debugování

1. Spustíte workflow s volbou **Debug**.
2. Python skripty se spouštějí přes `debugpy --wait-for-client` — čekají na připojení debuggeru.
3. Frontend automaticky naváže WebSocket spojení s debug proxy na serveru.
4. Až debugger narazí na breakpoint, workflow se pozastaví a zobrazí se stav.

Debugování funguje **pouze pro Python skripty**. Ostatní jazyky (Node.js, Shell, R) se v debug režimu spouštějí normálně bez krokování.

### 9.2 Breakpointy

- **Nastavení breakpointu**: Klikněte do levého okraje (gutru) editoru vedle čísla řádku. Objeví se červená tečka.
- **Odebrání breakpointu**: Klikněte znovu na červenou tečku.
- Breakpointy se **uchovávají** v souboru `debug.json` v laboratoři — přežijí zavření prohlížeče.
- Při pozastavení na breakpointu se řádek zvýrazní **žlutě** s šipkou v okraji.
- Pokud je pozastaven skript, který nemáte otevřený, jeho záložka v editoru **zabliká** pro upozornění.

### 9.3 Ovládací panel debuggeru

Panel debuggeru lze umístit na pravou stranu, dolů nebo do vyskakovacího okna. Obsahuje:

#### Stavový indikátor

Zobrazuje aktuální stav: Idle, Connecting, Attached, Running, Stopped, Ended.

#### Ovládací tlačítka

| Tlačítko | Klávesa | Funkce |
|----------|---------|--------|
| **Attach** | — | Připojí debugger k čekajícímu procesu |
| **Stop** | — | Odpojí debugger / ukončí session |
| **Continue** | F8 | Pokračování v běhu do dalšího breakpointu |
| **Step Over** | F10 | Provede aktuální řádek, přejde na další |
| **Step In** | F11 | Vstoupí do volané funkce |
| **Step Out** | Shift+F11 | Vystoupí z aktuální funkce |

### 9.4 Proměnné a zásobník volání

#### Call Stack (Zásobník volání)

- Zobrazuje seznam aktivních rámců (frames) s názvem funkce a číslem řádku.
- Kliknutím na rámec se přepne zobrazení proměnných a editor na odpovídající místo v kódu.

#### Variables (Proměnné)

- Zobrazuje lokální proměnné aktuálně vybraného rámce.
- Objekty a seznamy lze rozbalit kliknutím na šipku ▶.
- Proměnné jsou **barevně odlišeny** podle typu:
  - 🟢 Čísla (zelená)
  - 🟠 Řetězce (oranžová)
  - 🔵 Booleany, None (modrá/šedá)
- Typ proměnné se zobrazuje na pravé straně.

#### Output (Výstup)

- V reálném čase zobrazuje stdout (světlé písmo) a stderr (červené písmo) z běžícího skriptu.

### 9.5 Klávesové zkratky

| Klávesa | Akce |
|---------|------|
| F8 | Continue (pokračovat) |
| F9 | Run / Debug (spustit workflow z Results) |
| F10 | Step Over (přejít na další řádek) |
| F11 | Step In (vstoupit do funkce) |
| Shift+F11 | Step Out (vystoupit z funkce) |

---

## 10. SQL Editor

Measure obsahuje integrovaný **SQL editor** pro dotazování databází.

### Otevření SQL editoru

- SQL soubory (`.sql`) se automaticky otevírají v SQL editoru.
- Editor nabízí zvýraznění SQL syntaxe přes Monaco Editor.

### Výběr datového zdroje

V horní liště editoru je rozbalovací seznam datových zdrojů:
- **Default DB** — výchozí MySQL databáze
- Další nakonfigurované zdroje (SQL Server, SQLite apod.)
- Indikátor stavu připojení: Connected / Connecting / Disconnected

### Spuštění dotazu

1. Napište SQL dotaz do editoru.
2. Pro spuštění:
   - Klikněte na tlačítko **▶ Run**
   - Nebo stiskněte **Ctrl+Enter**
3. Pokud máte vybraný (označený) text, spustí se pouze vybraná část. Jinak se spustí celý obsah editoru.

### Zobrazení výsledků

- Výsledky se zobrazují v **tabulce** pod editorem.
- Stránkování a výběr počtu řádků na stránku (50, 100, 250, 500, 1000).
- Kliknutím na záhlaví sloupce lze třídit.
- Chybové zprávy se zobrazují červeně.

### Otevření v novém okně

SQL editor lze otevřít v **samostatném okně** pro pohodlnější práci na větším prostoru.

---

## 11. Nastavení aplikace

V záložce **Settings** (hlavní záložka, nikoliv nastavení laboratoře) lze konfigurovat:

- Jazykové preference aplikace
- Další uživatelské preference dle dostupných voleb

---

## 12. Často kladené otázky

### Jak vytvořím novou analýzu?

1. Vytvořte novou laboratoř (nebo naklonujte existující).
2. Vytvořte skripty ve složce `scripts/`.
3. Vytvořte `.workflow` soubor definující pořadí skriptů.
4. Spusťte workflow ze záložky Scripts nebo Results.

### Jak sdílím laboratoř s kolegou?

V nastavení laboratoře (záložka Settings) zaškrtněte políčko u jména kolegy v seznamu uživatelů.

### Můžu používat knihovny třetích stran v Pythonu?

Ano. Python skripty běží ve virtuálním prostředí (`labs/.venv/`). Potřebné balíčky nainstalujte přes:
```bash
source backend/labs/.venv/bin/activate
pip install <balíček>
```

### Co se stane, když skript selže?

- Pokud je zapnuto „Stop on failure", workflow se zastaví a zbylé kroky se přeskočí.
- Pokud je vypnuto, workflow pokračuje dalším krokem.
- Chybový výstup se uloží do `output.err` ve složce výsledku.
- V panelu průběhu se krok zobrazí červeně s vykřičníkem.

### Jak si prohlédnu starší výsledky?

V záložce Results vyberte z rozbalovacího seznamu starší číslo výsledku. Všechny výsledky se uchovávají, dokud je ručně nesmažete.

### Jak funguje publish / current_output?

Publish zkopíruje vybrané soubory z konkrétního výsledku do složky `current_output/`. Tato složka vždy obsahuje „aktuální verzi" výstupů — vhodné pro sdílení stabilních výsledků.

### Můžu editovat soubory ve výsledcích?

Ano, soubory ve výsledkové složce lze editovat a nahrávat do nich nové soubory. To je užitečné pro přidávání poznámek nebo manuální úpravy výstupů.

### Jak otevřu laboratoř v samostatném okně?

Využijte URL `?lab=<id>&standalone=1`, nebo klikněte na příslušné tlačítko v rozhraní pro otevření v novém okně.

### Jak funguje kopírování souborů mezi záložkami?

Schránka je uložena na serveru a sdílena mezi všemi okny prohlížeče. Zkopírujte soubor v jedné záložce (nebo okně) a vložte v jiné — funguje i mezi hlavním oknem a standalone okny.

---

*Measure — interní projekt*
