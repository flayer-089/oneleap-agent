const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const LOG_DIR = path.join(__dirname, '..', 'output');
const LOG_FILE = path.join(LOG_DIR, 'leads_log.xlsx');
const ERROR_DIR = path.join(LOG_DIR, 'errors');

function ensureDirs() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  if (!fs.existsSync(ERROR_DIR)) fs.mkdirSync(ERROR_DIR, { recursive: true });
}

const COLUMNS = [
  { header: 'Unique ID', key: 'uniqueId', width: 30 },
  { header: 'Name', key: 'name', width: 20 },
  { header: 'Title', key: 'title', width: 25 },
  { header: 'Company', key: 'company', width: 25 },
  { header: 'Industry', key: 'industry', width: 20 },
  { header: 'Sector(s)', key: 'sectors', width: 30 },
  { header: 'Type', key: 'type', width: 15 },
  { header: 'Seniority Level', key: 'seniorityLevel', width: 20 },
  { header: 'Company Identity', key: 'companyIdentity', width: 25 },
  { header: 'Company Industry', key: 'companyIndustry', width: 20 },
  { header: 'Message Sent', key: 'messageSent', width: 50 },
  { header: 'Status', key: 'status', width: 15 },
  { header: 'Timestamp', key: 'timestamp', width: 22 },
  { header: 'Error Details', key: 'errorDetails', width: 40 },
  { header: 'Department', key: 'department', width: 25 },
  { header: 'Company HQ', key: 'companyHQ', width: 25 },
  { header: 'Country', key: 'country', width: 25 },
  { header: 'Contact Details', key: 'contactDetails', width: 60 }
];

async function getOrCreateLog() {
  ensureDirs();
  const workbook = new ExcelJS.Workbook();

  if (fs.existsSync(LOG_FILE)) {
    await workbook.xlsx.readFile(LOG_FILE);
  }

  if (!workbook.getWorksheet('Leads')) {
    workbook.addWorksheet('Leads');
  }

  const worksheet = workbook.getWorksheet('Leads');

  // Always (re)assert column definitions so object-key mapping works
  // after readFile, which otherwise loses the column keys.
  worksheet.columns = COLUMNS;
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCE5FF' } };

  return { workbook, worksheet };
}

async function appendRow(data) {
  const { workbook, worksheet } = await getOrCreateLog();
  
  worksheet.addRow({
    uniqueId: data.uniqueId || '',
    name: data.name || '',
    title: data.title || '',
    company: data.company || '',
    industry: data.industry || '',
    sectors: Array.isArray(data.sectors) ? data.sectors.join(', ') : (data.sectors || ''),
    type: data.type || '',
    seniorityLevel: data.seniorityLevel || '',
    companyIdentity: data.companyIdentity || '',
    companyIndustry: data.companyIndustry || '',
    messageSent: data.messageSent || '',
    status: data.status || 'unknown',
    timestamp: data.timestamp || new Date().toISOString(),
    errorDetails: data.errorDetails || '',
    department: data.department || '',
    companyHQ: data.companyHQ || '',
    country: data.country || '',
    contactDetails: data.contactDetails || ''
  });
  
  await workbook.xlsx.writeFile(LOG_FILE);
}

async function loadWorkbook() {
  return getOrCreateLog();
}

async function saveWorkbook(workbook) {
  await workbook.xlsx.writeFile(LOG_FILE);
}

function buildIdRowMap(worksheet) {
  const map = new Map();
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      const id = String(row.getCell(1).value || '');
      if (id && id !== 'undefined') {
        map.set(id, row);
      }
    }
  });
  return map;
}

function readRow(row) {
  const obj = {};
  COLUMNS.forEach((col, index) => {
    const v = row.getCell(index + 1).value;
    obj[col.key] = v === null || v === undefined ? '' : v;
  });
  return obj;
}

async function saveErrorScreenshot(page, personId, errorMsg) {
  ensureDirs();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `error_${personId || 'unknown'}_${timestamp}.png`;
  const filepath = path.join(ERROR_DIR, filename);
  
  try {
    await page.screenshot({ path: filepath, fullPage: true });
    console.log(`[ERROR] Screenshot saved: ${filepath}`);
  } catch (e) {
    console.log(`[ERROR] Failed to save screenshot: ${e.message}`);
  }
  
  return filepath;
}

module.exports = { appendRow, saveErrorScreenshot, loadWorkbook, saveWorkbook, buildIdRowMap, readRow, COLUMNS, LOG_FILE };
