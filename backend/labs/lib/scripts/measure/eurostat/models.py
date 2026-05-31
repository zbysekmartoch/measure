from dataclasses import dataclass, field
from typing import Optional


@dataclass
class CatalogEntry:
    code: str
    title: str
    type: str
    last_update: Optional[str] = None
    data_start: Optional[str] = None
    data_end: Optional[str] = None


@dataclass
class Dimension:
    name: str
    label: str
    values: dict = field(default_factory=dict)  # code → label