#!/usr/bin/env python3
"""Convert pandoc-generated body_raw.tex (from VC_Format_Comparison_Paper_EN.docx)
into an IEEEtran conference paper (ieee_main.tex)."""
import re, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'body_raw.tex'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'ieee_main.tex'

src = open(SRC, encoding='utf-8').read()

# ── 1. split off title block and references
m = re.search(r'\\textbf\{1\. Introduction\}', src)
body = src[m.start():]
refm = re.search(r'\\textbf\{References\}', body)
refs_raw = body[refm.end():]
body = body[:refm.start()]

head = src[:m.start()]
am = re.search(r'\\begin\{quote\}\n(.*?)\n\n\\textbf\{Keywords:\} \\emph\{(.*?)\}\n\\end\{quote\}', head, re.S)
abstract = am.group(1).strip()
keywords = am.group(2).strip()

# ── 2. headings
def heading(match):
    num, title = match.group(1), match.group(2).strip()
    parts = [p for p in num.rstrip('.').split('.') if p]
    if len(parts) == 1:
        return '\\section{%s}' % title
    if len(parts) == 2:
        return '\\subsection{%s}' % title
    return '\\subsubsection{%s}' % title

body = re.sub(r'^\\textbf\{(\d+(?:\.\d+)*\.?)\s+(.+?)\}$', heading, body, flags=re.M)
# appendix headings: "Appendix A. Title" -> \section*, "A.1 Title" -> \subsection*
body = re.sub(r'^\\textbf\{(Appendix [A-Z])\.?\s+(.+?)\}$',
              lambda m: '\\section*{%s: %s}' % (m.group(1), m.group(2).strip()), body, flags=re.M)
body = re.sub(r'^\\textbf\{([A-Z]\.\d+)\s+(.+?)\}$',
              lambda m: '\\subsection*{%s %s}' % (m.group(1), m.group(2).strip()), body, flags=re.M)

# ── 3. citations
body = re.sub(r'\{\[\}(\d+)\{\]\}', lambda m: '\\cite{ref%s}' % m.group(1), body)

# ── 4. tables & figures
CAP_RE = re.compile(r'^(?:\\textbf\{|\\emph\{)?(Table [A-Z0-9]+\.\s*.*?)\}?\s*$')
FIG_RE = re.compile(r'^(?:\\textbf\{|\\emph\{)?((?:Figure|Fig\.?)\s*\d+\.\s*.*?)\}?\s*$')

def split_row(row):
    # top-level split on & (no nested braces handling needed for our tables)
    return [c.strip() for c in row.split('&')]

lines = body.split('\n')
out, i = [], 0
pending_caption = None
pending_figcaption = None

while i < len(lines):
    line = lines[i]
    s = line.strip()
    if s.startswith(('Table ', '\\textbf{Table ', '\\emph{Table ')):
        cm = CAP_RE.match(s)
        if cm:
            pending_caption = cm.group(1).strip()
            i += 1
            continue
    if s.startswith(('Figure ', 'Fig.', '\\textbf{Figure ', '\\emph{Figure ')):
        fm = FIG_RE.match(s)
        if fm:
            pending_figcaption = fm.group(1).strip()
            i += 1
            continue
    if line.startswith('\\begin{longtable}'):
        tbl = [line]; i += 1
        while i < len(lines) and not lines[i].startswith('\\end{longtable}'):
            tbl.append(lines[i]); i += 1
        tbl.append(lines[i]); i += 1
        raw = '\n'.join(tbl)
        specm = re.search(r'\\begin\{longtable\}\[\]\{@\{\}(.*?)@\{\}\}', raw, re.S)
        spec = specm.group(1).replace('\n', '') if specm else 'l'
        ncols = len(re.findall(r'[lcr]|p\{[^}]*\}', spec))
        inner = re.sub(r'\\begin\{longtable\}\[\]\{@\{\}.*?@\{\}\}', '', raw, flags=re.S)
        inner = inner.replace('\\end{longtable}', '')
        inner = re.sub(r'\\endhead|\\endfirsthead|\\endfoot|\\endlastfoot', '', inner)
        inner = re.sub(r'\\caption\{[^}]*\}\\\\', '', inner).strip()
        # column content stats
        rows = [r for r in re.split(r'\\tabularnewline', inner)
                if '&' in r]
        maxlen = [0] * ncols
        for r in rows:
            cells = split_row(re.sub(r'\\(top|mid|bottom)rule', '', r).strip())
            for ci, c in enumerate(cells[:ncols]):
                c = re.sub(r'\\[a-zA-Z]+|\{|\}', '', c)
                maxlen[ci] = max(maxlen[ci], len(c))
        texty = any(l > 28 for l in maxlen)
        cap = pending_caption or ''
        pending_caption = None
        num_m = re.match(r'Table ([A-Z0-9]+)\.', cap)
        label = ('\\label{tab:%s}' % num_m.group(1)) if num_m else ''
        wide = ncols > 4 or (texty and sum(maxlen) > 120)
        env = 'table*' if wide else 'table'
        width = '\\textwidth' if wide else '\\columnwidth'
        out.append('\\begin{%s}[!t]' % env)
        out.append('\\centering')
        out.append('\\caption{%s}%s' % (cap, label))
        out.append('\\footnotesize')
        if texty:
            tot = sum(maxlen) or 1
            colspec = ''.join(
                ('>{\\raggedright\\arraybackslash}p{%.2f%s}' % (max(l / tot, 0.06) * 0.96, width))
                if l > 28 else 'l'
                for l in maxlen)
            # p widths need a length: use \dimexpr fraction
            colspec = ''
            for l in maxlen:
                if l > 28:
                    frac = max(l / tot, 0.08) * (0.92 if wide else 0.90)
                    colspec += '>{\\raggedright\\arraybackslash}p{%.3f%s}' % (frac, width)
                else:
                    colspec += 'l'
            out.append('\\begin{tabular}{%s}' % colspec)
            out.append(inner)
            out.append('\\end{tabular}')
        else:
            out.append('\\resizebox{%s}{!}{%%' % width)
            out.append('\\begin{tabular}{%s}' % spec)
            out.append(inner)
            out.append('\\end{tabular}}')
        out.append('\\end{%s}' % env)
        continue
    if '\\includegraphics' in line:
        line2 = re.sub(r'\\includegraphics\[[^\]]*\]', r'\\includegraphics[width=\\columnwidth]', line)
        line2 = line2.replace('\\pandocbounded{', '')
        line2 = line2.rstrip()
        if line2.endswith('}') and '\\pandocbounded' in line:
            line2 = line2[:-1]
        cap = pending_figcaption or ''
        pending_figcaption = None
        num_m = re.match(r'(?:Figure|Fig\.?)\s*(\d+)\.', cap)
        label = ('\\label{fig:%s}' % num_m.group(1)) if num_m else ''
        out.append('\\begin{figure}[!t]')
        out.append('\\centering')
        out.append(line2)
        out.append('\\caption{%s}%s' % (cap, label))
        out.append('\\end{figure}')
        i += 1
        continue
    out.append(line)
    i += 1

body = '\n'.join(out)
body = body.replace('\\tightlist\n', '')

# ── 5. references
bibitems = []
for rm in re.finditer(r'\{\[\}(\d+)\{\]\}\s*(.+)', refs_raw):
    n, text = rm.group(1), rm.group(2).strip()
    bibitems.append('\\bibitem{ref%s} %s' % (n, text))
thebib = '\\begin{thebibliography}{%d}\n%s\n\\end{thebibliography}' % (len(bibitems), '\n'.join(bibitems))

# ── 6. assemble
preamble = r'''% !TeX program = xelatex
\documentclass[conference]{IEEEtran}
\usepackage{fontspec}
\setmainfont{TeX Gyre Termes}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{array}
\usepackage{caption}
\captionsetup[table]{labelformat=empty}
\captionsetup[figure]{labelformat=empty}
\usepackage{url}
\usepackage[hidelinks]{hyperref}
\usepackage{balance}
\begin{document}

\title{A Reproducible Benchmark and Security Analysis of Verifiable Credential Formats:\\ Comparing SD-JWT VC, JSON-LD VC, and mdoc}

\author{\IEEEauthorblockN{Naohiro Fujie}
\IEEEauthorblockA{\textit{Mirai Research Lab, ITOCHU Techno-Solutions Corporation}\\
\textit{OpenID Foundation Japan}\\
Tokyo, Japan\\
naohiro.fujie@ctc-g.co.jp}
\and
\IEEEauthorblockN{Shigeya Suzuki}
\IEEEauthorblockA{\textit{Keio University}\\
Kanagawa, Japan\\
shigeya@wide.ad.jp}}

\maketitle

\begin{abstract}
''' + abstract + r'''
\end{abstract}

\begin{IEEEkeywords}
''' + keywords + r'''
\end{IEEEkeywords}

'''

full = preamble + body + '\n\\balance\n\n' + thebib + '\n\n\\end{document}\n'

full = full.replace('　', '\\quad ')
full = full.replace('——', '---').replace('—', '---')
full = full.replace('≈', '$\\approx$')
full = full.replace('×', '$\\times$')
full = full.replace('σ', '$\\sigma$')

open(OUT, 'w', encoding='utf-8').write(full)
print('wrote', OUT, len(full), 'chars,', len(bibitems), 'bibitems')
