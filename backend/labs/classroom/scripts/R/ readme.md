# Tady je ukázkový kód pro práci s R v postředí Measure

## Pro Measure byla vytvořena R knihovna measure. Obsahuje funkce, které vrací cesty.

```
library(measure)

result_dir <- RESULT_ROOT()
lab_dir <- LAB_ROOT()
  
print(result_dir)
print(lab_dir)

```


## Lze instalovat libovolné balíky přímo z kódu - počítejte s tím, že taková instalace trvá klidně i několik minut

```
if (!require("ggplot2")) {
  install.packages("ggplot2")
  library(ggplot2)
}
```

