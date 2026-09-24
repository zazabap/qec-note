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
import { getCode } from './codes.js';
import { State, encode, codewords, subspaces } from './state.js';

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
const kinds = (str) => (str.toUpperCase().match(/[XZ]/g) ?? []).filter((k, i, a) => a.indexOf(k) === i);
const ket = (bits) => `|${bits}⟩`;
const sign = (v) => (v < 0 ? '−' : '');
const fmt = (v, d = 2) => (Math.abs(v) < 5e-4 ? '0' : sign(v) + Math.abs(v).toFixed(d));
const pct = (v) => `${(100 * v).toFixed(1)}%`;

/** Default input: α = 0.8, β = 0.6, so the two amplitudes are easy to tell apart. */
const DEFAULT_THETA = 2 * Math.atan2(0.6, 0.8);

const WIDGET_TAGS = 'qec-state-view, qec-circuit, qec-suppression, qec-syndrome-table';

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

function slider(labelText, { min, max, step, value, format, oninput, id }) {
  const out = h('output', { for: id }, format(value));
  const input = h('input', { type: 'range', id, min, max, step, value, oninput: (e) => { const v = Number(e.target.value); out.textContent = format(v); oninput(v); } });
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

function qubitButtons(code, err, allowed, onCycle) {
  const buttons = [];
  for (let i = 0; i < code.n; i++) {
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
    const state = encoded.clone().applyPauli(this.err);
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
    this.theta = Number(attr(this, 'theta', DEFAULT_THETA));
    this.fig = sharedError(this, this.n);
    this.err = this.fig ? this.fig.err
      : attr(this, 'error') ? Pauli.fromString(attr(this, 'error'), this.n) : Pauli.single(this.n, 0, 'X');
    if (this.fig) this.fig.addEventListener('qec-error', () => { this.mode = 'pauli'; this.outcome = null; this.render(); });
    this.mode = 'pauli';               // or 'coherent'
    this.p = 0.1;
    this.outcome = null;               // measured syndrome, once sampled
    this.layout = subspaces(this.code);
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

  /** Recompute the joint state up to and including stage `upto`. */
  compute(upto) {
    const psi = State.fromAngle(this.theta);
    let s = State.product(psi, new State(this.n - 1 + this.m));
    let correction = null;
    for (let i = 1; i <= upto; i++) {
      const st = this.stages[i];
      switch (st.id) {
        case 'encode':
          for (const g of this.code.extra.encoder) s.cnot(g.control, g.target);
          break;
        case 'error':
          if (this.mode === 'pauli') s.applyPauli(this.err);
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
          correction = this.code.lookupDecoder(['X']).get(this.outcome) ?? Pauli.identity(this.n);
          s.applyPauli(correction);
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
    const colW = 52, left = 54, rowH = 40, top = 30;
    // columns: encoder gates, error, H, ctrl×m, H, measure, [recover]
    const cols = [];
    enc.forEach((g, i) => cols.push({ kind: 'cnot', gate: g, stage: 'encode', label: i === 0 ? 'Encoder' : null }));
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
      const label = q < n ? (q === 0 ? '|ψ⟩₁' : `|0⟩${subscript(q + 1)}`) : `|0⟩${m > 1 ? 'A' + subscript(q - n + 1) : 'A'}`;
      els.push(svg('text', { x: left - 8, y: wy(q) + 4, 'text-anchor': 'end', class: 'wire-label' }, label));
    }

    cols.forEach((c, i) => {
      const x = cx(i);
      switch (c.kind) {
        case 'cnot': {
          const yc = wy(c.gate.control), yt = wy(c.gate.target);
          els.push(svg('line', { x1: x, x2: x, y1: yc, y2: yt, class: 'vline' }));
          els.push(svg('circle', { cx: x, cy: yc, r: 4, class: 'ctrl' }));
          els.push(svg('circle', { cx: x, cy: yt, r: 7, class: 'target' }));
          els.push(svg('path', { d: `M${x - 7},${yt} H${x + 7} M${x},${yt - 7} V${yt + 7}`, class: 'target-cross' }));
          break;
        }
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
          els.push(svg('text', { x, y: (y1 + y2) / 2 + 4, 'text-anchor': 'middle', class: 'gate-label' }, gen.toLabelled(this.code.labels)));
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

    return svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'circuit', style: { maxWidth: `${W * 1.15}px` }, role: 'img',
      'aria-label': `Circuit of the ${this.code.name}: encoder, error stage, and syndrome extraction with ${m} ancilla${m > 1 ? 's' : ''}. Current stage: ${stage.name}.` }, els);
  }

  caption(state, correction) {
    const st = this.stages[this.stage];
    const m = this.m, n = this.n;
    const anc = m > 1 ? 'ancillas' : 'ancilla';
    const errName = this.mode === 'pauli' ? this.err.toLabelled(this.code.labels) : `√(1−p)·𝟙 + √p·X on every qubit, p = ${this.p.toFixed(2)}`;
    switch (st.id) {
      case 'init':
        return `The data qubit holds |ψ⟩ = ${fmt(Math.cos(this.theta / 2))}|0⟩ + ${fmt(Math.sin(this.theta / 2))}|1⟩. The ${n - 1} redundancy qubit${n > 2 ? 's' : ''} and the ${m} ${anc} start in |0⟩.`;
      case 'encode':
        return `CNOTs from qubit 1 spread the amplitudes onto |${'0'.repeat(n)}⟩ and |${'1'.repeat(n)}⟩ (eq. 12). Nothing is copied: the two amplitudes are still α and β, now shared by ${n} qubits. The state lies in the codespace C.`;
      case 'error':
        return this.mode === 'pauli'
          ? (this.err.isIdentity() ? 'No error this time. The state is still in C.' : `${errName} rotates the state out of C into an error space. The bars move; their heights do not.`)
          : `The coherent error ${errName} (eq. 20) puts the state in a superposition over C and the error spaces, with weight (1−p)^${n} on "nothing happened" and smaller weights on each flip pattern (eq. 21).`;
      case 'h1':
        return `Hadamards put the ${anc} in |+⟩. Both branches of the ${anc} now hold a copy of the data state; nothing has been learned yet.`;
      case 'ctrl':
        return `Controlled on the ${anc === 'ancilla' ? 'ancilla' : 'ancilla A' + subscript(st.k + 1)}, the stabilizer ${this.code.stabilizers[st.k].toLabelled(this.code.labels)} is applied to the data. On the |1⟩ branch of that ancilla the data picks up the stabilizer's eigenvalue: +1 in C, −1 in the error spaces it detects. Watch the sign of the bars in that row.`;
      case 'h2':
        return `The second Hadamards turn that phase into a population: the ${anc} end${m > 1 ? '' : 's'} in |0⟩ where the eigenvalue was +1 and in |1⟩ where it was −1 (eq. 19). The data state is the same in every surviving row: the measurement is about to reveal the subspace, not α and β.`;
      case 'measure': {
        const br = this.compute(this.stage - 1).state.branches(this.ancillas);
        const chosen = br.find((b) => b.bits === this.outcome);
        return `Measured syndrome S = ${this.outcome} (probability ${fmt(chosen.prob, 3)}). The other rows are gone: the state collapsed onto the data state paired with that outcome. Press "Measure again" to resample from the same pre-measurement state.`;
      }
      case 'recover': {
        const psiL = encode(this.code, State.fromAngle(this.theta));
        const data = state.branches(this.ancillas).find((b) => b.prob > 1e-9).state;
        const F = data.fidelity(psiL);
        const XL = psiL.clone().applyPauli(this.code.logicals[0].X);
        const FX = data.fidelity(XL);
        const applied = correction && !correction.isIdentity() ? `The lookup table maps S = ${this.outcome} to ${correction.toLabelled(this.code.labels)}, which is applied. ` : `Syndrome ${this.outcome} asks for no correction. `;
        if (F > 0.9995) return `${applied}Fidelity to the encoded input |ψ⟩ᴸ: ${fmt(F, 3)}. Recovered.`;
        if (FX > 0.9995) return `${applied}Fidelity to |ψ⟩ᴸ: ${fmt(F, 3)}; to X̄|ψ⟩ᴸ: ${fmt(FX, 3)}. The correction completed a logical bit flip: the decoder was fooled.`;
        return `${applied}Fidelity to |ψ⟩ᴸ: ${fmt(F, 3)}; to X̄|ψ⟩ᴸ: ${fmt(FX, 3)}. The residual is a superposition of "nothing happened" and a logical X̄; the operator weight of X̄ is what eq. 24 calls p_L.`;
      }
    }
    return '';
  }

  branchRows(state) {
    const measureIdx = this.stages.findIndex((s) => s.id === 'measure');
    const measured = this.stage >= measureIdx;
    const br = state.branches(this.ancillas);
    const anyBranching = br.filter((b) => b.prob > 1e-9).length > 1;
    return h('div', { class: 'branches' },
      h('p', { class: 'branches-head' }, measured
        ? `Data register after measuring the ${this.m > 1 ? 'ancillas' : 'ancilla'}`
        : anyBranching ? `Data register, one row per ${this.m > 1 ? 'ancilla bit string' : 'ancilla value'} (rows are not yet measured; probabilities are what a measurement would give)` : 'Data register'),
      br.map((b) => {
        const dead = b.prob < 1e-9;
        const chosen = measured && b.bits === this.outcome;
        return h('div', { class: `branch${dead ? ' dead' : ''}${chosen ? ' chosen' : ''}` },
          h('div', { class: 'branch-head' },
            h('span', { class: 'mono' }, `${ket(b.bits)}${this.m > 1 ? 'A' : 'A'}`),
            h('span', { class: 'branch-prob' }, dead ? (measured ? 'not observed' : 'p = 0') : (measured ? `observed` : `p = ${fmt(b.prob, 3)}`))),
          dead ? h('div', { class: 'branch-empty' }, '—') : ampChart(b.state, this.layout, { compact: true, colW: this.n > 2 ? 40 : 46, height: 96 }));
      }));
  }

  controls() {
    const measureIdx = this.stages.findIndex((s) => s.id === 'measure');
    const errButtons = h('div', { class: 'errpick', role: 'group', 'aria-label': 'choose the error E' },
      h('span', { class: 'errpick-name' }, 'Error E:'),
      Array.from({ length: this.n }, (_, q) => h('button', { type: 'button', class: `chip${this.mode === 'pauli' && this.err.at(q) === 'X' ? ' on' : ''}`, 'aria-pressed': this.mode === 'pauli' && this.err.at(q) === 'X',
        onclick: () => { this.mode = 'pauli'; this.err.multiplyAt(q, 'X'); this.outcome = null; if (this.fig) this.fig.broadcast(); else this.render(); } }, `X${subscript(q + 1)}`)),
      flag(this, 'coherent') ? h('button', { type: 'button', class: `chip${this.mode === 'coherent' ? ' on' : ''}`, 'aria-pressed': this.mode === 'coherent',
        onclick: () => { this.mode = 'coherent'; this.outcome = null; this.render(); } }, 'coherent (eq. 20)') : null,
      flag(this, 'coherent') && this.mode === 'coherent' ? slider('p =', { id: `${this.id}-p`, min: 0, max: 0.5, step: 0.01, value: this.p, format: (v) => v.toFixed(2),
        oninput: (v) => { this.p = v; this.outcome = null; this.render(); } }) : null);
    return h('div', { class: 'controls stack' },
      errButtons,
      h('div', { class: 'stepper' },
        h('button', { type: 'button', disabled: this.stage === 0, onclick: () => this.goto(this.stage - 1) }, '← Back'),
        h('span', { class: 'stepper-pos' }, `Stage ${this.stage + 1} of ${this.stages.length}: ${this.stages[this.stage].name}`),
        h('button', { type: 'button', class: 'primary', disabled: this.stage === this.stages.length - 1, onclick: () => this.goto(this.stage + 1) }, this.stage + 1 < this.stages.length ? `Next: ${this.stages[this.stage + 1].name} →` : 'Done'),
        this.stage >= measureIdx ? h('button', { type: 'button', onclick: () => { this.outcome = null; this.stage = measureIdx; this.render(); } }, 'Measure again') : null,
        h('button', { type: 'button', onclick: () => this.goto(0) }, 'Restart')),
      slider('input θ =', { id: `${this.id}-theta`, min: 0, max: Math.PI.toFixed(4), step: 0.01, value: this.theta, format: (v) => `${v.toFixed(2)} rad`,
        oninput: (v) => { this.theta = v; this.outcome = null; this.render(); } }));
  }

  render() {
    const { state, correction } = this.compute(this.stage);
    this.replaceChildren(
      header(this, `${this.code.name}: the circuit, stage by stage`, 'Step through the circuit and watch the amplitudes.'),
      this.circuit(),
      h('p', { class: 'stage-caption' }, h('b', {}, `${this.stages[this.stage].name}. `), this.caption(state, correction)),
      this.branchRows(state),
      this.controls());
  }
}

/* ------------------------------------------------ <qec-suppression> */

class QecSuppression extends Base {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    setup(this);
    this.p = Number(attr(this, 'p', '0.1'));
    this.hoverP = null;
    this.id ||= nextId('sp');
    this.build();
    this.update();
  }

  static pL(p) { return p * p / ((1 - p) ** 2 + p * p); }
  static pDetect(p) { return 2 * p * (1 - p); }

  build() {
    const W = 520, H = 300, L = 54, R = 16, T = 14, B = 44;
    const xmax = 0.5;
    const x = (p) => L + (p / xmax) * (W - L - R);
    const y = (v) => T + (1 - v / xmax) * (H - T - B);
    this.geom = { W, H, L, R, T, B, x, y, xmax };

    const grid = [0, 0.1, 0.2, 0.3, 0.4, 0.5].flatMap((t) => [
      svg('line', { x1: x(0), x2: x(xmax), y1: y(t), y2: y(t), class: 'grid' }),
      svg('text', { x: x(0) - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'tick' }, t.toFixed(1)),
      svg('text', { x: x(t), y: y(0) + 18, 'text-anchor': 'middle', class: 'tick' }, t.toFixed(1)),
    ]);
    const path = (f) => Array.from({ length: 101 }, (_, k) => { const p = (k / 100) * xmax; return `${x(p).toFixed(1)},${y(f(p)).toFixed(1)}`; }).join(' ');

    this.cross = svg('line', { x1: 0, x2: 0, y1: y(0), y2: y(xmax), class: 'crosshair' });
    this.dotRef = svg('circle', { r: 4.5, class: 'dot dot-ref' });
    this.dotEnc = svg('circle', { r: 4.5, class: 'dot dot-enc' });

    this.svg = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img',
      'aria-label': 'Logical error probability of the two-qubit code after a syndrome of 0, against the physical bit-flip probability, compared with an unencoded qubit' },
      grid,
      svg('text', { x: (x(0) + x(xmax)) / 2, y: H - 6, 'text-anchor': 'middle', class: 'axis' }, 'physical bit-flip probability p'),
      svg('text', { x: 13, y: (y(0) + y(xmax)) / 2, 'text-anchor': 'middle', class: 'axis', transform: `rotate(-90 13 ${(y(0) + y(xmax)) / 2})` }, 'error probability'),
      svg('polyline', { points: path((p) => p), class: 'line line-ref' }),
      svg('polyline', { points: path(QecSuppression.pL), class: 'line line-enc' }),
      svg('text', { x: x(0.17), y: y(0.17) - 9, 'text-anchor': 'middle', class: 'dlabel' }, 'unencoded: p'),
      svg('text', { x: x(0.33), y: y(QecSuppression.pL(0.33)) + 16, 'text-anchor': 'middle', class: 'dlabel' }, 'two-qubit code, syndrome 0: p_L'),
      this.cross, this.dotRef, this.dotEnc,
      svg('rect', { x: x(0), y: y(xmax), width: x(xmax) - x(0), height: y(0) - y(xmax), fill: 'transparent',
        onpointermove: (e) => { const r = this.svg.getBoundingClientRect(); const px = (e.clientX - r.left) * (W / r.width); this.hoverP = Math.round(Math.min(xmax, Math.max(0, ((px - L) / (W - L - R)) * xmax)) * 200) / 200; this.update(); },
        onpointerleave: () => { this.hoverP = null; this.update(); } }));

    this.tip = h('div', { class: 'tip', role: 'status' });
    this.terms = h('tbody');
    this.readout = h('p', { class: 'readout-line' });
    this.tableBody = h('tbody');

    this.replaceChildren(
      header(this, 'Error suppression by detection', 'Move the slider, or hover the plot.'),
      slider('p =', { id: `${this.id}-p`, min: 0, max: 0.5, step: 0.005, value: this.p, format: (v) => v.toFixed(3), oninput: (v) => { this.p = v; this.update(); } }),
      h('div', { class: 'scroll' }, h('table', { class: 'w-table terms' },
        h('thead', {}, h('tr', {}, h('th', {}, 'term of E₁ ⊗ E₂ (eq. 21)'), h('th', {}, 'coefficient'), h('th', {}, 'value'), h('th', {}, 'syndrome'), h('th', {}, 'effect on |ψ⟩ᴸ'))),
        this.terms)),
      this.readout,
      h('div', { class: 'legend' },
        h('span', {}, h('i', { class: 'key key-ref' }), 'unencoded qubit: p'),
        h('span', {}, h('i', { class: 'key key-enc' }), 'two-qubit code, given syndrome 0: p_L = p² / ((1−p)² + p²)')),
      h('div', { class: 'chartwrap' }, this.svg, this.tip),
      h('details', {}, h('summary', {}, 'Values as a table'),
        h('table', { class: 'w-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'p'), h('th', {}, 'P(syndrome 1)'), h('th', {}, 'p_L given syndrome 0'), h('th', {}, 'p / p_L'))), this.tableBody)));
  }

  update() {
    const p = this.hoverP ?? this.p;
    const { x, y, W, L, R } = this.geom;
    const pL = QecSuppression.pL(p), pd = QecSuppression.pDetect(p);
    const aI = Math.sqrt(1 - p), aX = Math.sqrt(p);
    this.cross.setAttribute('x1', x(p)); this.cross.setAttribute('x2', x(p));
    this.dotRef.setAttribute('cx', x(p)); this.dotRef.setAttribute('cy', y(p));
    this.dotEnc.setAttribute('cx', x(p)); this.dotEnc.setAttribute('cy', y(pL));
    this.tip.replaceChildren(
      h('div', { class: 'tip-x' }, `p = ${p.toFixed(3)}`),
      h('div', {}, h('i', { class: 'key key-ref' }), h('b', {}, fmt(p, 4)), ' unencoded'),
      h('div', {}, h('i', { class: 'key key-enc' }), h('b', {}, fmt(pL, 4)), ' two-qubit code'));
    const frac = (x(p) - L) / (W - L - R);
    this.tip.style.left = `${(x(p) / W) * 100}%`;
    this.tip.style.transform = frac > 0.55 ? 'translate(calc(-100% - 12px), 0)' : 'translate(12px, 0)';
    const pp = this.p;
    const aI2 = 1 - pp, aX2 = pp, aIX = Math.sqrt(pp * (1 - pp));
    const rows = [
      ['𝟙₁𝟙₂', 'α_I²', aI2, '0', 'nothing'],
      ['X₁', 'α_I α_X', aIX, '1', 'detected'],
      ['X₂', 'α_I α_X', aIX, '1', 'detected'],
      ['X₁X₂', 'α_X²', aX2, '0', 'logical X̄, undetected'],
    ];
    this.terms.replaceChildren(...rows.map(([t, c, v, s, e]) => h('tr', { class: s === '1' ? 'lit' : '' },
      h('td', { class: 'mono' }, t), h('td', { class: 'mono' }, c), h('td', { class: 'mono' }, fmt(v, 3)), h('td', { class: 'mono' }, s), h('td', {}, e))));
    const pLp = QecSuppression.pL(pp), pdp = QecSuppression.pDetect(pp);
    this.readout.replaceChildren(
      `At p = ${pp.toFixed(3)}: α_I = ${fmt(Math.sqrt(1 - pp), 3)}, α_X = ${fmt(Math.sqrt(pp), 3)}. The syndrome reads 1 with probability 2α_I²α_X² = ${fmt(pdp, 3)}, and the state is discarded. `,
      `When it reads 0, the state is ∝ (α_I²·𝟙 + α_X²·X₁X₂)|ψ⟩ᴸ, so the logical error probability is p_L = α_X⁴ / (α_I⁴ + α_X⁴) = ${fmt(pLp, 4)}`,
      pp > 0 ? `, ${(pp / pLp).toFixed(1)}× below the unencoded p.` : '.');
    this.tableBody.replaceChildren(...[0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5].map((q) => h('tr', {},
      h('td', { class: 'mono' }, q.toFixed(2)), h('td', { class: 'mono' }, fmt(QecSuppression.pDetect(q), 4)),
      h('td', { class: 'mono' }, fmt(QecSuppression.pL(q), 4)), h('td', { class: 'mono' }, (q / QecSuppression.pL(q)).toFixed(1)))));
  }
}

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
    const rows = code.errorTable(ks);
    const m = code.stabilizers.length;
    const table = code.lookupDecoder(['X']);
    const single = new Map();
    for (const r of rows) if (r.weight === 1 && !single.has(r.syndrome)) single.set(r.syndrome, r.label);

    const verdict = (r) => {
      const c = code.classify(r.error);
      if (c.kind === 'identity') return 'nothing to do';
      if (c.kind === 'logical') return `undetected: acts as ${c.action.join(' ')}`;
      if (c.kind === 'stabilizer') return 'undetected, but harmless (a stabilizer)';
      const corr = table.get(r.syndrome);
      const residual = r.error.mul(corr);
      const rc = code.classify(residual);
      if (rc.kind === 'identity' || rc.kind === 'stabilizer') return `detected; decoder applies ${corr.toLabelled(code.labels)} and recovers`;
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
      h('p', { class: 'w-note' }, `Rows are ordered by weight. The ${m} generator${m > 1 ? 's' : ''} ${code.stabilizers.map((s) => s.toLabelled(code.labels)).join(' and ')} give${m > 1 ? '' : 's'} ${2 ** m} possible syndromes for ${rows.length} error patterns, so some patterns must share a syndrome; the decoder always assumes the lightest one.`,
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

/* ---------------------------------------------------------- register */

export const components = {
  'qec-figure': QecFigure,
  'qec-state-view': QecStateView,
  'qec-circuit': QecCircuit,
  'qec-suppression': QecSuppression,
  'qec-syndrome-table': QecSyndromeTable,
};

if (typeof customElements !== 'undefined') {
  for (const [name, cls] of Object.entries(components)) {
    if (!customElements.get(name)) customElements.define(name, cls);
  }
}
