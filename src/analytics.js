const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const LEADS_LOG = path.join(__dirname, '..', 'output', 'leads_log.xlsx');
const CONTACTS_FILE = path.join(__dirname, '..', 'output', 'leads_with_contacts.xlsx');

async function readUniqueIds(file, statusFilter) {
  if (!fs.existsSync(file)) return new Set();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('Leads');
  if (!ws) return new Set();

  const ids = new Set();
  ws.eachRow((row, n) => {
    if (n <= 1) return;
    const id = String(row.getCell(1).value || '');
    if (!id || id === 'undefined') return;
    if (statusFilter) {
      const status = String(row.getCell(12).value || '').toLowerCase();
      if (status !== statusFilter) return;
    }
    ids.add(id);
  });
  return ids;
}

async function getAnalytics() {
  const successIds = await readUniqueIds(LEADS_LOG, 'success');
  const contactIds = await readUniqueIds(CONTACTS_FILE, null);

  const sent = successIds.size;
  const accepted = [...contactIds].filter((id) => successIds.has(id)).length;
  const scraped = contactIds.size;
  const remaining = Math.max(0, sent - accepted);

  const byStatus = {};
  if (fs.existsSync(LEADS_LOG)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(LEADS_LOG);
    const ws = wb.getWorksheet('Leads');
    if (ws) {
      ws.eachRow((row, n) => {
        if (n <= 1) return;
        const status = String(row.getCell(12).value || 'unknown').toLowerCase();
        byStatus[status] = (byStatus[status] || 0) + 1;
      });
    }
  }

  return { sent, accepted, remaining, scraped, byStatus };
}

module.exports = { getAnalytics, LEADS_LOG, CONTACTS_FILE };
