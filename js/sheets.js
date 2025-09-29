// js/sheets.js
// Bridge (Apps Script Web App) + optional OAuth (not used now)
// تم تحديث المخطط لإضافة الحقول الجديدة:
//   - Symptoms
//   - Symptoms Notes
//   - Labs Abnormal
// كما تمت إضافة عمليات جماعية اختيارية (bulk) مع fallback تلقائي.

import { Utils } from './utils.js';

const TABS = { PATIENTS: 'Patients', ESAS: 'ESAS', CTCAE: 'CTCAE', LABS: 'Labs' };

// ===== مخطط الأعمدة لكل تبويب في Google Sheets =====
// ملاحظة: ترتيب الأعمدة مهم جداً لعمليات الإدراج/التحديث المباشر عبر OAuth.
const SCHEMA = {
  Patients: [
    'Patient Code','Patient Name','Patient Age','Room','Admitting Provider','Diagnosis','Diet','Isolation','Comments',
    'Section','Done','Updated At',
    'HPI Diagnosis','HPI Previous','HPI Current','HPI Initial','Patient Assessment','Medication List','Latest Notes',
    // ↓ حقول الميزات الجديدة
    'Symptoms','Symptoms Notes','Labs Abnormal'
  ],
  ESAS: [
    'Patient Code','Pain','Pain Note','Tiredness','Tiredness Note','Drowsiness','Drowsiness Note','Nausea','Nausea Note',
    'Lack of Appetite','Lack of Appetite Note','Shortness of Breath','Shortness of Breath Note','Depression','Depression Note',
    'Anxiety','Anxiety Note','Wellbeing','Wellbeing Note','Updated At'
  ],
  CTCAE: [
    'Patient Code','Enabled','Fatigue','Fatigue Note','Sleep','Sleep Note','Nausea','Nausea Note','Vomiting','Vomiting Note',
    'Constipation','Constipation Note','Diarrhea','Diarrhea Note','Dyspnea','Dyspnea Note','Odynophagia','Odynophagia Note',
    'Dysphagia','Dysphagia Note','Confusion/Delirium','Confusion/Delirium Note','Peripheral Neuropathy','Peripheral Neuropathy Note',
    'Mucositis','Mucositis Note','Other','Updated At'
  ],
  Labs: [
    'Patient Code','WBC','HGB','PLT','ANC','CRP','Albumin','CRP Trend','Sodium (Na)','Potassium (K)','Chloride (Cl)',
    'Calcium (Ca)','Phosphorus (Ph)','Alkaline Phosphatase (ALP)','Creatinine (Scr)','BUN','Total Bile','Other','Updated At'
  ]
};

let MODE = 'BRIDGE';
let CONFIG = { spreadsheetId: '', bridgeUrl: '', useOAuth: false, clientId: '', apiKey: '' };

function assertConfig() {
  if (!CONFIG.spreadsheetId) throw new Error('Spreadsheet ID is required.');
  if (MODE === 'BRIDGE' && !CONFIG.bridgeUrl) throw new Error('Bridge URL is required in Bridge mode.');
}

function toRowFromObject(obj, tab) {
  const cols = SCHEMA[tab];
  return cols.map(c => obj?.[c] ?? '');
}
function toObjectFromRow(row, tab) {
  const cols = SCHEMA[tab];
  const out = {};
  cols.forEach((c, i) => (out[c] = row[i] ?? ''));
  return out;
}

// -------- JSONP (fallback لا يحتاج CORS) --------
function jsonpCall(url, params, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const cbName = '__pr_jsonp__' + Math.random().toString(36).slice(2);
    const cleanup = () => {
      try { delete window[cbName]; } catch {}
      if (script.parentNode) script.parentNode.removeChild(script);
      clearTimeout(timer);
    };
    const qs = new URLSearchParams({
      spreadsheetId: CONFIG.spreadsheetId,
      action: params.action,
      payload: JSON.stringify(params.payload || {}),
      callback: cbName
    }).toString();

    const script = document.createElement('script');
    script.src = `${url}?${qs}`;
    script.async = true;

    window[cbName] = (resp) => {
      cleanup();
      if (!resp || resp.ok === false) reject(new Error(resp && resp.error ? resp.error : 'Bridge JSONP error'));
      else resolve(resp.data ?? null);
    };

    const timer = setTimeout(() => { cleanup(); reject(new Error('Bridge JSONP timeout')); }, timeoutMs);
    script.onerror = () => { cleanup(); reject(new Error('Bridge JSONP network error')); };

    document.head.appendChild(script);
  });
}

// -------- Bridge call (POST → GET → JSONP) --------
async function bridgeCall(action, payload = {}) {
  assertConfig();
  const url = CONFIG.bridgeUrl;
  const body = JSON.stringify({ action, spreadsheetId: CONFIG.spreadsheetId, payload });

  // 1) POST
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Bridge returned error');
    return json.data ?? null;
  } catch (ePost) {
    console.warn('Bridge POST failed:', ePost.message);
  }

  // 2) GET
  try {
    const qp = new URLSearchParams({
      spreadsheetId: CONFIG.spreadsheetId,
      action,
      payload: JSON.stringify(payload)
    });
    const res = await fetch(`${url}?${qp.toString()}`, { method: 'GET', credentials: 'omit' });
    if (!res.ok) throw new Error(`Bridge GET HTTP ${res.status}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Bridge returned error (GET)');
    return json.data ?? null;
  } catch (eGet) {
    console.warn('Bridge GET failed:', eGet.message);
  }

  // 3) JSONP
  return await jsonpCall(url, { action, payload });
}

// -------- (اختياري) OAuth API — لن نستخدمه الآن --------
let gapiReady = false;
async function ensureGapiLoaded(){
  if (gapiReady) return;
  await new Promise((res, rej) => {
    const c = () => window.gapi ? res() : setTimeout(c, 50);
    c();
    setTimeout(() => { if (!window.gapi) rej(new Error('gapi failed to load')); }, 10000);
  });
  await new Promise((res, rej) => { window.gapi.load('client:auth2', { callback: res, onerror: rej }); });
  await window.gapi.client.init({
    apiKey: CONFIG.apiKey,
    clientId: CONFIG.clientId,
    discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
    scope: 'https://www.googleapis.com/auth/spreadsheets'
  });
  gapiReady = true;
}
async function oauthEnsureSignedIn(){
  const a = window.gapi.auth2.getAuthInstance();
  if (!a.isSignedIn.get()) await a.signIn();
}
async function oauthReadRange(rangeA1){
  await ensureGapiLoaded(); await oauthEnsureSignedIn();
  const r = await window.gapi.client.sheets.spreadsheets.values.get({ spreadsheetId: CONFIG.spreadsheetId, range: rangeA1 });
  return r.result.values || [];
}
async function oauthWriteRange(rangeA1, values, valueInputOption='RAW'){
  await ensureGapiLoaded(); await oauthEnsureSignedIn();
  return (await window.gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId: CONFIG.spreadsheetId,
    range: rangeA1,
    valueInputOption,
    resource: { values }
  })).result;
}
async function oauthAppend(tab, rows){
  const range = `${tab}!A1:${colLetter(SCHEMA[tab].length)}`;
  await ensureGapiLoaded(); await oauthEnsureSignedIn();
  await window.gapi.client.sheets.spreadsheets.values.append({
    spreadsheetId: CONFIG.spreadsheetId,
    range,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: { values: rows }
  });
}
function colLetter(n){ let s=''; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26);} return s; }
function normalizeLoadAll(data){
  const norm=(arr,tab)=>Array.isArray(arr)?(Array.isArray(arr[0])?arr.map(r=>toObjectFromRow(r,tab)):arr):[];
  return {
    sections: Array.isArray(data.sections) ? data.sections : ['Default'],
    patients: norm(data.patients, TABS.PATIENTS),
    esas: norm(data.esas, TABS.ESAS),
    ctcae: norm(data.ctcae, TABS.CTCAE),
    labs: norm(data.labs, TABS.LABS)
  };
}

// ===== Public API =====
export const Sheets = {
  /** التهيئة: يرسل ترويسات الجداول للـ Bridge كي يؤمن وجودها بالترتيب الصحيح */
  async init(config){
    CONFIG = { ...CONFIG, ...config };
    MODE = config.useOAuth ? 'OAUTH' : 'BRIDGE';
    if (MODE === 'BRIDGE') {
      // نطلب من الـBridge التأكد من وجود الجداول والترويسات (إنشاء/تصحيح)
      await bridgeCall('initSheets', {
        tabs: Object.keys(SCHEMA).map(name => ({ name, headers: SCHEMA[name] }))
      });
    } else {
      await ensureGapiLoaded();
    }
  },

  /** تحميل جميع الجداول المطلوبة إلى الواجهة */
  async loadAll(){
    if (MODE === 'BRIDGE') {
      const data = await bridgeCall('loadAll', {});
      return normalizeLoadAll(data);
    }
    // OAuth (قراءه مباشرة للنطاقات)
    const [patients, esas, ctcae, labs] = await Promise.all([
      oauthReadRange(`${TABS.PATIENTS}!A2:${colLetter(SCHEMA[TABS.PATIENTS].length)}`),
      oauthReadRange(`${TABS.ESAS}!A2:${colLetter(SCHEMA[TABS.ESAS].length)}`),
      oauthReadRange(`${TABS.CTCAE}!A2:${colLetter(SCHEMA[TABS.CTCAE].length)}`),
      oauthReadRange(`${TABS.LABS}!A2:${colLetter(SCHEMA[TABS.LABS].length)}`)
    ]);
    const patientsObjs = patients.map(r => toObjectFromRow(r, TABS.PATIENTS));
    const sections = Array.from(new Set(patientsObjs.map(p => p.Section).filter(Boolean)));
    return {
      sections: sections.length ? sections : ['Default'],
      patients: patientsObjs,
      esas: esas.map(r => toObjectFromRow(r, TABS.ESAS)),
      ctcae: ctcae.map(r => toObjectFromRow(r, TABS.CTCAE)),
      labs: labs.map(r => toObjectFromRow(r, TABS.LABS))
    };
  },

  // ===== إدارة الأقسام =====
  async ensureSection(name){ if (MODE==='BRIDGE') return await bridgeCall('ensureSection',{name}); return true; },
  async createSection(name){ if (MODE==='BRIDGE') return await bridgeCall('createSection',{name}); return true; },
  async renameSection(oldName,newName){ if (MODE==='BRIDGE') return await bridgeCall('renameSection',{oldName,newName}); throw new Error('Rename section not supported in OAuth mode in this client.'); },
  async deleteSection(name){ if (MODE==='BRIDGE') return await bridgeCall('deleteSection',{name}); throw new Error('Delete section not supported in OAuth mode in this client.'); },

  // ===== المرضى =====
  async insertPatient(obj){
    const row = toRowFromObject(obj, TABS.PATIENTS);
    if (MODE==='BRIDGE') return await bridgeCall('insertPatient', { tab: TABS.PATIENTS, row });
    return await oauthAppend(TABS.PATIENTS, [row]);
  },

  async bulkInsertPatients(objs){
    const rows = objs.map(o => toRowFromObject(o, TABS.PATIENTS));
    if (MODE==='BRIDGE') return await bridgeCall('bulkInsertPatients', { tab: TABS.PATIENTS, rows });
    return await oauthAppend(TABS.PATIENTS, rows);
  },

  /** كتابة حقل مفرد في جدول Patients */
  async writePatientField(code, field, value){
    if (MODE==='BRIDGE') return await bridgeCall('writePatientField', { code, field, value });
    // OAuth fallback (بحث عن الصف + تحديث خلية واحدة)
    const colIndex = SCHEMA[TABS.PATIENTS].indexOf(field);
    if (colIndex < 0) throw new Error('Invalid patient field: ' + field);
    const rows = await oauthReadRange(`${TABS.PATIENTS}!A2:${colLetter(SCHEMA[TABS.PATIENTS].length)}`);
    const idx = rows.findIndex(r => (r[0] || '') === code);
    if (idx < 0) throw new Error('Patient not found: ' + code);
    const rowA1 = idx + 2;
    const rangeA1 = `${TABS.PATIENTS}!${colLetter(colIndex + 1)}${rowA1}`;
    return await oauthWriteRange(rangeA1, [[value]]);
  },

  /**
   * كتابة عدة حقول دفعة واحدة (اختياري — يستخدمه الواجهات لتحديث "Symptoms" و"Symptoms Notes" معاً)
   * Bridge action: writePatientFields { code, fields: {k:v} }
   * Fallback: ينفذ writePatientField لكل مفتاح.
   */
  async writePatientFields(code, fieldsObj = {}){
    if (MODE==='BRIDGE') {
      try { return await bridgeCall('writePatientFields', { code, fields: fieldsObj }); }
      catch (e) { console.warn('writePatientFields bridge not available, falling back.', e?.message); }
    }
    // Fallback
    for (const [k,v] of Object.entries(fieldsObj || {})) {
      await this.writePatientField(code, k, v ?? '');
    }
    return true;
  },

  /** حذف مريض واحد */
  async deletePatient(code){
    if (MODE==='BRIDGE') return await bridgeCall('deletePatient', { code });
    throw new Error('Delete patient not supported in OAuth mode in this client.');
  },

  /**
   * حذف جماعي لعدة مرضى (إن توفّر في الـBridge) وإلاّ fallback بالتوازي.
   * Bridge action: bulkDeletePatients { codes: string[] }
   */
  async bulkDeletePatients(codes = []){
    if (!Array.isArray(codes) || codes.length === 0) return true;
    if (MODE==='BRIDGE') {
      try { return await bridgeCall('bulkDeletePatients', { codes }); }
      catch (e) { console.warn('bulkDeletePatients bridge not available, falling back.', e?.message); }
    }
    // Fallback: نفّذ الحذف واحداً تلو الآخر
    await Promise.allSettled(codes.map(c => this.deletePatient(c)));
    return true;
  },

  /**
   * حذف كل المرضى داخل قسم محدد عبر الـBridge (اختياري).
   * Bridge action: deletePatientsInSection { section: string }
   * إن لم يتوفّر، على مستوى الواجهة سنستخدم fallback بحذف مفرد.
   */
  async deletePatientsInSection(section){
    if (!section) return true;
    if (MODE==='BRIDGE') {
      try { return await bridgeCall('deletePatientsInSection', { section }); }
      catch (e) { console.warn('deletePatientsInSection not available on bridge.', e?.message); }
    }
    // لا Fallback هنا داخل الموصل لأننا لا نملك حالة المرضى؛ تترك للواجهة.
    return false;
  },

  // ===== ESAS/CTCAE/Labs (إبقاء التوافق مع الجداول الحالية) =====
  async writeESAS(code, obj){
    const row = toRowFromObject(obj, TABS.ESAS);
    if (MODE==='BRIDGE') return await bridgeCall('writeESAS', { row });
    return await oauthAppend(TABS.ESAS, [row]);
  },

  async writeCTCAE(code, obj){
    const row = toRowFromObject(obj, TABS.CTCAE);
    if (MODE==='BRIDGE') return await bridgeCall('writeCTCAE', { row });
    return await oauthAppend(TABS.CTCAE, [row]);
  },

  async writeLabs(code, obj){
    const row = toRowFromObject(obj, TABS.LABS);
    if (MODE==='BRIDGE') return await bridgeCall('writeLabs', { row });
    return await oauthAppend(TABS.LABS, [row]);
  }
};
