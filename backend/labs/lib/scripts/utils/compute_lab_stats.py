from pathlib import Path
from measure.env import LAB_ROOT, runtimeContext, saveRuntimeContext


EXT_MAP = {
    ".py": "py",
    ".js": "js",
    ".cjs": "js",
    ".R": "R",
    ".r": "R",
    ".sh": "sh",
}

IGNORE_DIRS = {
    "node_modules",
    "venv",
}


def count_lines(path: Path) -> int:
    """
    Prostý počet řádků v souboru.
    Počítá i prázdné řádky a komentáře.
    """
    with path.open("r", encoding="utf-8", errors="ignore") as f:
        return sum(1 for _ in f)


def empty_stats():
    return {
        "LOC": {"total": 0},
        "files": {"total": 0},
    }


def is_ignored_relative_path(rel_path: Path) -> bool:
    """
    Ignoruje soubory i složky:
    - začínající tečkou: .git, .venv, .cache, ...
    - začínající podtržítkem: _archive, __pycache__, ...
    - explicitně uvedené v IGNORE_DIRS
    """
    for part in rel_path.parts:
        if part.startswith(".") or part.startswith("_"):
            return True

        if part in IGNORE_DIRS:
            return True

    return False


def add_file_to_stats(path: Path, stats: dict):
    if not path.is_file():
        return

    lang = EXT_MAP.get(path.suffix)

    # bereme pouze přípony uvedené v EXT_MAP
    if lang is None:
        return

    loc = count_lines(path)

    if lang not in stats["LOC"]:
        stats["LOC"][lang] = 0
        stats["files"][lang] = 0

    stats["LOC"][lang] += loc
    stats["LOC"]["total"] += loc

    stats["files"][lang] += 1
    stats["files"]["total"] += 1


def compute_workflow_stats() -> dict:
    stats = empty_stats()
    lab_root = Path(LAB_ROOT)

    workflow = runtimeContext.get("run", {}).get("workflow", [])

    for filename in workflow:
        if filename.startswith("<"):
            continue

        rel_path = Path(filename)

        if is_ignored_relative_path(rel_path):
            continue

        path = lab_root / rel_path
        add_file_to_stats(path, stats)

    return stats


def compute_lab_stats() -> dict:
    stats = empty_stats()
    lab_root = Path(LAB_ROOT)

    for path in lab_root.rglob("*"):
        rel_path = path.relative_to(lab_root)

        if is_ignored_relative_path(rel_path):
            continue

        add_file_to_stats(path, stats)

    return stats


#runtimeContext["workflow"] = compute_workflow_stats()
runtimeContext["lab"] = compute_lab_stats()

saveRuntimeContext()

#print("workflow:", runtimeContext["workflow"])
print("lab:", runtimeContext["lab"])