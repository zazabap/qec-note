// codes.js — the catalogue of codes used in the notes.
//
// Qubit numbering, generator order and the choice of logical operators follow
// Roffe, "Quantum error correction: an introductory guide", Contemp. Phys. 60,
// 226 (2019), arXiv:1907.11157, so the widgets read side by side with the paper.
// Part 1 needs only the bit-flip repetition codes; later parts add CSS and
// qLDPC constructions here.

import { Pauli, StabilizerCode, subscript } from './pauli.js';
import * as gf2 from './gf2.js';

/**
 * Bit-flip repetition code on n qubits: |ψ⟩_L = α|0…0⟩ + β|1…1⟩,
 * stabilizers Z_i Z_{i+1}, encoder CNOT(1→i) for i = 2..n.
 */
export function repetitionCode(n) {
  if (!(Number.isInteger(n) && n >= 2)) throw new Error('need n >= 2');
  const stabilizers = [];
  for (let i = 1; i < n; i++) stabilizers.push(`Z${i}Z${i + 1}`);
  return new StabilizerCode({
    name: n === 2 ? 'Two-qubit detection code' : `${n === 3 ? 'Three' : n}-qubit code`,
    n,
    stabilizers,
    // Z̄ = Z on every qubit for odd n; for even n that product is a stabilizer,
    // so Z₁ is used instead. Either way Z̄ ≡ Z₁ up to stabilizers.
    logicals: [{ X: 'X'.repeat(n), Z: n % 2 ? 'Z'.repeat(n) : 'Z1' }],
    description: n === 2
      ? 'Detects one bit flip but cannot say which qubit it hit.'
      : 'Corrects any single bit flip; a single phase flip is a logical Z̄ and passes unnoticed.',
    extra: {
      // Encoder as a gate list, control → target, 0-based.
      encoder: Array.from({ length: n - 1 }, (_, i) => ({ gate: 'cnot', control: 0, target: i + 1 })),
    },
  });
}

/**
 * The [[4,2,2]] detection code (paper §4.3). Generators are listed Z-type
 * first so that syndromes read as in table 3 (X errors give 10, Z errors 01);
 * logical operators are those of eq. 33.
 */
export function fourTwoTwoCode() {
  return new StabilizerCode({
    name: '[[4,2,2]] code',
    n: 4,
    stabilizers: ['Z1Z2Z3Z4', 'X1X2X3X4'],
    logicals: [
      { X: 'X1X3', Z: 'Z1Z4' },
      { X: 'X2X3', Z: 'Z2Z4' },
    ],
    description: 'Two logical qubits in four physical ones. Every single-qubit error is detected; none can be located.',
    extra: {
      // |ab00⟩ → X̄₁^a X̄₂^b |00⟩ᴸ: parity of the data onto qubit 3, then |+⟩ on
      // qubit 4 fanned out to qubits 1–3 adds the all-ones pattern.
      dataQubits: [0, 1],
      encoder: [
        { gate: 'cnot', control: 0, target: 2 }, { gate: 'cnot', control: 1, target: 2 },
        { gate: 'h', target: 3 },
        { gate: 'cnot', control: 3, target: 0 }, { gate: 'cnot', control: 3, target: 1 }, { gate: 'cnot', control: 3, target: 2 },
      ],
      encoderNote: 'Two CNOTs write the parity of the data qubits onto qubit 3, a Hadamard puts qubit 4 in |+⟩, and three CNOTs from qubit 4 add the all-ones pattern. Each input |ab⟩ becomes X̄₁ᵃX̄₂ᵇ|00⟩ᴸ, so the state is Σ c_ab|ab⟩ᴸ with the codewords of eq. 32.',
    },
  });
}

/**
 * The Shor [[9,1,3]] code (paper §4.6): stabilizers of eq. 44 in that order,
 * codewords of eq. 43. The paper gives no logical operators; with
 * |0⟩ = |+⟩₃ᵦ^⊗3 and |1⟩ = |−⟩₃ᵦ^⊗3, X̄ = Z₁Z₄Z₇ flips every block between
 * |+⟩₃ᵦ and |−⟩₃ᵦ, and Z̄ = X₁X₂X₃ reads the sign of the first block.
 */
export function shorCode() {
  return new StabilizerCode({
    name: 'Shor [[9,1,3]] code',
    n: 9,
    stabilizers: [
      'Z1Z2', 'Z2Z3', 'Z4Z5', 'Z5Z6', 'Z7Z8', 'Z8Z9',
      'X1X2X3X4X5X6', 'X4X5X6X7X8X9',
    ],
    logicals: [{ X: 'Z1Z4Z7', Z: 'X1X2X3' }],
    description: 'A phase-flip code whose qubits are each a bit-flip code. Corrects any single-qubit error.',
    extra: {
      dataQubits: [0],
      encoder: [
        { gate: 'cnot', control: 0, target: 3 }, { gate: 'cnot', control: 0, target: 6 },
        { gate: 'h', target: 0 }, { gate: 'h', target: 3 }, { gate: 'h', target: 6 },
        { gate: 'cnot', control: 0, target: 1 }, { gate: 'cnot', control: 3, target: 4 }, { gate: 'cnot', control: 6, target: 7 },
        { gate: 'cnot', control: 0, target: 2 }, { gate: 'cnot', control: 3, target: 5 }, { gate: 'cnot', control: 6, target: 8 },
      ],
      encoderNote: 'CNOTs from qubit 1 to qubits 4 and 7 make a three-qubit code, Hadamards turn its |0⟩, |1⟩ into |+⟩, |−⟩ (the phase-flip code), and CNOTs inside each block make every |±⟩ a bit-flip code |±⟩₃ᵦ (eq. 41, 42). The result is α|0⟩₉ + β|1⟩₉ with the codewords of eq. 43.',
    },
  });
}

/* ------------------------------------------------------ classical codes */

/**
 * Small classical codes, given by parity-check matrices H (rows are checks).
 * `order` lists the Tanner-graph nodes ('b0', 'c0', …) in the order the
 * hypergraph-product lattice lays them out: interleaved for repetition codes,
 * so that their product is the surface code, bits then checks otherwise.
 */
function chain(n) {
  const rows = [];
  for (let i = 0; i < n - 1; i++) rows.push('0'.repeat(i) + '11' + '0'.repeat(n - i - 2));
  const order = [];
  for (let i = 0; i < n; i++) { order.push('b' + i); if (i < n - 1) order.push('c' + i); }
  return { name: `repetition code [${n},1,${n}]`, short: `rep ${n}`, H: gf2.fromStrings(rows), order };
}
function ring(n) {
  const c = chain(n);
  const rows = gf2.toStrings(c.H);
  rows.push('1' + '0'.repeat(n - 2) + '1');
  const order = [];
  for (let i = 0; i < n; i++) order.push('b' + i, 'c' + i);
  return { name: `cyclic repetition code, ${n} bits`, short: `ring ${n}`, H: gf2.fromStrings(rows), order };
}
const HAMMING = ['0001111', '0110011', '1010101'];   // column j is j in binary: the syndrome names the bit
function bitsThenChecks(H) {
  const n = H[0].length, m = H.length;
  return [...Array.from({ length: n }, (_, i) => 'b' + i), ...Array.from({ length: m }, (_, i) => 'c' + i)];
}
function named(name, short, rows) {
  const H = gf2.fromStrings(rows);
  return { name, short, H, order: bitsThenChecks(H) };
}

export const CLASSICAL = {
  hamming7: () => named('Hamming code [7,4,3]', 'Hamming', HAMMING),
  simplex7: () => named('simplex code [7,3,4] (dual of Hamming)', 'simplex', gf2.toStrings(gf2.kernel(gf2.fromStrings(HAMMING)))),
  even7: () => named('even-weight code [7,6,2]', 'even weight', ['1111111']),
  rep7: () => chain(7),
  rep3: () => chain(3),
  rep4: () => chain(4),
  rep5: () => chain(5),
  ring3: () => ring(3),
  ring4: () => ring(4),
};

export function classical(name) {
  const c = CLASSICAL[name]();
  const H = c.H, n = H[0].length;
  const k = n - gf2.rank(H, n);
  const d = gf2.classicalDistance(H, n);
  const HT = gf2.transpose(H, n);
  const kT = H.length - gf2.rank(HT, H.length);
  const dT = kT ? gf2.classicalDistance(HT, H.length) : Infinity;
  return { ...c, key: name, n, m: H.length, k, d, kT, dT };
}

/* --------------------------------------------------------------- CSS codes */

/**
 * The CSS code with X-type checks from the rows of HX and Z-type checks from
 * the rows of HZ. Requires HX·HZᵀ = 0. Generators are listed X-type first.
 * Distance: searched when the kernels are small, else taken from `distance`.
 */
export function cssCode(name, HX, HZ, { distance, labels, extra = {}, description = '' } = {}) {
  const n = (HX[0] ?? HZ[0]).length;
  if (!gf2.isZero(gf2.mul(HX, gf2.transpose(HZ, n)))) throw new Error('HX·HZᵀ ≠ 0: the checks do not commute');
  const toPauli = (row, kind) => { const p = Pauli.identity(n); row.forEach((b, j) => { if (b) p.set(j, kind); }); return p; };
  // drop dependent rows so that k = n − (number of generators)
  const indep = (H) => gf2.rref(H, n).R;
  const gx = indep(HX), gz = indep(HZ);
  const L = gf2.cssLogicals(HX, HZ, n);
  let d = distance;
  if (d === undefined) {
    const dX = gf2.minWeightOutside(HZ, HX, n), dZ = gf2.minWeightOutside(HX, HZ, n);
    if (dX !== null && dZ !== null) d = Math.min(dX, dZ);
  }
  return new StabilizerCode({
    name, n,
    stabilizers: [...gx.map((r) => toPauli(r, 'X')), ...gz.map((r) => toPauli(r, 'Z'))],
    logicals: L.X.map((x, i) => ({ X: toPauli(x, 'X'), Z: toPauli(L.Z[i], 'Z') })),
    labels, distance: d === Infinity ? undefined : d, description,
    extra: { ...extra, css: true, HX, HZ },
  });
}

/** The Steane [[7,1,3]] code: both check matrices are the Hamming code's. */
export function steaneCode() {
  const H = gf2.fromStrings(HAMMING);
  return cssCode('Steane [[7,1,3]] code', H, H, { description: 'X and Z checks both from the [7,4,3] Hamming code.' });
}

/**
 * The hypergraph product of two classical codes (Tillich and Zémor):
 *   H_X = [H₁ ⊗ I_{n₂} | I_{m₁} ⊗ H₂ᵀ],   H_Z = [I_{n₁} ⊗ H₂ | H₁ᵀ ⊗ I_{m₂}].
 * Qubits (i, j) with i a bit of code 1 and j a bit of code 2 come first,
 * then qubits (a, b) with a, b checks. d = min(d₁, d₂, d₁ᵀ, d₂ᵀ).
 */
export function hypergraphProduct(key1, key2) {
  const c1 = classical(key1), c2 = classical(key2);
  const { n: n1, m: m1 } = c1, { n: n2, m: m2 } = c2;
  const H1 = c1.H, H2 = c2.H;
  const HX = gf2.hstack(gf2.kron(H1, gf2.identity(n2)), gf2.kron(gf2.identity(m1), gf2.transpose(H2, n2)));
  const HZ = gf2.hstack(gf2.kron(gf2.identity(n1), H2), gf2.kron(gf2.transpose(H1, n1), gf2.identity(m2)));
  const d = Math.min(c1.d, c2.d, c1.dT, c2.dT);
  const code = cssCode(`HGP(${c1.short}, ${c2.short})`, HX, HZ, {
    distance: Number.isFinite(d) ? d : undefined,
    extra: { hgp: { c1, c2 } },
  });
  return code;
}

const CATALOG = {
  'two-qubit': () => repetitionCode(2),
  'three-qubit': () => repetitionCode(3),
  'four-two-two': fourTwoTwoCode,
  shor: shorCode,
  steane: steaneCode,
};

const cache = new Map();

/** Look a code up by name: 'two-qubit', 'three-qubit', 'four-two-two', 'shor' or 'repetition:n'. */
export function getCode(name) {
  if (cache.has(name)) return cache.get(name);
  let code;
  const m = /^repetition[:-](\d+)$/.exec(name);
  const hg = /^hgp:(\w+),(\w+)$/.exec(name);
  if (m) code = repetitionCode(+m[1]);
  else if (hg) code = hypergraphProduct(hg[1], hg[2]);
  else if (CATALOG[name]) code = CATALOG[name]();
  else throw new Error(`unknown code '${name}'`);
  cache.set(name, code);
  return code;
}

export const codeNames = Object.keys(CATALOG);
