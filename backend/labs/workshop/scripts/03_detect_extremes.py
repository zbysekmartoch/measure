import json
from pathlib import Path

import pandas as pd
from measure.env import RESULT_ROOT, LAB_ROOT #z measure.env si naimportujeme cesty abysme mohli číst a zapisovat soubory na správná místa


INPUT_PATH = Path(LAB_ROOT+"/Data/derived/weather_daily.csv")
OUTPUT_PATH = Path(RESULT_ROOT+"/extremes.json")


def r(value, digits=2):
    """Bezpečné zaokrouhlení pro JSON."""
    if pd.isna(value):
        return None
    return round(float(value), digits)


def row_to_day_record(row):
    """Převede jeden řádek DataFrame na stručný záznam dne."""
    return {
        "date": row["date"].strftime("%Y-%m-%d"),
        "city": row["city"],
        "t_min": r(row["t_min"]),
        "t_max": r(row["t_max"]),
        "t_avg": r(row["t_avg"]),
        "precip_mm": r(row["precip_mm"]),
        "temp_range": r(row["temp_range"]),
    }


def find_longest_streak(series_bool):
    """
    Najde nejdelší souvislou sérii True.
    Vrací dict s délkou a indexy začátku/konce.
    """
    best_len = 0
    best_start = None
    best_end = None

    current_len = 0
    current_start = None

    for idx, value in enumerate(series_bool):
        if value:
            if current_len == 0:
                current_start = idx
            current_len += 1

            if current_len > best_len:
                best_len = current_len
                best_start = current_start
                best_end = idx
        else:
            current_len = 0
            current_start = None

    return {
        "length": int(best_len),
        "start_index": best_start,
        "end_index": best_end,
    }


# --- načtení dat ---
df = pd.read_csv(INPUT_PATH, parse_dates=["date"])

required_columns = {"date", "city", "t_min", "t_max", "t_avg", "precip_mm"}
missing = required_columns - set(df.columns)
if missing:
    raise ValueError(f"Chybí povinné sloupce: {sorted(missing)}")

# --- odvozené sloupce ---
df["temp_range"] = df["t_max"] - df["t_min"]
df["is_rainy_day"] = df["precip_mm"] > 0
df["is_tropical_day"] = df["t_max"] >= 30
df["is_frost_day"] = df["t_min"] < 0
df["is_hot_day"] = df["t_avg"] >= 25

# --- globální extrémy ---
global_hottest = df.loc[df["t_max"].idxmax()]
global_coldest = df.loc[df["t_min"].idxmin()]
global_wettest = df.loc[df["precip_mm"].idxmax()]
global_largest_range = df.loc[df["temp_range"].idxmax()]

global_extremes = {
    "hottest_day": row_to_day_record(global_hottest),
    "coldest_day": row_to_day_record(global_coldest),
    "wettest_day": row_to_day_record(global_wettest),
    "largest_temperature_range_day": row_to_day_record(global_largest_range),
}

# --- extrémy po městech ---
city_extremes = {}

for city, g in df.sort_values("date").groupby("city"):
    hottest = g.loc[g["t_max"].idxmax()]
    coldest = g.loc[g["t_min"].idxmin()]
    wettest = g.loc[g["precip_mm"].idxmax()]
    largest_range = g.loc[g["temp_range"].idxmax()]

    rainy_streak = find_longest_streak(g["is_rainy_day"].tolist())
    hot_streak = find_longest_streak(g["is_hot_day"].tolist())

    rainy_streak_record = None
    if rainy_streak["length"] > 0:
        rainy_streak_record = {
            "length_days": rainy_streak["length"],
            "from": g.iloc[rainy_streak["start_index"]]["date"].strftime("%Y-%m-%d"),
            "to": g.iloc[rainy_streak["end_index"]]["date"].strftime("%Y-%m-%d"),
        }

    hot_streak_record = None
    if hot_streak["length"] > 0:
        hot_streak_record = {
            "length_days": hot_streak["length"],
            "from": g.iloc[hot_streak["start_index"]]["date"].strftime("%Y-%m-%d"),
            "to": g.iloc[hot_streak["end_index"]]["date"].strftime("%Y-%m-%d"),
        }

    city_extremes[city] = {
        "hottest_day": row_to_day_record(hottest),
        "coldest_day": row_to_day_record(coldest),
        "wettest_day": row_to_day_record(wettest),
        "largest_temperature_range_day": row_to_day_record(largest_range),
        "counts": {
            "tropical_days": int(g["is_tropical_day"].sum()),
            "frost_days": int(g["is_frost_day"].sum()),
            "rainy_days": int(g["is_rainy_day"].sum()),
        },
        "streaks": {
            "longest_rainy_streak": rainy_streak_record,
            "longest_hot_streak": hot_streak_record,
        },
    }

# --- finální JSON ---
result = {
    "summary": {
        "date_range": {
            "from": df["date"].min().strftime("%Y-%m-%d"),
            "to": df["date"].max().strftime("%Y-%m-%d"),
        },
        "cities": sorted(df["city"].dropna().unique().tolist()),
        "total_rows": int(len(df)),
    },
    "global_extremes": global_extremes,
    "city_extremes": city_extremes,
}

OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
    json.dump(result, f, indent=2, ensure_ascii=False)

print(f"OK → uloženo do {OUTPUT_PATH}")