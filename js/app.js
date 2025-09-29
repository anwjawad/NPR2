// js/app.js
// Palliative Rounds — App Orchestrator (Fix: modal delete + settings via delegation)

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
import { Symptoms } from './symptoms.js';

// Defaults on first run
const DEFAULTS = {
  spreadsheetId: '1l8UoblxznwV_zz7ZqnorOWZKfnmG3pZgVCT0DaSm0kU',
  bridgeUrl: 'https://script.google.com/macros/s/AKfycbwss3LEIbDXNW0PpRJCxliRRdMMLNUqcNNMeMAVh6ZxkwiRKlTkAiYu-CxlXErwNR4Q/exec'
};
(function ensureDefaults(){
  if (!localStorage.getItem('pr.sheet')) localStorage.setItem('pr.sheet', DEFAULTS.spreadsheetId);
  if (!localStorage.getItem('pr.bridge')) localStorage.setItem('pr.bridge', DEFAULTS.bridgeUrl);
})();

// Helpers
const q = (s, r=document)=>r.querySelector(s);
const qa = (s, r=document)=>Array.from(r.querySelectorAll(s));
const toast = (m,t='info')=>UI.toast(m,t);

// Abnormal labs util
const LAB_REF = {
  'WBC':[4.0,11.0],'HGB':[12.0,16.0],'PLT':[150,450],'ANC':[1.5,8.0],'CRP':[0,5],
  'Albumin':[3.5,5.0],'Sodium (Na)':[135,145],'Potassium (K)':[3.5,5.1],'Chloride (Cl)':[98,107],
  'Calcium (Ca)':[8.5,10.5],'Phosphorus (Ph)':[2.5,4.5],'Alkaline Phosphatase (ALP)':[44,147],
  'Creatinine (Scr)':[0.6,1.3],'BUN':[7,20],'Total Bile':[0.1,1.2]
};
const parseNum = v => {
  if (v==null) return null;
  if (typeof v==='number') return Number.isFinite(v)?v:null;
  const m = String(v).trim().match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]); return Number.isNaN(n)?null:n;
};
const short = k => k.replace('Alkaline Phosphatase (ALP)','ALP')
  .replace('Creatinine (Scr)','Scr').replace('Sodium (Na)','Na')
  .replace('Potassium (K)','K').replace('Chloride (Cl)','Cl')
  .replace('Calcium (Ca)','Ca').replace('Phosphorus (Ph)','Ph');
function abnormalSummary(labs){
  if (!labs) return '';
  const arr=[];
  Object.keys(LAB_REF).forEach(k=>{
    const [lo,hi]=LAB_REF[k]; const n=parseNum(labs[k]);
    if (n==null) return;
    if (n<lo) arr.push(short(k)+'↓'); else if (n>hi) arr.push(short(k)+'↑');
  });
  return arr.join(', ');
}

// Event Bus
const Bus = (()=>{const m=new Map();return{
  on(n,f){ if(!m.has(n)) m.set(n,new Set()); m.get(n).add(f); return ()=>m.get(n)?.delete(f); },
  emit(n,p){ m.get(n)?.forEach(fn=>{ try{fn(p);}catch(e){console.error('Bus',e);} }); }
};})();

// Global State
const State = {
  ready:false, loading:false, filter:'all', search:'',
  activeSection:'Default', sections:['Default'],
  patients:[], esas:[], ctcae:[], labs:[],
  config:{
    spreadsheetId: localStorage.getItem('pr.sheet')||'',
    bridgeUrl: localStorage.getItem('pr.bridge')||'',
    useOAuth:false, aiEndpoint: localStorage.getItem('pr.ai')||''
  },
  get activePatient(){ return Patients.getActive?.()||null; }
};

// Sections
function renderSections(){
  const root=q('#sections-list'); if(!root) return; root.innerHTML='';
  State.sections.forEach(name=>{
    const btn=document.createElement('button');
    btn.className='pill ' + (name===State.activeSection?'active':'');
    btn.textContent=name;
    btn.addEventListener('click',()=>{
      State.activeSection=name;
      const label=q('#active-section-name'); if(label) label.textContent=name;
      renderPatientsList(); Dashboard.clearEmpty?.(true);
    });
    root.appendChild(btn);
  });
  const label=q('#active-section-name'); if(label) label.textContent=State.activeSection||'Default';
}
function symptomsPreview(p){
  const s=(p['Symptoms']||'').split(',').map(x=>x.trim()).filter(Boolean);
  return s.length? s.slice(0,3).join(', ')+(s.length>3?` (+${s.length-3})`:'') : '';
}
function getFilteredPatients(){
  const s=State.search.toLowerCase().trim(), f=State.filter;
  const inSec=p=>(p.Section||'Default')===State.activeSection;
  const txt=p=>!s||JSON.stringify(p).toLowerCase().includes(s);
  const st=p=> f==='all'?true : (f==='done'? !!p['Done'] : !p['Done']);
  return State.patients.filter(p=>inSec(p)&&txt(p)&&st(p));
}
function renderPatientsList(){
  const list=q('#patients-list'); if(!list) return; list.innerHTML='';
  const items=getFilteredPatients();
  if(!items.length){ const d=document.createElement('div'); d.className='empty small'; d.style.padding='16px'; d.textContent='No patients in this view.'; list.appendChild(d); return; }
  items.forEach(p=>{
    const labsRec = Labs.getForPatient(p['Patient Code'], State.labs);
    const labsAbn = p['Labs Abnormal'] || abnormalSummary(labsRec);
    const symPrev = symptomsPreview(p);

    const row=document.createElement('div'); row.className='row patient-card'; row.dataset.code=p['Patient Code']||'';
    const left=document.createElement('div');

    const header=document.createElement('div'); header.className='row-header';
    const name=document.createElement('div'); name.className='row-title linkish'; name.textContent=p['Patient Name']||'(Unnamed)';
    const badge=document.createElement('span'); badge.className='status '+(p['Done']?'done':'open'); badge.textContent=p['Done']?'Done':'Open';
    header.appendChild(name); header.appendChild(badge);

    const meta=document.createElement('div'); meta.className='row-sub';
    const dx=p['Diagnosis']?`• ${p['Diagnosis']}`:''; meta.textContent=`${p['Patient Age']||'—'} yrs • Room ${p['Room']||'—'} ${dx}`;

    const tags=document.createElement('div'); tags.className='row-tags';
    const sectionPill=document.createElement('span'); sectionPill.className='row-tag'; sectionPill.textContent=p['Section']||'Default'; tags.appendChild(sectionPill);
    if(labsAbn){ const chip=document.createElement('span'); chip.className='row-chip abn'; chip.textContent=labsAbn; tags.appendChild(chip); }
    if(symPrev){ const chip=document.createElement('span'); chip.className='row-chip sym'; chip.textContent=symPrev; tags.appendChild(chip); }

    left.appendChild(header); left.appendChild(meta); left.appendChild(tags);
    const right=document.createElement('div'); right.innerHTML='<span class="mono muted">'+(p['Patient Code']||'')+'</span>';

    row.appendChild(left); row.appendChild(right);

    // اسم المريض يفتح المودال
    name.addEventListener('click',(e)=>{
      e.stopPropagation();
      Patients.setActiveByCode?.(p['Patient Code']);
      openDashboardFor(p['Patient Code'], true);
    });

    list.appendChild(row);
  });
}

// Dashboard
function openDashboardFor(code, asModal=false){
  const patient = State.patients.find(p=>p['Patient Code']===code);
  if(!patient) return;

  // تأكيد تعيين المريض النشط + تخزين الكود على المودال
  Patients.setActiveByCode?.(code);
  const pm = q('#patient-modal'); if (pm) pm.dataset.code = code;

  const t=q('#dashboard-title'); if(t) t.textContent=`Dashboard — ${patient['Patient Name']||code}`;
  const mt=q('#patient-modal-title'); if(mt) mt.textContent=patient['Patient Name']||code;

  Dashboard.bindPatient(patient, {
    esas: ESAS.getForPatient(code, State.esas),
    ctcae: CTCAE.getForPatient(code, State.ctcae),
    labs: Labs.getForPatient(code, State.labs)
  });

  // Symptoms
  const sData = { symptoms:(patient['Symptoms']||'').split(',').map(x=>x.trim()).filter(Boolean),
                  notes: safeJSON(patient['Symptoms Notes']||'{}') };
  Symptoms.render(code, sData);

  const panel=q('#dashboard-panel'); if(panel) panel.dataset.empty='false';

  // لمس updated at
  const now=new Date().toISOString();
  Sheets.writePatientField(code,'Updated At',now).catch(()=>{});

  if(asModal) openPatientModal();
}
const safeJSON = s => { try{return JSON.parse(s);}catch{return{};} };

// Modal open/close
function openPatientModal(){
  const m=q('#patient-modal'); if(!m) return;
  m.classList.remove('hidden'); document.documentElement.style.overflow='hidden';
  const onKey=(ev)=>{ if(ev.key==='Escape'){ ev.preventDefault(); closePatientModal(); document.removeEventListener('keydown',onKey); } };
  document.addEventListener('keydown', onKey);
}
function closePatientModal(){
  const m=q('#patient-modal'); if(!m) return;
  m.classList.add('hidden'); document.documentElement.style.overflow='';
}

// Load & Sheets
async function loadAllFromSheets(){
  State.loading=true;
  try{
    await Sheets.init(State.config);
    const data=await Sheets.loadAll();
    State.sections=data.sections?.length?data.sections:['Default'];
    State.patients=Array.isArray(data.patients)?data.patients:[];
    State.esas=Array.isArray(data.esas)?data.esas:[];
    State.ctcae=Array.isArray(data.ctcae)?data.ctcae:[];
    State.labs=Array.isArray(data.labs)?data.labs:[];
    if(!data.sections?.length) await Sheets.ensureSection('Default');
    if(!State.sections.includes(State.activeSection)) State.activeSection=State.sections[0]||'Default';
    renderSections(); renderPatientsList(); Dashboard.clearEmpty?.(true);
  }catch(e){ console.error(e); toast('Failed to load from Google Sheets. Check Settings.','danger'); }
  finally{ State.loading=false; }
}

// UI binding + delegation
function bindUI(){
  UI.init?.(Bus);

  // Tabs filter
  qa('.tabs .tab').forEach(t=>{
    t.addEventListener('click',()=>{
      qa('.tabs .tab').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      State.filter=t.dataset.filter||'all';
      renderPatientsList();
    });
  });

  // Search
  const s=q('#search');
  if(s) s.addEventListener('input', Utils.debounce(e=>{ State.search=e.target.value||''; renderPatientsList(); },200));

  // Section buttons
  q('#btn-add-section')?.addEventListener('click', async ()=>{
    const name=prompt('New section name')||''; if(!name.trim()) return;
    if(State.sections.includes(name)) return toast('Section name already exists.','warn');
    try{
      await Sheets.createSection(name);
      State.sections.push(name); State.activeSection=name;
      renderSections(); renderPatientsList(); toast('Section created.','success');
    }catch{ toast('Failed to create section in Sheets.','danger'); }
  });

  q('#btn-rename-section')?.addEventListener('click', async ()=>{
    const oldName=State.activeSection; if(!oldName) return;
    const newName=prompt('Rename section:',oldName)||''; if(!newName.trim()||newName===oldName) return;
    if(State.sections.includes(newName)) return toast('Section name already exists.','warn');
    try{
      await Sheets.renameSection(oldName,newName);
      State.patients.forEach(p=>{ if((p.Section||'Default')===oldName) p.Section=newName; });
      State.sections=State.sections.map(s=>s===oldName?newName:s);
      State.activeSection=newName; renderSections(); renderPatientsList();
      toast('Section renamed.','success');
    }catch{ toast('Failed to rename section.','danger'); }
  });

  q('#btn-delete-section')?.addEventListener('click', async ()=>{
    const current=State.activeSection; if(!current) return;
    if(State.sections.length<=1){ alert('Cannot delete the last section.'); return; }
    if(!confirm(`Delete section “${current}”? Patients will be moved to “Default”.`)) return;
    try{
      if(!State.sections.includes('Default')){ await Sheets.createSection('Default'); State.sections.push('Default'); }
      const list=State.patients.filter(p=>(p.Section||'Default')===current);
      for(const p of list){ p.Section='Default'; await Sheets.writePatientField(p['Patient Code'],'Section','Default').catch(()=>{}); }
      await Sheets.deleteSection(current);
      State.sections=State.sections.filter(s=>s!==current);
      State.activeSection=State.sections[0]||'Default'; renderSections(); renderPatientsList(); Dashboard.clearEmpty?.(true);
      toast('Section deleted and patients moved to “Default”.','success');
    }catch{ toast('Failed to delete section.','danger'); }
  });

  // New patient
  q('#btn-new-patient')?.addEventListener('click', async ()=>{
    try{
      const p = Patients.createEmpty?.(State.activeSection) || {
        'Patient Code':'P'+Math.random().toString(36).slice(2,8).toUpperCase(),
        'Patient Name':'','Patient Age':'','Room':'','Admitting Provider':'','Diagnosis':'','Diet':'','Isolation':'','Comments':'',
        'Section':State.activeSection,'Done':false,'Updated At':new Date().toISOString(),
        'HPI Diagnosis':'','HPI Previous':'','HPI Current':'','HPI Initial':'','Patient Assessment':'','Medication List':'','Latest Notes':'',
        'Symptoms':'','Symptoms Notes':'{}','Labs Abnormal':''
      };
      await Sheets.insertPatient(p);
      State.patients.unshift(p); renderPatientsList();
      Patients.setActiveByCode?.(p['Patient Code']); openDashboardFor(p['Patient Code'], true);
      toast('Patient created.','success');
    }catch{ toast('Failed to create patient in Sheets.','danger'); }
  });

  // Import modal open
  q('#btn-import')?.addEventListener('click', ()=>{
    q('#csv-preview').innerHTML=''; q('#csv-file-input').value='';
    q('#import-modal')?.classList.remove('hidden');
    q('#btn-import-confirm').onclick = async ()=>{
      const rows = Importer.consumeValidatedRows?.() || [];
      if(!rows.length){ alert('No rows to import.'); return; }
      const objs = rows.map(r=>({
        'Patient Code': r[0] || ('P'+Math.random().toString(36).slice(2,8).toUpperCase()),
        'Patient Name': r[1]||'','Patient Age': r[2]||'','Room': r[3]||'','Diagnosis': r[4]||'',
        'Section': r[5]||State.activeSection,'Admitting Provider': r[6]||'','Diet': r[7]||'','Isolation': r[8]||'','Comments': r[9]||'',
        'Symptoms': r[10]||'','Symptoms Notes': r[11]||'{}','Labs Abnormal': r[12]||'',
        'Done':false,'Updated At':new Date().toISOString(),
        'HPI Diagnosis':'','HPI Previous':'','HPI Current':'','HPI Initial':'','Patient Assessment':'','Medication List':'','Latest Notes':''
      }));
      try{
        await Sheets.bulkInsertPatients(objs);
        State.patients.push(...objs); renderPatientsList();
        q('[data-close-modal="import-modal"]')?.click();
        toast(`Imported ${objs.length} patients.`,'success');
      }catch{ toast('Import failed. Check CSV order/format.','danger'); }
    };
  });

  // Export template
  q('#btn-export-template')?.addEventListener('click', ()=>{
    const headers=[
      'Patient Code','Patient Name','Patient Age','Room','Diagnosis','Section',
      'Admitting Provider','Diet','Isolation','Comments',
      'Symptoms (comma-separated)','Symptoms Notes (JSON map)','Labs Abnormal (comma-separated)'
    ];
    const csv=headers.join(',')+'\n';
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='palliative_rounds_template.csv'; a.click(); URL.revokeObjectURL(a.href);
    toast('Template downloaded.','success');
  });

  // Delete all patients in section
  q('#btn-delete-all-pats')?.addEventListener('click', async ()=>{
    const sec=State.activeSection; if(!sec) return;
    const list=State.patients.filter(p=>(p.Section||'Default')===sec);
    if(!list.length){ toast('No patients in this section.','warn'); return; }
    if(!confirm(`Delete ALL ${list.length} patients in section “${sec}”? This cannot be undone.`)) return;
    try{
      const codes=list.map(p=>p['Patient Code']);
      State.patients=State.patients.filter(p=>(p.Section||'Default')!==sec); renderPatientsList();
      const didBulk = await Sheets.deletePatientsInSection?.(sec);
      if(!didBulk) await Sheets.bulkDeletePatients?.(codes);
      toast(`Deleted ${list.length} patients in “${sec}”.`,'success');
    }catch{ toast('Failed to delete all patients from Sheets.','danger'); }
  });

  // Refresh
  q('#btn-refresh')?.addEventListener('click', async ()=>{ await loadAllFromSheets(); toast('Data refreshed.','success'); });

  // Close any modal via attribute
  qa('[data-close-modal]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id=btn.getAttribute('data-close-modal'); if(!id) return;
      q('#'+id)?.classList.add('hidden');
      if(id==='patient-modal') document.documentElement.style.overflow='';
    });
  });

  // === Delegation fixes ===

  // Settings (works even لو تغيّر العنصر)
  document.addEventListener('click', (e)=>{
    const t=e.target.closest('#open-settings'); if(!t) return;
    e.preventDefault();
    q('#set-spreadsheet-id').value = State.config.spreadsheetId;
    q('#set-bridge-url').value = State.config.bridgeUrl;
    q('#set-ai-endpoint').value = State.config.aiEndpoint;
    q('#settings-modal')?.classList.remove('hidden');
  });

  // Save settings
  q('#btn-settings-save')?.addEventListener('click', async ()=>{
    State.config.spreadsheetId = q('#set-spreadsheet-id').value.trim();
    State.config.bridgeUrl     = q('#set-bridge-url').value.trim();
    State.config.aiEndpoint    = q('#set-ai-endpoint').value.trim();
    localStorage.setItem('pr.sheet', State.config.spreadsheetId);
    localStorage.setItem('pr.bridge', State.config.bridgeUrl);
    localStorage.setItem('pr.ai', State.config.aiEndpoint);
    q('#settings-modal')?.classList.add('hidden');
    await loadAllFromSheets(); toast('Settings saved. Reconnected.','success');
  });

  // Delete patient inside modal (robust)
  document.addEventListener('click', async (e)=>{
    const btn = e.target.closest('#btn-delete-patient'); if(!btn) return;
    const modal = q('#patient-modal'); const code = modal?.dataset.code;
    let p = code ? State.patients.find(x=>x['Patient Code']===code) : State.activePatient;
    if(!p){ toast('Select a patient first.','warn'); return; }
    const ok = confirm(`Delete patient “${p['Patient Name']||p['Patient Code']}”?`);
    if(!ok) return;
    try{
      await Sheets.deletePatient(p['Patient Code']);
      State.patients = State.patients.filter(x=>x['Patient Code']!==p['Patient Code']);
      renderPatientsList(); Dashboard.clearEmpty?.(true); closePatientModal();
      toast('Patient deleted.','success');
    }catch{ toast('Failed to delete patient.','danger'); }
  });

  // Mark done
  q('#btn-mark-done')?.addEventListener('click', async ()=>{
    const modal=q('#patient-modal'); const code=modal?.dataset.code;
    const p = code ? State.patients.find(x=>x['Patient Code']===code) : State.activePatient;
    if(!p) return toast('Select a patient first.','warn');
    const newVal = !(p['Done']===true);
    try{
      p['Done']=newVal; await Sheets.writePatientField(p['Patient Code'],'Done', newVal?'TRUE':'FALSE');
      renderPatientsList(); toast(newVal?'Marked as Done.':'Marked as Open.','success');
    }catch{ toast('Failed to update Done in Sheets.','danger'); }
  });

  // Duplicate
  q('#btn-duplicate')?.addEventListener('click', async ()=>{
    const modal=q('#patient-modal'); const code=modal?.dataset.code;
    const p = code ? State.patients.find(x=>x['Patient Code']===code) : State.activePatient;
    if(!p) return toast('Select a patient first.','warn');
    try{
      const dup = Patients.duplicate?.(p) || (()=>{ const c={...p}; c['Patient Code']='P'+Math.random().toString(36).slice(2,8).toUpperCase(); c['Patient Name']=(p['Patient Name']||'')+' (Copy)'; c['Done']=false; c['Updated At']=new Date().toISOString(); return c; })();
      await Sheets.insertPatient(dup);
      State.patients.unshift(dup); renderPatientsList();
      Patients.setActiveByCode?.(dup['Patient Code']); openDashboardFor(dup['Patient Code'], true);
      toast('Duplicated.','success');
    }catch{ toast('Failed to duplicate in Sheets.','danger'); }
  });

  // Symptoms write-through
  Bus.on('symptoms.changed', async ({ code, symptoms, notes })=>{
    try{
      const s=(symptoms||[]).join(', '), n=JSON.stringify(notes||{});
      await Sheets.writePatientFields?.(code, { 'Symptoms':s, 'Symptoms Notes':n });
      const idx=State.patients.findIndex(p=>p['Patient Code']===code);
      if(idx>=0){ State.patients[idx]['Symptoms']=s; State.patients[idx]['Symptoms Notes']=n; }
      renderPatientsList(); toast('Symptoms updated.','success');
    }catch{ toast('Failed to sync symptoms.','danger'); }
  });

  // Labs write-through
  Bus.on('labs.changed', async ({ code, record })=>{
    try{ await Sheets.writeLabs(code, record); Labs.upsertLocal?.(State.labs, record); toast('Synced','success'); }
    catch{ toast('Failed to sync Labs.','danger'); }
  });
}

// Public entry
export const App = {
  async start(){
    bindUI();
    Patients.init?.(Bus, State); ESAS.init?.(Bus, State); CTCAE.init?.(Bus, State);
    Labs.init?.(Bus, State); Dashboard.init?.(Bus, State); Importer.init?.(Bus, State);
    AIModule.init?.(Bus, State); Symptoms.init?.(Bus, State);
    await loadAllFromSheets(); State.ready=true;
  },
  bus: Bus, state: State
};
