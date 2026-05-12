# FORMATING.md

Tento dokument popisuje, jak funguje formátování hodnot v reportech generovaných skriptem "build2.js".

## 1) Kde se formát nastaví

Format settings jsou uložené v samostatném JSON souboru.
Název tohoto souboru se uvede v "environment.json" v sekci "report.doc" pod klíčem "format".

Volitelně lze zapnout i "ignoreFormatErrors":

- "false" (výchozí): při chybě formátování se hodnota nahradí textem "[FORMAT_ERROR ...]".
- "true": hodnota zůstane neformátovaná a chyba se vypíše do stderr ("[FORMAT] ...").

Volitelně lze nastavit i "globals" jako objekt globálních proměnných pro konkrétní dokument:

- pokud je při renderu požadována property, která existuje v "globals", vrací se hodnota z "globals"
- tato hodnota má prioritu před daty (tj. přepíše stejně pojmenovanou property v datech)

Příklad:

```json
{
  "report": {
    "doc": [
      {
        "template": "templates/regression-report.docx",
        "renderTo": "reports/ekonometrická-zpráva.docx",
        "data": "econometrics_report_data.json",
        "format": "format-settings.json",
        "ignoreFormatErrors": false,
        "globals": {
          "reportTitle": "Ekonometrický report 2026",
          "semester": "LS 2025/2026"
        }
      }
    ]
  }
}
```

Poznámky k cestě:

- "format" je relativní cesta.
- Ve výchozím stavu se hledá relativně k "LAB_ROOT".
- Pokud je v configu dokumentu "formatInResult: true", hledá se relativně k "RESULT_ROOT".
- Pokud soubor v primární lokaci není, zkusí se i druhá root složka.

## 2) Struktura format settings JSON

Soubor má dvě hlavní části:

- "formatStyles": pojmenované reusable styly.
- "format": pole pravidel, která se aplikují podle cesty ("path").

Minimální kostra:

```json
{
  "formatStyles": {
    "coef3": {
      "number": {
        "minDecimals": 3,
        "maxDecimals": 3,
        "decimalSeparator": ",",
        "thousandSeparator": " "
      }
    }
  },
  "format": [
    {
      "path": "models.ols.coefficients.inflation.estimate",
      "use": "coef3"
    }
  ]
}
```

## 3) Jak se vybírá pravidlo (path matching)

Každé pravidlo ve "format[]" musí obsahovat "path".
Podporované patterny:

- "a.b.c": přesná cesta.
- "*": jeden libovolný segment.
- "**": libovolný počet segmentů.

Příklady:

- "regressions.*.metrics.r2" matchne "regressions.0.metrics.r2" i "regressions.15.metrics.r2".
- "regressions.**.pValue" matchne "regressions.0.pValue" i "regressions.panelA.2.pValue".

Neplatné je například "stu*ents.grade" (hvězdička může být jen celý segment "*" nebo "**").

## 4) Priorita a skládání formátu

Finální formát pro konkrétní hodnotu se skládá takto:

1. vestavěné defaulty
2. styly z "formatStyles" uvedené v "use"
3. inline hodnoty v pravidle
4. lokální override z tagu v DOCX (nejvyšší priorita)

Důležité:

- Pokud pravidel matchne víc, aplikují se v pořadí v poli "format[]".
- Pozdější pravidlo přepisuje dřívější.
- Pole se mergují nahrazením (ne po položkách).

## 5) Number format: možnosti

Konfigurace je v "number" objektu.
Podporované "mode":

- "number" (výchozí)
- "percent"
- "currency"
- "scientific"
- "star" (significance stars pro p-value)

Klíče:

- "mode": viz výše.
- "minDecimals": minimum desetinných míst (celé číslo >= 0).
- "maxDecimals": maximum desetinných míst (celé číslo >= 0).
- "decimalSeparator": oddělovač desetin (např. "," nebo ".").
- "thousandSeparator": oddělovač tisíců (např. mezera nebo ",").
- "useGrouping": "true/false".
- "prefix": text před číslem.
- "suffix": text za číslem.
- "nullText": text pro "null"/"undefined".
- "nanText": text pro "NaN".
- "infinityText": text pro "Infinity"/"-Infinity".
- "multiplier": používá se pro "percent" (výchozí 100).

Specificky pro mode "star":

- "***" pokud hodnota je >= 0 a < 0.01
- "**" pokud hodnota je >= 0 a < 0.05
- "*" pokud hodnota je >= 0 a < 0.1
- jinak prázdný řetězec

Validace:

- "minDecimals <= maxDecimals"
- obě hodnoty jsou celá čísla >= 0

Příklad (percent):

```json
{
  "path": "models.ols.metrics.r2_adjusted",
  "number": {
    "mode": "percent",
    "minDecimals": 1,
    "maxDecimals": 1,
    "suffix": " %"
  }
}
```

Příklad (significance stars):

```json
{
  "path": "regressions.*.coefficients.*.pValue",
  "number": {
    "mode": "star"
  }
}
```

## 6) Date format: možnosti

Konfigurace je v "date" objektu.
Používá se Luxon "toFormat(...)".

Klíče:

- "pattern" (alternativně "dateFormat"): formát pattern.
- "locale": locale, např. "cs".
- "zone": timezone, např. "Europe/Prague".
- "nullText": text pro "null"/"undefined".

Poznámka:

- Vstupní řetězec může být SQL formát i ISO datetime (např. "2026-05-11T16:47:31.344Z").

Příklad:

```json
{
  "path": "regressions.ols.meta.estimatedAt",
  "date": {
    "pattern": "dd. MM. yyyy",
    "locale": "cs",
    "zone": "Europe/Prague"
  }
}
```

## 7) "use" stylu v pravidle

"use" může být:

- string (jeden styl)
- pole stringů (více stylů)

Příklad:

```json
{
  "path": "models.ols.metrics.aic",
  "use": ["coef3", "highlightAic"],
  "number": {
    "prefix": "~ "
  }
}
```

Pokud styl neexistuje v "formatStyles", zpracuje se to podle "ignoreFormatErrors":

- false: do renderu se vloží "[FORMAT_ERROR ...]"
- true: hodnota zůstane původní a chyba jde do stderr

## 8) Lokální override v DOCX tagu

Skript umí lokální override formátu přímo v tagu.
Tyto overrides mají nejvyšší prioritu.

Podporované lokální klíče:

- "format" (objekt ve stejném schématu jako globální format)
- "use" (string nebo pole stringů; styl(y) z formatStyles)
- "number" (objekt)
- "date" (objekt)

Příklady tagů:

```text
[[regressions.ols.coefficients.inflation.estimate {"number":{"minDecimals":4,"maxDecimals":4}}]]
```

```text
[[regressions.ols.meta.estimatedAt {"date":{"pattern":"dd. MM. yyyy"}}]]
```

```text
[[models.ols.metrics.r2_adjusted {"format":{"number":{"mode":"percent","maxDecimals":2}}}]]
```

```text
[[renderedAt {"use":"czDateTime"}]]
```

```text
[[regressions.ols.coefficients.inflation.pValue {"number":{"mode":"star"}}]]
```

## 9) Kompletní příklad format settings

```json
{
  "formatStyles": {
    "coef3": {
      "number": {
        "minDecimals": 3,
        "maxDecimals": 3,
        "decimalSeparator": ",",
        "thousandSeparator": " ",
        "useGrouping": true
      }
    },
    "pValue": {
      "number": {
        "minDecimals": 4,
        "maxDecimals": 4,
        "decimalSeparator": ",",
        "thousandSeparator": " ",
        "nullText": "n/a"
      }
    },
    "reportDate": {
      "date": {
        "pattern": "dd. MM. yyyy",
        "locale": "cs",
        "zone": "Europe/Prague"
      }
    }
  },
  "format": [
    {
      "path": "regressions.*.meta.estimatedAt",
      "use": "reportDate"
    },
    {
      "path": "regressions.*.coefficients.*.estimate",
      "use": "coef3"
    },
    {
      "path": "regressions.*.coefficients.*.stdError",
      "use": "coef3"
    },
    {
      "path": "regressions.*.coefficients.*.pValue",
      "use": "pValue"
    },
    {
      "path": "regressions.*.coefficients.*.pValue",
      "number": {
        "mode": "star"
      }
    },
    {
      "path": "models.ols.metrics.r2_adjusted",
      "number": {
        "mode": "percent",
        "minDecimals": 1,
        "maxDecimals": 1,
        "suffix": " %"
      }
    },
    {
      "path": "**.lag",
      "number": {
        "minDecimals": 0,
        "maxDecimals": 0
      }
    }
  ]
}
```

## 10) Co se děje při chybě

Při chybách formátování (např. neexistující styl v "use", nevalidní pravidlo, neznámý "mode") se skript neukončí.

Výchozí chování ("ignoreFormatErrors: false"):

- hodnota se nahradí textem "[FORMAT_ERROR path=...] ..."
- uživatel vidí problém přímo v renderu dokumentu

Chování s "ignoreFormatErrors: true":

- hodnota zůstane neformátovaná
- chyba se vypíše do chybového výstupu (stderr) s prefixem "[FORMAT]"

Fatální chyby mimo formátování (např. chybějící template, chyba při renderu docxtemplateru) se řeší standardně jako dosud.

## 11) Vzorový soubor pro vědeckou práci

Ve stejné složce je připravený vzorový soubor:

- "format-settings-example.json"

Obsahuje styly vhodné pro statistickou/vědeckou práci:

- desetinné formáty pro koeficienty a metriky
- significance stars (mode "star")
- datumy anglicky, ISO i česky (krátké, dlouhé, dlouhé s časem)
