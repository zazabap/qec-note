#!/usr/bin/env python3
"""Draw the static Tanner-graph diagrams of part 2.5 and write them into the page.

    python3 tools/tanner-figures.py            # rewrites 02b-tanner-graphs.html in place

Each figure lives between <!-- fig:N start --> and <!-- fig:N end --> markers;
everything between the markers is replaced. The drawings use the .tgs classes
of assets/qec.css. Qubits and checks are numbered from 1, as in the text.
"""
import pathlib
import re
import math

ROOT = pathlib.Path(__file__).resolve().parents[1]
PAGE = ROOT / '02b-tanner-graphs.html'

HAM = [{4, 5, 6, 7}, {2, 3, 6, 7}, {1, 3, 5, 7}]
REP = [{1, 2}, {2, 3}]
SHOR_Z = [{1, 2}, {2, 3}, {4, 5}, {5, 6}, {7, 8}, {8, 9}]
SHOR_X = [{1, 2, 3, 4, 5, 6}, {4, 5, 6, 7, 8, 9}]

S, PAD, R, SQ = 40, 14, 11, 22          # slot width, padding, circle radius, square side


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;')


def sub(i):
    return ''.join('₀₁₂₃₄₅₆₇₈₉'[int(c)] for c in str(i))


class Panel:
    """Collects SVG elements in layers: faces, edges, emphasised edges, nodes."""

    def __init__(self, W, H, label):
        self.W, self.H, self.label = W, H, label
        self.layers = {'faces': [], 'edges': [], 'em': [], 'nodes': [], 'text': []}

    def add(self, layer, s):
        self.layers[layer].append(s)

    def edge(self, a, b, cls='edge'):
        self.add('em' if cls != 'edge' else 'edges', f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" class="{cls}"/>')

    def check(self, pos, label, kind='Z', lit=False, em=False):
        x, y = pos
        cls = f'check {kind}{" lit" if lit else ""}{" em" if em else ""}'
        self.add('nodes', f'<rect x="{x - SQ/2:.1f}" y="{y - SQ/2:.1f}" width="{SQ}" height="{SQ}" rx="3" class="{cls}"/>'
                 f'<text x="{x:.1f}" y="{y + 3.5:.1f}" text-anchor="middle" class="clab{" on" if lit else ""}">{label}</text>')

    def qubit(self, pos, label, op='I', em=False):
        x, y = pos
        cls = f'qubit{" " + op if op != "I" else ""}{" em" if em else ""}'
        self.add('nodes', f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{R}" class="{cls}"/>'
                 f'<text x="{x:.1f}" y="{y + 4:.1f}" text-anchor="middle" class="lab{" on" if op != "I" else ""}">{label}</text>')

    def text(self, pos, s, cls='note', anchor='middle'):
        self.add('text', f'<text x="{pos[0]:.1f}" y="{pos[1]:.1f}" text-anchor="{anchor}" class="{cls}">{esc(s)}</text>')

    def svg(self, aria):
        body = ''.join(''.join(self.layers[k]) for k in ('faces', 'edges', 'em', 'nodes', 'text'))
        return (f'<figure class="panel" style="max-width:{self.W}px"><svg viewBox="0 0 {self.W} {self.H}" class="tgs" role="img" aria-label="{esc(aria)}">{body}</svg>'
                f'<figcaption>{self.label}</figcaption></figure>')


def bipartite(n, Z, X=(), *, err=None, zerr=None, em_checks=(), em_qubits=(), ring=(), label='', aria='', classical=False, degrees=False):
    """Qubits in a row, Z (or classical) checks above, X checks below. err / zerr: sets of qubits with X / Z errors."""
    err, zerr = set(err or ()), set(zerr or ())
    slots = max(n, len(Z), len(X))
    W = PAD * 2 + slots * S
    yZ, yQ, yX = 30, 100 if classical else 110, 190
    H = (yX + 30) if X else (yQ + 30)
    if degrees:
        H += 16
    spread = lambda m, y: [(PAD + (i + 0.5) * (W - 2 * PAD) / m, y) for i in range(m)]
    q = {j + 1: p for j, p in enumerate(spread(n, yQ))}
    zc, xc = spread(len(Z), yZ), spread(len(X), yX)
    p = Panel(W, H, label)
    litZ = [len(row & err) % 2 for row in Z]
    litX = [len(row & zerr) % 2 for row in X]
    for i, row in enumerate(Z):
        for j in sorted(row):
            p.edge(zc[i], q[j], 'edge hit-X' if j in err else 'edge')
    for i, row in enumerate(X):
        for j in sorted(row):
            p.edge(xc[i], q[j], 'edge hit-Z' if j in zerr else 'edge')
    for name in em_checks:                       # ('Z', i) 1-based: dashed emphasis on a check's edges
        kind, i = name
        src, rows = (zc, Z) if kind == 'Z' else (xc, X)
        for j in sorted(rows[i - 1]):
            p.edge(src[i - 1], q[j], 'edge em')
    for j in em_qubits:
        for i, row in enumerate(Z):
            if j in row:
                p.edge(zc[i], q[j], 'edge em')
        for i, row in enumerate(X):
            if j in row:
                p.edge(xc[i], q[j], 'edge em')
    for i, row in enumerate(Z):
        p.check(zc[i], f'c{sub(i + 1)}' if classical else f'Z{sub(i + 1)}', 'Z', litZ[i], em=('Z', i + 1) in em_checks)
    for i, row in enumerate(X):
        p.check(xc[i], f'X{sub(i + 1)}', 'X', litX[i], em=('X', i + 1) in em_checks)
    for j in range(1, n + 1):
        op = 'Y' if (j in err and j in zerr) else 'X' if j in err else 'Z' if j in zerr else 'I'
        p.qubit(q[j], str(j), op, em=j in em_qubits or j in ring)
        if degrees:
            deg = sum(j in row for row in Z) + sum(j in row for row in X)
            p.text((q[j][0], yQ + R + 14), f'deg {deg}', 'note')
    if ring:
        for j in ring:
            x, y = q[j]
            p.add('nodes', f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{R + 5}" class="ring"/>')
    return p.svg(aria), W


def matrix_panel(rows, n, *, row_hi=None, col_hi=None, label='', aria=''):
    """A small parity-check matrix drawn as cells, with a row or a column tinted, next to its graph."""
    cell = 24
    W0 = 34 + n * cell + 12
    gW = PAD * 2 + n * S
    W = W0 + gW
    H = max(28 + len(rows) * cell + 14, 140)
    p = Panel(W, H, label)
    for i, row in enumerate(rows):
        y = 28 + i * cell
        p.text((26, y + cell / 2 + 4), f'c{sub(i + 1)}', 'clab', 'end')
        for j in range(1, n + 1):
            x = 34 + (j - 1) * cell
            one = j in row
            cls = 'cell' + (' one' if one else '') + (' hi' if (row_hi == i + 1 or col_hi == j) else '')
            p.add('faces', f'<rect x="{x}" y="{y}" width="{cell}" height="{cell}" class="{cls}"/>'
                           f'<text x="{x + cell/2}" y="{y + cell/2 + 4}" text-anchor="middle" class="mono">{1 if one else 0}</text>')
    for j in range(1, n + 1):
        p.text((34 + (j - 1) * cell + cell / 2, 20), str(j), 'lab')
    # graph to the right
    yZ, yQ = 30, 100
    spread = lambda m, y, x0, w: [(x0 + (i + 0.5) * w / m, y) for i in range(m)]
    q = {j + 1: pt for j, pt in enumerate(spread(n, yQ, W0 + PAD, n * S))}
    zc = spread(len(rows), yZ, W0 + PAD, n * S)
    for i, row in enumerate(rows):
        for j in sorted(row):
            em = (row_hi == i + 1) or (col_hi == j)
            p.edge(zc[i], q[j], 'edge em' if em else 'edge')
    for i, row in enumerate(rows):
        p.check(zc[i], f'c{sub(i + 1)}', 'Z', False, em=row_hi == i + 1)
    for j in range(1, n + 1):
        p.qubit(q[j], str(j), 'I', em=col_hi == j)
    return p.svg(aria), W


def shor_grid(err=(), label='', aria=''):
    u, pad = 58, 26
    err = set(err)
    pos = {q + 1: (pad + (q % 3) * 1.6 * u, pad + (q // 3) * 1.8 * u) for q in range(9)}
    W, H = pad * 2 + 3.2 * u, pad * 2 + 3.6 * u
    p = Panel(W, H, label)
    cen = lambda row: (sum(pos[j][0] for j in row) / len(row), sum(pos[j][1] for j in row) / len(row))
    for i, row in enumerate(SHOR_Z):
        for j in row:
            p.edge(cen(row), pos[j], 'edge hit-X' if j in err else 'edge')
    for i, row in enumerate(SHOR_X):
        for j in row:
            p.edge(cen(row), pos[j], 'edge')
    for i, row in enumerate(SHOR_Z):
        p.check(cen(row), f'Z{sub(i + 1)}', 'Z', len(row & err) % 2 == 1)
    for i, row in enumerate(SHOR_X):
        p.check(cen(row), f'X{sub(i + 1)}', 'X', False)
    for j in range(1, 10):
        p.qubit(pos[j], str(j), 'X' if j in err else 'I')
    return p.svg(aria), W


def steane_faces(err=(), label='', aria='', face_labels=True):
    u, pad = 60, 24
    err = set(err)
    c1, c2, c4, c7 = (1.5, 0), (0, 2.6), (3, 2.6), (1.5, 1.733)
    mid = lambda a, b: ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    raw = [c1, c2, mid(c1, c2), c4, mid(c1, c4), mid(c2, c4), c7]
    pos = {j + 1: (pad + x * u, pad + y * u) for j, (x, y) in enumerate(raw)}
    W, H = pad * 2 + 3 * u, pad * 2 + 2.6 * u
    p = Panel(W, H, label)
    cen = lambda row: (sum(pos[j][0] for j in row) / len(row), sum(pos[j][1] for j in row) / len(row))
    for i, row in enumerate(HAM):
        c = cen(row)
        pts = sorted((pos[j] for j in row), key=lambda q: math.atan2(q[1] - c[1], q[0] - c[0]))
        lit = len(row & err) % 2 == 1
        p.add('faces', f'<polygon points="{" ".join(f"{x:.1f},{y:.1f}" for x, y in pts)}" class="face{" lit" if lit else ""}"/>')
        if face_labels:                      # label each face by its corner qubit, the one in no other face
            corner = next(j for j in row if sum(j in r for r in HAM) == 1)
            cx, cy = pos[corner]
            p.text((cx + (c[0] - cx) * 0.42, cy + (c[1] - cy) * 0.42 + 4), f'F{sub(i + 1)}', 'note')
    for i, row in enumerate(HAM):
        c = cen(row)
        for j in row:
            p.edge((c[0] - 0.22 * u, c[1]), pos[j], 'edge hit-X' if j in err else 'edge')
            p.edge((c[0] + 0.22 * u, c[1]), pos[j], 'edge')
    for i, row in enumerate(HAM):
        c = cen(row)
        p.check((c[0] - 0.22 * u, c[1]), f'Z{sub(i + 1)}', 'Z', len(row & err) % 2 == 1)
        p.check((c[0] + 0.22 * u, c[1]), f'X{sub(i + 1)}', 'X', False)
    for j in range(1, 8):
        p.qubit(pos[j], str(j), 'X' if j in err else 'I')
    return p.svg(aria), W


def surface_patch(label='', aria=''):
    """3 × 2 faces of the surface code: qubits on edges, Z checks on faces, X checks on vertices; two X errors in a chain."""
    u, pad = 64, 24
    cols, rows = 3, 2
    V = lambda i, j: (pad + i * u, pad + j * u)
    W, H = pad * 2 + cols * u, pad * 2 + rows * u
    p = Panel(W, H, label)
    # qubits: horizontal edges (i,j)-(i+1,j), vertical edges (i,j)-(i,j+1)
    qubits = {}
    for j in range(rows + 1):
        for i in range(cols):
            qubits[('h', i, j)] = ((V(i, j)[0] + V(i + 1, j)[0]) / 2, V(i, j)[1])
    for j in range(rows):
        for i in range(cols + 1):
            qubits[('v', i, j)] = (V(i, j)[0], (V(i, j)[1] + V(i, j + 1)[1]) / 2)
    err = {('v', 1, 0), ('v', 2, 0)}
    faces = {}
    for j in range(rows):
        for i in range(cols):
            faces[(i, j)] = {('h', i, j), ('h', i, j + 1), ('v', i, j), ('v', i + 1, j)}
    for (i, j), members in faces.items():
        x, y = V(i, j)
        lit = len(members & err) % 2 == 1
        p.add('faces', f'<rect x="{x}" y="{y}" width="{u}" height="{u}" class="face{" lit" if lit else ""}"/>')
    # lattice edges
    for j in range(rows + 1):
        for i in range(cols):
            p.add('faces', f'<line x1="{V(i, j)[0]}" y1="{V(i, j)[1]}" x2="{V(i + 1, j)[0]}" y2="{V(i + 1, j)[1]}" class="lattice"/>')
    for j in range(rows):
        for i in range(cols + 1):
            p.add('faces', f'<line x1="{V(i, j)[0]}" y1="{V(i, j)[1]}" x2="{V(i, j + 1)[0]}" y2="{V(i, j + 1)[1]}" class="lattice"/>')
    # Tanner edges from the faces touched by the errors
    for (i, j), members in faces.items():
        if members & err:
            c = (V(i, j)[0] + u / 2, V(i, j)[1] + u / 2)
            for q in members & err:
                p.edge(c, qubits[q], 'edge hit-X')
    for (i, j), members in faces.items():
        c = (V(i, j)[0] + u / 2, V(i, j)[1] + u / 2)
        p.check(c, 'Z', 'Z', len(members & err) % 2 == 1)
    for j in range(rows + 1):
        for i in range(cols + 1):
            x, y = V(i, j)
            p.add('nodes', f'<rect x="{x - 7}" y="{y - 7}" width="14" height="14" rx="2" class="check X small"/>')
    for key, (x, y) in qubits.items():
        op = 'X' if key in err else 'I'
        p.add('nodes', f'<circle cx="{x:.1f}" cy="{y:.1f}" r="7" class="qubit{" X" if op == "X" else ""}"/>')
    return p.svg(aria), W


def figure(num, title, panels, note):
    inner = ''.join(s for s, _ in panels)
    return (f'<div class="fig-static" id="fig-{num}"><div class="w-head"><span class="w-kicker">Figure {num}</span><span class="w-title">{title}</span></div>'
            f'<div class="panels">{inner}</div><figcaption>{note}</figcaption></div>')


FIGS = {}

FIGS[1] = figure(1, 'A matrix and its Tanner graph carry the same information', [
    matrix_panel(REP, 3, row_hi=1, label='(a) Row 1 of H<sub>rep</sub> is the neighbourhood of square c₁: the circles it is joined to.',
                 aria='The repetition-code matrix with row 1 tinted, beside its Tanner graph with the two edges of square 1 emphasised'),
    matrix_panel(REP, 3, col_hi=2, label='(b) Column 2 is the neighbourhood of circle 2: the squares it is joined to.',
                 aria='The same matrix with column 2 tinted, beside the graph with the two edges of circle 2 emphasised'),
], 'The three-bit repetition code. Each 1 in the matrix is one edge; rows read off squares, columns read off circles.')

FIGS[2] = figure(2, 'Marks on circles light the squares that meet them an odd number of times', [
    bipartite(7, HAM, classical=True, degrees=True, label='(a) The Hamming graph: three squares of degree 4, circles of degree 1, 2 or 3.',
              aria='Tanner graph of the Hamming code with the degree of each circle written under it'),
    bipartite(7, HAM, classical=True, err={5}, label='(b) Bit 5 flipped: squares 1 and 3 light, the binary digits of 5. Syndrome 101.',
              aria='Hamming graph with bit 5 marked; squares 1 and 3 lit'),
    bipartite(7, HAM, classical=True, err={1, 2, 3}, label='(c) Bits 1, 2, 3 flipped: every square meets the marks twice or not at all. Nothing lights: a codeword.',
              aria='Hamming graph with bits 1, 2 and 3 marked; no square lit'),
], 'Coloured edges run from the marked circles. A square counts its coloured edges: odd lights it, even leaves it dark.')

FIGS[3] = figure(3, 'The decoding puzzle, and how two flips beat a distance-3 code', [
    bipartite(7, HAM, classical=True, err={5, 6}, label='(a) Bits 5 and 6 flipped. Square 1 meets both and stays dark; squares 2 and 3 light. Syndrome 011.',
              aria='Hamming graph with bits 5 and 6 marked; squares 2 and 3 lit'),
    bipartite(7, HAM, classical=True, em_qubits={3}, em_checks=(), label='(b) The lightest set of circles that lights exactly squares 2 and 3 is circle 3 alone, so the decoder flips bit 3.',
              aria='Hamming graph with the edges of circle 3 emphasised: they lead to squares 2 and 3'),
    bipartite(7, HAM, classical=True, err={3, 5, 6}, label='(c) Net flips on 3, 5, 6: each square meets them twice. Invisible, a codeword, and the message has changed.',
              aria='Hamming graph with bits 3, 5 and 6 marked; no square lit'),
], 'The decoder cannot see (a), only the lit squares, and the lightest explanation is wrong.')

FIGS[4] = figure(4, 'A CSS code is two Tanner graphs on one set of qubits', [
    bipartite(9, SHOR_Z, SHOR_X, err={5}, label='(a) Shor code, X error on qubit 5: it marks the circle for the Z squares above, lighting Z₃ and Z₄, and the X squares below see nothing.',
              aria='Shor Tanner graph with Z checks above and X checks below; X error on qubit 5 lights Z3 and Z4'),
    bipartite(9, SHOR_Z, SHOR_X, zerr={2}, label='(b) Z error on qubit 2: only the X squares can see it, and X₁ lights. Qubits 1, 2 and 3 all hang from X₁ alone, so Z₁, Z₂ and Z₃ light the same square.',
              aria='Shor Tanner graph with a Z error on qubit 2 lighting X1'),
    bipartite(9, SHOR_Z, SHOR_X, em_checks=[('X', 1), ('Z', 2)], ring={2, 3}, label='(c) The commutation condition: X₁ and Z₂ share exactly two circles, 2 and 3. Every X square meets every Z square in an even number of circles.',
              aria='Shor Tanner graph with the edges of X1 and Z2 emphasised and their two common qubits ringed'),
], 'Z squares catch X errors and X squares catch Z errors; a Y error marks its circle for both sides.')

FIGS[5] = figure(5, 'The three classes of error, on the Steane graph', [
    bipartite(7, HAM, HAM, err={5}, label='(a) Detected. X₅ lights Z₁ and Z₃.',
              aria='Steane Tanner graph; X error on qubit 5 lights Z1 and Z3'),
    bipartite(7, HAM, HAM, err={4, 5, 6, 7}, em_checks=[('X', 1)], label='(b) Harmless. X on 4, 5, 6, 7 lights nothing, and the marked circles are exactly the neighbourhood of X₁: the error is a stabilizer.',
              aria='Steane Tanner graph; X errors on qubits 4 to 7 light nothing and match the neighbourhood of check X1'),
    bipartite(7, HAM, HAM, err={1, 2, 3}, label='(c) Logical. X on 1, 2, 3 lights nothing, but no combination of X squares has this neighbourhood: an undetected logical error.',
              aria='Steane Tanner graph; X errors on qubits 1 to 3 light nothing and match no check'),
], 'Lighting nothing is necessary but not sufficient for harmlessness; the other side\'s squares decide between harmless and logical.')

FIGS[6] = figure(6, 'Three layouts of the same kind of graph', [
    shor_grid(err={5}, label='(a) The Shor code as a grid, one block per row. X₅ lights the Z squares on either side of it in its row.',
              aria='Shor code drawn as a 3 by 3 grid with Z checks between horizontal neighbours and X checks between rows; X error on qubit 5'),
    steane_faces(err={5}, label='(b) The Steane code as three faces, F₁ = {4,5,6,7}, F₂ = {2,3,6,7}, F₃ = {1,3,5,7}. Qubit 5 lies in F₁ and F₃, so those two faces and their Z squares light; the lit faces meet only at qubit 5.',
                 aria='Steane code drawn as a triangle with three four-qubit faces; faces 1 and 3 are lit by an X error on qubit 5'),
    surface_patch(label='(c) A patch of the surface code: qubits on edges, Z squares on faces, small X squares on vertices. Two X errors in a row light only the faces at the ends of the chain.',
                  aria='A three by two patch of the surface code lattice with two adjacent X errors; the middle face sees both and stays dark, the two end faces light'),
], 'Geometry makes the decoding rule visible: lit faces intersect at the error, and lit endpoints are paired by a path.')

FIGS[7] = figure(7, 'A tree and a four-cycle', [
    bipartite(3, REP, classical=True, label='(a) The repetition graph is a path: no cycles. Belief propagation is exact on it.',
              aria='Tanner graph of the three-bit repetition code, a path of five nodes'),
    bipartite(7, HAM, classical=True, em_checks=[('Z', 1), ('Z', 2)], ring={6, 7}, label='(b) Squares 1 and 2 of the Hamming graph share circles 6 and 7: a cycle of length four, c₁ – 6 – c₂ – 7 – c₁.',
              aria='Hamming graph with the edges of squares 1 and 2 emphasised and circles 6 and 7 ringed, showing a four-cycle'),
], 'Every pair of Hamming squares shares two circles, so the graph has three four-cycles.')


def main():
    html = PAGE.read_text(encoding='utf-8')
    for num, block in FIGS.items():
        pat = re.compile(rf'<!-- fig:{num} start -->.*?<!-- fig:{num} end -->', re.S)
        assert pat.search(html), f'no markers for figure {num}'
        html = pat.sub(f'<!-- fig:{num} start -->\n{block}\n<!-- fig:{num} end -->', html)
    PAGE.write_text(html, encoding='utf-8')
    print('figures written:', ', '.join(str(k) for k in FIGS))


if __name__ == '__main__':
    main()
