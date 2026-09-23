import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pauli } from '../assets/pauli.js';
import { getCode } from '../assets/codes.js';

test('parsing and printing', () => {
  assert.equal(Pauli.fromString('XIZ').toString(), 'XIZ');
  assert.equal(Pauli.fromString('X1Z3', 3).toString(), 'XIZ');
  assert.equal(Pauli.fromString('XIZ').toLabelled(), 'X₁Z₃');
  assert.equal(Pauli.identity(3).toLabelled(), 'I');
  assert.throws(() => Pauli.fromString('X4', 3));
});

test('commutation is the symplectic inner product', () => {
  const X = Pauli.fromString('X'), Z = Pauli.fromString('Z');
  assert.ok(!X.commutes(Z));
  assert.ok(X.commutes(X));
  assert.ok(Pauli.fromString('XX').commutes(Pauli.fromString('ZZ')));
  assert.ok(!Pauli.fromString('XI').commutes(Pauli.fromString('ZZ')));
});

test('table 1: two-qubit code syndromes', () => {
  const code = getCode('two-qubit');
  assert.equal(code.n, 2);
  assert.equal(code.k, 1);
  const syn = (e) => code.syndromeString(e);
  assert.equal(syn('II'), '0');
  assert.equal(syn('XI'), '1');
  assert.equal(syn('IX'), '1');
  assert.equal(syn('XX'), '0');
  assert.equal(code.classify('XX').kind, 'logical');
  assert.deepEqual(code.classify('XX').action, ['X̄']);
});

test('table 2: three-qubit code syndromes for every bit-flip pattern', () => {
  const code = getCode('three-qubit');
  const expect = { III: '00', XII: '10', IXI: '11', IIX: '01', XXI: '01', IXX: '10', XIX: '11', XXX: '00' };
  for (const [e, s] of Object.entries(expect)) assert.equal(code.syndromeString(e), s, e);
  const rows = code.errorTable(['X']);
  assert.equal(rows.length, 8);
  assert.deepEqual(rows.map((r) => r.weight), [0, 1, 1, 1, 2, 2, 2, 3]);
});

test('single bit flips get distinct syndromes and the lookup decoder repairs them', () => {
  const code = getCode('three-qubit');
  const table = code.lookupDecoder(['X']);
  for (let i = 0; i < 3; i++) {
    const e = Pauli.single(3, i, 'X');
    const corr = table.get(code.syndromeString(e));
    assert.ok(corr.equals(e));
  }
  // two flips are decoded as the third: net effect is the logical X̄
  const e = Pauli.fromString('XXI');
  const corr = table.get(code.syndromeString(e));
  assert.equal(code.classify(e.mul(corr)).kind, 'logical');
});

test('distance: 3 against bit flips alone, 1 once phase flips are allowed', () => {
  const code = getCode('three-qubit');
  assert.equal(code.distance(['X']), 3);
  assert.equal(code.distance(), 1);
  assert.equal(code.params(), '[[3, 1, 1]]');
  assert.deepEqual(code.classify('ZII').action, ['Z̄']);
  assert.equal(code.classify('ZZI').kind, 'stabilizer');
  assert.equal(getCode('two-qubit').distance(['X']), 2);
  assert.equal(getCode('two-qubit').distance(), 1);
});
