#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

if (process.argv.length < 3) {
  console.error('Použití: node addReports.js <cesta>');
  process.exit(1);
}

const dir = process.argv[2];
const filePath = path.join(dir, 'data.json');

if (!fs.existsSync(filePath)) {
  console.error(`Soubor ${filePath} neexistuje.`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

// Zajistí existenci struktur
if (typeof data.report !== 'object' || data.report === null) {
  data.report = {};
}
if (!Array.isArray(data.report.doc)) {
  data.report.doc = [];
}

// Prvky, které chceme přidat
const newDocs = [
  { template: 'template_RPM_index_sladeni.docx', renderTo: 'Index sladění cen produktů.docx' },
];

// Přidá jen pokud už tam nejsou (podle `template`)
for (const doc of newDocs) {
  const exists = data.report.doc.some(d => d.template === doc.template);
  if (!exists) {
    data.report.doc.push(doc);
  }
}

// Uloží zpět
fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
console.log('Soubor upraven:', filePath);
