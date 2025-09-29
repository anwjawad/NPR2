// js/ui.js
// UI helpers: toasts, modals, modern confirm/prompt dialogs, small UX niceties.

let BusRef = null;

const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ===========================
   Toast Manager
   =========================== */

const Toasts = (() => {
  const root = () => qs('#toast-root');

  function makeToast(message, type = 'info', opts = {}) {
    const div = document.createElement('div');
    div.className = 'toast ' + (type || 'info');
    if (opts.id) div.id = opts.id;

    const text = document.createElement('div');
    text.textContent = message || '';
    div.appendChild(text);

    root().appendChild(div);

    const ttl = typeof opts.ttl === 'number' ? opts.ttl : (type === 'danger' ? 6000 : 3500);
    if (ttl > 0) {
      setTimeout(() => div.remove(), ttl);
    }
    return div;
  }

  return {
    show: makeToast,
    clearAll() { root().innerHTML = ''; }
  };
})();

/* ===========================
   Modal Manager
   =========================== */

const Modals = (() => {
  let openCount = 0;

  function lockScroll() {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  function unlockScroll() {
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  function open(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('hidden');
    openCount++;
    lockScroll();

    // Focus first focusable
    const focusable = qsa('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])', el)
      .filter(n => !n.hasAttribute('disabled'));
    if (focusable[0]) focusable[0].focus();

    // Close when clicking X buttons (already wired in app.js via [data-close-modal], but keep fallback)
    qsa('[data-close-modal]', el).forEach(btn => {
      btn.addEventListener('click', () => close(id), { once: true });
    });

    // Escape to close
    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        close(id);
        document.removeEventListener('keydown', onKey);
      }
    };
    document.addEventListener('keydown', onKey);
  }

  function close(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('hidden');
    openCount = Math.max(0, openCount - 1);
    if (openCount === 0) unlockScroll();
  }

  // Build a lightweight, disposable modal for confirm/prompt
  function buildDialog({ title, message, type = 'confirm', defaultValue = '' }) {
    const wrapper = document.createElement('div');
    wrapper.className = 'modal';
    wrapper.role = 'dialog';
    wrapper.ariaModal = 'true';

    const card = document.createElement('div');
    card.className = 'modal-card';
    card.style.maxWidth = '520px';

    const header = document.createElement('div');
    header.className = 'modal-header';

    const h3 = document.createElement('h3');
    h3.textContent = title || (type === 'prompt' ? 'Input' : 'Confirm');

    const x = document.createElement('button');
    x.className = 'icon-btn';
    x.textContent = '✕';
    x.setAttribute('aria-label', 'Close');

    header.appendChild(h3);
    header.appendChild(x);

    const body = document.createElement('div');
    body.className = 'modal-body';

    const msg = document.createElement('div');
    msg.textContent = message || '';
    msg.className = 'muted';

    body.appendChild(msg);

    let input = null;
    if (type === 'prompt') {
      const field = document.createElement('label');
      field.className = 'field';
      const lab = document.createElement('span');
      lab.className = 'label';
      lab.textContent = 'Value';
      input = document.createElement('input');
      input.type = 'text';
      input.value = defaultValue || '';
      field.appendChild(lab);
      field.appendChild(input);
      body.appendChild(field);
    }

    const footer = document.createElement('div');
    footer.className = 'modal-footer';

    const cancel = document.createElement('button');
    cancel.className = 'btn btn-ghost';
    cancel.textContent = 'Cancel';

    const ok = document.createElement('button');
    ok.className = 'btn btn-primary';
    ok.textContent = type === 'prompt' ? 'OK' : 'Confirm';

    footer.appendChild(cancel);
    footer.appendChild(ok);

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(footer);

    wrapper.appendChild(card);
    document.body.appendChild(wrapper);

    // interactions
    const closeDialog = () => {
      wrapper.remove();
      // unlock scroll if no other modal visible
      // Note: main modal manager uses openCount, but here dialogs are independent; safe unlock.
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };

    x.addEventListener('click', closeDialog);
    cancel.addEventListener('click', closeDialog);

    return {
      el: wrapper,
      okBtn: ok,
      input,
      open: () => {
        // lock scroll
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        // focus
        (input || ok).focus();

        // Esc to close
        const onKey = (ev) => {
          if (ev.key === 'Escape') {
            ev.preventDefault();
            closeDialog();
            document.removeEventListener('keydown', onKey);
          }
          if (type === 'prompt' && ev.key === 'Enter' && document.activeElement === input) {
            ok.click();
          }
        };
        document.addEventListener('keydown', onKey);
      },
      close: closeDialog
    };
  }

  async function confirm(message, title = 'Confirm') {
    return new Promise((resolve) => {
      const dlg = buildDialog({ title, message, type: 'confirm' });
      dlg.okBtn.addEventListener('click', () => {
        dlg.close();
        resolve(true);
      });
      // if user clicks outside card, don't close (to avoid accidental dismiss)
      dlg.el.addEventListener('click', (e) => {
        if (e.target === dlg.el) { /* ignore click outside */ }
      });
      dlg.open();
    }).catch(() => false);
  }

  async function prompt(message, defaultValue = '', title = 'Input') {
    return new Promise((resolve) => {
      const dlg = buildDialog({ title, message, type: 'prompt', defaultValue });
      dlg.okBtn.addEventListener('click', () => {
        const val = dlg.input?.value ?? '';
        dlg.close();
        resolve(val);
      });
      dlg.open();
    });
  }

  return { open, close, confirm, prompt };
})();

/* ===========================
   Public UI API
   =========================== */

export const UI = {
  init(Bus) {
    BusRef = Bus;

    // Close modals via [data-close-modal] attribute (delegated in app.js as well)
    document.body.addEventListener('click', (e) => {
      const target = e.target.closest('[data-close-modal]');
      if (target) {
        const id = target.getAttribute('data-close-modal');
        if (id) Modals.close(id);
      }
    });

    // Accessibility: focus outline on keyboard nav
    let usingKeyboard = false;
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') usingKeyboard = true;
      if (usingKeyboard) document.documentElement.classList.add('kbd-nav');
    });
    window.addEventListener('mousedown', () => {
      usingKeyboard = false;
      document.documentElement.classList.remove('kbd-nav');
    });
  },

  toast(message, type = 'info', opts = {}) {
    return Toasts.show(message, type, opts);
  },

  openModal(id) { Modals.open(id); },
  closeModal(id) { Modals.close(id); },

  async confirm(message, title) {
    return await Modals.confirm(message, title);
  },

  async prompt(message, defaultValue) {
    return await Modals.prompt(message, defaultValue);
  }
};