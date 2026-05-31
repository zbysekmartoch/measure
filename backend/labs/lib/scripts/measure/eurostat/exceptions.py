class EurostatError(Exception):
    pass


class DatasetNotFoundError(EurostatError):
    pass


class QueryTooLargeError(EurostatError):
    """Raised when the query would return > 500 000 cells (HTTP 413)."""
    pass


class DimensionError(EurostatError):
    pass