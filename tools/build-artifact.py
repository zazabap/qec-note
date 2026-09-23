#!/usr/bin/env python3
"""Bundle one note page into a single self-contained HTML file.

The site itself needs no build: index.html and the part pages load the
stylesheet and the ES modules from assets/. This script exists for one
purpose, publishing a page somewhere that wants a single file (for example a
claude.ai artifact): it inlines the stylesheet, concatenates the modules into
one inline module script, strips the <html>/<head>/<body> wrapper, and points
relative links at the deployed site.

    python3 tools/build-artifact.py [page.html] [-o dist/artifact.html]

The modules are concatenated in dependency order with their import/export
lines removed, so they must not share top-level names; the script checks.
"""
import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = 'https://zazabap.github.io/qec-note/'
MODULES = ['pauli.js', 'codes.js', 'state.js', 'widgets.js']

parser = argparse.ArgumentParser()
parser.add_argument('page', nargs='?', default='01-stabilizer-measurement.html')
parser.add_argument('-o', '--out', default='dist/artifact.html')
args = parser.parse_args()

src = ROOT / args.page
html = src.read_text(encoding='utf-8')
css = (ROOT / 'assets' / 'qec.css').read_text(encoding='utf-8')

# --- bundle the modules -----------------------------------------------------
declared = {}
chunks = []
for name in MODULES:
    text = (ROOT / 'assets' / name).read_text(encoding='utf-8')
    text = re.sub(r'^import\b[^;]*;\s*$', '', text, flags=re.M)
    text = re.sub(r'^export\s*\{[^}]*\};\s*$', '', text, flags=re.M)
    text = re.sub(r'^export\s+(default\s+)?', '', text, flags=re.M)
    for m in re.finditer(r'^(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)', text, flags=re.M):
        ident = m.group(1)
        if ident in declared:
            sys.exit(f'top-level name {ident!r} is declared in both {declared[ident]} and {name}; rename one')
        declared[ident] = name
    chunks.append(f'// ---- {name}\n{text.strip()}\n')
bundle = '\n'.join(chunks)

# --- take the page apart ----------------------------------------------------
title = re.search(r'<title>(.*?)</title>', html, re.S).group(1).strip()
head = re.search(r'<head>(.*?)</head>', html, re.S).group(1)
body = re.search(r'<body>(.*?)</body>', html, re.S).group(1)

keep = [m.group(0) for m in re.finditer(
    r'<meta name="description"[^>]*>|<script>.*?</script>|<script\b[^>]*\bsrc="https://[^"]+"[^>]*></script>', head, re.S)]

body = body.replace('href="index.html"', f'href="{BASE}"')
body = re.sub(r'href="(\d\d-[^"]+\.html)"', lambda m: f'href="{BASE}{m.group(1)}"', body)

parts = [f'<title>{title}</title>', *keep, f'<style>\n{css}\n</style>', body.strip(), f'<script type="module">\n{bundle}\n</script>']
out = ROOT / args.out
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text('\n'.join(parts) + '\n', encoding='utf-8')
print(f'wrote {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)')
