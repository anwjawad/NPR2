// ui.js — minimal UI helpers (toast + theme)
let BusRef = null;

function $(sel, root=document){ return root.querySelector(sel); }

function showToast(msg, type='info'){
  const el = $('#toast'); if (!el) return;
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=>{ el.classList.remove('show'); }, 2600);
}

function getTheme(){
  const t = localStorage.getItem('pr.theme');
  return t || 'midnight';
}
function applyTheme(theme){
  const t = theme || getTheme();
  document.documentElement.setAttribute('data-theme', t);
  // sync radios if exist
  const ids = { midnight:'#set-theme-midnight', ocean:'#set-theme-ocean', ivory:'#set-theme-ivory' };
  Object.entries(ids).forEach(([key,sel])=>{
    const r = $(sel); if (r) r.checked = (t===key);
  });
}
function setTheme(theme){
  localStorage.setItem('pr.theme', theme);
  applyTheme(theme);
}

export const UI = {
  init(Bus){
    BusRef = Bus;
    applyTheme(); // on boot

    // radio listeners (if settings modal is open)
    ['midnight','ocean','ivory'].forEach(name=>{
      const r = document.getElementById(`set-theme-${name}`);
      if (r) r.addEventListener('change', ()=>{ if (r.checked) setTheme(name); });
    });
  },
  toast: showToast,
  getTheme,
  applyTheme,
  setTheme
};
