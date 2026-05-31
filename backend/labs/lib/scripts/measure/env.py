"""
measure.env

Modul pro předání základních cest a sdíleného runtime kontextu do analytických skriptů.

Očekávané spuštění skriptu:

    python script.py <resultDir> <runtimeEnvPath> <scriptsRoot>

Typické použití ve skriptu:

    from measure.env import RESULT_ROOT, LAB_ROOT, runtimeContext, saveRuntimeContext

    print(RESULT_ROOT)
    print(LAB_ROOT)

    # Čtení hodnot z runtime kontextu
    dataset = runtimeContext.get("dataset")
    year = runtimeContext.get("year", 2026)

    print(dataset)
    print(year)

    # Bezpečné čtení vnořených hodnot
    db_host = runtimeContext.get("db", {}).get("host", "localhost")
    db_name = runtimeContext.get("db", {}).get("database")

    print(db_host)
    print(db_name)

    # Úprava jednoduchých hodnot
    runtimeContext["dataset"] = "hicp"
    runtimeContext["year"] = 2026

    # Úprava vnořených hodnot
    runtimeContext.setdefault("db", {})
    runtimeContext["db"]["host"] = "localhost"
    runtimeContext["db"]["database"] = "localpricedb"

    # Uložení zpět do JSON souboru
    saveRuntimeContext()

    # Příklad předávání informací mezi skripty
    runtimeContext.setdefault("hicpImport", {})
    runtimeContext["hicpImport"]["lastPeriod"] = "2026-04"
    runtimeContext["hicpImport"]["rowCount"] = 15234
    runtimeContext["hicpImport"]["status"] = "done"

    saveRuntimeContext()

    # Uložení úplně nového objektu místo aktuálního runtimeContext
    saveRuntimeContext({
        "dataset": "hicp",
        "year": 2026,
        "status": "done"
    })

Poznámka:

    runtimeContext je běžný Python dict.

    Hodnoty se čtou například takto:

        runtimeContext["dataset"]

    nebo bezpečněji:

        runtimeContext.get("dataset")

    Vnořené hodnoty:

        runtimeContext["db"]["host"]

    nebo bezpečněji:

        runtimeContext.get("db", {}).get("host", "localhost")

    Pro úpravy je vhodné měnit obsah runtimeContext, ne přepisovat proměnnou:

        runtimeContext["year"] = 2026
        saveRuntimeContext()

    Méně vhodné:

        runtimeContext = {"year": 2026}
        saveRuntimeContext()

    Pokud je potřeba uložit úplně nový objekt, použij:

        saveRuntimeContext({"year": 2026})
"""

import sys
import json
from pathlib import Path


if len(sys.argv) != 4:
    print("Pouziti: script.py <resultDir> <runtimeEnvPath> <scriptsRoot>")
    sys.exit(1)


RESULT_ROOT = sys.argv[1]
RUNTIME_ENV_PATH = sys.argv[2]
LAB_ROOT = sys.argv[3]
# Backward-compatible alias for older scripts.
WORKFLOW_ROOT = RUNTIME_ENV_PATH


def _load_runtime_context(path):
    """
    Načte runtime kontext z JSON souboru.

    Pokud cesta není vyplněná nebo soubor neexistuje,
    vrátí prázdný dict.
    """
    if not path:
        return {}

    path = Path(path)

    if not path.exists():
        return {}

    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    if data is None:
        return {}

    if not isinstance(data, dict):
        raise ValueError(
            f"Runtime context musí být JSON objekt, ale v souboru je: {type(data).__name__}"
        )

    return data


runtimeContext = _load_runtime_context(RUNTIME_ENV_PATH)


def saveRuntimeContext(context=None):
    """
    Uloží runtime kontext zpět do JSON souboru.

    Pokud není předán parametr context, uloží se globální runtimeContext.

    Příklad:

        from measure.env import runtimeContext, saveRuntimeContext

        runtimeContext["status"] = "done"
        saveRuntimeContext()

    Nebo:

        saveRuntimeContext({
            "status": "done",
            "rows": 12345
        })
    """
    if context is None:
        context = runtimeContext

    if not isinstance(context, dict):
        raise ValueError(
            f"Runtime context musí být dict, ale předáno bylo: {type(context).__name__}"
        )

    path = Path(RUNTIME_ENV_PATH)

    if not str(path):
        raise ValueError("RUNTIME_ENV_PATH není nastaven.")

    path.parent.mkdir(parents=True, exist_ok=True)

    tmp_path = path.with_suffix(path.suffix + ".tmp")

    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(context, f, ensure_ascii=False, indent=2)
        f.write("\n")

    tmp_path.replace(path)

    return path