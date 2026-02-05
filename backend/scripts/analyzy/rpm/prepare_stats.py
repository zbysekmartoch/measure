#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Provede sekvenci SQL dotazů pro přípravu statistik.
SQL dotazy jsou definované přímo v poli SQL_QUERIES.

Závislosti: mysql-connector-python
"""

import os
import sys

import mysql.connector

from uohs_dbsettings import get_connection, load_data_json

# ======= KONFIGURACE =======

# Globální objekt pro data z JSON
data = {}

SQL_QUERIES = []  # globální prázdné pole

def execute_sql_queries():

    """Provede všechny SQL dotazy ze sekvence jeden po druhém."""
    global SQL_QUERIES
    
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        for i, query in enumerate(SQL_QUERIES, 1):
            print(f"Provádím dotaz {i}/{len(SQL_QUERIES)}: {query[:80]}...")
            cursor.execute(query)
            print(f"  → Ovlivněno {cursor.rowcount} řádků")
            
            # Commit po každém dotazu pro zajištění sekvenčního provádění
            conn.commit()
            
    except mysql.connector.Error as e:
        print(f"Chyba při provádění SQL dotazu {i}: {e}")
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


def main():
    global data
    
    # Vyžadujeme povinný parametr work_dir
    if len(sys.argv) != 2:
        print("Chybí parametr <work_dir>")
        sys.exit(1)
    
    work_dir = sys.argv[1]
    json_path = os.path.join(work_dir, "data.json")
    
    # data.json musí existovat
    if not os.path.exists(json_path):
        print(f"Chyba: Soubor {json_path} neexistuje.")
        sys.exit(1)
    
    # Načteme konfiguraci pomocí funkce z dbsettings
    default_values = {}  # Zatím žádné defaultní hodnoty
    data = load_data_json(json_path, default_values)
    # Sekvence SQL dotazů k provedení
    global SQL_QUERIES
    SQL_QUERIES = [
        """DROP TABLE IF EXISTS a_desc1""",
        f""" create table a_desc1 as
            select product.id,product.name,product.brand, sum(price_stat_i1.seller_count) N,
            min(price_stat_i1.seller_count) Nmin,
            max(price_stat_i1.seller_count) Nmax,
            min(price_stat_i1.min_price) Pmin,
            max(price_stat_i1.max_price) Pmax,
            min(price_stat_i1.mode_price) Pmode,
            avg(price_stat_i1.dib) avg_diB
            from price_stat_i1
            join bp on bp.basket_id={data['basketId']} and bp.product_id=price_stat_i1.product_id
            join product on product.id=price_stat_i1.product_id
            where price_stat_i1.date BETWEEN '{data['dateFrom']}' and '{data['dateTo']}'
            group by product.id
        """,
        """DROP TABLE IF EXISTS a_desc2""",
        f"""
        CREATE TABLE a_desc2
            WITH RECURSIVE
            -- 1) seznam produktů v košíku
            bp_products AS (
            SELECT DISTINCT bp.product_id
            FROM bp
            WHERE bp.basket_id = {data['basketId']}
            ),

            -- 2) ceny v období a validní
            prices AS (
            SELECT p.product_id, p.date, p.price
            FROM price p
            JOIN bp_products bpp USING (product_id)
            WHERE p.invalid = 0
                AND p.date BETWEEN '{data['dateFrom']}' and '{data['dateTo']}'
            ),

            -- 3) průměr a počet pozorování
            avg_stats AS (
            SELECT
                product_id,
                COUNT(*)        AS num_prices,
                AVG(price)      AS avg_price
            FROM prices
            GROUP BY product_id
            ),

            -- 4) medián přes okno (AVG z prostředních 1–2 hodnot)
            ordered_prices AS (
            SELECT
                product_id,
                price,
                ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY price) AS rn,
                COUNT(*)    OVER (PARTITION BY product_id)                 AS cnt
            FROM prices
            ),
            median_stats AS (
            SELECT
                product_id,
                CASE
                WHEN cnt % 2 = 1
                    THEN MAX(CASE WHEN rn = (cnt + 1) / 2 THEN price END)
                ELSE
                    AVG(CASE WHEN rn IN (cnt / 2, cnt / 2 + 1) THEN price END)
                END AS median_price
            FROM ordered_prices
            GROUP BY product_id
            ),

            -- 5) modus (nejčastější cena) + její četnost; při shodě ta nižší
            mode_pre AS (
            SELECT
                product_id,
                price,
                COUNT(*) AS c
            FROM prices
            GROUP BY product_id, price
            ),
            mode_ranked AS (
            SELECT
                product_id, price, c,
                RANK() OVER (PARTITION BY product_id ORDER BY c DESC, price ASC) AS rnk
            FROM mode_pre
            ),
            mode_stats AS (
            SELECT product_id, price AS mode_price, c AS mode_count
            FROM mode_ranked
            WHERE rnk = 1
            ),

            -- 6) kalendář dní v období
            date_series AS (
            SELECT DATE('{data['dateFrom']}') AS d
            UNION ALL
            SELECT d + INTERVAL 1 DAY FROM date_series WHERE d < DATE('{data['dateTo']}')
            ),

            -- 7) přítomnost alespoň jedné ceny v daný den
            daily_presence AS (
            SELECT
                bpp.product_id,
                ds.d AS date,
                -- 1 pokud existuje aspoň jedna cena toho dne, jinak 0
                CASE WHEN EXISTS (
                SELECT 1 FROM prices p
                WHERE p.product_id = bpp.product_id AND p.date = ds.d
                ) THEN 1 ELSE 0 END AS has_price
            FROM bp_products bpp
            CROSS JOIN date_series ds
            ),

            -- 8) počet dní bez ceny
            missing_days AS (
            SELECT
                product_id,
                SUM(CASE WHEN has_price = 0 THEN 1 ELSE 0 END) AS days_without_price
            FROM daily_presence
            GROUP BY product_id
            )

            SELECT
            bpp.product_id id,
            #COALESCE(a.num_prices, 0)                              AS num_prices,
            ROUND(a.avg_price, 2)                                  AS Pp,
            ROUND(med.median_price, 2)                             AS Pmed,
            ROUND(mo.mode_price, 2)                                AS Pmode,
            mo.mode_count Nmode,
            md.days_without_price T0
            FROM bp_products bpp
            LEFT JOIN avg_stats    a   USING (product_id)
            LEFT JOIN median_stats med USING (product_id)
            LEFT JOIN mode_stats   mo  USING (product_id)
            LEFT JOIN missing_days md  USING (product_id)
            ORDER BY bpp.product_id;

        """,
        """DROP TABLE IF EXISTS a_desc3""",
        f"""                    
            CREATE TABLE a_desc3 as
            select product.id,
            if(sum(price_stat_i1.dib>1)>0, log(sum(price_stat_i1.dib>1)/count(*))+1,'-' ) determ
            from price_stat_i1
            join bp on bp.basket_id={data['basketId']} and bp.product_id=price_stat_i1.product_id
            join product on product.id=price_stat_i1.product_id
            where price_stat_i1.date BETWEEN '{data['dateFrom']}' and '{data['dateTo']}'
            group by product.id
        """ ,
        """DROP TABLE IF EXISTS a_desc""",
        """          
            CREATE TABLE a_desc AS
            SELECT a_desc1.*, a_desc2.Pp,a_desc2.Pmed,a_desc2.Pmode PmodeAll, a_desc2.Nmode, a_desc2.T0
            , a_desc3.determ
            FROM a_desc1
            JOIN a_desc2 ON a_desc1.id=a_desc2.id
            JOIN a_desc3 ON a_desc1.id=a_desc3.id""",
        """DROP TABLE IF EXISTS b_desc""",
        f"""          
            CREATE TABLE b_desc AS
            select a.date,a.brand,count(distinct a.product_id) Nprod, SUM(a.iB) / COUNT(DISTINCT a.product_id) iB,
            sum(a.seller_count) Nprice
            from (
            SELECT
            s.date,
            sqrt((s.on_par*s.on_par+(min_price/mode_price)*(min_price/mode_price))/2) iB
            , s.product_id, p2.brand,
            s.seller_count,
            sqrt((s.on_par*s.on_par+(min_price/mode_price)*(min_price/mode_price))/2)*s.seller_count wiB #už se wiB k ničemu nepoužívá, ale nedovolil jsem si smazat
            FROM bp b
            JOIN price_stat_i1 s
            ON s.product_id = b.product_id
            LEFT JOIN product p2
            ON p2.id = b.product_id
            WHERE b.basket_id = {data['basketId']}
            ) a
            group by a.date, a.brand"""                 
    ]


    if not SQL_QUERIES:
        print("Žádné SQL dotazy k provedení. Doplňte je do pole SQL_QUERIES.")
        return
    
    print(f"Provádím {len(SQL_QUERIES)} SQL dotazů...")
    execute_sql_queries()
    print("Hotovo.")


if __name__ == "__main__":
    main()