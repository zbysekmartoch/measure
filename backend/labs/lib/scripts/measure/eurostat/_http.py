"""Lightweight HTTP helper using only stdlib — replaces requests.Session."""

import gzip
import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class _Response:
    def __init__(self, resp, data: bytes):
        self.status_code: int = resp.status
        self._data = data

    def json(self) -> Any:
        return json.loads(self._data.decode("utf-8"))

    @property
    def text(self) -> str:
        return self._data.decode("utf-8")

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise urllib.error.HTTPError(None, self.status_code, f"HTTP {self.status_code}", {}, None)


def _build_url(url: str, params: dict) -> str:
    parts = []
    for k, v in params.items():
        if isinstance(v, list):
            for item in v:
                parts.append((k, str(item)))
        else:
            parts.append((k, str(v)))
    return f"{url}?{urllib.parse.urlencode(parts)}" if parts else url


class Session:
    """Minimal requests.Session replacement using urllib."""

    _HEADERS = {"Accept-Encoding": "gzip, deflate", "User-Agent": "measure-eurostat/1.0"}

    def get(self, url: str, params: dict | None = None, timeout: int = 60) -> _Response:
        full_url = _build_url(url, params or {})
        req = urllib.request.Request(full_url, headers=self._HEADERS)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                if resp.info().get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return _Response(resp, raw)
        except urllib.error.HTTPError as e:
            # Re-wrap as _Response so callers can check status_code
            raw = e.read() if hasattr(e, "read") else b""
            return _FakeErrorResponse(e.code, raw)

    def close(self) -> None:
        pass

    def __enter__(self) -> "Session":
        return self

    def __exit__(self, *_) -> None:
        self.close()


class _FakeErrorResponse(_Response):
    def __init__(self, status_code: int, data: bytes):
        self.status_code = status_code
        self._data = data

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise urllib.error.HTTPError(None, self.status_code, f"HTTP {self.status_code}", {}, None)