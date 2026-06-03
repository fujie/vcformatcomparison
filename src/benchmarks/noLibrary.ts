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

// ---- Benchmarks -------------------------------------------

export interface NoLibResult {
  format: 'SD-JWT VC' | 'mdoc'
  mode: 'withLib' | 'noLib'
  operation: 'sign' | 'verify'
  iterations: number
  avgMs: number
  opsPerSec: number
}

import { benchmarkSdJwt, benchmarkMdoc, MDOC_FIELDS } from './signatureSpeed'

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

  const t0 = performance.now()
  let token = warmToken
  for (let i = 0; i < iterations; i++) {
    token = await sdJwtSignNoLib({ ...SD_JWT_PAYLOAD_P256, iat: Date.now() + i }, privateKey)
  }
  const signTotal = performance.now() - t0

  const t1 = performance.now()
  for (let i = 0; i < iterations; i++) await sdJwtVerifyNoLib(token, publicKey)
  const verifyTotal = performance.now() - t1

  return [
    { format: 'SD-JWT VC', mode: 'noLib', operation: 'sign',   iterations, avgMs: signTotal / iterations,   opsPerSec: (iterations / signTotal)   * 1000 },
    { format: 'SD-JWT VC', mode: 'noLib', operation: 'verify', iterations, avgMs: verifyTotal / iterations, opsPerSec: (iterations / verifyTotal) * 1000 },
  ]
}

async function benchmarkMdocNoLib(iterations: number): Promise<NoLibResult[]> {
  const { privateKey, publicKey } = await mdocGenKeyNoLib()
  const warmMdoc = await mdocSignNoLib(MDOC_FIELDS, privateKey)
  await mdocVerifyNoLib(warmMdoc, publicKey)

  const t0 = performance.now()
  let last = warmMdoc
  for (let i = 0; i < iterations; i++) last = await mdocSignNoLib({ ...MDOC_FIELDS, document_number: `JP-${i}` }, privateKey)
  const signTotal = performance.now() - t0

  const t1 = performance.now()
  for (let i = 0; i < iterations; i++) await mdocVerifyNoLib(last, publicKey)
  const verifyTotal = performance.now() - t1

  return [
    { format: 'mdoc', mode: 'noLib', operation: 'sign',   iterations, avgMs: signTotal / iterations,   opsPerSec: (iterations / signTotal)   * 1000 },
    { format: 'mdoc', mode: 'noLib', operation: 'verify', iterations, avgMs: verifyTotal / iterations, opsPerSec: (iterations / verifyTotal) * 1000 },
  ]
}

export async function runNoLibBenchmarks(
  iterations: number,
  onProgress: (msg: string) => void,
): Promise<NoLibResult[]> {
  onProgress('SD-JWT VC ライブラリあり計測中...')
  const sdWithLib = (await benchmarkSdJwt(iterations)).map<NoLibResult>(r => ({ ...r, mode: 'withLib' as const }))

  onProgress('SD-JWT VC ライブラリなし計測中...')
  const sdNoLib = await benchmarkSdJwtNoLib(iterations)

  onProgress('mdoc ライブラリあり計測中...')
  const mdWithLib = (await benchmarkMdoc(iterations)).map<NoLibResult>(r => ({ ...r, mode: 'withLib' as const }))

  onProgress('mdoc ライブラリなし計測中...')
  const mdNoLib = await benchmarkMdocNoLib(iterations)

  onProgress('完了')
  return [...sdWithLib, ...sdNoLib, ...mdWithLib, ...mdNoLib]
}
