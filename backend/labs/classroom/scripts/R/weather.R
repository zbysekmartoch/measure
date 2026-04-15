library(measure)

result_dir <- RESULT_ROOT()
workflow_dir <- WORKFLOW_ROOT()
lab_dir <- LAB_ROOT()
  
print(result_dir)
print(workflow_dir)
print(lab_dir)

if (!require("ggplot2")) {
  install.packages("ggplot2")
  library(ggplot2)
}

csv_file <- file.path(lab_dir, "Data", "weather_daily.csv")
print(csv_file)

if (!file.exists(csv_file)) {
  stop(paste("Soubor neexistuje:", csv_file))
}

dir.create(result_dir, recursive = TRUE, showWarnings = FALSE)

df <- read.csv(csv_file, stringsAsFactors = FALSE)

df$date <- as.Date(df$date)

print(head(df))
print(summary(df))

# 1) Průměrná teplota v čase podle města
p1 <- ggplot(df, aes(x = date, y = t_avg, color = city)) +
  geom_line() +
  labs(
    title = "Průměrná denní teplota",
    x = "Datum",
    y = "Teplota (°C)",
    color = "Město"
  )

ggsave(
  filename = file.path(result_dir, "temperature_avg_by_city.png"),
  plot = p1,
  width = 10,
  height = 6,
  dpi = 150
)

# 2) Maximální a minimální teplota pro každé město zvlášť
p2 <- ggplot(df, aes(x = date)) +
  geom_line(aes(y = t_max, color = "Tmax")) +
  geom_line(aes(y = t_min, color = "Tmin")) +
  facet_wrap(~ city, ncol = 1, scales = "free_x") +
  labs(
    title = "Maximální a minimální denní teplota",
    x = "Datum",
    y = "Teplota (°C)",
    color = "Typ"
  )

ggsave(
  filename = file.path(result_dir, "temperature_min_max_by_city.png"),
  plot = p2,
  width = 10,
  height = 8,
  dpi = 150
)

# 3) Denní srážky podle města
p3 <- ggplot(df, aes(x = date, y = precip_mm, fill = city)) +
  geom_col(position = "dodge") +
  labs(
    title = "Denní srážky",
    x = "Datum",
    y = "Srážky (mm)",
    fill = "Město"
  )

ggsave(
  filename = file.path(result_dir, "precipitation_by_city.png"),
  plot = p3,
  width = 10,
  height = 6,
  dpi = 150
)

write.csv(
  df,
  file = file.path(result_dir, "weather_daily_copy.csv"),
  row.names = FALSE
)

print("Hotovo")
print(list.files(result_dir))