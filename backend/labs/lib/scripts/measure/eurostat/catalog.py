"""Fetch and search the Eurostat Table of Contents."""

import csv
import io

import pandas as pd

from ._http import Session
from .cache import Cache

_TOC_URL = "https://ec.europa.eu/eurostat/api/dissemination/catalogue/toc/txt"
_CACHE_KEY = "catalog_toc"


def fetch_catalog(session: Session, cache: Cache, lang: str = "en") -> pd.DataFrame:
    cached = cache.get(_CACHE_KEY + "_" + lang)
    if cached is not None:
        return cached

    resp = session.get(_TOC_URL, params={"lang": lang}, timeout=60)
    resp.raise_for_status()
    df = _parse_toc(resp.text)
    cache.set_metadata(_CACHE_KEY + "_" + lang, df)
    return df


def _parse_toc(text: str) -> pd.DataFrame:
    reader = csv.reader(io.StringIO(text), delimiter="\t")
    rows = list(reader)
    if not rows:
        return pd.DataFrame()

    raw_header = [h.strip() for h in rows[0]]
    data_rows = rows[1:]

    _renames = {
        "title": "title",
        "code": "code",
        "type": "type",
        "last update of data": "last_update",
        "last table structure change": "last_structure_change",
        "data start": "data_start",
        "data end": "data_end",
        "values": "values",
    }
    col_names = [_renames.get(h.lower(), h.lower().replace(" ", "_")) for h in raw_header]

    n = len(col_names)
    padded = [r[:n] + [""] * max(0, n - len(r)) for r in data_rows]
    df = pd.DataFrame(padded, columns=col_names)

    for col in df.select_dtypes(include=["object", "string"]).columns:
        df[col] = df[col].str.strip()

    df = df[df["code"].notna() & (df["code"] != "")].reset_index(drop=True)
    return df


def search_catalog(query: str, catalog: pd.DataFrame) -> pd.DataFrame:
    """Case-insensitive search across code and title columns."""
    mask = pd.Series(False, index=catalog.index)
    for col in ["code", "title"]:
        if col in catalog.columns:
            mask |= catalog[col].str.contains(query, case=False, na=False)
    return catalog[mask].reset_index(drop=True)