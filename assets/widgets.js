// widgets.js — the interactive figures, as Web Components.
//
//   <qec-state-view code="three-qubit" allowed="XZ" decoder logical label="C"></qec-state-view>
//   <qec-circuit code="two-qubit" coherent decoder label="B"></qec-circuit>
//   <qec-suppression label="D"></qec-suppression>
//   <qec-syndrome-table code="three-qubit" errors="X" label="E"></qec-syndrome-table>
//
// No framework, no build step: loaded as an ES module, registers the elements.
// The physics lives in pauli.js (syndromes, logical action, distance) and
// state.js (amplitudes); this file only draws.

import { Pauli, subscript } from './pauli.js';
import { getCode, classical, cssCode, CLASSICAL } from './codes.js';
import * as gf2 from './gf2.js';
import { minSumBP, flipProbability } from './bp.js';
import { State, encode, encodeInputs, codewords, subspaces, logicalBasis, encodeLogical } from './state.js';

export { Pauli, getCode, State };

const Base = typeof HTMLElement === 'undefined' ? class {} : HTMLElement;
const SVG_NS = 'http://www.w3.org/2000/svg';

/* ------------------------------------------------------------- helpers */

function applyAttrs(node, attrs = {}) {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
}

function appendChildren(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  applyAttrs(node, attrs);
  appendChildren(node, children);
  return node;
}

function svg(tag, attrs, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  applyAttrs(node, attrs);
  appendChildren(node, children);
  return node;
}

const attr = (el, name, fallback) => {
  const v = el.getAttribute(name);
  return v === null || v === '' ? fallback : v;
};
const flag = (el, name) => el.hasAttribute(name);
const kinds = (str) => (str.toUpperCase().match(/[XYZ]/g) ?? []).filter((k, i, a) => a.indexOf(k) === i);
const ket = (bits) => `|${bits}⟩`;
const sign = (v) => (v < 0 ? '−' : '');
const fmt = (v, d = 2) => (Math.abs(v) < 5e-4 ? '0' : sign(v) + Math.abs(v).toFixed(d));
const pct = (v) => `${(100 * v).toFixed(1)}%`;

/** Default input: α = 0.8, β = 0.6, so the two amplitudes are easy to tell apart. */
const DEFAULT_THETA = 2 * Math.atan2(0.6, 0.8);

const WIDGET_TAGS = 'qec-state-view, qec-code-view, qec-projection, qec-circuit, qec-suppression, qec-syndrome-table, qec-checks, qec-css-builder, qec-hgp';

/** Mark the host as a widget (styling, and MathJax leaves it alone). */
function setup(el) {
  el.classList.add('qec-widget');
}

function header(el, fallbackTitle, hint) {
  const fig = el.closest('qec-figure');
  let kicker;
  if (fig) {
    const idx = [...fig.querySelectorAll(WIDGET_TAGS)].indexOf(el) + 1;
    kicker = `${attr(fig, 'label', '')}.${idx}`;
  } else {
    const label = attr(el, 'label', '');
    kicker = label ? `Figure ${label} · interactive` : 'Interactive';
  }
  return h('div', { class: 'w-head' },
    h('span', { class: 'w-kicker' }, kicker),
    h('span', { class: 'w-title' }, attr(el, 'title', fallbackTitle)),
    hint ? h('span', { class: 'w-hint' }, hint) : null);
}

/**
 * A figure with several parts that share one error. The <qec-figure> holds
 * the Pauli; parts hold a reference to it, mutate it in place, and call
 * broadcast() so every part re-renders.
 */
function sharedError(el, n) {
  const fig = el.closest('qec-figure');
  if (!fig) return null;
  fig.err ??= Pauli.fromString(attr(fig, 'error', 'I'.repeat(n)), n);
  fig.broadcast ??= () => fig.dispatchEvent(new Event('qec-error'));
  return fig;
}

function assignPauli(target, source) {
  target.x.set(source.x);
  target.z.set(source.z);
}

/**
 * A labelled range input. Most callbacks rebuild the widget, which would
 * replace the input under the pointer and end a drag, so by default a drag
 * only updates the readout and commits on release; keyboard steps commit at
 * once and keep focus. Pass `live: true` when the callback leaves the input
 * in place.
 */
function slider(labelText, { min, max, step, value, format, oninput, id, live = false }) {
  const out = h('output', { for: id }, format(value));
  let dragging = false, last = Number(value);
  const commit = (v, el) => {
    if (v === last) return;
    last = v;
    const hadFocus = typeof document !== 'undefined' && document.activeElement === el;
    oninput(v);
    if (hadFocus && !live) { const again = document.getElementById(id); if (again && again !== el) again.focus(); }
  };
  const input = h('input', { type: 'range', id, min, max, step, value,
    onpointerdown: () => { dragging = true; window.addEventListener('pointerup', () => { dragging = false; }, { once: true }); },
    oninput: (e) => { const v = Number(e.target.value); out.textContent = format(v); if (live || !dragging) commit(v, e.target); },
    onchange: (e) => { dragging = false; commit(Number(e.target.value), e.target); } });
  return h('label', { class: 'slider', for: id }, h('span', { class: 'slider-name' }, labelText), input, out);
}

let uid = 0;
const nextId = (prefix) => `${prefix}-${++uid}`;

/* -------------------------------------------------- amplitude chart */

/**
 * Signed amplitude bars over the computational basis, columns grouped by
 * subspace. `layout` comes from subspaces(code); `state` is an n-qubit State.
 */
function ampChart(state, layout, { colW = 46, height = 128, compact = false, title } = {}) {
  const n = state.n;
  const cols = layout.groups.flatMap((g) => g.members);
  const padL = 6, padR = 6, top = compact ? 16 : 20, bottom = compact ? 16 : 18;
  const W = padL + cols.length * colW + padR;
  const half = height / 2;
  const y0 = top + half;
  const barMax = half - 14;                          // room for the value label
  const barW = Math.min(24, Math.round(colW * 0.5));
  const H = top + height + bottom;
  const els = [];

  // subspace bands
  let x = padL;
  for (const g of layout.groups) {
    const w = g.members.length * colW;
    els.push(svg('rect', { x, y: 2, width: w - 3, height: H - 4, rx: 3, class: `band band-${g.label === 'C' ? 'C' : 'F'}` }));
    els.push(svg('text', { x: x + 6, y: 13, class: 'band-label' }, g.label));
    x += w;
  }
  els.push(svg('line', { x1: padL, x2: W - padR, y1: y0, y2: y0, class: 'zero' }));

  cols.forEach((i, c) => {
    const a = state.a[i];
    const cx = padL + c * colW + colW / 2;
    const bits = i.toString(2).padStart(n, '0');
    const hgt = Math.abs(a) * barMax;
    const g = svg('g', { class: 'col' }, svg('title', {}, `${ket(bits)}: amplitude ${fmt(a, 3)}, probability ${fmt(a * a, 3)}`));
    if (hgt > 0.5) {
      const r = Math.min(4, hgt);
      const xl = cx - barW / 2, xr = cx + barW / 2;
      const d = a > 0
        ? `M${xl},${y0} V${y0 - hgt + r} Q${xl},${y0 - hgt} ${xl + r},${y0 - hgt} H${xr - r} Q${xr},${y0 - hgt} ${xr},${y0 - hgt + r} V${y0} Z`
        : `M${xl},${y0} V${y0 + hgt - r} Q${xl},${y0 + hgt} ${xl + r},${y0 + hgt} H${xr - r} Q${xr},${y0 + hgt} ${xr},${y0 + hgt - r} V${y0} Z`;
      g.append(svg('path', { d, class: a > 0 ? 'bar' : 'bar bar-neg' }));
      g.append(svg('text', { x: cx, y: a > 0 ? y0 - hgt - 4 : y0 + hgt + 11, 'text-anchor': 'middle', class: 'val' }, fmt(a)));
    }
    g.append(svg('text', { x: cx, y: H - 4, 'text-anchor': 'middle', class: 'ket' }, ket(bits)));
    els.push(g);
  });

  return svg('svg', { viewBox: `0 0 ${W} ${H}`, class: `amp-chart${compact ? ' compact' : ''}`, style: { maxWidth: `${W}px` }, role: 'img',
    'aria-label': title ?? `Amplitudes of the state ${state.toString(2)} over the basis states, grouped into the codespace C and the error spaces` }, els);
}

/* --------------------------------------------------- qubits, meters */

function qubitButtons(code, err, allowed, onCycle, groups = []) {
  const buttons = [];
  let boundary = groups.length ? groups[0] : Infinity, g = 0;
  for (let i = 0; i < code.n; i++) {
    if (i === boundary) { buttons.push(h('span', { class: 'qubit-gap', 'aria-hidden': 'true' })); g += 1; boundary += groups[g] ?? Infinity; }
    const op = err.at(i);
    buttons.push(h('button', {
      type: 'button', class: `qubit op-${op}`, 'data-i': i,
      'aria-label': `qubit ${i + 1}: ${op === 'I' ? 'no error' : op + ' error'}. Activate to change.`,
      onclick: () => onCycle(i),
    }, h('span', { class: 'qubit-face' }, op === 'I' ? String(i + 1) : op), h('span', { class: 'qubit-idx' }, `qubit ${i + 1}`)));
  }
  return h('div', { class: 'qubits', role: 'group', 'aria-label': `error on each qubit, cycling through ${['none', ...allowed].join(', ')}` }, buttons);
}

function meters(code, syn) {
  return h('div', { class: 'meters', role: 'group', 'aria-label': 'stabilizer measurements' },
    code.stabilizers.map((s, k) => h('div', { class: `meter${syn[k] ? ' lit' : ''}` },
      h('span', { class: 'meter-name' }, s.toLabelled(code.labels)),
      h('span', { class: 'meter-val' }, syn[k] ? '−1' : '+1'),
      h('span', { class: 'meter-bit' }, `s${subscript(k + 1)} = ${syn[k]}`))),
    h('div', { class: 'syndrome' }, h('span', { class: 'meter-name' }, 'syndrome S'), h('span', { class: 'meter-val' }, Array.from(syn).join(''))));
}

/* ------------------------------------------------- <qec-state-view> */

class QecStateView extends Base {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    setup(this);
    this.code = getCode(attr(this, 'code', 'three-qubit'));
    this.allowed = kinds(attr(this, 'allowed', 'X'));
    this.theta = Number(attr(this, 'theta', DEFAULT_THETA));
    this.fig = sharedError(this, this.code.n);
    this.err = this.fig ? this.fig.err
      : attr(this, 'initial') ? Pauli.fromString(attr(this, 'initial'), this.code.n) : Pauli.identity(this.code.n);
    if (this.fig) this.fig.addEventListener('qec-error', () => { const f = this.pendingFocus; this.pendingFocus = undefined; this.render(f); });
    this.layout = subspaces(this.code);
    this.id ||= nextId('sv');
    this.render();
  }

  /** Re-render here, or everywhere if the error is shared. */
  changed(focusIndex) {
    if (this.fig) { this.pendingFocus = focusIndex; this.fig.broadcast(); } else this.render(focusIndex);
  }

  cycle(i) {
    const order = ['I', ...this.allowed];
    this.err.set(i, order[(order.indexOf(this.err.at(i)) + 1) % order.length]);
    this.changed(i);
  }

  describe(c, state, encoded) {
    const code = this.code;
    const name = this.err.toLabelled(code.labels);
    const syn = Array.from(c.syndrome).join('');
    const group = this.layout.groups[this.layout.of[firstNonzero(state)]];
    const where = group ? group.label : 'C';
    const m = code.stabilizers.length;
    const lit = c.syndrome.reduce((a, b) => a + b, 0);
    switch (c.kind) {
      case 'identity':
        return `No error. The state sits in the codespace C; ${m === 1 ? 'the stabilizer returns' : 'both stabilizers return'} +1 and the syndrome is ${syn}.`;
      case 'detectable':
        return `${name} moved the state into ${where}. ${lit} of ${m} stabilizer${m > 1 ? 's' : ''} return −1, so the syndrome is ${syn}: the error is detected. The two bars kept their heights, so α and β are intact; only the subspace changed.`;
      case 'stabilizer':
        return `${name} is a product of stabilizers, so it maps every code state to itself: syndrome ${syn}, and nothing has happened to the encoded qubit.`;
      default: {
        const how = c.action.some((a) => a.startsWith('Ȳ')) ? ' (the bars have swapped heights and one has changed sign)'
          : c.action.some((a) => a.startsWith('X̄')) ? ' (the two bars have swapped heights)'
          : ' (compare the signs of the bars)';
        return `${name} commutes with every stabilizer, so the syndrome stays ${syn} and nothing is detected — but the state has changed${how}. On the encoded qubit it acts as ${c.action.join(' ')}: an undetected logical error.`;
      }
    }
  }

  decoderLine(c, state, encoded) {
    const table = this.code.lookupDecoder(['X']);
    const syn = Array.from(c.syndrome).join('');
    const corr = table.get(syn) ?? Pauli.identity(this.code.n);
    const residual = this.err.mul(corr);
    const r = this.code.classify(residual);
    const ok = r.kind === 'identity' || r.kind === 'stabilizer';
    const fixed = state.clone().applyPauli(corr);
    const F = fixed.fidelity(encoded);
    if (corr.isIdentity()) {
      return h('p', { class: `decoder ${ok ? 'ok' : 'fail'}` },
        `Decoder: syndrome ${syn} → no correction. `,
        ok ? 'The encoded qubit is as it was.' : `But the state is not what was encoded (fidelity ${fmt(F, 3)}): a ${r.action.join(' ')} error slipped through.`);
    }
    return h('p', { class: `decoder ${ok ? 'ok' : 'fail'}` },
      `Decoder: syndrome ${syn} → apply ${corr.toLabelled(this.code.labels)}. Net effect ${residual.toLabelled(this.code.labels)}: `,
      ok ? `the state returns to the codespace with fidelity ${fmt(F, 3)} to the input. Recovered.` : `a logical ${r.action.join(' ')}. The decoder was fooled; fidelity to the input ${fmt(F, 3)}.`);
  }

  logicalReadout(state) {
    const cw = codewords(this.code);
    const rows = [['|0⟩ᴸ', cw.zero], ['|1⟩ᴸ', cw.one], ['|+⟩ᴸ', cw.plus], ['|−⟩ᴸ', cw.minus]].map(([name, v]) => {
      const o = state.overlap(v);
      return h('tr', {}, h('td', { class: 'mono' }, `⟨${name.slice(1)}ψ⟩`.replace('⟩ᴸ', 'ᴸ|')), h('td', { class: 'mono' }, fmt(o, 3)), h('td', { class: 'mono' }, fmt(o * o, 3)));
    });
    return h('table', { class: 'w-table readout' },
      h('thead', {}, h('tr', {}, h('th', {}, 'overlap with'), h('th', {}, 'amplitude'), h('th', {}, 'probability'))),
      h('tbody', {}, rows));
  }

  render(focusIndex) {
    const code = this.code;
    const psi = State.fromAngle(this.theta);
    const encoded = encode(code, psi);
    const state = encoded.clone().applyPauliUpToPhase(this.err);
    const c = code.classify(this.err);
    const dX = code.distance(['X']);
    const d = code.distance();
    const hint = `Click a qubit to cycle ${['no error', ...this.allowed.map((k) => k + (k === 'X' ? ' (bit flip)' : ' (phase flip)'))].join(' → ')}.`;

    this.replaceChildren(
      header(this, code.name, hint),
      h('p', { class: 'w-meta' }, h('span', { class: 'mono' }, `[[${code.n}, ${code.k}, ${d}]]`), ` · distance ${dX} against bit flips alone, ${d} once phase flips count`,
        ` · input α = ${fmt(Math.cos(this.theta / 2))}, β = ${fmt(Math.sin(this.theta / 2))}`),
      h('div', { class: 'w-row' }, qubitButtons(code, this.err, this.allowed, (i) => this.cycle(i)), meters(code, c.syndrome)),
      ampChart(state, this.layout),
      h('p', { class: `status is-${c.kind}` }, this.describe(c, state, encoded)),
      flag(this, 'decoder') ? this.decoderLine(c, state, encoded) : null,
      flag(this, 'logical') ? this.logicalReadout(state) : null,
      h('div', { class: 'controls' },
        slider('input |ψ⟩ = cos(θ/2)|0⟩ + sin(θ/2)|1⟩, θ =', { id: `${this.id}-theta`, min: 0, max: Math.PI.toFixed(4), step: 0.01, value: this.theta,
          format: (v) => `${v.toFixed(2)} rad`, oninput: (v) => { this.theta = v; this.render(); } }),
        h('button', { type: 'button', onclick: () => { assignPauli(this.err, Pauli.identity(code.n)); this.changed(); } }, 'Clear errors'),
        flag(this, 'logical') ? [
          h('button', { type: 'button', onclick: () => { assignPauli(this.err, this.err.mul(code.logicals[0].X)); this.changed(); } }, 'Apply X̄ = ' + code.logicals[0].X.toLabelled(code.labels)),
          h('button', { type: 'button', onclick: () => { assignPauli(this.err, this.err.mul(code.logicals[0].Z)); this.changed(); } }, 'Apply Z̄ = ' + code.logicals[0].Z.toLabelled(code.labels)),
        ] : null));
    if (focusIndex !== undefined) this.querySelector(`.qubit[data-i="${focusIndex}"]`)?.focus();
  }
}

function firstNonzero(state) {
  let best = 0, bv = 0;
  for (let i = 0; i < state.dim; i++) if (Math.abs(state.a[i]) > bv) { bv = Math.abs(state.a[i]); best = i; }
  return best;
}

/* ---------------------------------------------------- <qec-circuit> */

class QecCircuit extends Base {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    setup(this);
    this.code = getCode(attr(this, 'code', 'two-qubit'));
    this.n = this.code.n;
    this.m = this.code.stabilizers.length;
    this.k = this.code.logicals.length;
    this.dataQubits = this.code.extra.dataQubits ?? [0];
    const defaults = [DEFAULT_THETA, 2 * Math.atan2(0.28, 0.96)];
    this.thetas = attr(this, 'theta', '') ? attr(this, 'theta').split(',').map(Number) : defaults.slice(0, this.k);
    // codes with X-type stabilizers are drawn in their logical basis; repetition codes by computational subspace
    this.codeBasis = this.code.stabilizers.some((g) => g.x.some((b) => b));
    this.groups = attr(this, 'groups', '').split(',').filter(Boolean).map(Number);
    const dk = kinds(attr(this, 'decoder', ''));
    this.decoderKinds = dk.length ? dk : ['X'];
    this.fig = sharedError(this, this.n);
    this.err = this.fig ? this.fig.err
      : attr(this, 'error') ? Pauli.fromString(attr(this, 'error'), this.n) : Pauli.single(this.n, 0, 'X');
    if (this.fig) this.fig.addEventListener('qec-error', () => { this.mode = 'pauli'; this.outcome = null; this.render(); });
    this.mode = 'pauli';               // or 'coherent'
    this.allowed = kinds(attr(this, 'allowed', 'X'));
    this.p = 0.1;
    this.outcome = null;               // measured syndrome, once sampled
    this.layout = this.codeBasis ? null : subspaces(this.code);
    this.id ||= nextId('cc');
    this.stages = this.buildStages();
    this.stage = 0;
    this.render();
  }

  buildStages() {
    const s = [
      { id: 'init', name: 'Input' },
      { id: 'encode', name: 'Encoder' },
      { id: 'error', name: 'Error' },
      { id: 'h1', name: 'Ancilla Hadamards' },
    ];
    for (let k = 0; k < this.m; k++) s.push({ id: 'ctrl', k, name: `Controlled ${this.code.stabilizers[k].toLabelled(this.code.labels)}` });
    s.push({ id: 'h2', name: 'Ancilla Hadamards' });
    s.push({ id: 'measure', name: 'Measure the ancillas' });
    if (flag(this, 'decoder')) s.push({ id: 'recover', name: 'Recovery' });
    return s;
  }

  get ancillas() {
    return Array.from({ length: this.m }, (_, k) => this.n + k);
  }

  /** Part 1 widgets read `theta`; keep it as the first input angle. */
  get theta() { return this.thetas[0]; }
  set theta(v) { this.thetas[0] = v; }

  inputs() { return this.thetas.map((t) => State.fromAngle(t)); }

  /** The encoded input |ψ⟩ᴸ on the n data qubits. */
  encodedInput() { return encodeInputs(this.code, this.inputs()); }

  /** Recompute the joint state up to and including stage `upto`. */
  compute(upto) {
    const ins = this.inputs();
    const factors = [];
    for (let q = 0; q < this.n; q++) { const j = this.dataQubits.indexOf(q); factors.push(j >= 0 ? ins[j] : new State(1)); }
    let s = State.product(...factors, new State(this.m));
    let correction = null;
    for (let i = 1; i <= upto; i++) {
      const st = this.stages[i];
      switch (st.id) {
        case 'encode':
          for (const g of this.code.extra.encoder) { if (g.gate === 'h') s.h(g.target); else s.cnot(g.control, g.target); }
          break;
        case 'error':
          if (this.mode === 'pauli') s.applyPauliUpToPhase(this.err);
          else { for (let q = 0; q < this.n; q++) s.coherentBitFlip(q, this.p); s.normalize(); }
          break;
        case 'h1': case 'h2':
          for (const a of this.ancillas) s.h(a);
          break;
        case 'ctrl':
          s.controlledPauli(this.n + st.k, this.code.stabilizers[st.k]);
          break;
        case 'measure':
          if (this.outcome === null) this.outcome = s.sample(this.ancillas);
          s.collapse(this.ancillas, this.outcome);
          break;
        case 'recover': {
          correction = this.code.lookupDecoder(this.decoderKinds).get(this.outcome) ?? Pauli.identity(this.n);
          s.applyPauliUpToPhase(correction);
          break;
        }
      }
    }
    return { state: s, correction };
  }

  goto(i) {
    if (i < 0 || i >= this.stages.length) return;
    const measureIdx = this.stages.findIndex((s) => s.id === 'measure');
    if (i < measureIdx) this.outcome = null;
    this.stage = i;
    this.render();
  }

  resetOutcome() {
    this.outcome = null;
    this.render();
  }

  /* ---- drawing */

  circuit() {
    const n = this.n, m = this.m;
    const enc = this.code.extra.encoder;
    const stage = this.stages[this.stage];
    const big = n + m > 8;
    const colW = 52, left = 54, rowH = big ? 28 : 40, top = 30;
    // columns: encoder layers, error, H, ctrl×m, H, measure, [recover]
    const cols = [];
    const last = new Array(n).fill(-1), layers = [];
    for (const g of enc) {
      const lo = g.gate === 'h' ? g.target : Math.min(g.control, g.target), hi = g.gate === 'h' ? g.target : Math.max(g.control, g.target);
      let col = -1;
      for (let w = lo; w <= hi; w++) col = Math.max(col, last[w]);
      col += 1;
      for (let w = lo; w <= hi; w++) last[w] = col;
      (layers[col] ??= []).push(g);
    }
    layers.forEach((gates) => cols.push({ kind: 'enc', gates, stage: 'encode' }));
    cols.push({ kind: 'error', stage: 'error' });
    cols.push({ kind: 'h', stage: 'h1' });
    for (let k = 0; k < m; k++) cols.push({ kind: 'ctrl', k, stage: 'ctrl' });
    cols.push({ kind: 'h', stage: 'h2' });
    cols.push({ kind: 'measure', stage: 'measure' });
    if (flag(this, 'decoder')) cols.push({ kind: 'recover', stage: 'recover' });
    const W = left + cols.length * colW + 16;
    const H = top + (n + m) * rowH + 8;
    const wy = (q) => top + q * rowH + rowH / 2;
    const cx = (c) => left + c * colW + colW / 2;
    const els = [];

    // stage cursor
    const active = cols.map((c, i) => (c.stage === stage.id && (c.kind !== 'ctrl' || c.k === stage.k) ? i : -1)).filter((i) => i >= 0);
    if (stage.id === 'init') els.push(svg('rect', { x: 4, y: top - 6, width: left - 12, height: (n + m) * rowH + 12, rx: 4, class: 'cursor' }));
    if (active.length) els.push(svg('rect', { x: cx(active[0]) - colW / 2 + 2, y: top - 6, width: (active[active.length - 1] - active[0] + 1) * colW - 4, height: (n + m) * rowH + 12, rx: 4, class: 'cursor' }));

    // stage labels with a bracket
    const spans = [];
    const encCols = cols.map((c, i) => (c.stage === 'encode' ? i : -1)).filter((i) => i >= 0);
    if (encCols.length) spans.push([encCols[0], encCols[encCols.length - 1], 'Encoder']);
    spans.push([cols.findIndex((c) => c.kind === 'error'), cols.findIndex((c) => c.kind === 'error'), 'Error']);
    spans.push([cols.findIndex((c) => c.kind === 'h'), cols.findIndex((c) => c.kind === 'measure'), 'Syndrome extraction']);
    const rc = cols.findIndex((c) => c.kind === 'recover');
    if (rc >= 0) spans.push([rc, rc, 'Recovery']);
    for (const [a, b, text] of spans) {
      const x1 = cx(a) - colW / 2 + 6, x2 = cx(b) + colW / 2 - 6;
      els.push(svg('path', { d: `M${x1},14 V10 H${x2} V14`, class: 'stage-brace' }));
      els.push(svg('text', { x: (x1 + x2) / 2, y: 7, 'text-anchor': 'middle', class: 'stage-label' }, text));
    }

    // wires and labels
    for (let q = 0; q < n + m; q++) {
      els.push(svg('line', { x1: left - 4, x2: W - 10, y1: wy(q), y2: wy(q), class: 'wire' }));
      const di = this.dataQubits.indexOf(q);
      const label = q < n ? (di >= 0 ? `|ψ${this.k > 1 ? subscript(di + 1) : ''}⟩${subscript(q + 1)}` : `|0⟩${subscript(q + 1)}`) : `|0⟩${m > 1 ? 'A' + subscript(q - n + 1) : 'A'}`;
      els.push(svg('text', { x: left - 8, y: wy(q) + 4, 'text-anchor': 'end', class: 'wire-label' }, label));
    }

    cols.forEach((c, i) => {
      const x = cx(i);
      switch (c.kind) {
        case 'enc':
          for (const g of c.gates) {
            if (g.gate === 'h') {
              const y = wy(g.target);
              els.push(svg('rect', { x: x - 11, y: y - 11, width: 22, height: 22, class: 'gate' }));
              els.push(svg('text', { x, y: y + 4, 'text-anchor': 'middle', class: 'gate-label' }, 'H'));
            } else {
              const yc = wy(g.control), yt = wy(g.target);
              els.push(svg('line', { x1: x, x2: x, y1: yc, y2: yt, class: 'vline' }));
              els.push(svg('circle', { cx: x, cy: yc, r: 4, class: 'ctrl' }));
              els.push(svg('circle', { cx: x, cy: yt, r: 7, class: 'target' }));
              els.push(svg('path', { d: `M${x - 7},${yt} H${x + 7} M${x},${yt - 7} V${yt + 7}`, class: 'target-cross' }));
            }
          }
          break;
        case 'error': {
          const y1 = wy(0) - 15, y2 = wy(n - 1) + 15;
          els.push(svg('rect', { x: x - 16, y: y1, width: 32, height: y2 - y1, rx: 3, class: 'ebox' }));
          if (this.mode === 'pauli') {
            for (let q = 0; q < n; q++) {
              const op = this.err.at(q);
              if (op !== 'I') els.push(svg('text', { x, y: wy(q) + 4, 'text-anchor': 'middle', class: `gate-label err-${op}` }, op));
            }
            if (this.err.isIdentity()) els.push(svg('text', { x, y: (y1 + y2) / 2 + 4, 'text-anchor': 'middle', class: 'gate-label muted' }, 'E'));
          } else {
            els.push(svg('text', { x, y: (y1 + y2) / 2 + 4, 'text-anchor': 'middle', class: 'gate-label' }, 'E'));
          }
          break;
        }
        case 'h':
          for (const a of this.ancillas) {
            els.push(svg('rect', { x: x - 11, y: wy(a) - 11, width: 22, height: 22, class: 'gate' }));
            els.push(svg('text', { x, y: wy(a) + 4, 'text-anchor': 'middle', class: 'gate-label' }, 'H'));
          }
          break;
        case 'ctrl': {
          const gen = this.code.stabilizers[c.k];
          const sup = gen.support();
          const ya = wy(this.n + c.k);
          const y1 = wy(sup[0]) - 13, y2 = wy(sup[sup.length - 1]) + 13;
          els.push(svg('line', { x1: x, x2: x, y1: ya, y2: y2, class: 'vline' }));
          els.push(svg('circle', { cx: x, cy: ya, r: 4, class: 'ctrl' }));
          els.push(svg('rect', { x: x - 20, y: y1, width: 40, height: y2 - y1, rx: 2, class: 'gate' }));
          if (sup.length > 2 && sup.length * rowH > 60) {
            for (const q of sup) els.push(svg('text', { x, y: wy(q) + 4, 'text-anchor': 'middle', class: 'gate-label' }, gen.at(q)));
          } else {
            els.push(svg('text', { x, y: (y1 + y2) / 2 + 4, 'text-anchor': 'middle', class: 'gate-label' }, gen.toLabelled(this.code.labels)));
          }
          break;
        }
        case 'measure':
          this.ancillas.forEach((a, k) => {
            const y = wy(a);
            els.push(svg('rect', { x: x - 13, y: y - 11, width: 26, height: 22, class: 'gate' }));
            els.push(svg('path', { d: `M${x - 8},${y + 5} A8,8 0 0 1 ${x + 8},${y + 5}`, class: 'meter-arc' }));
            els.push(svg('line', { x1: x, y1: y + 5, x2: x + 6, y2: y - 4, class: 'meter-needle' }));
            if (this.outcome !== null && this.stage >= this.stages.findIndex((s) => s.id === 'measure')) {
              els.push(svg('text', { x: x + 20, y: y + 4, class: 'outcome' }, this.outcome[k]));
            }
          });
          break;
        case 'recover': {
          const y1 = wy(0) - 15, y2 = wy(n - 1) + 15;
          els.push(svg('rect', { x: x - 14, y: y1, width: 28, height: y2 - y1, rx: 3, class: 'gate' }));
          els.push(svg('text', { x, y: (y1 + y2) / 2 + 4, 'text-anchor': 'middle', class: 'gate-label' }, 'R'));
          break;
        }
      }
    });

    const out = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'circuit', style: W > 720 ? { width: `${W}px`, maxWidth: 'none' } : { maxWidth: `${W * 1.15}px` }, role: 'img',
      'aria-label': `Circuit of the ${this.code.name}: encoder, error stage, and syndrome extraction with ${m} ancilla${m > 1 ? 's' : ''}. Current stage: ${stage.name}.` }, els);
    return W > 720 ? h('div', { class: 'scroll' }, out) : out;
  }

  caption(state, correction) {
    const st = this.stages[this.stage];
    const m = this.m, n = this.n;
    const anc = m > 1 ? 'ancillas' : 'ancilla';
    const errName = this.mode === 'pauli' ? this.err.toLabelled(this.code.labels) : `√(1−p)·𝟙 + √p·X on every qubit, p = ${this.p.toFixed(2)}`;
    switch (st.id) {
      case 'init': {
        const ins = this.thetas.map((t, j) => `|ψ${this.k > 1 ? subscript(j + 1) : ''}⟩ = ${fmt(Math.cos(t / 2))}|0⟩ + ${fmt(Math.sin(t / 2))}|1⟩`).join(' and ');
        return `The data qubit${this.k > 1 ? 's hold' : ' holds'} ${ins}. The ${n - this.k} redundancy qubit${n - this.k > 1 ? 's' : ''} and the ${m} ${anc} start in |0⟩.`;
      }
      case 'encode':
        if (this.code.extra.encoderNote) return this.code.extra.encoderNote;
        return `CNOTs from qubit 1 spread the amplitudes onto |${'0'.repeat(n)}⟩ and |${'1'.repeat(n)}⟩ (eq. 12). Nothing is copied: the two amplitudes are still α and β, now shared by ${n} qubits. The state lies in the codespace C.`;
      case 'error':
        return this.mode === 'pauli'
          ? (this.err.isIdentity() ? 'No error this time. The state is still in C.' : `${errName} moves the state out of C into an error space, or within C if it is a logical operator, without touching the stored amplitudes. The panel below shows where it went.`)
          : `The coherent error ${errName} (eq. 20) puts the state in a superposition over C and the error spaces, with weight (1−p)^${n} on "nothing happened" and smaller weights on each flip pattern (eq. 21).`;
      case 'h1':
        return `Hadamards put the ${anc} in |+⟩. Both branches of the ${anc} now hold a copy of the data state; nothing has been learned yet.`;
      case 'ctrl':
        return `Controlled on the ${anc === 'ancilla' ? 'ancilla' : 'ancilla A' + subscript(st.k + 1)}, the stabilizer ${this.code.stabilizers[st.k].toLabelled(this.code.labels)} is applied to the data. On the |1⟩ branch of that ancilla the data picks up the stabilizer's eigenvalue as a sign: +1 in C, −1 in the error spaces it detects.`;
      case 'h2':
        return `The second Hadamards turn that phase into a population: the ${anc} end${m > 1 ? '' : 's'} in |0⟩ where the eigenvalue was +1 and in |1⟩ where it was −1 (eq. 19). Each ancilla value is now paired with one subspace of the data, and the measurement is about to reveal which, not α and β.`;
      case 'measure': {
        const br = this.compute(this.stage - 1).state.branches(this.ancillas);
        const chosen = br.find((b) => b.bits === this.outcome);
        return `Measured syndrome S = ${this.outcome} (probability ${fmt(chosen.prob, 3)}). The data collapsed onto the subspace paired with that outcome. Press "Measure again" to resample from the same pre-measurement state.`;
      }
      case 'recover': {
        const psiL = this.encodedInput();
        const data = state.branches(this.ancillas).find((b) => b.prob > 1e-9).state;
        const F = data.fidelity(psiL);
        const XL = psiL.clone().applyPauliUpToPhase(this.code.logicals[0].X);
        const FX = data.fidelity(XL);
        const applied = correction && !correction.isIdentity() ? `The lookup table maps S = ${this.outcome} to ${correction.toLabelled(this.code.labels)}, which is applied. ` : `Syndrome ${this.outcome} asks for no correction. `;
        if (this.mode === 'pauli') {
          const r = this.code.classify(this.err.mul(correction ?? Pauli.identity(this.n)));
          if (r.kind === 'stabilizer' && correction && !correction.isIdentity()) return `${applied}The net effect ${this.err.mul(correction).toLabelled(this.code.labels)} is a stabilizer, so the state is restored even though the correction was not the error itself (degeneracy). Fidelity to |ψ⟩ᴸ: ${fmt(F, 3)}. Recovered.`;
          if (r.kind === 'logical') return `${applied}Fidelity to |ψ⟩ᴸ: ${fmt(F, 3)}. The net effect is a logical ${r.action.join(' ')}${r.action.some((a) => a.startsWith('X̄')) && correction && !correction.isIdentity() ? ': the correction completed a logical bit flip, and the decoder was fooled' : ', which no syndrome can see'}.`;
        }
        if (F > 0.9995) return `${applied}Fidelity to the encoded input |ψ⟩ᴸ: ${fmt(F, 3)}. Recovered.`;
        if (FX > 0.9995) return `${applied}Fidelity to |ψ⟩ᴸ: ${fmt(F, 3)}; to X̄|ψ⟩ᴸ: ${fmt(FX, 3)}. The correction completed a logical bit flip: the decoder was fooled.`;
        return `${applied}Fidelity to |ψ⟩ᴸ: ${fmt(F, 3)}; to X̄|ψ⟩ᴸ: ${fmt(FX, 3)}. The residual is a superposition of "nothing happened" and a logical X̄; the operator weight of X̄ is what eq. 24 calls p_L.`;
      }
    }
    return '';
  }

  /** Ancilla outcome probabilities at this stage (the data itself is drawn in the subspace view). */
  outcomes(state) {
    const measureIdx = this.stages.findIndex((st) => st.id === 'measure');
    if (this.stage < this.stages.findIndex((st) => st.id === 'h2')) return null;
    const measured = this.stage >= measureIdx;
    const br = state.branches(this.ancillas);
    const pre = measured ? this.compute(measureIdx - 1).state.branches(this.ancillas) : br;
    return h('p', { class: 'outcomes' },
      h('span', { class: 'outcomes-name' }, measured ? 'Ancilla outcome:' : 'If measured now:'),
      (pre.length > 4 ? pre.filter((b) => b.prob > 1e-9) : pre).map((b) => h('span', { class: `outcome-chip${b.prob < 1e-9 ? ' dead' : ''}${measured && b.bits === this.outcome ? ' chosen' : ''}` },
        h('span', { class: 'mono' }, `S = ${b.bits}`), ` p = ${fmt(b.prob, 3)}`)));
  }

  setError(mutate) {
    this.mode = 'pauli';
    mutate(this.err);
    this.outcome = null;
    if (this.fig) this.fig.broadcast(); else this.render();
  }

  cycle(i) {
    const order = ['I', ...this.allowed];
    this.setError((e) => e.set(i, order[(order.indexOf(e.at(i)) + 1) % order.length]));
  }

  /** The encoded state right after the error stage, with the error panel under it. */
  errorPanel() {
    if (this.codeBasis) return this.codeBasisPanel();
    const code = this.code;
    const encoded = encode(code, State.fromAngle(this.theta));
    const errIdx = this.stages.findIndex((st) => st.id === 'error');
    const after = this.compute(errIdx).state.branches(this.ancillas)[0].state;
    const coherent = this.mode === 'coherent';
    const c = code.classify(this.err);
    const syn = coherent ? null : c.syndrome;
    const meterRow = coherent
      ? h('div', { class: 'meters', role: 'group', 'aria-label': 'stabilizer expectation values' },
        code.stabilizers.map((st) => h('div', { class: 'meter' },
          h('span', { class: 'meter-name' }, st.toLabelled(code.labels)),
          h('span', { class: 'meter-val' }, fmt(after.expectZ(st.support()))),
          h('span', { class: 'meter-bit' }, 'expectation'))))
      : meters(code, syn);
    const hint = `Click a qubit to cycle ${['no error', ...this.allowed.map((k) => k + (k === 'X' ? ' (bit flip)' : ' (phase flip)'))].join(' → ')}.`;
    return h('div', { class: 'error-panel' },
      h('p', { class: 'panel-head' }, h('b', {}, 'Error E and the encoded state after it'), ' ', h('span', { class: 'w-hint' }, hint)),
      h('div', { class: 'w-row' }, qubitButtons(code, this.err, this.allowed, (i) => this.cycle(i)), meterRow),
      ampChart(after, this.layout),
      coherent
        ? h('p', { class: 'status' }, `The coherent error of eq. 20 on every qubit, p = ${this.p.toFixed(2)}, leaves a superposition over C and the error spaces; each meter shows an expectation value rather than ±1. The syndrome measurement will pick one subspace, with the probabilities shown under the circuit once the ancillas are ready.`)
        : h('p', { class: `status is-${c.kind}` }, QecStateView.prototype.describe.call(this, c, after, encoded)),
      !coherent && flag(this, 'decoder') ? QecStateView.prototype.decoderLine.call(this, c, after, encoded) : null,
      flag(this, 'logical') ? QecStateView.prototype.logicalReadout.call(this, after) : null);
  }

  /** Error panel for codes with X-type stabilizers: amplitudes in the logical basis (see <qec-code-view>). */
  codeBasisPanel() {
    const code = this.code;
    const psiL = this.encodedInput();
    const state = psiL.clone().applyPauliUpToPhase(this.err);
    const c = code.classify(this.err);
    const syn = Array.from(c.syndrome).join('');
    const { svg: chart, R } = QecCodeView.prototype.chart.call(this, state, syn);
    const hint = `Click a qubit to cycle ${['no error', ...this.allowed].join(' → ')}.`;
    return h('div', { class: 'error-panel' },
      h('p', { class: 'panel-head' }, h('b', {}, 'Error E and the encoded state after it'), ' ', h('span', { class: 'w-hint' }, hint)),
      h('p', { class: 'w-meta' }, h('span', { class: 'mono' }, code.params()), ' · logical operators ',
        code.logicals.map((l, j) => { const sub = this.k > 1 ? subscript(j + 1) : ''; return `X̄${sub} = ${l.X.toLabelled(code.labels)}, Z̄${sub} = ${l.Z.toLabelled(code.labels)}`; }).join('; ')),
      h('div', { class: 'w-row' }, qubitButtons(code, this.err, this.allowed, (i) => this.cycle(i), this.groups), meters(code, c.syndrome)),
      chart,
      h('p', { class: `status is-${c.kind}` }, QecCodeView.prototype.describe.call(this, c, R)),
      flag(this, 'decoder') ? QecCodeView.prototype.decoderLine.call(this, c, state, psiL) : null);
  }

  controls() {
    const measureIdx = this.stages.findIndex((s) => s.id === 'measure');
    const code = this.code;
    return h('div', { class: 'controls stack' },
      h('div', { class: 'stepper' },
        h('button', { type: 'button', disabled: this.stage === 0, onclick: () => this.goto(this.stage - 1) }, '← Back'),
        h('span', { class: 'stepper-pos' }, `Stage ${this.stage + 1} of ${this.stages.length}: ${this.stages[this.stage].name}`),
        h('button', { type: 'button', class: 'primary', disabled: this.stage === this.stages.length - 1, onclick: () => this.goto(this.stage + 1) }, this.stage + 1 < this.stages.length ? `Next: ${this.stages[this.stage + 1].name} →` : 'Done'),
        this.stage >= measureIdx ? h('button', { type: 'button', onclick: () => { this.outcome = null; this.stage = measureIdx; this.render(); } }, 'Measure again') : null,
        h('button', { type: 'button', onclick: () => this.goto(0) }, 'Restart')));
  }

  inputControls() {
    const code = this.code;
    return h('div', { class: 'controls' },
      this.thetas.map((t, j) => slider(this.k > 1 ? `input |ψ${subscript(j + 1)}⟩: θ${subscript(j + 1)} =` : 'input |ψ⟩ = cos(θ/2)|0⟩ + sin(θ/2)|1⟩, θ =', {
        id: this.k > 1 ? `${this.id}-theta-${j}` : `${this.id}-theta`, min: 0, max: Math.PI.toFixed(4), step: 0.01, value: t, format: (v) => `${v.toFixed(2)} rad`,
        oninput: (v) => { this.thetas[j] = v; this.outcome = null; this.render(); } })),
      h('button', { type: 'button', onclick: () => this.setError((e) => assignPauli(e, Pauli.identity(this.n))) }, 'Clear errors'),
      flag(this, 'logical') ? code.logicals.flatMap((l, j) => ['X', 'Z'].map((op) => h('button', { type: 'button', onclick: () => this.setError((e) => assignPauli(e, e.mul(l[op]))) },
        `Apply ${op}̄${this.k > 1 ? subscript(j + 1) : ''} = ${l[op].toLabelled(code.labels)}`))) : null,
      flag(this, 'coherent') ? h('button', { type: 'button', class: `chip${this.mode === 'coherent' ? ' on' : ''}`, 'aria-pressed': this.mode === 'coherent',
        onclick: () => { this.mode = this.mode === 'coherent' ? 'pauli' : 'coherent'; this.outcome = null; this.render(); } }, 'coherent error (eq. 20)') : null,
      flag(this, 'coherent') && this.mode === 'coherent' ? slider('p =', { id: `${this.id}-p`, min: 0, max: 0.5, step: 0.01, value: this.p, format: (v) => v.toFixed(2),
        oninput: (v) => { this.p = v; this.outcome = null; this.render(); } }) : null);
  }

  render() {
    const { state, correction } = this.compute(this.stage);
    this.replaceChildren(
      header(this, `${this.code.name}: the circuit, stage by stage`, 'Step through the circuit gate by gate.'),
      this.circuit(),
      h('p', { class: 'stage-caption' }, h('b', {}, `${this.stages[this.stage].name}. `), this.caption(state, correction)),
      this.outcomes(state),
      this.controls(),
      this.errorPanel(),
      this.inputControls());
  }
}

/* ------------------------------------------------ <qec-suppression> */

class QecSuppression extends Base {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    setup(this);
    this.code = getCode(attr(this, 'code', 'two-qubit'));
    this.n = this.code.n;
    // two-qubit: detect and discard (eq. 24); odd n: correct by lookup table
    this.correct = this.n % 2 === 1;
    this.p = Number(attr(this, 'p', '0.1'));
    this.hoverP = null;
    this.id ||= nextId('sp');
    this.rows = this.code.errorTable(['X']).map((r) => ({ ...r, effect: this.effect(r) }));
    this.build();
    this.update();
  }

  /** What syndrome extraction (and, for a correcting code, recovery) does to one term of E^{⊗n}. */
  effect(r) {
    const c = this.code.classify(r.error);
    if (c.kind === 'identity') return { text: 'nothing', fails: false };
    if (c.kind === 'logical') return { text: 'logical X̄, undetected', fails: true };
    if (!this.correct) return { text: 'detected, run discarded', fails: false, discarded: true };
    const corr = this.code.lookupDecoder(['X']).get(r.syndrome);
    const rc = this.code.classify(r.error.mul(corr));
    return rc.kind === 'logical'
      ? { text: `decoder applies ${corr.toLabelled(this.code.labels)}: logical X̄`, fails: true }
      : { text: `corrected by ${corr.toLabelled(this.code.labels)}`, fails: false };
  }

  /** Weight of a term: |α_I^{n−w} α_X^w|² = (1−p)^{n−w} p^w. */
  weight(r, p) { return (1 - p) ** (this.n - r.weight) * p ** r.weight; }

  /** Logical error probability: conditional on syndrome 0 when detecting (eq. 24), unconditional when correcting. */
  pL(p) {
    let fail = 0, kept = 0;
    for (const r of this.rows) {
      const w = this.weight(r, p);
      if (r.effect.discarded) continue;
      kept += w;
      if (r.effect.fails) fail += w;
    }
    return this.correct ? fail : fail / kept;
  }

  pDiscard(p) {
    return this.rows.filter((r) => r.effect.discarded).reduce((a, r) => a + this.weight(r, p), 0);
  }

  get formula() {
    return this.correct ? 'p_L = 3p² − 2p³' : 'p_L = p² / ((1−p)² + p²)';
  }

  build() {
    const W = 520, H = 300, L = 54, R = 16, T = 14, B = 44;
    const xmax = 0.5;
    const x = (p) => L + (p / xmax) * (W - L - R);
    const y = (v) => T + (1 - v / xmax) * (H - T - B);
    this.geom = { W, H, L, R, T, B, x, y, xmax };
    const f = (p) => this.pL(p);
    const encLabel = this.correct ? `${this.code.name}, corrected: p_L` : 'two-qubit code, syndrome 0: p_L';

    const grid = [0, 0.1, 0.2, 0.3, 0.4, 0.5].flatMap((t) => [
      svg('line', { x1: x(0), x2: x(xmax), y1: y(t), y2: y(t), class: 'grid' }),
      svg('text', { x: x(0) - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'tick' }, t.toFixed(1)),
      svg('text', { x: x(t), y: y(0) + 18, 'text-anchor': 'middle', class: 'tick' }, t.toFixed(1)),
    ]);
    const path = (g) => Array.from({ length: 101 }, (_, k) => { const p = (k / 100) * xmax; return `${x(p).toFixed(1)},${y(g(p)).toFixed(1)}`; }).join(' ');

    this.cross = svg('line', { x1: 0, x2: 0, y1: y(0), y2: y(xmax), class: 'crosshair' });
    this.dotRef = svg('circle', { r: 4.5, class: 'dot dot-ref' });
    this.dotEnc = svg('circle', { r: 4.5, class: 'dot dot-enc' });

    this.svg = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img',
      'aria-label': `Logical error probability of the ${this.code.name} (${this.formula}) against the physical bit-flip probability, compared with an unencoded qubit` },
      grid,
      svg('text', { x: (x(0) + x(xmax)) / 2, y: H - 6, 'text-anchor': 'middle', class: 'axis' }, 'physical bit-flip probability p'),
      svg('text', { x: 13, y: (y(0) + y(xmax)) / 2, 'text-anchor': 'middle', class: 'axis', transform: `rotate(-90 13 ${(y(0) + y(xmax)) / 2})` }, 'error probability'),
      svg('polyline', { points: path((p) => p), class: 'line line-ref' }),
      svg('polyline', { points: path(f), class: 'line line-enc' }),
      svg('text', { x: x(0.17), y: y(0.17) - 9, 'text-anchor': 'middle', class: 'dlabel' }, 'unencoded: p'),
      svg('text', { x: x(0.33), y: y(f(0.33)) + 16, 'text-anchor': 'middle', class: 'dlabel' }, encLabel),
      this.cross, this.dotRef, this.dotEnc,
      svg('rect', { x: x(0), y: y(xmax), width: x(xmax) - x(0), height: y(0) - y(xmax), fill: 'transparent',
        onpointermove: (e) => { const r = this.svg.getBoundingClientRect(); const px = (e.clientX - r.left) * (W / r.width); this.hoverP = Math.round(Math.min(xmax, Math.max(0, ((px - L) / (W - L - R)) * xmax)) * 200) / 200; this.update(); },
        onpointerleave: () => { this.hoverP = null; this.update(); } }));

    this.tip = h('div', { class: 'tip', role: 'status' });
    this.terms = h('tbody');
    this.readout = h('p', { class: 'readout-line' });
    this.tableBody = h('tbody');
    const factors = Array.from({ length: this.n }, (_, i) => `E${subscript(i + 1)}`).join(' ⊗ ');
    const title = this.correct ? 'Error suppression by correction' : 'Error suppression by detection';

    this.replaceChildren(
      header(this, title, 'Move the slider, or hover the plot.'),
      slider('p =', { id: `${this.id}-p`, min: 0, max: 0.5, step: 0.005, value: this.p, live: true, format: (v) => v.toFixed(3), oninput: (v) => { this.p = v; this.update(); } }),
      h('div', { class: 'scroll' }, h('table', { class: 'w-table terms' },
        h('thead', {}, h('tr', {}, h('th', {}, `term of ${factors}${this.correct ? '' : ' (eq. 21)'}`), h('th', {}, 'coefficient'), h('th', {}, 'value'), h('th', {}, 'syndrome'), h('th', {}, 'effect on |ψ⟩ᴸ'))),
        this.terms)),
      this.readout,
      h('div', { class: 'legend' },
        h('span', {}, h('i', { class: 'key key-ref' }), 'unencoded qubit: p'),
        h('span', {}, h('i', { class: 'key key-enc' }), this.correct ? `${this.code.name} with the lookup decoder: ${this.formula}` : `two-qubit code, given syndrome 0: ${this.formula}`)),
      h('div', { class: 'chartwrap' }, this.svg, this.tip),
      h('details', {}, h('summary', {}, 'Values as a table'),
        h('table', { class: 'w-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'p'),
          this.correct ? null : h('th', {}, 'P(syndrome 1)'),
          h('th', {}, this.correct ? 'p_L after correction' : 'p_L given syndrome 0'), h('th', {}, 'p / p_L'))), this.tableBody)));
  }

  update() {
    const p = this.hoverP ?? this.p;
    const { x, y, W, L, R } = this.geom;
    const pL = this.pL(p);
    this.cross.setAttribute('x1', x(p)); this.cross.setAttribute('x2', x(p));
    this.dotRef.setAttribute('cx', x(p)); this.dotRef.setAttribute('cy', y(p));
    this.dotEnc.setAttribute('cx', x(p)); this.dotEnc.setAttribute('cy', y(pL));
    this.tip.replaceChildren(
      h('div', { class: 'tip-x' }, `p = ${p.toFixed(3)}`),
      h('div', {}, h('i', { class: 'key key-ref' }), h('b', {}, fmt(p, 4)), ' unencoded'),
      h('div', {}, h('i', { class: 'key key-enc' }), h('b', {}, fmt(pL, 4)), ` ${this.code.name.toLowerCase()}`));
    const frac = (x(p) - L) / (W - L - R);
    this.tip.style.left = `${(x(p) / W) * 100}%`;
    this.tip.style.transform = frac > 0.55 ? 'translate(calc(-100% - 12px), 0)' : 'translate(12px, 0)';

    const pp = this.p, n = this.n;
    const coef = (w) => [n - w > 0 ? `α_I${n - w > 1 ? superscript(n - w) : ''}` : '', w > 0 ? `α_X${w > 1 ? superscript(w) : ''}` : ''].filter(Boolean).join(' ');
    this.terms.replaceChildren(...this.rows.map((r) => h('tr', { class: r.effect.fails ? 'is-logical' : (r.effect.discarded ? 'lit' : '') },
      h('td', { class: 'mono' }, r.weight ? r.label : Array.from({ length: n }, (_, i) => `𝟙${subscript(i + 1)}`).join('')),
      h('td', { class: 'mono' }, coef(r.weight)),
      h('td', { class: 'mono' }, fmt(Math.sqrt(this.weight(r, pp)), 3)),
      h('td', { class: 'mono' }, r.syndrome), h('td', {}, r.effect.text))));
    const pLp = this.pL(pp);
    const ratio = pp > 0 ? `, ${(pp / pLp).toFixed(1)}× below the unencoded p.` : '.';
    if (this.correct) {
      this.readout.replaceChildren(
        `At p = ${pp.toFixed(3)}: α_I = ${fmt(Math.sqrt(1 - pp), 3)}, α_X = ${fmt(Math.sqrt(pp), 3)}. Every run is kept. The decoder undoes the three single flips; the three double flips and X₁X₂X₃ end as X̄, with total weight 3α_I²α_X⁴ + α_X⁶ = 3p²(1−p) + p³, so p_L = 3p² − 2p³ = ${fmt(pLp, 4)}`, ratio);
    } else {
      this.readout.replaceChildren(
        `At p = ${pp.toFixed(3)}: α_I = ${fmt(Math.sqrt(1 - pp), 3)}, α_X = ${fmt(Math.sqrt(pp), 3)}. The syndrome reads 1 with probability 2α_I²α_X² = ${fmt(this.pDiscard(pp), 3)}, and the run is discarded. `,
        `When it reads 0, the state is ∝ (α_I²·𝟙 + α_X²·X₁X₂)|ψ⟩ᴸ, so the logical error probability is p_L = α_X⁴ / (α_I⁴ + α_X⁴) = ${fmt(pLp, 4)}`, ratio);
    }
    this.tableBody.replaceChildren(...[0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5].map((q) => h('tr', {},
      h('td', { class: 'mono' }, q.toFixed(2)),
      this.correct ? null : h('td', { class: 'mono' }, fmt(this.pDiscard(q), 4)),
      h('td', { class: 'mono' }, fmt(this.pL(q), 4)), h('td', { class: 'mono' }, (q / this.pL(q)).toFixed(1)))));
  }
}

const SUP = { 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
function superscript(k) { return SUP[k] ?? `^${k}`; }

/* --------------------------------------------- <qec-syndrome-table> */

class QecSyndromeTable extends Base {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    setup(this);
    const code = getCode(attr(this, 'code', 'three-qubit'));
    this.fig = sharedError(this, code.n);
    if (this.fig) this.fig.addEventListener('qec-error', () => this.highlight());
    const ks = kinds(attr(this, 'errors', 'X'));
    const maxW = Number(attr(this, 'max-weight', code.n));
    const rows = maxW === 1
      ? [{ error: Pauli.identity(code.n), label: 'I', syndrome: '0'.repeat(code.stabilizers.length), weight: 0 }, ...code.singleQubitTable(ks)]
      : code.errorTable(ks, maxW);
    const m = code.stabilizers.length;
    const table = code.lookupDecoder(ks);
    const single = new Map();
    for (const r of rows) if (r.weight === 1 && !single.has(r.syndrome)) single.set(r.syndrome, r.label);
    const distinct = new Set(rows.map((r) => r.syndrome)).size;
    const shareNote = rows.length > 2 ** m
      ? `Rows are ordered by weight. The ${m} generator${m > 1 ? 's' : ''} ${code.stabilizers.map((s) => s.toLabelled(code.labels)).join(' and ')} give${m > 1 ? '' : 's'} ${2 ** m} possible syndromes for ${rows.length} error patterns, so some patterns must share a syndrome${flag(this, 'decoder') ? '; the decoder always assumes the lightest one' : ''}.`
      : `The ${rows.length - 1} single-qubit errors produce ${distinct - 1} distinct non-zero syndromes out of ${2 ** m - 1} possible${distinct < rows.length ? ', so some share a syndrome' : ''}.`;

    const verdict = (r) => {
      const c = code.classify(r.error);
      if (c.kind === 'identity') return 'nothing to do';
      if (c.kind === 'logical') return `undetected: acts as ${c.action.join(' ')}`;
      if (c.kind === 'stabilizer') return 'undetected, but harmless (a stabilizer)';
      if (!flag(this, 'decoder')) return 'detected';
      const corr = table.get(r.syndrome);
      const residual = r.error.mul(corr);
      const rc = code.classify(residual);
      if (rc.kind === 'identity') return `detected; decoder applies ${corr.toLabelled(code.labels)} and recovers`;
      if (rc.kind === 'stabilizer') return `detected; decoder applies ${corr.toLabelled(code.labels)}, and ${r.error.mul(corr).toLabelled(code.labels)} is a stabilizer, so it recovers (degenerate)`;
      return `same syndrome as ${single.get(r.syndrome)}; decoder applies ${corr.toLabelled(code.labels)}, leaving ${rc.action.join(' ')}`;
    };

    this.replaceChildren(
      header(this, `${code.name}: syndromes of every ${ks.join('/')} error pattern`),
      h('div', { class: 'scroll' }, h('table', { class: 'w-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'error'), h('th', {}, 'weight'), code.stabilizers.map((s) => h('th', { class: 'mono' }, s.toLabelled(code.labels))), h('th', {}, 'syndrome S'), h('th', {}, 'what happens'))),
        h('tbody', {}, rows.map((r) => h('tr', {
          class: code.classify(r.error).kind === 'logical' ? 'is-logical' : '',
          'data-error': r.error.toString(),
          tabindex: this.fig ? 0 : undefined,
          role: this.fig ? 'button' : undefined,
          title: this.fig ? 'Use this error in the other parts of the figure' : undefined,
          onclick: this.fig ? () => { assignPauli(this.fig.err, r.error); this.fig.broadcast(); } : undefined,
          onkeydown: this.fig ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); assignPauli(this.fig.err, r.error); this.fig.broadcast(); } } : undefined,
        },
          h('td', { class: 'mono' }, r.label), h('td', { class: 'mono' }, r.weight),
          Array.from(r.syndrome).map((b) => h('td', { class: `mono${b === '1' ? ' lit' : ''}` }, b === '1' ? '−1' : '+1')),
          h('td', { class: 'mono' }, r.syndrome), h('td', {}, verdict(r))))))),
      h('p', { class: 'w-note' }, shareNote,
        this.fig ? ' Click a row to apply that error in the other parts.' : ''));
    this.highlight();
  }

  highlight() {
    if (!this.fig) return;
    const current = this.fig.err.toString();
    for (const tr of this.querySelectorAll('tbody tr')) tr.classList.toggle('current', tr.dataset.error === current);
  }
}

/* ----------------------------------------------------- <qec-figure> */

class QecFigure extends Base {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    this.classList.add('qec-figure');
    const label = attr(this, 'label', '');
    const head = h('div', { class: 'w-head fig-head' },
      h('span', { class: 'w-kicker' }, label ? `Figure ${label} · interactive, in ${this.querySelectorAll(WIDGET_TAGS).length} parts` : 'Interactive'),
      h('span', { class: 'w-title' }, attr(this, 'title', '')),
      h('span', { class: 'w-hint' }, attr(this, 'hint', 'The parts share one error: change it in any of them and the others follow.')));
    this.prepend(head);
  }
}

/* ------------------------------------------------------ code-basis chart */

/**
 * Bars for a list of columns [{label, amp}], optionally grouped into bands
 * [{label, count, kind: 'C' | 'F'}]. Used where the columns are not
 * computational basis states: the logical basis of a code, or the non-zero
 * terms of a state.
 */
function barChart(columns, bands = [], { colW = 56, height = 128, title = 'amplitudes' } = {}) {
  const padL = 6, padR = 6, top = bands.length ? 20 : 8, bottom = 18;
  const W = padL + Math.max(columns.length, 1) * colW + padR;
  const half = height / 2, y0 = top + half, barMax = half - 14;
  const barW = Math.min(24, Math.round(colW * 0.45));
  const H = top + height + bottom;
  const els = [];
  let x = padL;
  for (const b of bands) {
    const w = b.count * colW;
    els.push(svg('rect', { x, y: 2, width: w - 3, height: H - 4, rx: 3, class: `band band-${b.kind}` }));
    els.push(svg('text', { x: x + 6, y: 13, class: 'band-label' }, b.label));
    x += w;
  }
  els.push(svg('line', { x1: padL, x2: W - padR, y1: y0, y2: y0, class: 'zero' }));
  columns.forEach((col, c) => {
    const a = col.amp, cx = padL + c * colW + colW / 2, hgt = Math.abs(a) * barMax;
    const g = svg('g', { class: 'col' }, svg('title', {}, `${col.label}: amplitude ${fmt(a, 3)}`));
    if (hgt > 0.5) {
      const r = Math.min(4, hgt), xl = cx - barW / 2, xr = cx + barW / 2;
      const d = a > 0
        ? `M${xl},${y0} V${y0 - hgt + r} Q${xl},${y0 - hgt} ${xl + r},${y0 - hgt} H${xr - r} Q${xr},${y0 - hgt} ${xr},${y0 - hgt + r} V${y0} Z`
        : `M${xl},${y0} V${y0 + hgt - r} Q${xl},${y0 + hgt} ${xl + r},${y0 + hgt} H${xr - r} Q${xr},${y0 + hgt} ${xr},${y0 + hgt - r} V${y0} Z`;
      g.append(svg('path', { d, class: a > 0 ? 'bar' : 'bar bar-neg' }));
      g.append(svg('text', { x: cx, y: a > 0 ? y0 - hgt - 4 : y0 + hgt + 11, 'text-anchor': 'middle', class: 'val' }, fmt(a)));
    }
    g.append(svg('text', { x: cx, y: H - 4, 'text-anchor': 'middle', class: 'ket' }, col.label));
    els.push(g);
  });
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'amp-chart', style: { maxWidth: `${W}px` }, role: 'img', 'aria-label': title }, els);
}

const logicalKet = (j, k) => `|${j.toString(2).padStart(k, '0')}⟩ᴸ`;

function groupedKet(i, n, groups) {
  const bits = i.toString(2).padStart(n, '0');
  if (!groups.length) return `|${bits}⟩`;
  const parts = [];
  let at = 0;
  for (const g of groups) { parts.push(bits.slice(at, at + g)); at += g; }
  if (at < n) parts.push(bits.slice(at));
  return `|${parts.join(' ')}⟩`;
}

/** Real input coefficients for k logical qubits: a product of cos(θ/2)|0⟩ + sin(θ/2)|1⟩ factors. */
function productCoeffs(thetas) {
  let c = [1];
  for (const t of thetas) {
    const a = Math.cos(t / 2), b = Math.sin(t / 2);
    c = c.flatMap((v) => [v * a, v * b]);
  }
  return c;
}

/* --------------------------------------------------- <qec-code-view> */

class QecCodeView extends Base {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    setup(this);
    this.code = getCode(attr(this, 'code', 'four-two-two'));
    this.k = this.code.logicals.length;
    this.allowed = kinds(attr(this, 'allowed', 'XZY'));
    this.groups = attr(this, 'groups', '').split(',').filter(Boolean).map(Number);
    const defaults = [DEFAULT_THETA, 2 * Math.atan2(0.28, 0.96)];
    this.thetas = attr(this, 'theta', '') ? attr(this, 'theta').split(',').map(Number) : defaults.slice(0, this.k);
    this.fig = sharedError(this, this.code.n);
    this.err = this.fig ? this.fig.err : attr(this, 'initial') ? Pauli.fromString(attr(this, 'initial'), this.code.n) : Pauli.identity(this.code.n);
    if (this.fig) this.fig.addEventListener('qec-error', () => { const f = this.pendingFocus; this.pendingFocus = undefined; this.render(f); });
    this.id ||= nextId('cv');
    this.render();
  }

  changed(focusIndex) {
    if (this.fig) { this.pendingFocus = focusIndex; this.fig.broadcast(); } else this.render(focusIndex);
  }

  cycle(i) {
    const order = ['I', ...this.allowed];
    this.err.set(i, order[(order.indexOf(this.err.at(i)) + 1) % order.length]);
    this.changed(i);
  }

  chart(state, syn) {
    const code = this.code, K = 1 << this.k;
    const basis = logicalBasis(code);
    const cols = [], bands = [{ label: 'C', count: K, kind: 'C' }];
    const inC = !/1/.test(syn);
    for (let j = 0; j < K; j++) cols.push({ label: logicalKet(j, this.k), amp: inC ? state.overlap(basis[j]) : 0 });
    let R = null;
    if (!inC) {
      R = code.lightestWithSyndrome(syn) ?? this.err;
      bands.push({ label: `${R.toLabelled(code.labels)} · C`, count: K, kind: 'F' });
      for (let j = 0; j < K; j++) cols.push({ label: logicalKet(j, this.k), amp: state.overlap(basis[j].clone().applyPauliUpToPhase(R)) });
    }
    return { svg: barChart(cols, bands, { colW: this.k > 1 ? 54 : 62, title: `Amplitudes of the state in the logical basis of the codespace${R ? ` and of the error space ${R.toLabelled(code.labels)}·C` : ''}` }), R };
  }

  describe(c, R) {
    const code = this.code, L = code.labels;
    const name = this.err.toLabelled(L);
    const syn = Array.from(c.syndrome).join('');
    switch (c.kind) {
      case 'identity': return `No error. The state is in the codespace C and every generator returns +1.`;
      case 'stabilizer': return `${name} is a product of stabilizers: syndrome ${syn}, and the encoded state is unchanged.`;
      case 'logical': return `${name} commutes with every generator, so the syndrome is ${syn} and nothing is detected, but it acts on the encoded qubits as ${c.action.join(' ')}: an undetected logical error. Compare the bars in C with the input.`;
      default: {
        const rest = this.err.mul(R);
        const rc = code.classify(rest);
        const base = `${name} anticommutes with ${c.syndrome.reduce((a, b) => a + b, 0)} of the ${code.stabilizers.length} generators: syndrome ${syn}, detected. The state is in the error space ${R.toLabelled(L)}·C, the codespace moved by the lightest error with this syndrome; its bars are read in that moved basis.`;
        if (rc.kind === 'identity') return base + ' Here the error is that lightest error, so the bars repeat the input exactly.';
        if (rc.kind === 'stabilizer') return base + ` ${name} and ${R.toLabelled(L)} differ by the stabilizer ${rest.toLabelled(L)}, so the bars still repeat the input: undoing ${R.toLabelled(L)} would undo ${name} (degeneracy).`;
        return base + ` ${name} and ${R.toLabelled(L)} share the syndrome but differ by the logical ${rc.action.join(' ')}, and the bars show it: undoing ${R.toLabelled(L)} would leave ${rc.action.join(' ')}. The syndrome detects the error but cannot say which one it was.`;
      }
    }
  }

  decoderLine(c, state, psiL) {
    const code = this.code, L = code.labels;
    const syn = Array.from(c.syndrome).join('');
    const corr = code.lookupDecoder(['X', 'Z', 'Y']).get(syn);
    if (!corr) return h('p', { class: 'decoder fail' }, `Decoder: syndrome ${syn} is not produced by any single-qubit error, so the lookup table has no entry for it.`);
    const residual = this.err.mul(corr);
    const r = code.classify(residual);
    const ok = r.kind === 'identity' || r.kind === 'stabilizer';
    const F = state.clone().applyPauliUpToPhase(corr).fidelity(psiL);
    if (corr.isIdentity()) return h('p', { class: `decoder ${ok ? 'ok' : 'fail'}` }, `Decoder: syndrome ${syn} → no correction. `, ok ? 'Nothing to do.' : `Fidelity to the input ${fmt(F, 3)}: a ${r.action.join(' ')} error slipped through.`);
    return h('p', { class: `decoder ${ok ? 'ok' : 'fail'}` },
      `Decoder: syndrome ${syn} → apply ${corr.toLabelled(L)}. Net effect ${residual.toLabelled(L)}`,
      r.kind === 'stabilizer' ? ', a stabilizer' : '',
      `: fidelity to the input ${fmt(F, 3)}. `, ok ? 'Recovered.' : `A logical ${r.action.join(' ')} remains.`);
  }

  render(focusIndex) {
    const code = this.code, L = code.labels;
    const coeffs = productCoeffs(this.thetas);
    const psiL = encodeLogical(code, coeffs);
    const state = psiL.clone().applyPauliUpToPhase(this.err);
    const c = code.classify(this.err);
    const syn = Array.from(c.syndrome).join('');
    const { svg: chart, R } = this.chart(state, syn);
    const logicals = code.logicals.map((l, j) => {
      const sub = this.k > 1 ? subscript(j + 1) : '';
      return `X̄${sub} = ${l.X.toLabelled(L)}, Z̄${sub} = ${l.Z.toLabelled(L)}`;
    }).join('; ');
    const input = coeffs.map((v, j) => `${fmt(v)}${logicalKet(j, this.k)}`).join(' + ').replace(/\+ −/g, '− ');
    this.replaceChildren(
      header(this, code.name, `Click a qubit to cycle ${['no error', ...this.allowed].join(' → ')}.`),
      h('p', { class: 'w-meta' }, h('span', { class: 'mono' }, code.params()), ` · logical operators ${logicals}`),
      h('div', { class: 'w-row' }, qubitButtons(code, this.err, this.allowed, (i) => this.cycle(i), this.groups), meters(code, c.syndrome)),
      h('p', { class: 'w-note' }, `Input |ψ⟩ᴸ = ${input}.`),
      chart,
      h('p', { class: `status is-${c.kind}` }, this.describe(c, R)),
      flag(this, 'decoder') ? this.decoderLine(c, state, psiL) : null,
      h('div', { class: 'controls' },
        this.thetas.map((t, j) => slider(this.k > 1 ? `θ${subscript(j + 1)} =` : 'input θ =', { id: `${this.id}-theta-${j}`, min: 0, max: Math.PI.toFixed(4), step: 0.01, value: t,
          format: (v) => `${v.toFixed(2)} rad`, oninput: (v) => { this.thetas[j] = v; this.render(); } })),
        h('button', { type: 'button', onclick: () => { assignPauli(this.err, Pauli.identity(code.n)); this.changed(); } }, 'Clear errors'),
        code.logicals.flatMap((l, j) => ['X', 'Z'].map((op) => h('button', { type: 'button', onclick: () => { assignPauli(this.err, this.err.mul(l[op])); this.changed(); } },
          `Apply ${op}̄${this.k > 1 ? subscript(j + 1) : ''}`)))));
    if (focusIndex !== undefined) this.querySelector(`.qubit[data-i="${focusIndex}"]`)?.focus();
  }
}

/* -------------------------------------------------- <qec-projection> */

class QecProjection extends Base {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    setup(this);
    this.code = getCode(attr(this, 'code', 'four-two-two'));
    this.k = this.code.logicals.length;
    this.groups = attr(this, 'groups', '').split(',').filter(Boolean).map(Number);
    this.target = 0;
    this.stage = 0;
    this.build();
    this.render();
  }

  build() {
    const code = this.code, L = code.labels;
    const stages = [{ name: `Start from |${'0'.repeat(code.n)}⟩`, op: null }];
    code.stabilizers.forEach((g) => stages.push({ name: `Project with (𝟙 + ${g.toLabelled(L)})`, op: g, kind: 'stabilizer' }));
    // eq. 34 stops here; add logical Z̄ projections only if the logical value is not yet fixed
    const s = new State(code.n);
    for (const g of code.stabilizers) s.projectPlus(g);
    s.normalize();
    code.logicals.forEach((l, j) => {
      if (Math.abs(s.expect(l.Z) - 1) > 1e-9) stages.push({ name: `Project with (𝟙 + Z̄${this.k > 1 ? subscript(j + 1) : ''}) = (𝟙 + ${l.Z.toLabelled(L)})`, op: l.Z, kind: 'logical' });
    });
    this.baseStages = stages;
  }

  get stages() {
    const st = this.baseStages.slice();
    if (this.target) {
      const ops = [];
      for (let b = 0; b < this.k; b++) if ((this.target >> (this.k - 1 - b)) & 1) ops.push(b);
      st.push({ name: `Apply ${ops.map((b) => `X̄${this.k > 1 ? subscript(b + 1) : ''}`).join('')}`, ops, kind: 'flip' });
    }
    return st;
  }

  stateAt(i) {
    const code = this.code;
    const s = new State(code.n);
    let lastNorm = 1;
    const stages = this.stages;
    for (let t = 1; t <= i; t++) {
      const st = stages[t];
      if (st.op) { s.projectPlus(st.op); lastNorm = Math.sqrt(s.norm2()); s.normalize(); }
      else for (const b of st.ops) s.applyPauliUpToPhase(code.logicals[b].X);
    }
    return { s, lastNorm };
  }

  checks(s) {
    const code = this.code, L = code.labels;
    const items = [...code.stabilizers.map((g) => ({ name: g.toLabelled(L), P: g })),
      ...code.logicals.map((l, j) => ({ name: `Z̄${this.k > 1 ? subscript(j + 1) : ''}`, P: l.Z }))];
    return h('div', { class: 'checks', role: 'group', 'aria-label': 'expectation values' },
      items.map(({ name, P }) => {
        const v = s.expect(P);
        const cls = Math.abs(v - 1) < 1e-9 ? 'plus' : Math.abs(v + 1) < 1e-9 ? 'minus' : 'mixed';
        return h('span', { class: `check ${cls}` }, h('span', { class: 'mono' }, `⟨${name}⟩`), ` ${fmt(v)}`);
      }));
  }

  caption(i, s, lastNorm) {
    const code = this.code, st = this.stages[i], L = code.labels;
    if (i === 0) return `Every Z-type generator already returns +1 on |${'0'.repeat(code.n)}⟩; the X-type ones return 0, which means the state is an equal mix of their +1 and −1 eigenspaces.`;
    if (st.kind === 'flip') return `The projections produced |${'0'.repeat(this.k)}⟩ᴸ. Logical X̄ operators turn it into ${logicalKet(this.target, this.k)} (the paper's remark after eq. 35).`;
    const r = lastNorm;
    const already = Math.abs(r - 2) < 1e-9;
    const what = st.kind === 'logical'
      ? ` Eq. 34 stops before this step. For this code the generators alone leave the logical value open, so |${'0'.repeat(code.n)}⟩ projects to a superposition of codewords, and fixing Z̄ = +1 is needed to get |0⟩ᴸ.`
      : '';
    return (already
      ? `${st.op.toLabelled(L)} already returned +1, so (𝟙 + P) only doubles the state (norm ${fmt(r, 3)}) and normalising changes nothing.`
      : `The state had ⟨P⟩ = 0, so (𝟙 + P) keeps its +1 half and adds the image under P: the norm is ${fmt(r, 3)} = √2, and 1/N in eq. 34 restores it to one.`) + what;
  }

  render() {
    const code = this.code;
    const stages = this.stages;
    this.stage = Math.min(this.stage, stages.length - 1);
    const { s, lastNorm } = this.stateAt(this.stage);
    const cols = [];
    for (let i = 0; i < s.dim; i++) if (Math.abs(s.a[i]) > 1e-9) cols.push({ label: groupedKet(i, code.n, this.groups), amp: s.a[i] });
    const colW = code.n > 6 ? 84 : 56;
    const K = 1 << this.k;
    this.replaceChildren(
      header(this, `Preparing the codewords by projection (eq. 34)`, 'Step through the projections.'),
      h('p', { class: 'stage-caption' }, h('b', {}, `${stages[this.stage].name}. `), this.caption(this.stage, s, lastNorm)),
      this.checks(s),
      h('p', { class: 'w-note' }, `Non-zero terms of the state in the computational basis (${cols.length} of ${s.dim}):`),
      h('div', { class: 'scroll' }, barChart(cols, [], { colW, height: 112, title: `State after ${stages[this.stage].name}: ${s.toString(3)}` })),
      h('div', { class: 'controls stack' },
        h('div', { class: 'errpick', role: 'group', 'aria-label': 'target codeword' },
          h('span', { class: 'errpick-name' }, 'Target:'),
          Array.from({ length: K }, (_, j) => h('button', { type: 'button', class: `chip${this.target === j ? ' on' : ''}`, 'aria-pressed': this.target === j,
            onclick: () => { this.target = j; this.render(); } }, logicalKet(j, this.k)))),
        h('div', { class: 'stepper' },
          h('button', { type: 'button', disabled: this.stage === 0, onclick: () => { this.stage--; this.render(); } }, '← Back'),
          h('span', { class: 'stepper-pos' }, `Step ${this.stage + 1} of ${stages.length}`),
          h('button', { type: 'button', class: 'primary', disabled: this.stage === stages.length - 1, onclick: () => { this.stage++; this.render(); } }, this.stage + 1 < stages.length ? `Next: ${stages[this.stage + 1].name} →` : 'Done'),
          h('button', { type: 'button', onclick: () => { this.stage = 0; this.render(); } }, 'Restart'))));
  }
}

/* ---------------------------------------------------- CSS helpers */

/** X-type and Z-type check matrices of a code whose generators are each pure X or pure Z. */
function cssMatrices(code) {
  if (code.extra.HX) return { HX: code.extra.HX, HZ: code.extra.HZ };
  const HX = [], HZ = [];
  for (const g of code.stabilizers) {
    const hasX = g.x.some((b) => b), hasZ = g.z.some((b) => b);
    if (hasX && hasZ) throw new Error(`${code.name} is not a CSS code`);
    (hasX ? HX : HZ).push(Uint8Array.from(hasX ? g.x : g.z));
  }
  return { HX, HZ };
}

/** A small 0/1 matrix as a table; `hitCols` marks columns carrying an error, `lit` the rows with syndrome 1. */
function matrixTable(A, { kind, colLabels, rowLabels, hitCols = [], lit = [], syndrome = null, caption }) {
  const n = A.length ? A[0].length : colLabels.length;
  return h('div', { class: 'scroll' }, h('table', { class: `pcm pcm-${kind}` },
    caption ? h('caption', {}, caption) : null,
    h('thead', {}, h('tr', {}, h('th', {}, ''), colLabels.map((l, j) => h('th', { class: hitCols.includes(j) ? 'hit' : '' }, l)), syndrome ? h('th', { class: 'syn' }, 's') : null)),
    h('tbody', {}, A.map((row, i) => h('tr', { class: lit[i] ? 'lit' : '' },
      h('th', {}, rowLabels[i]),
      Array.from({ length: n }, (_, j) => h('td', { class: `${row[j] ? 'one' : ''}${row[j] && hitCols.includes(j) ? ' hit' : ''}` }, row[j] ? '1' : '·')),
      syndrome ? h('td', { class: 'syn mono' }, String(syndrome[i])) : null)))));
}

/* ------------------------------------------------------ <qec-checks> */

/**
 * A CSS code as two parity-check matrices. Click a qubit to cycle X, Z, Y;
 * X errors light rows of H_Z, Z errors light rows of H_X, and the decoder
 * treats the two halves as separate classical problems.
 */
class QecChecks extends Base {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    setup(this);
    this.options = attr(this, 'codes', attr(this, 'code', 'steane')).split(',');
    this.allowed = kinds(attr(this, 'allowed', 'XZY'));
    this.id ||= nextId('ck');
    this.setCode(this.options[0], attr(this, 'initial'));
  }

  setCode(name, initial) {
    this.name = name;
    this.code = getCode(name);
    ({ HX: this.HX, HZ: this.HZ } = cssMatrices(this.code));
    this.err = initial ? Pauli.fromString(initial, this.code.n) : Pauli.identity(this.code.n);
    this.render();
  }

  cycle(i) {
    const order = ['I', ...this.allowed];
    this.err.set(i, order[(order.indexOf(this.err.at(i)) + 1) % order.length]);
    this.render(i);
  }

  /** Match a syndrome to a single column of H; returns the column index or -1. */
  static column(H, s) {
    const n = H.length ? H[0].length : 0;
    for (let j = 0; j < n; j++) if (H.every((row, i) => row[j] === s[i])) return j;
    return -1;
  }

  decoderLines(sX, sZ) {
    const code = this.code, L = code.labels;
    const zero = (s) => s.every((b) => b === 0);
    const corr = Pauli.identity(code.n);
    const lines = [];
    const half = (s, H, kind, checks) => {
      const bits = Array.from(s).join('');
      if (zero(s)) { lines.push(`${kind} errors: ${checks} syndrome ${bits || '—'}, nothing to do.`); return; }
      const n = H[0].length;
      const matches = [];
      for (let q = 0; q < n; q++) if (H.every((row, i) => row[q] === s[i])) matches.push(q);
      if (!matches.length) { lines.push(`${kind} errors: ${checks} syndrome ${bits} is not a column of the matrix, so no single ${kind} explains it; the decoder leaves it.`); return; }
      const j = matches[0];
      corr.multiplyAt(j, kind);
      if (matches.length > 1) { lines.push(`${kind} errors: ${checks} syndrome ${bits} equals columns ${matches.map((q) => q + 1).join(', ')}: a single ${kind} on any of them fits, and nothing says which. Guessing ${kind}${subscript(j + 1)}.`); return; }
      const binary = this.name === 'steane' ? ` Read as a binary number, ${bits} = ${j + 1}: the Hamming code names the qubit.` : '';
      lines.push(`${kind} errors: ${checks} syndrome ${bits} equals column ${j + 1} of the matrix, so apply ${kind}${subscript(j + 1)}.${binary}`);
    };
    half(sZ, this.HZ, 'X', 'H_Z');
    half(sX, this.HX, 'Z', 'H_X');
    const r = code.classify(this.err.mul(corr));
    const ok = r.kind === 'identity' || r.kind === 'stabilizer';
    return h('div', { class: `decoder ${ok ? 'ok' : 'fail'}` },
      lines.map((l) => h('p', { class: 'dec-line' }, l)),
      h('p', { class: 'dec-line' }, h('b', {}, corr.isIdentity() && this.err.isIdentity() ? 'Nothing to correct.' : ok
        ? `Net effect ${this.err.mul(corr).toLabelled(L)}${r.kind === 'stabilizer' ? ', a stabilizer' : ''}: recovered.`
        : `Net effect ${this.err.mul(corr).toLabelled(L)}: a logical ${r.action.join(' ')}. The decoder failed.`)));
  }

  render(focusIndex) {
    const code = this.code, n = code.n, L = code.labels;
    const eX = Uint8Array.from(this.err.x), eZ = Uint8Array.from(this.err.z);
    const sX = gf2.mulVec(this.HX, eZ), sZ = gf2.mulVec(this.HZ, eX);
    const colLabels = Array.from({ length: n }, (_, j) => String(j + 1));
    const c = code.classify(this.err);
    const hitsZ = [], hitsX = [];
    for (let j = 0; j < n; j++) { if (eZ[j]) hitsZ.push(j); if (eX[j]) hitsX.push(j); }
    const logicals = code.logicals.map((l, j) => { const sub = code.logicals.length > 1 ? subscript(j + 1) : ''; return `X̄${sub} = ${l.X.toLabelled(L)}, Z̄${sub} = ${l.Z.toLabelled(L)}`; }).join('; ');
    this.replaceChildren(
      header(this, 'Parity checks of a CSS code', `Click a qubit to cycle ${['no error', ...this.allowed].join(' → ')}.`),
      this.options.length > 1 ? h('label', { class: 'pick', for: `${this.id}-code` }, 'Code: ',
        h('select', { id: `${this.id}-code`, onchange: (e) => this.setCode(e.target.value) },
          this.options.map((o) => h('option', { value: o, selected: o === this.name }, getCode(o).name)))) : null,
      h('p', { class: 'w-meta' }, h('span', { class: 'mono' }, code.params()), ` · ${this.HX.length} X-type and ${this.HZ.length} Z-type checks · ${logicals}`),
      qubitButtons(code, this.err, this.allowed, (i) => this.cycle(i)),
      h('div', { class: 'pcm-pair' },
        matrixTable(this.HX, { kind: 'x', colLabels, rowLabels: this.HX.map((_, i) => `X${subscript(i + 1)}`), hitCols: hitsZ, lit: sX, syndrome: sX,
          caption: 'H_X: X-type checks, lit by Z errors' }),
        matrixTable(this.HZ, { kind: 'z', colLabels, rowLabels: this.HZ.map((_, i) => `Z${subscript(i + 1)}`), hitCols: hitsX, lit: sZ, syndrome: sZ,
          caption: 'H_Z: Z-type checks, lit by X errors' })),
      h('p', { class: `status is-${c.kind}` }, c.kind === 'identity' ? 'No error.'
        : c.kind === 'detectable' ? `${this.err.toLabelled(L)}: the X part (${hitsX.map((j) => j + 1).join(', ') || 'none'}) gives s_Z = H_Z e_X = ${Array.from(sZ).join('')}, the Z part (${hitsZ.map((j) => j + 1).join(', ') || 'none'}) gives s_X = H_X e_Z = ${Array.from(sX).join('')}.`
          : c.kind === 'stabilizer' ? `${this.err.toLabelled(L)} is a stabilizer: every check is satisfied and nothing has happened.`
            : `${this.err.toLabelled(L)} satisfies every check but acts as ${c.action.join(' ')}: an undetected logical error.`),
      flag(this, 'decoder') ? this.decoderLines(sX, sZ) : null,
      h('div', { class: 'controls' },
        h('button', { type: 'button', onclick: () => { this.err = Pauli.identity(n); this.render(); } }, 'Clear errors'),
        code.logicals.flatMap((l, j) => ['X', 'Z'].map((op) => h('button', { type: 'button', onclick: () => { this.err = this.err.mul(l[op]); this.render(); } },
          `Apply ${op}̄${code.logicals.length > 1 ? subscript(j + 1) : ''}`)))));
    if (focusIndex !== undefined) this.querySelector(`.qubit[data-i="${focusIndex}"]`)?.focus();
  }
}

/* ------------------------------------------------- <qec-css-builder> */

class QecCssBuilder extends Base {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    setup(this);
    this.keys = attr(this, 'codes', 'hamming7,simplex7,even7,rep7').split(',');
    this.kx = attr(this, 'x', this.keys[0]);
    this.kz = attr(this, 'z', this.keys[0]);
    this.id ||= nextId('cb');
    this.render();
  }

  pick(which, label) {
    const id = `${this.id}-${which}`;
    return h('label', { class: 'pick', for: id }, label,
      h('select', { id, onchange: (e) => { this[which] = e.target.value; this.render(); } },
        this.keys.map((k) => h('option', { value: k, selected: k === this[which] }, classical(k).name))));
  }

  render() {
    const cx = classical(this.kx), cz = classical(this.kz);
    const HX = cx.H, HZ = cz.H, n = cx.n;
    const P = gf2.mul(HX, gf2.transpose(HZ, n));
    const ok = gf2.isZero(P);
    const colLabels = Array.from({ length: n }, (_, j) => String(j + 1));
    const bad = [];
    P.forEach((row, i) => row.forEach((b, j) => { if (b) bad.push([i, j]); }));
    let verdict;
    if (ok) {
      const rx = gf2.rank(HX, n), rz = gf2.rank(HZ, n);
      const k = n - rx - rz;
      if (k === 0) {
        verdict = h('p', { class: 'status is-stabilizer' }, `Valid: H_X·H_Zᵀ = 0, so every X-type check commutes with every Z-type check. But k = n − rank H_X − rank H_Z = ${n} − ${rx} − ${rz} = 0: the checks fix the state completely and there is no room for a logical qubit.`);
      } else {
        const dX = gf2.minWeightOutside(HZ, HX, n), dZ = gf2.minWeightOutside(HX, HZ, n);
        verdict = h('p', { class: 'status is-identity' },
          `Valid: H_X·H_Zᵀ = 0. The CSS code is [[${n}, ${k}, ${Math.min(dX, dZ)}]]: k = ${n} − ${rx} − ${rz} = ${k}; the lightest X̄ (in ker H_Z, not a product of X checks) has weight d_X = ${dX}, the lightest Z̄ (in ker H_X, not a product of Z checks) has weight d_Z = ${dZ}.`,
          this.kx === 'hamming7' && this.kz === 'hamming7' ? ' This is the Steane code.' : '');
      }
    } else {
      const [i, j] = bad[0];
      const overlap = []; for (let q = 0; q < n; q++) if (HX[i][q] && HZ[j][q]) overlap.push(q + 1);
      verdict = h('p', { class: 'status is-logical' }, `Not a code: ${bad.length} of the ${P.length * (P[0]?.length ?? 0)} entries of H_X·H_Zᵀ are 1. For example X-check ${i + 1} and Z-check ${j + 1} overlap on qubit${overlap.length > 1 ? 's' : ''} ${overlap.join(', ')}, an odd number, so they anticommute and cannot both be measured.`);
    }
    this.replaceChildren(
      header(this, 'Build a CSS code from two classical codes', 'Choose the classical code for each check type.'),
      h('div', { class: 'controls' }, this.pick('kx', 'X-type checks H_X from '), this.pick('kz', 'Z-type checks H_Z from ')),
      h('div', { class: 'pcm-pair' },
        matrixTable(HX, { kind: 'x', colLabels, rowLabels: HX.map((_, i) => `X${subscript(i + 1)}`), caption: `H_X, ${HX.length} × ${n}` }),
        matrixTable(HZ, { kind: 'z', colLabels, rowLabels: HZ.map((_, i) => `Z${subscript(i + 1)}`), caption: `H_Z, ${HZ.length} × ${n}` }),
        h('div', { class: 'scroll' }, h('table', { class: 'pcm pcm-prod' },
          h('caption', {}, 'H_X·H_Zᵀ (must be all zero)'),
          h('thead', {}, h('tr', {}, h('th', {}, ''), HZ.map((_, j) => h('th', {}, `Z${subscript(j + 1)}`)))),
          h('tbody', {}, P.map((row, i) => h('tr', {}, h('th', {}, `X${subscript(i + 1)}`), Array.from(row).map((b) => h('td', { class: b ? 'bad' : '' }, b ? '1' : '0')))))))),
      verdict);
  }
}

/* ----------------------------------------------------------- <qec-hgp> */

class QecHgp extends Base {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    setup(this);
    this.keys = attr(this, 'codes', 'rep3,rep4,rep5,ring3,ring4,hamming7').split(',');
    this.k1 = attr(this, 'a', 'rep3');
    this.k2 = attr(this, 'b', 'rep3');
    this.allowed = kinds(attr(this, 'allowed', 'XZY'));
    this.p = Number(attr(this, 'p', '0.05'));
    this.hover = null;
    this.id ||= nextId('hg');
    this.setCodes(attr(this, 'initial'));
  }

  setCodes(initial) {
    this.code = getCode(`hgp:${this.k1},${this.k2}`);
    this.err = initial ? Pauli.fromString(initial, this.code.n) : Pauli.identity(this.code.n);
    this.bp = null;
    this.render();
  }

  cycle(i) {
    const order = ['I', ...this.allowed];
    this.err.set(i, order[(order.indexOf(this.err.at(i)) + 1) % order.length]);
    this.bp = null;
    this.render();
  }

  sample() {
    const n = this.code.n;
    this.err = Pauli.identity(n);
    for (let q = 0; q < n; q++) {
      if (this.allowed.includes('X') && Math.random() < this.p) this.err.multiplyAt(q, 'X');
      if (this.allowed.includes('Z') && Math.random() < this.p) this.err.multiplyAt(q, 'Z');
    }
    this.bp = null;
    this.render();
  }

  runBP() {
    const { HX, HZ } = this.code.extra;
    const eX = Uint8Array.from(this.err.x), eZ = Uint8Array.from(this.err.z);
    const x = minSumBP(HZ, gf2.mulVec(HZ, eX), this.p);
    const z = minSumBP(HX, gf2.mulVec(HX, eZ), this.p);
    this.bp = { x, z, t: Math.max(x.iterations, z.iterations) };
    this.render();
  }

  /** Grid geometry: node at (row r, col c) from the two classical codes' layouts. */
  geometry() {
    const { c1, c2 } = this.code.extra.hgp;
    const pos = (order) => { const m = new Map(); order.forEach((id, i) => m.set(id, i)); return m; };
    return { c1, c2, r: pos(c1.order), c: pos(c2.order), rows: c1.order.length, cols: c2.order.length };
  }

  lattice() {
    const code = this.code;
    const { HX, HZ } = code.extra;
    const g = this.geometry();
    const { c1, c2 } = g;
    const n1 = c1.n, n2 = c2.n, m2 = c2.m;
    const size = Math.max(g.rows, g.cols);
    const s = Math.max(26, Math.min(44, Math.floor(520 / size)));
    const pad = 14;
    const W = pad * 2 + g.cols * s, H = pad * 2 + g.rows * s;
    const X = (col) => pad + (col + 0.5) * s, Y = (row) => pad + (row + 0.5) * s;
    const eX = Uint8Array.from(this.err.x), eZ = Uint8Array.from(this.err.z);
    const sX = gf2.mulVec(HX, eZ), sZ = gf2.mulVec(HZ, eX);
    // node positions
    const qpos = [];
    for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) qpos.push([g.r.get('b' + i), g.c.get('b' + j)]);
    for (let a = 0; a < c1.m; a++) for (let b = 0; b < m2; b++) qpos.push([g.r.get('c' + a), g.c.get('c' + b)]);
    const xpos = [], zpos = [];
    for (let a = 0; a < c1.m; a++) for (let j = 0; j < n2; j++) xpos.push([g.r.get('c' + a), g.c.get('b' + j)]);
    for (let i = 0; i < n1; i++) for (let b = 0; b < m2; b++) zpos.push([g.r.get('b' + i), g.c.get('c' + b)]);
    const els = [];
    const edges = (Hm, idx, pos) => { const [r, c] = pos[idx]; Hm[idx].forEach((b, q) => { if (b) els.push(svg('line', { x1: X(c), y1: Y(r), x2: X(qpos[q][1]), y2: Y(qpos[q][0]), class: 'hg-edge' })); }); };
    sX.forEach((b, i) => { if (b) edges(HX, i, xpos); });
    sZ.forEach((b, i) => { if (b) edges(HZ, i, zpos); });
    const hoverLayer = svg('g', { class: 'hg-hover' });
    const showEdges = (Hm, idx, pos) => {
      const [r, c] = pos[idx];
      hoverLayer.replaceChildren(...Array.from(Hm[idx]).flatMap((b, q) => (b ? [svg('line', { x1: X(c), y1: Y(r), x2: X(qpos[q][1]), y2: Y(qpos[q][0]), class: 'hg-edge hg-edge-hover' })] : [])));
    };
    els.push(hoverLayer);
    const check = (type, i, [r, c], lit, Hm) => {
      const deg = Hm[i].reduce((a, b) => a + b, 0);
      return svg('g', { class: `hg-check hg-${type}${lit ? ' lit' : ''}`,
        onpointerenter: () => showEdges(Hm, i, type === 'X' ? xpos : zpos), onpointerleave: () => hoverLayer.replaceChildren() },
        svg('title', {}, `${type}-type check ${i + 1}, weight ${deg}: ${lit ? 'violated (−1)' : 'satisfied (+1)'}`),
        svg('rect', { x: X(c) - s * 0.36, y: Y(r) - s * 0.36, width: s * 0.72, height: s * 0.72, rx: 3 }));
    };
    xpos.forEach((pos, i) => els.push(check('X', i, pos, sX[i], HX)));
    zpos.forEach((pos, i) => els.push(check('Z', i, pos, sZ[i], HZ)));
    const t = this.bp ? Math.min(this.bpT ?? this.bp.t, this.bp.t) : 0;
    qpos.forEach(([r, c], q) => {
      const op = this.err.at(q);
      const gq = svg('g', { class: `hg-qubit op-${op}`, role: 'button', tabindex: 0, 'data-q': q,
        'aria-label': `qubit ${q + 1}: ${op === 'I' ? 'no error' : op + ' error'}`,
        onclick: () => this.cycle(q), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.cycle(q); } } },
        svg('title', {}, `qubit ${q + 1}${op === 'I' ? '' : ': ' + op}`));
      if (this.bp) {
        const at = (run) => run.history[Math.min(t, run.history.length) - 1];
        const px = flipProbability(at(this.bp.x).L[q]), pz = flipProbability(at(this.bp.z).L[q]);
        if (px > 0.02) gq.append(svg('circle', { cx: X(c), cy: Y(r), r: s * 0.44, class: 'hg-belief-x', 'stroke-opacity': Math.min(1, px).toFixed(2) }));
        if (pz > 0.02) gq.append(svg('circle', { cx: X(c), cy: Y(r), r: s * 0.44 + 3.5, class: 'hg-belief-z', 'stroke-opacity': Math.min(1, pz).toFixed(2) }));
      }
      gq.append(svg('circle', { cx: X(c), cy: Y(r), r: s * 0.26 }));
      if (op !== 'I') gq.append(svg('text', { x: X(c), y: Y(r) + 4, 'text-anchor': 'middle', class: 'hg-op' }, op));
      els.push(gq);
    });
    return { svg: svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'hg-lattice', style: { maxWidth: `${W}px` }, role: 'group',
      'aria-label': `Hypergraph product lattice: ${code.n} qubits (circles), ${HX.length} X-type checks and ${HZ.length} Z-type checks (squares)` }, els), sX, sZ };
  }

  bpPanel() {
    if (!this.bp) return null;
    const code = this.code;
    const t = Math.min(this.bpT ?? this.bp.t, this.bp.t);
    const corr = Pauli.identity(code.n);
    const fx = this.bp.x.history[this.bp.x.history.length - 1].e, fz = this.bp.z.history[this.bp.z.history.length - 1].e;
    fx.forEach((b, q) => { if (b) corr.multiplyAt(q, 'X'); });
    fz.forEach((b, q) => { if (b) corr.multiplyAt(q, 'Z'); });
    const r = code.classify(this.err.mul(corr));
    const conv = this.bp.x.converged && this.bp.z.converged;
    const half = (run, kind, H) => run.converged
      ? `${kind} errors (checks ${H}): converged after ${run.iterations} iteration${run.iterations > 1 ? 's' : ''}.`
      : `${kind} errors (checks ${H}): no hard decision reproduced the syndrome within ${run.iterations} iterations.`;
    const verdict = !conv ? 'BP failed to find an error that explains the syndrome. On quantum codes this usually means several equally good explanations, degenerate up to stabilizers, are pulling the beliefs in different directions.'
      : (r.kind === 'identity' || r.kind === 'stabilizer') ? `Correction ${corr.toLabelled(code.labels)}; net effect ${r.kind === 'identity' ? 'none' : 'a stabilizer'}: recovered.`
        : `Correction ${corr.toLabelled(code.labels)} matches the syndrome, but the net effect is a logical ${r.action.join(' ')}: decoding failed.`;
    return h('div', { class: `decoder ${conv && r.kind !== 'logical' ? 'ok' : 'fail'}` },
      h('p', { class: 'dec-line' }, half(this.bp.x, 'X', 'H_Z')),
      h('p', { class: 'dec-line' }, half(this.bp.z, 'Z', 'H_X')),
      h('p', { class: 'dec-line' }, h('b', {}, verdict)),
      slider('show beliefs after iteration', { id: `${this.id}-iter`, min: 1, max: this.bp.t, step: 1, value: t, format: (v) => `${v} of ${this.bp.t}`,
        oninput: (v) => { this.bpT = v; this.render(); } }));
  }

  render() {
    const code = this.code;
    const { HX, HZ, hgp: { c1, c2 } } = code.extra;
    const { svg: lat, sX, sZ } = this.lattice();
    const rowW = (Hm) => Math.max(...Hm.map((r) => r.reduce((a, b) => a + b, 0)));
    const colW = Array.from({ length: code.n }, (_, q) => HX.reduce((a, r) => a + r[q], 0) + HZ.reduce((a, r) => a + r[q], 0));
    const fmtD = (d) => (Number.isFinite(d) ? d : '∞');
    const lit = sX.reduce((a, b) => a + b, 0) + sZ.reduce((a, b) => a + b, 0);
    this.replaceChildren(
      header(this, 'Hypergraph product of two classical codes', 'Choose the two codes; click a qubit to cycle X → Z → Y; hover a check to see its qubits.'),
      h('div', { class: 'controls' }, ['k1', 'k2'].map((w, idx) => h('label', { class: 'pick', for: `${this.id}-${w}` }, idx ? 'code 2: ' : 'code 1: ',
        h('select', { id: `${this.id}-${w}`, onchange: (e) => { this[w] = e.target.value; this.setCodes(); } },
          this.keys.map((k) => h('option', { value: k, selected: k === this[w] }, classical(k).name)))))),
      h('div', { class: 'scroll' }, h('table', { class: 'w-table hg-params' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'n'), h('th', {}, 'k'), h('th', {}, 'd'), h('th', {}, 'm (checks)'), h('th', {}, 'kᵀ'), h('th', {}, 'dᵀ'))),
        h('tbody', {},
          [c1, c2].map((c, i) => h('tr', {}, h('td', {}, `code ${i + 1}: ${c.short}`), h('td', { class: 'mono' }, c.n), h('td', { class: 'mono' }, c.k), h('td', { class: 'mono' }, fmtD(c.d)), h('td', { class: 'mono' }, c.m), h('td', { class: 'mono' }, c.kT), h('td', { class: 'mono' }, fmtD(c.dT)))),
          h('tr', { class: 'lit' }, h('td', {}, 'product'), h('td', { class: 'mono' }, `${c1.n}·${c2.n} + ${c1.m}·${c2.m} = ${code.n}`), h('td', { class: 'mono' }, `${c1.k}·${c2.k} + ${c1.kT}·${c2.kT} = ${code.k}`),
            h('td', { class: 'mono' }, code.knownDistance ?? '—'), h('td', { class: 'mono' }, `${HX.length} X + ${HZ.length} Z`), h('td', {}, ''), h('td', {}, ''))))),
      h('p', { class: 'w-meta' }, `Largest check weight ${Math.max(rowW(HX), rowW(HZ))}, largest number of checks on one qubit ${Math.max(...colW)}.`),
      lat,
      h('p', { class: 'w-note' }, 'Circles are qubits; orange squares are X-type checks (they detect Z errors), blue squares Z-type checks (they detect X errors). A square turns solid when its check is violated, and lines join it to its qubits.',
        this.bp ? ' Rings show BP\'s belief that a qubit carries an X error (inner, orange) or a Z error (outer, blue).' : ''),
      h('p', { class: `status ${lit ? 'is-detectable' : ''}` }, this.err.isIdentity() ? 'No error.' : `${this.err.toLabelled(code.labels)}: ${lit} check${lit === 1 ? '' : 's'} violated. ${code.classify(this.err).kind === 'logical' ? 'No check is violated, yet the error acts as ' + code.classify(this.err).action.join(' ') + '.' : ''}`),
      this.bpPanel(),
      h('div', { class: 'controls' },
        slider('p =', { id: `${this.id}-p`, min: 0.01, max: 0.2, step: 0.01, value: this.p, live: true, format: (v) => v.toFixed(2), oninput: (v) => { this.p = v; } }),
        h('button', { type: 'button', onclick: () => this.sample() }, 'Sample errors at p'),
        h('button', { type: 'button', class: 'primary', onclick: () => { this.bpT = undefined; this.runBP(); } }, 'Decode with BP'),
        h('button', { type: 'button', onclick: () => { this.err = Pauli.identity(code.n); this.bp = null; this.render(); } }, 'Clear errors')));
  }
}

/* ------------------------------------------------------- <qec-tabs> */

/**
 * <qec-tabs><section data-tab="Two-qubit code">…</section>…</qec-tabs>
 * One tab per child section; inactive panels are hidden, not removed, so the
 * widgets inside keep their state when you switch back.
 */
class QecTabs extends Base {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    this.classList.add('qec-tabs');
    const panels = [...this.children].filter((c) => c.dataset.tab);
    const base = this.id || nextId('tabs');
    const buttons = panels.map((panel, i) => {
      panel.id ||= `${base}-panel-${i}`;
      panel.setAttribute('role', 'tabpanel');
      const b = h('button', { type: 'button', role: 'tab', id: `${base}-tab-${i}`, 'aria-controls': panel.id,
        onclick: () => this.select(i),
        onkeydown: (e) => {
          const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          if (d) { e.preventDefault(); const j = (i + d + panels.length) % panels.length; this.select(j); this.buttons[j].focus(); }
        } }, panel.dataset.tab);
      panel.setAttribute('aria-labelledby', b.id);
      return b;
    });
    this.panels = panels;
    this.buttons = buttons;
    this.prepend(h('div', { class: 'tablist', role: 'tablist', 'aria-label': attr(this, 'aria-label', 'figures') }, buttons));
    this.select(0);
  }

  select(i) {
    this.panels.forEach((p, k) => { p.hidden = k !== i; });
    this.buttons.forEach((b, k) => { b.setAttribute('aria-selected', String(k === i)); b.tabIndex = k === i ? 0 : -1; });
  }
}

/* ---------------------------------------------------------- register */

export const components = {
  'qec-tabs': QecTabs,
  'qec-figure': QecFigure,
  'qec-state-view': QecStateView,
  'qec-code-view': QecCodeView,
  'qec-projection': QecProjection,
  'qec-checks': QecChecks,
  'qec-css-builder': QecCssBuilder,
  'qec-hgp': QecHgp,
  'qec-circuit': QecCircuit,
  'qec-suppression': QecSuppression,
  'qec-syndrome-table': QecSyndromeTable,
};

if (typeof customElements !== 'undefined') {
  for (const [name, cls] of Object.entries(components)) {
    if (!customElements.get(name)) customElements.define(name, cls);
  }
}
