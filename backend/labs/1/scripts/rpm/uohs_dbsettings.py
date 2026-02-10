# dbsettings.py
import sys
import json
import mysql.connector

# Jedno místo pro DB konfiguraci
DB_CONFIG = {
    #"host": "81.2.236.167",
    "host": "localhost",
    "user": "oheroot",
    "password": "mysqlUOHS2025",
    #"database": "pricedb",
    "database": "localpricedb",
    "charset": "utf8mb4",
    "autocommit": True
}

def get_connection():
    """Vrátí nové připojení k MySQL."""
    return mysql.connector.connect(**DB_CONFIG)

def load_data_json(json_path, default_values):
    """Načte data.json s defaultními hodnotami."""
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            loaded_data = json.load(f)
        
        # Začneme s loaded_data a doplníme chybějící klíče z default_values
        data = loaded_data.copy()
        for key, default_value in default_values.items():
            if key not in data:
                data[key] = default_value
        
        return data
    except json.JSONDecodeError as e:
        print(f"Chyba: Neplatný JSON v souboru {json_path}: {e}")
        sys.exit(1)
