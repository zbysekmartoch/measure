#!/usr/bin/env python3
from measure.env import RESULT_ROOT
import measure.jvs as ps
import os
import numpy as np
import matplotlib.pyplot as plt

ps.apply_style()

# nastavení stylu
ps.apply_style("light")
ps.set_figure()

# data
x = np.linspace(0, 2*np.pi, 200)

# graf
fig, ax = ps.subplots()

ax.plot(x, np.sin(x), label="sin(x)", linewidth=0.8)
ax.plot(x, np.cos(x), label="cos(x)", linewidth=0.8, linestyle="--")

ps.finalize(
    title="Ukázkový graf",
    xlabel="x",
    ylabel="y",
    ax=ax,
    legend_on=True,
    grid_on=True,
)

# výstupní cesta
out_base = os.path.join(RESULT_ROOT, "jvs_example_graph")

# uloží PNG + PDF
ps.savefig_both(out_base)

# zavře obrázek (důležité pro skripty běžící na serveru)
plt.close(fig)
