// js/dashboard.js
// Patient Dashboard binder: populate Bio/HPI text fields, mount ESAS + CTCAE + Labs,
// and collect a full bundle for AI/local summary — visual refresh only.

import { ESAS } from './esas.js';
import { CTCAE } from './ctcae.js';
import { Labs } from './labs.js';
import { Utils } from './utils.js';

let Bus = null, State = null;

/** ترتيب الحقول الحيوية الأساسية التي تُعرض كشبكة Bio */
const BIO_FIELDS = [
  'Patient Code',
  'Patient Name',
  'Patient Age',
  'Room',
  'Diagnosis',
  'Stage',
  'Consult Reason',
  'Referrer',
  'Allergies',
  'Medications',
  'Code Status'
];

/** نصوص طويلة شائعة (تُعرض كـ textarea) */
const LONG_TEXT_FIELDS = [
  'HPI',
  'Assessment',
  'Plan',
  'Notes'
];

/** اختصارات DOM */
const q = (sel, root = document) => root.querySelector(sel);
const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** ينظف عنصر ثم يُعيده */
function empty(node) {
  if (!node) return node;
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** حقل نصي صغير ضمن Grid (label + input) */
function makeField(labelText, value) {
  const wrap = document.createElement('div');
  wrap.className = 'field';

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = labelText;

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = value ?? '';
  // يسمح لـ app.js بالـ write-through بدون تغيير منطق
  inp.setAttribute('data-bind-field', labelText);

  wrap.appendChild(label);
  wrap.appendChild(inp);
  return wrap;
}

/** حقل نصي طويل (label + textarea) */
function makeTextArea(labelText, value) {
  const wrap = document.createElement('label');
  wrap.className = 'field';

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = labelText;

  const ta = document.createElement('textarea');
  ta.rows = 3;
  ta.value = value ?? '';
  ta.setAttribute('data-bind-field', labelText);

  wrap.appendChild(label);
  wrap.appendChild(ta);
  return wrap;
}

/** عنوان كتلة داخل البطاقة */
function makeBlockHead(iconName, titleText, extraRight = null) {
  const head = document.createElement('div');
  head.className = 'block-head';
  const icon = document.createElement('span');
  icon.className = 'mi sm';
  icon.textContent = iconName || 'info';
  const title = document.createElement('div');
  title.className = 'block-title';
  title.appendChild(icon);
  title.insertAdjacentText('beforeend', '  ');
  title.appendChild(document.createTextNode(titleText));
  head.appendChild(title);
  if (extraRight) head.appendChild(extraRight);
  return head;
}

/** يُظهر/يُخفي الحالة الفارغة للوحة */
function setDashboardEmpty(isEmpty) {
  const panel = q('#dashboard-panel');
  if (!panel) return;
  panel.setAttribute('data-empty', isEmpty ? 'true' : 'false');

  if (isEmpty) {
    // رسالة Empty ودلالات بصريّة
    let emptyDiv = panel.querySelector('.empty');
    if (!emptyDiv) {
      emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty';
      emptyDiv.innerHTML = `<div class="dots"></div><div>No patient selected.</div>`;
      panel.appendChild(emptyDiv);
    }
  } else {
    const emptyDiv = panel.querySelector('.empty');
    if (emptyDiv) emptyDiv.remove();
  }
}

/** يرسم ESAS و CTCAE داخل #symptoms-grid مع fallback بصري */
function mountSymptoms(patientCode, symptomsRoot, esos, ctc) {
  empty(symptomsRoot);

  // ESAS
  const esasWrap = document.createElement('div');
  esasWrap.className = 'score-item';
  // إذا توافرت دالة render نستخدمها، وإلا fallback
  if (typeof ESAS?.render === 'function') {
    ESAS.render(patientCode, esasWrap, esos);
  } else {
    // Fallback بصري بسيط
    const head = document.createElement('div');
    head.className = 'score-head';
    head.innerHTML = `<div class="score-title">ESAS</div><span class="muted small">Interactive UI unavailable</span>`;
    const body = document.createElement('div');
    body.className = 'small muted';
    body.textContent = 'ESAS UI is not available in this build.';
    esasWrap.appendChild(head);
    esasWrap.appendChild(body);
  }

  // CTCAE
  const ctcaeWrap = document.createElement('div');
  ctcaeWrap.className = 'score-item';
  if (typeof CTCAE?.render === 'function') {
    CTCAE.render(patientCode, ctcaeWrap, ctc);
  } else {
    const head = document.createElement('div');
    head.className = 'score-head';
    head.innerHTML = `<div class="score-title">CTCAE</div><span class="muted small">Interactive UI unavailable</span>`;
    const body = document.createElement('div');
    body.className = 'small muted';
    body.textContent = 'CTCAE UI is not available in this build.';
    ctcaeWrap.appendChild(head);
    ctcaeWrap.appendChild(body);
  }

  symptomsRoot.appendChild(esasWrap);
  symptomsRoot.appendChild(ctcaeWrap);

  // تحديث "آخر تحديث" إن وُجد (بعض البُنى في ESAS/CTCAE تستخدمه)
  const nowIso = new Date().toISOString();
  const esasUpdated = document.getElementById('esas-updated');
  if (esasUpdated) esasUpdated.textContent = 'Updated: ' + Utils.formatDateTime(nowIso);
  const ctcaeUpdated = document.getElementById('ctcae-updated');
  if (ctcaeUpdated) ctcaeUpdated.textContent = 'Updated: ' + Utils.formatDateTime(nowIso);
}

/** يرسم Labs داخل #labs-grid ويحدّث #labs-chips */
function mountLabs(patientCode, labsRoot) {
  empty(labsRoot);
  const chipsRoot = q('#labs-chips');
  if (chipsRoot) empty(chipsRoot);

  if (typeof Labs?.render === 'function') {
    Labs.render(patientCode, labsRoot);
  } else {
    // Fallback بصري
    const stub = document.createElement('div');
    stub.className = 'lab';
    stub.innerHTML = `
      <div class="lab-head">
        <div class="lab-name">Labs</div>
        <span class="muted small">Module UI unavailable</span>
      </div>
      <div class="muted small">No renderer exported from labs.js</div>`;
    labsRoot.appendChild(stub);
  }
}

/** يبني شبكة Bio + نصوص طويلة */
function mountBio(patient) {
  const grid = q('#bio-grid');
  if (!grid) return;
  empty(grid);

  // شبكة حقول صغيرة
  BIO_FIELDS.forEach((f) => {
    const val = patient?.[f] ?? '';
    grid.appendChild(makeField(f, val));
  });

  // نصوص طويلة (Textarea) — صفوف كاملة
  LONG_TEXT_FIELDS.forEach((f) => {
    // توضع textarea كسطر مستقل في الشبكة الحالية
    grid.appendChild(makeTextArea(f, patient?.[f] ?? ''));
  });
}

export const Dashboard = {
  /** ربط الـBus والـState فقط (بدون منطق إضافي) */
  init(bus, state) {
    Bus = bus;
    State = state;

    // تأكيد حالة فارغة عند البداية
    setDashboardEmpty(true);
  },

  /** يسمح للأجزاء الأخرى بإجبار حالة فارغة/غير فارغة (لأغراض إعادة الرسم) */
  clearEmpty(forceEmpty = false) {
    setDashboardEmpty(!!forceEmpty);
  },

  /** يربط مريضًا محددًا بلوحة المعلومات ويملأ كل الأقسام */
  bindPatient(patient, { esas, ctcae, labs }) {
    if (!patient) { setDashboardEmpty(true); return; }
    setDashboardEmpty(false);

    // عنوان اللوحة (إن وُجد عنصر بالـid)
    const titleEl = q('#dashboard-title');
    if (titleEl) {
      const name = patient['Patient Name'] || patient['Patient Code'] || 'Patient';
      titleEl.textContent = `Dashboard — ${name}`;
    }

    // BIO + نصوص طويلة
    mountBio(patient);

    // SYMPTOMS (ESAS + CTCAE)
    const symptomsRoot = q('#symptoms-grid');
    if (symptomsRoot) {
      // نحاول تمرير السجلات الواردة من app.js كما هي
      try {
        mountSymptoms(patient['Patient Code'], symptomsRoot, esas, ctcae);
      } catch (e) {
        console.error('Failed to mount symptoms:', e);
        empty(symptomsRoot);
        const err = document.createElement('div');
        err.className = 'muted small';
        err.textContent = 'Unable to render symptoms UI.';
        symptomsRoot.appendChild(err);
      }
    }

    // LABS
    const labsRoot = q('#labs-grid');
    if (labsRoot) {
      try {
        mountLabs(patient['Patient Code'], labsRoot);
      } catch (e) {
        console.error('Failed to mount labs:', e);
        empty(labsRoot);
        const err = document.createElement('div');
        err.className = 'muted small';
        err.textContent = 'Unable to render labs UI.';
        labsRoot.appendChild(err);
      }
    }
  },

  /** يبني حزمة كاملة لإرسالها إلى AI أو لملخص محلي */
  collectBundleForSummary(patient, { esas, ctcae, labs }) {
    return {
      patient,
      esas,
      ctcae,
      labs
    };
  }
};
