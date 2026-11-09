/**
 * The background save status: a small pill under the nav bar while log
 * changes are on this device but not yet on GitHub. Tapping it retries now.
 */
import { on, toast, $ } from './dom.js';
import { onSync, syncNow } from '../data.js';

function label(st) {
  const n = st.pending;
  if (st.error) {
    const why = st.error.status === 401 ? 'GitHub did not accept the token'
      : st.error.status === 403 ? 'the token cannot write to the repository'
      : st.error.status ? `GitHub ${st.error.status}` : 'offline?';
    return `${n === 1 ? '1 change' : `${n} changes`} not saved to GitHub yet (${why}). Tap to retry.`;
  }
  return n > 1 ? `Saving ${n} changes…` : 'Saving…';
}

let lastFailures = 0;
onSync(st => {
  const el = $('syncpill');
  const state = !st.pending ? 'idle' : st.error ? 'error' : 'sending';
  document.body.dataset.sync = state;
  if (!el) return;
  el.hidden = state === 'idle';
  el.className = state;
  el.textContent = state === 'idle' ? '' : label(st);
  if (st.error) el.title = st.error.message || String(st.error);
  else el.removeAttribute('title');
  // Say it once when saving starts failing, not on every retry.
  if (st.error && st.failures === 1 && lastFailures === 0) toast('Not saved to GitHub yet. It is kept on this device and will be retried.', 'err');
  lastFailures = st.error ? st.failures : 0;
});

on('sync-now', () => { syncNow(); });

// Leaving with changes not yet on GitHub: send them now, and on a desktop ask first.
document.addEventListener('visibilitychange', () => { if (document.hidden) syncNow(); });
window.addEventListener('online', () => syncNow());
window.addEventListener('beforeunload', e => {
  if (document.body.dataset.sync !== 'idle') { syncNow(); e.preventDefault(); e.returnValue = ''; }
});
