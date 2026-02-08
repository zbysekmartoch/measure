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
from sklearn.linear_model import LinearRegression
import numpy as np
import statsmodels.api as sm
from PIL import Image
from IPython.display import display
from matplotlib.ticker import MaxNLocator

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
  sqrt((s.on_par*s.on_par+(min_price/mode_price)*(min_price/mode_price))/2) iB,
  seller_count
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
    df["iB"]  = pd.to_numeric(df["iB"], errors="coerce")
    df["seller_count"]  = pd.to_numeric(df["seller_count"], errors="coerce")
    
    return df.sort_values(["product_id","date"])

def plot_for_each_product(df: pd.DataFrame, output_dir: str):
    os.makedirs(output_dir, exist_ok=True)
    
    for (product_id, product_name), grp in df.groupby(["product_id","product_name"], dropna=False):
        if grp.empty:
            continue

        
        # Define dependent and independent variables
        y_dep = grp["iB"].values                  # dependent: iB
        X_indep = grp["seller_count"].values      # independent: Nmaxt
        X = sm.add_constant(X_indep)              # add intercept column

        # Fit OLS model
        model = sm.OLS(y_dep, X).fit()

        # Print regression results
        print(f"Product: {product_name} (ID: {product_id})")
        if len(model.params) > 1:
            print(f"  Intercept (const): {model.params[0]:.4f}  (SE = {model.bse[0]:.4f})")
            print(f"  Beta (slope):      {model.params[1]:.4f}  (SE = {model.bse[1]:.4f})")
        else:
            print(f"  Only intercept could be estimated (dB has no variation).")
        print(f"  R²: {model.rsquared:.4f}")
        print("-" * 40)
        
        n = len(grp)
        
        # Create figure
        fig, ax = plt.subplots(figsize=(10/2.54, 8/2.54), constrained_layout=False)
        fig.subplots_adjust(left=0.15, right=0.85, bottom=0.05, top=0.9)
        ax.set_aspect('auto')
        fig.subplots_adjust(bottom=0.35)  
     
        # Grid behind chart
        ax.set_axisbelow(True)
        plt.grid(True, linestyle=":", linewidth=0.5, zorder=1)
        
        # Keep only left and bottom spines
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.spines["left"].set_visible(True)
        ax.spines["bottom"].set_visible(True)        
        
        # Scatter
        ax.scatter(X_indep, y_dep, color="#00469B", s=20, alpha=0.4, 
                   edgecolors='none', label="_nolegend_")
        
        # Regression line (only if slope exists)
        caption_note = ""
        if len(model.params) > 1:
            x_range = np.linspace(0, max(X_indep), 100)
            X_pred = sm.add_constant(x_range)
            y_pred = model.predict(X_pred)
            ax.plot(x_range, y_pred, color="#d70c0f", linewidth=0.5, linestyle="-",
                    label=f"OLS: iBt = {model.params[0]:.2f} + {model.params[1]:.2f} Nmaxt")  
        else:
            # Add a dummy invisible line so it appears in legend
            ax.plot([], [], color="none", label="OLS not estimated")
            caption_note = ""
        
        # R-squared
        r2 = model.rsquared if len(model.params) > 1 else np.nan
                
        # Diagonal line
        ax.plot([max(grp["seller_count"]), 0], [0, 1], color='#d70c0f', linewidth=0.5, linestyle='--', label='Diagonal')
        
        ax.set_xlabel("Nmaxt", fontsize=7)
        ax.set_ylabel("iBt", fontsize=7, rotation=0)
        ax.set_yticks([0, 0.2, 0.4, 0.6, 0.8, 1.0])
        ax.xaxis.set_major_locator(MaxNLocator(integer=True))
        plt.setp(ax.get_xticklabels(), fontsize=6.5)
        plt.setp(ax.get_yticklabels(), fontsize=6.5)
        ax.set_ylim(0, 1)
        ax.set_xlim(left=0)

        # Legend below axes
        ax.legend(
            loc='upper center',
            bbox_to_anchor=(0.5, -0.2),
            ncol=1,
            frameon=False,
            fontsize=6.5
        )

        # Caption below
        if len(model.params) > 1:
            r2_text = f"{model.rsquared:.4f}"
            pval = model.pvalues[1]
            if pval < 0.001:
                pval_text = "< 0.001"
            else:
                pval_text = f"= {pval:.4f}"
        
            stats_line = f"R² = {r2_text}, p-val(dB) {pval_text}\n"
            text_y = -0.45  # default position when regression is estimated
        else:
            stats_line = ""  # skip R² and p
            text_y = -0.45    # move text up when there’s no regression line
        
        fig.text(
            0.5, 0.02,
            f"{product_name}\n{stats_line}N = {n}, "
            f"{data['dateFrom']} - {data['dateTo']}{caption_note}",
            ha='center', va='bottom', fontsize=6.5
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
    output_dir = os.path.join(work_dir, "img/scatterplot_iP_Np")
    
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
