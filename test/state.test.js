import { test } from 'node:test';
import assert from 'node:assert/strict';
import { State, encode, codewords, subspaces } from '../assets/state.js';
import { Pauli } from '../assets/pauli.js';
import { getCode } from '../assets/codes.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('encoder: eq. 12 and the three-qubit codewords', () => {
  const two = getCode('two-qubit'), three = getCode('three-qubit');
  const psi = State.single(0.8, 0.6);
  const l2 = encode(two, psi);
  assert.equal(l2.toString(), '0.800|00⟩ + 0.600|11⟩');
  const l3 = encode(three, psi);
  assert.equal(l3.toString(), '0.800|000⟩ + 0.600|111⟩');
  close(l3.norm2(), 1);
  const { plus, minus } = codewords(three);
  assert.equal(plus.toString(), '0.707|000⟩ + 0.707|111⟩');
  assert.equal(minus.toString(), '0.707|000⟩ − 0.707|111⟩');
});

test('a bit flip rotates the state into an error space; Z₁Z₂ reads −1 there', () => {
  const two = getCode('two-qubit');
  const s = encode(two, State.single(0.8, 0.6));
  close(s.expectZ([0, 1]), 1);
  s.x(0);
  assert.equal(s.toString(), '0.600|01⟩ + 0.800|10⟩');
  close(s.expectZ([0, 1]), -1);
  const { groups, of } = subspaces(two);
  assert.deepEqual(groups.map((g) => g.label), ['C', 'F']);
  assert.deepEqual(groups[0].members, [0, 3]);
  assert.deepEqual(groups[1].members, [1, 2]);
  assert.equal(of[2], 1);
});

test('eq. 25: the three-qubit Hilbert space splits into C, F₁, F₂, F₃', () => {
  const { groups } = subspaces(getCode('three-qubit'));
  assert.deepEqual(groups.map((g) => g.label), ['C', 'F₁', 'F₂', 'F₃']);
  assert.deepEqual(groups.map((g) => g.members), [[0, 7], [3, 4], [2, 5], [1, 6]]);
  assert.deepEqual(groups.map((g) => g.syndrome), ['00', '10', '11', '01']);
});

test('the syndrome-extraction circuit copies the Pauli-frame syndrome onto the ancillas', () => {
  const code = getCode('three-qubit');
  for (const err of ['III', 'XII', 'IXI', 'IIX', 'XXI', 'IXX', 'XIX', 'XXX']) {
    let s = State.product(encode(code, State.fromAngle(1.1)), new State(2));   // two ancillas: qubits 3, 4
    s.applyPauli(Pauli.fromString(err));
    for (let k = 0; k < 2; k++) {
      s.h(3 + k);
      s.controlledPauli(3 + k, code.stabilizers[k]);
      s.h(3 + k);
    }
    const br = s.branches([3, 4]);
    const live = br.filter((b) => b.prob > 1e-9);
    assert.equal(live.length, 1, err);
    assert.equal(live[0].bits, code.syndromeString(err), err);
    close(live[0].prob, 1);
  }
});

test('eq. 22–24: coherent bit flips on the two-qubit code, syndrome-0 branch', () => {
  const code = getCode('two-qubit');
  for (const p of [0.05, 0.1, 0.3]) {
    let s = State.product(encode(code, State.single(1, 0)), new State(1));   // |0⟩_L, one ancilla
    s.coherentBitFlip(0, p).coherentBitFlip(1, p).normalize();
    s.h(2); s.controlledPauli(2, code.stabilizers[0]); s.h(2);
    const [b0, b1] = s.branches([2]);
    const aI2 = 1 - p, aX2 = p;
    // eq. 22: syndrome 0 carries α_I²·𝟙 + α_X²·X₁X₂, syndrome 1 carries α_Iα_X(X₁ + X₂)
    close(b0.prob, (aI2 ** 2 + aX2 ** 2) / (aI2 ** 2 + aX2 ** 2 + 2 * aI2 * aX2));
    close(b1.prob, 1 - b0.prob);
    // eq. 24: probability of a logical error given syndrome 0
    const pL = b0.state.a[3] ** 2;                 // weight on |11⟩ = X̄|0⟩_L
    close(pL, p ** 2 / ((1 - p) ** 2 + p ** 2));
    assert.ok(pL < p);
  }
});

test('eq. 28: Z₁ flips |+⟩_L to |−⟩_L and no stabilizer notices', () => {
  const code = getCode('three-qubit');
  const { plus, minus } = codewords(code);
  const s = plus.clone().z(0);
  close(s.fidelity(minus), 1);
  close(s.expectZ([0, 1]), 1);
  close(s.expectZ([1, 2]), 1);
  // whereas a bit flip is seen
  close(plus.clone().x(0).expectZ([0, 1]), -1);
});

test('measurement: branches sum to one, collapse renormalises, sampling honours the Born rule', () => {
  const s = State.product(State.fromAngle(0.9), State.single(Math.SQRT1_2, Math.SQRT1_2));
  const br = s.branches([1]);
  close(br.reduce((a, b) => a + b.prob, 0), 1);
  const c = s.clone();
  const prob = c.collapse([1], '1');
  close(prob, 0.5);
  close(c.norm2(), 1);
  assert.equal(s.sample([1], () => 0.2), '0');
  assert.equal(s.sample([1], () => 0.9), '1');
});

import { logicalBasis, encodeLogical } from '../assets/state.js';

test('eq. 32 and 35: the [[4,2,2]] codewords, |00⟩ᴸ by projecting |0000⟩', () => {
  const code = getCode('four-two-two');
  const b = logicalBasis(code).map((v) => v.toString());
  assert.deepEqual(b, [
    '0.707|0000⟩ + 0.707|1111⟩',
    '0.707|0110⟩ + 0.707|1001⟩',
    '0.707|0101⟩ + 0.707|1010⟩',
    '0.707|0011⟩ + 0.707|1100⟩',
  ]);
  const s = new State(4);
  for (const g of code.stabilizers) s.projectPlus(g);
  assert.equal(s.normalize().toString(), b[0]);
  for (const v of logicalBasis(code)) for (const g of code.stabilizers) close(v.expect(g), 1);
});

test('eq. 43: the Shor codewords; eq. 34 alone gives |+⟩ᴸ, not |0⟩ᴸ', () => {
  const code = getCode('shor');
  const [zero, one] = logicalBasis(code);
  assert.equal(zero.toString().split('+').length, 8);
  close(zero.a[0], 1 / Math.sqrt(8));
  close(one.a[0b000000111], -1 / Math.sqrt(8));        // (|000⟩ − |111⟩)^⊗3 has sign (−1)^(# of |111⟩ blocks)
  close(one.a[0b111111111], -1 / Math.sqrt(8));
  const s = new State(9);
  for (const g of code.stabilizers) s.projectPlus(g);
  s.normalize();
  const plus = encodeLogical(code, [1, 1]);
  close(s.fidelity(plus), 1);
  close(s.fidelity(zero), 0.5);
});

test('Y applied up to a global phase gives the right syndrome subspace', () => {
  const code = getCode('four-two-two');
  const [zz] = logicalBasis(code);
  const s = zz.clone().applyPauliUpToPhase(Pauli.fromString('YIII'));
  close(s.expect(code.stabilizers[0]), -1);
  close(s.expect(code.stabilizers[1]), -1);
});

import { encodeInputs } from '../assets/state.js';

test('the [[4,2,2]] and Shor encoders produce the codewords of eq. 32 and 43', () => {
  for (const name of ['four-two-two', 'shor']) {
    const code = getCode(name);
    const k = code.logicals.length;
    const basis = logicalBasis(code);
    for (let j = 0; j < 1 << k; j++) {
      const inputs = Array.from({ length: k }, (_, b) => State.basis(String((j >> (k - 1 - b)) & 1)));
      close(encodeInputs(code, inputs).fidelity(basis[j]), 1);
      assert.ok(encodeInputs(code, inputs).overlap(basis[j]) > 0.999, `${name} |${j}⟩ sign`);
    }
  }
});

test('syndrome extraction on the Shor code (17 qubits) gives the Pauli-frame syndrome', () => {
  const code = getCode('shor');
  for (const e of ['Z2', 'X5', 'Y9']) {
    const err = Pauli.fromString(e, 9);
    let s = State.product(encodeInputs(code, [State.fromAngle(1.1)]), new State(8));
    s.applyPauliUpToPhase(err);
    for (let k = 0; k < 8; k++) { s.h(9 + k); s.controlledPauli(9 + k, code.stabilizers[k]); s.h(9 + k); }
    const live = s.branches([9, 10, 11, 12, 13, 14, 15, 16]).filter((b) => b.prob > 1e-9);
    assert.equal(live.length, 1);
    assert.equal(live[0].bits, code.syndromeString(err), e);
  }
});
