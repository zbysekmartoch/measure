import pandas as pd
import json
from pathlib import Path
from measure.env import RESULT_ROOT, LAB_ROOT #z measure.env si naimportujeme cesty abysme mohli číst a zapisovat soubory na správná místa


INPUT_PATH = Path(LAB_ROOT+"/Data/derived/weather_daily.csv")
OUTPUT_PATH = Path(RESULT_ROOT+"/statistics.json")

# --- načtení dat ---
df = pd.read_csv(INPUT_PATH, parse_dates=["date"])

# --- základní odvozené sloupce ---
df["year"] = df["date"].dt.year
df["month"] = df["date"].dt.month
df["temp_range"] = df["t_max"] - df["t_min"]
df["is_rainy_day"] = df["precip_mm"] > 0

# --- funkce pro zaokrouhlení ---
def r(x):
    return round(float(x), 2) if pd.notnull(x) else None

# --- statistiky podle města ---
city_stats = []

for city, g in df.groupby("city"):
    city_stats.append({
        "observations": int(len(g)),
        "city":city,
        "temperature": {
            "avg": r(g["t_avg"].mean()),
            "min": r(g["t_min"].min()),
            "max": r(g["t_max"].max()),
            "median": r(g["t_avg"].median()),
            "std_dev": r(g["t_avg"].std()),
        },

        "precipitation": {
            "total_mm": r(g["precip_mm"].sum()),
            "avg_daily_mm": r(g["precip_mm"].mean()),
            "rainy_days": int(g["is_rainy_day"].sum()),
        },

        "temperature_range": {
            "avg_daily_range": r(g["temp_range"].mean()),
            "max_daily_range": r(g["temp_range"].max()),
        }
    })

# --- měsíční statistiky ---
monthly = (
    df.groupby(["city", "year", "month"])
    .agg(
        avg_temp=("t_avg", "mean"),
        total_precip=("precip_mm", "sum"),
        rainy_days=("is_rainy_day", "sum")
    )
    .reset_index()
)

monthly_stats = []

for _, row in monthly.iterrows():
    monthly_stats.append({
        "city": row["city"],
        "year": int(row["year"]),
        "month": int(row["month"]),
        "avg_temp": r(row["avg_temp"]),
        "total_precip": r(row["total_precip"]),
        "rainy_days": int(row["rainy_days"])
    })

# --- globální info ---
summary = {
    "date_range": {
        "from": df["date"].min().strftime("%Y-%m-%d"),
        "to": df["date"].max().strftime("%Y-%m-%d")
    },
    "cities": list(df["city"].unique()),
    "total_rows": int(len(df))
}

# --- finální struktura ---
result = {
    "summary": summary,
    "city_statistics": city_stats,
    "monthly_statistics": monthly_stats
}

# --- uložení ---
OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
    json.dump(result, f, indent=2, ensure_ascii=False)

print(f"OK → uloženo do {OUTPUT_PATH}")