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
import math
import statsmodels.api as sm
from PIL import Image
from IPython.display import display
from matplotlib.ticker import MaxNLocator
import json

# ====== KONFIGURACE ======

# Globální objekt pro data z JSON
data = {}


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

def linear_regression(df: pd.DataFrame):
    results = []

    for (product_id, product_name), grp in df.groupby(["product_id", "product_name"], dropna=False):
        if grp.empty or grp["seller_count"].nunique() < 2:
            continue

        y = np.log(grp["iB"].values)
        X = np.log(grp["seller_count"].values)
        X = sm.add_constant(X)

        model = sm.OLS(y, X).fit()

        
        def n(x):
            if x is None:
                return None
            try:
                xf = float(x)
            except (TypeError, ValueError):
                return None
            if math.isnan(xf) or math.isinf(xf):
                return None
            return round(xf, 4)
        #    return None if np.isnan(x) else float(x)
        
                    
        results.append({
            "id": product_id,
            "beta_Np": n(model.params[1]),  
            "beta_SE": n(model.bse[1]),
            "p_value": n(model.pvalues[1]),
            "R_squared": n(model.rsquared),
            "N": len(grp)
        })

    return results
        
        
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
    results = linear_regression(df)

    results_by_id = {r["id"]: r for r in results}

    #  projdi products a přidej reg1
    for product in data["products"]:
        reg = results_by_id.get(product["id"])
        if reg is not None:
            product["reg1"] = reg

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print("Hotovo.")

if __name__ == "__main__":
    main()
