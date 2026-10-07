/**
 * paperBench.mjs — Consolidated paper benchmark runner (Node.js, hrtime nanosecond precision).
 *
 * Addresses reviewer comments:
 *  - All statistics (mean, σ, 95%CI, p50, p95) reported to 3 decimal places (ms)
 *  - Replaces browser performance.now() (0.1 ms quantization → spurious p50=0.000) with
 *    process.hrtime.bigint() for ALL benchmarks including selective disclosure,
 *    Ed25519-unified, and attribute scaling
 *  - Explicit outlier policy: Tukey fences (1.5×IQR); outliers are reported (count/%)
 *    but NOT removed; median (p50) is the primary robust statistic
 *  - Exact library versions (incl. minor/patch) resolved from node_modules at runtime
 *  - URDNA2015 canonicalization measured on complex credentials with blank nodes:
 *    OpenBadges v3.0 (1EdTech), JFF Plugfest profile, DCC-style academic credential,
 *    and synthetic multi-blank-node credentials
 *
 * Usage: node server/bench/paperBench.mjs [iterations=1000] [out=paper-bench-results.json]
 */

import crypto from 'node:crypto'
import os from 'node:os'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const N = Number(process.argv[2] ?? 1000)
const OUT = process.argv[3] ?? 'paper-bench-results.json'

// ─────────────────────────────────────────────────────────────────
// Statistics (ns in, ms out) — full precision kept; format at print time
// ─────────────────────────────────────────────────────────────────

function computeStats(label, timingsNs) {
  const t = [...timingsNs].sort((a, b) => a - b)
  const n = t.length
  const mean = t.reduce((s, v) => s + v, 0) / n
  const variance = t.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) // sample variance
  const sd = Math.sqrt(variance)
  const q = (p) => {
    // linear interpolation percentile
    const idx = p * (n - 1)
    const lo = Math.floor(idx), hi = Math.ceil(idx)
    return t[lo] + (t[hi] - t[lo]) * (idx - lo)
  }
  const q1 = q(0.25), q3 = q(0.75)
  const iqr = q3 - q1
  const loFence = q1 - 1.5 * iqr, hiFence = q3 + 1.5 * iqr
  const inliers = t.filter(v => v >= loFence && v <= hiFence)
  const outlierCount = n - inliers.length
  const trimmedMean = inliers.reduce((s, v) => s + v, 0) / inliers.length
  const toMs = (v) => v / 1e6
  return {
    label,
    n,
    meanMs: toMs(mean),
    sdMs: toMs(sd),
    ci95Ms: toMs(1.96 * sd / Math.sqrt(n)),
    p50Ms: toMs(q(0.50)),
    p90Ms: toMs(q(0.90)),
    p95Ms: toMs(q(0.95)),
    p99Ms: toMs(q(0.99)),
    minMs: toMs(t[0]),
    maxMs: toMs(t[n - 1]),
    opsPerSec: 1e9 / mean,
    opsPerSecP50: 1e9 / q(0.50),
    outlierCount,
    outlierPct: (outlierCount / n) * 100,
    trimmedMeanMs: toMs(trimmedMean),
  }
}

const WARMUP = 50

function bench(label, n, fn) {
  for (let i = 0; i < WARMUP; i++) fn()
  const timings = new Array(n)
  for (let i = 0; i < n; i++) {
    const s = process.hrtime.bigint()
    fn()
    timings[i] = Number(process.hrtime.bigint() - s)
  }
  return computeStats(label, timings)
}

async function benchAsync(label, n, fn) {
  for (let i = 0; i < WARMUP; i++) await fn()
  const timings = new Array(n)
  for (let i = 0; i < n; i++) {
    const s = process.hrtime.bigint()
    await fn()
    timings[i] = Number(process.hrtime.bigint() - s)
  }
  return computeStats(label, timings)
}

// ─────────────────────────────────────────────────────────────────
// Environment / exact library versions (reviewer: report measured minor versions)
// ─────────────────────────────────────────────────────────────────

function resolvedVersion(pkg) {
  try { return require(`${pkg}/package.json`).version } catch { /* exports-restricted */ }
  try {
    const p = new URL(`../../node_modules/${pkg}/package.json`, import.meta.url)
    return JSON.parse(fs.readFileSync(p, 'utf8')).version
  } catch { return 'n/a' }
}

function environmentInfo() {
  return {
    node: process.version,
    v8: process.versions.v8,
    openssl: process.versions.openssl,
    platform: `${process.platform} ${process.arch}`,
    osRelease: os.release(),
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cores: os.cpus().length,
    totalMemGB: (os.totalmem() / 1024 ** 3).toFixed(1),
    libraries: {
      jose: resolvedVersion('jose'),
      jsonld: resolvedVersion('jsonld'),
      'rdf-canonize': resolvedVersion('rdf-canonize'),
      'cbor-x': resolvedVersion('cbor-x'),
      canonicalize: resolvedVersion('canonicalize'),
      '@digitalcredentials/open-badges-context': resolvedVersion('@digitalcredentials/open-badges-context'),
      '@digitalbazaar/credentials-context': resolvedVersion('@digitalbazaar/credentials-context'),
    },
    timestamp: new Date().toISOString(),
    timerResolutionNs: measureTimerResolution(),
  }
}

function measureTimerResolution() {
  let minDelta = Infinity
  for (let i = 0; i < 1000; i++) {
    const a = process.hrtime.bigint()
    let b = process.hrtime.bigint()
    while (b === a) b = process.hrtime.bigint()
    const d = Number(b - a)
    if (d < minDelta) minDelta = d
  }
  return minDelta
}

// ─────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────

const b64url = (buf) => Buffer.from(buf).toString('base64url')

function jcsCanonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(jcsCanonical).join(',') + ']'
  return '{' + Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${jcsCanonical(v[k])}`).join(',') + '}'
}

function makeAttrs(n) {
  const attrs = {}
  for (let i = 0; i < n; i++) attrs[`attr_${String(i).padStart(3, '0')}`] = `value_${String(i).padStart(3, '0')}`
  return attrs
}

const VOCAB = 'https://example.com/vocab#'
const CRED_NS = 'https://www.w3.org/2018/credentials#'
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

function ntLit(s) { return JSON.stringify(s) }

function attrNormalize(credId, issuerId, subjectId, attrs) {
  const quads = []
  quads.push(`<${credId}> <${RDF_TYPE}> <${CRED_NS}VerifiableCredential> .`)
  quads.push(`<${credId}> <${CRED_NS}issuer> <${issuerId}> .`)
  quads.push(`<${credId}> <${CRED_NS}credentialSubject> <${subjectId}> .`)
  for (const [k, v] of Object.entries(attrs)) quads.push(`<${subjectId}> <${VOCAB}${k}> ${ntLit(v)} .`)
  return quads.sort().join('\n') + '\n'
}

// Static JSON-LD document loader (no network I/O during measurement)
async function makeStaticLoader() {
  const obCtx = await import('@digitalcredentials/open-badges-context')
  const ccCtx = await import('@digitalbazaar/credentials-context')
  const map = new Map()
  for (const [url, doc] of obCtx.contexts ?? obCtx.default.contexts) map.set(url, doc)
  for (const [url, doc] of ccCtx.contexts ?? ccCtx.default.contexts) map.set(url, doc)
  return {
    loader: (url) => {
      const doc = map.get(url)
      if (!doc) throw new Error(`Context not embedded (network disabled): ${url}`)
      return { contextUrl: null, document: doc, documentUrl: url }
    },
    urls: [...map.keys()],
  }
}

// ─────────────────────────────────────────────────────────────────
// Section A: main sign/verify — withLib uses REAL libraries
// (jose / jsonld / cbor-x), noLib uses node:crypto + hand-rolled encoding
// ─────────────────────────────────────────────────────────────────

async function sectionMain(results) {
  const { SignJWT, jwtVerify, importJWK, exportJWK } = await import('jose')
  const jsonld = (await import('jsonld')).default
  const { encode: cborEncode } = await import('cbor-x')

  // ── SD-JWT VC withLib (node:crypto Ed25519 — 表3のとおりライブラリあり/なし共通。
  //    jose は参照実装としてデシリアライズ複雑性分析に使用し、参考値として別掲)
  {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    const header = b64url(Buffer.from(JSON.stringify({ alg: 'EdDSA', crv: 'Ed25519' })))
    const payload = b64url(Buffer.from(JSON.stringify({ iss: 'https://issuer.example.com', vct: 'identity', sub: 'did:example:holder' })))
    const sigInput = `${header}.${payload}`
    results['SD-JWT VC-withLib-sign'] = bench('SD-JWT VC-withLib-sign', N, () => {
      const s = crypto.sign(null, Buffer.from(sigInput), privateKey)
      void `${sigInput}.${b64url(s)}`
    })
    const finalToken = `${sigInput}.${b64url(crypto.sign(null, Buffer.from(sigInput), privateKey))}`
    results['SD-JWT VC-withLib-verify'] = bench('SD-JWT VC-withLib-verify', N, () => {
      const parts = finalToken.split('.')
      crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], 'base64url'))
    })
  }

  // ── SD-JWT VC jose reference (full JWT pipeline incl. claims validation; 参考値)
  {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    const payload = { iss: 'https://issuer.example.com', vct: 'identity', sub: 'did:example:holder' }
    let token = ''
    results['SD-JWT VC-jose-sign'] = await benchAsync('SD-JWT VC-jose-sign (参考)', N, async () => {
      token = await new SignJWT(payload).setProtectedHeader({ alg: 'EdDSA' }).sign(privateKey)
    })
    results['SD-JWT VC-jose-verify'] = await benchAsync('SD-JWT VC-jose-verify (参考)', N, async () => {
      await jwtVerify(token, publicKey)
    })
  }

  // ── SD-JWT VC noLib (node:crypto raw)
  {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    const header = b64url(Buffer.from(JSON.stringify({ alg: 'EdDSA', crv: 'Ed25519' })))
    const payload = b64url(Buffer.from(JSON.stringify({ iss: 'https://issuer.example.com', vct: 'identity', sub: 'did:example:holder' })))
    const sigInput = `${header}.${payload}`
    results['SD-JWT VC-noLib-sign'] = bench('SD-JWT VC-noLib-sign', N, () => {
      crypto.sign(null, Buffer.from(sigInput), privateKey)
    })
    const token = `${sigInput}.${b64url(crypto.sign(null, Buffer.from(sigInput), privateKey))}`
    results['SD-JWT VC-noLib-verify'] = bench('SD-JWT VC-noLib-verify', N, () => {
      const parts = token.split('.')
      crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], 'base64url'))
    })
  }

  // ── JSON-LD VC withLib (jsonld URDNA2015 + Ed25519)
  {
    const { privateKey } = crypto.generateKeyPairSync('ed25519')
    const publicKey = crypto.createPublicKey(privateKey)
    const vcDoc = {
      '@context': [{
        '@version': 1.1, type: '@type', id: '@id',
        VerifiableCredential: `${CRED_NS}VerifiableCredential`,
        issuer: { '@id': `${CRED_NS}issuer`, '@type': '@id' },
        issuanceDate: { '@id': `${CRED_NS}issuanceDate`, '@type': 'http://www.w3.org/2001/XMLSchema#dateTime' },
        credentialSubject: `${CRED_NS}credentialSubject`,
        name: 'http://schema.org/name',
      }],
      type: 'VerifiableCredential',
      issuer: 'https://example.com',
      issuanceDate: '2024-01-01T00:00:00Z',
      credentialSubject: { id: 'did:example:1', name: 'Taro Yamada' },
    }
    const normalize = () => jsonld.normalize(vcDoc, { algorithm: 'URDNA2015', format: 'application/n-quads', safe: false })
    results['JSON-LD VC-withLib-sign'] = await benchAsync('JSON-LD VC-withLib-sign', N, async () => {
      const norm = await normalize()
      const hash = crypto.createHash('sha256').update(norm).digest()
      crypto.sign(null, hash, privateKey)
    })
    const norm0 = await normalize()
    const sig0 = crypto.sign(null, crypto.createHash('sha256').update(norm0).digest(), privateKey)
    results['JSON-LD VC-withLib-verify'] = await benchAsync('JSON-LD VC-withLib-verify', N, async () => {
      const norm = await normalize()
      const hash = crypto.createHash('sha256').update(norm).digest()
      crypto.verify(null, hash, publicKey, sig0)
    })
  }

  // ── JSON-LD VC noLib (inline N-Quads + Ed25519)
  {
    const { privateKey } = crypto.generateKeyPairSync('ed25519')
    const publicKey = crypto.createPublicKey(privateKey)
    const vc = { issuer: 'https://example.com', issuanceDate: '2024-01-01T00:00:00Z', credentialSubject: { id: 'did:example:1', name: 'Taro Yamada' } }
    const inlineNorm = () => {
      const s = '_:c14n0', sub = `<${vc.credentialSubject.id}>`
      const quads = [
        `${sub} <http://schema.org/name> "${vc.credentialSubject.name}" .`,
        `${s} <${RDF_TYPE}> <${CRED_NS}VerifiableCredential> .`,
        `${s} <${CRED_NS}credentialSubject> ${sub} .`,
        `${s} <${CRED_NS}issuanceDate> "${vc.issuanceDate}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`,
        `${s} <${CRED_NS}issuer> <${vc.issuer}> .`,
      ]
      quads.sort()
      return Buffer.from(quads.join('\n') + '\n', 'utf8')
    }
    results['JSON-LD VC-noLib-sign'] = bench('JSON-LD VC-noLib-sign', N, () => {
      crypto.sign(null, crypto.createHash('sha256').update(inlineNorm()).digest(), privateKey)
    })
    const sig0 = crypto.sign(null, crypto.createHash('sha256').update(inlineNorm()).digest(), privateKey)
    results['JSON-LD VC-noLib-verify'] = bench('JSON-LD VC-noLib-verify', N, () => {
      crypto.verify(null, crypto.createHash('sha256').update(inlineNorm()).digest(), publicKey, sig0)
    })
  }

  // ── JSON-LD VC (JCS) withLib (canonicalize + Ed25519)
  {
    const canonicalize = (await import('canonicalize')).default
    const { privateKey } = crypto.generateKeyPairSync('ed25519')
    const publicKey = crypto.createPublicKey(privateKey)
    const vcDoc = {
      '@context': { '@version': 1.1, id: '@id', type: '@type' },
      type: 'VerifiableCredential', issuer: 'https://example.com',
      issuanceDate: '2024-01-01T00:00:00Z',
      credentialSubject: { id: 'did:example:1', name: 'Taro Yamada' },
    }
    results['JSON-LD VC (JCS)-withLib-sign'] = bench('JSON-LD VC (JCS)-withLib-sign', N, () => {
      crypto.sign(null, crypto.createHash('sha256').update(canonicalize(vcDoc)).digest(), privateKey)
    })
    const sig0 = crypto.sign(null, crypto.createHash('sha256').update(canonicalize(vcDoc)).digest(), privateKey)
    results['JSON-LD VC (JCS)-withLib-verify'] = bench('JSON-LD VC (JCS)-withLib-verify', N, () => {
      crypto.verify(null, crypto.createHash('sha256').update(canonicalize(vcDoc)).digest(), publicKey, sig0)
    })
    results['JSON-LD VC (JCS)-noLib-sign'] = bench('JSON-LD VC (JCS)-noLib-sign', N, () => {
      crypto.sign(null, crypto.createHash('sha256').update(jcsCanonical(vcDoc)).digest(), privateKey)
    })
    const sig1 = crypto.sign(null, crypto.createHash('sha256').update(jcsCanonical(vcDoc)).digest(), privateKey)
    results['JSON-LD VC (JCS)-noLib-verify'] = bench('JSON-LD VC (JCS)-noLib-verify', N, () => {
      crypto.verify(null, crypto.createHash('sha256').update(jcsCanonical(vcDoc)).digest(), publicKey, sig1)
    })
  }

  // ── mdoc noLib (hand-written CBOR + ECDSA P-256 COSE_Sign1)
  {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const cborUint = (n) => n <= 23 ? Buffer.from([n]) : n <= 0xff ? Buffer.from([0x18, n]) : Buffer.from([0x19, (n >> 8) & 0xff, n & 0xff])
    const cborNeg = (n) => { const x = -1 - n; return x <= 23 ? Buffer.from([0x20 | x]) : Buffer.from([0x38, x]) }
    const cborText = (s) => { const b = Buffer.from(s, 'utf8'); const h = b.length <= 23 ? Buffer.from([0x60 | b.length]) : Buffer.from([0x78, b.length]); return Buffer.concat([h, b]) }
    const cborBytes = (b) => { const buf = Buffer.from(b); const h = buf.length <= 23 ? Buffer.from([0x40 | buf.length]) : Buffer.from([0x58, buf.length]); return Buffer.concat([h, buf]) }
    const cborMap = (...pairs) => { const n = pairs.length / 2; return Buffer.concat([n <= 23 ? Buffer.from([0xa0 | n]) : Buffer.from([0xb8, n]), ...pairs]) }
    const cborArray = (...items) => Buffer.concat([items.length <= 23 ? Buffer.from([0x80 | items.length]) : Buffer.from([0x98, items.length]), ...items])
    const mdocFields = [
      ['family_name', 'Yamada'], ['given_name', 'Taro'], ['birth_date', '1990-01-01'],
      ['issue_date', '2024-01-01'], ['expiry_date', '2029-01-01'],
      ['issuing_country', 'JP'], ['document_number', 'JP-12345678'],
    ]
    const protHdr = cborMap(cborUint(1), cborNeg(-7))
    const buildSigStruct = () => {
      const digestMap = []
      for (let i = 0; i < mdocFields.length; i++) {
        const [k, v] = mdocFields[i]
        const item = cborMap(cborUint(0), cborUint(i), cborText('elementIdentifier'), cborText(k), cborText('elementValue'), cborText(v))
        digestMap.push(cborUint(i), cborBytes(crypto.createHash('sha256').update(item).digest()))
      }
      const msoPayload = cborMap(cborText('docType'), cborText('org.iso.18013.5.1.mDL'), cborText('valueDigests'), cborMap(...digestMap))
      return cborArray(cborText('Signature1'), cborBytes(protHdr), cborBytes(Buffer.alloc(0)), cborBytes(msoPayload))
    }
    results['mdoc-noLib-sign'] = bench('mdoc-noLib-sign', N, () => {
      crypto.sign('SHA256', buildSigStruct(), { key: privateKey, dsaEncoding: 'ieee-p1363' })
    })
    const sigStruct0 = buildSigStruct()
    const sig0 = crypto.sign('SHA256', sigStruct0, { key: privateKey, dsaEncoding: 'ieee-p1363' })
    results['mdoc-noLib-verify'] = bench('mdoc-noLib-verify', N, () => {
      crypto.verify('SHA256', sigStruct0, { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig0)
    })
  }

  // ── mdoc withLib (cbor-x + ECDSA P-256 COSE_Sign1)
  {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const mdocFields = {
      family_name: 'Yamada', given_name: 'Taro', birth_date: '1990-01-01',
      issue_date: '2024-01-01', expiry_date: '2029-01-01',
      issuing_country: 'JP', document_number: 'JP-12345678',
    }
    const buildSigStruct = () => {
      const digestMap = new Map()
      let id = 0
      for (const [k, v] of Object.entries(mdocFields)) {
        const item = cborEncode({ digestID: id, elementIdentifier: k, elementValue: v })
        digestMap.set(id++, new Uint8Array(crypto.createHash('sha256').update(item).digest()))
      }
      const protHdr = cborEncode(new Map([[1, -7]]))
      const msoPayload = cborEncode({ docType: 'org.iso.18013.5.1.mDL', valueDigests: digestMap })
      return cborEncode(['Signature1', protHdr, new Uint8Array(0), msoPayload])
    }
    results['mdoc-withLib-sign'] = bench('mdoc-withLib-sign', N, () => {
      crypto.sign('SHA256', buildSigStruct(), { key: privateKey, dsaEncoding: 'ieee-p1363' })
    })
    const sigStruct0 = buildSigStruct()
    const sig0 = crypto.sign('SHA256', sigStruct0, { key: privateKey, dsaEncoding: 'ieee-p1363' })
    results['mdoc-withLib-verify'] = bench('mdoc-withLib-verify', N, () => {
      crypto.verify('SHA256', sigStruct0, { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig0)
    })
  }
}

// ─────────────────────────────────────────────────────────────────
// Section B: Ed25519-unified benchmark (Node hrtime; replaces the
// previous browser DOMHighResTimeStamp/N=50 measurement)
// ─────────────────────────────────────────────────────────────────

async function sectionEd25519Unified(results) {
  const jsonld = (await import('jsonld')).default
  const { encode: cborEncode } = await import('cbor-x')
  const FIELDS = makeAttrs(5)

  // SD-JWT VC (node:crypto Ed25519 — 表4と同一実装水準、ペイロードのみ5属性に統一)
  {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    const header = b64url(Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'vc+sd-jwt' })))
    const payloadB64 = b64url(Buffer.from(JSON.stringify({ iss: 'did:example:issuer', sub: 'did:example:sub', ...FIELDS })))
    const sigInput = `${header}.${payloadB64}`
    results['unified-SD-JWT VC-sign'] = bench('unified-SD-JWT VC-sign', N, () => {
      const s = crypto.sign(null, Buffer.from(sigInput), privateKey)
      void `${sigInput}.${b64url(s)}`
    })
    const token = `${sigInput}.${b64url(crypto.sign(null, Buffer.from(sigInput), privateKey))}`
    results['unified-SD-JWT VC-verify'] = bench('unified-SD-JWT VC-verify', N, () => {
      const parts = token.split('.')
      crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], 'base64url'))
    })
  }

  // JSON-LD VC (jsonld URDNA2015 + Ed25519) — full library pipeline
  {
    const { privateKey } = crypto.generateKeyPairSync('ed25519')
    const publicKey = crypto.createPublicKey(privateKey)
    const vcDoc = {
      '@context': [{ '@version': 1.1, id: '@id', type: '@type', '@vocab': VOCAB,
        VerifiableCredential: `${CRED_NS}VerifiableCredential`,
        issuer: { '@id': `${CRED_NS}issuer`, '@type': '@id' },
        credentialSubject: `${CRED_NS}credentialSubject` }],
      type: 'VerifiableCredential', issuer: 'did:example:issuer',
      credentialSubject: { id: 'did:example:sub', ...FIELDS },
    }
    const normalize = () => jsonld.normalize(vcDoc, { algorithm: 'URDNA2015', format: 'application/n-quads', safe: false })
    results['unified-JSON-LD VC-sign'] = await benchAsync('unified-JSON-LD VC-sign', N, async () => {
      const norm = await normalize()
      crypto.sign(null, crypto.createHash('sha256').update(norm).digest(), privateKey)
    })
    const sig0 = crypto.sign(null, crypto.createHash('sha256').update(await normalize()).digest(), privateKey)
    results['unified-JSON-LD VC-verify'] = await benchAsync('unified-JSON-LD VC-verify', N, async () => {
      const norm = await normalize()
      crypto.verify(null, crypto.createHash('sha256').update(norm).digest(), publicKey, sig0)
    })
  }

  // mdoc (cbor-x COSE_Sign1 + Ed25519, alg -8/EdDSA)
  {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    const buildSigStruct = () => {
      const digestMap = new Map()
      let id = 0
      for (const [k, v] of Object.entries(FIELDS)) {
        const item = cborEncode({ digestID: id, elementIdentifier: k, elementValue: v })
        digestMap.set(id++, new Uint8Array(crypto.createHash('sha256').update(item).digest()))
      }
      const protHdr = cborEncode(new Map([[1, -8]])) // alg: EdDSA
      const msoPayload = cborEncode({ docType: 'org.iso.18013.5.1.mDL', valueDigests: digestMap })
      return cborEncode(['Signature1', protHdr, new Uint8Array(0), msoPayload])
    }
    results['unified-mdoc-sign'] = bench('unified-mdoc-sign', N, () => {
      crypto.sign(null, buildSigStruct(), privateKey)
    })
    const sigStruct0 = buildSigStruct()
    const sig0 = crypto.sign(null, sigStruct0, privateKey)
    results['unified-mdoc-verify'] = bench('unified-mdoc-verify', N, () => {
      crypto.verify(null, sigStruct0, publicKey, sig0)
    })
  }
}

// ─────────────────────────────────────────────────────────────────
// Section C: selective disclosure (Node hrtime; replaces browser
// performance.now()/N=50 measurement that produced p50 = 0.000 ms)
// ─────────────────────────────────────────────────────────────────

async function sectionSelectiveDisclosure(results) {
  const { encode: cborEncode } = await import('cbor-x')
  const TOTAL = 20
  const attrs = makeAttrs(TOTAL)
  const attrEntries = Object.entries(attrs)
  const CRED_ID = 'urn:example:cred:seldisc'
  const ISSUER_ID = 'did:example:issuer'
  const SUBJ_ID = 'did:example:subject:001'

  const makeDisclosure = (key, value) => {
    const salt = b64url(crypto.randomBytes(16))
    const disclosure = b64url(Buffer.from(JSON.stringify([salt, key, value])))
    const hash = b64url(crypto.createHash('sha256').update(disclosure).digest())
    return { hash, disclosure, key }
  }
  const allDisclosures = attrEntries.map(([k, v]) => makeDisclosure(k, v))
  const allMdocItems = attrEntries.map(([k, v], idx) =>
    cborEncode(new Map([['digestID', idx], ['random', new Uint8Array(8)], ['elementIdentifier', k], ['elementValue', v]])))

  for (const n of [1, 3, 5, 10, 20]) {
    const hidden = allDisclosures.slice(n)
    const revealed = allDisclosures.slice(0, n)
    results[`seldisc-SD-JWT VC-${n}`] = bench(`seldisc-SD-JWT VC-${n}/${TOTAL}`, N, () => {
      const payload = {
        iss: ISSUER_ID, vct: 'https://example.com/vc',
        _sd: hidden.map(d => d.hash),
        ...Object.fromEntries(revealed.map(d => [d.key, attrs[d.key]])),
      }
      const hdr = b64url('{"alg":"EdDSA","typ":"vc+sd-jwt"}')
      const pay = b64url(Buffer.from(JSON.stringify(payload)))
      void `${hdr}.${pay}.FAKESIG~${revealed.map(d => d.disclosure).join('~')}`
    })

    const selectedItems = allMdocItems.slice(0, n)
    const NS_MDL = 'org.iso.18013.5.1'
    results[`seldisc-mdoc-${n}`] = bench(`seldisc-mdoc-${n}/${TOTAL}`, N, () => {
      cborEncode(new Map([
        ['docType', 'org.iso.18013.5.1.mDL'],
        ['issuerSigned', new Map([
          ['nameSpaces', new Map([[NS_MDL, selectedItems]])],
          ['issuerAuth', [new Uint8Array([0xa1, 0x01, 0x26]), new Map(), new Uint8Array(16), new Uint8Array(64)]],
        ])],
      ]))
    })

    const revealedAttrs = Object.fromEntries(attrEntries.slice(0, n))
    results[`seldisc-JSON-LD VC-${n}`] = bench(`seldisc-JSON-LD VC-${n}/${TOTAL}`, N, () => {
      attrNormalize(CRED_ID, ISSUER_ID, SUBJ_ID, revealedAttrs)
    })

    const jcsDoc = {
      '@context': ['https://www.w3.org/2018/credentials/v1', { '@vocab': VOCAB }],
      id: CRED_ID, type: ['VerifiableCredential'], issuer: ISSUER_ID,
      credentialSubject: { id: SUBJ_ID, ...revealedAttrs },
    }
    results[`seldisc-JSON-LD (JCS)-${n}`] = bench(`seldisc-JSON-LD (JCS)-${n}/${TOTAL}`, N, () => {
      jcsCanonical(jcsDoc)
    })
  }
}

// ─────────────────────────────────────────────────────────────────
// Section D: attribute scaling (Node hrtime, incl. URDNA2015 via jsonld)
// ─────────────────────────────────────────────────────────────────

async function sectionScaling(results, sizes) {
  const jsonld = (await import('jsonld')).default
  const { encode: cborEncode } = await import('cbor-x')

  for (const size of [5, 20, 100, 500]) {
    const attrs = makeAttrs(size)
    const attrEntries = Object.entries(attrs)

    // SD-JWT VC: JSON + base64url encode
    const sdHeader = b64url('{"alg":"EdDSA","typ":"vc+sd-jwt"}')
    const sdPayload = { iss: 'did:example:issuer', sub: 'did:example:sub', ...attrs }
    results[`scaling-SD-JWT VC-${size}`] = bench(`scaling-SD-JWT VC-${size}`, N, () => {
      void `${sdHeader}.${b64url(Buffer.from(JSON.stringify(sdPayload)))}.SIG`
    })
    sizes[`SD-JWT VC-${size}`] = `${sdHeader}.${b64url(Buffer.from(JSON.stringify(sdPayload)))}.SIG`.length

    // JSON-LD VC: jsonld URDNA2015 normalization (library)
    const vcDoc = {
      '@context': [{ '@version': 1.1, id: '@id', type: '@type', '@vocab': VOCAB,
        VerifiableCredential: `${CRED_NS}VerifiableCredential`,
        issuer: { '@id': `${CRED_NS}issuer`, '@type': '@id' },
        credentialSubject: `${CRED_NS}credentialSubject` }],
      id: 'urn:example:cred:scaling', type: 'VerifiableCredential',
      issuer: 'did:example:issuer',
      credentialSubject: { id: 'did:example:sub', ...attrs },
    }
    const nJld = size >= 100 ? Math.max(Math.floor(N / 5), 20) : N
    results[`scaling-JSON-LD VC-${size}`] = await benchAsync(`scaling-JSON-LD VC-${size}`, nJld, async () => {
      await jsonld.normalize(vcDoc, { algorithm: 'URDNA2015', format: 'application/n-quads', safe: false })
    })
    sizes[`JSON-LD VC-${size}`] = (await jsonld.normalize(vcDoc, { algorithm: 'URDNA2015', format: 'application/n-quads', safe: false })).length

    // JSON-LD VC (JCS)
    results[`scaling-JSON-LD VC (JCS)-${size}`] = bench(`scaling-JSON-LD VC (JCS)-${size}`, N, () => {
      jcsCanonical(vcDoc)
    })
    sizes[`JSON-LD VC (JCS)-${size}`] = jcsCanonical(vcDoc).length

    // mdoc: cbor-x encode
    const mdocDoc = {
      docType: 'org.iso.18013.5.1.mDL',
      items: attrEntries.map(([k, v], i) => ({ digestID: i, elementIdentifier: k, elementValue: v })),
    }
    results[`scaling-mdoc-${size}`] = bench(`scaling-mdoc-${size}`, N, () => { cborEncode(mdocDoc) })
    sizes[`mdoc-${size}`] = cborEncode(mdocDoc).length
  }
}

// ─────────────────────────────────────────────────────────────────
// Section E: URDNA2015 on complex credentials with blank nodes
// (OpenBadges v3.0, JFF Plugfest profile, DCC-style, synthetic)
// ─────────────────────────────────────────────────────────────────

function makeOb3Credential(contextUrl) {
  // Modeled on the 1EdTech OB 3.0 "complete" example / JFF Plugfest 3 credential.
  // `criteria`, `alignment`, `proof`-free achievement subtree contain nodes WITHOUT
  // `id` → blank nodes in the RDF dataset → exercises URDNA2015 blank-node labeling.
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2', contextUrl],
    id: 'urn:uuid:a63a60be-f4af-491c-87fc-2c8fd3007a58',
    type: ['VerifiableCredential', 'OpenBadgeCredential'],
    issuer: {
      id: 'https://university.example/issuers/565049',
      type: ['Profile'],
      name: 'Example University',
      url: 'https://university.example',
      email: 'registrar@university.example',
    },
    validFrom: '2026-01-01T00:00:00Z',
    name: 'Digital Credentials Achievement',
    credentialSubject: {
      id: 'did:example:ebfeb1f712ebc6f1c276e12ec21',
      type: ['AchievementSubject'],
      achievement: {
        id: 'https://university.example/achievements/degree-cs',
        type: ['Achievement'],
        name: 'Bachelor of Science in Computer Science',
        description: 'Awarded for the successful completion of the undergraduate program in Computer Science.',
        criteria: {
          type: 'Criteria',
          narrative: 'Completion of 124 credit hours including the capstone project, with a cumulative GPA of 2.0 or higher.',
        },
        alignment: [
          {
            type: ['Alignment'],
            targetName: 'CS Curriculum Standard',
            targetUrl: 'https://credentialengineregistry.org/resources/ce-6369c51f',
            targetType: 'ceterms:Certification',
          },
          {
            type: ['Alignment'],
            targetName: 'European Qualifications Framework Level 6',
            targetUrl: 'https://europa.eu/europass/eqf/6',
            targetType: 'ceterms:QualityAssuranceCredential',
          },
        ],
      },
      result: [
        { type: ['Result'], value: '3.7', status: 'Completed' },
      ],
    },
  }
}

function makeDccStyleCredential(obContextUrl) {
  // DCC (Digital Credentials Consortium) style academic degree credential —
  // DCC issues OB3-profile credentials; sample modeled on
  // https://github.com/digitalcredentials sample issuances.
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2', obContextUrl],
    id: 'urn:uuid:2fe53dc9-b2ec-4939-9b2c-0d00f6663b6c',
    type: ['VerifiableCredential', 'OpenBadgeCredential'],
    issuer: {
      id: 'did:key:z6MkhVTX9BF3NGYX6cc7jWpbNnR7cAjH8LUffabZP8Qu4ysC',
      type: ['Profile'],
      name: 'DCC Test Issuer',
      url: 'https://digitalcredentials.mit.edu',
      image: {
        id: 'https://certificates.cs50.io/static/success.jpg',
        type: 'Image',
      },
    },
    validFrom: '2026-01-01T00:00:00Z',
    name: 'Successful Installation',
    credentialSubject: {
      type: ['AchievementSubject'],
      name: 'Me!',
      achievement: {
        id: 'urn:uuid:bd6d9316-f7ae-4073-a1e5-2f7f5bd22922',
        type: ['Achievement'],
        achievementType: 'Diploma',
        name: 'Your Installation',
        description: 'This badge certifies the successful installation of the DCC issuer.',
        criteria: {
          type: 'Criteria',
          narrative: 'Successfully installed the DCC issuer and issued a test credential.',
        },
      },
    },
  }
}

function makeSyntheticBlankNodeCredential(blankNodes) {
  // Synthetic credential with `blankNodes` id-less child nodes.
  const children = []
  for (let i = 0; i < blankNodes; i++) {
    children.push({ type: 'Evidence', narrative: `evidence item ${i}`, weight: String(i) })
  }
  return {
    '@context': [{ '@version': 1.1, id: '@id', type: '@type', '@vocab': VOCAB,
      VerifiableCredential: `${CRED_NS}VerifiableCredential`,
      issuer: { '@id': `${CRED_NS}issuer`, '@type': '@id' },
      credentialSubject: `${CRED_NS}credentialSubject` }],
    id: 'urn:example:cred:synthetic', type: 'VerifiableCredential',
    issuer: 'did:example:issuer',
    credentialSubject: { id: 'did:example:sub', evidence: children },
  }
}

async function sectionComplexCredentials(results, meta) {
  const jsonld = (await import('jsonld')).default
  const obCtx = await import('@digitalcredentials/open-badges-context')
  const ob = obCtx.default ?? obCtx
  const { loader } = await makeStaticLoader()

  const OB_URL = ob.CONTEXT_URL_V3_0_3 ?? 'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json'

  const docs = {
    'simple (paper §4.3, 0 blank nodes)': {
      doc: {
        '@context': [{ '@version': 1.1, type: '@type', id: '@id',
          VerifiableCredential: `${CRED_NS}VerifiableCredential`,
          issuer: { '@id': `${CRED_NS}issuer`, '@type': '@id' },
          issuanceDate: { '@id': `${CRED_NS}issuanceDate`, '@type': 'http://www.w3.org/2001/XMLSchema#dateTime' },
          credentialSubject: `${CRED_NS}credentialSubject`,
          name: 'http://schema.org/name' }],
        type: 'VerifiableCredential', issuer: 'https://example.com',
        issuanceDate: '2024-01-01T00:00:00Z',
        credentialSubject: { id: 'did:example:1', name: 'Taro Yamada' },
      },
      key: 'complex-simple',
    },
    'OpenBadges v3.0 (1EdTech)': { doc: makeOb3Credential(OB_URL), key: 'complex-ob3' },
    'DCC-style OB3 credential': { doc: makeDccStyleCredential(OB_URL), key: 'complex-dcc' },
    'synthetic 10 blank nodes': { doc: makeSyntheticBlankNodeCredential(10), key: 'complex-syn10' },
    'synthetic 50 blank nodes': { doc: makeSyntheticBlankNodeCredential(50), key: 'complex-syn50' },
  }

  for (const [label, { doc, key }] of Object.entries(docs)) {
    const opts = { algorithm: 'URDNA2015', format: 'application/n-quads', safe: false, documentLoader: loader }
    const nq = await jsonld.normalize(doc, opts)
    const quads = nq.split('\n').filter(Boolean)
    const bnodeLabels = new Set()
    for (const q of quads) for (const m of q.matchAll(/_:c14n\d+/g)) bnodeLabels.add(m[0])
    meta[key] = { label, quads: quads.length, blankNodes: bnodeLabels.size, nquadsBytes: Buffer.byteLength(nq) }
    const nIter = quads.length > 100 ? Math.max(Math.floor(N / 10), 20) : Math.max(Math.floor(N / 2), 50)
    results[key] = await benchAsync(key, nIter, async () => {
      await jsonld.normalize(doc, opts)
    })
  }
}

// ─────────────────────────────────────────────────────────────────
// Section F: serialization-only (表9) + JSON-LD sign breakdown (表5)
// ─────────────────────────────────────────────────────────────────

async function sectionSerialization(results, sizes) {
  const jsonld = (await import('jsonld')).default
  const { encode: cborEncode, decode: cborDecode } = await import('cbor-x')

  // SD-JWT VC encode/decode
  const sdPayload = {
    iss: 'https://issuer.example.com', iat: 0, exp: 3600,
    vct: 'https://credentials.example.com/identity', sub: 'did:example:holder123',
    given_name: 'Taro', family_name: 'Yamada', birthdate: '1990-01-01',
  }
  const sdHeader = b64url(Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'vc+sd-jwt' })))
  results['serial-SD-JWT VC-encode'] = bench('serial-SD-JWT VC-encode', N, () => {
    void `${sdHeader}.${b64url(Buffer.from(JSON.stringify(sdPayload)))}.AAABBB`
  })
  const sdToken = `${sdHeader}.${b64url(Buffer.from(JSON.stringify(sdPayload)))}.AAABBB`
  sizes['serial-SD-JWT VC'] = sdToken.length
  results['serial-SD-JWT VC-decode'] = bench('serial-SD-JWT VC-decode', N, () => {
    const [h64, p64] = sdToken.split('.')
    JSON.parse(Buffer.from(h64, 'base64url').toString())
    JSON.parse(Buffer.from(p64, 'base64url').toString())
  })

  // JSON-LD VC raw JSON encode/decode + URDNA2015 normalize (withLib)
  const jldDoc = {
    '@context': [{ '@version': 1.1, id: '@id', type: '@type',
      VerifiableCredential: `${CRED_NS}VerifiableCredential`,
      issuer: { '@id': `${CRED_NS}issuer`, '@type': '@id' },
      issuanceDate: { '@id': `${CRED_NS}issuanceDate`, '@type': 'http://www.w3.org/2001/XMLSchema#dateTime' },
      credentialSubject: `${CRED_NS}credentialSubject`,
      name: 'http://schema.org/name' }],
    type: 'VerifiableCredential', issuer: 'https://example.com',
    issuanceDate: '2024-01-01T00:00:00Z',
    credentialSubject: { id: 'did:example:1', name: 'Taro Yamada' },
  }
  const jldStr = JSON.stringify(jldDoc)
  results['serial-JSON-LD VC-encode'] = bench('serial-JSON-LD VC-encode', N, () => { JSON.stringify(jldDoc) })
  results['serial-JSON-LD VC-decode'] = bench('serial-JSON-LD VC-decode', N, () => { JSON.parse(jldStr) })
  results['serial-JSON-LD VC-normalize-withLib'] = await benchAsync('serial-JSON-LD VC-normalize-withLib', N, async () => {
    await jsonld.normalize(jldDoc, { algorithm: 'URDNA2015', format: 'application/n-quads', safe: false })
  })
  const nq = await jsonld.normalize(jldDoc, { algorithm: 'URDNA2015', format: 'application/n-quads', safe: false })
  sizes['serial-JSON-LD VC-normalized'] = Buffer.byteLength(nq)

  // JCS canonicalize
  results['serial-JSON-LD VC (JCS)-canonicalize'] = bench('serial-JSON-LD VC (JCS)-canonicalize', N, () => { jcsCanonical(jldDoc) })
  sizes['serial-JSON-LD VC (JCS)-canonical'] = Buffer.byteLength(jcsCanonical(jldDoc))

  // mdoc cbor-x encode/decode
  const mdocFields = [
    ['family_name', 'Yamada'], ['given_name', 'Taro'], ['birth_date', '1990-01-01'],
    ['issue_date', '2024-01-01'], ['expiry_date', '2029-01-01'],
    ['issuing_country', 'JP'], ['document_number', 'JP-12345678'],
  ]
  const mdocLibDoc = {
    docType: 'org.iso.18013.5.1.mDL',
    items: mdocFields.map(([k, v], i) => ({ digestID: i, elementIdentifier: k, elementValue: v })),
  }
  const mdocEncoded = cborEncode(mdocLibDoc)
  sizes['serial-mdoc'] = mdocEncoded.length
  results['serial-mdoc-encode'] = bench('serial-mdoc-encode', N, () => { cborEncode(mdocLibDoc) })
  results['serial-mdoc-decode'] = bench('serial-mdoc-decode', N, () => { cborDecode(mdocEncoded) })

  // JSON-LD VC sign-pipeline breakdown (表5): normalize / hash / sign measured separately
  const { privateKey } = crypto.generateKeyPairSync('ed25519')
  results['breakdown-normalize'] = await benchAsync('breakdown-normalize (URDNA2015 withLib)', N, async () => {
    await jsonld.normalize(jldDoc, { algorithm: 'URDNA2015', format: 'application/n-quads', safe: false })
  })
  const hashInput = Buffer.from(nq)
  results['breakdown-hash'] = bench('breakdown-hash (SHA-256)', N, () => {
    crypto.createHash('sha256').update(hashInput).digest()
  })
  const hash0 = crypto.createHash('sha256').update(hashInput).digest()
  results['breakdown-sign'] = bench('breakdown-sign (Ed25519)', N, () => {
    crypto.sign(null, hash0, privateKey)
  })
}

// ─────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────

const f3 = (v) => v.toFixed(3)
const f1 = (v) => v.toFixed(1)

function printTable(title, keys, results) {
  console.log(`\n## ${title}\n`)
  console.log('| ベンチマーク | N | 平均(ms) | σ(ms) | 95%CI(±ms) | p50(ms) | p95(ms) | 外れ値数(%) | ops/sec |')
  console.log('|---|---|---|---|---|---|---|---|---|')
  for (const k of keys) {
    const r = results[k]
    if (!r) continue
    console.log(`| ${r.label} | ${r.n} | ${f3(r.meanMs)} | ${f3(r.sdMs)} | ${f3(r.ci95Ms)} | ${f3(r.p50Ms)} | ${f3(r.p95Ms)} | ${r.outlierCount} (${f1(r.outlierPct)}%) | ${Math.round(r.opsPerSec).toLocaleString()} |`)
  }
}

// ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`paperBench: N=${N} (JSON-LD withLib / complex credentials use reduced N where noted)`)
  const env = environmentInfo()
  console.log('環境:', JSON.stringify(env, null, 2))

  const results = {}
  const sizes = {}
  const complexMeta = {}

  console.log('\n[A] 署名・検証ベンチマーク...')
  await sectionMain(results)
  console.log('[B] Ed25519統一ベンチマーク...')
  await sectionEd25519Unified(results)
  console.log('[C] 選択的開示ベンチマーク...')
  await sectionSelectiveDisclosure(results)
  console.log('[D] 属性数スケーリング...')
  await sectionScaling(results, sizes)
  console.log('[E] 複雑クレデンシャル URDNA2015...')
  await sectionComplexCredentials(results, complexMeta)
  console.log('[F] シリアライズ・内訳...')
  await sectionSerialization(results, sizes)

  printTable('A. 署名・検証（表4/表7相当）', Object.keys(results).filter(k => /withLib|noLib/.test(k)), results)
  printTable('B. Ed25519統一（表15相当）', Object.keys(results).filter(k => k.startsWith('unified-')), results)
  printTable('C. 選択的開示（表12相当）', Object.keys(results).filter(k => k.startsWith('seldisc-')), results)
  printTable('D. 属性数スケーリング（表11相当）', Object.keys(results).filter(k => k.startsWith('scaling-')), results)
  printTable('E. 複雑クレデンシャル URDNA2015', Object.keys(results).filter(k => k.startsWith('complex-')), results)
  printTable('F. シリアライズ（表9相当）・内訳（表5相当）', Object.keys(results).filter(k => k.startsWith('serial-') || k.startsWith('breakdown-')), results)

  console.log('\n## E. 複雑クレデンシャルのメタ情報\n')
  for (const [k, m] of Object.entries(complexMeta)) {
    console.log(`- ${m.label}: quads=${m.quads}, blankNodes=${m.blankNodes}, nquads=${m.nquadsBytes}B`)
  }
  console.log('\n## ペイロードサイズ (スケーリング)\n', JSON.stringify(sizes))

  fs.writeFileSync(OUT, JSON.stringify({ env, results, sizes, complexMeta }, null, 2))
  console.log(`\n結果を ${OUT} に保存しました`)
}

main().catch(e => { console.error(e); process.exit(1) })
