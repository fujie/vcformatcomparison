// ============================================================
// No-library implementations using only Web Crypto API +
// standard built-ins (no jose, no cbor-x, no jsonld).
// ============================================================

// ---- Minimal CBOR encoder/decoder (RFC 7049) ---------------

function cborHead(major: number, n: number): Uint8Array {
  const b = major << 5
  if (n <= 23)     return new Uint8Array([b | n])
  if (n <= 0xFF)   return new Uint8Array([b | 24, n])
  if (n <= 0xFFFF) return new Uint8Array([b | 25, n >> 8, n & 0xFF])
  return new Uint8Array([b | 26, (n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF])
}

function cat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const a of arrays) { out.set(a, off); off += a.length }
  return out
}

export function cborEncode(v: unknown): Uint8Array {
  if (v === null)  return new Uint8Array([0xF6])
  if (v === false) return new Uint8Array([0xF4])
  if (v === true)  return new Uint8Array([0xF5])
  if (typeof v === 'number') {
    if (v >= 0) return cborHead(0, v)
    return cborHead(1, -1 - v)
  }
  if (typeof v === 'string') {
    const b = new TextEncoder().encode(v)
    return cat(cborHead(3, b.length), b)
  }
  if (v instanceof Uint8Array) {
    return cat(cborHead(2, v.length), v)
  }
  if (v instanceof Map) {
    const parts: Uint8Array[] = [cborHead(5, v.size)]
    for (const [k, val] of v) { parts.push(cborEncode(k), cborEncode(val)) }
    return cat(...parts)
  }
  if (Array.isArray(v)) {
    const parts: Uint8Array[] = [cborHead(4, v.length)]
    for (const item of v) parts.push(cborEncode(item))
    return cat(...parts)
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
    const parts: Uint8Array[] = [cborHead(5, entries.length)]
    for (const [k, val] of entries) { parts.push(cborEncode(k), cborEncode(val)) }
    return cat(...parts)
  }
  throw new Error(`cborEncode: unsupported ${typeof v}`)
}

type CborVal = null | boolean | number | string | Uint8Array | CborVal[] | Map<CborVal, CborVal>

function _dec(b: Uint8Array, pos: number): [CborVal, number] {
  const byte = b[pos]
  const major = byte >> 5, info = byte & 0x1F
  let n = 0, p = pos + 1
  if (info <= 23)     n = info
  else if (info === 24) n = b[p++]
  else if (info === 25) { n = (b[p] << 8) | b[p + 1]; p += 2 }
  else if (info === 26) { n = ((b[p] << 24) | (b[p+1] << 16) | (b[p+2] << 8) | b[p+3]) >>> 0; p += 4 }

  switch (major) {
    case 0: return [n, p]
    case 1: return [-1 - n, p]
    case 2: return [b.slice(p, p + n), p + n]
    case 3: return [new TextDecoder().decode(b.slice(p, p + n)), p + n]
    case 4: { const arr: CborVal[] = []; for (let i = 0; i < n; i++) { const [v, np] = _dec(b, p); arr.push(v); p = np } return [arr, p] }
    case 5: { const m = new Map<CborVal, CborVal>(); for (let i = 0; i < n; i++) { const [k,p1]=_dec(b,p); const [v,p2]=_dec(b,p1); m.set(k,v); p=p2 } return [m, p] }
    case 7: {
      if (info === 20) return [false, pos + 1]
      if (info === 21) return [true,  pos + 1]
      if (info === 22) return [null,  pos + 1]
      throw new Error(`CBOR simple 0x${byte.toString(16)}`)
    }
    default: throw new Error(`CBOR major ${major}`)
  }
}

export function cborDecode(b: Uint8Array): CborVal { return _dec(b, 0)[0] }

// ---- b64url helpers (SD-JWT) --------------------------------

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - s.length % 4) % 4), '=')
  return new Uint8Array(atob(padded).split('').map(c => c.charCodeAt(0)))
}

// ---- SD-JWT VC — no library (ECDSA P-256 / ES256) ----------

export async function sdJwtGenKeyNoLib(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
}

export async function sdJwtSignNoLib(
  payload: Record<string, unknown>,
  privateKey: CryptoKey,
): Promise<string> {
  const h = b64url(JSON.stringify({ alg: 'ES256', typ: 'vc+sd-jwt' }))
  const p = b64url(JSON.stringify(payload))
  const input = new TextEncoder().encode(`${h}.${p}`)
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, input))
  return `${h}.${p}.${b64url(sig)}`
}

export async function sdJwtVerifyNoLib(
  token: string,
  publicKey: CryptoKey,
): Promise<Record<string, unknown>> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT structure')
  const [h64, p64, s64] = parts
  const header = JSON.parse(atob(h64.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>
  if (header.alg !== 'ES256') throw new Error(`Unexpected alg: ${header.alg}`)
  const input = new TextEncoder().encode(`${h64}.${p64}`)
  const sig = b64urlDecode(s64)
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, sig, input)
  if (!ok) throw new Error('Signature invalid')
  return JSON.parse(atob(p64.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>
}

// ---- mdoc — no library (manual CBOR + COSE_Sign1) ----------

const NS = 'org.iso.18013.5.1'
const ALG_ES256 = -7

function buildSigStructureNoLib(protectedHeader: Uint8Array, payload: Uint8Array): Uint8Array {
  return cborEncode(['Signature1', protectedHeader, new Uint8Array(0), payload])
}

export async function mdocGenKeyNoLib(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
}

export async function mdocSignNoLib(
  fields: Record<string, unknown>,
  privateKey: CryptoKey,
): Promise<Uint8Array> {
  // 1. Build IssuerSignedItems + per-element SHA-256 digests
  // Use Map with integer keys (matching ISO 18013-5 spec)
  const itemBytes: Uint8Array[] = []
  const valueDigestMap = new Map<number, Uint8Array>()
  let id = 0
  for (const [key, value] of Object.entries(fields)) {
    const item = new Map<string, unknown>([
      ['digestID', id],
      ['random', crypto.getRandomValues(new Uint8Array(16))],
      ['elementIdentifier', key],
      ['elementValue', value],
    ])
    const encoded = cborEncode(item)
    valueDigestMap.set(id, new Uint8Array(await crypto.subtle.digest('SHA-256', encoded)))
    itemBytes.push(encoded)
    id++
  }

  // 2. Build MSO using Maps throughout (so CBOR keys stay typed correctly)
  const mso = new Map<string, unknown>([
    ['version', '1.0'],
    ['digestAlgorithm', 'SHA-256'],
    ['valueDigests', new Map([[NS, valueDigestMap]])],
    ['docType', 'org.iso.18013.5.1.mDL'],
    ['validityInfo', new Map([
      ['signed', new Date().toISOString()],
      ['validFrom', new Date().toISOString()],
      ['validUntil', new Date(Date.now() + 86400000).toISOString()],
    ])],
  ])

  // 3. COSE_Sign1: [protected_header_bstr, {}, payload_bstr, signature]
  const protectedHeader = cborEncode(new Map<number, number>([[1, ALG_ES256]]))
  const msoPayload = cborEncode(mso)
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, buildSigStructureNoLib(protectedHeader, msoPayload))
  )
  const issuerAuth = [protectedHeader, new Map(), msoPayload, sig]

  // 4. Assemble with Maps (so decode returns Maps consistently)
  const doc = new Map<string, unknown>([
    ['docType', 'org.iso.18013.5.1.mDL'],
    ['issuerSigned', new Map<string, unknown>([
      ['nameSpaces', new Map([[NS, itemBytes]])],
      ['issuerAuth', issuerAuth],
    ])],
  ])
  return cborEncode(doc)
}

export async function mdocVerifyNoLib(mdocBytes: Uint8Array, publicKey: CryptoKey): Promise<boolean> {
  // 1. CBOR decode — cborDecode always returns Map for map types
  const doc        = cborDecode(mdocBytes) as Map<CborVal, CborVal>
  const iSigned    = doc.get('issuerSigned')  as Map<CborVal, CborVal>
  const coseSign1  = iSigned.get('issuerAuth') as CborVal[]
  const [protHdr, , msoPay, sig] = coseSign1 as [Uint8Array, unknown, Uint8Array, Uint8Array]

  // 2. Verify COSE_Sign1 signature
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, publicKey, sig,
    buildSigStructureNoLib(protHdr, msoPay),
  )
  if (!ok) return false

  // 3. Verify per-element digests (integer keys in the Map)
  const mso    = cborDecode(msoPay) as Map<CborVal, CborVal>
  const vdNs   = (mso.get('valueDigests') as Map<CborVal, CborVal>).get(NS) as Map<CborVal, CborVal>
  const items  = (iSigned.get('nameSpaces')  as Map<CborVal, CborVal>).get(NS) as Uint8Array[]
  for (let i = 0; i < items.length; i++) {
    const computed = new Uint8Array(await crypto.subtle.digest('SHA-256', items[i]))
    const expected = vdNs.get(i) as Uint8Array   // integer key
    if (!expected || !computed.every((b, j) => b === expected[j])) return false
  }
  return true
}

// ---- Serialization-only benchmark (no crypto) ---------------
// Measures encode/decode overhead WITHOUT any cryptographic operations.
// This isolates the "binary vs text" difference from the algorithm difference.

export interface SerialBenchResult {
  format: 'SD-JWT VC' | 'JSON-LD VC' | 'JSON-LD VC (JCS)' | 'mdoc'
  operation: 'encode' | 'decode' | 'normalize'
  label?: string
  iterations: number
  avgMs: number
  opsPerSec: number
  payloadSizeBytes: number
  // Statistical distribution
  stdDevMs?: number
  ci95Ms?: number
  p50Ms?: number
  p90Ms?: number
  p95Ms?: number
  p99Ms?: number
  minMs?: number
  maxMs?: number
}

function computeMsStats(timingsMs: number[]) {
  const n = timingsMs.length
  const sorted = [...timingsMs].sort((a, b) => a - b)
  const avg = sorted.reduce((s, v) => s + v, 0) / n
  const variance = sorted.reduce((s, v) => s + (v - avg) ** 2, 0) / n
  const stdDev = Math.sqrt(variance)
  const p = (pct: number) => sorted[Math.min(Math.floor(n * pct), n - 1)]
  return {
    avgMs: avg,
    opsPerSec: 1000 / avg,
    stdDevMs: stdDev,
    ci95Ms: 1.96 * stdDev / Math.sqrt(n),
    p50Ms: p(0.50),
    p90Ms: p(0.90),
    p95Ms: p(0.95),
    p99Ms: p(0.99),
    minMs: sorted[0],
    maxMs: sorted[n - 1],
  }
}

export async function runSerialBenchmarks(iterations = 200): Promise<SerialBenchResult[]> {
  const results: SerialBenchResult[] = []

  // --- SD-JWT VC: JSON + base64url (no signature, no hash) ---
  const sdPayload = {
    iss: 'https://issuer.example.com', iat: 0, exp: 3600,
    vct: 'https://credentials.example.com/identity',
    sub: 'did:example:holder123',
    given_name: 'Taro', family_name: 'Yamada', birthdate: '1990-01-01',
    address: { street_address: '1-1-1 Shibuya', locality: 'Tokyo', country: 'JP' },
  }
  const sdHeader = b64url(JSON.stringify({ alg: 'EdDSA', typ: 'vc+sd-jwt' }))
  let sdToken = ''

  const sdEncTimings: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    const p = b64url(JSON.stringify({ ...sdPayload, iat: i }))
    sdToken = `${sdHeader}.${p}.AAABBBCCC`
    sdEncTimings.push(performance.now() - t)
  }
  const sdEncStats = computeMsStats(sdEncTimings)
  const sdSize = new TextEncoder().encode(sdToken).length

  const sdDecTimings: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    const [h64, p64] = sdToken.split('.')
    JSON.parse(atob(h64.replace(/-/g, '+').replace(/_/g, '/')))
    JSON.parse(atob(p64.replace(/-/g, '+').replace(/_/g, '/')))
    sdDecTimings.push(performance.now() - t)
  }
  const sdDecStats = computeMsStats(sdDecTimings)

  results.push(
    { format: 'SD-JWT VC', operation: 'encode', iterations, payloadSizeBytes: sdSize, ...sdEncStats },
    { format: 'SD-JWT VC', operation: 'decode', iterations, payloadSizeBytes: sdSize, ...sdDecStats },
  )

  // --- JSON-LD VC: JSON encode/decode ---
  const jldCred = JSONLD_CREDENTIAL as unknown as Record<string, unknown>
  let jldJson = ''

  const jldEncTimings: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    jldJson = JSON.stringify(jldCred)
    jldEncTimings.push(performance.now() - t)
  }
  const jldEncStats = computeMsStats(jldEncTimings)
  const jldSize = new TextEncoder().encode(jldJson).length

  const jldDecTimings: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    JSON.parse(jldJson)
    jldDecTimings.push(performance.now() - t)
  }
  const jldDecStats = computeMsStats(jldDecTimings)

  results.push(
    { format: 'JSON-LD VC', operation: 'encode', iterations, payloadSizeBytes: jldSize, ...jldEncStats },
    { format: 'JSON-LD VC', operation: 'decode', iterations, payloadSizeBytes: jldSize, ...jldDecStats },
  )

  // --- JSON-LD VC: URDNA2015 inline normalize (no library) ---
  let normResult = ''
  const normTimings: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    normResult = jsonLdNormalize(jldCred)
    normTimings.push(performance.now() - t)
  }
  const normStats = computeMsStats(normTimings)

  results.push({
    format: 'JSON-LD VC', operation: 'normalize', label: 'URDNA2015 (inline)',
    iterations, payloadSizeBytes: new TextEncoder().encode(normResult).length, ...normStats,
  })

  // --- JSON-LD VC (JCS): JCS canonicalize ---
  function jcsCanonical(v: unknown): string {
    if (v === null || typeof v !== 'object') return JSON.stringify(v)
    if (Array.isArray(v)) return '[' + (v as unknown[]).map(jcsCanonical).join(',') + ']'
    const obj = v as Record<string, unknown>
    return '{' + Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${jcsCanonical(obj[k])}`).join(',') + '}'
  }
  let jcsResult = ''
  const jcsTimings: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    jcsResult = jcsCanonical(jldCred)
    jcsTimings.push(performance.now() - t)
  }
  const jcsStats = computeMsStats(jcsTimings)

  results.push({
    format: 'JSON-LD VC (JCS)', operation: 'normalize', label: 'JCS (RFC 8785)',
    iterations, payloadSizeBytes: new TextEncoder().encode(jcsResult).length, ...jcsStats,
  })

  // --- mdoc: CBOR encode/decode (no signing, no hashing) ---
  const mdocDoc = new Map<string, unknown>([
    ['docType', 'org.iso.18013.5.1.mDL'],
    ['issuerSigned', new Map([
      ['nameSpaces', new Map([['org.iso.18013.5.1', [
        cborEncode(new Map([['digestID', 0], ['elementIdentifier', 'family_name'], ['elementValue', 'Yamada']])),
        cborEncode(new Map([['digestID', 1], ['elementIdentifier', 'given_name'],  ['elementValue', 'Taro']])),
        cborEncode(new Map([['digestID', 2], ['elementIdentifier', 'birth_date'],  ['elementValue', '1990-01-01']])),
        cborEncode(new Map([['digestID', 3], ['elementIdentifier', 'issue_date'],  ['elementValue', '2024-01-01']])),
        cborEncode(new Map([['digestID', 4], ['elementIdentifier', 'expiry_date'], ['elementValue', '2029-01-01']])),
        cborEncode(new Map([['digestID', 5], ['elementIdentifier', 'issuing_country'], ['elementValue', 'JP']])),
        cborEncode(new Map([['digestID', 6], ['elementIdentifier', 'document_number'], ['elementValue', 'JP-12345678']])),
      ]]])],
      ['issuerAuth', [new Uint8Array([0xa1, 0x01, 0x26]), new Map(), new Uint8Array(16), new Uint8Array(64)]],
    ])],
  ])

  let mdocBytes = new Uint8Array(0)
  const mdocEncTimings: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    mdocBytes = cborEncode(mdocDoc)
    mdocEncTimings.push(performance.now() - t)
  }
  const mdocEncStats = computeMsStats(mdocEncTimings)

  const mdocDecTimings: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    cborDecode(mdocBytes)
    mdocDecTimings.push(performance.now() - t)
  }
  const mdocDecStats = computeMsStats(mdocDecTimings)

  results.push(
    { format: 'mdoc', operation: 'encode', iterations, payloadSizeBytes: mdocBytes.length, ...mdocEncStats },
    { format: 'mdoc', operation: 'decode', iterations, payloadSizeBytes: mdocBytes.length, ...mdocDecStats },
  )

  return results
}

// ---- Benchmarks -------------------------------------------

export interface NoLibResult {
  format: 'SD-JWT VC' | 'JSON-LD VC' | 'mdoc'
  mode: 'withLib' | 'noLib'
  operation: 'sign' | 'verify'
  iterations: number
  avgMs: number
  opsPerSec: number
  // Statistical distribution
  stdDevMs?: number
  ci95Ms?: number
  p50Ms?: number
  p90Ms?: number
  p95Ms?: number
  p99Ms?: number
  minMs?: number
  maxMs?: number
}

import { benchmarkSdJwt, benchmarkMdoc, benchmarkJsonLdVc, MDOC_FIELDS, JSONLD_CREDENTIAL } from './signatureSpeed'
import { generateEd25519KeyPair, ed25519Sign, ed25519Verify } from '../lib/cryptoUtils'

// ---- JSON-LD VC — no library (simplified URDNA2015 for blank-node-free credentials) ---
//
// For credentials with no blank nodes, URDNA2015 reduces to three steps:
//   1. Expand JSON-LD terms to full IRIs using static context mappings
//   2. Serialize each RDF triple as an N-Quad line
//   3. Sort N-Quads lexicographically and concatenate
// The expensive blank-node canonicalization step (O(n! × n²) in worst case)
// is unnecessary when all subjects/objects are named IRIs.

const _CRED  = 'https://www.w3.org/2018/credentials#'
const _SCH   = 'http://schema.org/'
const _XSD   = 'http://www.w3.org/2001/XMLSchema#'
const _RDF_T = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

const _TERMS: Record<string, { iri: string; vt?: string }> = {
  VerifiableCredential: { iri: `${_CRED}VerifiableCredential` },
  credentialSubject:    { iri: `${_CRED}credentialSubject`,  vt: '@id' },
  credentialStatus:     { iri: `${_CRED}credentialStatus`,   vt: '@id' },
  expirationDate:       { iri: `${_CRED}expirationDate`,     vt: `${_XSD}dateTime` },
  issuanceDate:         { iri: `${_CRED}issuanceDate`,       vt: `${_XSD}dateTime` },
  issuer:               { iri: `${_CRED}issuer`,             vt: '@id' },
  validFrom:            { iri: `${_CRED}validFrom`,          vt: `${_XSD}dateTime` },
  validUntil:           { iri: `${_CRED}validUntil`,         vt: `${_XSD}dateTime` },
  given_name:           { iri: `${_SCH}givenName` },
  family_name:          { iri: `${_SCH}familyName` },
  birthdate:            { iri: `${_SCH}birthDate` },
  name:                 { iri: `${_SCH}name` },
}

function _ntLit(v: string, type?: string): string {
  const e = v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
              .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
  return type ? `"${e}"^^<${type}>` : `"${e}"`
}

function _expandTriples(subj: string, obj: Record<string, unknown>): string[] {
  const q: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'id' || k === '@context') continue
    if (k === 'type') {
      for (const t of (Array.isArray(v) ? v : [v]))
        q.push(`<${subj}> <${_RDF_T}> <${_TERMS[t as string]?.iri ?? (t as string)}> .`)
      continue
    }
    const term = _TERMS[k]; if (!term) continue
    if (term.vt === '@id') {
      if (typeof v === 'object' && v !== null) {
        const nestedId = (v as Record<string, unknown>).id as string
        q.push(`<${subj}> <${term.iri}> <${nestedId}> .`)
        q.push(..._expandTriples(nestedId, v as Record<string, unknown>))
      } else {
        q.push(`<${subj}> <${term.iri}> <${v as string}> .`)
      }
    } else {
      q.push(`<${subj}> <${term.iri}> ${_ntLit(v as string, term.vt)} .`)
    }
  }
  return q
}

function jsonLdNormalize(doc: Record<string, unknown>): string {
  return _expandTriples(doc.id as string, doc).sort().join('\n') + '\n'
}

async function benchmarkJsonLdVcNoLib(iterations: number): Promise<NoLibResult[]> {
  const { privateKey, publicKey } = await generateEd25519KeyPair()
  const enc = new TextEncoder()
  const cred = JSONLD_CREDENTIAL as unknown as Record<string, unknown>

  const sha256 = async (str: string) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(str)))

  const wSig = await ed25519Sign(await sha256(jsonLdNormalize(cred)), privateKey)
  await ed25519Verify(wSig, await sha256(jsonLdNormalize(cred)), publicKey)

  const signTimings: number[] = []
  let lastSig: Uint8Array = wSig
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    const hash = await sha256(jsonLdNormalize(cred))
    lastSig = await ed25519Sign(hash, privateKey)
    signTimings.push(performance.now() - t)
  }
  const signStats = computeMsStats(signTimings)

  const verifyTimings: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    const hash = await sha256(jsonLdNormalize(cred))
    await ed25519Verify(lastSig, hash, publicKey)
    verifyTimings.push(performance.now() - t)
  }
  const verifyStats = computeMsStats(verifyTimings)

  return [
    { format: 'JSON-LD VC', mode: 'noLib', operation: 'sign',   iterations, ...signStats },
    { format: 'JSON-LD VC', mode: 'noLib', operation: 'verify', iterations, ...verifyStats },
  ]
}

const SD_JWT_PAYLOAD_P256 = {
  iss: 'https://issuer.example.com',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
  vct: 'https://credentials.example.com/identity',
  sub: 'did:example:holder123',
  given_name: 'Taro',
  family_name: 'Yamada',
  birthdate: '1990-01-01',
}

async function benchmarkSdJwtNoLib(iterations: number): Promise<NoLibResult[]> {
  const { privateKey, publicKey } = await sdJwtGenKeyNoLib()
  const warmToken = await sdJwtSignNoLib(SD_JWT_PAYLOAD_P256, privateKey)
  await sdJwtVerifyNoLib(warmToken, publicKey)

  const signTimings: number[] = []
  let token = warmToken
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    token = await sdJwtSignNoLib({ ...SD_JWT_PAYLOAD_P256, iat: Date.now() + i }, privateKey)
    signTimings.push(performance.now() - t)
  }
  const signStats = computeMsStats(signTimings)

  const verifyTimings: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    await sdJwtVerifyNoLib(token, publicKey)
    verifyTimings.push(performance.now() - t)
  }
  const verifyStats = computeMsStats(verifyTimings)

  return [
    { format: 'SD-JWT VC', mode: 'noLib', operation: 'sign',   iterations, ...signStats },
    { format: 'SD-JWT VC', mode: 'noLib', operation: 'verify', iterations, ...verifyStats },
  ]
}

async function benchmarkMdocNoLib(iterations: number): Promise<NoLibResult[]> {
  const { privateKey, publicKey } = await mdocGenKeyNoLib()
  const warmMdoc = await mdocSignNoLib(MDOC_FIELDS, privateKey)
  await mdocVerifyNoLib(warmMdoc, publicKey)

  const signTimings: number[] = []
  let last = warmMdoc
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    last = await mdocSignNoLib({ ...MDOC_FIELDS, document_number: `JP-${i}` }, privateKey)
    signTimings.push(performance.now() - t)
  }
  const signStats = computeMsStats(signTimings)

  const verifyTimings: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    await mdocVerifyNoLib(last, publicKey)
    verifyTimings.push(performance.now() - t)
  }
  const verifyStats = computeMsStats(verifyTimings)

  return [
    { format: 'mdoc', mode: 'noLib', operation: 'sign',   iterations, ...signStats },
    { format: 'mdoc', mode: 'noLib', operation: 'verify', iterations, ...verifyStats },
  ]
}

export async function runNoLibBenchmarks(
  iterations: number,
  onProgress: (msg: string) => void,
): Promise<NoLibResult[]> {
  type SpeedLike = { format: string; operation: 'sign' | 'verify'; iterations: number; avgMs: number; opsPerSec: number; stdDevMs?: number; ci95Ms?: number; p50Ms?: number; p90Ms?: number; p95Ms?: number; p99Ms?: number; minMs?: number; maxMs?: number }
  const toNoLib = (r: SpeedLike, mode: 'withLib' | 'noLib'): NoLibResult => ({
    format: r.format as NoLibResult['format'],
    mode, operation: r.operation,
    iterations: r.iterations, avgMs: r.avgMs, opsPerSec: r.opsPerSec,
    stdDevMs: r.stdDevMs, ci95Ms: r.ci95Ms,
    p50Ms: r.p50Ms, p90Ms: r.p90Ms, p95Ms: r.p95Ms, p99Ms: r.p99Ms,
    minMs: r.minMs, maxMs: r.maxMs,
  })

  onProgress('SD-JWT VC ライブラリあり計測中...')
  const sdWithLib = (await benchmarkSdJwt(iterations)).map(r => toNoLib(r, 'withLib'))

  onProgress('SD-JWT VC ライブラリなし計測中...')
  const sdNoLib = await benchmarkSdJwtNoLib(iterations)

  onProgress('JSON-LD VC ライブラリあり計測中（URDNA2015）...')
  const jlWithLib = (await benchmarkJsonLdVc(iterations)).map(r => toNoLib(r, 'withLib'))

  onProgress('JSON-LD VC ライブラリなし計測中（N-Quads 静的展開）...')
  const jlNoLib = await benchmarkJsonLdVcNoLib(iterations)

  onProgress('mdoc ライブラリあり計測中...')
  const mdWithLib = (await benchmarkMdoc(iterations)).map(r => toNoLib(r, 'withLib'))

  onProgress('mdoc ライブラリなし計測中...')
  const mdNoLib = await benchmarkMdocNoLib(iterations)

  onProgress('完了')
  return [...sdWithLib, ...sdNoLib, ...jlWithLib, ...jlNoLib, ...mdWithLib, ...mdNoLib]
}
