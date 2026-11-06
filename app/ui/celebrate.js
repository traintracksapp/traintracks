/** End-of-the-line celebration: confetti on a canvas, once per plan. */
import { $, on } from './dom.js';

const COLS = ['#ffb020', '#ffe08a', '#3ddc84', '#ff5ea8', '#5cc8ff', '#b07cff', '#ffffff'];
const C = { raf: 0, parts: [], stop: 0, last: 0, timer: 0 };

export function celebrate(total) {
  const el = $('cele'); if (!el) return;
  $('cesub').innerHTML = total ? `All <b>${total}</b> planned stop${total !== 1 ? 's' : ''} logged.<br>Great work.` : 'Great work.';
  el.classList.add('on');
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) start();
  clearTimeout(C.timer); C.timer = setTimeout(close, 12000);
}

export function close() {
  const el = $('cele'); if (!el || !el.classList.contains('on')) return;
  el.classList.remove('on');
  clearTimeout(C.timer);
  if (C.raf) cancelAnimationFrame(C.raf);
  C.raf = 0; C.parts = [];
  const c = $('cfw'); if (c && c.getContext) { const cx = c.getContext('2d'); cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, c.width, c.height); }
}

function size() {
  const c = $('cfw'); if (!c) return null;
  const r = Math.min(window.devicePixelRatio || 1, 2);
  c.width = Math.max(1, Math.floor(c.clientWidth * r)); c.height = Math.max(1, Math.floor(c.clientHeight * r));
  const cx = c.getContext('2d'); cx.setTransform(r, 0, 0, r, 0, 0); return cx;
}

function start() {
  const cx = size(); if (!cx) return;
  const W = $('cfw').clientWidth;
  C.parts = [];
  for (let i = 0; i < 160; i++) C.parts.push({ x: Math.random() * W, y: -20 - Math.random() * 300, vx: (Math.random() - .5) * 60, vy: 60 + Math.random() * 120, r: 3 + Math.random() * 5, a: Math.random() * 6.28, va: (Math.random() - .5) * 8, col: COLS[i % COLS.length] });
  C.last = performance.now(); C.stop = C.last + 7000;
  if (C.raf) cancelAnimationFrame(C.raf);
  C.raf = requestAnimationFrame(step);
}

function step(t) {
  const c = $('cfw'); if (!c || !$('cele').classList.contains('on')) { C.raf = 0; return; }
  const cx = c.getContext('2d'), W = c.clientWidth, H = c.clientHeight;
  const dt = Math.min((t - C.last) / 1000, .05); C.last = t;
  cx.clearRect(0, 0, W, H);
  let alive = 0;
  C.parts.forEach(p => {
    p.vy += 40 * dt; p.x += p.vx * dt + Math.sin(t / 300 + p.a) * .6; p.y += p.vy * dt; p.a += p.va * dt;
    if (p.y > H + 20) { if (t < C.stop) { p.y = -20; p.vy = 60 + Math.random() * 120; } else return; }
    alive++;
    cx.save(); cx.translate(p.x, p.y); cx.rotate(p.a); cx.fillStyle = p.col; cx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); cx.restore();
  });
  if (!alive && t > C.stop) { C.raf = 0; return; }
  C.raf = requestAnimationFrame(step);
}

on('cele-close', close);
