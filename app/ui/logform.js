/** Log / edit a session on a machine. Replace-on-save per (gym, machine, date). */
import { S, hasCfg } from '../state.js';
import { html, act, raw, setHTML, setText, on, toast, $, qs, qsa, showLoading, hideLoading } from './dom.js';
import { screen, nav, back } from './nav.js';
import { commitLog } from '../data.js';
import { mergeSession, sessionEntries, lastSession, buildEntry } from '../../lib/log.js';
import { parseMinutes, fmtDuration, fmtPace, fmtWalkPace, todayStr, fmtClock } from '../../lib/format.js';
import { prefillFromPlan } from '../../lib/plan.js';
import { AEROBIC_TYPES, LOG_TYPES } from '../../lib/config.js';
import { isValidDate } from '../../lib/dates.js';
import { afterPlanLog } from './plan.js';
import { renderDetail } from './gyms.js';

/** Open the form. editDate = a date to edit, or null for a new session (today). */
export function startLog(editDate, opts = {}) {
  const today = todayStr();
  S.fromPlan = !!opts.fromPlan;
  // Logging "today" when today already has a session for this machine opens that session for editing.
  const existsToday = !editDate && sessionEntries(S.log, { gymId: S.gym.id, machineId: S.machine.id, date: today }).length > 0;
  S.editSession = editDate || existsToday ? { gymId: S.gym.id, machineId: S.machine.id, date: editDate || today } : null;
  S.logType = S.machine.logType || 'weight';
  nav('log');
}

function rowHtml(n, s, t) {
  const v = k => s[k] != null && s[k] !== '' ? s[k] : '';
  const del = html`<td><button class="xb" ${act('log-rm-row')} aria-label="Remove set">×</button></td>`;
  switch (t) {
    case 'cardio': return html`<tr><td>${n}</td><td><input type="number" inputmode="decimal" class="f-dur" placeholder="30" value="${v('duration')}"></td><td><input type="number" inputmode="decimal" class="f-level" placeholder="3.5" value="${v('level')}"></td><td><input type="number" inputmode="decimal" class="f-inc" placeholder="0" value="${v('incline')}"></td><td><input type="number" inputmode="decimal" class="f-hr" placeholder="120" value="${v('hr')}"></td>${del}</tr>`;
    case 'walk': return html`<tr><td>${n}</td><td><input type="number" inputmode="decimal" class="f-level" placeholder="1.5" value="${v('level')}"></td><td><input type="text" inputmode="numeric" class="f-dur" placeholder="30:00" value="${s.duration != null && s.duration !== '' ? fmtDuration(s.duration) : ''}"></td><td class="pace">${s.level && s.duration ? fmtWalkPace(s.level, s.duration) : '—'}</td>${del}</tr>`;
    case 'pace': return html`<tr><td>${n}</td><td><input type="number" inputmode="decimal" class="f-dur" placeholder="30" value="${v('duration')}"></td><td><input type="number" inputmode="decimal" class="f-level" placeholder="3.5" value="${v('level')}"></td><td class="pace">${s.level ? fmtPace(s.level) : '—'}</td>${del}</tr>`;
    case 'time': return html`<tr><td>${n}</td><td><input type="number" inputmode="decimal" class="f-dur" placeholder="60" value="${v('duration')}"></td>${del}</tr>`;
    case 'mins': return html`<tr><td>${n}</td><td><input type="text" inputmode="numeric" class="f-dur" placeholder="45:00" value="${s.duration != null && s.duration !== '' ? fmtDuration(s.duration) : ''}"></td>${del}</tr>`;
    case 'reps': return html`<tr><td>${n}</td><td><input type="number" inputmode="numeric" class="f-reps" placeholder="0" value="${v('reps')}"></td>${del}</tr>`;
    default: return html`<tr><td>${n}</td><td><input type="number" inputmode="decimal" class="f-weight" placeholder="0" value="${v('weight')}"></td><td><input type="number" inputmode="numeric" class="f-reps" placeholder="0" value="${v('reps')}"></td>${del}</tr>`;
  }
}

function tableHtml(sets, t) {
  const cols = { cardio: '<th>Mins</th><th>MPH</th><th>Incline</th><th>HR</th>', walk: '<th>Distance (mi)</th><th>Time (min)</th><th>Pace</th>', pace: '<th>Mins</th><th>MPH</th><th>Avg pace</th>', time: '<th>Secs</th>', mins: '<th>Duration (min)</th>', reps: '<th>Reps</th>' }[t] || '<th>Weight (lbs)</th><th>Reps</th>';
  return html`<table class="st"><thead><tr><th>#</th>${raw(cols)}<th></th></tr></thead><tbody id="stb">${sets.map((s, i) => raw(rowHtml(i + 1, s, t)))}</tbody></table>`;
}

function renderLog() {
  const m = S.machine, gym = S.gym; if (!m || !gym) return;
  const editing = !!S.editSession;
  const today = todayStr();
  const date = editing ? S.editSession.date : today;
  setText('log-title', editing ? `Edit · ${m.name}` : m.name);
  const t = S.logType;
  let prefill = [], banner = '';
  const planEx = !editing && S.plan && (S.plan.exercises || []).find(e => e.machineId === m.id && (!e.gymId || e.gymId === gym.id));
  if (editing) {
    prefill = sessionEntries(S.log, S.editSession);
    if (S.editSession.date === today && !S.fromPlan) banner = html`<div class="banner info">You already logged ${m.name} today — this edits that session.</div>`;
  } else if (planEx && planEx.sets && planEx.sets.length) {
    prefill = prefillFromPlan(planEx);
    banner = html`<div class="banner">🚂 Sets pre-filled from today's route${planEx.note ? ` — ${planEx.note}` : ''}</div>`;
  } else {
    prefill = lastSession(S.log, m.id, gym.id) || [{ set: 1 }];
  }
  const isAero = AEROBIC_TYPES.includes(t);
  const z0 = editing && prefill.length ? prefill[0] : {};
  const hasZones = [1, 2, 3, 4, 5].some(i => z0['zone' + i] != null);
  const notes = editing ? ((prefill.find(s => s.notes) || {}).notes || '') : '';
  const typeToggle = m.logType ? '' : html`<div class="fs"><h3>Type</h3><div class="tt">${Object.entries(LOG_TYPES).map(([k, v]) => html`<button class="${t === k ? 'on' : ''}" ${act('log-type', { t: k })}>${v.label}</button>`)}</div></div>`;
  setHTML('logbody', html`${raw(banner)}
    <div class="fs"><h3>Date</h3><input type="date" id="ldate" class="fi" value="${date}" max="${today}"></div>
    ${raw(typeToggle)}
    <div class="fs"><h3>Sets</h3><div id="swrap">${raw(tableHtml(prefill, t))}</div><button class="ab" ${act('log-add-row')}>＋ Add set</button></div>
    ${isAero ? html`<div class="fs"><h3 style="cursor:pointer" ${act('log-zones')}><span id="zarrow">${hasZones ? '▼' : '▶'}</span> Heart-rate zones <span style="font-weight:normal;text-transform:none;letter-spacing:0">(optional, minutes)</span></h3>
      <div id="zbody" style="display:${hasZones ? 'block' : 'none'}"><div class="zones">${[1, 2, 3, 4, 5].map(i => html`<input class="fi" type="text" inputmode="numeric" id="z${i}" placeholder="Z${i}" value="${z0['zone' + i] != null ? fmtDuration(z0['zone' + i]) : ''}">`)}</div><p class="hint" style="padding:6px 0 0">Only for sessions without a Garmin link; linked sessions show zones from the bucket file.</p></div></div>` : ''}
    <div class="fs"><h3>Notes</h3><textarea id="lnotes" class="fi" placeholder="How did it feel?">${notes}</textarea></div>
    <button class="btn ok" id="svbtn" ${act('log-save')}>${editing ? 'Save changes' : 'Save session'}</button>
    ${editing ? html`<p class="hint" style="text-align:center">Saving replaces this session. Changing the date moves it.</p>` : ''}`);
}

function renum() { qsa('#stb tr').forEach((r, i) => { r.cells[0].textContent = i + 1; }); }

function readRows(t) {
  const rows = qsa('#stb tr');
  const num = (row, cls) => { const el = qs('.' + cls, row); if (!el || el.value === '') return null; const n = parseFloat(el.value); return isNaN(n) ? null : n; };
  const mins = (row, cls) => { const el = qs('.' + cls, row); return el ? parseMinutes(el.value) : null; };
  return rows.map(row => {
    switch (t) {
      case 'cardio': return { duration: num(row, 'f-dur'), level: num(row, 'f-level'), incline: num(row, 'f-inc'), hr: num(row, 'f-hr') };
      case 'walk': return { level: num(row, 'f-level'), duration: mins(row, 'f-dur') };
      case 'pace': return { duration: num(row, 'f-dur'), level: num(row, 'f-level') };
      case 'time': return { duration: num(row, 'f-dur') };
      case 'mins': return { duration: mins(row, 'f-dur') };
      case 'reps': return { reps: num(row, 'f-reps') };
      default: return { weight: num(row, 'f-weight'), reps: num(row, 'f-reps') };
    }
  }).filter(f => Object.values(f).some(v => v != null));
}

async function save() {
  if (!hasCfg()) { toast('Set up GitHub in Settings first', 'err'); return; }
  const m = S.machine, gym = S.gym, room = S.room, t = S.logType;
  const date = ($('ldate') || {}).value;
  if (!isValidDate(date)) { toast('Pick a valid date', 'err'); return; }
  const fields = readRows(t);
  if (!fields.length) { toast('Add at least one set with a value', 'err'); return; }
  const ctx = { gym, room, machine: m, date, datetime: `${date} ${fmtClock()}`, notes: ($('lnotes') || {}).value || '' };
  const newSets = fields.map((f, i) => buildEntry(ctx, f, i + 1));
  if (AEROBIC_TYPES.includes(t)) {
    const zv = [1, 2, 3, 4, 5].map(i => parseMinutes(($('z' + i) || {}).value));
    if (zv.some(z => z != null)) [1, 2, 3, 4, 5].forEach((z, i) => { newSets[0]['zone' + z] = zv[i]; });
  }
  const from = S.editSession || { gymId: gym.id, machineId: m.id, date };
  const to = { gymId: gym.id, machineId: m.id, date };
  const btn = $('svbtn'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await commitLog(base => mergeSession(base, from, newSets, to), `${S.editSession ? 'Edit' : 'Log'} ${m.name} ${date}`);
    toast('Session saved', 'ok');
    const fromPlan = S.fromPlan; S.fromPlan = false; S.editSession = null;
    back();
    if (fromPlan) afterPlanLog(); else renderDetail();
  } catch (e) { toast(`Save failed: ${e.message}`, 'err'); console.error(e); }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Save session'; } }
}

screen('log', renderLog);
on('log-type', d => { S.logType = d.t; renderLog(); });
on('log-add-row', () => {
  const tb = $('stb'); if (!tb) return;
  const n = tb.querySelectorAll('tr').length + 1;
  tb.insertAdjacentHTML('beforeend', rowHtml(n, {}, S.logType));
  renum();
  const last = tb.lastElementChild.querySelector('input'); if (last) last.focus();
});
on('log-rm-row', (d, el) => { const tb = el.closest('tbody'); if (tb.querySelectorAll('tr').length <= 1) return; el.closest('tr').remove(); renum(); });
on('log-zones', () => { const b = $('zbody'), a = $('zarrow'); if (!b) return; const open = b.style.display === 'none'; b.style.display = open ? 'block' : 'none'; a.textContent = open ? '▼' : '▶'; });
on('log-save', save);

// live pace cells
document.addEventListener('input', e => {
  const row = e.target.closest && e.target.closest('#stb tr'); if (!row) return;
  const cell = qs('.pace', row); if (!cell) return;
  const lv = parseFloat((qs('.f-level', row) || {}).value);
  if (S.logType === 'walk') cell.textContent = fmtWalkPace(lv, parseMinutes((qs('.f-dur', row) || {}).value));
  else if (S.logType === 'pace') cell.textContent = fmtPace(lv);
});
