#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import re
import sys
import pandas as pd
import matplotlib.pyplot as plt
from uohs_dbsettings import get_connection, load_data_json  # centrální DB nastavení
import matplotlib.dates as mdates
import matplotlib.ticker as mticker
from PIL import Image
from IPython.display import display
# ====== KONFIGURACE ======

# Globální objekt pro data z JSON
data = {}

# ====== POMOCNÉ ======
def sanitize_filename(s: str) -> str:
    s = re.sub(r"[\\/:*?\"<>|]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def truncate_product_name(name: str, max_length: int = 35) -> str:
    """Zkrátí název produktu na max_length znaků, přidá '...' pokud je delší."""
    if len(name) <= max_length:
        return name
    return name[:max_length] + "..."

# ====== SQL ======
BASE_SQL = """
SELECT
  b.product_id,
  COALESCE(p2.name, b.product_id) AS product_name,
  s.date,
  s.min_price/s.mode_price dB
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
        return pd.DataFrame(columns=["product_id","product_name","date","min_price","mode_price","avg_price"])
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["dB"]  = pd.to_numeric(df["dB"], errors="coerce")
    return df.sort_values(["product_id","date"])

def plot_for_each_product(df: pd.DataFrame, output_dir: str):
    os.makedirs(output_dir, exist_ok=True)
    for (product_id, product_name), grp in df.groupby(["product_id","product_name"], dropna=False):
        if grp.empty:
            continue

        x = grp["date"]
        y_on_par  = grp["dB"]
        n = len(grp)
        
        # Create figure with size
        fig, ax = plt.subplots(figsize=(8/2.54, 10/2.54), constrained_layout=False)
        fig.subplots_adjust(left=0.15, right=0.9, bottom=0.05, top=0.9)
        fig.subplots_adjust(bottom=0.25)
        ax.set_aspect('auto')

        # Grid behind chart
        ax = plt.gca()
        ax.set_axisbelow(True)
        plt.grid(True, linestyle=":", linewidth=0.5, zorder=1)
        
        # Keep only left and bottom spines
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.spines["left"].set_visible(True)
        ax.spines["bottom"].set_visible(True)

        
        ax.plot(x, y_on_par,  label="dA", color="#00469B")

        ax.grid(True, linestyle=":", linewidth=0.5)
        # Format x-axis for dates
        locator = mdates.AutoDateLocator()
        formatter = mdates.AutoDateFormatter(locator)
        ax.xaxis.set_major_locator(locator)
        ax.xaxis.set_major_formatter(formatter)
        plt.setp(ax.get_xticklabels(), rotation=45, ha='right', va='top', fontsize=6.5)
        plt.setp(ax.get_yticklabels(),fontsize=6.5) 
        
        ax.set_ylim(0, 1)
        ax.axhline(0.8, color="#d70c0f", linestyle="--", linewidth=0.5)
        ax.axhline(0.9, color="#d70c0f", linestyle="--", linewidth=0.5) 
        
        # Legend below axes
        ax.legend(
            loc='upper center',
            bbox_to_anchor=(0.5, -0.2),  # closer, inside figure space
            ncol=3,
            frameon=False,
            fontsize=6.5
        )
        
        # Caption below legend using figure coordinates
        fig.text(
            0.5, -0.35,   
            f"{truncate_product_name(product_name)}\nN = {n}, {data['dateFrom']} - {data['dateTo']}",
            ha='center',
            va='bottom',
            fontsize=6.5,
            transform=ax.transAxes            
        )
        
        fname = f"{sanitize_filename(str(product_id))}.png"
        out_path = os.path.join(output_dir, fname)
        plt.savefig(out_path, dpi=300, bbox_inches=None, pad_inches=0)
        #plt.show()
        plt.close(fig)
        print(f"Uloženo: {out_path}")
        img = Image.open(out_path)
        display(img)
        

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
    output_dir = os.path.join(work_dir, "img/cenovy_odstup_b")
    
    print("Načítám data…")
    df = fetch_dataframe()
    if df.empty:
        print("Žádná data k vykreslení.")
        return
    print(f"Načteno {len(df)} řádků pro {df['product_id'].nunique()} produktů.")
    plot_for_each_product(df, output_dir)
    print("Hotovo.")

if __name__ == "__main__":
    main()
