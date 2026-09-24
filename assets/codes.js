// codes.js — the catalogue of codes used in the notes.
//
// Qubit numbering, generator order and the choice of logical operators follow
// Roffe, "Quantum error correction: an introductory guide", Contemp. Phys. 60,
// 226 (2019), arXiv:1907.11157, so the widgets read side by side with the paper.
// Part 1 needs only the bit-flip repetition codes; later parts add CSS and
// qLDPC constructions here.

import { StabilizerCode } from './pauli.js';

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
  });
}

const CATALOG = {
  'two-qubit': () => repetitionCode(2),
  'three-qubit': () => repetitionCode(3),
  'four-two-two': fourTwoTwoCode,
  shor: shorCode,
};

const cache = new Map();

/** Look a code up by name: 'two-qubit', 'three-qubit', 'four-two-two', 'shor' or 'repetition:n'. */
export function getCode(name) {
  if (cache.has(name)) return cache.get(name);
  let code;
  const m = /^repetition[:-](\d+)$/.exec(name);
  if (m) code = repetitionCode(+m[1]);
  else if (CATALOG[name]) code = CATALOG[name]();
  else throw new Error(`unknown code '${name}'`);
  cache.set(name, code);
  return code;
}

export const codeNames = Object.keys(CATALOG);
