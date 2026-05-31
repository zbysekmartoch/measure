"""Simple file-based cache using pickle files with TTL support."""

import os
import pickle
import time
from typing import Any, Optional


_METADATA_TTL = 7 * 24 * 3600   # 7 days
_DATA_TTL = 24 * 3600            # 1 day


class Cache:
    def __init__(self, cache_dir: str = "~/.eurostat_cache", data_ttl_hours: float = 24):
        self._dir = os.path.expanduser(cache_dir)
        os.makedirs(self._dir, exist_ok=True)
        self._data_ttl = int(data_ttl_hours * 3600)

    def _path(self, key: str) -> str:
        safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in key)
        return os.path.join(self._dir, safe + ".pkl")

    def get(self, key: str) -> Optional[Any]:
        path = self._path(key)
        if not os.path.exists(path):
            return None
        try:
            with open(path, "rb") as f:
                expires, value = pickle.load(f)
            if expires is not None and time.time() > expires:
                os.unlink(path)
                return None
            return value
        except Exception:
            return None

    def _set(self, key: str, value: Any, ttl: int) -> None:
        path = self._path(key)
        expires = time.time() + ttl
        with open(path, "wb") as f:
            pickle.dump((expires, value), f, protocol=pickle.HIGHEST_PROTOCOL)

    def set_metadata(self, key: str, value: Any) -> None:
        self._set(key, value, _METADATA_TTL)

    def set_data(self, key: str, value: Any) -> None:
        self._set(key, value, self._data_ttl)

    def clear(self) -> None:
        for fname in os.listdir(self._dir):
            if fname.endswith(".pkl"):
                try:
                    os.unlink(os.path.join(self._dir, fname))
                except OSError:
                    pass

    def close(self) -> None:
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()