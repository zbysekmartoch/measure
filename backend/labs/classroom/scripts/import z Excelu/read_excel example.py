"""
tento ukázkový skript načte z LAB_ROOT/Data, soubor data.xlsx, který má na prvním listu tabulku. Tu načte a pracuje s ní jako se seznamem objektů (dictionary)
Vypíše na standardní výstup (stdout) - místo print je použita fce pprint, která umí přehlednější výstup do konzole (konzole je v measure přesměrována do output.log)
Také data uloží do JSONu ve složce resultu (RESULT_ROOT)
"""


import pandas as pd
from openpyxl import load_workbook
from pprint import pprint
import json
from measure.env import RESULT_ROOT, LAB_ROOT #z measure.env si naimportujeme cesty abysme mohli číst a zapisovat soubory na správná místa

# otevření souboru data.xlsx ze složky Data ve složce laboratoře
df = pd.read_excel(LAB_ROOT + "/Data/data.xlsx")

rows = df.to_dict(orient="records")
print ("příklad 1 - načtení listu pomocí read_excel a konverze do JSONu\n")

# uložení do JSON
with open(RESULT_ROOT+"/export z excelu.json", "w", encoding="utf-8") as f:
    json.dump(rows, f, ensure_ascii=False, indent=2)

pprint(rows, width=120)  #pprint umí krásný výstup do konzole - ta je v measure ukládaná do output.log a chyby do output.err
