import json
from pathlib import Path

from measure.env import RESULT_ROOT, LAB_ROOT #z measure.env si naimportujeme cesty abysme mohli číst a zapisovat soubory na správná místa

STATISTICS_PATH = Path(RESULT_ROOT+"/statistics.json")
EXTREMES_PATH = Path(RESULT_ROOT+"/extremes.json")
OUTPUT_PATH = Path(RESULT_ROOT+"/full_statistics.json")


def load_json(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def main():
    statistics = load_json(STATISTICS_PATH)
    extremes = load_json(EXTREMES_PATH)

    city_statistics = statistics.get("city_statistics", [])
    city_extremes = extremes.get("city_extremes", {})

    if not isinstance(city_statistics, list):
        raise ValueError("statistics.json: 'city_statistics' musí být pole.")
    if not isinstance(city_extremes, dict):
        raise ValueError("extremes.json: 'city_extremes' musí být objekt/dictionary.")

    enriched_city_statistics = []

    for item in city_statistics:
        if not isinstance(item, dict):
            continue

        city = item.get("city")
        if not city:
            enriched_city_statistics.append(item)
            continue

        merged_item = dict(item)

        if city in city_extremes:
            merged_item["extremes"] = city_extremes[city]

        enriched_city_statistics.append(merged_item)

    result = dict(statistics)
    result["city_statistics"] = enriched_city_statistics

    # volitelně si můžeš přidat i globální extrémy na top level
    if "global_extremes" in extremes:
        result["global_extremes"] = extremes["global_extremes"]

    # volitelně metadata o zdrojích
    result["merged_from"] = {
        "statistics": str(STATISTICS_PATH),
        "extremes": str(EXTREMES_PATH),
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"OK → uloženo do {OUTPUT_PATH}")


if __name__ == "__main__":
    main()