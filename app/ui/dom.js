/**
 * DOM helpers. No inline event handlers anywhere in the app: clicks are
 * delegated through data-act attributes (see `on`), and every string that
 * reaches innerHTML goes through esc() — repo JSON (including the plan the
 * coach writes) is untrusted.
 */

export function $(id) { return document.getElementById(id); }
export function qs(sel, root) { return (root || document).querySelector(sel); }
export function qsa(sel, root) { return [...(root || document).querySelectorAll(sel)]; }

/** HTML-escape, including quotes and apostrophes. */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Escape for use inside an attribute value (same as esc, kept for intent). */
export const attr = esc;

/** Tagged template that escapes interpolations unless wrapped in raw(). */
export function html(strings, ...vals) {
  return new Raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? render(vals[i]) : ''), ''));
}
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export function raw(s) { return new Raw(String(s == null ? '' : s)); }
function render(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  if (v == null || v === false) return '';
  return esc(v);
}

// ---- delegated actions ----
const actions = new Map();
/** Register a click action: <button data-act="name" data-x="1"> -> fn(dataset, el, event). */
export function on(name, fn) { actions.set(name, fn); }
export function act(name, data) {
  const parts = [`data-act="${attr(name)}"`];
  Object.entries(data || {}).forEach(([k, v]) => { if (v != null) parts.push(`data-${k}="${attr(v)}"`); });
  return raw(parts.join(' '));
}
let _wired = false;
export function wireDelegation() {
  if (_wired) return; _wired = true;
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = actions.get(el.dataset.act);
    if (!fn) return;
    e.preventDefault();
    try { const r = fn({ ...el.dataset }, el, e); if (r && r.catch) r.catch(err => { console.error(err); toast(err.message || String(err), 'err'); }); }
    catch (err) { console.error(err); toast(err.message || String(err), 'err'); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

// ---- toast / loading / modal ----
let _tt;
export function toast(msg, type) {
  const el = $('toast'); if (!el) return;
  el.textContent = msg; el.className = `on${type ? ' ' + type : ''}`;
  clearTimeout(_tt); _tt = setTimeout(() => { el.className = ''; }, 3500);
}

export function showLoading(msg) { $('ldmsg').textContent = msg || 'Loading…'; $('ld').classList.add('on'); }
export function hideLoading() { $('ld').classList.remove('on'); }

export function modal(inner) {
  $('mdbody').innerHTML = inner;
  $('mov').classList.add('on');
  const first = qs('input,select,textarea', $('mdbody'));
  if (first && first.type !== 'file') setTimeout(() => first.focus(), 50);
}
export function closeModal() { $('mov').classList.remove('on'); $('mdbody').innerHTML = ''; }
export function modalOpen() { return $('mov').classList.contains('on'); }

/** Promise-based confirm using the app's modal (no window.confirm). */
export function confirmDialog(title, body, { ok = 'OK', danger = false, cancel = 'Cancel' } = {}) {
  return new Promise(resolve => {
    modal(html`<h2>${title}</h2>${body ? html`<p class="mdp">${body}</p>` : ''}<div class="mbs"><button class="mc2" ${act('modal-cancel')}>${cancel}</button><button class="${danger ? 'md2' : 'mo'}" ${act('modal-ok')}>${ok}</button></div>`);
    const done = v => { closeModal(); actions.delete('modal-ok'); actions.delete('modal-cancel'); resolve(v); };
    on('modal-ok', () => done(true));
    on('modal-cancel', () => done(false));
  });
}

/** Read a form field in the modal by id (trimmed string). */
export function val(id) { const el = $(id); return el ? String(el.value || '').trim() : ''; }
export function numVal(id) { const v = val(id); if (v === '') return null; const n = parseFloat(v); return isNaN(n) ? null : n; }

export function setText(id, text) { const el = $(id); if (el) el.textContent = text; }
export function setHTML(id, h) { const el = $(id); if (el) el.innerHTML = String(h); }
