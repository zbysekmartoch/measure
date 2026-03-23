"""
Jednotný styl grafů pro Matplotlib/Seaborn.

Hlavní funkce:
- apply_style(theme="light", context="notebook", palette=None)
- use_palette(name="default", n=None)
- set_figure(dpi=120, size=(6.3, 2.8))
- subplots(...)
- legend(...)
- grid(...)
- savefig(path, ...)
- savefig_both(path_without_ext, ...)

Poznámky:
- Nejprve se nastaví Seaborn, potom vlastní rcParams, aby se nic nepřepisovalo zpět.
- Pokud není Seaborn nainstalovaný, modul funguje dál jen s Matplotlib.
- Výchozí font je CzechiaSans; pokud není dostupný, Matplotlib použije fallback.
"""

from __future__ import annotations

from pathlib import Path
from cycler import cycler
import matplotlib as mpl
import matplotlib.pyplot as plt

try:
    import seaborn as sns
    _HAS_SNS = True
except Exception:
    _HAS_SNS = False


PALETTES = {
    "default": [
        "#D70C0F", "#00469B", "#F8C2B9", "#9EC8E9",
        "#006538", "#B7E5B7", "#FFAA00", "#FFCF8C",
        "#462E73", "#B1A3CB", "#00998F", "#A1E5E0",
    ],
    "colorblind": [
        "#D70C0F", "#00469B", "#006538",
        "#FFAA00", "#462E73", "#00998F",
    ],
    "dark": [
        "#F8C2B9", "#9EC8E9", "#B7E5B7",
        "#FFCF8C", "#B1A3CB", "#A1E5E0",
    ],
    "reds": ["#680526", "#D70C0F", "#F8C2B9", "#888B95", "#D9DAE4"],
    "blues": ["#0C1838", "#00469B", "#9EC8E9", "#888B95", "#D9DAE4"],
}


def _build_rc(theme: str) -> dict:
    is_dark = theme == "dark"

    fg = "#FFFFFF" if is_dark else "#888B95"
    edge = "#FFFFFF" if is_dark else "#A7A9B4"
    grid_color = "#FFFFFF" if is_dark else "#A7A9B4"

    return {
        "font.family": "CzechiaSans",
        "font.size": 10,
        "axes.titlesize": 10,
        "axes.labelsize": 9,
        "legend.fontsize": 9,
        "xtick.labelsize": 9,
        "ytick.labelsize": 9,

        "figure.facecolor": "none",
        "axes.facecolor": "none",
        "savefig.facecolor": "none",

        "text.color": fg,
        "axes.edgecolor": edge,
        "axes.labelcolor": fg,
        "axes.titlecolor": fg,
        "xtick.color": fg,
        "ytick.color": fg,

        "axes.linewidth": 0.5,

        "grid.color": grid_color,
        "grid.linestyle": "-",
        "grid.linewidth": 0.5,
        "grid.alpha": 1.0,

        "legend.frameon": False,
        "legend.framealpha": 0.0,
        "legend.facecolor": "none",
        "legend.edgecolor": "none",

        "figure.dpi": 150,
        "savefig.dpi": 150,
        "savefig.bbox": "tight",
        "savefig.pad_inches": 0.05,
    }


def apply_style(theme: str = "light", context: str = "notebook", palette: str | None = None) -> None:
    """
    Nastaví globální styl grafů.

    Parameters
    ----------
    theme : "light" | "dark"
    context : seaborn context, např. "paper", "notebook", "talk", "poster"
    palette : název palety; když není zadáno, použije se "default" nebo "dark"
    """
    theme = theme.lower().strip()
    if theme not in {"light", "dark"}:
        raise ValueError("theme musí být 'light' nebo 'dark'")

    rc = _build_rc(theme)

    if _HAS_SNS:
        sns.set_theme(
            context=context,
            style="whitegrid" if theme == "light" else "darkgrid",
            font=rc["font.family"],
        )

    # Vlastní rcParams až po seabornu, aby se nic nepřepsalo zpět
    mpl.rcParams.update(rc)

    use_palette(palette or ("default" if theme == "light" else "dark"))


def use_palette(name: str = "default", n: int | None = None) -> list[str]:
    """
    Nastaví cyklus barev pro osy a vrátí použitý seznam barev.
    """
    if name not in PALETTES:
        raise KeyError(f"Neznámá paleta '{name}'. Dostupné: {list(PALETTES)}")

    colors = list(PALETTES[name])

    if n is not None:
        if n <= 0:
            raise ValueError("n musí být kladné celé číslo")
        colors = [colors[i % len(colors)] for i in range(n)]

    mpl.rcParams["axes.prop_cycle"] = cycler(color=colors)
    return colors


def set_figure(dpi: int = 120, size: tuple[float, float] = (6.3, 2.8)) -> None:
    """
    Nastaví výchozí DPI a velikost všech nově vytvářených figur.
    """
    mpl.rcParams["figure.dpi"] = dpi
    mpl.rcParams["savefig.dpi"] = max(dpi, 150)
    mpl.rcParams["figure.figsize"] = size


def subplots(*args, grid_on: bool = False, grid_kwargs: dict | None = None, **kwargs):
    """
    Wrapper nad plt.subplots().
    Volitelně zapne grid na všech vrácených osách.

    Příklad:
        fig, ax = subplots(figsize=(6, 3), grid_on=True)
    """
    fig, ax = plt.subplots(*args, **kwargs)

    if grid_on:
        grid_kwargs = grid_kwargs or {}
        if hasattr(ax, "flat"):
            for a in ax.flat:
                a.grid(True, **grid_kwargs)
        else:
            ax.grid(True, **grid_kwargs)

    return fig, ax


def legend(loc: str = "best", ax=None, frameon: bool | None = None, **kwargs):
    """
    Pohodlné volání legendy na zadané nebo aktuální ose.
    """
    ax = ax or plt.gca()

    if frameon is None:
        frameon = bool(mpl.rcParams.get("legend.frameon", False))

    defaults = {
        "frameon": frameon,
        "facecolor": mpl.rcParams.get("legend.facecolor", "none"),
        "edgecolor": mpl.rcParams.get("legend.edgecolor", "none"),
        "framealpha": mpl.rcParams.get("legend.framealpha", 0.0),
    }
    defaults.update(kwargs)

    return ax.legend(loc=loc, **defaults)


def grid(which: str = "major", axis: str = "both", enable: bool = True, ax=None, **kwargs) -> None:
    """
    Zapne nebo vypne mřížku na zadané nebo aktuální ose.
    """
    ax = ax or plt.gca()

    params = {
        "alpha": mpl.rcParams.get("grid.alpha", 1.0),
        "linewidth": mpl.rcParams.get("grid.linewidth", 0.5),
        "linestyle": mpl.rcParams.get("grid.linestyle", "-"),
        "color": mpl.rcParams.get("grid.color", "#A7A9B4"),
    }
    params.update(kwargs)

    ax.grid(enable, which=which, axis=axis, **params)


def savefig(path: str | Path, transparent: bool = True, create_dirs: bool = True, close: bool = False, **kwargs) -> Path:
    """
    Uloží aktuální figuru na zadanou cestu.

    Parameters
    ----------
    path : cílová cesta včetně přípony
    transparent : předá se do plt.savefig()
    create_dirs : vytvoří chybějící složky
    close : po uložení zavře aktuální figuru
    """
    path = Path(path)

    if create_dirs:
        path.parent.mkdir(parents=True, exist_ok=True)

    defaults = {
        "bbox_inches": mpl.rcParams.get("savefig.bbox", "tight"),
        "pad_inches": mpl.rcParams.get("savefig.pad_inches", 0.05),
        "dpi": mpl.rcParams.get("savefig.dpi", 150),
        "transparent": transparent,
    }
    defaults.update(kwargs)

    plt.savefig(path, **defaults)

    if close:
        plt.close()

    return path


def savefig_both(path_without_ext: str | Path, transparent: bool = True, create_dirs: bool = True, close: bool = False, **kwargs) -> tuple[Path, Path]:
    """
    Uloží aktuální figuru jako PNG i PDF.

    Příklad:
        savefig_both("outputs/graf_trzeb")
    """
    base = Path(path_without_ext)
    png_path = base.with_suffix(".png")
    pdf_path = base.with_suffix(".pdf")

    savefig(png_path, transparent=transparent, create_dirs=create_dirs, close=False, **kwargs)
    savefig(pdf_path, transparent=transparent, create_dirs=create_dirs, close=close, **kwargs)

    return png_path, pdf_path


def finalize(
    title: str | None = None,
    xlabel: str | None = None,
    ylabel: str | None = None,
    *,
    ax=None,
    legend_on: bool = False,
    legend_loc: str = "best",
    grid_on: bool = True,
) -> None:
    """
    Rychlé dokončení běžného grafu.
    """
    ax = ax or plt.gca()

    if title is not None:
        ax.set_title(title)
    if xlabel is not None:
        ax.set_xlabel(xlabel)
    if ylabel is not None:
        ax.set_ylabel(ylabel)

    if grid_on:
        grid(ax=ax)

    if legend_on:
        legend(ax=ax, loc=legend_loc)


__all__ = [
    "PALETTES",
    "apply_style",
    "use_palette",
    "set_figure",
    "subplots",
    "legend",
    "grid",
    "savefig",
    "savefig_both",
    "finalize",
]