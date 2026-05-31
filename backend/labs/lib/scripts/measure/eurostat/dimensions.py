"""Fetch dimension metadata for a dataset."""

from typing import Any

from ._http import Session
from .cache import Cache
from .exceptions import DatasetNotFoundError, DimensionError

_BASE_URL = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data"


def get_dimensions(
    code: str,
    session: Session,
    cache: Cache,
    lang: str = "en",
) -> dict[str, dict[str, str]]:
    """Return all dimensions and their code→label mappings for a dataset."""
    cache_key = f"dims_{code}_{lang}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    resp = session.get(
        f"{_BASE_URL}/{code}",
        params={"format": "JSON", "lang": lang, "lastTimePeriod": 1},
        timeout=60,
    )
    if resp.status_code == 404:
        raise DatasetNotFoundError(f"Dataset '{code}' not found")
    resp.raise_for_status()

    data = resp.json()
    result = _extract_dimensions(data)
    cache.set_metadata(cache_key, result)
    return result


def _extract_dimensions(response: dict[str, Any]) -> dict[str, dict[str, str]]:
    dim_ids: list[str] = response.get("id", [])
    dimensions: dict[str, Any] = response.get("dimension", {})
    result: dict[str, dict[str, str]] = {}
    for dim_id in dim_ids:
        dim_info = dimensions.get(dim_id, {})
        category = dim_info.get("category", {})
        labels: dict[str, str] = category.get("label", {})
        result[dim_id] = labels
    return result


def get_dimension_values(
    code: str,
    dimension: str,
    session: Session,
    cache: Cache,
    lang: str = "en",
) -> dict[str, str]:
    """Return the code→label mapping for a single dimension."""
    dims = get_dimensions(code, session, cache, lang)
    if dimension not in dims:
        available = ", ".join(dims.keys())
        raise DimensionError(
            f"Dimension '{dimension}' not found in dataset '{code}'. "
            f"Available dimensions: {available}"
        )
    return dims[dimension]