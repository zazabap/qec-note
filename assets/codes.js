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

const CATALOG = {
  'two-qubit': () => repetitionCode(2),
  'three-qubit': () => repetitionCode(3),
};

const cache = new Map();

/** Look a code up by name: 'two-qubit', 'three-qubit' or 'repetition:n'. */
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
