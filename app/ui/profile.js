/** My profile (profile.json), read by the coach. Public like everything in the repo. */
import { S, hasCfg } from '../state.js';
import { html, setHTML, on, toast, $, showLoading, hideLoading } from './dom.js';
import { screen, back } from './nav.js';
import { saveProfile } from '../data.js';

// [key, label, input type, placeholder]. Version 2 keys are snake_case.
const FIELDS = [
  ['first_name', 'First name', 'text', 'Your name'],
  ['birth_year', 'Birth year', 'number', 'e.g. 1980'],
  ['gender', 'Gender', 'text', 'Optional'],
  ['goals', 'Goals', 'textarea', 'What are you working toward?'],
  ['likes', 'Exercises I like', 'textarea', 'Machines or exercises you enjoy'],
  ['dislikes', 'Exercises I dislike', 'textarea', 'Things you avoid'],
  ['injuries', 'Injuries', 'textarea', 'Past or current injuries'],
  ['limitations', 'Limitations', 'textarea', 'Movements to avoid'],
  ['notes', 'Other notes', 'textarea', 'Anything else useful for your coach']
];

function renderProfile() {
  const p = S.profile || {};
  const field = ([k, label, type, ph]) => html`<div class="pi"><label for="p-${k}">${label}</label>${type === 'textarea'
    ? html`<textarea class="fi" id="p-${k}" placeholder="${ph}">${p[k] || ''}</textarea>`
    : html`<input class="fi" id="p-${k}" type="${type}" placeholder="${ph}" value="${p[k] ?? ''}">`}</div>`;
  setHTML('profilebody', html`<div class="banner info">Your repository is public, so anyone with the link can read this. Every field is optional: share only what you're happy to.</div>
    <div class="sh">About you</div><div class="card">${FIELDS.slice(0, 3).map(field)}</div>
    <div class="sh">Fitness profile</div><div class="card">${FIELDS.slice(3).map(field)}</div>
    <p class="hint">Your coach reads this file (<code>profile.json</code>) when planning.</p>`);
}

screen('profile', renderProfile);
on('profile-save', async () => {
  if (!hasCfg()) { toast('Set up GitHub first', 'err'); return; }
  const out = { ...S.profile };
  for (const [k] of FIELDS) {
    const v = (($('p-' + k) || {}).value || '').trim();
    out[k] = k === 'birth_year' ? (v ? parseInt(v, 10) || null : null) : v;
  }
  showLoading('Saving profile…');
  try { await saveProfile(out); toast('Profile saved', 'ok'); back(); }
  catch (e) { toast(`Save failed: ${e.message}`, 'err'); }
  finally { hideLoading(); }
});
