// js/app.js
// Palliative Rounds — App Orchestrator
// Arabic comments for the owner; UI remains English.

import { Sheets } from './sheets.js';
import { Patients } from './patients.js';
import { ESAS } from './esas.js';
import { CTCAE } from './ctcae.js';
import { Labs } from './labs.js';
import { Dashboard } from './dashboard.js';
import { Importer } from './importer.js';
import { UI } from './ui.js';
import { Utils } from './utils.js';
import { AIModule } from './ai.js';

const DEFAULT_SECTION_NAME = 'Default';

const q = (sel, root = document) => root.querySelector(sel);
const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** حافلة أحداث خفيفة (Pub/Sub) لتفكيك الوحدات */
const Bus = (() => {
  const events = new Map();
  return {
    on(name, fn) {
      if (!events.has(name)) events.set(name, new Set());
      events.get(name).add(fn);
      return () => events.get(name)?.delete(fn);
    },
    emit(name, payload) {
      events.get(name)?.forEach(fn => {
        try { fn(payload); } catch (e) { console.error('Bus handler error', e); }
      });
    }
  };
})();

/** حالة التطبيق العامة */
const State = {
  ready: false,
  loading: false,
  filter: 'all',        // all | open | done
  search: '',
  activeSection: null,  // string name
  sections: [],         // ['Default', ...]
  patients: [],         // مصفوفة المرضى (كائنات)
  esas: [],             // سجلات ESAS
  ctcae: [],            // سجلات CTCAE
  labs: [],             // سجلات Labs
  config: {             // إعدادات الاتصال و AI (تخزن محلياً فقط — ليست بيانات مرضى)
    spreadsheetId: '',
    bridgeUrl: '',
    useOAuth: false,
    clientId: '',
    apiKey: '',
    aiEnabled: false,
    aiEndpoint: ''
  },
  /** يعيد المريض النشِط (بالاختيار من قائمة المرضى) */
  get activePatient() {
    return Patients.getActive();
  }
};

/** وظائف مساعدة للقراءة/الكتابة لإعدادات الاتصال (محلية فقط) */
const SettingsStore = {
  KEY: 'pr_settings_v1',
  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (raw) {
        const cfg = JSON.parse(raw);
        Object.assign(State.config, cfg);
      }
    } catch (e) { console.warn('Failed to load settings', e); }
    // مزامنة الحقول في واجهة الإعدادات
    q('#cfg-spreadsheet-id').value = State.config.spreadsheetId || '';
    q('#cfg-bridge-url').value = State.config.bridgeUrl || '';
    q('#cfg-use-oauth').checked = !!State.config.useOAuth;
    q('#cfg-client-id').value = State.config.clientId || '';
    q('#cfg-api-key').value = State.config.apiKey || '';
    q('#cfg-ai-enabled').checked = !!State.config.aiEnabled;
    q('#cfg-ai-endpoint').value = State.config.aiEndpoint || '';
    // إخفاء/إظهار حقول OAuth
    toggleOAuthFields();
  },
  save() {
    State.config = {
      spreadsheetId: q('#cfg-spreadsheet-id').value.trim(),
      bridgeUrl: q('#cfg-bridge-url').value.trim(),
      useOAuth: q('#cfg-use-oauth').checked,
      clientId: q('#cfg-client-id').value.trim(),
      apiKey: q('#cfg-api-key').value.trim(),
      aiEnabled: q('#cfg-ai-enabled').checked,
      aiEndpoint: q('#cfg-ai-endpoint').value.trim()
    };
    localStorage.setItem(this.KEY, JSON.stringify(State.config));
  }
};

/** تحديث شارة وضع الاتصال (Bridge/OAuth) */
function updateSheetsModeLabel() {
  const el = q('#sheets-mode b[data-bind="modeLabel"]');
  el.textContent = State.config.useOAuth ? 'OAuth (gapi)' : 'Apps Script Bridge';
}

/** تبديل عرض حقول OAuth */
function toggleOAuthFields() {
  const area = q('#oauth-fields');
  if (q('#cfg-use-oauth').checked) area.classList.remove('hidden');
  else area.classList.add('hidden');
}

/** ضبط مؤشرات المزامنة في الشريط الجانبي */
function setSyncStatus(text, color = null) {
  q('#sync-status').textContent = text;
  const dot = q('#sync-dot');
  dot.style.background = color || 'var(--muted)';
}

/** تحميل كل البيانات من Google Sheets عند الإقلاع */
async function loadAllFromSheets() {
  State.loading = true;
  setSyncStatus('Loading…', 'var(--primary)');
  try {
    await Sheets.init(State.config); // تهيئة الموصل (Bridge أو OAuth)
    const data = await Sheets.loadAll(); // { sections, patients, esas, ctcae, labs }
    State.sections = data.sections?.length ? data.sections : [DEFAULT_SECTION_NAME];
    State.patients = Array.isArray(data.patients) ? data.patients : [];
    State.esas = Array.isArray(data.esas) ? data.esas : [];
    State.ctcae = Array.isArray(data.ctcae) ? data.ctcae : [];
    State.labs = Array.isArray(data.labs) ? data.labs : [];

    // إذا لم توجد أقسام في الشيت، أنشئ الافتراضي فورًا
    if (!data.sections?.length) {
      await Sheets.ensureSection(DEFAULT_SECTION_NAME);
    }

    // اختيار قسم نشط
    State.activeSection = State.sections[0];

    // رندر القوائم والداشبورد (قد تكون فارغة)
    renderSections();
    renderPatientsList();
    Dashboard.clearEmpty(true); // يُظهر الحالة الفارغة
    setSyncStatus('Idle', 'var(--ok)');

    // إذا لا توجد بيانات مرضى، انتظر إدخال المستخدم (سيكتب فورًا إلى Sheets)
    if (State.patients.length === 0) {
      UI.toast('No patients yet. Add via “+ New Patient” or Import CSV.', 'warn');
    }
  } catch (err) {
    console.error(err);
    UI.toast('Failed to load from Google Sheets. Check Settings.', 'danger');
    setSyncStatus('Error', 'var(--danger)');
  } finally {
    State.loading = false;
  }
}

/** رندر الأقسام في القائمة الجانبية */
function renderSections() {
  const root = q('#sections-list');
  root.innerHTML = '';
  State.sections.forEach(name => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.textContent = name;
    if (name === State.activeSection) {
      btn.classList.add('active');
      btn.style.background = 'rgba(124,156,255,.18)';
      btn.style.borderColor = 'rgba(124,156,255,.4)';
    }
    btn.addEventListener('click', () => {
      State.activeSection = name;
      q('#active-section-badge b[data-bind="activeSectionName"]').textContent = name;
      renderSections();
      renderPatientsList();
      Dashboard.clearEmpty(true);
    });
    root.appendChild(btn);
  });
  q('#active-section-badge b[data-bind="activeSectionName"]').textContent = State.activeSection || DEFAULT_SECTION_NAME;
}

/** تطبيق فلتر/بحث على المرضى */
function getFilteredPatients() {
  const s = State.search.toLowerCase().trim();
  const filter = State.filter;
  const inSection = p => (p.Section || DEFAULT_SECTION_NAME) === State.activeSection;
  const matchesText = p =>
    !s ||
    (p['Patient Code']?.toString().toLowerCase().includes(s)) ||
    (p['Patient Name']?.toLowerCase().includes(s)) ||
    (p['Diagnosis']?.toLowerCase().includes(s)) ||
    (p['Room']?.toLowerCase().includes(s)) ||
    (p['Admitting Provider']?.toLowerCase().includes(s));
  const matchesStatus = p => {
    if (filter === 'all') return true;
    const done = !!p['Done'];
    return filter === 'done' ? done : !done;
  };
  return State.patients.filter(p => inSection(p) && matchesText(p) && matchesStatus(p));
}

/** رندر قائمة المرضى */
function renderPatientsList() {
  const list = q('#patients-list');
  list.innerHTML = '';

  const items = getFilteredPatients();
  q('#patients-count').textContent = items.length.toString();

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'muted small';
    empty.style.padding = '16px';
    empty.textContent = 'No patients in this view.';
    list.appendChild(empty);
    return;
  }

  items.forEach(p => {
    const row = document.createElement('div');
    row.className = 'patient-row';
    row.dataset.code = p['Patient Code'] || '';

    const left = document.createElement('div');
    const name = document.createElement('div');
    name.textContent = p['Patient Name'] || '(Unnamed)';
    name.style.fontWeight = '700';

    const meta = document.createElement('div');
    meta.className = 'meta';
    const dx = p['Diagnosis'] ? `• ${p['Diagnosis']}` : '';
    meta.textContent = `${p['Patient Age'] || '—'} yrs • Room ${p['Room'] || '—'} ${dx}`;

    const tags = document.createElement('div');
    tags.className = 'tags';
    if (p['Section']) {
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = p['Section'];
      tags.appendChild(pill);
    }
    if (p['Done'] === true) {
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = 'Done';
      tags.appendChild(pill);
    }

    left.appendChild(name);
    left.appendChild(meta);
    left.appendChild(tags);

    const right = document.createElement('div');
    right.innerHTML = '<span class="mono muted">' + (p['Patient Code'] || '') + '</span>';

    row.appendChild(left);
    row.appendChild(right);

    row.addEventListener('click', () => {
      qa('.patient-row.active').forEach(r => r.classList.remove('active'));
      row.classList.add('active');
      Patients.setActiveByCode(p['Patient Code']);
      openDashboardFor(p['Patient Code']);
    });

    list.appendChild(row);
  });
}

/** فتح الداشبورد لمريض محدد */
function openDashboardFor(patientCode) {
  const patient = Patients.findByCode(patientCode);
  if (!patient) return;

  q('#dashboard-panel').dataset.empty = 'false';
  q('#dashboard-title').textContent = `Dashboard — ${patient['Patient Name'] || patientCode}`;

  // تعبئة البطاقات المختلفة عبر الوحدات المتخصصة
  Dashboard.bindPatient(patient, {
    esas: ESAS.getForPatient(patientCode, State.esas),
    ctcae: CTCAE.getForPatient(patientCode, State.ctcae),
    labs: Labs.getForPatient(patientCode, State.labs)
  });

  // تحديث وقت التعديل
  const now = new Date().toISOString();
  Patients.touch(patientCode, now); // لا يغير إلا حقل Updated At في الذاكرة؛ الكتابة الفعلية أدناه
  Sheets.writePatientField(patientCode, 'Updated At', now).catch(console.error);
}

/** إعداد المستمعات للأزرار وعناصر الواجهة */
function bindUI() {
  // فلاتر
  qa('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      qa('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.filter = btn.dataset.filter;
      renderPatientsList();
    });
  });

  // بحث
  q('#patient-search').addEventListener('input', (e) => {
    State.search = e.target.value;
    renderPatientsList();
  });

  // أقسام: إضافة/إعادة تسمية/حذف
  q('#add-section-btn').addEventListener('click', async () => {
    const name = await UI.prompt('New section name:', 'Section 2');
    if (!name) return;
    if (State.sections.includes(name)) return UI.toast('Section name already exists.', 'warn');
    try {
      await Sheets.createSection(name); // ينشئ العمود/الهيكل في Sheets
      State.sections.push(name);
      State.activeSection = name;
      renderSections();
      renderPatientsList();
      UI.toast('Section created.', 'success');
    } catch (e) {
      console.error(e);
      UI.toast('Failed to create section in Sheets.', 'danger');
    }
  });

  q('#rename-section-btn').addEventListener('click', async () => {
    if (!State.activeSection) return;
    const newName = await UI.prompt('Rename section:', State.activeSection);
    if (!newName || newName === State.activeSection) return;
    if (State.sections.includes(newName)) return UI.toast('Section name already exists.', 'warn');
    try {
      await Sheets.renameSection(State.activeSection, newName);
      // تحديث المرضى المنتمين لهذا القسم محليًا
      State.patients.forEach(p => {
        if ((p.Section || DEFAULT_SECTION_NAME) === State.activeSection) p.Section = newName;
      });
      // استبدال الاسم في القائمة
      State.sections = State.sections.map(s => (s === State.activeSection ? newName : s));
      State.activeSection = newName;
      renderSections();
      renderPatientsList();
      UI.toast('Section renamed.', 'success');
    } catch (e) {
      console.error(e);
      UI.toast('Failed to rename section in Sheets.', 'danger');
    }
  });

  q('#delete-section-btn').addEventListener('click', async () => {
    if (!State.activeSection) return;
    const ok = await UI.confirm(
      `Delete section “${State.activeSection}” and ALL its patients? This cannot be undone.`
    );
    if (!ok) return;
    try {
      await Sheets.deleteSection(State.activeSection); // يحذف القسم والمرضى في Sheets
      // إزالة محليًا
      State.patients = State.patients.filter(p => (p.Section || DEFAULT_SECTION_NAME) !== State.activeSection);
      State.sections = State.sections.filter(s => s !== State.activeSection);
      if (State.sections.length === 0) {
        await Sheets.ensureSection(DEFAULT_SECTION_NAME);
        State.sections = [DEFAULT_SECTION_NAME];
      }
      State.activeSection = State.sections[0];
      renderSections();
      renderPatientsList();
      Dashboard.clearEmpty(true);
      UI.toast('Section deleted.', 'success');
    } catch (e) {
      console.error(e);
      UI.toast('Failed to delete section in Sheets.', 'danger');
    }
  });

  // أزرار المرضى
  q('#new-patient-btn').addEventListener('click', async () => {
    try {
      const p = await Patients.createEmpty(State.activeSection);
      // كتابة فورية إلى Sheets
      await Sheets.insertPatient(p);
      State.patients.unshift(p);
      renderPatientsList();
      Patients.setActiveByCode(p['Patient Code']);
      openDashboardFor(p['Patient Code']);
      UI.toast('Patient created.', 'success');
    } catch (e) {
      console.error(e);
      UI.toast('Failed to create patient in Sheets.', 'danger');
    }
  });

  q('#delete-patient-btn').addEventListener('click', async () => {
    const p = State.activePatient;
    if (!p) return UI.toast('Select a patient first.', 'warn');
    const ok = await UI.confirm(`Delete patient “${p['Patient Name'] || p['Patient Code']}”?`);
    if (!ok) return;
    try {
      await Sheets.deletePatient(p['Patient Code']);
      State.patients = State.patients.filter(x => x['Patient Code'] !== p['Patient Code']);
      renderPatientsList();
      Dashboard.clearEmpty(true);
      UI.toast('Patient deleted.', 'success');
    } catch (e) {
      console.error(e);
      UI.toast('Failed to delete patient in Sheets.', 'danger');
    }
  });

  q('#duplicate-patient-btn').addEventListener('click', async () => {
    const p = State.activePatient;
    if (!p) return UI.toast('Select a patient first.', 'warn');
    try {
      const dup = Patients.duplicate(p);
      await Sheets.insertPatient(dup);
      State.patients.unshift(dup);
      renderPatientsList();
      Patients.setActiveByCode(dup['Patient Code']);
      openDashboardFor(dup['Patient Code']);
      UI.toast('Duplicated.', 'success');
    } catch (e) {
      console.error(e);
      UI.toast('Failed to duplicate in Sheets.', 'danger');
    }
  });

  q('#mark-done-btn').addEventListener('click', async () => {
    const p = State.activePatient;
    if (!p) return UI.toast('Select a patient first.', 'warn');
    const newVal = !(p['Done'] === true);
    try {
      p['Done'] = newVal;
      await Sheets.writePatientField(p['Patient Code'], 'Done', newVal ? 'TRUE' : 'FALSE');
      renderPatientsList();
      UI.toast(newVal ? 'Marked as Done.' : 'Marked as Open.', 'success');
    } catch (e) {
      console.error(e);
      UI.toast('Failed to update Done in Sheets.', 'danger');
    }
  });

  // CSV Import
  q('#import-csv-btn').addEventListener('click', () => Importer.open());
  q('#csv-import-confirm').addEventListener('click', async () => {
    try {
      const rows = Importer.consumeValidatedRows();
      if (!rows || rows.length === 0) return UI.toast('No valid rows to import.', 'warn');
      setSyncStatus('Importing…', 'var(--primary)');
      // إدراج فوري في Sheets
      await Sheets.bulkInsertPatients(rows.map(r => Patients.mapCsvRowToPatient(r, State.activeSection)));
      // تحديث محلي
      rows.forEach(r => {
        const p = Patients.mapCsvRowToPatient(r, State.activeSection);
        State.patients.push(p);
      });
      renderPatientsList();
      UI.toast(`Imported ${rows.length} patients.`, 'success');
      Importer.close();
      setSyncStatus('Idle', 'var(--ok)');
    } catch (e) {
      console.error(e);
      UI.toast('Import failed. Check CSV order/format.', 'danger');
      setSyncStatus('Error', 'var(--danger)');
    }
  });

  // تحديثات داخل الداشبورد (كتابة فورية إلى Sheets عبر Bus)
  Bus.on('patient.field.changed', async ({ code, field, value }) => {
    try {
      await Sheets.writePatientField(code, field, value ?? '');
      // مزامنة محلية
      const p = Patients.findByCode(code);
      if (p) p[field] = value;
      setSyncStatus('Synced', 'var(--ok)');
      setTimeout(() => setSyncStatus('Idle', 'var(--ok)'), 600);
    } catch (e) {
      console.error(e);
      UI.toast('Failed to sync to Sheets.', 'danger');
      setSyncStatus('Error', 'var(--danger)');
    }
  });

  Bus.on('esas.changed', async ({ code, record }) => {
    try {
      await Sheets.writeESAS(code, record);
      // مزامنة محلية
      ESAS.upsertLocal(State.esas, record);
      setSyncStatus('Synced', 'var(--ok)');
      setTimeout(() => setSyncStatus('Idle', 'var(--ok)'), 600);
    } catch (e) {
      console.error(e);
      UI.toast('Failed to sync ESAS.', 'danger');
      setSyncStatus('Error', 'var(--danger)');
    }
  });

  Bus.on('ctcae.changed', async ({ code, record }) => {
    try {
      await Sheets.writeCTCAE(code, record);
      CTCAE.upsertLocal(State.ctcae, record);
      setSyncStatus('Synced', 'var(--ok)');
      setTimeout(() => setSyncStatus('Idle', 'var(--ok)'), 600);
    } catch (e) {
      console.error(e);
      UI.toast('Failed to sync CTCAE.', 'danger');
      setSyncStatus('Error', 'var(--danger)');
    }
  });

  Bus.on('labs.changed', async ({ code, record }) => {
    try {
      await Sheets.writeLabs(code, record);
      Labs.upsertLocal(State.labs, record);
      setSyncStatus('Synced', 'var(--ok)');
      setTimeout(() => setSyncStatus('Idle', 'var(--ok)'), 600);
    } catch (e) {
      console.error(e);
      UI.toast('Failed to sync Labs.', 'danger');
      setSyncStatus('Error', 'var(--danger)');
    }
  });

  // إعدادات
  q('#open-settings').addEventListener('click', (e) => {
    e.preventDefault();
    UI.openModal('settings-modal');
  });
  q('#save-settings-btn').addEventListener('click', async () => {
    SettingsStore.save();
    updateSheetsModeLabel();
    UI.toast('Settings saved. Reconnecting…', 'success');
    UI.closeModal('settings-modal');
    // إعادة التوصيل وإعادة التحميل
    await loadAllFromSheets();
  });
  q('#cfg-use-oauth').addEventListener('change', toggleOAuthFields);

  // تحديث عنوان الشارة
  updateSheetsModeLabel();

  // Tabs داخل بطاقة HPI/Assessment/Meds/Notes
  qa('.card-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const parent = tab.closest('.card');
      qa('.card-tabs .tab', parent).forEach(t => t.classList.remove('active'));
      qa('.tab-pane', parent).forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      q(tab.dataset.tab, parent).classList.add('active');
    });
  });

  // أزرار AI Summary
  q('#open-ai-summary').addEventListener('click', () => generateSummaryForActive());
  q('#regenerate-summary').addEventListener('click', () => generateSummaryForActive());
  q('#copy-summary').addEventListener('click', () => {
    const text = q('#summary-output').innerText || '';
    Utils.copyToClipboard(text);
    UI.toast('Summary copied.', 'success');
  });

  // زر التحديث اليدوي
  q('#refresh-btn').addEventListener('click', async () => {
    await loadAllFromSheets();
    UI.toast('Data refreshed.', 'success');
  });

  // إغلاق المودالات عبر الأزرار data-close-modal
  qa('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => UI.closeModal(btn.getAttribute('data-close-modal')));
  });
}

/** توليد ملخّص AI للمريض النشط */
async function generateSummaryForActive() {
  const p = State.activePatient;
  if (!p) return UI.toast('Select a patient first.', 'warn');

  const bundle = Dashboard.collectBundleForSummary(p, {
    esas: ESAS.getForPatient(p['Patient Code'], State.esas),
    ctcae: CTCAE.getForPatient(p['Patient Code'], State.ctcae),
    labs: Labs.getForPatient(p['Patient Code'], State.labs)
  });

  q('#summary-output').textContent = 'Generating summary…';
  try {
    let text;
    if (State.config.aiEnabled && State.config.aiEndpoint) {
      text = await AIModule.remoteSummarize(State.config.aiEndpoint, bundle);
    } else {
      text = AIModule.localHeuristicSummary(bundle);
    }
    q('#summary-output').textContent = text;
  } catch (e) {
    console.error(e);
    UI.toast('Failed to generate summary.', 'danger');
    q('#summary-output').textContent = '(Summary unavailable)';
  }
}

/** إشعارات من وحدات الإدخال داخل الداشبورد لتفعيل الكتابة الفورية */
function wireDashboardChangeRelays() {
  // تفويض عام: أي input/textarea داخل #dashboard-content يرسل حدث تحديث إذا كان مربوطًا بحقل
  q('#dashboard-content').addEventListener('change', (e) => {
    const target = e.target;
    const binding = target.getAttribute('data-bind-field'); // اسم الحقل
    if (!binding) return;
    const p = State.activePatient;
    if (!p) return;
    const val = target.value;
    Bus.emit('patient.field.changed', { code: p['Patient Code'], field: binding, value: val });
  });
}

/** حماية CORS/local file: نستخدم Bridge افتراضيًا عند file:// */
function selectDefaultModeIfNeeded() {
  const isFile = location.protocol === 'file:';
  if (isFile && !State.config.useOAuth) {
    // لا شيء — Bridge موصى به
  } else if (isFile && State.config.useOAuth) {
    UI.toast('OAuth may not work from file:// — consider Bridge mode.', 'warn');
  }
}

/** نقطة البدء */
export const App = {
  async start() {
    // تحميل إعدادات
    SettingsStore.load();
    selectDefaultModeIfNeeded();

    // ربط الواجهة
    bindUI();
    wireDashboardChangeRelays();

    // تهيئة الوحدات مع Bus/State حيث يلزم
    UI.init(Bus);
    Patients.init(Bus, State);
    ESAS.init(Bus, State);
    CTCAE.init(Bus, State);
    Labs.init(Bus, State);
    Dashboard.init(Bus, State);
    Importer.init(Bus, State);
    AIModule.init(Bus, State);

    // تحميل من Google Sheets
    await loadAllFromSheets();

    State.ready = true;
  },

  /** يسمح للوحدات الأخرى بالوصول إلى الحافلة والحالة */
  bus: Bus,
  state: State
};
