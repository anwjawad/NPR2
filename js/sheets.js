// js/sheets.js
// Google Apps Script Bridge client (JSONP-first; avoids CORS)
// Now implements real bulk deletion.

const TABS = { PATIENTS: 'Patients', ESAS: 'ESAS', CTCAE: 'CTCAE', LABS: 'Labs' };

const SCHEMA = {
  [TABS.PATIENTS]: [
    'Patient Code','Patient Name','Patient Age','Room','Admitting Provider','Diagnosis','Diet','Isolation','Comments',
    'Section','Done','Updated At','HPI Diagnosis','HPI Previous','HPI Current','HPI Initial','Patient Assessment','Medication List','Latest Notes',
    'Symptoms','Symptoms Notes','Labs Abnormal'
  ],
  [TABS.ESAS]: [
    'Patient Code','Pain','Pain Note','Tiredness','Tiredness Note','Drowsiness','Drowsiness Note','Nausea','Nausea Note',
    'Lack of Appetite','Lack of Appetite Note','Shortness of Breath','Shortness of Breath Note','Depression','Depression Note',
    'Anxiety','Anxiety Note','Wellbeing','Wellbeing Note','Updated At'
  ],
  [TABS.CTCAE]: [
    'Patient Code','Enabled','Fatigue','Fatigue Note','Sleep','Sleep Note','Nausea','Nausea Note','Vomiting','Vomiting Note',
    'Constipation','Constipation Note','Diarrhea','Diarrhea Note','Dyspnea','Dyspnea Note','Odynophagia','Odynophagia Note',
    'Dysphagia','Dysphagia Note','Confusion/Delirium','Confusion/Delirium Note','Peripheral Neuropathy','Peripheral Neuropathy Note',
    'Mucositis','Mucositis Note','Other','Updated At'
  ],
  [TABS.LABS]: [
    'Patient Code','WBC','HGB','PLT','ANC','CRP','Albumin','CRP Trend','Sodium (Na)','Potassium (K)','Chloride (Cl)',
    'Calcium (Ca)','Phosphorus (Ph)','Alkaline Phosphatase (ALP)','Creatinine (Scr)','BUN','Total Bile','Other','Updated At'
  ]
};

let CONFIG = { spreadsheetId:'', bridgeUrl:'', useOAuth:false };

function assertConfig(){
  if (!CONFIG.spreadsheetId) throw new Error('Spreadsheet ID is required.');
  if (!CONFIG.bridgeUrl)     throw new Error('Bridge URL is required.');
}

// ---------- JSONP core ----------
function jsonp(url){
  return new Promise((resolve, reject)=>{
    const cbName = 'pr_cb_' + Math.random().toString(36).slice(2);
    const sep = url.includes('?') ? '&' : '?';
    const full = `${url}${sep}callback=${cbName}`;
    const s = document.createElement('script');
    const timer = setTimeout(()=>{ cleanup(); reject(new Error('Bridge timeout')); }, 30000);

    function cleanup(){
      clearTimeout(timer);
      try{ delete window[cbName]; }catch{}
      if (s.parentNode) s.parentNode.removeChild(s);
    }

    window[cbName] = function(resp){
      cleanup();
      try{
        if (!resp || resp.ok !== true) reject(new Error(resp && resp.error ? resp.error : 'Bridge error'));
        else resolve(resp.data);
      }catch(e){ reject(e); }
    };

    s.onerror = ()=>{ cleanup(); reject(new Error('Bridge network error')); };
    s.src = full;
    document.head.appendChild(s);
  });
}

function buildQuery(action, payload){
  assertConfig();
  const params = new URLSearchParams();
  params.set('action', action);
  params.set('spreadsheetId', CONFIG.spreadsheetId);
  params.set('payload', JSON.stringify(payload || {}));
  return `${CONFIG.bridgeUrl}?${params.toString()}`;
}

async function bridgeCallJSONP(action, payload){
  const url = buildQuery(action, payload);
  return jsonp(url);
}

// ---------- helpers ----------
function toRowFromObject(obj, tabName){
  const cols = SCHEMA[tabName] || [];
  return cols.map(c => (obj && obj[c] != null) ? obj[c] : '');
}
function chunk(arr, n){ const out=[]; for(let i=0;i<arr.length;i+=n) out.push(arr.slice(i,i+n)); return out; }

// ---------- Public API ----------
export const Sheets = {
  async init(config){
    CONFIG = {
      spreadsheetId: config.spreadsheetId,
      bridgeUrl: (config.bridgeUrl || '').replace(/\/$/, ''), // drop trailing slash
      useOAuth: false
    };
    return true;
  },

  async loadAll(){
    return bridgeCallJSONP('loadAll', {});
  },

  async ensureSection(){ await bridgeCallJSONP('ensureSection', {}); return true; },
  async createSection(){ return true; },
  async renameSection(oldName, newName){ await bridgeCallJSONP('renameSection', { oldName, newName }); return true; },
  async deleteSection(name){ await bridgeCallJSONP('deleteSection', { name }); return true; },

  async insertPatient(obj){
    const row = toRowFromObject(obj, TABS.PATIENTS);
    await bridgeCallJSONP('insertPatient', { row }); return true;
  },

  async bulkInsertPatients(objs){
    const rows = (objs||[]).map(o => toRowFromObject(o, TABS.PATIENTS));
    const batches = chunk(rows, 5); // keep URL size safe
    for (const batch of batches){ await bridgeCallJSONP('bulkInsertPatients', { rows: batch }); }
    return true;
  },

  async writePatientField(code, field, value){
    await bridgeCallJSONP('writePatientField', { code, field, value }); return true;
  },

  async writePatientFields(code, fields){
    await bridgeCallJSONP('writePatientFields', { code, fields }); return true;
  },

  async deletePatient(code){
    await bridgeCallJSONP('deletePatient', { code }); return true;
  },

  async writeESAS(code, obj){
    const row = toRowFromObject(obj, TABS.ESAS);
    await bridgeCallJSONP('writeESAS', { row }); return true;
  },

  async writeCTCAE(code, obj){
    const row = toRowFromObject(obj, TABS.CTCAE);
    await bridgeCallJSONP('writeCTCAE', { row }); return true;
  },

  async writeLabs(code, obj){
    const row = toRowFromObject(obj, TABS.LABS);
    await bridgeCallJSONP('writeLabs', { row }); return true;
  },

  // ===== Bulk deletion implementations =====
  // 1) احذف جميع مرضى قسم محدّد (لو تحب تعتمد عليها من الواجهة)
  async deletePatientsInSection(section){
    if (!section) return false;
    // جِب كل البيانات ثم صفّي الأكواد بحسب القسم
    const data = await this.loadAll().catch(()=>null);
    if (!data || !Array.isArray(data.patients)) return false;
    const codes = data.patients
      .filter(p => (p.Section || 'Default') === section)
      .map(p => p['Patient Code'])
      .filter(Boolean);
    if (!codes.length) return true;
    await this.bulkDeletePatients(codes);
    return true;
  },

  // 2) حذف دفعي عبر تكرار نداء deletePatient (JSONP)
  async bulkDeletePatients(codes){
    const list = Array.isArray(codes) ? codes.filter(Boolean) : [];
    if (!list.length) return true;
    // نفّذها على دفعات صغيرة لتجنّب ضغط الشبكة
    const batches = chunk(list, 5);
    for (const batch of batches){
      for (const code of batch){
        try{ await this.deletePatient(code); }
        catch(e){ console.warn('Failed to delete', code, e); /* نكمل */ }
      }
    }
    return true;
  }
};
