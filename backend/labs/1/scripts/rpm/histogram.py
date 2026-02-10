#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Vygeneruje histogramy cen pro každý produkt z košíku (basket_id),
za dané období. Titulek = product.name (pokud existuje).

Závislosti: mysql-connector-python, pandas, matplotlib
"""

import os
import re
import sys
from collections import Counter
from statistics import median
from datetime import datetime

import mysql.connector
import pandas as pd
import matplotlib.pyplot as plt

from uohs_dbsettings import get_connection, load_data_json  # <--- tady
from matplotlib.ticker import MaxNLocator, FuncFormatter
import numpy as np
from PIL import Image
from IPython.display import display

# ======= KONFIGURACE =======

# Globální objekt pro data z JSON
data = {}

HIST_BINS = 30        # počet intervalů (sloupců) "auto"

# Zaokrouhlit ceny na 2 desetinná místa (doporučeno, pokud máš FLOAT)
ROUND_TO_CENTS = True

# Výstupní složka (automaticky zahrne období a košík)
#OUTPUT_DIR = "img/histogram"

plt.figure(figsize=(3.15, 3.94))

# ======= POMOCNÉ =======
def sanitize_filename(s: str) -> str:
    s = re.sub(r"[\\/:*?\"<>|]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def truncate_product_name(name: str, max_length: int = 35) -> str:
    """Zkrátí název produktu na max_length znaků, přidá '...' pokud je delší."""
    if len(name) <= max_length:
        return name
    return name[:max_length] + "..."

def round2(x) -> float:
    try:
        return round(float(x), 2)
    except Exception:
        return None


# ======= SQL DOTAZ =======
SQL = """
SELECT
  b.product_id,
  COALESCE(p2.name, b.product_id) AS product_name,
  p.price
FROM bp b
JOIN price p
  ON p.product_id = b.product_id
  AND p.invalid = 0
  AND p.date BETWEEN %s AND %s
LEFT JOIN product p2
  ON p2.id = b.product_id
WHERE b.basket_id = %s
"""


def fetch_dataframe():
    conn = get_connection()
    cur = conn.cursor(dictionary=True)
    
    # Použijeme data z globálního objektu přímo
    cur.execute(SQL, (data['dateFrom'], data['dateTo'], data['basketId']))
    rows = cur.fetchall()
    cur.close()
    conn.close()

    if not rows:
        return pd.DataFrame(columns=["product_id", "product_name", "price"])

    df = pd.DataFrame(rows)
    # ceny jako float a volitelné zaokrouhlení
    df["price"] = pd.to_numeric(df["price"], errors="coerce")
    if ROUND_TO_CENTS:
        df["price"] = df["price"].map(round2)
    return df

def save_histograms(df: pd.DataFrame):
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    for (product_id, product_name), grp in df.groupby(["product_id", "product_name"], dropna=False):
        prices = grp["price"].dropna().to_list()
        if not prices:
            continue

        n = len(prices)

        # Create figure with size
        fig, ax = plt.subplots(figsize=(10/2.54, 8/2.54), constrained_layout=False)
        fig.subplots_adjust(left=0.15, right=0.85, bottom=0.05, top=0.9)
        ax.set_aspect('auto')
        fig.subplots_adjust(bottom=0.25)
        
        
        plt.hist(prices, bins=data['histBins'],  color="#00469B")

        # Grid behind chart
        ax = plt.gca()
        ax.set_axisbelow(True)
        plt.grid(True, linestyle=":", linewidth=0.5, zorder=1)
        
        # Keep only left and bottom spines
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.spines["left"].set_visible(True)
        ax.spines["bottom"].set_visible(True)
        
        formatter = FuncFormatter(lambda x, _: f"{int(x):,}".replace(",", " "))
        plt.gca().xaxis.set_major_formatter(formatter)

        # Custom caption below chart
        caption = f"{truncate_product_name(product_name)}\nN = {n}, {data['dateFrom']} - {data['dateTo']}"
        plt.figtext(0.5,  0.03, caption, ha="center", fontsize=6.5)

        ax = plt.gca()
        
        # Check if all data points are the same
        unique_vals = np.unique(prices)
        if len(unique_vals) == 1:
            ax.set_xticks(unique_vals)  # single tick
        else:
            ax.xaxis.set_major_locator(MaxNLocator(nbins=6))
        
        # Format numbers with space as thousands separator
        ax.xaxis.set_major_formatter(FuncFormatter(lambda x, _: f"{int(x):,}".replace(",", " ")))
        
        # Rotate labels
        plt.setp(ax.get_xticklabels(), rotation=45, ha='right', va='top', fontsize=6.5)
        plt.setp(ax.get_yticklabels(), fontsize=6.5)


        fname = f"{sanitize_filename(str(product_id))}.png"
        out_path = os.path.join(OUTPUT_DIR, fname)
        plt.savefig(out_path, dpi=300, bbox_inches=None, pad_inches=0)
        #plt.show()
        plt.close(fig)
        print(f"Uloženo: {out_path}")
        img = Image.open(out_path)
        display(img)



def main():
    global data, OUTPUT_DIR

    # Vyžadujeme povinný parametr work_dir
    if len(sys.argv) != 2:
        print("Chybí parametr <work_dir>")
        sys.exit(1)
    
    work_dir = sys.argv[1]

    json_path = os.path.join(work_dir, "data.json")
    print(f"Looking for JSON at: {json_path}")

    if not os.path.exists(json_path):
        print(f"Chyba: Soubor {json_path} neexistuje.")
        sys.exit(1)

    default_values = {'histBins': 30}
    data = load_data_json(json_path, default_values)
    OUTPUT_DIR = os.path.join(work_dir, "img/histogram")

    print(f"Načítám data z DB …")
    df = fetch_dataframe()
    if df.empty:
        print("Žádná data pro zadané období/košík.")
        return
    print(f"Načteno {len(df)} řádků pro {df['product_id'].nunique()} produktů.")
    save_histograms(df)
    print("Hotovo.")

if __name__ == "__main__":
    main()
    
