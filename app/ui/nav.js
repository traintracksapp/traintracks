/**
 * Screen navigation: a stack of screen ids. Each screen is a .scr element
 * with id "s-<name>". Renderers register with `screen(name, renderFn)` and
 * are called every time the screen is shown.
 */
import { S } from '../state.js';
import { qsa, $, on, closeModal } from './dom.js';

const renderers = new Map();
export function screen(name, render) { renderers.set(name, render); }

function show(id) {
  qsa('.scr').forEach(s => s.classList.remove('on'));
  const el = $(`s-${id}`);
  if (el) { el.classList.add('on'); qsa('.sc', el).forEach(s => { s.scrollTop = 0; }); }
}

/** Go to a screen (pushes onto the stack unless already on top). */
export function nav(id, params) {
  closeModal();
  const r = renderers.get(id);
  if (r) r(params || {});
  if (S.stack[S.stack.length - 1] !== id) S.stack.push(id);
  show(id);
}

/** Re-render the current screen in place (after data changed). */
export function refresh() {
  const id = S.stack[S.stack.length - 1];
  const r = renderers.get(id);
  if (r) r({ refresh: true });
}

export function back() {
  closeModal();
  if (S.stack.length > 1) S.stack.pop();
  const id = S.stack[S.stack.length - 1];
  const r = renderers.get(id);
  if (r) r({ back: true });
  show(id);
}

export function home() {
  closeModal();
  S.stack = ['home'];
  const r = renderers.get('home');
  if (r) r({});
  show('home');
}

export function current() { return S.stack[S.stack.length - 1]; }

on('nav', d => nav(d.to));
on('back', () => back());
on('home', () => home());
