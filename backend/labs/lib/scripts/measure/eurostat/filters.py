"""Fluent filter builder for Eurostat API queries."""

from __future__ import annotations

from typing import Union


class Filter:
    """Build dimension filters using a fluent interface.

    Example::

        f = Filter().geo("CZ", "DE").coicop("CP00", "CP01").since("2020").until("2024")
        df = client.get_data("prc_hicp_midx", filters=f)
    """

    def __init__(self):
        self._dims: dict[str, list[str]] = {}
        self._since: str | None = None
        self._until: str | None = None
        self._last_n: int | None = None

    def dim(self, name: str, *values: str) -> Filter:
        """Filter by any dimension."""
        self._dims[name] = list(values)
        return self

    def geo(self, *values: str) -> Filter:
        return self.dim("geo", *values)

    def coicop(self, *values: str) -> Filter:
        return self.dim("coicop", *values)

    def unit(self, *values: str) -> Filter:
        return self.dim("unit", *values)

    def freq(self, *values: str) -> Filter:
        return self.dim("freq", *values)

    def since(self, period: str) -> Filter:
        """Lower bound for time period, e.g. '2020' or '2020-01'."""
        self._since = period
        return self

    def until(self, period: str) -> Filter:
        """Upper bound for time period."""
        self._until = period
        return self

    def last_n(self, n: int) -> Filter:
        """Return only the last N time periods."""
        self._last_n = n
        return self

    def to_dict(self) -> dict:
        return dict(self._dims)

    @property
    def since_period(self) -> str | None:
        return self._since

    @property
    def until_period(self) -> str | None:
        return self._until

    @property
    def last_n_periods(self) -> int | None:
        return self._last_n