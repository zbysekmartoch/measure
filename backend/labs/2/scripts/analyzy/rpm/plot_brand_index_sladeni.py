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
    date, 
    brand, 
    Nprod, 
    Nprice, 
    iB 
FROM b_desc
"""

def build_sql_and_params():
    sql = BASE_SQL
    params = []
    
    # Přidáme filtry podle data, pokud jsou zadány
    conditions = []
    if 'dateFrom' in data and data['dateFrom']:
        conditions.append("date >= %s")
        params.append(data['dateFrom'])
    if 'dateTo' in data and data['dateTo']:
        conditions.append("date <= %s")
        params.append(data['dateTo'])
    
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    
    sql += " ORDER BY brand, date"
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
        return pd.DataFrame(columns=["date", "brand", "Nprod", "Nprice", "iB"])
    
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["iB"] = pd.to_numeric(df["iB"], errors="coerce")
    df["Nprod"] = pd.to_numeric(df["Nprod"], errors="coerce")
    df["Nprice"] = pd.to_numeric(df["Nprice"], errors="coerce")
    
    return df.sort_values(["brand", "date"])

def plot_brand_index(df: pd.DataFrame, output_path: str):
    """Vytvoří graf s křivkami iB pro každý brand v čase."""
    
    if df.empty:
        print("Žádná data k vykreslení.")
        return
    
    # Vytvoříme větší graf pro lepší čitelnost
    fig, ax = plt.subplots(figsize=(12/2.54, 8/2.54), constrained_layout=False)
    fig.subplots_adjust(left=0.12, right=0.88, bottom=0.15, top=0.92)
    ax.set_aspect('auto')
    
    # Grid za grafy
    ax.set_axisbelow(True)
    ax.grid(True, linestyle=":", linewidth=0.5, zorder=1)
    
    # Zobrazíme pouze levý a spodní rámeček
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_visible(True)
    ax.spines["bottom"].set_visible(True)
    
    # Definujeme barvy pro jednotlivé brandy
    colors = ['#00469B', '#d70c0f', '#008000', '#FF8C00', '#9400D3', '#FF1493', '#00CED1']
    
    # Vykreslíme křivku pro každý brand
    brands = df['brand'].dropna().unique()
    for idx, brand in enumerate(brands):
        brand_data = df[df['brand'] == brand].sort_values('date')
        
        if not brand_data.empty:
            color = colors[idx % len(colors)]
            ax.plot(
                brand_data['date'], 
                brand_data['iB'],
                label=brand if brand else "N/A",
                color=color,
                linewidth=1.0,
                marker='',
                alpha=0.9
            )
    
    # Formátování x-osy pro data
    locator = mdates.AutoDateLocator()
    formatter = mdates.AutoDateFormatter(locator)
    ax.xaxis.set_major_locator(locator)
    ax.xaxis.set_major_formatter(formatter)
    
    # Nastavení os
    plt.setp(ax.get_xticklabels(), rotation=45, ha='right', va='top', fontsize=7)
    plt.setp(ax.get_yticklabels(), fontsize=7)
    
    # Limity y-osy
    ax.set_ylim(0, 1)
    
    # Referenční čáry
    ax.axhline(0.4, color="#d70c0f", linestyle="--", linewidth=0.5, alpha=0.5, zorder=1)
    ax.axhline(0.6, color="#d70c0f", linestyle="--", linewidth=0.5, alpha=0.5, zorder=1)
    
    # Popisky os
    ax.set_xlabel("Datum", fontsize=8)
    ax.set_ylabel("iB (Index sladěnosti)", fontsize=8)
    
    # Legenda
    ax.legend(
        loc='upper left',
        bbox_to_anchor=(1.02, 1),
        ncol=1,
        frameon=True,
        fontsize=6.5,
        title="Brand"
    )
    
    # Titulek s informacemi
    date_range = ""
    if 'dateFrom' in data and 'dateTo' in data:
        date_range = f"\n{data['dateFrom']} - {data['dateTo']}"
    
    plt.title(f"Index sladěnosti podle značek{date_range}", fontsize=9, pad=10)
    
    # Vytvoříme adresář, pokud neexistuje
    output_dir = os.path.dirname(output_path)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    
    # Uložení grafu
    plt.savefig(output_path, dpi=300, bbox_inches='tight', pad_inches=0.1)
    plt.close(fig)
    print(f"Uloženo: {output_path}")

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
    output_path = os.path.join(work_dir, "img/brand_index_sladeni.png")
    
    print("Načítám data…")
    df = fetch_dataframe()
    if df.empty:
        print("Žádná data k vykreslení.")
        return
    
    print(f"Načteno {len(df)} řádků pro {df['brand'].nunique()} brandů.")
    plot_brand_index(df, output_path)
    print("Hotovo.")

if __name__ == "__main__":
    main()
