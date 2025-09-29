// js/importer.js
// CSV Importer (Updated):
// - Strict headers per new spec
// - Scrollable preview container (handled by CSS; table uses nowrap when wide)
// - Tolerant CSV parser (quotes, commas inside quotes)
// - Clear toasts for success/failure
// - Returns validated rows (array of arrays) for the app to map into patient objects

import { UI } from './ui.js';

let Bus, State;

const EXPECTED_HEADERS = [
  'Patient Code',
  'Patient Name',
  'Patient Age',
  'Room',
  'Diagnosis',
  'Section',
  'Admitting Provider',
  'Diet',
  'Isolation',
  'Comments',
  'Symptoms (comma-separated)',
  'Symptoms Notes (JSON map)',
  'Labs Abnormal (comma-separated)'
];

// للكشف عن القالب القديم وإعطاء رسالة مفيدة
const LEGACY_HEADERS = [
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

  function pushField() { row.push(field); field = ''; }
  function pushRow()   { rows.push(row); row = []; }

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      } else { field += ch; i++; continue; }
    } else {
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ',') { pushField(); i++; continue; }
      if (ch === '\n') { pushField(); pushRow(); i++; continue; }
      if (ch === '\r') { i++; continue; } // CRLF
      field += ch; i++;
    }
  }
  // آخر حقل/سطر
  pushField();
  if (row.length > 1 || (row.length === 1 && row[0] !== '')) pushRow();

  return rows;
}

/** قص/توسيع الصف ليتطابق مع عدد الأعمدة المتوقّع */
function normalizeRowLength(row, targetLen) {
  const out = new Array(targetLen).fill('');
  for (let i = 0; i < Math.min(row.length, targetLen); i++) {
    out[i] = (row[i] ?? '').toString();
  }
  return out;
}

/** التحقق الصارم من ترتيب الأعمدة */
function validateHeaders(headerRow) {
  if (!headerRow) return { ok: false, error: 'Missing header row.' };
  const got = headerRow.map(h => (h || '').trim());

  // تحذير واضح لو الملف من القالب القديم
  if (got.length === LEGACY_HEADERS.length && LEGACY_HEADERS.every((h, i) => h === got[i])) {
    return {
      ok: false,
      error: 'This CSV matches an old template (with "Cause Of Admission"). Please export the new template and try again.'
    };
  }

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

/** عرض معاينة بسيطة (أول 10 أسطر بيانات) داخل حاوية قابلة للتمرير */
function renderPreview(rows) {
  const root = els.preview();
  root.innerHTML = '';

  const table = document.createElement('table');
  table.className = 'mono small';
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.style.whiteSpace = 'nowrap'; // للسماح بالتمرير الأفقي عند الحاجة

  const maxRows = Math.min(rows.length, 11); // header + 10

  for (let r = 0; r < maxRows; r++) {
    const tr = document.createElement('tr');
    rows[r].forEach((cell) => {
      const td = document.createElement(r === 0 ? 'th' : 'td');
      td.textContent = cell ?? '';
      td.style.border = '1px solid var(--border)';
      td.style.padding = '4px 6px';
      td.style.textAlign = 'left';
      if (r === 0) {
        td.style.background = 'rgba(124,156,255,.10)';
        td.style.fontWeight = '700';
        td.style.position = 'sticky';
        td.style.top = '0';
        td.style.zIndex = '1';
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
  const m = els.modal();
  if (m) m.classList.remove('hidden');
}

/** إغلاق المودال */
function close() {
  const m = els.modal();
  if (m) m.classList.add('hidden');
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

    const header = rows[0].map(x => (x ?? '').toString().trim());
    const check = validateHeaders(header);
    if (!check.ok) {
      validatedRows = [];
      els.preview().innerHTML = `<div class="toast danger">${check.error}</div>`;
      UI.toast(check.error, 'danger');
      return;
    }

    // صفوف البيانات مع ضبط الطول لعدد الأعمدة المتوقع
    const dataRows = rows
      .slice(1)
      .filter(r => r.some(cell => (cell ?? '').toString().trim() !== ''))
      .map(r => normalizeRowLength(r, EXPECTED_HEADERS.length));

    validatedRows = dataRows;

    // المعاينة: عرض العناوين + أول 10 صفوف بيانات
    renderPreview([EXPECTED_HEADERS, ...validatedRows.slice(0, 10)]);

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

    // ربط تغيّر الملف
    const f = els.file();
    if (f) f.addEventListener('change', handleFileChange);
  },

  open,
  close,

  /** تُستدعى عند النقر على Import في المودال من app.js */
  consumeValidatedRows() {
    // نُعيد نسخة حتى لا تتأثر لاحقاً
    return validatedRows.map(r => [...r]);
  }
};
