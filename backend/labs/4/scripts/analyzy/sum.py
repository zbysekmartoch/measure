from uohs_dbsettings import load_data_json  # centrální DB nastavení
import os
#import re
import sys
import json



def main():
    global data
    print("start")
    # Vyžadujeme povinný parametr work_dir
    if len(sys.argv) != 2:
        print("Chybí parametr <work_dir>")
        sys.exit(1) 

    work_dir = sys.argv[1]

    json_path = os.path.join(work_dir, "data.json")
    print(f"Looking for JSON at: {json_path}")

    # data.json musí existovat
    if not os.path.exists(json_path):
        print(f"Chyba: Soubor {json_path} neexistuje.")
        sys.exit(1)

    # Načteme konfiguraci z data.json (bez fallback hodnot)
    data = load_data_json(json_path, {})

    # vezmeme a a b (default 0 pokud by chyběly)
    a = data.get("a", 0)
    b = data.get("b", 0)

    # spočítáme součet
    data["a_plus_b"] = a + b

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print("Hotovo.")

main()