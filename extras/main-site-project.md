---
title: Notes on Quantum Error Correction
description: A companion to Roffe's introductory guide in which the amplitudes, subspaces and syndrome circuits respond as you apply errors
importance: 4
math: true
---

## Overview

[Notes on quantum error correction](/qec-note/) follow Joschka Roffe's
[*Quantum error correction: an introductory guide*](https://arxiv.org/abs/1907.11157)
(Contemporary Physics, 2019) one section at a time. Every code in them is
small enough to draw, so each part draws it: the amplitudes of the encoded
state as bars grouped by subspace, the stabilizer meters reading $$+1$$ or
$$-1$$, and the syndrome-extraction circuit stepped one gate at a time.

Part 1, [Quantum redundancy and stabilizer measurement](/qec-note/01-quantum-redundancy.html),
covers the paper's section 3: the two- and three-qubit codes, the codespace
and error spaces, the ancilla circuit, error suppression by detection alone,
and why the three-qubit code has quantum distance 1. Parts on stabilizer
codes, CSS codes and quantum LDPC codes are planned.

## How it is built

- Plain HTML, one stylesheet, four small JavaScript modules; no framework
  and no build step. The notes live in their own repository and are included
  here as a git submodule.
- Two engines: a real-amplitude state vector for the pictures (at most a few
  qubits), and the binary symplectic representation of Pauli operators for
  syndromes, logical actions and distances, which keeps working for large codes.
- The algebra is tested against the paper's tables and equations with `node --test`.

## Links

- **Read the notes:** [zazabap.github.io/qec-note](/qec-note/)
- **Source:** [github.com/zazabap/qec-note](https://github.com/zazabap/qec-note)
- **The paper:** [arXiv:1907.11157](https://arxiv.org/abs/1907.11157)
