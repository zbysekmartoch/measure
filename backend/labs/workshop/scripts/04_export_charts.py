from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd

from measure.env import RESULT_ROOT, LAB_ROOT #z measure.env si naimportujeme cesty abysme mohli číst a zapisovat soubory na správná místa


INPUT_PATH = Path(LAB_ROOT+"/Data/derived/weather_daily.csv")
OUTPUT_DIR = Path(RESULT_ROOT+"/charts")


def save_current_figure(output_path: Path):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"OK → {output_path}")


# --- načtení dat ---
df = pd.read_csv(INPUT_PATH, parse_dates=["date"])

required_columns = {"date", "city", "t_min", "t_max", "t_avg", "precip_mm"}
missing = required_columns - set(df.columns)
if missing:
    raise ValueError(f"Chybí povinné sloupce: {sorted(missing)}")

# --- odvozené sloupce ---
df["year"] = df["date"].dt.year
df["month"] = df["date"].dt.month
df["month_label"] = df["date"].dt.strftime("%Y-%m")
df["temp_range"] = df["t_max"] - df["t_min"]
df["is_rainy_day"] = df["precip_mm"] > 0

cities = sorted(df["city"].dropna().unique().tolist())

# 1) časová řada průměrné denní teploty
plt.figure(figsize=(12, 5))
for city in cities:
    g = df[df["city"] == city].sort_values("date")
    plt.plot(g["date"], g["t_avg"], label=city)

plt.title("Průměrná denní teplota v čase")
plt.xlabel("Datum")
plt.ylabel("Teplota (°C)")
plt.legend()
plt.grid(True, alpha=0.3)
save_current_figure(OUTPUT_DIR / "temperature_timeseries.png")

# 2) časová řada denních srážek
plt.figure(figsize=(12, 5))
for city in cities:
    g = df[df["city"] == city].sort_values("date")
    plt.plot(g["date"], g["precip_mm"], label=city)

plt.title("Denní srážky v čase")
plt.xlabel("Datum")
plt.ylabel("Srážky (mm)")
plt.legend()
plt.grid(True, alpha=0.3)
save_current_figure(OUTPUT_DIR / "precipitation_timeseries.png")

# 3) měsíční průměrná teplota
monthly_temp = (
    df.groupby(["city", "month_label"], as_index=False)
    .agg(avg_temp=("t_avg", "mean"))
    .sort_values(["month_label", "city"])
)

plt.figure(figsize=(12, 5))
for city in cities:
    g = monthly_temp[monthly_temp["city"] == city]
    plt.plot(g["month_label"], g["avg_temp"], marker="o", label=city)

plt.title("Měsíční průměrná teplota")
plt.xlabel("Měsíc")
plt.ylabel("Teplota (°C)")
plt.xticks(rotation=45)
plt.legend()
plt.grid(True, alpha=0.3)
save_current_figure(OUTPUT_DIR / "monthly_avg_temperature.png")

# 4) měsíční úhrn srážek
monthly_precip = (
    df.groupby(["city", "month_label"], as_index=False)
    .agg(total_precip=("precip_mm", "sum"))
    .sort_values(["month_label", "city"])
)

month_labels = monthly_precip["month_label"].drop_duplicates().tolist()
x = range(len(month_labels))
bar_width = 0.8 / max(len(cities), 1)

plt.figure(figsize=(12, 5))
for i, city in enumerate(cities):
    g = monthly_precip[monthly_precip["city"] == city].set_index("month_label").reindex(month_labels)
    x_shifted = [v + i * bar_width for v in x]
    plt.bar(x_shifted, g["total_precip"].fillna(0), width=bar_width, label=city)

center_positions = [v + bar_width * (len(cities) - 1) / 2 for v in x]
plt.xticks(center_positions, month_labels, rotation=45)
plt.title("Měsíční úhrn srážek")
plt.xlabel("Měsíc")
plt.ylabel("Srážky (mm)")
plt.legend()
plt.grid(True, axis="y", alpha=0.3)
save_current_figure(OUTPUT_DIR / "monthly_precipitation.png")

# 5) histogram průměrných denních teplot
plt.figure(figsize=(10, 5))
for city in cities:
    g = df[df["city"] == city]
    plt.hist(g["t_avg"].dropna(), bins=20, alpha=0.5, label=city)

plt.title("Histogram průměrných denních teplot")
plt.xlabel("Teplota (°C)")
plt.ylabel("Počet dnů")
plt.legend()
plt.grid(True, axis="y", alpha=0.3)
save_current_figure(OUTPUT_DIR / "temperature_histogram.png")

# 6) boxplot průměrných teplot podle města
box_data = []
box_labels = []
for city in cities:
    vals = df.loc[df["city"] == city, "t_avg"].dropna()
    if not vals.empty:
        box_data.append(vals)
        box_labels.append(city)

if box_data:
    plt.figure(figsize=(8, 5))
    plt.boxplot(box_data, tick_labels=box_labels)
    plt.title("Rozdělení průměrných denních teplot podle města")
    plt.xlabel("Město")
    plt.ylabel("Teplota (°C)")
    plt.grid(True, axis="y", alpha=0.3)
    save_current_figure(OUTPUT_DIR / "temperature_boxplot_by_city.png")

# 7) počet deštivých dnů podle města
rainy_days = (
    df.groupby("city", as_index=False)
    .agg(rainy_days=("is_rainy_day", "sum"))
    .sort_values("city")
)

plt.figure(figsize=(8, 5))
plt.bar(rainy_days["city"], rainy_days["rainy_days"])
plt.title("Počet deštivých dnů podle města")
plt.xlabel("Město")
plt.ylabel("Počet dnů")
plt.grid(True, axis="y", alpha=0.3)
save_current_figure(OUTPUT_DIR / "rainy_days_count.png")

# 8) průměrný denní teplotní rozptyl podle města
temp_range_stats = (
    df.groupby("city", as_index=False)
    .agg(avg_temp_range=("temp_range", "mean"))
    .sort_values("city")
)

plt.figure(figsize=(8, 5))
plt.bar(temp_range_stats["city"], temp_range_stats["avg_temp_range"])
plt.title("Průměrný denní teplotní rozptyl podle města")
plt.xlabel("Město")
plt.ylabel("Rozdíl t_max - t_min (°C)")
plt.grid(True, axis="y", alpha=0.3)
save_current_figure(OUTPUT_DIR / "avg_daily_temperature_range.png")