# Práce s XLSX soubory v Pythonu

## 1. `pandas.read_excel()` - práce s tabulkou

Používá se, když chceš data jako tabulku pro analýzu.

``` python
import pandas as pd

df = pd.read_excel("CENY.xlsx", sheet_name="DATA")
```

Výsledek je **DataFrame**.

### Výhody

-   velmi pohodlná práce s daty
-   ideální pro analýzu

### Nevýhody

-   načítá většinou celý list
-   menší kontrola nad jednotlivými buňkami

------------------------------------------------------------------------

## 2. `openpyxl.load_workbook()` -- práce s Excelem jako dokumentem

Používá se, když chceš pracovat s konkrétními buňkami nebo strukturou
Excelu.

``` python
from openpyxl import load_workbook

wb = load_workbook("CENY.xlsx", data_only=True)
ws = wb["DATA"]

value = ws["B10"].value
```

### Výhody

-   přístup k jednotlivým buňkám
-   můžeš číst i zapisovat
-   přístup ke stylům, listům, vzorcům

### Nevýhody

-   méně pohodlné pro analýzu dat

------------------------------------------------------------------------

## Shrnutí

| metoda         |     knihovna  | použití |
-----------------|---------------|----------|
| read_excel()      | pandas     | analýza tabulkových dat |
| load_workbook()   | openpyxl   | práce s buňkami a strukturou Excelu |
------------------------------------------------------------------------

## Poznámka

Interně **pandas** stejně používá **openpyxl** (pro .xlsx), takže openpyxl je vlastně základní engine.
