"""Fetch data from the Eurostat Statistics API."""

import hashlib
import json
import urllib.error
from typing import Any, Optional, Union

import pandas as pd

from ._http import Session
from .cache import Cache
from .exceptions import DatasetNotFoundError, EurostatError, QueryTooLargeError
from .filters import Filter
from .parsers import parse_jsonstat

_BASE_URL = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data"


def build_query_params(
    filters: Optional[Union[dict, Filter]],
    since: Optional[str],
    until: Optional[str],
    last_n: Optional[int],
    lang: str,
) -> dict:
    params: dict = {"format": "JSON", "lang": lang}

    if isinstance(filters, Filter):
        since = since or filters.since_period
        until = until or filters.until_period
        last_n = last_n or filters.last_n_periods
        dim_filters = filters.to_dict()
    elif filters:
        dim_filters = dict(filters)
    else:
        dim_filters = {}

    for dim, val in dim_filters.items():
        if isinstance(val, (list, tuple)):
            params[dim] = list(val)
        else:
            params[dim] = val

    if since:
        params["sinceTimePeriod"] = since
    if until:
        params["untilTimePeriod"] = until
    if last_n:
        params["lastTimePeriod"] = last_n

    return params


def _cache_key(code: str, params: dict) -> str:
    serialised = json.dumps(params, sort_keys=True)
    h = hashlib.md5(serialised.encode()).hexdigest()[:12]
    return f"data_{code}_{h}"


def fetch_raw(
    code: str,
    params: dict,
    session: Session,
    cache: Cache,
    use_cache: bool = True,
) -> dict[str, Any]:
    key = _cache_key(code, params)
    if use_cache:
        cached = cache.get(key)
        if cached is not None:
            return cached

    resp = session.get(f"{_BASE_URL}/{code}", params=params, timeout=120)

    if resp.status_code == 404:
        raise DatasetNotFoundError(f"Dataset '{code}' not found")
    if resp.status_code == 400:
        raise EurostatError(f"Bad request for dataset '{code}': {resp.text[:300]}")
    if resp.status_code in (413, 416):
        raise QueryTooLargeError(
            f"Query for '{code}' returns too many cells (> 500 000). "
            "Add more filters (geo, coicop, since/until)."
        )
    resp.raise_for_status()

    data = resp.json()
    if use_cache:
        cache.set_data(key, data)
    return data


def get_data(
    code: str,
    session: Session,
    cache: Cache,
    filters: Optional[Union[dict, Filter]] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
    last_n: Optional[int] = None,
    lang: str = "en",
    label: bool = True,
    use_cache: bool = True,
) -> pd.DataFrame:
    params = build_query_params(filters, since, until, last_n, lang)
    raw = fetch_raw(code, params, session, cache, use_cache)
    return parse_jsonstat(raw, label=label)


def get_data_raw(
    code: str,
    session: Session,
    cache: Cache,
    filters: Optional[Union[dict, Filter]] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
    last_n: Optional[int] = None,
    lang: str = "en",
    use_cache: bool = True,
) -> dict[str, Any]:
    params = build_query_params(filters, since, until, last_n, lang)
    return fetch_raw(code, params, session, cache, use_cache)