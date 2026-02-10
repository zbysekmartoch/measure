#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import re
import sys
import pandas as pd
import matplotlib.pyplot as plt
from uohs_dbsettings import get_connection, load_data_json  # centrální DB 

# ====== PARAMETRY ======
data = {}
OUTPUT_DIR = "img/scatterplot_sladenost_cenovy_odstup_b"

# ====== POMOCNÉ ======
def sanitize_filename(s: str) -> str:
    s = re.sub(r"[\\/:*?\"<>|]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()

# ====== SQL ======
BASE_SQL = """
SELECT
  b.product_id,
  COALESCE(p2.name, b.product_id) AS product_name,
  s.date,
  s.on_par,
  s.min_price,
  s.mode_price
FROM bp b
JOIN price_stat_i1 s
  ON s.product_id = b.product_id
LEFT JOIN product p2
  ON p2.id = b.product_id
WHERE b.basket_id = %s
"""

def build_sql_and_params():
    sql = BASE_SQL
    params = [data['basketId']]
    
    sql += " AND s.date >= %s"
    params.append(data['dateFrom'])
    sql += " AND s.date <= %s"
    params.append(data['dateTo'])
    sql += " ORDER BY b.product_id, s.date"
    return sql, tuple(params)

def fetch_dataframe():
    sql, params = build_sql_and_params()
    conn = get_connection()
    cur = conn.cursor(dictionary=True)
    cur.execute(sql, params)
    rows = cur.fetchall()
    cur.close()
    conn.close()

    if not rows:
        return pd.DataFrame(columns=["product_id","product_name","date","on_par","min_price","mode_price"])

    df = pd.DataFrame(rows)
    df["date"]       = pd.to_datetime(df["date"], errors="coerce")
    df["on_par"]     = pd.to_numeric(df["on_par"], errors="coerce")
    df["min_price"]  = pd.to_numeric(df["min_price"], errors="coerce")
    df["mode_price"] = pd.to_numeric(df["mode_price"], errors="coerce")

    # vypočítáme podíl min/mode (pokud mode_price > 0)
    df["min_mode_ratio"] = df.apply(
        lambda r: r["min_price"]/r["mode_price"] if (pd.notna(r["min_price"]) and pd.notna(r["mode_price"]) and r["mode_price"] != 0) else None,
        axis=1
    )

    return df

def plot_for_each_product(df: pd.DataFrame):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    for (product_id, product_name), grp in df.groupby(["product_id","product_name"], dropna=False):
        if grp.empty:
            continue

        x = grp["on_par"]
        y = grp["min_mode_ratio"]

        if y.dropna().empty:
            continue

        plt.figure()
        plt.scatter(x, y, alpha=0.7)
        title = f"{product_name}"
        plt.title(title)
        plt.xlabel("podíl sladenosti")
        plt.ylabel("cenový odstup B")
        plt.grid(True, linestyle=":", linewidth=0.5)
        plt.tight_layout()

        fname = f"{sanitize_filename(str(product_id))}.png"
        out_path = os.path.join(OUTPUT_DIR, fname)
        plt.savefig(out_path, dpi=150)
        plt.close()
        print(f"Uloženo: {out_path}")

def main():
    global data
    
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
    print("Načítám data…")
    df = fetch_dataframe()
    if df.empty:
        print("Žádná data k vykreslení.")
        return
    print(f"Načteno {len(df)} řádků pro {df['product_id'].nunique()} produktů.")
    plot_for_each_product(df)
    print("Hotovo.")

if __name__ == "__main__":
    main()
