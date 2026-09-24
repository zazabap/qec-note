// state.js — a small real-amplitude state vector, for pictures of subspaces.
//
// Everything in part 1 of the notes (repetition codes, X and Z errors, the
// encoder, the syndrome-extraction circuit, the coherent bit-flip error of
// Roffe's eq. 20) can be written with real amplitudes, so this module keeps a
// Float64Array of 2^N amplitudes and nothing else. It is meant for N ≤ 6 or so:
// the point is to *show* the amplitudes moving between the codespace and the
// error spaces, not to simulate anything large. Syndromes and distances for
// bigger codes come from pauli.js, which never builds a state.
//
// Qubit 0 is the most significant bit, so basis index i is the bit string
// |q₀ q₁ … q_{N−1}⟩ read left to right, matching the kets in the paper.

export class State {
  constructor(n, amps) {
    this.n = n;
    this.a = amps ?? (() => { const v = new Float64Array(1 << n); v[0] = 1; return v; })();
    if (this.a.length !== 1 << n) throw new Error('amplitude length mismatch');
  }

  /** |q₀ q₁ …⟩ for a bit string such as '011'. */
  static basis(bits) {
    const s = new State(bits.length);
    s.a[0] = 0;
    s.a[parseInt(bits, 2)] = 1;
    return s;
  }

  /** Single qubit α|0⟩ + β|1⟩ (real α, β). */
  static single(alpha, beta) {
    const s = new State(1);
    s.a[0] = alpha;
    s.a[1] = beta;
    return s;
  }

  /** cos(θ/2)|0⟩ + sin(θ/2)|1⟩, the real great circle of the Bloch sphere. */
  static fromAngle(theta) {
    return State.single(Math.cos(theta / 2), Math.sin(theta / 2));
  }

  /** Tensor product, first factor most significant. */
  static product(...states) {
    return states.reduce((acc, s) => acc.tensor(s));
  }

  clone() {
    return new State(this.n, this.a.slice());
  }

  get dim() {
    return this.a.length;
  }

  mask(q) {
    if (q < 0 || q >= this.n) throw new Error(`qubit ${q} out of range`);
    return 1 << (this.n - 1 - q);
  }

  bit(i, q) {
    return (i & this.mask(q)) ? 1 : 0;
  }

  tensor(other) {
    const out = new State(this.n + other.n, new Float64Array(this.dim * other.dim));
    for (let i = 0; i < this.dim; i++) {
      if (this.a[i] === 0) continue;
      for (let j = 0; j < other.dim; j++) out.a[i * other.dim + j] = this.a[i] * other.a[j];
    }
    return out;
  }

  /* ----------------------------------------------------------- gates */

  /** Apply the real 2×2 matrix [[m00, m01], [m10, m11]] to qubit q. Mutates. */
  linear(q, [[m00, m01], [m10, m11]]) {
    const m = this.mask(q);
    for (let i = 0; i < this.dim; i++) {
      if (i & m) continue;                   // visit each pair once, from its |0⟩ member
      const j = i | m;
      const a0 = this.a[i], a1 = this.a[j];
      this.a[i] = m00 * a0 + m01 * a1;
      this.a[j] = m10 * a0 + m11 * a1;
    }
    return this;
  }

  x(q) { return this.linear(q, [[0, 1], [1, 0]]); }
  z(q) { return this.linear(q, [[1, 0], [0, -1]]); }
  h(q) { const r = Math.SQRT1_2; return this.linear(q, [[r, r], [r, -r]]); }

  /** CNOT with control c and target t. */
  cnot(c, t) {
    const mc = this.mask(c), mt = this.mask(t);
    for (let i = 0; i < this.dim; i++) {
      if ((i & mc) && !(i & mt)) {
        const j = i | mt;
        const tmp = this.a[i]; this.a[i] = this.a[j]; this.a[j] = tmp;
      }
    }
    return this;
  }

  /** Controlled-Z between qubits c and t (symmetric). */
  cz(c, t) {
    const mc = this.mask(c), mt = this.mask(t);
    for (let i = 0; i < this.dim; i++) if ((i & mc) && (i & mt)) this.a[i] = -this.a[i];
    return this;
  }

  /**
   * Apply a Pauli string made of X and Z (Y needs complex phases and is not
   * used in part 1). `pauli` is a Pauli from pauli.js acting on qubits
   * offset … offset+pauli.n−1 of this state.
   */
  applyPauli(pauli, offset = 0) {
    for (let i = 0; i < pauli.n; i++) {
      const op = pauli.at(i);
      if (op === 'Y') throw new Error('Y needs complex amplitudes');
      if (op === 'X') this.x(offset + i);
      if (op === 'Z') this.z(offset + i);
    }
    return this;
  }

  /**
   * Apply a Pauli string, with Y applied as Z·X. Z·X = iY, so the result is
   * the true Y-error state up to a global phase, which no measurement sees.
   * This keeps every amplitude real.
   */
  applyPauliUpToPhase(pauli, offset = 0) {
    for (let i = 0; i < pauli.n; i++) {
      const op = pauli.at(i);
      if (op === 'X' || op === 'Y') this.x(offset + i);
      if (op === 'Z' || op === 'Y') this.z(offset + i);
    }
    return this;
  }

  /** (𝟙 + P)|ψ⟩, unnormalised: the projection onto P's +1 eigenspace, times two. */
  projectPlus(pauli) {
    const moved = this.clone().applyPauliUpToPhase(pauli);
    for (let i = 0; i < this.dim; i++) this.a[i] += moved.a[i];
    return this;
  }

  /** ⟨ψ|P|ψ⟩ for a Pauli made of X and Z (real). */
  expect(pauli) {
    return this.overlap(this.clone().applyPauliUpToPhase(pauli));
  }

  /**
   * The controlled version of a Pauli string, controlled on qubit `control`:
   * controlled-Z for each Z in the string and controlled-X (CNOT) for each X.
   * This is the middle of the syndrome-extraction circuit in Roffe's figures 2–4.
   */
  controlledPauli(control, pauli, offset = 0) {
    for (let i = 0; i < pauli.n; i++) {
      const op = pauli.at(i);
      if (op === 'Y') throw new Error('Y needs complex amplitudes');
      if (op === 'Z') this.cz(control, offset + i);
      if (op === 'X') this.cnot(control, offset + i);
    }
    return this;
  }

  /**
   * The coherent bit-flip error of Roffe's eq. 20, E = √(1−p)·𝟙 + √p·X, applied
   * to qubit q *as written*: a real linear map, not a unitary. Call normalize()
   * afterwards. (The unitary e^{−iφX} with sin²φ = p gives the same branch
   * probabilities for the states used here and needs complex amplitudes.)
   */
  coherentBitFlip(q, p) {
    const aI = Math.sqrt(1 - p), aX = Math.sqrt(p);
    return this.linear(q, [[aI, aX], [aX, aI]]);
  }

  /* ----------------------------------------------------- measurement */

  norm2() {
    let s = 0;
    for (let i = 0; i < this.dim; i++) s += this.a[i] * this.a[i];
    return s;
  }

  normalize() {
    const n = Math.sqrt(this.norm2());
    if (n > 0) for (let i = 0; i < this.dim; i++) this.a[i] /= n;
    return this;
  }

  probabilities() {
    return Float64Array.from(this.a, (v) => v * v);
  }

  /** ⟨ψ| Π_{q∈qubits} Z_q |ψ⟩ for a normalised state. */
  expectZ(qubits) {
    let mask = 0;
    for (const q of qubits) mask |= this.mask(q);
    let s = 0;
    for (let i = 0; i < this.dim; i++) {
      const parity = popcount(i & mask) & 1;
      s += (parity ? -1 : 1) * this.a[i] * this.a[i];
    }
    return s;
  }

  /** Real inner product ⟨other|this⟩. */
  overlap(other) {
    if (other.n !== this.n) throw new Error('qubit count mismatch');
    let s = 0;
    for (let i = 0; i < this.dim; i++) s += this.a[i] * other.a[i];
    return s;
  }

  fidelity(other) {
    const o = this.overlap(other);
    return o * o;
  }

  /**
   * Split the state by the values of `qubits` (as if they were about to be
   * measured). Returns one entry per outcome, in binary order:
   *   { bits, prob, state }  with `state` the normalised conditional state of
   * the *remaining* qubits (in their original order), or null if prob = 0.
   */
  branches(qubits) {
    const rest = [];
    for (let q = 0; q < this.n; q++) if (!qubits.includes(q)) rest.push(q);
    const outcomes = [];
    for (let b = 0; b < 1 << qubits.length; b++) {
      const amps = new Float64Array(1 << rest.length);
      let prob = 0;
      for (let i = 0; i < this.dim; i++) {
        let match = true;
        qubits.forEach((q, k) => { if (this.bit(i, q) !== ((b >> (qubits.length - 1 - k)) & 1)) match = false; });
        if (!match) continue;
        let r = 0;
        rest.forEach((q, k) => { r |= this.bit(i, q) << (rest.length - 1 - k); });
        amps[r] = this.a[i];
        prob += this.a[i] * this.a[i];
      }
      const bits = b.toString(2).padStart(qubits.length, '0');
      outcomes.push({ bits, prob, state: prob > 1e-12 ? new State(rest.length, amps).normalize() : null });
    }
    return outcomes;
  }

  /** Choose an outcome for `qubits` by the Born rule. */
  sample(qubits, random = Math.random) {
    const br = this.branches(qubits);
    let r = random();
    for (const o of br) { r -= o.prob; if (r <= 0) return o.bits; }
    return br[br.length - 1].bits;
  }

  /** Project onto `qubits` = bits and renormalise. Returns the outcome probability. */
  collapse(qubits, bits) {
    let prob = 0;
    for (let i = 0; i < this.dim; i++) {
      let match = true;
      qubits.forEach((q, k) => { if (this.bit(i, q) !== +bits[k]) match = false; });
      if (match) prob += this.a[i] * this.a[i];
      else this.a[i] = 0;
    }
    this.normalize();
    return prob;
  }

  /** '0.800|000⟩ + 0.600|111⟩' */
  toString(digits = 3) {
    const parts = [];
    for (let i = 0; i < this.dim; i++) {
      if (Math.abs(this.a[i]) < 1e-9) continue;
      const v = this.a[i];
      const ket = '|' + i.toString(2).padStart(this.n, '0') + '⟩';
      parts.push((parts.length ? (v < 0 ? ' − ' : ' + ') : (v < 0 ? '−' : '')) + Math.abs(v).toFixed(digits) + ket);
    }
    return parts.length ? parts.join('') : '0';
  }
}

function popcount(v) {
  let c = 0;
  while (v) { v &= v - 1; c++; }
  return c;
}

/* ------------------------------------------------------------ codes */

/** Run a code's encoder (from code.extra.encoder) on |ψ⟩ ⊗ |0…0⟩. */
export function encode(code, psi) {
  let s = State.product(psi, new State(code.n - 1));
  for (const g of code.extra.encoder ?? []) {
    if (g.gate === 'cnot') s = s.cnot(g.control, g.target);
    else if (g.gate === 'h') s = s.h(g.target);
    else throw new Error(`unknown encoder gate ${g.gate}`);
  }
  return s;
}

/** The logical codewords |0⟩_L and |1⟩_L, and |+⟩_L, |−⟩_L. */
export function codewords(code) {
  const zero = encode(code, State.single(1, 0));
  const one = encode(code, State.single(0, 1));
  const plus = encode(code, State.single(Math.SQRT1_2, Math.SQRT1_2));
  const minus = encode(code, State.single(Math.SQRT1_2, -Math.SQRT1_2));
  return { zero, one, plus, minus };
}

/**
 * The logical basis |j⟩ᴸ, j = 0 … 2^k − 1, of any stabilizer code whose
 * generators and logical operators are made of X and Z.
 *
 * |0…0⟩ᴸ is the projection of a computational basis state onto the +1
 * eigenspace of every generator *and every logical Z̄* (eq. 34 projects onto
 * the generators only, which fixes the logical value only when every Z̄ can be
 * written with Z operators; for the Shor code it cannot). The first basis
 * state with a non-zero projection is used, so the phase convention is the
 * paper's: |0…0⟩ᴸ has positive amplitudes on |0…0⟩ when possible. Then
 * |j⟩ᴸ = X̄₁^j₁ ⋯ X̄ₖ^jₖ |0…0⟩ᴸ, with j₁ the most significant bit.
 */
export function logicalBasis(code) {
  if (code._logicalBasis) return code._logicalBasis;
  const n = code.n, k = code.logicals.length;
  const projectors = [...code.stabilizers, ...code.logicals.map((l) => l.Z)];
  let zero = null;
  for (let x = 0; x < 1 << n && !zero; x++) {
    const s = new State(n); s.a[0] = 0; s.a[x] = 1;
    for (const P of projectors) s.projectPlus(P);
    if (s.norm2() > 1e-9) zero = s.normalize();
  }
  const basis = [];
  for (let j = 0; j < 1 << k; j++) {
    const v = zero.clone();
    for (let b = 0; b < k; b++) if ((j >> (k - 1 - b)) & 1) v.applyPauliUpToPhase(code.logicals[b].X);
    basis.push(v);
  }
  code._logicalBasis = basis;
  return basis;
}

/** Σⱼ cⱼ|j⟩ᴸ for real coefficients c (normalised). */
export function encodeLogical(code, coeffs) {
  const basis = logicalBasis(code);
  const s = new State(code.n, new Float64Array(1 << code.n));
  coeffs.forEach((c, j) => { for (let i = 0; i < s.dim; i++) s.a[i] += c * basis[j].a[i]; });
  return s.normalize();
}

/**
 * Which subspace of the n-qubit Hilbert space each basis state belongs to,
 * labelled by the stabilizer eigenvalues it has (equivalently, the syndrome
 * an error must produce to reach it). For the three-qubit code this is
 * Roffe's partition C, F₁, F₂, F₃ of eq. 25. Returns
 *   { groups: [{ syndrome, label, members: [basis index…] }], of: [group index per basis state] }
 * with the codespace first and the error spaces ordered by the qubit whose
 * single X error reaches them.
 */
export function subspaces(code) {
  const n = code.n;
  const zGens = code.stabilizers.map((s) => {
    let mask = 0;
    for (let i = 0; i < n; i++) if (s.at(i) === 'Z') mask |= 1 << (n - 1 - i);
    return mask;
  });
  const bySyndrome = new Map();
  for (let i = 0; i < 1 << n; i++) {
    const syn = zGens.map((m) => (popcount(i & m) & 1)).join('');
    if (!bySyndrome.has(syn)) bySyndrome.set(syn, []);
    bySyndrome.get(syn).push(i);
  }
  const single = code.singleQubitTable(['X']);       // syndrome of X_i, in qubit order
  const groups = [];
  const order = ['0'.repeat(zGens.length), ...single.map((r) => r.syndrome).filter((s, k, a) => a.indexOf(s) === k)];
  for (const syn of bySyndrome.keys()) if (!order.includes(syn)) order.push(syn);
  for (const syn of order) {
    if (!bySyndrome.has(syn)) continue;
    const reached = single.filter((r) => r.syndrome === syn).map((r) => r.error.support()[0] + 1);
    let label;
    if (!/1/.test(syn)) label = 'C';
    else if (reached.length === 1) label = 'F' + SUBS(reached[0]);
    else if (reached.length > 1) label = 'F';
    else label = 'F' + syn;
    groups.push({ syndrome: syn, label, members: bySyndrome.get(syn), reached });
  }
  const of = new Array(1 << n);
  groups.forEach((g, k) => g.members.forEach((i) => { of[i] = k; }));
  return { groups, of };
}

const SUB_DIGITS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
function SUBS(i) { return String(i).split('').map((d) => SUB_DIGITS[+d]).join(''); }
