import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Konfigurace z .env ---
const {
  DB_HOST = '127.0.0.1',
  DB_USER = 'root',
  DB_PASSWORD = '',
  DB_NAME = 'mojedb',
} = process.env;

// --- Načtení pracovního adresáře a data.json ---
const workingDir = process.argv[2];
if (!workingDir) {
  console.error('Chyba: Nebyl předán pracovní adresář jako parametr');
  process.exit(1);
}
// Globální objekt pro data
let data = {};

try {
  const dataPath = path.join(workingDir, 'data.json');
  const dataContent = fs.readFileSync(dataPath, 'utf-8');
  data = JSON.parse(dataContent);
  console.log('Data.json byl úspěšně načten');
} catch (error) {
  console.error('Chyba při načítání data.json:', error.message);
  process.exit(1);
}

// --- Databázové funkce ---

async function fetchProducts() {
    const conn = await mysql.createConnection({
        host: DB_HOST, user: DB_USER, password: DB_PASSWORD, database: DB_NAME,
    });

    const [rows] = await conn.execute(`

    select *
    from a_desc
    
    ORDER BY id
  `);
    await conn.end();
    return rows;
}



async function fetchBrands() {
    const conn = await mysql.createConnection({
        host: DB_HOST, user: DB_USER, password: DB_PASSWORD, database: DB_NAME,
    });

    const [rows] = await conn.execute(`
        SELECT 
            brand,
            MAX(Nprod) AS Nprod, 
            SUM(Nprice) AS Nprice, 
            SUM(wiB)/SUM(Nprice) AS iB 
        FROM (
            SELECT 
                date, 
                brand, 
                Nprod,
                Nprice, 
                iB,
                iB*Nprice AS wiB 
            FROM b_desc
        ) a
        GROUP BY brand
        ORDER BY brand
    `);
    
    await conn.end();
    return rows;
}

async function fetchAdditionalData() {
    
  const conn = await mysql.createConnection({
    host: DB_HOST, user: DB_USER, password: DB_PASSWORD, database: DB_NAME,
  });

  // Zde můžete přidat další dotazy podle potřeby
  const [statisticsRows] = await conn.execute(`
            
        SELECT 
            COUNT(CASE WHEN price.invalid = 0 THEN 1 END) AS priceCount,
            COUNT(DISTINCT bp.product_id) AS productCount,
            COUNT(DISTINCT product.brand) AS brandCount
        FROM bp
        LEFT JOIN price 
            ON price.product_id = bp.product_id
        LEFT JOIN product
            ON product.id = bp.product_id
        WHERE bp.basket_id = ${data.basketId} AND price.date BETWEEN '${data.dateFrom}' AND '${data.dateTo}';
  `);

  await conn.end();
  return statisticsRows[0];
}

// --- Hlavní funkce pro zpracování dat ---
async function processData() {
  try {
    console.log('Načítání dat z databáze...');
    
    // Načti produkty z databáze
    data.products = await fetchProducts();
    
    // Načti brandy z databáze
    data.brands = await fetchBrands();
    
    // Načti dodatečná data
    data.stat = await fetchAdditionalData();
    
    
    data.processedAt =  new Date().toISOString(); 
    
    
  } catch (error) {
    console.error('Chyba při zpracování dat:', error.message);
    throw error;
  }
}

// --- Uložení dat zpět do souboru ---
function saveData() {
  try {
    const dataPath = path.join(workingDir, 'data.json');
    const updatedContent = JSON.stringify(data, null, 2);
    fs.writeFileSync(dataPath, updatedContent, 'utf-8');
    console.log('Data.json byl úspěšně aktualizován');
  } catch (error) {
    console.error('Chyba při ukládání data.json:', error.message);
    throw error;
  }
}

// --- Hlavní spuštění ---
async function main() {
  try {
    console.log('=== prepareOutput.js - Start ===');
    console.log(`Pracovní adresář: ${workingDir}`);
    
    await processData();
    saveData();
    
    console.log('=== prepareOutput.js - Dokončeno ===');
  } catch (error) {
    console.error('Kritická chyba:', error.message);
    process.exit(1);
  }
}

// Spusť hlavní funkci
main();
