/**
 * Log / edit a session. A session is (gym, machine, date, variant); saving
 * replaces it, and changing the date or variant while editing moves it.
 */
import { S, hasCfg } from '../state.js';
import { html, act, setHTML, setText, on, toast, $, qs, qsa } from './dom.js';
import { screen, back, nav } from './nav.js';
import { commitLog } from '../data.js';
import { mergeSession, sessionEntries, lastSession } from '../../lib/log.js';
import { normalizeVariant, cleanTag } from '../../lib/variant.js';
import { variationsOf } from '../../lib/gyms.js';
import { columnsFor, rowValues, parseRow, paceText } from '../../lib/entryform.js';
import { localDate, localTime, isValidDate } from '../../lib/dates.js';

/** Hooks other screens set: what to do after a save from the plan, and how to prefill from it. */
export const logHooks = { afterPlanLog: null, planSets: null };

const key = date => ({ gym_id: S.gym.id, machine_id: S.machine.id, date, variant: S.logVariant });

/**
 * Open the form. `editDate` edits that day's session; null starts today's.
 * opts: { variant, fromPlan }
 */
export function startLog(editDate, opts = {}) {
  const today = localDate();
  S.fromPlan = !!opts.fromPlan;
  S.logVariant = normalizeVariant(opts.variant || [], S.machine && S.machine.variations_default);
  S.logDate = editDate || today;
  // Starting "today" when today already has this session opens it for editing.
  const exists = sessionEntries(S.log, key(S.logDate)).length > 0;
  S.editSession = editDate || exists ? key(S.logDate) : null;
  S.logRows = null;
  S.logNotes = null;
  nav('log');
}

/** The sets to show: typed rows (when re-rendering), the session being edited, the plan, or the last session. */
function prefill() {
  if (S.logRows) return { rows: S.logRows, banner: '' };
  const m = S.machine, today = localDate();
  if (S.editSession) {
    const sets = sessionEntries(S.log, S.editSession);
    return { rows: sets, banner: S.editSession.date === today && !S.fromPlan ? html`<div class="banner info">You already logged ${m.name} today. This edits that session.</div>` : '' };
  }
  const plan = S.fromPlan && logHooks.planSets ? logHooks.planSets(S.gym, m) : null;
  if (plan && plan.sets.length) return { rows: plan.sets, banner: html`<div class="banner">🚂 Sets pre-filled from today's route${plan.note ? ` — ${plan.note}` : ''}</div>` };
  const last = lastSession(S.log, m.id, S.gym.id, S.logVariant);
  return { rows: last && last.length ? last : [{}], banner: '' };
}

function rowHtml(n, values, t) {
  const cols = columnsFor(t);
  return html`<tr><td>${n}</td>${cols.map((c, i) => c.kind === 'pace'
    ? html`<td class="pace">${paceText(t, values) || '—'}</td>`
    : html`<td><input type="${c.kind === 'minutes' ? 'text' : 'number'}" ${c.kind === 'minutes' ? html`inputmode="numeric"` : c.negative ? html`step="any"` : html`inputmode="decimal" step="any"`} data-col="${i}" placeholder="${c.ph}" value="${values[i]}" aria-label="${c.label}"></td>`)}<td><button class="xb" ${act('log-rm-row')} aria-label="Remove set">×</button></td></tr>`;
}

function tableHtml(rows, t) {
  const cols = columnsFor(t);
  return html`<table class="st"><thead><tr><th>#</th>${cols.map(c => html`<th>${c.label}</th>`)}<th></th></tr></thead><tbody id="stb">${rows.map((r, i) => rowHtml(i + 1, Array.isArray(r) ? r : rowValues(t, r), t))}</tbody></table>`;
}

function variantPicker() {
  const groups = variationsOf(S.machine);
  const inGroups = new Set(Object.values(groups).flat().map(cleanTag));
  const extra = S.logVariant.filter(t => !inGroups.has(t));
  const defaults = (S.machine.variations_default || []).map(cleanTag);
  // A group with nothing picked shows its default as selected (defaults are never stored).
  const isOn = (tags, tag) => S.logVariant.includes(tag) || (defaults.includes(tag) && !tags.map(cleanTag).some(x => S.logVariant.includes(x)));
  const groupRows = Object.entries(groups).map(([g, tags]) => html`<div class="vg"><span class="vgl">${g}</span>${tags.map(tag => html`<button class="vc ${isOn(tags, cleanTag(tag)) ? 'on' : ''}" ${act('log-var', { g, t: cleanTag(tag) })}>${tag}</button>`)}</div>`);
  return html`<div class="fs"><h3>Variation <span class="hl">(optional)</span></h3>
    ${groupRows}
    ${extra.length ? html`<div class="vg">${extra.map(t => html`<button class="vc on" ${act('log-var', { t })}>${t} ×</button>`)}</div>` : ''}
    <div class="vadd"><input id="vtag" class="fi" type="text" placeholder="Add a tag, e.g. wide" autocapitalize="none" spellcheck="false"><button class="vc" ${act('log-var-add')}>＋ Tag</button></div></div>`;
}

function renderLog() {
  const m = S.machine, gym = S.gym;
  if (!m || !gym) return;
  const editing = !!S.editSession, today = localDate(), t = m.log_type || 'weight';
  setText('log-title', editing ? `Edit · ${m.name}` : m.name);
  const { rows, banner } = prefill();
  const notes = S.logNotes != null ? S.logNotes : editing ? ((rows.find(s => s && s.notes) || {}).notes || '') : '';
  setHTML('logbody', html`${banner}
    <div class="fs"><h3>Date</h3><input type="date" id="ldate" class="fi" value="${S.logDate}" max="${today}"></div>
    ${variantPicker()}
    <div class="fs"><h3>Sets</h3><div id="swrap">${tableHtml(rows, t)}</div><button class="ab" ${act('log-add-row')}>＋ Add set</button></div>
    <div class="fs"><h3>Notes</h3><textarea id="lnotes" class="fi" placeholder="How did it feel?">${notes}</textarea></div>
    <button class="btn ok" id="svbtn" ${act('log-save')}>${editing ? 'Save changes' : 'Save session'}</button>
    ${editing ? html`<p class="hint" style="text-align:center">Saving replaces this session. Changing the date or variation moves it.</p>` : ''}`);
}

const typed = () => qsa('#stb tr').map(tr => qsa('input', tr).reduce((a, inp) => { a[+inp.dataset.col] = inp.value; return a; }, columnsFor(S.machine.log_type).map(() => '')));
function renumber() { qsa('#stb tr').forEach((r, i) => { r.cells[0].textContent = i + 1; }); }

/** Re-render after a variant change, keeping what was typed when editing. */
function variantChanged() {
  S.logDate = ($('ldate') || {}).value || S.logDate;
  S.logNotes = ($('lnotes') || {}).value ?? null;
  if (S.editSession) S.logRows = typed();
  else {
    S.logRows = null;
    const exists = sessionEntries(S.log, key(S.logDate)).length > 0;
    if (exists) S.editSession = key(S.logDate);
  }
  renderLog();
}

async function save() {
  if (!hasCfg()) { toast('Set up GitHub in Settings first', 'err'); return; }
  const m = S.machine, gym = S.gym, room = S.room, t = m.log_type || 'weight';
  const date = ($('ldate') || {}).value;
  if (!isValidDate(date)) { toast('Pick a valid date', 'err'); return; }
  const parsed = typed().map(v => parseRow(t, v));
  const bad = parsed.find(p => p.error);
  if (bad) { toast(bad.error, 'err'); return; }
  const fields = parsed.map(p => p.fields).filter(Boolean);
  if (!fields.length) { toast('Add at least one set with a value', 'err'); return; }
  const from = S.editSession || key(date);
  const to = key(date);
  const existing = sessionEntries(S.log, from);
  const time = (existing[0] && existing[0].time) || localTime();
  const notes = (($('lnotes') || {}).value || '').trim();
  const sets = fields.map((f, i) => ({ ...f, gym: gym.name, room_id: room.id, room: room.name, machine: m.name, time, notes: i === 0 ? notes : '' }));
  const btn = $('svbtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await commitLog(log => mergeSession(log, from, sets, to), `${S.editSession ? 'Edit' : 'Log'} ${m.name} ${date}`);
    toast('Session saved', 'ok');
    const fromPlan = S.fromPlan;
    S.fromPlan = false; S.editSession = null; S.logRows = null; S.logNotes = null;
    back();
    if (fromPlan && logHooks.afterPlanLog) logHooks.afterPlanLog();
  } catch (e) {
    console.error(e);
    toast(`Save failed: ${e.message}`, 'err');
    btn.disabled = false; btn.textContent = S.editSession ? 'Save changes' : 'Save session';
  }
}

screen('log', renderLog);
on('log-add-row', () => {
  const tb = $('stb');
  if (!tb) return;
  const t = S.machine.log_type || 'weight';
  const last = typed().pop() || columnsFor(t).map(() => '');
  tb.insertAdjacentHTML('beforeend', String(rowHtml(tb.rows.length + 1, last, t)));
  renumber();
  const inp = tb.lastElementChild.querySelector('input');
  if (inp) inp.focus();
});
on('log-rm-row', (d, el) => { const tb = el.closest('tbody'); if (tb.rows.length <= 1) return; el.closest('tr').remove(); renumber(); });
on('log-var', d => {
  const groups = variationsOf(S.machine);
  const group = d.g ? (groups[d.g] || []).map(cleanTag) : [];
  const has = S.logVariant.includes(d.t);
  let v = S.logVariant.filter(x => x !== d.t && !group.includes(x)); // at most one tag per group
  if (!has) v.push(d.t);
  S.logVariant = normalizeVariant(v, S.machine.variations_default);
  variantChanged();
});
on('log-var-add', () => {
  const t = cleanTag(($('vtag') || {}).value);
  if (!t) return;
  if (t.includes(';')) { toast('A tag can\'t contain ";"', 'err'); return; }
  S.logVariant = normalizeVariant([...S.logVariant, t], S.machine.variations_default);
  variantChanged();
});
on('log-save', save);

// Live pace cells and date changes.
document.addEventListener('input', e => {
  const row = e.target.closest && e.target.closest('#stb tr');
  if (!row || !S.machine) return;
  const cell = qs('.pace', row);
  if (!cell) return;
  const t = S.machine.log_type;
  const values = columnsFor(t).map(() => '');
  qsa('input', row).forEach(inp => { values[+inp.dataset.col] = inp.value; });
  cell.textContent = paceText(t, values);
});
document.addEventListener('change', e => {
  if (e.target.id !== 'ldate' || !S.machine || S.editSession) return;
  // A new session on a date that already has one becomes an edit of it.
  S.logDate = e.target.value;
  if (isValidDate(S.logDate) && sessionEntries(S.log, key(S.logDate)).length) {
    S.editSession = key(S.logDate);
    S.logRows = null;
    renderLog();
    toast('That day already has this session: editing it', 'ok');
  }
});
