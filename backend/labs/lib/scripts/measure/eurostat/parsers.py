"""Parse JSON-stat 2.0 responses from the Eurostat Statistics API into DataFrames."""

import itertools
from typing import Any

import pandas as pd


def parse_jsonstat(response: dict[str, Any], label: bool = True) -> pd.DataFrame:
    """Convert a JSON-stat 2.0 dict to a tidy long-format DataFrame."""
    dim_ids: list[str] = response["id"]
    dimensions: dict[str, Any] = response["dimension"]
    values_raw = response.get("value", [])

    if isinstance(values_raw, dict):
        values: dict = {int(k): v for k, v in values_raw.items()}
    else:
        values = {i: v for i, v in enumerate(values_raw)}
    statuses: dict | list = response.get("status", {})

    dim_codes: list[list[str]] = []
    dim_labels: list[list[str]] = []
    for dim_id in dim_ids:
        dim_info = dimensions[dim_id]
        category = dim_info.get("category", {})
        index: dict[str, int] = category.get("index", {})
        cat_labels: dict[str, str] = category.get("label", {})
        ordered_codes = sorted(index, key=lambda c: index[c])
        ordered_labels = [cat_labels.get(c, c) for c in ordered_codes]
        dim_codes.append(ordered_codes)
        dim_labels.append(ordered_labels)

    rows = []
    for i, combo_codes in enumerate(itertools.product(*dim_codes)):
        combo_labels = tuple(
            dim_labels[d][dim_codes[d].index(combo_codes[d])]
            for d in range(len(dim_ids))
        )
        val = values.get(i)
        if isinstance(statuses, dict):
            flag = statuses.get(str(i))
        elif isinstance(statuses, list):
            flag = statuses[i] if i < len(statuses) else None
        else:
            flag = None

        row: dict = {}
        for d, dim_id in enumerate(dim_ids):
            if label:
                row[dim_id] = combo_labels[d]
                row[f"{dim_id}_code"] = combo_codes[d]
            else:
                row[dim_id] = combo_codes[d]
        row["value"] = val
        row["flag"] = flag
        rows.append(row)

    df = pd.DataFrame(rows)
    if df["flag"].isna().all():
        df = df.drop(columns=["flag"])
    return df