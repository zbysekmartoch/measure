#!/usr/bin/env python3
# export_query_to_csv.py

import os
import sys
import csv
from pathlib import Path
from uohs_dbsettings import get_connection, load_data_json  # <--- tady

# ====== KONSTANTY (uprav si podle potřeby) ======

BASKET_ID = 123  # <-- sem dej hodnotu pro WHERE b.basket_id = %s

SQL = """
select product.id, product.name, product.brand, product.category, price.date, price.price from bp
join product on product.id=bp.product_id
join price on price.product_id=product.id

WHERE bp.basket_id = %s AND price.date BETWEEN %s AND %s
"""

OUT_CSV = "data.csv"

CSV_DELIMITER = ";"          # např. ';' nebo ','
CSV_QUOTECHAR = '"'          # typicky '"'
CSV_QUOTING = csv.QUOTE_NONNUMERIC  # QUOTE_MINIMAL | QUOTE_ALL | QUOTE_NONNUMERIC | QUOTE_NONE
CSV_LINETERMINATOR = "\n"    # na Linuxu '\n'
CSV_ENCODING = "utf-8"       # případně "utf-8-sig" pro Excel

INCLUDE_HEADER = True

# Globální objekt pro data z JSON
data = {}


# ====== IMPLEMENTACE ======

def main():
    global data

    # Vyžadujeme povinný parametr work_dir
    if len(sys.argv) != 2:
        print("Chybí parametr <work_dir>")
        sys.exit(1)

    work_dir = sys.argv[1]

    json_path = os.path.join(work_dir, "data.json")

    if not os.path.exists(json_path):
        print(f"Error: file {json_path} does not exist.")
        sys.exit(1)

    default_values = {}
    data = load_data_json(json_path, default_values)
    OUTPUT_DIR = work_dir

    out_path = Path(OUT_CSV)

    conn = get_connection()
    try:
        cur = conn.cursor(dictionary=True)  # řádky jako dict, snadné pro CSV header
        try:
            cur.execute(SQL, ( data['basketId'],data['dateFrom'], data['dateTo']))
            rows = cur.fetchall()

            fieldnames = list(rows[0].keys()) if rows else [d[0] for d in cur.description]

            with out_path.open("w", newline="", encoding=CSV_ENCODING) as f:
                writer = csv.DictWriter(
                    f,
                    fieldnames=fieldnames,
                    delimiter=CSV_DELIMITER,
                    quotechar=CSV_QUOTECHAR,
                    quoting=CSV_QUOTING,
                    lineterminator=CSV_LINETERMINATOR,
                    extrasaction="ignore",
                )

                if INCLUDE_HEADER:
                    writer.writeheader()

                if rows:
                    writer.writerows(rows)

            print(f"OK: exported {len(rows)} rows into {out_path.resolve()}")
        finally:
            cur.close()
    finally:
        conn.close()

if __name__ == "__main__":
    main()
