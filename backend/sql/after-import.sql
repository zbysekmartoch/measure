
insert ignore into price(price_src, price, seller, seller_src, product_id, date)
select price price_src,CAST(
        REPLACE(
            REGEXP_REPLACE(price, '[^0-9.,]', ''),
            ',',
            '.'
        )
    AS FLOAT) AS price,
IF(
    LEFT(seller, 5) = 'Logo ',
    SUBSTRING(seller, 6),
    seller
  ) AS seller,
seller seller_src, productid product_id, date date from imp_price
;


replace into product(id, name, brand, category, url, src)
WITH newest AS (
  SELECT p1.*
  FROM imp_product p1
  JOIN (
    SELECT id, MAX(date) AS max_date
    FROM imp_product
    GROUP BY id
  ) p2 ON p1.id = p2.id AND p1.date = p2.max_date
)
SELECT
  n.id,
  COALESCE(n.name, MAX(IF(p.name <> '', p.name, NULL))) AS name,
  COALESCE(n.brand, MAX(IF(p.brand <> '', p.brand, NULL))) AS brand,
  COALESCE(n.category, MAX(IF(p.category <> '', p.category, NULL))) AS category,
  COALESCE(n.url, MAX(IF(p.url <> '', p.url, NULL))) AS url,
  'heureka' src
FROM newest n
LEFT JOIN imp_product p ON p.id = n.id
GROUP BY n.id;



update price set invalid=1 where price<=0
;

drop table if exists price_stat;
create table price_stat as
SELECT
  t.product_id,
  t.date,
  MIN(t.price)                   AS min_price,
  MAX(t.price)                   AS max_price,
  AVG(t.price)                   AS avg_price,
  COUNT(DISTINCT t.seller)       AS seller_count,
  (
    -- modus: bereme tu cenu, která se v rámci daného produktu a data vyskytuje nejčastěji
    SELECT p2.price
    FROM price AS p2
    WHERE p2.product_id = t.product_id
      AND p2.date       = t.date
      AND p2.invalid    = 0
    GROUP BY p2.price
    ORDER BY COUNT(*),p2.price DESC
    LIMIT 1
  )                               AS mode_price
FROM price AS t
WHERE t.invalid = 0
GROUP BY
  t.product_id,
  t.date
ORDER BY
  t.product_id,
  t.date;

alter table price_stat add index(product_id);
alter table price_stat add index(date);

alter table price_stat add index(date,product_id);

drop table if exists price_stat_i1;
create table price_stat_i1 as
select price_stat.*
,sum(price<mode_price)/seller_count under_mode
,sum(price>mode_price)/seller_count over_mode
,sum(price=mode_price)/seller_count on_par
from price_stat
join price on price.date=price_stat.date and price.product_id=price_stat.product_id
group by price_stat.date,price_stat.product_id

;

alter table price_stat_i1 add index(product_id);
alter table price_stat_i1 add index(date);

alter table price_stat_i1 add column `ib` float DEFAULT NULL;
alter table price_stat_i1 add column `dib` float DEFAULT NULL;
alter table price_stat_i1 add column `id` int AUTO_INCREMENT primary key;

update price_stat_i1
set ib=sqrt((on_par*on_par+(min_price/mode_price)*(min_price/mode_price))/2)
#where mode_price>0
;

WITH ranked AS (
  SELECT
    id,                       -- primární klíč řádku (pokud máš jiný než id, nahraď)
    product_id,
    date,
    ib,
    LAG(ib) OVER (PARTITION BY product_id ORDER BY date) AS ib_prev
  FROM price_stat_i1
)
UPDATE price_stat_i1 p
JOIN ranked r ON p.id = r.id
SET p.dib = CASE
              WHEN r.ib_prev IS NULL OR r.ib_prev = 0 THEN NULL
              ELSE r.ib / r.ib_prev
            END;

drop table if exists list_product
;
create table list_product as

    SELECT
        p.id,
        p.name,
        p.brand,
        p.category,
        p.url,
        COUNT(DISTINCT pr.seller) as sellerCount,
        COUNT(pr.id) as priceCount,
        min(pr.date) minDate,
        max(pr.date) maxDate
    FROM product p
    left JOIN price pr ON pr.product_id = p.id AND pr.invalid = 0
    #WHERE (p.category LIKE CONCAT('Heureka.cz', '|%') OR p.category = CONCAT('Heureka.cz', '|', p.name))
    #WHERE (p.category LIKE 'Heureka.cz|%') # OR p.category = CONCAT('Heureka.cz', '|', p.name)
    GROUP BY p.id #, p.name, p.brand, p.category
    ORDER BY p.id
    LIMIT 20000 OFFSET 0
  ;
ALTER TABLE list_product
  ADD INDEX ix_product_category (category);
;
