// js/importer.js
// CSV Importer: open modal, read CSV, strict header/order validation,
// show preview, and return validated rows for insertion.

import { UI } from './ui.js';

let Bus, State;

const EXPECTED_HEADERS = [
  'Patient Code',
  'Patient Name',
  'Patient Age',
  'Room',
  'Admitting Provider',
  'Cause Of Admission',
  'Diet',
  'Isolation',
  'Comments'
];

const els = {
  modal: () => document.getElementById('import-modal'),
  file: () => document.getElementById('csv-file-input'),
  preview: () => document.getElementById('csv-preview')
};

let validatedRows = [];

/** Parser بسيط لـ CSV يدعم الفواصل داخل علامات اقتباس مزدوجة */
function parseCSV(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQuotes = false;

  function pushField() {
    row.push(field);
    field = '';
  }
  function pushRow() {
    rows.push(row);
    row = [];
  }

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // Escaped quote
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        field += ch;
        i++;
        continue;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (ch === ',') {
        pushField();
        i++;
        continue;
      }
      if (ch === '\n') {
        pushField();
        pushRow();
        i++;
        continue;
      }
      if (ch === '\r') {
        // handle CRLF
        i++;
        continue;
      }
      field += ch;
      i++;
    }
  }
  // آخر حقل/سطر
  pushField();
  if (row.length > 1 || (row.length === 1 && row[0] !== '')) pushRow();

  return rows;
}

/** التحقق الصارم من ترتيب الأعمدة */
function validateHeaders(headerRow) {
  if (!headerRow) return { ok: false, error: 'Missing header row.' };
  const got = headerRow.map(h => (h || '').trim());
  if (got.length !== EXPECTED_HEADERS.length) {
    return { ok: false, error: `Expected ${EXPECTED_HEADERS.length} columns, got ${got.length}.` };
  }
  for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
    if (got[i] !== EXPECTED_HEADERS[i]) {
      return {
        ok: false,
        error: `Header mismatch at column ${i + 1}: expected “${EXPECTED_HEADERS[i]}”, got “${got[i]}”.`
      };
    }
  }
  return { ok: true };
}

/** عرض معاينة بسيطة (أول 10 أسطر) */
function renderPreview(rows) {
  const root = els.preview();
  root.innerHTML = '';
  const table = document.createElement('table');
  table.className = 'mono small';
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';

  const maxRows = Math.min(rows.length, 11); // header + 10
  for (let r = 0; r < maxRows; r++) {
    const tr = document.createElement('tr');
    rows[r].forEach((cell, i) => {
      const td = document.createElement(r === 0 ? 'th' : 'td');
      td.textContent = cell ?? '';
      td.style.border = '1px solid var(--border)';
      td.style.padding = '4px 6px';
      td.style.textAlign = 'left';
      if (r === 0) {
        td.style.background = 'rgba(124,156,255,.10)';
        td.style.fontWeight = '700';
      }
      tr.appendChild(td);
    });
    table.appendChild(tr);
  }

  // ملاحظة لو كانت هناك صفوف أكثر
  const note = document.createElement('div');
  note.className = 'small muted';
  if (rows.length > 11) {
    note.textContent = `Showing first 10 rows of ${rows.length - 1} data rows.`;
  } else if (rows.length <= 1) {
    note.textContent = 'No data rows detected.';
  } else {
    note.textContent = `${rows.length - 1} data rows detected.`;
  }

  root.appendChild(table);
  root.appendChild(note);
}

/** فتح المودال وتصفير الحالة */
function open() {
  validatedRows = [];
  els.file().value = '';
  els.preview().innerHTML = '';
  UI.openModal('import-modal');
}

/** إغلاق المودال */
function close() {
  UI.closeModal('import-modal');
}

/** قراءة الملف والتحقق والمعاينة */
async function handleFileChange() {
  const fileInput = els.file();
  const file = fileInput.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const rows = parseCSV(text);

    if (rows.length === 0) {
      validatedRows = [];
      els.preview().innerHTML = '<div class="muted small">Empty file.</div>';
      return;
    }

    const header = rows[0];
    const check = validateHeaders(header);
    if (!check.ok) {
      validatedRows = [];
      els.preview().innerHTML = `<div class="toast danger">${check.error}</div>`;
      UI.toast(check.error, 'danger');
      return;
    }

    // صفوف البيانات (اترك الأعمدة الفارغة كما هي)
    const dataRows = rows.slice(1).filter(r => r.some(cell => (cell ?? '').toString().trim() !== ''));
    validatedRows = dataRows.map(r => r.map(c => (c ?? '').toString()));

    // عرِض المعاينة
    renderPreview([header, ...validatedRows.slice(0, 10)]);

    if (validatedRows.length === 0) {
      UI.toast('CSV contains no non-empty data rows.', 'warn');
    } else {
      UI.toast(`Validated ${validatedRows.length} rows. Ready to import.`, 'success');
    }
  } catch (e) {
    console.error(e);
    validatedRows = [];
    els.preview().innerHTML = `<div class="toast danger">Failed to read/parse CSV.</div>`;
    UI.toast('Failed to read/parse CSV.', 'danger');
  }
}

export const Importer = {
  init(bus, state) {
    Bus = bus;
    State = state;

    // ربط تغير الملف
    els.file().addEventListener('change', handleFileChange);
  },

  open,
  close,

  /** تُستدعى عند النقر على Import في المودال من app.js */
  consumeValidatedRows() {
    // نُعيد نسخة حتى لا تتأثر لاحقاً
    return validatedRows.map(r => [...r]);
  }
};