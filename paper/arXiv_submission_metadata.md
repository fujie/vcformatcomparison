# arXiv Submission Metadata

## Title
A Reproducible Benchmark and Security Analysis of Verifiable Credential Formats: Comparing SD-JWT VC, JSON-LD VC, and mdoc

## Authors
1. **Naohiro Fujie** — ITOCHU Techno-Solutions Corporation, Mirai Research Institute; OpenID Foundation Japan (naohiro.fujie@ctc-g.co.jp)
2. **Shigeya Suzuki** — Keio University (shigeya@wide.ad.jp)

## Abstract
This paper presents an empirical comparative evaluation of three major Verifiable Credential (VC) formats and their verification pipelines: SD-JWT VC (IETF RFC 9901), JSON-LD VC (W3C VCDM 2.0), and mdoc (ISO/IEC 18013-5). The evaluation encompasses three dimensions: signature verification performance, deserialization and verification implementation complexity, and canonicalization security. Benchmark results using nanosecond-precision process.hrtime.bigint() show that SD-JWT VC and mdoc achieve equivalent fastest signing (0.030 ms/op each), while mdoc achieves the fastest verification (0.052 ms/op) followed by SD-JWT VC (0.077 ms/op). JSON-LD VC exhibits the highest latency (sign: 0.061 ms/op, verify: 0.106 ms/op). Attribute scaling evaluation demonstrates that JSON-LD URDNA2015 canonicalization grows to 0.801 ms at 500 attributes while SD-JWT VC remains at 0.008 ms. An Ed25519 unified benchmark further separates the effects of signature algorithm selection from verification pipeline overheads (canonicalization and preprocessing), showing that SD-JWT VC remains the fastest under a unified algorithm while mdoc's default performance advantage depends partly on its ECDSA P-256/COSE configuration. Implementation complexity analysis reveals that JSON-LD VC has the highest cyclomatic complexity (8) and requires external network dependencies. Security evaluation reveals that the JSON-LD/RDFC verification pipeline carries additional attack surface stemming from remote context resolution and URDNA2015 canonicalization; without appropriate mitigations (static document loaders, context allowlists, call limits), DoS exposure, context injection, and SSRF risks may materialize. Within the scope of the evaluated attack vectors, SD-JWT VC and mdoc demonstrated resilience under standard verification settings. All experimental tools are released as open source, providing a reproducible evaluation framework for implementers and standardization stakeholders.

## Primary Category
**cs.CR** (Cryptography and Security)

## Secondary Categories
- cs.SE (Software Engineering)
- cs.PF (Performance)

## Keywords
Verifiable Credentials, SD-JWT VC, JSON-LD VC, mdoc, Digital Identity, Benchmark, Security Analysis, Selective Disclosure, URDNA2015, COSE

## License
**CC BY 4.0** (Creative Commons Attribution 4.0 International)

This is the standard license for arXiv preprints that allows maximum dissemination while requiring attribution. It permits commercial use, derivatives, and redistribution with proper credit.

arXiv license identifier: `http://creativecommons.org/licenses/by/4.0/`

## Comments
17 tables, 5 figures, 18 references. Open-source benchmark tool available at https://github.com/fujie/vcformatcomparison

## MSC-class / ACM-class
ACM: K.6.5 (Security and Protection); D.2.8 (Metrics)

## Journal-ref
(Preprint — not yet submitted to a journal)

---

## Submission Checklist

- [x] English version of the paper (VC_Format_Comparison_Paper_EN.docx)
- [x] Japanese version preserved (VC_Format_Comparison_Paper.docx)
- [x] Author information added to both versions
- [x] License selected: CC BY 4.0
- [x] arXiv category selected: cs.CR (primary), cs.SE + cs.PF (secondary)
- [ ] Convert .docx to PDF or LaTeX for arXiv submission (arXiv accepts PDF but prefers LaTeX)
- [ ] Verify all figures render correctly in PDF
- [ ] Submit via https://arxiv.org/submit

## Notes on arXiv Submission Format

arXiv strongly prefers LaTeX source files but also accepts PDF. For a .docx-based paper, the recommended approach is:

1. **Option A (Easiest)**: Export the .docx to PDF and submit the PDF directly. arXiv accepts PDF submissions under "PDFLaTeX" or "PDF" submission types.

2. **Option B (Preferred by arXiv)**: Convert to LaTeX using pandoc (`pandoc VC_Format_Comparison_Paper_EN.docx -o paper.tex`) and manually adjust formatting. This gives arXiv more control over rendering but requires significant manual cleanup.

For initial submission, Option A (PDF) is recommended.
