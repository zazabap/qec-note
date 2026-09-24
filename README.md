# Notes on quantum error correction

Interactive notes on quantum error correction, served at
<https://zazabap.github.io/qec-note/>.

| Note | Topic |
|---|---|
| [01-quantum-redundancy.html](01-quantum-redundancy.html) | Quantum redundancy and stabilizer measurement ([Roffe](https://arxiv.org/abs/1907.11157), §3) |
| [02-stabilizer-formalism.html](02-stabilizer-formalism.html) | The stabilizer formalism and the [[4,2,2]] code (Roffe, §4–4.4) |
| [03-shor-code.html](03-shor-code.html) | Correcting errors: the Shor code (Roffe, §4.5–4.6) |

Plain HTML with ES-module widgets in `assets/`. There is no build step.

```sh
tools/serve.sh    # view locally at http://localhost:8000/
node --test       # run the tests
```

Code is under the MIT licence and text under CC BY 4.0. See `LICENSE`.
