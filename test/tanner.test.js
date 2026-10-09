import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as gf2 from '../assets/gf2.js';
import { classical, getCode } from '../assets/codes.js';

const names = (sol) => sol.map((e) => Array.from(e).map((b, j) => (b ? j + 1 : 0)).filter(Boolean).join(','));

test('lightest explanations on the Hamming Tanner graph: lookup, a two-flip failure, and a tie', () => {
  const H = classical('hamming7').H;
  const flip = (...bits) => { const e = new Uint8Array(7); for (const b of bits) e[b - 1] = 1; return e; };
  // one flip: the syndrome is its column and the lightest explanation is unique
  let r = gf2.lightestSolutions(H, gf2.mulVec(H, flip(5)), 7);
  assert.equal(r.weight, 1); assert.deepEqual(names(r.solutions), ['5']);
  // two flips on 5 and 6 look like one flip on 3; correcting 3 leaves the codeword 3, 5, 6
  r = gf2.lightestSolutions(H, gf2.mulVec(H, flip(5, 6)), 7);
  assert.deepEqual(names(r.solutions), ['3']);
  const net = flip(3, 5, 6);
  assert.ok(gf2.mulVec(H, net).every((b) => b === 0));
  // the [[4,2,2]] check (1111): a lit check is explained by any single bit, a four-way tie
  r = gf2.lightestSolutions(gf2.fromStrings(['1111']), [1], 4);
  assert.equal(r.weight, 1); assert.equal(r.solutions.length, 4);
  // the zero syndrome needs nothing, and an impossible one is reported as such
  assert.equal(gf2.lightestSolutions(H, [0, 0, 0], 7).weight, 0);
  assert.equal(gf2.lightestSolutions(gf2.fromStrings(['110', '011']), [1, 1], 3, 0).weight, null);
});

test('Shor code on its Tanner graph: Z errors in one block light the same X check and differ by a Z check', () => {
  const code = getCode('shor');
  const HX = [], HZ = [];
  for (const g of code.stabilizers) (g.x.some((b) => b) ? HX : HZ).push(Uint8Array.from(g.x.some((b) => b) ? g.x : g.z));
  assert.equal(HZ.length, 6); assert.equal(HX.length, 2);
  // every X check meets every Z check in an even number of qubits
  for (const x of HX) for (const z of HZ) assert.equal(x.reduce((a, b, j) => a + b * z[j], 0) % 2, 0);
  const col = (j) => HX.map((r) => r[j]).join('');
  assert.equal(col(0), col(1)); assert.equal(col(1), col(2));      // qubits 1, 2, 3 share an X-side neighbourhood
  assert.notEqual(col(0), col(3));
  const r = gf2.lightestSolutions(HX, gf2.mulVec(HX, Uint8Array.from([0, 1, 0, 0, 0, 0, 0, 0, 0])), 9);
  assert.equal(r.solutions.length, 3);                               // a three-way tie, harmless: Z₁Z₂ is a check
});
