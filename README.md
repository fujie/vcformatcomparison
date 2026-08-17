# VC Format Comparison Tool

A browser-based benchmark tool for quantitatively comparing four Verifiable Credential formats — **SD-JWT VC**, **JSON-LD VC**, **JSON-LD VC (JCS)**, and **mdoc (ISO 18013-5)** — across multiple axes including signature verification speed, deserialization complexity, normalization security, and attribute scaling.

[日本語版 README はこちら](README.ja.md)

## Compared Formats

| Format | Specification | Serialization | Signature Algorithm | Canonicalization |
|---|---|---|---|---|
| **SD-JWT VC** | IETF RFC 9901 | JWT (text) | EdDSA (Ed25519) | None |
| **JSON-LD VC** | W3C VCDM 2.0 | JSON-LD (text) | Ed25519 + SHA-256 | URDNA2015 (RDF) |
| **JSON-LD VC (JCS)** | W3C VCDM 2.0 | JSON-LD (text) | Ed25519 + SHA-256 | JCS RFC 8785 |
| **mdoc** | ISO 18013-5 | CBOR (binary) | ECDSA P-256 (ES256) | None |

## Setup

```bash
git clone git@github.com:fujie/vcformatcomparison.git
cd vcformatcomparison
npm install
npm run dev        # Frontend (http://localhost:5173)
```

For backend measurement mode, start the server in a separate terminal:

```bash
npm run server     # Backend server (http://localhost:3001)
```

To start both simultaneously:

```bash
npm run dev:full   # Start Vite + backend server in parallel
```

> **No external network requests (frontend mode)**: JSON-LD contexts are statically embedded in source code; no external URL requests are made during benchmarking.

## Measurement Modes

### 🌐 Browser Mode (Default)

Measures in-browser using `performance.now()` (~0.1 ms precision). Runs real measurements in three languages: TypeScript, Go (WebAssembly), and Python (Pyodide).

### 🖥 Backend Mode

Server-side measurement using Node.js `process.hrtime.bigint()` (nanosecond precision). Enables three-language comparison including native Go binary and Python `time.perf_counter_ns()`. Requires the backend server (`npm run server`) to be running.

---

## Benchmark Tabs

### ⚡ Signature Verification Speed

Runs sign/verify for each format over the specified iteration count and measures the statistical distribution.

**What is measured**

| Format | Sign | Verify |
|---|---|---|
| SD-JWT VC | `jose` SignJWT (EdDSA/Ed25519) | `jose` jwtVerify |
| JSON-LD VC | jsonld.normalize (URDNA2015) → SHA-256 → @noble/ed25519 sign | normalize → SHA-256 → ed25519 verify |
| JSON-LD VC (JCS) | JCS RFC 8785 canonicalization → SHA-256 → @noble/ed25519 sign | JCS → SHA-256 → ed25519 verify |
| mdoc | CBOR encode → SHA-256 digest → COSE_Sign1 (ECDSA P-256) | MSO decode → digest verification → COSE signature verification |

**Output statistics**

| Metric | Description |
|---|---|
| ops/sec | Operations per second |
| avg (ms) | Arithmetic mean across all iterations |
| σ (ms) | Standard deviation |
| 95%CI (ms) | Half-width of 95% confidence interval (±) |
| p50 / p90 / p95 / p99 (ms) | Percentile latencies |
| min / max (ms) | Minimum and maximum values |

In backend mode, avg (ns) and σ (ns) are additionally output with nanosecond precision.

---

### 📐 Deserialization Complexity

Statically and dynamically evaluates the code complexity required for a minimal verification implementation.

| Metric | Description |
|---|---|
| LOC | Lines of code for minimal implementation |
| Async steps | Number of operations requiring `await` |
| Cyclomatic complexity | Number of conditional branches |
| External network calls | Number of external URL requests at runtime |
| Parse time (ms) | Measured deserialization latency |

---

### 🔐 Normalization Security

Actually executes attack vectors against each format and determines Vulnerable / Mitigated / N/A status.

| Test ID | Test Name | Target | Category |
|---|---|---|---|
| S1 | Poisoned graph DoS (URDNA2015) | JSON-LD VC | DoS |
| S2 | JSON-LD context injection | JSON-LD VC | ContextHijack |
| S3 | SSRF via remote context | JSON-LD VC | SSRF |
| S4 | alg:none attack | SD-JWT VC | AlgorithmConfusion |
| S5 | Algorithm confusion RS256→EdDSA | SD-JWT VC | AlgorithmConfusion |
| S6 | mdoc data element tampering detection | mdoc | CborMalleability |
| S7 | COSE protected header tampering | mdoc | AlgorithmConfusion |
| S8 | SSRF risk assessment | mdoc | SSRF |

---

### 🔤 Implementation Comparison (With vs. Without Libraries)

Compares performance with and without libraries, and benchmarks across TypeScript, Go, and Python.

- **TypeScript**: In-browser measurement (both with and without libraries)
- **Go**: Go WebAssembly (`go/bench-native/main.go` built with `GOOS=js GOARCH=wasm`, standard library only)
- **Python**: Pyodide (CPython 3.12 on WebAssembly; `cryptography`, `PyJWT`, `pyld`, `cbor2` installed via micropip)

Go WASM and Python (Pyodide) measurements run automatically when the "Run Benchmark" button is clicked. Initial load may take a few seconds for binary download.

---

### 📊 Detailed Analysis

Runs five advanced benchmarks. Start by clicking "Run Detailed Analysis" in the Detailed Analysis tab.

#### 1. Attribute Count Scaling

Measures serialization speed for each format at 5 / 20 / 100 / 500 attributes, comparing performance scaling as attribute count grows.

#### 2. JSON-LD Context Loader Comparison

| Loader Type | Description |
|---|---|
| Static loader | Contexts pre-loaded statically. No SSRF risk. |
| Remote loader (simulated) | Adds 50 ms network latency. No actual external requests. |

Quantifies the performance cost and SSRF attack surface of remote context loading.

#### 3. URDNA2015 Call Limit Comparison

Generates poisoned graphs with blank node cycles of 2 / 4 / 6 / 8 nodes, comparing latency and protection behavior with and without timeout.

- **Without timeout**: Reproduces DoS via combinatorial explosion
- **With timeout (`Promise.race` 2000 ms)**: Demonstrates DoS mitigation

#### 4. Selective Disclosure Performance Comparison

Compares presentation generation latency when disclosing N attributes from a 20-attribute credential.

| Format | Disclosure Mechanism |
|---|---|
| SD-JWT VC | SHA-256 hashed disclosures (`_sd` array) — RFC 9901 compliant |
| JSON-LD VC | Re-normalize derived credential (disclosed attributes only) with URDNA2015 |
| JSON-LD VC (JCS) | Re-canonicalize disclosed attribute subset document with JCS |
| mdoc | CBOR-encode only disclosed elements from IssuerSigned nameSpace |

#### 5. Ed25519 Unified Benchmark

By also measuring mdoc (which normally uses ECDSA P-256) with EdDSA (Ed25519), this eliminates cryptographic algorithm differences and isolates the pure serialization overhead of each format (JWT vs JSON-LD vs CBOR).

---

## Result Report

The "📋 Result Report" tab displays all completed benchmark results in a unified view and supports export in the following formats:

| Export Format | Content |
|---|---|
| Markdown copy | Table format for pasting into GitHub / Obsidian / etc. |
| CSV copy / download | Analyzable in Excel / Google Sheets |
| JSON copy / download | Raw data (all statistical fields included) |

**Sections included in the report** (only completed benchmarks are output):

1. Test execution environment (browser / OS / CPU / Go WASM / Pyodide versions)
2. Signature verification speed (full statistical distribution)
3. Deserialization complexity
4. Security tests
5. With vs. without libraries — per-language comparison
6. Serialization speed
7. Attribute count scaling
8. JSON-LD context loader comparison
9. URDNA2015 call limit comparison
10. Selective disclosure performance comparison
11. Ed25519 unified benchmark
12. Actual execution code (TypeScript / Go / Python)

---

## Directory Structure

```
.
├── src/
│   ├── benchmarks/
│   │   ├── signatureSpeed.ts            # Signature verification speed benchmark
│   │   ├── deserializationComplexity.ts # Deserialization complexity
│   │   ├── normalizationSecurity.ts     # Security tests
│   │   ├── noLibrary.ts                 # No-library implementation benchmark
│   │   └── scalingBenchmarks.ts         # Detailed analysis (attribute scaling, etc.)
│   ├── components/
│   │   ├── SpeedResults.tsx             # Signature speed tab
│   │   ├── ComplexityResults.tsx        # Deserialization complexity tab
│   │   ├── SecurityResults.tsx          # Security tab
│   │   ├── ImplComparison.tsx           # Implementation comparison tab
│   │   ├── ScalingResults.tsx           # Detailed analysis tab
│   │   └── ReportView.tsx               # Result report tab (export)
│   ├── data/
│   │   ├── staticContexts.ts            # Statically embedded JSON-LD contexts
│   │   ├── referenceValues.ts           # Go / Python reference values
│   │   └── benchmarkSources.ts          # Execution code for export
│   ├── lib/
│   │   ├── goRunner.ts                  # Go WASM execution runner
│   │   └── pyodideRunner.ts             # Pyodide (Python) execution runner
│   └── types/
│       └── backendResult.ts             # Backend API response type definitions
├── server/
│   ├── index.ts                         # Express server (SSE job queue)
│   └── bench/
│       ├── nodeSpeed.ts                 # Node.js signature speed (process.hrtime.bigint)
│       ├── nodeComplexity.ts            # Node.js complexity measurement
│       ├── nodeSecurity.ts              # Node.js security tests
│       └── speed.py                     # Python speed measurement (time.perf_counter_ns)
├── go/
│   └── bench-native/
│       └── main.go                      # Go WASM build target
├── public/
│   ├── go-bench.wasm                    # Pre-built Go WASM binary
│   └── wasm_exec.js                     # Go WASM runtime bridge
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## Libraries Used

| Library | Version | Purpose |
|---|---|---|
| `jose` | 6.x | JWS signing and verification for SD-JWT VC (EdDSA) |
| `@noble/ed25519` | 2.x | Ed25519 signing and verification for JSON-LD VC |
| `@noble/hashes` | 1.x | SHA-256 / SHA-512 |
| `jsonld` | 8.x | JSON-LD URDNA2015 canonicalization |
| `cbor-x` | 1.x | CBOR encoding and decoding for mdoc |
| `recharts` | 2.x | Benchmark result chart rendering |
| `react` / `react-dom` | 18.x | UI framework |
| `express` | 4.x | Backend server |
| `tsx` | — | Direct TypeScript execution (for backend) |

**Python (Pyodide / backend)**: `cryptography`, `PyJWT`, `pyld`, `cbor2`, `cachetools`, `lxml`

**Go**: Standard library only (`crypto/ecdsa`, `crypto/ed25519`, `crypto/sha256`, `encoding/base64`, `crypto/elliptic`)

---

## Building Go WASM

A pre-built `public/go-bench.wasm` is included in the repository, so rebuilding is not normally required. To rebuild:

```bash
cd go/bench-native
GOOS=js GOARCH=wasm go build -o ../../public/go-bench.wasm .
```

---

## Backend Server API

| Endpoint | Method | Description |
|---|---|---|
| `/api/bench/start` | POST | Start a benchmark job. Returns `jobId`. |
| `/api/bench/stream/:jobId` | GET | Receive progress and completion via SSE stream. |
| `/api/bench/result/:jobId` | GET | Poll for job result. |

Example request body:

```json
{
  "iterations": 100,
  "runNode": true,
  "runPython": true,
  "runGo": true,
  "runComplexity": true,
  "runSecurity": true
}
```

---

## Design Notes

### JSON-LD `safe` Option

`jsonld` v8's `normalize()` has `safe: true` enabled by default. Some benchmark paths in this tool use `safe: false`. In production implementations, keep `safe: true`. The `safe: true` flag prevents undefined terms from being silently excluded from the data being signed.

### URDNA2015 Call Limit

Poisoned graphs (blank node cycles) cause URDNA2015's computational complexity to explode exponentially. Production implementations must always impose a call limit or timeout. This tool demonstrates mitigation using `Promise.race` with a 2000 ms timeout.

### Context Loader and SSRF

Allowing remote URL fetching in the JSON-LD `documentLoader` enables SSRF attacks where an attacker can cause an attacker-controlled context to be loaded. Frontend mode uses only the static loader.

### mdoc Implementation Scope

The mdoc implementation in this tool covers only the basic IssuerSigned path for benchmarking purposes. Device signatures, X.509 certificate chain validation, Session Transcript, and the complete DeviceResponse verification flow are omitted.

---

## Reference Standards

- [IETF RFC 9901 — SD-JWT VC](https://www.rfc-editor.org/rfc/rfc9901)
- [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- [W3C RDF Dataset Canonicalization (RDFC-1.0 / URDNA2015)](https://www.w3.org/TR/rdf-canon/)
- [ISO/IEC 18013-5 — mDL (mdoc)](https://www.iso.org/standard/69084.html)
- [IETF RFC 8785 — JSON Canonicalization Scheme (JCS)](https://www.rfc-editor.org/rfc/rfc8785)
- [IETF RFC 9052 — COSE: Structures and Process](https://www.rfc-editor.org/rfc/rfc9052)
- [IETF RFC 8725 — JWT Best Current Practices](https://www.rfc-editor.org/rfc/rfc8725)
- [W3C VC Data Integrity — eddsa-rdfc-2022 / eddsa-jcs-2022](https://www.w3.org/TR/vc-di-eddsa/)
