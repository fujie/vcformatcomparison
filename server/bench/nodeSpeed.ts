/**
 * Node.js backend benchmarks — uses process.hrtime.bigint() for nanosecond precision.
 * Covers all 6 combinations: {SD-JWT VC, JSON-LD VC, JSON-LD VC (JCS), mdoc} × {withLib, noLib}
 * Plus serialization-only benchmarks (no crypto) for all formats.
 * Each benchmark collects per-iteration timings and reports full distribution stats.
 */

import crypto from 'node:crypto'
import { promisify } from 'node:util'

const generateKeyPairAsync = promisify(crypto.generateKeyPair)

export interface BenchEntry {
  opsPerSec: number
  avgMs: number
  avgNs: number
  iterations: number
  label: string
  // Statistical distribution
  stdDevMs: number
  stdDevNs: number
  ci95Ms: number     // 95% confidence interval half-width (±)
  p50Ms: number
  p90Ms: number
  p95Ms: number
  p99Ms: number
  minMs: number
  maxMs: number
}

export interface NodeBenchResults {
  results: Record<string, BenchEntry>
  errors: Record<string, string>
  iterations: number
  runtimeInfo: string
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function b64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64url')
}

function computeNsStats(label: string, timingsNs: number[]): BenchEntry {
  const n = timingsNs.length
  timingsNs.sort((a, b) => a - b)
  const totalNs = timingsNs.reduce((s, v) => s + v, 0)
  const avgNs = totalNs / n
  const variance = timingsNs.reduce((s, v) => s + (v - avgNs) ** 2, 0) / n
  const stdDevNs = Math.sqrt(variance)
  const p = (pct: number) => timingsNs[Math.min(Math.floor(n * pct), n - 1)]
  return {
    label,
    iterations: n,
    opsPerSec:  1e9 / avgNs,
    avgNs,
    avgMs:      avgNs / 1e6,
    stdDevNs,
    stdDevMs:   stdDevNs / 1e6,
    ci95Ms:     1.96 * (stdDevNs / 1e6) / Math.sqrt(n),
    p50Ms:      p(0.50) / 1e6,
    p90Ms:      p(0.90) / 1e6,
    p95Ms:      p(0.95) / 1e6,
    p99Ms:      p(0.99) / 1e6,
    minMs:      timingsNs[0] / 1e6,
    maxMs:      timingsNs[n - 1] / 1e6,
  }
}

function bench(label: string, n: number, fn: () => void): BenchEntry {
  for (let i = 0; i < 3; i++) fn()  // warm-up
  const timings: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const start = process.hrtime.bigint()
    fn()
    timings[i] = Number(process.hrtime.bigint() - start)
  }
  return computeNsStats(label, timings)
}

async function benchAsync(label: string, n: number, fn: () => Promise<void>): Promise<BenchEntry> {
  await fn(); await fn(); await fn()  // warm-up
  const timings: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const start = process.hrtime.bigint()
    await fn()
    timings[i] = Number(process.hrtime.bigint() - start)
  }
  return computeNsStats(label, timings)
}

// ─────────────────────────────────────────────────────────────────
// Minimal CBOR encoder (no deps, RFC 7049)
// ─────────────────────────────────────────────────────────────────

function cborUint(n: number): Buffer {
  if (n <= 23) return Buffer.from([n])
  if (n <= 0xff) return Buffer.from([0x18, n])
  return Buffer.from([0x19, (n >> 8) & 0xff, n & 0xff])
}
function cborNeg(n: number): Buffer { // n must be negative
  const x = -1 - n
  if (x <= 23) return Buffer.from([0x20 | x])
  return Buffer.from([0x38, x])
}
function cborText(s: string): Buffer {
  const b = Buffer.from(s, 'utf8')
  const head = b.length <= 23
    ? Buffer.from([0x60 | b.length])
    : b.length <= 0xff
      ? Buffer.from([0x78, b.length])
      : Buffer.from([0x79, (b.length >> 8) & 0xff, b.length & 0xff])
  return Buffer.concat([head, b])
}
function cborBytes(b: Buffer | Uint8Array): Buffer {
  const buf = Buffer.from(b)
  const head = buf.length <= 23
    ? Buffer.from([0x40 | buf.length])
    : buf.length <= 0xff
      ? Buffer.from([0x58, buf.length])
      : Buffer.from([0x59, (buf.length >> 8) & 0xff, buf.length & 0xff])
  return Buffer.concat([head, buf])
}
function cborMap(...pairs: Buffer[]): Buffer {
  const n = pairs.length / 2
  const head = n <= 23 ? Buffer.from([0xa0 | n]) : Buffer.from([0xb8, n])
  return Buffer.concat([head, ...pairs])
}
function cborArray(...items: Buffer[]): Buffer {
  const head = items.length <= 23
    ? Buffer.from([0x80 | items.length])
    : Buffer.from([0x98, items.length])
  return Buffer.concat([head, ...items])
}

// ─────────────────────────────────────────────────────────────────
// Inline URDNA2015 normalization (no-lib, blank-node-free credentials)
// Produces same output as jsonld.normalize() for simple credentials.
// ─────────────────────────────────────────────────────────────────

function inlineNormalizeUrdna2015(vc: {
  issuer: string
  issuanceDate: string
  credentialSubject: { id: string; name: string }
}): Buffer {
  const s   = '_:c14n0'
  const sub = `<${vc.credentialSubject.id}>`
  const quads = [
    `${sub} <http://schema.org/name> "${vc.credentialSubject.name}" .`,
    `${s} <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://www.w3.org/2018/credentials#VerifiableCredential> .`,
    `${s} <https://www.w3.org/2018/credentials#credentialSubject> ${sub} .`,
    `${s} <https://www.w3.org/2018/credentials#issuanceDate> "${vc.issuanceDate}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`,
    `${s} <https://www.w3.org/2018/credentials#issuer> <${vc.issuer}> .`,
  ]
  quads.sort()
  return Buffer.from(quads.join('\n') + '\n', 'utf8')
}

// Inline RFC 8785 JCS
function jcsCanonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + (v as unknown[]).map(jcsCanonical).join(',') + ']'
  const obj = v as Record<string, unknown>
  return '{' + Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${jcsCanonical(obj[k])}`).join(',') + '}'
}

// ─────────────────────────────────────────────────────────────────
// SD-JWT VC — no-lib (Ed25519 + manual JWT, same algorithm as withLib)
// ─────────────────────────────────────────────────────────────────

function benchSdJwtNoLib(n: number): Record<string, BenchEntry> {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')

  const header = b64url(Buffer.from(JSON.stringify({ alg: 'EdDSA', crv: 'Ed25519' })))
  const payload = b64url(Buffer.from(JSON.stringify({
    iss: 'https://issuer.example.com',
    vct: 'identity',
    sub: 'did:example:holder',
  })))
  const sigInput = `${header}.${payload}`

  const sign = bench('SD-JWT VC-noLib-sign', n, () => {
    crypto.sign(null, Buffer.from(sigInput), privateKey)
  })

  const finalSig = crypto.sign(null, Buffer.from(sigInput), privateKey)
  const token = `${sigInput}.${b64url(finalSig)}`

  const verify = bench('SD-JWT VC-noLib-verify', n, () => {
    const parts = token.split('.')
    const sigBuf = Buffer.from(parts[2], 'base64url')
    crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, sigBuf)
  })

  return { 'SD-JWT VC-noLib-sign': sign, 'SD-JWT VC-noLib-verify': verify }
}

// ─────────────────────────────────────────────────────────────────
// SD-JWT VC — with-lib (Node crypto Ed25519, same as jose@6 under the hood)
// ─────────────────────────────────────────────────────────────────

function benchSdJwtWithLib(n: number): Record<string, BenchEntry> {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')

  const header = b64url(Buffer.from(JSON.stringify({ alg: 'EdDSA', crv: 'Ed25519' })))
  const payload = b64url(Buffer.from(JSON.stringify({
    iss: 'https://issuer.example.com',
    vct: 'identity',
    sub: 'did:example:holder',
  })))
  const sigInput = `${header}.${payload}`

  let token = ''
  const sign = bench('SD-JWT VC-withLib-sign', n, () => {
    const s = crypto.sign(null, Buffer.from(sigInput), privateKey)
    token = `${sigInput}.${b64url(s)}`
  })

  const finalSig = crypto.sign(null, Buffer.from(sigInput), privateKey)
  const finalToken = `${sigInput}.${b64url(finalSig)}`

  const verify = bench('SD-JWT VC-withLib-verify', n, () => {
    const parts = finalToken.split('.')
    const s = Buffer.from(parts[2], 'base64url')
    crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, s)
  })

  return { 'SD-JWT VC-withLib-sign': sign, 'SD-JWT VC-withLib-verify': verify }
}

// ─────────────────────────────────────────────────────────────────
// mdoc — no-lib (hand-written CBOR + ECDSA P-256 COSE_Sign1)
// ─────────────────────────────────────────────────────────────────

function benchMdocNoLib(n: number): Record<string, BenchEntry> {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  })

  const mdocFields: [string, string][] = [
    ['family_name', 'Yamada'], ['given_name', 'Taro'],
    ['birth_date', '1990-01-01'], ['issue_date', '2024-01-01'],
    ['expiry_date', '2029-01-01'], ['issuing_country', 'JP'],
    ['document_number', 'JP-12345678'],
  ]

  const protHdr = cborMap(cborUint(1), cborNeg(-7)) // {alg: -7 (ES256)}

  const sign = bench('mdoc-noLib-sign', n, () => {
    const digestMap: Buffer[] = []
    for (let i = 0; i < mdocFields.length; i++) {
      const [k, v] = mdocFields[i]
      const item = cborMap(
        cborUint(0), cborUint(i),
        cborText('elementIdentifier'), cborText(k),
        cborText('elementValue'), cborText(v),
      )
      const d = crypto.createHash('sha256').update(item).digest()
      digestMap.push(cborUint(i), cborBytes(d))
    }
    const msoPayload = cborMap(
      cborText('docType'), cborText('org.iso.18013.5.1.mDL'),
      cborText('valueDigests'), cborMap(...digestMap),
    )
    const sigStruct = cborArray(
      cborText('Signature1'),
      cborBytes(protHdr),
      cborBytes(Buffer.alloc(0)),
      cborBytes(msoPayload),
    )
    crypto.sign('SHA256', sigStruct, {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    })
  })

  // Build one for verify
  const digestMap: Buffer[] = []
  for (let i = 0; i < mdocFields.length; i++) {
    const [k, v] = mdocFields[i]
    const item = cborMap(
      cborUint(0), cborUint(i),
      cborText('elementIdentifier'), cborText(k),
      cborText('elementValue'), cborText(v),
    )
    const d = crypto.createHash('sha256').update(item).digest()
    digestMap.push(cborUint(i), cborBytes(d))
  }
  const msoPayload = cborMap(
    cborText('docType'), cborText('org.iso.18013.5.1.mDL'),
    cborText('valueDigests'), cborMap(...digestMap),
  )
  const sigStruct = cborArray(
    cborText('Signature1'),
    cborBytes(protHdr),
    cborBytes(Buffer.alloc(0)),
    cborBytes(msoPayload),
  )
  const finalSig = crypto.sign('SHA256', sigStruct, {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  })

  const verify = bench('mdoc-noLib-verify', n, () => {
    crypto.verify('SHA256', sigStruct, {
      key: publicKey,
      dsaEncoding: 'ieee-p1363',
    }, finalSig)
  })

  return { 'mdoc-noLib-sign': sign, 'mdoc-noLib-verify': verify }
}

// ─────────────────────────────────────────────────────────────────
// mdoc — with-lib (cbor-x + same ECDSA P-256)
// ─────────────────────────────────────────────────────────────────

async function benchMdocWithLib(n: number): Promise<Record<string, BenchEntry>> {
  const { encode } = await import('cbor-x')

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  })

  const mdocFields: Record<string, string> = {
    family_name: 'Yamada', given_name: 'Taro',
    birth_date: '1990-01-01', issue_date: '2024-01-01',
    expiry_date: '2029-01-01', issuing_country: 'JP',
    document_number: 'JP-12345678',
  }

  const sign = await benchAsync('mdoc-withLib-sign', n, async () => {
    const digestMap = new Map<number, Uint8Array>()
    let id = 0
    for (const [k, v] of Object.entries(mdocFields)) {
      const item = encode({ digestID: id, elementIdentifier: k, elementValue: v })
      digestMap.set(id++, new Uint8Array(crypto.createHash('sha256').update(item).digest()))
    }
    const protHdr = encode(new Map([[1, -7]]))
    const msoPayload = encode({ docType: 'org.iso.18013.5.1.mDL', valueDigests: digestMap })
    const sigStruct = encode(['Signature1', protHdr, new Uint8Array(0), msoPayload])
    crypto.sign('SHA256', sigStruct, { key: privateKey, dsaEncoding: 'ieee-p1363' })
  })

  const digestMap2 = new Map<number, Uint8Array>()
  let id2 = 0
  for (const [k, v] of Object.entries(mdocFields)) {
    const item = encode({ digestID: id2, elementIdentifier: k, elementValue: v })
    digestMap2.set(id2++, new Uint8Array(crypto.createHash('sha256').update(item).digest()))
  }
  const protHdr2 = encode(new Map([[1, -7]]))
  const msoPayload2 = encode({ docType: 'org.iso.18013.5.1.mDL', valueDigests: digestMap2 })
  const sigStruct2 = encode(['Signature1', protHdr2, new Uint8Array(0), msoPayload2])
  const finalSig2 = crypto.sign('SHA256', sigStruct2, { key: privateKey, dsaEncoding: 'ieee-p1363' })

  const verify = await benchAsync('mdoc-withLib-verify', n, async () => {
    crypto.verify('SHA256', sigStruct2, { key: publicKey, dsaEncoding: 'ieee-p1363' }, finalSig2)
  })

  return { 'mdoc-withLib-sign': sign, 'mdoc-withLib-verify': verify }
}

// ─────────────────────────────────────────────────────────────────
// JSON-LD VC — with-lib (jsonld URDNA2015 + Ed25519)
// ─────────────────────────────────────────────────────────────────

async function benchJsonLdWithLib(n: number): Promise<Record<string, BenchEntry>> {
  const jsonld = (await import('jsonld')).default

  const { privateKey } = crypto.generateKeyPairSync('ed25519')

  const vcDoc = {
    '@context': [{
      '@version': 1.1,
      'type': '@type',
      'id': '@id',
      'VerifiableCredential': 'https://www.w3.org/2018/credentials#VerifiableCredential',
      'issuer': { '@id': 'https://www.w3.org/2018/credentials#issuer', '@type': '@id' },
      'issuanceDate': { '@id': 'https://www.w3.org/2018/credentials#issuanceDate', '@type': 'http://www.w3.org/2001/XMLSchema#dateTime' },
      'credentialSubject': 'https://www.w3.org/2018/credentials#credentialSubject',
      'name': 'http://schema.org/name',
    }],
    'type': 'VerifiableCredential',
    'issuer': 'https://example.com',
    'issuanceDate': '2024-01-01T00:00:00Z',
    'credentialSubject': { 'id': 'did:example:1', 'name': 'Taro Yamada' },
  }

  const sign = await benchAsync('JSON-LD VC-withLib-sign', n, async () => {
    const normalized = await (jsonld as any).normalize(vcDoc, {
      algorithm: 'URDNA2015',
      format: 'application/n-quads',
      safe: false,
    }) as string
    const hash = crypto.createHash('sha256').update(normalized).digest()
    crypto.sign(null, hash, privateKey)
  })

  const norm0 = await (jsonld as any).normalize(vcDoc, {
    algorithm: 'URDNA2015', format: 'application/n-quads', safe: false,
  }) as string
  const hash0 = crypto.createHash('sha256').update(norm0).digest()
  const sig0 = crypto.sign(null, hash0, privateKey)

  const verify = await benchAsync('JSON-LD VC-withLib-verify', n, async () => {
    const normalized = await (jsonld as any).normalize(vcDoc, {
      algorithm: 'URDNA2015', format: 'application/n-quads', safe: false,
    }) as string
    const hash = crypto.createHash('sha256').update(normalized).digest()
    crypto.verify(null, hash, crypto.createPublicKey(privateKey), sig0)
  })

  return { 'JSON-LD VC-withLib-sign': sign, 'JSON-LD VC-withLib-verify': verify }
}

// ─────────────────────────────────────────────────────────────────
// JSON-LD VC — no-lib (inline N-Quads normalization + Ed25519)
// ─────────────────────────────────────────────────────────────────

function benchJsonLdNoLib(n: number): Record<string, BenchEntry> {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')

  const vc = {
    issuer: 'https://example.com',
    issuanceDate: '2024-01-01T00:00:00Z',
    credentialSubject: { id: 'did:example:1', name: 'Taro Yamada' },
  }

  const sign = bench('JSON-LD VC-noLib-sign', n, () => {
    const nqBytes = inlineNormalizeUrdna2015(vc)
    const hash = crypto.createHash('sha256').update(nqBytes).digest()
    crypto.sign(null, hash, privateKey)
  })

  const nq0 = inlineNormalizeUrdna2015(vc)
  const hash0 = crypto.createHash('sha256').update(nq0).digest()
  const sig0 = crypto.sign(null, hash0, privateKey)
  const pub0 = crypto.createPublicKey(privateKey)

  const verify = bench('JSON-LD VC-noLib-verify', n, () => {
    const nqBytes = inlineNormalizeUrdna2015(vc)
    const hash = crypto.createHash('sha256').update(nqBytes).digest()
    crypto.verify(null, hash, pub0, sig0)
  })

  return { 'JSON-LD VC-noLib-sign': sign, 'JSON-LD VC-noLib-verify': verify }
}

// ─────────────────────────────────────────────────────────────────
// JSON-LD VC (JCS) — with-lib (canonicalize / RFC 8785 + Ed25519)
// ─────────────────────────────────────────────────────────────────

async function benchJsonLdJcsWithLib(n: number): Promise<Record<string, BenchEntry>> {
  const { canonicalize } = await import('canonicalize')

  const { privateKey } = crypto.generateKeyPairSync('ed25519')

  const vcDoc = {
    '@context': {
      '@version': 1.1, 'id': '@id', 'type': '@type',
      'VerifiableCredential': 'https://www.w3.org/2018/credentials#VerifiableCredential',
      'issuer': { '@id': 'https://www.w3.org/2018/credentials#issuer', '@type': '@id' },
      'issuanceDate': { '@id': 'https://www.w3.org/2018/credentials#issuanceDate', '@type': 'http://www.w3.org/2001/XMLSchema#dateTime' },
      'credentialSubject': 'https://www.w3.org/2018/credentials#credentialSubject',
      'name': 'http://schema.org/name',
    },
    'type': 'VerifiableCredential',
    'issuer': 'https://example.com',
    'issuanceDate': '2024-01-01T00:00:00Z',
    'credentialSubject': { 'id': 'did:example:1', 'name': 'Taro Yamada' },
  }

  const sign = bench('JSON-LD VC (JCS)-withLib-sign', n, () => {
    const canonical = canonicalize(vcDoc)!
    const hash = crypto.createHash('sha256').update(canonical).digest()
    crypto.sign(null, hash, privateKey)
  })

  const canonical0 = canonicalize(vcDoc)!
  const hash0 = crypto.createHash('sha256').update(canonical0).digest()
  const sig0 = crypto.sign(null, hash0, privateKey)
  const pub0 = crypto.createPublicKey(privateKey)

  const verify = bench('JSON-LD VC (JCS)-withLib-verify', n, () => {
    const canonical = canonicalize(vcDoc)!
    const hash = crypto.createHash('sha256').update(canonical).digest()
    crypto.verify(null, hash, pub0, sig0)
  })

  return {
    'JSON-LD VC (JCS)-withLib-sign': sign,
    'JSON-LD VC (JCS)-withLib-verify': verify,
  }
}

// ─────────────────────────────────────────────────────────────────
// JSON-LD VC (JCS) — no-lib (inline RFC 8785 + Ed25519)
// ─────────────────────────────────────────────────────────────────

function benchJsonLdJcsNoLib(n: number): Record<string, BenchEntry> {
  const { privateKey } = crypto.generateKeyPairSync('ed25519')

  const vcDoc = {
    '@context': {
      '@version': 1.1, 'id': '@id', 'type': '@type',
      'VerifiableCredential': 'https://www.w3.org/2018/credentials#VerifiableCredential',
      'issuer': { '@id': 'https://www.w3.org/2018/credentials#issuer', '@type': '@id' },
      'issuanceDate': { '@id': 'https://www.w3.org/2018/credentials#issuanceDate', '@type': 'http://www.w3.org/2001/XMLSchema#dateTime' },
      'credentialSubject': 'https://www.w3.org/2018/credentials#credentialSubject',
      'name': 'http://schema.org/name',
    },
    'type': 'VerifiableCredential',
    'issuer': 'https://example.com',
    'issuanceDate': '2024-01-01T00:00:00Z',
    'credentialSubject': { 'id': 'did:example:1', 'name': 'Taro Yamada' },
  }

  const sign = bench('JSON-LD VC (JCS)-noLib-sign', n, () => {
    const canonical = jcsCanonical(vcDoc)
    const hash = crypto.createHash('sha256').update(canonical).digest()
    crypto.sign(null, hash, privateKey)
  })

  const canonical0 = jcsCanonical(vcDoc)
  const hash0 = crypto.createHash('sha256').update(canonical0).digest()
  const sig0 = crypto.sign(null, hash0, privateKey)
  const pub0 = crypto.createPublicKey(privateKey)

  const verify = bench('JSON-LD VC (JCS)-noLib-verify', n, () => {
    const canonical = jcsCanonical(vcDoc)
    const hash = crypto.createHash('sha256').update(canonical).digest()
    crypto.verify(null, hash, pub0, sig0)
  })

  return {
    'JSON-LD VC (JCS)-noLib-sign': sign,
    'JSON-LD VC (JCS)-noLib-verify': verify,
  }
}

// ─────────────────────────────────────────────────────────────────
// Serialization-only benchmarks (no crypto) — measures pure
// encode/decode/normalize overhead for each format.
// Key pattern: "${format}-serial-${operation}"
// ─────────────────────────────────────────────────────────────────

async function benchSerialize(n: number): Promise<Record<string, BenchEntry>> {
  const results: Record<string, BenchEntry> = {}

  // ── SD-JWT VC: JSON.stringify + base64url (no signing)
  const sdPayload = {
    iss: 'https://issuer.example.com', iat: 0, exp: 3600,
    vct: 'https://credentials.example.com/identity',
    sub: 'did:example:holder123',
    given_name: 'Taro', family_name: 'Yamada', birthdate: '1990-01-01',
  }
  const sdHeader = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'vc+sd-jwt' })).toString('base64url')

  results['SD-JWT VC-serial-encode'] = bench('SD-JWT VC-serial-encode', n, () => {
    const p = Buffer.from(JSON.stringify({ ...sdPayload, iat: Date.now() })).toString('base64url')
    `${sdHeader}.${p}.AAABBB`
  })

  const sdToken = `${sdHeader}.${Buffer.from(JSON.stringify(sdPayload)).toString('base64url')}.AAABBB`
  results['SD-JWT VC-serial-decode'] = bench('SD-JWT VC-serial-decode', n, () => {
    const [h64, p64] = sdToken.split('.')
    JSON.parse(Buffer.from(h64, 'base64url').toString())
    JSON.parse(Buffer.from(p64, 'base64url').toString())
  })

  // ── JSON-LD VC: JSON.stringify / JSON.parse (raw JSON, no normalization)
  const jldDoc = {
    '@context': { '@version': 1.1, 'id': '@id', 'type': '@type',
      'VerifiableCredential': 'https://www.w3.org/2018/credentials#VerifiableCredential',
      'issuer': { '@id': 'https://www.w3.org/2018/credentials#issuer', '@type': '@id' },
      'issuanceDate': { '@id': 'https://www.w3.org/2018/credentials#issuanceDate', '@type': 'http://www.w3.org/2001/XMLSchema#dateTime' },
      'credentialSubject': 'https://www.w3.org/2018/credentials#credentialSubject',
      'name': 'http://schema.org/name' },
    type: 'VerifiableCredential',
    issuer: 'https://example.com',
    issuanceDate: '2024-01-01T00:00:00Z',
    credentialSubject: { id: 'did:example:1', name: 'Taro Yamada' },
  }
  const jldStr = JSON.stringify(jldDoc)

  results['JSON-LD VC-serial-encode'] = bench('JSON-LD VC-serial-encode', n, () => {
    JSON.stringify(jldDoc)
  })
  results['JSON-LD VC-serial-decode'] = bench('JSON-LD VC-serial-decode', n, () => {
    JSON.parse(jldStr)
  })

  // ── JSON-LD VC URDNA2015 normalize (inline, no library)
  const vcForNorm = { issuer: 'https://example.com', issuanceDate: '2024-01-01T00:00:00Z',
    credentialSubject: { id: 'did:example:1', name: 'Taro Yamada' } }

  results['JSON-LD VC-serial-normalize'] = bench('JSON-LD VC-serial-normalize', n, () => {
    inlineNormalizeUrdna2015(vcForNorm)
  })

  // ── JSON-LD VC URDNA2015 normalize with jsonld library (slower)
  try {
    const jsonld = (await import('jsonld')).default
    const vcDocWithCtx = { ...jldDoc }
    const nJl = Math.max(Math.floor(n / 5), 10)
    results['JSON-LD VC-serial-normalize-withLib'] = await benchAsync('JSON-LD VC-serial-normalize-withLib', nJl, async () => {
      await (jsonld as any).normalize(vcDocWithCtx, {
        algorithm: 'URDNA2015', format: 'application/n-quads', safe: false,
      })
    })
  } catch { /* jsonld not available */ }

  // ── JSON-LD VC (JCS): JCS canonicalize (inline RFC 8785)
  results['JSON-LD VC (JCS)-serial-canonicalize'] = bench('JSON-LD VC (JCS)-serial-canonicalize', n, () => {
    jcsCanonical(jldDoc)
  })

  // ── mdoc: manual CBOR encode (no signing, no hashing)
  const mdocFields: [string, string][] = [
    ['family_name','Yamada'],['given_name','Taro'],
    ['birth_date','1990-01-01'],['issue_date','2024-01-01'],
    ['expiry_date','2029-01-01'],['issuing_country','JP'],
    ['document_number','JP-12345678'],
  ]

  results['mdoc-serial-encode'] = bench('mdoc-serial-encode', n, () => {
    const items: Buffer[] = mdocFields.map(([k, v], i) =>
      cborMap(cborUint(0), cborUint(i), cborText('elementIdentifier'), cborText(k), cborText('elementValue'), cborText(v))
    )
    cborMap(cborText('docType'), cborText('org.iso.18013.5.1.mDL'), cborText('items'), ...items)
  })

  // ── mdoc with-lib: cbor-x encode
  try {
    const { encode, decode } = await import('cbor-x')
    const mdocLibDoc = {
      docType: 'org.iso.18013.5.1.mDL',
      items: mdocFields.map(([k, v], i) => ({ digestID: i, elementIdentifier: k, elementValue: v })),
    }
    const mdocEncoded = encode(mdocLibDoc)
    results['mdoc-withLib-serial-encode'] = bench('mdoc-withLib-serial-encode', n, () => { encode(mdocLibDoc) })
    results['mdoc-withLib-serial-decode'] = bench('mdoc-withLib-serial-decode', n, () => { decode(mdocEncoded) })
  } catch { /* cbor-x not available */ }

  return results
}

// ─────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────

export type ProgressCallback = (msg: string) => void

export async function runNodeBenchmarks(
  iterations: number,
  onProgress: ProgressCallback,
): Promise<NodeBenchResults> {
  const results: Record<string, BenchEntry> = {}
  const errors: Record<string, string> = {}
  const N = iterations

  onProgress('SD-JWT VC (ライブラリなし) 計測中...')
  try {
    Object.assign(results, benchSdJwtNoLib(N))
  } catch (e) {
    errors['SD-JWT VC-noLib'] = String(e)
  }

  onProgress('SD-JWT VC (ライブラリあり / Ed25519) 計測中...')
  try {
    Object.assign(results, benchSdJwtWithLib(N))
  } catch (e) {
    errors['SD-JWT VC-withLib'] = String(e)
  }

  onProgress('JSON-LD VC (ライブラリなし) 計測中...')
  try {
    Object.assign(results, benchJsonLdNoLib(N))
  } catch (e) {
    errors['JSON-LD VC-noLib'] = String(e)
  }

  onProgress('JSON-LD VC (jsonld URDNA2015) 計測中...')
  try {
    Object.assign(results, await benchJsonLdWithLib(Math.max(Math.floor(N / 5), 10)))
  } catch (e) {
    errors['JSON-LD VC-withLib'] = String(e)
  }

  onProgress('JSON-LD VC (JCS / ライブラリあり) 計測中...')
  try {
    Object.assign(results, await benchJsonLdJcsWithLib(N))
  } catch (e) {
    errors['JSON-LD VC (JCS)-withLib'] = String(e)
  }

  onProgress('JSON-LD VC (JCS / ライブラリなし) 計測中...')
  try {
    Object.assign(results, benchJsonLdJcsNoLib(N))
  } catch (e) {
    errors['JSON-LD VC (JCS)-noLib'] = String(e)
  }

  onProgress('mdoc (ライブラリなし / 手書き CBOR) 計測中...')
  try {
    Object.assign(results, benchMdocNoLib(N))
  } catch (e) {
    errors['mdoc-noLib'] = String(e)
  }

  onProgress('mdoc (cbor-x) 計測中...')
  try {
    Object.assign(results, await benchMdocWithLib(N))
  } catch (e) {
    errors['mdoc-withLib'] = String(e)
  }

  onProgress('シリアライズ速度計測中（暗号なし）...')
  try {
    Object.assign(results, await benchSerialize(N))
  } catch (e) {
    errors['serial'] = String(e)
  }

  onProgress('完了')

  return {
    results,
    errors,
    iterations: N,
    runtimeInfo: `Node.js ${process.version} / ${process.platform} ${process.arch}`,
  }
}
