// gf2.js — linear algebra over GF(2), for CSS and hypergraph-product codes.
//
// A matrix is an array of rows; a row is a Uint8Array of 0/1. Sizes in these
// notes stay below a few hundred columns, so everything is dense and simple.

export function fromStrings(rows) {
  return rows.map((r) => Uint8Array.from(r.replace(/\s/g, ''), (c) => +c));
}

export function toStrings(A) {
  return A.map((r) => Array.from(r).join(''));
}

export function zeros(m, n) {
  return Array.from({ length: m }, () => new Uint8Array(n));
}

export function identity(n) {
  const I = zeros(n, n);
  for (let i = 0; i < n; i++) I[i][i] = 1;
  return I;
}

export const cols = (A, n) => (A.length ? A[0].length : n ?? 0);

export function transpose(A, n) {
  const m = A.length, c = cols(A, n);
  const T = zeros(c, m);
  for (let i = 0; i < m; i++) for (let j = 0; j < c; j++) T[j][i] = A[i][j];
  return T;
}

export function mul(A, B) {
  const m = A.length, k = B.length, n = cols(B);
  const C = zeros(m, n);
  for (let i = 0; i < m; i++) for (let t = 0; t < k; t++) if (A[i][t]) for (let j = 0; j < n; j++) C[i][j] ^= B[t][j];
  return C;
}

/** A·v for a vector v. */
export function mulVec(A, v) {
  return Uint8Array.from(A, (row) => { let s = 0; for (let j = 0; j < v.length; j++) s ^= row[j] & v[j]; return s; });
}

export function isZero(A) {
  return A.every((r) => r.every((x) => x === 0));
}

export function kron(A, B) {
  const ma = A.length, na = cols(A), mb = B.length, nb = cols(B);
  const C = zeros(ma * mb, na * nb);
  for (let i = 0; i < ma; i++) for (let j = 0; j < na; j++) if (A[i][j])
    for (let k = 0; k < mb; k++) for (let l = 0; l < nb; l++) C[i * mb + k][j * nb + l] = B[k][l];
  return C;
}

export function hstack(A, B) {
  return A.map((r, i) => { const out = new Uint8Array(r.length + B[i].length); out.set(r); out.set(B[i], r.length); return out; });
}

/** Row-reduced echelon form. Returns { R, pivots } with R a new matrix. */
export function rref(A, n) {
  const R = A.map((r) => r.slice());
  const c = cols(A, n);
  const pivots = [];
  let row = 0;
  for (let col = 0; col < c && row < R.length; col++) {
    let p = row;
    while (p < R.length && !R[p][col]) p++;
    if (p === R.length) continue;
    [R[row], R[p]] = [R[p], R[row]];
    for (let i = 0; i < R.length; i++) if (i !== row && R[i][col]) for (let j = 0; j < c; j++) R[i][j] ^= R[row][j];
    pivots.push(col);
    row++;
  }
  return { R: R.slice(0, row), pivots };
}

export function rank(A, n) {
  return rref(A, n).pivots.length;
}

/** A basis of the kernel { v : A v = 0 }, as rows. */
export function kernel(A, n) {
  const c = cols(A, n);
  const { R, pivots } = rref(A, c);
  const free = [];
  for (let j = 0; j < c; j++) if (!pivots.includes(j)) free.push(j);
  return free.map((f) => {
    const v = new Uint8Array(c);
    v[f] = 1;
    pivots.forEach((pc, i) => { if (R[i][f]) v[pc] = 1; });
    return v;
  });
}

/** Is v a combination of the rows of A? */
export function inRowspace(v, A) {
  if (!A.length) return v.every((x) => x === 0);
  return rank([...A, v]) === rank(A);
}

export function inverse(A) {
  const n = A.length;
  const aug = hstack(A, identity(n));
  const { R, pivots } = rref(aug, 2 * n);
  if (pivots.length < n || pivots[n - 1] !== n - 1) throw new Error('matrix is singular');
  return R.map((r) => r.slice(n));
}

export function weight(v) {
  let w = 0;
  for (const x of v) w += x;
  return w;
}

/**
 * Minimum weight of a non-zero vector in ker(A) that is not in the row space
 * of B (B may be empty), by enumerating the kernel. Returns Infinity if every
 * kernel vector is in the row space, null if the kernel is too big to search.
 */
export function minWeightOutside(A, B, n, maxDim = 20) {
  const K = kernel(A, n);
  if (K.length > maxDim) return null;
  let best = Infinity;
  const c = cols(A, n);
  for (let mask = 1; mask < 2 ** K.length; mask++) {
    const v = new Uint8Array(c);
    for (let b = 0; b < K.length; b++) if ((mask >> b) & 1) for (let j = 0; j < c; j++) v[j] ^= K[b][j];
    const w = weight(v);
    if (w < best && !(B.length && inRowspace(v, B))) best = w;
  }
  return best;
}

/** Distance of the classical code ker(H); Infinity if the code is {0}. */
export function classicalDistance(H, n) {
  return minWeightOutside(H, [], n);
}

/**
 * Logical operators of the CSS code with checks HX (X-type) and HZ (Z-type):
 * X̄ from ker(HZ) outside rowspace(HX), Z̄ from ker(HX) outside rowspace(HZ),
 * paired so that X̄ᵢ · Z̄ⱼ = δᵢⱼ. Returns { X: rows, Z: rows }.
 */
export function cssLogicals(HX, HZ, n) {
  const pick = (K, S) => {
    const chosen = [];
    let base = S.slice();
    let r = rank(base, n);
    for (const v of K) {
      const r2 = rank([...base, v], n);
      if (r2 > r) { chosen.push(v); base = [...base, v]; r = r2; }
    }
    return chosen;
  };
  const LX = pick(kernel(HZ, n), HX);
  const LZ = pick(kernel(HX, n), HZ);
  if (!LX.length) return { X: [], Z: [] };
  const M = mul(LX, transpose(LZ, n));          // k×k, invertible
  const N = transpose(inverse(M));
  return { X: LX, Z: mul(N, LZ) };
}
