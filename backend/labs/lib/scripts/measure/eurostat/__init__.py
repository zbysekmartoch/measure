"""Eurostat REST API client — measure/eurostat package.

Usage:
    from measure.eurostat import EurostatClient, Filter

    with EurostatClient() as client:
        df = client.get_data("prc_hicp_midx",
                             filters=Filter().geo("CZ").coicop("CP00").unit("I15"),
                             last_n=24)
"""

from .client import EurostatClient
from .filters import Filter
from .exceptions import EurostatError, DatasetNotFoundError, QueryTooLargeError, DimensionError

__all__ = [
    "EurostatClient",
    "Filter",
    "EurostatError",
    "DatasetNotFoundError",
    "QueryTooLargeError",
    "DimensionError",
]