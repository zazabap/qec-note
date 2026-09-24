// pauli.js — Pauli algebra in the binary symplectic representation.
//
// An n-qubit Pauli operator (up to phase) is two bit vectors x, z of length n.
// Qubit i carries I if (x_i, z_i) = (0,0), X if (1,0), Z if (0,1), Y if (1,1).
// Two Paulis commute exactly when their symplectic inner product
//     sum_i (x_i z'_i + z_i x'_i)  (mod 2)
// is zero. Syndromes, logical action and distance are all commutation
// questions, so this module never touches a state vector and scales to the
// large codes (CSS, qLDPC) planned for later parts of the notes.
//
// Adapted from the author's qec-notes project (MIT).

const OPS = ['I', 'X', 'Z', 'Y'];               // index = x + 2z
const SUB = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];

export function subscript(i) {
  return String(i).split('').map((d) => SUB[+d]).join('');
}

export class Pauli {
  constructor(n, x, z) {
    this.n = n;
    this.x = x ?? new Uint8Array(n);
    this.z = z ?? new Uint8Array(n);
  }

  static identity(n) {
    return new Pauli(n);
  }

  /** Single-qubit operator `kind` ('X', 'Y' or 'Z') on qubit i (0-based). */
  static single(n, i, kind) {
    return Pauli.identity(n).set(i, kind);
  }

  /**
   * Parse 'XIZ' (one letter per qubit) or the labelled 1-based form 'X1Z3'
   * (n must be given). Whitespace is ignored.
   */
  static fromString(str, n) {
    const s = str.replace(/\s/g, '');
    if (/^[IXYZ]+$/.test(s) && (n === undefined || s.length === n)) {
      const p = Pauli.identity(s.length);
      for (let i = 0; i < s.length; i++) if (s[i] !== 'I') p.set(i, s[i]);
      return p;
    }
    if (n === undefined) throw new Error(`labelled Pauli '${str}' needs n`);
    const p = Pauli.identity(n);
    const re = /([XYZ])(\d+)/g;
    let m;
    let matched = 0;
    while ((m = re.exec(s))) {
      const i = +m[2] - 1;
      if (i < 0 || i >= n) throw new Error(`qubit index ${m[2]} out of range for n=${n}`);
      p.multiplyAt(i, m[1]);
      matched += m[0].length;
    }
    if (matched !== s.length && s !== 'I' && s !== '') throw new Error(`cannot parse Pauli '${str}'`);
    return p;
  }

  clone() {
    return new Pauli(this.n, this.x.slice(), this.z.slice());
  }

  at(i) {
    return OPS[this.x[i] + 2 * this.z[i]];
  }

  /** Overwrite qubit i with `kind` (mutates, returns this). */
  set(i, kind) {
    switch (kind) {
      case 'I': this.x[i] = 0; this.z[i] = 0; break;
      case 'X': this.x[i] = 1; this.z[i] = 0; break;
      case 'Z': this.x[i] = 0; this.z[i] = 1; break;
      case 'Y': this.x[i] = 1; this.z[i] = 1; break;
      default: throw new Error(`unknown Pauli '${kind}'`);
    }
    return this;
  }

  /** Multiply qubit i by `kind` (mutates, returns this). */
  multiplyAt(i, kind) {
    const q = Pauli.single(1, 0, kind);
    this.x[i] ^= q.x[0];
    this.z[i] ^= q.z[0];
    return this;
  }

  weight() {
    let w = 0;
    for (let i = 0; i < this.n; i++) if (this.x[i] | this.z[i]) w++;
    return w;
  }

  /** Indices of the qubits the operator acts on non-trivially. */
  support() {
    const s = [];
    for (let i = 0; i < this.n; i++) if (this.x[i] | this.z[i]) s.push(i);
    return s;
  }

  isIdentity() {
    return this.weight() === 0;
  }

  /** Symplectic inner product; 0 = commute, 1 = anticommute. */
  symplectic(other) {
    if (other.n !== this.n) throw new Error('qubit count mismatch');
    let acc = 0;
    for (let i = 0; i < this.n; i++) acc ^= (this.x[i] & other.z[i]) ^ (this.z[i] & other.x[i]);
    return acc;
  }

  commutes(other) {
    return this.symplectic(other) === 0;
  }

  /** Product (phase ignored). */
  mul(other) {
    const p = new Pauli(this.n);
    for (let i = 0; i < this.n; i++) {
      p.x[i] = this.x[i] ^ other.x[i];
      p.z[i] = this.z[i] ^ other.z[i];
    }
    return p;
  }

  equals(other) {
    if (other.n !== this.n) return false;
    for (let i = 0; i < this.n; i++) if (this.x[i] !== other.x[i] || this.z[i] !== other.z[i]) return false;
    return true;
  }

  /** 'XIZ' form. */
  toString() {
    let s = '';
    for (let i = 0; i < this.n; i++) s += this.at(i);
    return s;
  }

  /** 'X₁Z₃' form with Unicode subscripts, or 'I' for the identity. */
  toLabelled(labels) {
    const parts = [];
    for (let i = 0; i < this.n; i++) {
      const op = this.at(i);
      if (op !== 'I') parts.push(op + (labels ? labels[i] : subscript(i + 1)));
    }
    return parts.length ? parts.join('') : 'I';
  }
}

function toPauli(p, n) {
  return p instanceof Pauli ? p : Pauli.fromString(p, n);
}

/** k-combinations of [0..n) in lexicographic order. */
export function* combinations(n, k, start = 0, prefix = []) {
  if (prefix.length === k) { yield prefix.slice(); return; }
  for (let i = start; i <= n - (k - prefix.length); i++) {
    prefix.push(i);
    yield* combinations(n, k, i + 1, prefix);
    prefix.pop();
  }
}

export class StabilizerCode {
  /**
   * @param {object} spec
   * @param {string} spec.name         human-readable name
   * @param {number} spec.n            number of physical qubits
   * @param {Array}  spec.stabilizers  generators, as Pauli or strings
   * @param {Array}  spec.logicals     [{X, Z}] per logical qubit, Pauli or strings
   * @param {Array}  [spec.labels]     display label per qubit (default ₁..ₙ)
   * @param {string} [spec.description]
   */
  constructor(spec) {
    this.name = spec.name;
    this.n = spec.n;
    this.stabilizers = spec.stabilizers.map((s) => toPauli(s, this.n));
    this.logicals = (spec.logicals ?? []).map((l) => ({ X: toPauli(l.X, this.n), Z: toPauli(l.Z, this.n) }));
    this.labels = spec.labels ?? Array.from({ length: this.n }, (_, i) => subscript(i + 1));
    this.description = spec.description ?? '';
    this.extra = spec.extra ?? {};
    this.verify();
  }

  get k() {
    return this.n - this.stabilizers.length;
  }

  /** Throws if the generators do not commute or the logical basis is malformed. */
  verify() {
    const S = this.stabilizers;
    for (let a = 0; a < S.length; a++) {
      for (let b = a + 1; b < S.length; b++) {
        if (!S[a].commutes(S[b])) throw new Error(`stabilizers ${a} and ${b} anticommute`);
      }
    }
    this.logicals.forEach((l, j) => {
      for (const op of ['X', 'Z']) {
        S.forEach((s, a) => {
          if (!l[op].commutes(s)) throw new Error(`logical ${op}${j + 1} anticommutes with stabilizer ${a}`);
        });
      }
      if (l.X.commutes(l.Z)) throw new Error(`logical X${j + 1} and Z${j + 1} commute`);
    });
    if (this.logicals.length && this.logicals.length !== this.k) {
      throw new Error(`expected ${this.k} logical qubits, got ${this.logicals.length}`);
    }
  }

  /** Syndrome bits: 1 where the error anticommutes with the generator. */
  syndrome(error) {
    const e = toPauli(error, this.n);
    return Uint8Array.from(this.stabilizers, (s) => s.symplectic(e));
  }

  syndromeString(error) {
    return Array.from(this.syndrome(error)).join('');
  }

  /**
   * How an error acts on the code space.
   *   detectable  — non-zero syndrome
   *   identity    — no error
   *   stabilizer  — zero syndrome and commutes with every logical operator
   *   logical     — zero syndrome but anticommutes with some logical operator
   * For a logical error, `action` lists the logical Pauli it implements.
   */
  classify(error) {
    const e = toPauli(error, this.n);
    const syndrome = this.syndrome(e);
    if (syndrome.some((b) => b === 1)) return { kind: 'detectable', syndrome, action: [] };
    if (e.isIdentity()) return { kind: 'identity', syndrome, action: [] };
    const action = [];
    this.logicals.forEach((l, j) => {
      const hasX = !e.commutes(l.Z);   // anticommuting with Z̄ means it flips the logical bit
      const hasZ = !e.commutes(l.X);
      const sub = this.logicals.length > 1 ? subscript(j + 1) : '';
      if (hasX && hasZ) action.push('Ȳ' + sub);
      else if (hasX) action.push('X̄' + sub);
      else if (hasZ) action.push('Z̄' + sub);
    });
    return { kind: action.length ? 'logical' : 'stabilizer', syndrome, action };
  }

  /** Every error built from the given kinds on up to `maxWeight` qubits, lightest first. */
  errorTable(kinds = ['X'], maxWeight = this.n) {
    const rows = [];
    for (let w = 0; w <= maxWeight; w++) {
      for (const qubits of combinations(this.n, w)) {
        const total = kinds.length ** w;
        for (let code = 0; code < total; code++) {
          const error = Pauli.identity(this.n);
          let c = code;
          for (const q of qubits) { error.set(q, kinds[c % kinds.length]); c = Math.floor(c / kinds.length); }
          rows.push({ error, label: error.toLabelled(this.labels), syndrome: this.syndromeString(error), weight: w });
        }
      }
    }
    return rows;
  }

  /** Syndromes of every single-qubit error, grouped by kind (X₁…Xₙ, then Z₁…Zₙ, …) as in the paper's tables. */
  singleQubitTable(kinds = ['X', 'Z', 'Y']) {
    const rows = [];
    for (const kind of kinds) {
      for (let i = 0; i < this.n; i++) {
        const error = Pauli.single(this.n, i, kind);
        rows.push({ error, label: error.toLabelled(this.labels), syndrome: this.syndromeString(error), weight: 1 });
      }
    }
    return rows;
  }

  /**
   * A lightest error with the given syndrome, built from `kinds`, searching
   * up to `maxWeight`. Used to name the error space a syndrome points to.
   */
  lightestWithSyndrome(syndrome, kinds = ['X', 'Z', 'Y'], maxWeight = Math.min(this.n, 3)) {
    this._lightest ??= new Map();
    const key = syndrome + '|' + kinds.join('');
    if (this._lightest.has(key)) return this._lightest.get(key);
    let found = null;
    if (!/1/.test(syndrome)) found = Pauli.identity(this.n);
    for (let w = 1; !found && w <= maxWeight; w++) {
      for (const qubits of combinations(this.n, w)) {
        const total = kinds.length ** w;
        for (let code = 0; code < total && !found; code++) {
          const e = Pauli.identity(this.n);
          let c = code;
          for (const q of qubits) { e.set(q, kinds[c % kinds.length]); c = Math.floor(c / kinds.length); }
          if (this.syndromeString(e) === syndrome) found = e;
        }
        if (found) break;
      }
    }
    this._lightest.set(key, found);
    return found;
  }

  /**
   * Lookup-table decoder built from single-qubit errors of the given kinds:
   * a Map from syndrome string to the (first) matching Pauli.
   */
  lookupDecoder(kinds = ['X', 'Z', 'Y']) {
    const table = new Map();
    table.set('0'.repeat(this.stabilizers.length), Pauli.identity(this.n));
    for (const row of this.singleQubitTable(kinds)) {
      if (!table.has(row.syndrome)) table.set(row.syndrome, row.error);
    }
    return table;
  }

  /**
   * Minimum weight of an undetectable error, built from `kinds`, that is not a
   * stabilizer: found by exhaustive search up to `maxWeight`. Returns null if
   * none is found. With kinds = ['X'] this is the distance against bit flips
   * alone; with all three Paulis it is the quantum code distance.
   */
  distance(kinds = ['X', 'Y', 'Z'], maxWeight = Math.min(this.n, 4)) {
    for (let w = 1; w <= maxWeight; w++) {
      for (const qubits of combinations(this.n, w)) {
        const total = kinds.length ** w;
        for (let code = 0; code < total; code++) {
          const e = Pauli.identity(this.n);
          let c = code;
          for (const q of qubits) { e.set(q, kinds[c % kinds.length]); c = Math.floor(c / kinds.length); }
          if (this.classify(e).kind === 'logical') return w;
        }
      }
    }
    return null;
  }

  /** '[[n, k, d]]' with d found by search, or '?' if the search gave up. */
  params() {
    const d = this.distance();
    return `[[${this.n}, ${this.k}, ${d ?? '?'}]]`;
  }
}
