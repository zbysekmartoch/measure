# načte praha.json a ostrava.json a vytvoří z nich společný csv dataset pro další zpracování

import json
import pandas as pd
from measure.env import RESULT_ROOT, LAB_ROOT #z measure.env si naimportujeme cesty abysme mohli číst a zapisovat soubory na správná místa


def convert(file, city):
    with open(file, "r") as f:
        data = json.load(f)

    df = pd.DataFrame({
        "date": data["daily"]["time"],
        "t_max": data["daily"]["temperature_2m_max"],
        "t_min": data["daily"]["temperature_2m_min"],
        "t_avg": data["daily"]["temperature_2m_mean"],
        "precip_mm": data["daily"]["precipitation_sum"],
    })

    df["city"] = city
    return df

data_path=LAB_ROOT+"/Data/"


ostrava = convert(data_path+"original/ostrava.json", "Ostrava")
praha = convert(data_path+"original/praha.json", "Praha")

df = pd.concat([ostrava, praha])
df.to_csv(data_path+"derived/weather_daily.csv", index=False)