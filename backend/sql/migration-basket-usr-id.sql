-- Migration: Add usr_id column to basket table
-- Date: 2025-11-05
-- Description: Add user ownership to baskets

-- Add usr_id column (0 = shared basket, >0 = user-owned basket)
ALTER TABLE basket 
ADD COLUMN usr_id INT NOT NULL DEFAULT 0 COMMENT 'User ID (0 = shared, >0 = user-owned)';

-- Add index for better query performance
ALTER TABLE basket
ADD INDEX idx_usr_id (usr_id);

-- Optional: Set existing baskets to shared (usr_id = 0)
-- UPDATE basket SET usr_id = 0 WHERE usr_id IS NULL;

-- Show result
SELECT 'Migration completed: usr_id column added to basket table' AS status;
SELECT COUNT(*) AS total_baskets, 
       SUM(CASE WHEN usr_id = 0 THEN 1 ELSE 0 END) AS shared_baskets,
       SUM(CASE WHEN usr_id > 0 THEN 1 ELSE 0 END) AS user_baskets
FROM basket;
