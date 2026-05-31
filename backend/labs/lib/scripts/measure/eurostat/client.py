"""High-level EurostatClient facade."""

from __future__ import annotations

import os
from typing import Any, Optional, Union

import pandas as pd

from . import catalog as _catalog
from . import data as _data
from . import dimensions as _dims
from ._http import Session
from .cache import Cache
from .filters import Filter


class EurostatClient:
    """Unified client for the Eurostat REST API.

    Args:
        cache_dir: Directory for disk cache. Defaults to ``~/.eurostat_cache``.
        data_ttl_hours: Cache lifetime for downloaded data (default 24 h). Metadata cached 7 days.
        lang: Response language (``en``, ``fr``, or ``de``).
        timeout: HTTP request timeout in seconds.

    Example::

        from measure.eurostat import EurostatClient, Filter

        with EurostatClient() as client:
            df = client.get_data(
                "prc_hicp_midx",
                filters=Filter().geo("CZ").coicop("CP00").unit("I15"),
                last_n=24,
            )
    """

    def __init__(
        self,
        cache_dir: str = "~/.eurostat_cache",
        data_ttl_hours: float = 24,
        lang: str = "en",
        timeout: int = 120,
    ):
        self._lang = lang
        self._timeout = timeout
        self._cache = Cache(cache_dir=cache_dir, data_ttl_hours=data_ttl_hours)
        self._session = Session()

    # --- Catalog ---

    def get_catalog(self, lang: Optional[str] = None) -> pd.DataFrame:
        """Return the full Eurostat Table of Contents as a DataFrame.

        Columns: code, title, type, last_update, data_start, data_end.
        Cached for 7 days.
        """
        return _catalog.fetch_catalog(self._session, self._cache, lang or self._lang)

    def search_catalog(self, query: str, lang: Optional[str] = None) -> pd.DataFrame:
        """Search the catalog by keyword (case-insensitive, matches code or title)."""
        cat = self.get_catalog(lang=lang)
        return _catalog.search_catalog(query, cat)

    # --- Dimensions ---

    def get_dimensions(self, code: str, lang: Optional[str] = None) -> dict[str, dict[str, str]]:
        """Return all dimension code→label mappings for a dataset."""
        return _dims.get_dimensions(code, self._session, self._cache, lang or self._lang)

    def get_dimension_values(
        self, code: str, dimension: str, lang: Optional[str] = None
    ) -> dict[str, str]:
        """Return code→label mapping for a single dimension of a dataset."""
        return _dims.get_dimension_values(
            code, dimension, self._session, self._cache, lang or self._lang
        )

    # --- Data ---

    def get_data(
        self,
        code: str,
        filters: Optional[Union[dict, Filter]] = None,
        since: Optional[str] = None,
        until: Optional[str] = None,
        last_n: Optional[int] = None,
        lang: Optional[str] = None,
        label: bool = True,
        use_cache: bool = True,
    ) -> pd.DataFrame:
        """Download a dataset as a tidy long-format DataFrame.

        Args:
            code: Eurostat dataset code, e.g. ``"prc_hicp_midx"``.
            filters: Dict ``{dimension: value_or_list}`` or :class:`Filter` instance.
            since: Start period, e.g. ``"2020"`` or ``"2020-01"``.
            until: End period.
            last_n: Return only last *n* time periods.
            lang: Override language (default ``"en"``).
            label: If True, include human-readable labels alongside codes.
            use_cache: Read/write disk cache.

        Returns:
            DataFrame: one column per dimension + ``value`` (+ ``flag`` if present).
        """
        return _data.get_data(
            code, self._session, self._cache,
            filters=filters, since=since, until=until, last_n=last_n,
            lang=lang or self._lang, label=label, use_cache=use_cache,
        )

    def get_data_raw(
        self,
        code: str,
        filters: Optional[Union[dict, Filter]] = None,
        since: Optional[str] = None,
        until: Optional[str] = None,
        last_n: Optional[int] = None,
        lang: Optional[str] = None,
        use_cache: bool = True,
    ) -> dict[str, Any]:
        """Download a dataset and return the raw JSON-stat 2.0 dict."""
        return _data.get_data_raw(
            code, self._session, self._cache,
            filters=filters, since=since, until=until, last_n=last_n,
            lang=lang or self._lang, use_cache=use_cache,
        )

    def save_data(
        self,
        code: str,
        path: str,
        filters: Optional[Union[dict, Filter]] = None,
        since: Optional[str] = None,
        until: Optional[str] = None,
        last_n: Optional[int] = None,
        lang: Optional[str] = None,
        label: bool = True,
        use_cache: bool = True,
    ) -> str:
        """Download a dataset and save it to a CSV file. Returns the absolute path."""
        df = self.get_data(
            code, filters=filters, since=since, until=until,
            last_n=last_n, lang=lang, label=label, use_cache=use_cache,
        )
        path = os.path.abspath(os.path.expanduser(path))
        df.to_csv(path, index=False)
        return path

    # --- Context manager ---

    def close(self) -> None:
        self._session.close()
        self._cache.close()

    def __enter__(self) -> EurostatClient:
        return self

    def __exit__(self, *_) -> None:
        self.close()