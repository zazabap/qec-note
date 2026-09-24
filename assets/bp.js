// bp.js — min-sum belief propagation for syndrome decoding.
//
// Decodes one error type of a CSS code: X errors are found from the Z-check
// syndrome s = H_Z e, Z errors from the X-check syndrome. Each qubit starts
// with the log-likelihood ratio L₀ = log((1 − p)/p) of "no flip"; checks and
// qubits then exchange messages along the Tanner graph until the hard
// decision reproduces the syndrome or the iteration budget runs out.

/**
 * @param {Uint8Array[]} H  parity-check matrix (rows are checks)
 * @param {Uint8Array} s    syndrome, one bit per row of H
 * @param {number} p        prior flip probability per qubit
 * @returns {{converged: boolean, iterations: number, history: {L: Float64Array, e: Uint8Array}[]}}
 *          history[t] is the state after iteration t + 1: posterior LLRs and hard decision.
 */
export function minSumBP(H, s, p, { maxIter = 30, alpha = 0.75 } = {}) {
  const m = H.length, n = H.length ? H[0].length : 0;
  const rows = H.map((r) => { const out = []; r.forEach((x, j) => { if (x) out.push(j); }); return out; });
  const colChecks = Array.from({ length: n }, () => []);
  rows.forEach((r, c) => r.forEach((v, idx) => colChecks[v].push([c, idx])));
  const L0 = Math.log((1 - p) / p);
  const q = rows.map((r) => new Float64Array(r.length).fill(L0));   // qubit → check
  const r = rows.map((row) => new Float64Array(row.length));          // check → qubit
  const history = [];
  for (let it = 1; it <= maxIter; it++) {
    for (let c = 0; c < m; c++) {
      const msgs = q[c];
      let sign = s[c] ? -1 : 1, min1 = Infinity, min2 = Infinity, argmin = -1;
      for (let i = 0; i < msgs.length; i++) {
        const v = msgs[i];
        if (v < 0) sign = -sign;
        const a = Math.abs(v);
        if (a < min1) { min2 = min1; min1 = a; argmin = i; } else if (a < min2) min2 = a;
      }
      for (let i = 0; i < msgs.length; i++) {
        const own = msgs[i] < 0 ? -1 : 1;
        r[c][i] = alpha * sign * own * (i === argmin ? min2 : min1);
      }
    }
    const L = new Float64Array(n).fill(L0);
    for (let v = 0; v < n; v++) for (const [c, i] of colChecks[v]) L[v] += r[c][i];
    for (let c = 0; c < m; c++) rows[c].forEach((v, i) => { q[c][i] = L[v] - r[c][i]; });
    const e = Uint8Array.from(L, (x) => (x < 0 ? 1 : 0));
    history.push({ L, e });
    let ok = true;
    for (let c = 0; c < m && ok; c++) { let par = 0; for (const v of rows[c]) par ^= e[v]; if (par !== s[c]) ok = false; }
    if (ok) return { converged: true, iterations: it, history };
  }
  return { converged: false, iterations: maxIter, history };
}

/** Posterior probability of a flip from an LLR. */
export const flipProbability = (L) => 1 / (1 + Math.exp(L));
