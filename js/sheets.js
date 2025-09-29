// js/sheets.js
// Google Apps Script Bridge client (no OAuth). Provides a simple API used by app.js.

import { Utils } from './utils.js';

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

async function bridgeCall(action, payload={}){
  assertConfig();
  const body = JSON.stringify({
    action,
    spreadsheetId: CONFIG.spreadsheetId,
    payload
  });
  const res = await fetch(CONFIG.bridgeUrl, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body
  });
  if (!res.ok) throw new Error(`Bridge HTTP ${res.status}`);
  const json = await res.json().catch(()=>({ ok:false, error:'Invalid JSON from bridge' }));
  if (!json || json.ok !== true) throw new Error(json && json.error ? json.error : 'Bridge error');
  return json.data;
}

function toRowFromObject(obj, tabName){
  const cols = SCHEMA[tabName] || [];
  return cols.map(c => (obj && obj[c] != null) ? obj[c] : '');
}

function toObjectsFromArrays(tabName, rows){
  const cols = SCHEMA[tabName] || [];
  return (rows||[]).map(r=>{
    const o={};
    for (let i=0;i<cols.length;i++) o[cols[i]] = (r[i] ?? '');
    return o;
  });
}

export const Sheets = {
  async init(config){
    CONFIG = {
      spreadsheetId: config.spreadsheetId,
      bridgeUrl: config.bridgeUrl,
      useOAuth: false
    };
    // optional sanity
    return true;
  },

  async loadAll(){
    const data = await bridgeCall('loadAll', {});
    // already objects from GAS
    return data;
  },

  async ensureSection(name){
    await bridgeCall('ensureSection', {});
    return true;
  },

  async createSection(name){
    // (No-op on server; kept for API symmetry)
    return true;
  },

  async renameSection(oldName, newName){
    await bridgeCall('renameSection', { oldName, newName });
    return true;
  },

  async deleteSection(name){
    await bridgeCall('deleteSection', { name });
    return true;
  },

  async insertPatient(obj){
    const row = toRowFromObject(obj, TABS.PATIENTS);
    await bridgeCall('insertPatient', { row });
    return true;
  },

  async bulkInsertPatients(objs){
    const rows = (objs||[]).map(o => toRowFromObject(o, TABS.PATIENTS));
    await bridgeCall('bulkInsertPatients', { rows });
    return true;
  },

  async writePatientField(code, field, value){
    await bridgeCall('writePatientField', { code, field, value });
    return true;
  },

  async writePatientFields(code, fields){
    await bridgeCall('writePatientFields', { code, fields });
    return true;
  },

  async deletePatient(code){
    await bridgeCall('deletePatient', { code });
    return true;
  },

  async writeESAS(code, obj){
    const row = toRowFromObject(obj, TABS.ESAS);
    await bridgeCall('writeESAS', { row });
    return true;
  },

  async writeCTCAE(code, obj){
    const row = toRowFromObject(obj, TABS.CTCAE);
    await bridgeCall('writeCTCAE', { row });
    return true;
  },

  async writeLabs(code, obj){
    const row = toRowFromObject(obj, TABS.LABS);
    await bridgeCall('writeLabs', { row });
    return true;
  },

  // Optional helpers used by app.js if available; safe fallbacks
  async deletePatientsInSection(section){ return false; },
  async bulkDeletePatients(codes){ return false; }
};
