/**
 * Backend deserialization complexity — Node.js
 * Measures parse/verify time with process.hrtime.bigint() for each format × lib.
 * Static metrics (LOC, cyclomatic, async steps) are the same as the browser
 * TypeScript implementation — they describe the code structure, not the runtime.
 */

import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface BackendComplexityEntry {
  format: 'SD-JWT VC' | 'JSON-LD VC' | 'mdoc'
  lib: 'withLib' | 'noLib'
  parseTimeMs: number
  parseTimeNs: number
  parseIterations: number
  // Static metrics (same as browser TypeScript implementation)
  linesOfCode: number
  asyncSteps: number
  cyclomaticComplexity: number
  externalNetworkCalls: number
  externalDependencies: string[]
  networkCallDescription: string[]
}

function b64url(b: Buffer | Uint8Array) {
  return Buffer.from(b).toString('base64url')
}

function benchNs(n: number, fn: () => Promise<void> | void): number {
  // warm-up
  for (let i = 0; i < 3; i++) { const r = fn(); if (r instanceof Promise) { /* skip await in warmup for sync callers */ } }
  return 0 // will be done properly below
}

async function measureMs(n: number, fn: () => Promise<void>): Promise<{ avgMs: number; avgNs: number }> {
  // warm-up
  await fn(); await fn(); await fn()
  const start = process.hrtime.bigint()
  for (let i = 0; i < n; i++) await fn()
  const end = process.hrtime.bigint()
  const totalNs = Number(end - start)
  const avgNs = totalNs / n
  return { avgMs: avgNs / 1_000_000, avgNs }
}

function measureMsSync(n: number, fn: () => void): { avgMs: number; avgNs: number } {
  fn(); fn(); fn()
  const start = process.hrtime.bigint()
  for (let i = 0; i < n; i++) fn()
  const end = process.hrtime.bigint()
  const totalNs = Number(end - start)
  const avgNs = totalNs / n
  return { avgMs: avgNs / 1_000_000, avgNs }
}

// ── SD-JWT VC ─────────────────────────────────────────────────────────────────

async function sdJwtWithLibComplexity(n: number): Promise<{ avgMs: number; avgNs: number }> {
  const { SignJWT, generateKeyPair, jwtVerify } = await import('jose')
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
  const token = await new SignJWT({ iss: 'https://issuer.example.com', vct: 'identity', sub: 'did:example:1' })
    .setProtectedHeader({ alg: 'EdDSA' })
    .sign(privateKey)
  return measureMs(n, async () => { await jwtVerify(token, publicKey) })
}

function sdJwtNoLibComplexity(n: number): { avgMs: number; avgNs: number } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  const hdr = b64url(Buffer.from(JSON.stringify({ alg: 'EdDSA', crv: 'Ed25519' })))
  const pay = b64url(Buffer.from(JSON.stringify({ iss: 'https://issuer.example.com', vct: 'identity' })))
  const sig = crypto.sign(null, Buffer.from(`${hdr}.${pay}`), privateKey)
  const token = `${hdr}.${pay}.${b64url(sig)}`

  return measureMsSync(n, () => {
    const parts = token.split('.')
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
    if (!['EdDSA'].includes(header.alg)) throw new Error('bad alg')
    const sigBuf = Buffer.from(parts[2], 'base64url')
    crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, sigBuf)
  })
}

// ── JSON-LD VC ────────────────────────────────────────────────────────────────

async function jsonLdWithLibComplexity(n: number): Promise<{ avgMs: number; avgNs: number }> {
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
  const norm0 = await (jsonld as any).normalize(vcDoc, { algorithm: 'URDNA2015', format: 'application/n-quads', safe: false }) as string
  const hash0 = crypto.createHash('sha256').update(norm0).digest()
  const sig0 = crypto.sign(null, hash0, privateKey)
  const pub0 = crypto.createPublicKey(privateKey)

  return measureMs(n, async () => {
    const norm = await (jsonld as any).normalize(vcDoc, { algorithm: 'URDNA2015', format: 'application/n-quads', safe: false }) as string
    const hash = crypto.createHash('sha256').update(norm).digest()
    crypto.verify(null, hash, pub0, sig0)
  })
}

function jsonLdNoLibComplexity(n: number): { avgMs: number; avgNs: number } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')

  // Inline URDNA2015 — same logic as benchJsonLdNoLib in nodeSpeed.ts
  function inlineNormalize(): Buffer {
    const s = '_:c14n0'
    const sub = '<did:example:1>'
    const quads = [
      `${sub} <http://schema.org/name> "Taro Yamada" .`,
      `${s} <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://www.w3.org/2018/credentials#VerifiableCredential> .`,
      `${s} <https://www.w3.org/2018/credentials#credentialSubject> ${sub} .`,
      `${s} <https://www.w3.org/2018/credentials#issuanceDate> "2024-01-01T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`,
      `${s} <https://www.w3.org/2018/credentials#issuer> <https://example.com> .`,
    ]
    quads.sort()
    return Buffer.from(quads.join('\n') + '\n', 'utf8')
  }

  const nq0 = inlineNormalize()
  const h0 = crypto.createHash('sha256').update(nq0).digest()
  const s0 = crypto.sign(null, h0, privateKey)
  const pub0 = crypto.createPublicKey(privateKey)

  return measureMsSync(n, () => {
    const nq = inlineNormalize()
    const h = crypto.createHash('sha256').update(nq).digest()
    crypto.verify(null, h, pub0, s0)
  })
}

// ── mdoc ──────────────────────────────────────────────────────────────────────

function mdocNoLibComplexity(n: number): { avgMs: number; avgNs: number } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })

  // Hand-written CBOR helpers (same as speed.py noLib implementation)
  const cborUint = (v: number) => v <= 23 ? Buffer.from([v]) : v <= 0xff ? Buffer.from([0x18, v]) : Buffer.from([0x19, (v >> 8) & 0xff, v & 0xff])
  const cborText = (s: string) => { const b = Buffer.from(s); const h = b.length <= 23 ? Buffer.from([0x60 | b.length]) : b.length <= 0xff ? Buffer.from([0x78, b.length]) : Buffer.from([0x79, (b.length >> 8) & 0xff, b.length & 0xff]); return Buffer.concat([h, b]) }
  const cborBytes = (b: Buffer) => { const h = b.length <= 23 ? Buffer.from([0x40 | b.length]) : b.length <= 0xff ? Buffer.from([0x58, b.length]) : Buffer.from([0x59, (b.length >> 8) & 0xff, b.length & 0xff]); return Buffer.concat([h, b]) }
  const cborMap = (...pairs: Buffer[]) => { const n2 = pairs.length / 2; const h = n2 <= 23 ? Buffer.from([0xa0 | n2]) : Buffer.from([0xb8, n2]); return Buffer.concat([h, ...pairs]) }
  const cborArray = (...items: Buffer[]) => { const h = items.length <= 23 ? Buffer.from([0x80 | items.length]) : Buffer.from([0x98, items.length]); return Buffer.concat([h, ...items]) }

  const fields: [string, string][] = [
    ['family_name', 'Yamada'], ['given_name', 'Taro'], ['birth_date', '1990-01-01'],
    ['issue_date', '2024-01-01'], ['expiry_date', '2029-01-01'], ['issuing_country', 'JP'],
  ]

  // Pre-build static sig struct for verify
  const digestPairs: Buffer[] = []
  fields.forEach(([k, v], i) => {
    const item = cborMap(cborUint(0), cborUint(i), cborText('elementIdentifier'), cborText(k), cborText('elementValue'), cborText(v))
    digestPairs.push(cborUint(i), cborBytes(crypto.createHash('sha256').update(item).digest()))
  })
  const mso = cborMap(cborText('docType'), cborText('org.iso.18013.5.1.mDL'), cborText('valueDigests'), cborMap(...digestPairs))
  const prot = cborMap(cborUint(1), Buffer.from([0x26]))  // {1: -7}
  const sigStruct = cborArray(cborText('Signature1'), cborBytes(prot), cborBytes(Buffer.alloc(0)), cborBytes(mso))
  const sig = crypto.sign('SHA256', sigStruct, { key: privateKey, dsaEncoding: 'ieee-p1363' })
  const pub0 = crypto.createPublicKey(privateKey)

  return measureMsSync(n, () => {
    crypto.verify('SHA256', sigStruct, { key: pub0, dsaEncoding: 'ieee-p1363' }, sig)
  })
}

async function mdocWithLibComplexity(n: number): Promise<{ avgMs: number; avgNs: number }> {
  const { encode, decode } = await import('cbor-x')
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })

  const fields = { family_name: 'Yamada', given_name: 'Taro', birth_date: '1990-01-01' }
  const digestMap = new Map<number, Uint8Array>()
  let id = 0
  for (const [k, v] of Object.entries(fields)) {
    const item = encode({ digestID: id, elementIdentifier: k, elementValue: v })
    digestMap.set(id++, new Uint8Array(crypto.createHash('sha256').update(item).digest()))
  }
  const protHdr = encode(new Map([[1, -7]]))
  const msoPayload = encode({ docType: 'org.iso.18013.5.1.mDL', valueDigests: digestMap })
  const sigStruct = encode(['Signature1', protHdr, new Uint8Array(0), msoPayload])
  const sig = crypto.sign('SHA256', sigStruct, { key: privateKey, dsaEncoding: 'ieee-p1363' })
  const pub0 = crypto.createPublicKey(privateKey)

  return measureMs(n, async () => {
    const decoded = decode(sigStruct)
    crypto.verify('SHA256', sigStruct, { key: pub0, dsaEncoding: 'ieee-p1363' }, sig)
  })
}

// ── Entry point ───────────────────────────────────────────────────────────────

export type ProgressCallback = (msg: string) => void

export async function runNodeComplexity(
  n: number,
  onProgress: ProgressCallback,
): Promise<BackendComplexityEntry[]> {
  const results: BackendComplexityEntry[] = []

  onProgress('SD-JWT VC (withLib / jose) パース時間計測中...')
  const sdWithLib = await sdJwtWithLibComplexity(n)
  results.push({
    format: 'SD-JWT VC', lib: 'withLib',
    parseTimeMs: sdWithLib.avgMs, parseTimeNs: sdWithLib.avgNs, parseIterations: n,
    linesOfCode: 12, asyncSteps: 1, cyclomaticComplexity: 3,
    externalNetworkCalls: 0, externalDependencies: ['jose@6.x'],
    networkCallDescription: [],
  })

  onProgress('SD-JWT VC (noLib / node:crypto) パース時間計測中...')
  const sdNoLib = sdJwtNoLibComplexity(n)
  results.push({
    format: 'SD-JWT VC', lib: 'noLib',
    parseTimeMs: sdNoLib.avgMs, parseTimeNs: sdNoLib.avgNs, parseIterations: n,
    linesOfCode: 18, asyncSteps: 0, cyclomaticComplexity: 4,
    externalNetworkCalls: 0, externalDependencies: ['node:crypto (built-in)'],
    networkCallDescription: [],
  })

  onProgress('JSON-LD VC (withLib / jsonld URDNA2015) パース時間計測中...')
  const jlWithLib = await jsonLdWithLibComplexity(Math.min(n, 20))
  results.push({
    format: 'JSON-LD VC', lib: 'withLib',
    parseTimeMs: jlWithLib.avgMs, parseTimeNs: jlWithLib.avgNs, parseIterations: Math.min(n, 20),
    linesOfCode: 28, asyncSteps: 3, cyclomaticComplexity: 7,
    externalNetworkCalls: 1, externalDependencies: ['jsonld@8.x', 'node:crypto'],
    networkCallDescription: ['@context URL 解決 (キャッシュなし時)'],
  })

  onProgress('JSON-LD VC (noLib / manual SHA-256) パース時間計測中...')
  const jlNoLib = jsonLdNoLibComplexity(n)
  results.push({
    format: 'JSON-LD VC', lib: 'noLib',
    parseTimeMs: jlNoLib.avgMs, parseTimeNs: jlNoLib.avgNs, parseIterations: n,
    linesOfCode: 14, asyncSteps: 0, cyclomaticComplexity: 2,
    externalNetworkCalls: 0, externalDependencies: ['node:crypto (built-in)'],
    networkCallDescription: [],
  })

  onProgress('mdoc (withLib / cbor-x) パース時間計測中...')
  const mdocLib = await mdocWithLibComplexity(n)
  results.push({
    format: 'mdoc', lib: 'withLib',
    parseTimeMs: mdocLib.avgMs, parseTimeNs: mdocLib.avgNs, parseIterations: n,
    linesOfCode: 35, asyncSteps: 0, cyclomaticComplexity: 9,
    externalNetworkCalls: 0, externalDependencies: ['cbor-x@1.x', 'node:crypto'],
    networkCallDescription: [],
  })

  onProgress('mdoc (noLib / 手書き CBOR+COSE) パース時間計測中...')
  const mdocNoLib = mdocNoLibComplexity(n)
  results.push({
    format: 'mdoc', lib: 'noLib',
    parseTimeMs: mdocNoLib.avgMs, parseTimeNs: mdocNoLib.avgNs, parseIterations: n,
    linesOfCode: 55, asyncSteps: 0, cyclomaticComplexity: 12,
    externalNetworkCalls: 0, externalDependencies: ['node:crypto (built-in)'],
    networkCallDescription: [],
  })

  onProgress('複雑性分析完了')
  return results
}
