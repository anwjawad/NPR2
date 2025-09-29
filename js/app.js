// js/app.js
// Palliative Rounds — App Orchestrator (Updated)
// ينسّق الحالة والـUI: أقسام، مرضى، مودال الداشبورد، الأعراض الموحّدة، الاستيراد/التصدير، الحذف المتزامن.

import { Sheets } from './sheets.js';
import { Patients } from './patients.js';
import { ESAS } from './esas.js';      // نحافظ عليه للتوافق (لن يظهر بصريًا إن لم توجد عناصره)
import { CTCAE } from './ctcae.js';    // نحافظ عليه للتوافق (لن يظهر بصريًا إن لم توجد عناصره)
import { Labs } from './labs.js';
import { Dashboard } from './dashboard.js';
import { Importer } from './importer.js';
import { UI } from './ui.js';
import { Utils } from './utils.js';
import { AIModule } from './ai.js';
import { Symptoms } from './symptoms.js';

// ===== Defaults on first run =====
const DEFAULTS = {
  spreadsheetId: '1l8UoblxznwV_zz7ZqnorOWZKfnmG3pZgVCT0DaSm0kU',
  bridgeUrl: 'https://script.google.com/macros/s/AKfycbyLEWF-O49ifMKWYlPZ3bPvNN9w184Ddz_bGXhlWmmQD3SwZKG5aIiQ_bgapiKElmiE/exec'
};
(function ensureDefaults(){
  if (!localStorage.getItem('pr.sheet')) {
    localStorage.setItem('pr.sheet', DEFAULTS.spreadsheetId);
  }
  if (!localStorage.getItem('pr.bridge')) {
    localStorage.setItem('pr.bridge', DEFAULTS.bridgeUrl);
  }
})();

// ===== Helpers =====
const q  = (sel, root=document)=>root.querySelector(sel);
const qa = (sel, root=document)=>Array.from(root.querySelectorAll(sel));
const toast = (msg, type='info') => UI.toast(msg, type);

// حساب ملخص الشذوذ للمختبرات
const LAB_REF = {
  'WBC': [4.0, 11.0],
  'HGB': [12.0, 16.0],
  'PLT': [150, 450],
  'ANC': [1.5, 8.0],
  'CRP': [0, 5],
  'Albumin': [3.5, 5.0],
  'Sodium (Na)': [135, 145],
  'Potassium (K)': [3.5, 5.1],
  'Chloride (Cl)': [98, 107],
  'Calcium (Ca)': [8.5, 10.5],
  'Phosphorus (Ph)': [2.5, 4.5],
  'Alkaline Phosphatase (ALP)': [44, 147],
  'Creatinine (Scr)': [0.6, 1.3],
  'BUN': [7, 20],
  'Total Bile': [0.1, 1.2]
};
function parseNum(v){
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = String(v).trim().match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isNaN(n) ? null : n;
}
function abnormalSummary(labsRecord){
  if (!labsRecord) return '';
  const items = [];
  const short = (k)=>k.replace('Alkaline Phosphatase (ALP)', 'ALP')
                      .replace('Creatinine (Scr)','Scr')
                      .replace('Sodium (Na)','Na')
                      .replace('Potassium (K)','K')
                      .replace('Chloride (Cl)','Cl')
                      .replace('Calcium (Ca)','Ca')
                      .replace('Phosphorus (Ph)','Ph');
  Object.keys(LAB_REF).forEach(k=>{
    const ref = LAB_REF[k];
    const n = parseNum(labsRecord[k]);
    if (n == null) return;
    if (n < ref[0]) items.push(short(k) + '↓');
    else if (n > ref[1]) items.push(short(k) + '↑');
  });
  return items.join(', ');
}

// ===== Event Bus (Pub/Sub) =====
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

// ===== Global State =====
const State = {
  ready: false,
  loading: false,
  filter: 'all',          // all | open | done
  search: '',
  activeSection: 'Default',
  sections: ['Default'],
  patients: [],
  esas: [],
  ctcae: [],
  labs: [],
  config: {
    spreadsheetId: localStorage.getItem('pr.sheet') || '',
    bridgeUrl: localStorage.getItem('pr.bridge') || '',
    useOAuth: false,
    aiEndpoint: localStorage.getItem('pr.ai') || ''
  },
  get activePatient(){
    return Patients.getActive?.() || null;
  }
};

// ===== UI Wiring =====
function renderSections(){
  const root = q('#sections-list');
  if (!root) return;
  root.innerHTML = '';
  State.sections.forEach(name=>{
    const btn = document.createElement('button');
    btn.className = 'pill ' + (name===State.activeSection?'active':'');
    btn.textContent = name;
    btn.addEventListener('click', ()=>{
      State.activeSection = name;
      const label = q('#active-section-name');
      if (label) label.textContent = name;
      renderPatientsList();
      Dashboard.clearEmpty?.(true);
    });
    root.appendChild(btn);
  });
  const label = q('#active-section-name');
  if (label) label.textContent = State.activeSection || 'Default';
}

function symptomsPreview(p){
  const s = (p['Symptoms']||'').split(',').map(x=>x.trim()).filter(Boolean);
  if (!s.length) return '';
  return s.slice(0,3).join(', ') + (s.length>3? ` (+${s.length-3})` : '');
}

function getFilteredPatients(){
  const s = State.search.toLowerCase().trim();
  const filter = State.filter;
  const inSection = p => (p.Section || 'Default') === State.activeSection;
  const matchesText = p => !s || JSON.stringify(p).toLowerCase().includes(s);
  const matchesStatus = p => filter === 'all' ? true : (filter === 'done' ? !!p['Done'] : !p['Done']);
  return State.patients.filter(p => inSection(p) && matchesText(p) && matchesStatus(p));
}

function renderPatientsList(){
  const list = q('#patients-list');
  if (!list) return;
  list.innerHTML = '';

  const items = getFilteredPatients();

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty small';
    empty.style.padding = '16px';
    empty.textContent = 'No patients in this view.';
    list.appendChild(empty);
    return;
  }

  items.forEach(p=>{
    const labsRec = Labs.getForPatient(p['Patient Code'], State.labs);
    const labsAbn = p['Labs Abnormal'] || abnormalSummary(labsRec);
    const symPrev = symptomsPreview(p);

    const row = document.createElement('div');
    row.className = 'row patient-card';
    row.dataset.code = p['Patient Code'] || '';

    const left = document.createElement('div');

    const header = document.createElement('div');
    header.className = 'row-header';

    const name = document.createElement('div');
    name.className = 'row-title linkish';
    name.textContent = p['Patient Name'] || '(Unnamed)';

    const badge = document.createElement('span');
    badge.className = 'status ' + (p['Done'] ? 'done' : 'open');
    badge.textContent = p['Done'] ? 'Done' : 'Open';

    header.appendChild(name);
    header.appendChild(badge);

    const meta = document.createElement('div');
    meta.className = 'row-sub';
    const dx = p['Diagnosis'] ? `• ${p['Diagnosis']}` : '';
    meta.textContent = `${p['Patient Age'] || '—'} yrs • Room ${p['Room'] || '—'} ${dx}`;

    const tags = document.createElement('div');
    tags.className = 'row-tags';
    const sectionPill = document.createElement('span');
    sectionPill.className = 'row-tag';
    sectionPill.textContent = p['Section'] || 'Default';
    tags.appendChild(sectionPill);
    if (labsAbn) {
      const chip = document.createElement('span');
      chip.className = 'row-chip abn';
      chip.textContent = labsAbn;
      tags.appendChild(chip);
    }
    if (symPrev) {
      const chip = document.createElement('span');
      chip.className = 'row-chip sym';
      chip.textContent = symPrev;
      tags.appendChild(chip);
    }

    left.appendChild(header);
    left.appendChild(meta);
    left.appendChild(tags);

    const right = document.createElement('div');
    right.innerHTML = '<span class="mono muted">' + (p['Patient Code'] || '') + '</span>';

    row.appendChild(left);
    row.appendChild(right);

    // فتح الداشبورد كمودال عند النقر على اسم المريض فقط
    name.addEventListener('click', (e)=>{
      e.stopPropagation();
      Patients.setActiveByCode?.(p['Patient Code']);
      openDashboardFor(p['Patient Code'], /*asModal*/ true);
    });

    list.appendChild(row);
  });
}

function openDashboardFor(patientCode, asModal=false){
  const patient = State.patients.find(p => p['Patient Code'] === patientCode);
  if (!patient) return;

  // عنوان
  const t = q('#dashboard-title');
  if (t) t.textContent = `Dashboard — ${patient['Patient Name'] || patientCode}`;
  const mt = q('#patient-modal-title');
  if (mt) mt.textContent = patient['Patient Name'] || patientCode;

  // ربط البايو و HPI و Labs عبر Dashboard
  Dashboard.bindPatient(patient, {
    esas: ESAS.getForPatient(patientCode, State.esas),
    ctcae: CTCAE.getForPatient(patientCode, State.ctcae),
    labs: Labs.getForPatient(patientCode, State.labs)
  });

  // ربط الأعراض الموحدة
  const symptomsData = {
    symptoms: (patient['Symptoms']||'').split(',').map(x=>x.trim()).filter(Boolean),
    notes: safeParseJSON(patient['Symptoms Notes']||'{}')
  };
  Symptoms.render(patientCode, symptomsData);

  const panel = q('#dashboard-panel');
  if (panel) panel.dataset.empty = 'false';

  // ربط الكتابة الفورية لحقول bio/HPI/… (delegation داخل المودال)
  const container = q('#patient-modal') || document;
  container.addEventListener('change', onDashboardBindableChange, { passive: true });
  container.addEventListener('blur', onDashboardBindableChange, { capture: true, passive: true });

  // لمس وقت التعديل + كتابة إلى Sheets
  const now = new Date().toISOString();
  try { Sheets.writePatientField(patientCode, 'Updated At', now); } catch(e){ console.warn(e); }

  if (asModal) openPatientModal();
}

function onDashboardBindableChange(ev){
  const target = ev.target;
  if (!target) return;
  const field = target.getAttribute?.('data-bind-field');
  if (!field) return;
  const p = State.activePatient || Patients.findByCode?.(q('#patient-modal-title')?.textContent || '');
  const active = Patients.getActive?.() || null;
  const code = active?.['Patient Code'] || (p?.['Patient Code']);
  if (!code) return;
  const val = target.value ?? '';
  Sheets.writePatientField(code, field, val)
    .then(()=>{
      // sync local state
      const idx = State.patients.findIndex(x=>x['Patient Code']===code);
      if (idx>=0) State.patients[idx][field] = val;
      toast('Synced', 'success');
    })
    .catch(()=> toast('Failed to sync to Sheets.', 'danger'));
}

function safeParseJSON(s){ try { return JSON.parse(s); } catch { return {}; } }

// ===== Modal open/close =====
function openPatientModal(){
  const m = q('#patient-modal');
  if (!m) return;
  m.classList.remove('hidden');
  document.documentElement.style.overflow = 'hidden';
  const onKey = (ev)=>{
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closePatientModal();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
}
function closePatientModal(){
  const m = q('#patient-modal');
  if (!m) return;
  m.classList.add('hidden');
  document.documentElement.style.overflow = '';
}

// ===== Loading from Sheets =====
async function loadAllFromSheets(){
  State.loading = true;
  try {
    await Sheets.init(State.config);
    const data = await Sheets.loadAll();
    State.sections = data.sections?.length ? data.sections : ['Default'];
    State.patients = Array.isArray(data.patients) ? data.patients : [];
    State.esas = Array.isArray(data.esas) ? data.esas : [];
    State.ctcae = Array.isArray(data.ctcae) ? data.ctcae : [];
    State.labs = Array.isArray(data.labs) ? data.labs : [];

    if (!data.sections?.length) {
      await Sheets.ensureSection('Default');
    }
    if (!State.sections.includes(State.activeSection)) {
      State.activeSection = State.sections[0] || 'Default';
    }

    renderSections();
    renderPatientsList();
    Dashboard.clearEmpty?.(true);
  } catch (e) {
    console.error(e);
    toast('Failed to load from Google Sheets. Check Settings.', 'danger');
  } finally {
    State.loading = false;
  }
}

// ===== Bind UI Elements =====
function bindUI(){
  UI.init?.(Bus);

  // Filter tabs
  qa('.tabs .tab').forEach(tab=>{
    tab.addEventListener('click', ()=>{
      qa('.tabs .tab').forEach(x=>x.classList.remove('active'));
      tab.classList.add('active');
      State.filter = tab.dataset.filter || 'all';
      renderPatientsList();
    });
  });

  // Search
  const search = q('#search');
  if (search) {
    search.addEventListener('input', Utils.debounce((e)=>{
      State.search = e.target.value || '';
      renderPatientsList();
    }, 200));
  }

  // Sections: Add
  const btnAddSection = q('#btn-add-section');
  if (btnAddSection) {
    btnAddSection.addEventListener('click', async ()=>{
      const name = prompt('New section name') || '';
      if (!name.trim()) return;
      if (State.sections.includes(name)) return toast('Section name already exists.', 'warn');
      try {
        await Sheets.createSection(name);
        State.sections.push(name);
        State.activeSection = name;
        renderSections();
        renderPatientsList();
        toast('Section created.', 'success');
      } catch { toast('Failed to create section in Sheets.', 'danger'); }
    });
  }

  // Sections: Rename
  const btnRenameSection = q('#btn-rename-section');
  if (btnRenameSection) {
    btnRenameSection.addEventListener('click', async ()=>{
      const oldName = State.activeSection;
      if (!oldName) return;
      const newName = prompt('Rename section:', oldName) || '';
      if (!newName.trim() || newName === oldName) return;
      if (State.sections.includes(newName)) return toast('Section name already exists.', 'warn');
      try {
        await Sheets.renameSection(oldName, newName);
        State.patients.forEach(p=>{ if ((p.Section||'Default')===oldName) p.Section=newName; });
        State.sections = State.sections.map(s=>s===oldName?newName:s);
        State.activeSection = newName;
        renderSections();
        renderPatientsList();
        toast('Section renamed.', 'success');
      } catch { toast('Failed to rename section.', 'danger'); }
    });
  }

  // Sections: Delete (move patients to Default) — Safe delete
  const btnDeleteSection = q('#btn-delete-section');
  if (btnDeleteSection) {
    btnDeleteSection.addEventListener('click', async ()=>{
      const current = State.activeSection;
      if (!current) return;
      if (State.sections.length <= 1) {
        alert('Cannot delete the last section.');
        return;
      }
      if (!confirm(`Delete section “${current}”? Patients will be moved to “Default”.`)) return;
      try {
        if (!State.sections.includes('Default')) {
          await Sheets.createSection('Default');
          State.sections.push('Default');
        }
        const list = State.patients.filter(p => (p.Section||'Default') === current);
        for (const p of list) {
          p.Section = 'Default';
          await Sheets.writePatientField(p['Patient Code'], 'Section', 'Default').catch(()=>{});
        }
        await Sheets.deleteSection(current);
        State.sections = State.sections.filter(s=>s!==current);
        State.activeSection = State.sections[0] || 'Default';
        renderSections();
        renderPatientsList();
        Dashboard.clearEmpty?.(true);
        toast('Section deleted and patients moved to “Default”.', 'success');
      } catch { toast('Failed to delete section.', 'danger'); }
    });
  }

  // New patient
  const btnNewPatient = q('#btn-new-patient');
  if (btnNewPatient) {
    btnNewPatient.addEventListener('click', async ()=>{
      try {
        const p = Patients.createEmpty?.(State.activeSection) || {
          'Patient Code': 'P'+Math.random().toString(36).slice(2,8).toUpperCase(),
          'Patient Name':'', 'Patient Age':'', 'Room':'',
          'Admitting Provider':'', 'Diagnosis':'', 'Diet':'', 'Isolation':'', 'Comments':'',
          'Section': State.activeSection, 'Done': false, 'Updated At': new Date().toISOString(),
          'HPI Diagnosis':'','HPI Previous':'','HPI Current':'','HPI Initial':'',
          'Patient Assessment':'','Medication List':'','Latest Notes':'',
          'Symptoms':'','Symptoms Notes':'{}','Labs Abnormal':''
        };
        // ensure new fields
        p['Symptoms'] = p['Symptoms'] || '';
        p['Symptoms Notes'] = p['Symptoms Notes'] || '{}';
        p['Labs Abnormal'] = p['Labs Abnormal'] || '';
        await Sheets.insertPatient(p);
        State.patients.unshift(p);
        renderPatientsList();
        Patients.setActiveByCode?.(p['Patient Code']);
        openDashboardFor(p['Patient Code'], true);
        toast('Patient created.', 'success');
      } catch { toast('Failed to create patient in Sheets.', 'danger'); }
    });
  }

  // Delete patient
  const btnDeletePatient = q('#btn-delete-patient');
  if (btnDeletePatient) {
    btnDeletePatient.addEventListener('click', async ()=>{
      const p = State.activePatient;
      if (!p) return toast('Select a patient first.', 'warn');
      const ok = confirm(`Delete patient “${p['Patient Name'] || p['Patient Code']}”?`);
      if (!ok) return;
      try {
        await Sheets.deletePatient(p['Patient Code']);
        State.patients = State.patients.filter(x => x['Patient Code'] !== p['Patient Code']);
        renderPatientsList();
        Dashboard.clearEmpty?.(true);
        closePatientModal();
        toast('Patient deleted.', 'success');
      } catch { toast('Failed to delete patient.', 'danger'); }
    });
  }

  // Duplicate patient
  const btnDup = q('#btn-duplicate');
  if (btnDup) {
    btnDup.addEventListener('click', async ()=>{
      const p = State.activePatient;
      if (!p) return toast('Select a patient first.', 'warn');
      try {
        const dup = Patients.duplicate?.(p) || (()=>{ const c={...p}; c['Patient Code']='P'+Math.random().toString(36).slice(2,8).toUpperCase(); c['Patient Name']=(p['Patient Name']||'')+' (Copy)'; c['Done']=false; c['Updated At']=new Date().toISOString(); return c; })();
        await Sheets.insertPatient(dup);
        State.patients.unshift(dup);
        renderPatientsList();
        Patients.setActiveByCode?.(dup['Patient Code']);
        openDashboardFor(dup['Patient Code'], true);
        toast('Duplicated.', 'success');
      } catch { toast('Failed to duplicate in Sheets.', 'danger'); }
    });
  }

  // Mark done/open
  const btnDone = q('#btn-mark-done');
  if (btnDone) {
    btnDone.addEventListener('click', async ()=>{
      const p = State.activePatient;
      if (!p) return toast('Select a patient first.', 'warn');
      const newVal = !(p['Done'] === true);
      try {
        p['Done'] = newVal;
        await Sheets.writePatientField(p['Patient Code'], 'Done', newVal ? 'TRUE' : 'FALSE');
        renderPatientsList();
        toast(newVal ? 'Marked as Done.' : 'Marked as Open.', 'success');
      } catch { toast('Failed to update Done in Sheets.', 'danger'); }
    });
  }

  // Import CSV modal
  const btnImport = q('#btn-import');
  if (btnImport) {
    btnImport.addEventListener('click', ()=>{
      q('#csv-preview').innerHTML='';
      q('#csv-file-input').value='';
      const confirmBtn = q('#btn-import-confirm');
      if (confirmBtn) {
        confirmBtn.onclick = async ()=>{
          const rows = Importer.consumeValidatedRows?.() || [];
          if (!rows.length) { alert('No rows to import.'); return; }
          const objs = rows.map(r => ({
            'Patient Code': r[0] || ('P'+Math.random().toString(36).slice(2,8).toUpperCase()),
            'Patient Name': r[1]||'', 'Patient Age': r[2]||'', 'Room': r[3]||'',
            'Diagnosis': r[4]||'', 'Section': r[5]||State.activeSection,
            'Admitting Provider': r[6]||'', 'Diet': r[7]||'', 'Isolation': r[8]||'',
            'Comments': r[9]||'',
            'Symptoms': r[10]||'',
            'Symptoms Notes': r[11]||'{}',
            'Labs Abnormal': r[12]||'',
            'Done': false, 'Updated At': new Date().toISOString(),
            // حقول HPI تبقى فارغة افتراضيًا
            'HPI Diagnosis':'','HPI Previous':'','HPI Current':'','HPI Initial':'',
            'Patient Assessment':'','Medication List':'','Latest Notes':''
          }));
          try {
            await Sheets.bulkInsertPatients(objs);
            State.patients.push(...objs);
            renderPatientsList();
            q('[data-close-modal="import-modal"]')?.click();
            toast(`Imported ${objs.length} patients.`, 'success');
          } catch { toast('Import failed. Check CSV order/format.', 'danger'); }
        };
      }
      q('#import-modal')?.classList.remove('hidden');
    });
  }

  // Export CSV Template (إذا الزر موجود)
  const btnExportTpl = q('#btn-export-template');
  if (btnExportTpl) {
    btnExportTpl.addEventListener('click', ()=>{
      const headers = [
        'Patient Code','Patient Name','Patient Age','Room','Diagnosis','Section',
        'Admitting Provider','Diet','Isolation','Comments',
        'Symptoms (comma-separated)','Symptoms Notes (JSON map)','Labs Abnormal (comma-separated)'
      ];
      const csv = headers.join(',') + '\n';
      const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'palliative_rounds_template.csv';
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Template downloaded.','success');
    });
  }

  // Delete ALL patients in current section
  const btnDeleteAll = q('#btn-delete-all-pats');
  if (btnDeleteAll) {
    btnDeleteAll.addEventListener('click', async ()=>{
      const sec = State.activeSection;
      if (!sec) return;
      const list = State.patients.filter(p => (p.Section||'Default') === sec);
      if (!list.length) { toast('No patients in this section.','warn'); return; }
      const ok = confirm(`Delete ALL ${list.length} patients in section “${sec}”? This cannot be undone.`);
      if (!ok) return;
      try {
        // Remove from UI first
        const codes = list.map(p=>p['Patient Code']);
        State.patients = State.patients.filter(p => (p.Section||'Default') !== sec);
        renderPatientsList();
        // Then delete from Sheets (bulk if available)
        const didBulk = await Sheets.deletePatientsInSection?.(sec);
        if (!didBulk) await Sheets.bulkDeletePatients?.(codes);
        toast(`Deleted ${list.length} patients in “${sec}”.`, 'success');
      } catch { toast('Failed to delete all patients from Sheets.', 'danger'); }
    });
  }

  // Settings open/save
  const openSettings = q('#open-settings');
  if (openSettings) {
    openSettings.addEventListener('click', (e)=>{
      e.preventDefault();
      q('#set-spreadsheet-id').value = State.config.spreadsheetId;
      q('#set-bridge-url').value = State.config.bridgeUrl;
      q('#set-ai-endpoint').value = State.config.aiEndpoint;
      q('#settings-modal')?.classList.remove('hidden');
    });
  }
  const saveSettings = q('#btn-settings-save');
  if (saveSettings) {
    saveSettings.addEventListener('click', async ()=>{
      State.config.spreadsheetId = q('#set-spreadsheet-id').value.trim();
      State.config.bridgeUrl     = q('#set-bridge-url').value.trim();
      State.config.aiEndpoint    = q('#set-ai-endpoint').value.trim();
      localStorage.setItem('pr.sheet', State.config.spreadsheetId);
      localStorage.setItem('pr.bridge', State.config.bridgeUrl);
      localStorage.setItem('pr.ai', State.config.aiEndpoint);
      q('#settings-modal')?.classList.add('hidden');
      await loadAllFromSheets();
      toast('Settings saved. Reconnected.', 'success');
    });
  }

  // Refresh
  const btnRefresh = q('#btn-refresh');
  if (btnRefresh) btnRefresh.addEventListener('click', async ()=>{ await loadAllFromSheets(); toast('Data refreshed.', 'success'); });

  // Close modals by [data-close-modal]
  qa('[data-close-modal]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.getAttribute('data-close-modal');
      if (!id) return;
      q('#'+id)?.classList.add('hidden');
      if (id === 'patient-modal') document.documentElement.style.overflow = '';
    });
  });

  // Symptoms write-through
  Bus.on('symptoms.changed', async ({ code, symptoms, notes })=>{
    try {
      const s = (symptoms||[]).join(', ');
      const n = JSON.stringify(notes||{});
      await Sheets.writePatientFields?.(code, { 'Symptoms': s, 'Symptoms Notes': n });
      // sync local
      const idx = State.patients.findIndex(p=>p['Patient Code']===code);
      if (idx>=0) { State.patients[idx]['Symptoms']=s; State.patients[idx]['Symptoms Notes']=n; }
      renderPatientsList();
      toast('Symptoms updated.', 'success');
    } catch { toast('Failed to sync symptoms.', 'danger'); }
  });

  // Labs write-through (keep)
  Bus.on('labs.changed', async ({ code, record })=>{
    try {
      await Sheets.writeLabs(code, record);
      Labs.upsertLocal?.(State.labs, record);
      toast('Synced', 'success');
    } catch { toast('Failed to sync Labs.', 'danger'); }
  });
}

// ===== Public Entry =====
export const App = {
  async start(){
    bindUI();
    Patients.init?.(Bus, State);
    ESAS.init?.(Bus, State);
    CTCAE.init?.(Bus, State);
    Labs.init?.(Bus, State);
    Dashboard.init?.(Bus, State);
    Importer.init?.(Bus, State);
    AIModule.init?.(Bus, State);
    Symptoms.init?.(Bus, State);

    await loadAllFromSheets();

    State.ready = true;
  },
  bus: Bus,
  state: State
};
