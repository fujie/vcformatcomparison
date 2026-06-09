/**
 * Node.js backend benchmarks — uses process.hrtime.bigint() for nanosecond precision.
 * Covers all 6 combinations: {SD-JWT VC, JSON-LD VC, mdoc} × {withLib, noLib}
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

function bench(label: string, n: number, fn: () => void): BenchEntry {
  // warm-up (3 iterations)
  for (let i = 0; i < 3; i++) fn()

  const start = process.hrtime.bigint()
  for (let i = 0; i < n; i++) fn()
  const end = process.hrtime.bigint()

  const totalNs = Number(end - start)
  const avgNs = totalNs / n
  const avgMs = avgNs / 1_000_000
  const opsPerSec = 1_000_000_000 / avgNs

  return { opsPerSec, avgMs, avgNs, iterations: n, label }
}

async function benchAsync(label: string, n: number, fn: () => Promise<void>): Promise<BenchEntry> {
  // warm-up
  await fn(); await fn(); await fn()

  const start = process.hrtime.bigint()
  for (let i = 0; i < n; i++) await fn()
  const end = process.hrtime.bigint()

  const totalNs = Number(end - start)
  const avgNs = totalNs / n
  const avgMs = avgNs / 1_000_000
  const opsPerSec = 1_000_000_000 / avgNs

  return { opsPerSec, avgMs, avgNs, iterations: n, label }
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
// SD-JWT VC — no-lib (ECDSA P-256 + manual JWT)
// ─────────────────────────────────────────────────────────────────

function benchSdJwtNoLib(n: number): Record<string, BenchEntry> {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  })

  const header = b64url(Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'vc+sd-jwt' })))
  const payload = b64url(Buffer.from(JSON.stringify({
    iss: 'https://issuer.example.com',
    vct: 'identity',
    sub: 'did:example:holder',
    iat: Math.floor(Date.now() / 1000),
  })))
  const sigInput = `${header}.${payload}`
  let sig = ''

  const sign = bench('SD-JWT VC-noLib-sign', n, () => {
    const raw = crypto.sign('SHA256', Buffer.from(sigInput), {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    })
    sig = b64url(raw)
  })

  // produce a valid token for verify
  const finalSig = crypto.sign('SHA256', Buffer.from(sigInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  })
  const token = `${sigInput}.${b64url(finalSig)}`

  const verify = bench('SD-JWT VC-noLib-verify', n, () => {
    const parts = token.split('.')
    const sigBuf = Buffer.from(parts[2], 'base64url')
    crypto.verify('SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), {
      key: publicKey,
      dsaEncoding: 'ieee-p1363',
    }, sigBuf)
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

  const protHdr = cborMap(cborUint(1), cborNeg(7)) // {alg: -7 (ES256)}

  let sig = Buffer.alloc(64)

  const sign = bench('mdoc-noLib-sign', n, () => {
    // per-element SHA-256 digests
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
    // MSO payload (simplified)
    const msoPayload = cborMap(
      cborText('docType'), cborText('org.iso.18013.5.1.mDL'),
      cborText('valueDigests'), cborMap(...digestMap),
    )
    // COSE Sig_Structure
    const sigStruct = cborArray(
      cborText('Signature1'),
      cborBytes(protHdr),
      cborBytes(Buffer.alloc(0)),
      cborBytes(msoPayload),
    )
    sig = crypto.sign('SHA256', sigStruct, {
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
  // Dynamic import so server startup doesn't fail if package missing
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

  // build static verify data
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

  // Inline context to avoid network
  const inlineCtx = {
    '@context': {
      '@version': 1.1,
      VerifiableCredential: 'https://www.w3.org/2018/credentials#VerifiableCredential',
      issuer: 'https://www.w3.org/2018/credentials#issuer',
      credentialSubject: 'https://www.w3.org/2018/credentials#credentialSubject',
      id: '@id',
    },
  }
  const vcDoc = {
    '@context': [inlineCtx['@context']],
    type: 'VerifiableCredential',
    issuer: 'https://example.com',
    credentialSubject: {
      id: 'did:example:1',
    },
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

  // For verify: run once to get the sig
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
// JSON-LD VC — no-lib (manual N-Quads + Ed25519, no jsonld package)
// ─────────────────────────────────────────────────────────────────

function benchJsonLdNoLib(n: number): Record<string, BenchEntry> {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')

  // Simulate URDNA2015 output (deterministic NQ string) without the package
  const nquad = `<https://example.com> <https://www.w3.org/2018/credentials#issuer> "https://example.com" .\n`
  const nqBytes = Buffer.from(nquad, 'utf8')

  const sign = bench('JSON-LD VC-noLib-sign', n, () => {
    const hash = crypto.createHash('sha256').update(nqBytes).digest()
    crypto.sign(null, hash, privateKey)
  })

  const hash0 = crypto.createHash('sha256').update(nqBytes).digest()
  const sig0 = crypto.sign(null, hash0, privateKey)
  const pub0 = crypto.createPublicKey(privateKey)

  const verify = bench('JSON-LD VC-noLib-verify', n, () => {
    const hash = crypto.createHash('sha256').update(nqBytes).digest()
    crypto.verify(null, hash, pub0, sig0)
  })

  return { 'JSON-LD VC-noLib-sign': sign, 'JSON-LD VC-noLib-verify': verify }
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
    Object.assign(results, await benchJsonLdWithLib(N))
  } catch (e) {
    errors['JSON-LD VC-withLib'] = String(e)
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

  onProgress('完了')

  return {
    results,
    errors,
    iterations: N,
    runtimeInfo: `Node.js ${process.version} / ${process.platform} ${process.arch}`,
  }
}
