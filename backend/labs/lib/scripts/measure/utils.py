# lab_utils.py
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict


def get_result_dir(argv: list[str] | None = None) -> Path:
    """
    RESULT_DIR is expected as the first CLI argument.
    """
    if argv is None:
        argv = sys.argv

    if len(argv) < 2:
        raise SystemExit("Usage: python fetchCSV.py <RESULT_DIR>")

    return Path(argv[1]).expanduser().resolve()


def get_lab_dir(script_file: str | None = None) -> Path:
    """
    LAB_DIR is the directory where the script lives.
    Pass __file__ from the caller.
    """
    if script_file is None:
        raise ValueError("get_lab_dir requires script_file, pass __file__ from the caller.")
    return Path(script_file).resolve().parent


def load_json(json_path: Path) -> Dict[str, Any]:
    """
    Load JSON from json_path.
    If it doesn't exist or is empty, return {}.
    """
    
    if not json_path.exists():
        return {}

    with json_path.open(mode="r", encoding="utf-8") as f:
        content = f.read().strip()
        if not content:
            return {}
        return json.loads(content)


def save_json(json_path: Path, data: Dict[str, Any]) -> None:
    """
    Save JSON to json_path.
    """
    with json_path.open(mode="w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)