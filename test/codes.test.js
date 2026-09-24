import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as gf2 from '../assets/gf2.js';
import { getCode, classical, cssCode, hypergraphProduct, CLASSICAL } from '../assets/codes.js';
import { Pauli } from '../assets/pauli.js';
import { minSumBP } from '../assets/bp.js';

test('GF(2): rank, kernel, inverse', () => {
  const H = gf2.fromStrings(['0001111', '0110011', '1010101']);
  assert.equal(gf2.rank(H), 3);
  const K = gf2.kernel(H);
  assert.equal(K.length, 4);
  for (const v of K) assert.ok(gf2.mulVec(H, v).every((x) => x === 0));
  const A = gf2.fromStrings(['110', '011', '001']);
  assert.ok(gf2.mul(A, gf2.inverse(A)).every((r, i) => r.every((x, j) => x === (i === j ? 1 : 0))));
});

test('classical catalogue: parameters', () => {
  const p = (k) => { const c = classical(k); return [c.n, c.k, c.d]; };
  assert.deepEqual(p('hamming7'), [7, 4, 3]);
  assert.deepEqual(p('simplex7'), [7, 3, 4]);
  assert.deepEqual(p('even7'), [7, 6, 2]);
  assert.deepEqual(p('rep5'), [5, 1, 5]);
  assert.equal(classical('ring3').kT, 1);
  assert.equal(classical('rep3').kT, 0);
  for (const key of Object.keys(CLASSICAL)) assert.equal(classical(key).order.length, classical(key).n + classical(key).m, key);
});

test('Steane code: [[7,1,3]], syndrome of a single X is the binary index of the qubit', () => {
  const code = getCode('steane');
  assert.equal(code.params(), '[[7, 1, 3]]');
  const H = code.extra.HZ;
  for (let q = 0; q < 7; q++) {
    const e = new Uint8Array(7); e[q] = 1;
    assert.equal(parseInt(Array.from(gf2.mulVec(H, e)).join(''), 2), q + 1);
  }
  const t = code.lookupDecoder(['X', 'Z', 'Y']);
  for (const row of code.singleQubitTable(['X', 'Z', 'Y'])) {
    const r = code.classify(row.error.mul(t.get(row.syndrome)));
    assert.ok(r.kind === 'identity' || r.kind === 'stabilizer', row.label);
  }
});

test('CSS pairs that do not commute are rejected', () => {
  const Hm = classical('hamming7').H, R = classical('rep7').H;
  assert.throws(() => cssCode('bad', Hm, R));
  assert.equal(cssCode('ok', Hm, classical('even7').H).params(), '[[7, 3, 2]]');
  assert.equal(cssCode('none', Hm, classical('simplex7').H).k, 0);
});

test('hypergraph products: surface, toric and Hamming² codes', () => {
  const surf = hypergraphProduct('rep3', 'rep3');
  assert.equal(surf.params(), '[[13, 1, 3]]');
  assert.equal(surf.distance(), 3);            // brute force agrees with min(d₁, d₂, d₁ᵀ, d₂ᵀ)
  assert.equal(hypergraphProduct('rep4', 'rep4').params(), '[[25, 1, 4]]');
  const toric = hypergraphProduct('ring3', 'ring3');
  assert.equal(toric.params(), '[[18, 2, 3]]');
  assert.equal(toric.distance(), 3);
  const hh = hypergraphProduct('hamming7', 'hamming7');
  assert.equal(hh.n, 58); assert.equal(hh.k, 16);
  assert.equal(hh.params(), '[[58, 16, 3]]');
  const hr = hypergraphProduct('hamming7', 'rep3');
  assert.equal(hr.params(), '[[27, 4, 3]]');
  assert.equal(hr.distance(), 3);
  for (const c of [surf, toric, hh]) assert.ok(gf2.isZero(gf2.mul(c.extra.HX, gf2.transpose(c.extra.HZ))));
});

test('min-sum BP decodes a single X error on the surface code', () => {
  const code = hypergraphProduct('rep3', 'rep3');
  const HZ = code.extra.HZ;
  for (let q = 0; q < code.n; q++) {
    const e = new Uint8Array(code.n); e[q] = 1;
    const res = minSumBP(HZ, gf2.mulVec(HZ, e), 0.05);
    assert.ok(res.converged, `qubit ${q}`);
    const residual = Pauli.identity(code.n);
    res.history.at(-1).e.forEach((b, j) => { if (b ^ e[j]) residual.set(j, 'X'); });
    assert.notEqual(code.classify(residual).kind, 'logical', `qubit ${q}`);
  }
});
