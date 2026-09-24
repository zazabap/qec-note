# Notes on quantum error correction

Companion notes to Joschka Roffe, *Quantum error correction: an introductory
guide*, Contemporary Physics 60, 226 (2019),
[arXiv:1907.11157](https://arxiv.org/abs/1907.11157), one part per section
of the paper, with interactive pictures of the amplitudes, the subspaces and
the syndrome circuits.

- `index.html` — contents, notation, how the figures work.
- `01-stabilizer-measurement.html` — **Part 1: Quantum redundancy and
  stabilizer measurement** (paper §3): the two- and three-qubit codes,
  codespace and error spaces, the syndrome-extraction circuit stepped gate by
  gate, error suppression by detection (eq. 20–24), and the code distance.
- Planned: stabilizer codes (§4), CSS codes, quantum LDPC codes.

Live at <https://zazabap.github.io/qec-note/> once the submodule is wired
into the main site (below).

## How it is built

Plain HTML, one stylesheet, four ES modules. No framework, no build step, no
dependencies. MathJax is loaded from cdnjs and renders to SVG.

To view locally, serve the folder over HTTP (Chrome will not load ES modules
from `file://`; Firefox will):

```sh
tools/serve.sh            # http://localhost:8000/   (PORT=8080 tools/serve.sh for another port)
```

In VS Code with a dev container or Remote SSH, the port is forwarded
automatically; open it from the Ports panel. The Live Preview or Live Server
extensions work too, since both serve over HTTP.

```
index.html                     contents page
01-stabilizer-measurement.html part 1
assets/qec.css                 site and widget styles (single light theme, black on white)
assets/pauli.js                Pauli algebra in the binary symplectic representation:
                               syndromes, logical action, lookup decoder, distance search
assets/codes.js                catalogue of codes (repetition codes for now)
assets/state.js                real-amplitude state vector for N ≤ ~6 qubits: gates,
                               controlled Pauli strings, branches by ancilla value
assets/widgets.js              the figures, as Web Components
test/                          node:test suites against the paper's tables and equations
tools/serve.sh                 serves the folder on http://localhost:8000/ for local viewing
tools/build-artifact.py        bundles a page into one self-contained HTML file
extras/main-site-project.md    project page for the main site's _projects/ collection
```

### Widgets

A figure is a tag in the page:

```html
<qec-state-view code="three-qubit" allowed="XZ" decoder logical theta="1.5708" label="G"></qec-state-view>
<qec-circuit code="two-qubit" coherent decoder label="B"></qec-circuit>
<qec-suppression p="0.1" label="C"></qec-suppression>
<qec-syndrome-table code="three-qubit" errors="X" label="E"></qec-syndrome-table>
```

| Element | What it shows | Attributes |
|---|---|---|
| `qec-state-view` | Qubits to click, stabilizer meters, and the amplitudes as signed bars grouped into the codespace `C` and error spaces `F_i` | `code`, `allowed` (`X`, `XZ`), `decoder`, `logical` (overlap table and X̄/Z̄ buttons), `theta` (input state angle), `initial` (error string) |
| `qec-circuit` | Encoder, error stage and syndrome extraction stepped gate by gate; the data register split by ancilla value; Born-rule measurement; optional recovery | `code`, `coherent` (offer eq. 20), `decoder`, `theta`, `error` |
| `qec-suppression` | The four terms of eq. 21 and the plot of eq. 24 against the unencoded error rate | `p` |
| `qec-syndrome-table` | Every error pattern, its syndrome and what the decoder does | `code`, `errors` |

Codes available by name: `two-qubit`, `three-qubit`, `repetition:n`.
Qubit numbering, generator order and logical operators follow the paper.

Two engines share the work. `state.js` keeps a real state vector, which is
enough for everything in part 1 and is what makes the bars honest; it is only
for small codes. `pauli.js` works in the binary symplectic representation and
never builds a state, so syndromes, logical actions and distances keep working
for the CSS and qLDPC codes of later parts.

### Tests

```sh
node --test          # Node 20 or later, no dependencies
```

The suites check the two engines against the paper: table 1, table 2, the
partition of eq. 25, eq. 24 for the coherent error, eq. 28 for the phase flip,
and the distances 3 (bit flips only) and 1 (all Paulis) of the three-qubit code.

## Using the notes as a submodule of the main site

The main site (`zazabap.github.io`) is plain Jekyll. Jekyll copies files that
have no front matter through untouched, and none of the files here have any,
so the notes can live in the site as a submodule and be served under
`/qec-note/` without touching the site's layouts or configuration.

1. Create the repository and push (once):

   ```sh
   gh repo create zazabap/qec-note --public --source=. --push
   ```

2. In the main site, add the submodule and let the deploy workflow fetch it:

   ```sh
   cd zazabap.github.io
   git submodule add https://github.com/zazabap/qec-note.git qec-note
   ```

   In `.github/workflows/deploy.yml`, give the checkout step the submodules:

   ```yaml
   - uses: actions/checkout@v4
     with:
       submodules: true
   ```

   Use the `https://` URL for the submodule (not `git@github.com:`) so the
   Actions runner can fetch it without credentials.

3. Optionally keep the submodule's own housekeeping out of the built site by
   adding to the main `_config.yml`:

   ```yaml
   exclude:
     - qec-note/README.md
     - qec-note/LICENSE
     - qec-note/package.json
     - qec-note/test
     - qec-note/tools
     - qec-note/extras
   ```

4. Optionally add a project page: copy `extras/main-site-project.md` into the
   main site's `_projects/`.

5. To pull a newer version of the notes into the site later:

   ```sh
   git submodule update --remote qec-note && git commit -am "Update qec-note"
   ```

## Publishing one page as a single file

`python3 tools/build-artifact.py` writes `dist/artifact.html`, a copy of
part 1 with the stylesheet and modules inlined and relative links pointed at
the live site. It is what was used to publish the page as a claude.ai
artifact; the site itself never needs it.

## Adding a part

Copy `01-stabilizer-measurement.html`, keep the `<head>`, write the prose,
and drop widget tags where the pictures go. New codes go in `assets/codes.js`
as `StabilizerCode` specs; if a code needs its own picture (a lattice, a
Tanner graph), add a component in `assets/widgets.js`. Add the part to the
list in `index.html`.

## Licence

Code under the MIT licence; the text of the notes under CC BY 4.0. See `LICENSE`.
