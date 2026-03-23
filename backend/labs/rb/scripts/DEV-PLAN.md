# DEV-PLAN — Návrh vylepšení pro build.js

## Priorita: Vysoká (bugy a rizika)

### 1. ~~Mrtvý kód za `return` v `getSize()`~~ ✅
**Soubor:** `build.js`, funkce `buildImageModule` → `getSize`  
**Stav:** Vyřešeno.

### 2. ~~Hardcoded testovací kód v Proxy~~ ✅
**Soubor:** `build.js`, funkce `createDeepIntrospectingGetLoggerProxy` → handler `get`  
**Stav:** Vyřešeno.

### 3. ~~Zakomentovaný try-catch v hlavní smyčce~~ ✅
**Stav:** Vyřešeno.

### 4. ~~`gImgParams` se neresetuje mezi dokumenty~~ ✅
**Stav:** Vyřešeno.

### 5. ~~`PRODUCT_IMG_DIR` se nastavuje, ale nepoužívá~~ ✅
**Stav:** Vyřešeno — odstraněno.

---

## Priorita: Střední (kvalita kódu)

### 6. Odstranit globální stav
**Problém:** `data`, `gImgParams`, `IMAGES_DIR` jsou globální proměnné měněné z různých míst. Ztěžuje to testování i čitelnost.  
**Řešení:** Předávat data jako parametry funkcí. `gImgParams` zapouzdřit do closure `buildImageModule()`. Celý pipeline zabalit do třídy nebo modulu s explicitním kontextem.

### 7. Vyčistit zakomentovaný kód
**Problém:** Zakomentovaný kód (import mysql, `fixTagsAndData`, `ISO2CZ`).  
**Řešení:** Odstranit. Historie je v gitu.

### 8. `ALLOWED_TOKENS` se nepoužívá
**Problém:** Konstanta `ALLOWED_TOKENS` je definována, ale nikde se nevyužívá k validaci formátovacích tokenů.  
**Řešení:** Buď implementovat validaci v `formatTemplateDate()` (ověřit, že uživatel v šabloně používá jen povolené tokeny), nebo konstantu odstranit.

### 9. `ISO2CZ()` je mrtvá funkce
**Problém:** Funkce `ISO2CZ` se nikde nevolá — její funkci převzal `formatTemplateDate`.  
**Řešení:** Odstranit.

### 10. ~~Deklarace `var` místo `const`/`let`~~ ✅
**Stav:** Vyřešeno — `IMAGES_DIR` přepsán na `let`.

---

## Priorita: Střední (rozšiřitelnost)

### 11. Rozšířit systém transformací v `customizeValue()`
**Problém:** Momentálně podporuje jen `dateFormat` a detekci obrázků. Šablony mohou potřebovat další transformace (formátování čísel, podmíněný text, pluralizace).  
**Řešení:** Přepsat na registrovatelný pipeline transformací:
```js
const transformers = [
  { match: p => p.dateFormat, apply: (v, p) => formatTemplateDate(v, p) },
  { match: p => p.numberFormat, apply: (v, p) => formatNumber(v, p) },
  // ...
];
```

### 12. Podpora více formátů obrázků
**Problém:** `getImage()` podporuje jen `.png` a `.jpg`.  
**Řešení:** Přidat podporu `.jpeg`, `.svg`, `.webp` (pokud je Docxtemplater podporuje), ideálně přes glob pattern.

### 13. ~~Konfigurovatelnost cesty k šablonám~~ ✅
**Stav:** Vyřešeno — šablony se hledají relativně k `LAB_ROOT`, cesta je nastavitelná v `environment.json`.

---

## Priorita: Nízká (nice-to-have)

### 14. Přidat testy
**Problém:** Projekt nemá žádné testy (`"test": "echo \"Error: no test specified\" && exit 1"`).  
**Řešení:**
- Unit testy pro `normalizeProp()`, `formatTemplateDate()`, `customizeValue()`, `enhanceProducts()`.
- Integrační test: vygenerovat DOCX z testovacích dat a ověřit obsah.
- Testovací framework: Vitest (ESM nativně).

### 15. Přidat validaci `data.json`
**Problém:** Pokud `data.json` má neočekávanou strukturu (chybí `products`, špatný typ), skript spadne s nejasnými chybami.  
**Řešení:** Validace schématu na vstupu (např. Zod nebo JSON Schema). Srozumitelné chybové hlášky.

### 16. Logging
**Problém:** Mix `console.log` a `console.error` bez úrovní, bez struktury.  
**Řešení:** Jednoduchý logger s úrovněmi (info/warn/error), volitelně JSON output pro strojové zpracování.

### 17. Asynchronní čtení souborů
**Problém:** Všechny I/O operace jsou synchronní (`readFileSync`, `existsSync`). U větších reportů s mnoha obrázky to blokuje event loop.  
**Řešení:** Přejít na `fs.promises` (kód je už v async `main()`), případně paralelizovat načítání obrázků.

### 18. Ošetření path traversal
**Problém:** Parametr `path` v tagu obrázku (`{"path":"subdir"}`) se přímo vkládá do cesty souboru bez sanitizace. Šablona pochází od (polo)důvěryhodného zdroje, ale je vhodné cestu validovat.  
**Řešení:** Ověřit, že výsledná cesta nepřesáhne `IMAGES_DIR` (např. `path.resolve` + kontrola prefixu).

---

## Souhrn priorit

| # | Vylepšení | Priorita | Náročnost |
|---|---|---|---|
| 1 | ~~Mrtvý kód v `getSize()`~~ | ✅ Hotovo | — |
| 2 | ~~Testovací kód v Proxy~~ | ✅ Hotovo | — |
| 3 | ~~Odkomentovat try-catch~~ | ✅ Hotovo | — |
| 4 | ~~Reset `gImgParams`~~ | ✅ Hotovo | — |
| 5 | ~~Nepoužitý `PRODUCT_IMG_DIR`~~ | ✅ Hotovo | — |
| 6 | Globální stav | 🟡 Střední | Střední |
| 7 | Zakomentovaný kód | 🟡 Střední | Triviální |
| 8 | Nepoužité `ALLOWED_TOKENS` | 🟡 Střední | Triviální |
| 9 | Mrtvá funkce `ISO2CZ` | 🟡 Střední | Triviální |
| 10 | ~~`var` → `let`/`const`~~ | ✅ Hotovo | — |
| 11 | Pipeline transformací | 🟡 Střední | Střední |
| 12 | Více formátů obrázků | 🟡 Střední | Nízká |
| 13 | ~~Konfigurovatelné cesty šablon~~ | ✅ Hotovo | — |
| 14 | Testy | 🟢 Nízká | Střední |
| 15 | Validace `data.json` | 🟢 Nízká | Střední |
| 16 | Logging | 🟢 Nízká | Nízká |
| 17 | Async I/O | 🟢 Nízká | Střední |
| 18 | Path traversal ochrana | 🟢 Nízká | Nízká |
