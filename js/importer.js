// js/importer.js
// CSV/TSV Importer (Updated):
// - Accepts NEW template (13 cols) or LEGACY template (9 cols)
// - Maps "Cause Of Admission" (legacy) -> "Diagnosis" (new)
// - Parses CSV or TSV (auto-detect , ; \t ; supports quotes for CSV/TSV)
// - Scrollable preview is in CSS; table uses nowrap to allow horizontal scroll
// - Returns rows normalized to EXPECTED_HEADERS order for app.js to consume

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

// القالب القديم الذي طلبته:
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
let lastMode = 'new'; // 'new' | 'legacy'

// ===== Delimiter detection =====
function detectDelimiter(text) {
  // اعتمد السطر الأول
  const first = (text.split(/\r?\n/, 1)[0] || '');
  const scores = {
    ',': (first.match(/,/g) || []).length,
    '\t': (first.match(/\t/g) || []).length,
    ';': (first.match(/;/g) || []).length
  };
  // اختر الأكثر تكرارًا، ولو كله صفر نعود للفاصلة
  let maxDelim = ',', max = -1;
  for (const d of Object.keys(scores)) {
    if (scores[d] > max) { max = scores[d]; maxDelim = d; }
  }
  return maxDelim;
}

// ===== CSV/TSV parser with quotes, custom delimiter =====
function parseDSV(text, delim) {
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
      if (ch === delim) { pushField(); i++; continue; }
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

// ===== Header validation =====
function validateHeaders(headerRow) {
  const got = (headerRow || []).map(h => (h || '').trim());

  // NEW template (exact match)
  if (got.length === EXPECTED_HEADERS.length && EXPECTED_HEADERS.every((h, i) => h === got[i])) {
    return { ok: true, mode: 'new', message: 'Detected NEW template.' };
  }

  // LEGACY template (exact match to the provided list)
  if (got.length === LEGACY_HEADERS.length && LEGACY_HEADERS.every((h, i) => h === got[i])) {
    return { ok: true, mode: 'legacy', message: 'Detected LEGACY template. Mapping “Cause Of Admission” → “Diagnosis”.' };
  }

  // Mismatch
  return {
    ok: false,
    error: `Header mismatch. Expected either:
- NEW: ${EXPECTED_HEADERS.join(' | ')}
- LEGACY: ${LEGACY_HEADERS.join(' | ')}
Got: ${got.join(' | ')}`
  };
}

// ===== Normalize row length to a target =====
function normalizeRowLength(row, targetLen) {
  const out = new Array(targetLen).fill('');
  for (let i = 0; i < Math.min(row.length, targetLen); i++) {
    out[i] = (row[i] ?? '').toString();
  }
  return out;
}

// ===== Legacy -> New mapping (returns row aligned to EXPECTED_HEADERS) =====
// LEGACY indices:
// 0 Code, 1 Name, 2 Age, 3 Room, 4 Admitting Provider, 5 Cause Of Admission, 6 Diet, 7 Isolation, 8 Comments
// NEW (EXPECTED_HEADERS) indices:
// 0 Code, 1 Name, 2 Age, 3 Room, 4 Diagnosis, 5 Section, 6 Admitting Provider, 7 Diet, 8 Isolation, 9 Comments,
// 10 Symptoms, 11 Symptoms Notes, 12 Labs Abnormal
function mapLegacyRowToExpected(row) {
  const out = new Array(EXPECTED_HEADERS.length).fill('');
  out[0]  = row[0] || ''; // Patient Code
  out[1]  = row[1] || ''; // Patient Name
  out[2]  = row[2] || ''; // Patient Age
  out[3]  = row[3] || ''; // Room
  out[4]  = row[5] || ''; // Diagnosis  <= Cause Of Admission
  out[5]  = '';           // Section (سيُملأ بالـactive section في app.js عند الاستيراد)
  out[6]  = row[4] || ''; // Admitting Provider
  out[7]  = row[6] || ''; // Diet
  out[8]  = row[7] || ''; // Isolation
  out[9]  = row[8] || ''; // Comments
  out[10] = '';           // Symptoms
  out[11] = '';           // Symptoms Notes
  out[12] = '';           // Labs Abnormal
  return out;
}

// ===== Preview rendering (always show as NEW headers after mapping) =====
function renderPreview(rows, mode) {
  const root = els.preview();
  root.innerHTML = '';

  const table = document.createElement('table');
  table.className = 'mono small';
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.style.whiteSpace = 'nowrap';

  const maxRows = Math.min(rows.length, 11); // header + 10 rows

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

  const note = document.createElement('div');
  note.className = 'small muted';
  if (rows.length > 11) {
    note.textContent = `Showing first 10 rows (${rows.length - 1} total). Mode: ${mode.toUpperCase()}.`;
  } else if (rows.length <= 1) {
    note.textContent = `No data rows detected. Mode: ${mode.toUpperCase()}.`;
  } else {
    note.textContent = `${rows.length - 1} data rows. Mode: ${mode.toUpperCase()}.`;
  }

  root.appendChild(table);
  root.appendChild(note);
}

// ===== Public API =====
function open() {
  validatedRows = [];
  els.file().value = '';
  els.preview().innerHTML = '';
  const m = els.modal();
  if (m) m.classList.remove('hidden');
}

function close() {
  const m = els.modal();
  if (m) m.classList.add('hidden');
}

// ===== File change handler =====
async function handleFileChange() {
  const fileInput = els.file();
  const file = fileInput.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const delim = detectDelimiter(text); // ',' or '\t' or ';'
    const rows = parseDSV(text, delim);

    if (rows.length === 0) {
      validatedRows = [];
      els.preview().innerHTML = '<div class="muted small">Empty file.</div>';
      return;
    }

    const header = rows[0].map(x => (x ?? '').toString().trim());
    const check = validateHeaders(header);
    if (!check.ok) {
      validatedRows = [];
      els.preview().innerHTML = `<div class="toast danger" style="white-space:pre-wrap">${check.error}</div>`;
      UI.toast('Invalid headers. Please match NEW or LEGACY template.', 'danger');
      return;
    }

    // Build normalized rows aligned to EXPECTED_HEADERS whatever the source mode
    let dataRowsRaw = rows
      .slice(1)
      .filter(r => r.some(cell => (cell ?? '').toString().trim() !== ''));

    let normalizedToExpected = [];
    if (check.mode === 'new') {
      normalizedToExpected = dataRowsRaw.map(r => normalizeRowLength(r, EXPECTED_HEADERS.length));
    } else {
      // legacy → map each row to expected order
      normalizedToExpected = dataRowsRaw.map(r => mapLegacyRowToExpected(normalizeRowLength(r, LEGACY_HEADERS.length)));
    }

    validatedRows = normalizedToExpected;
    lastMode = check.mode;

    // Preview: always show NEW headers + first 10 mapped rows
    renderPreview([EXPECTED_HEADERS, ...validatedRows.slice(0, 10)], check.mode);

    const msg = check.mode === 'legacy'
      ? 'Legacy template detected. “Cause Of Admission” will be stored under “Diagnosis”.'
      : 'Validated NEW template.';
    UI.toast(`${msg} ${validatedRows.length} rows ready.`, 'success');

  } catch (e) {
    console.error(e);
    validatedRows = [];
    els.preview().innerHTML = `<div class="toast danger">Failed to read/parse file.</div>`;
    UI.toast('Failed to read/parse file.', 'danger');
  }
}

export const Importer = {
  init(bus, state) {
    Bus = bus;
    State = state;
    const f = els.file();
    if (f) f.addEventListener('change', handleFileChange);
  },

  open,
  close,

  // يُستدعى من app.js عند الضغط على Import
  consumeValidatedRows() {
    // نعيد نسخة آمنة محاذاة لـ EXPECTED_HEADERS دومًا
    return validatedRows.map(r => [...r]);
  }
};
