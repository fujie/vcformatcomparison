import { SignJWT, generateKeyPair, jwtVerify } from 'jose'
import jsonld from 'jsonld'
import { generateEd25519KeyPair, ed25519Sign, ed25519Verify, sha256 } from '../lib/cryptoUtils'
import { makeStaticContextLoader, VC_CONTEXT_URL } from '../data/staticContexts'
import { generateMdocKeyPair, issueMdoc, verifyMdoc } from '../lib/mdocUtils'

export type FormatName = 'SD-JWT VC' | 'JSON-LD VC' | 'JSON-LD VC (JCS)' | 'mdoc'

export interface SpeedResult {
  format: FormatName
  operation: 'sign' | 'verify'
  iterations: number
  totalMs: number
  avgMs: number
  opsPerSec: number
  breakdown?: Record<string, number>
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

// --- Sample credential payloads ---

export const SD_JWT_PAYLOAD = {
  iss: 'https://issuer.example.com',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
  vct: 'https://credentials.example.com/identity',
  sub: 'did:example:holder123',
  given_name: 'Taro',
  family_name: 'Yamada',
  birthdate: '1990-01-01',
  address: { street_address: '1-1-1 Shibuya', locality: 'Tokyo', country: 'JP' },
}

export const JSONLD_CREDENTIAL = {
  '@context': [VC_CONTEXT_URL],
  id: 'https://example.com/credentials/1872',
  type: 'VerifiableCredential',
  issuer: 'https://issuer.example.com',
  issuanceDate: new Date().toISOString(),
  credentialSubject: {
    id: 'did:example:holder123',
    given_name: 'Taro',
    family_name: 'Yamada',
    birthdate: '1990-01-01',
  },
}

export const MDOC_FIELDS = {
  family_name: 'Yamada',
  given_name: 'Taro',
  birth_date: '1990-01-01',
  issue_date: '2024-01-01',
  expiry_date: '2029-01-01',
  issuing_country: 'JP',
  document_number: 'JP-12345678',
  portrait: 'base64encodedimage...',
}

// --- SD-JWT VC benchmark ---

export async function benchmarkSdJwt(iterations = 100): Promise<SpeedResult[]> {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })

  const signedToken = await new SignJWT(SD_JWT_PAYLOAD)
    .setProtectedHeader({ alg: 'EdDSA' })
    .sign(privateKey)
  await jwtVerify(signedToken, publicKey)

  const signTimings: number[] = []
  let token = ''
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    token = await new SignJWT({ ...SD_JWT_PAYLOAD, iat: Math.floor(Date.now() / 1000) + i })
      .setProtectedHeader({ alg: 'EdDSA' })
      .sign(privateKey)
    signTimings.push(performance.now() - t)
  }
  const signStats = computeMsStats(signTimings)

  const verifyTimings: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    await jwtVerify(token, publicKey)
    verifyTimings.push(performance.now() - t)
  }
  const verifyStats = computeMsStats(verifyTimings)

  return [
    { format: 'SD-JWT VC', operation: 'sign', iterations, totalMs: signStats.avgMs * iterations, ...signStats },
    { format: 'SD-JWT VC', operation: 'verify', iterations, totalMs: verifyStats.avgMs * iterations, ...verifyStats },
  ]
}

// --- JSON-LD VC benchmark ---

export async function benchmarkJsonLdVc(iterations = 100): Promise<SpeedResult[]> {
  const keys = await generateEd25519KeyPair()
  const loader = makeStaticContextLoader()
  const normalizeOpts = { algorithm: 'URDNA2015' as const, format: 'application/n-quads' as const, documentLoader: loader, safe: false }

  const warmNorm = await jsonld.normalize(JSONLD_CREDENTIAL, normalizeOpts)
  const warmHash = await sha256(warmNorm as string)
  const warmSig = await ed25519Sign(warmHash, keys.privateKey)
  await ed25519Verify(warmSig, warmHash, keys.publicKey)

  const signBreakdown = { normalize: 0, hash: 0, sign: 0 }
  const signPerIter: number[] = []
  let lastSig = warmSig

  for (let i = 0; i < iterations; i++) {
    const tTotal = performance.now()
    const t0 = performance.now()
    const normalized = (await jsonld.normalize(JSONLD_CREDENTIAL, normalizeOpts)) as string
    signBreakdown.normalize += performance.now() - t0
    const t1 = performance.now()
    const hash = await sha256(normalized)
    signBreakdown.hash += performance.now() - t1
    const t2 = performance.now()
    lastSig = await ed25519Sign(hash, keys.privateKey)
    signBreakdown.sign += performance.now() - t2
    signPerIter.push(performance.now() - tTotal)
  }
  const signStats = computeMsStats(signPerIter)

  const verifyBreakdown = { normalize: 0, hash: 0, verify: 0 }
  const verifyPerIter: number[] = []
  for (let i = 0; i < iterations; i++) {
    const tTotal = performance.now()
    const t0 = performance.now()
    const normalized = (await jsonld.normalize(JSONLD_CREDENTIAL, normalizeOpts)) as string
    verifyBreakdown.normalize += performance.now() - t0
    const t1 = performance.now()
    const hash = await sha256(normalized)
    verifyBreakdown.hash += performance.now() - t1
    const t2 = performance.now()
    await ed25519Verify(lastSig, hash, keys.publicKey)
    verifyBreakdown.verify += performance.now() - t2
    verifyPerIter.push(performance.now() - tTotal)
  }
  const verifyStats = computeMsStats(verifyPerIter)

  return [
    {
      format: 'JSON-LD VC', operation: 'sign', iterations, totalMs: signStats.avgMs * iterations,
      ...signStats,
      breakdown: { normalize: signBreakdown.normalize / iterations, hash: signBreakdown.hash / iterations, sign: signBreakdown.sign / iterations },
    },
    {
      format: 'JSON-LD VC', operation: 'verify', iterations, totalMs: verifyStats.avgMs * iterations,
      ...verifyStats,
      breakdown: { normalize: verifyBreakdown.normalize / iterations, hash: verifyBreakdown.hash / iterations, verify: verifyBreakdown.verify / iterations },
    },
  ]
}

// --- mdoc benchmark (ISO 18013-5: CBOR + COSE_Sign1 + per-element SHA-256 digests) ---

export async function benchmarkMdoc(iterations = 100): Promise<SpeedResult[]> {
  const { privateKey, publicKey } = await generateMdocKeyPair()

  // Warm up
  const warmMdoc = await issueMdoc(MDOC_FIELDS, privateKey)
  await verifyMdoc(warmMdoc, publicKey)

  // Benchmark sign (CBOR encode + digest per element + COSE_Sign1)
  const signPerIter: number[] = []
  let lastMdoc = warmMdoc

  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    lastMdoc = await issueMdoc({ ...MDOC_FIELDS, document_number: `JP-${i}` }, privateKey)
    signPerIter.push(performance.now() - t)
  }
  const signStats = computeMsStats(signPerIter)

  const verifyPerIter: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    await verifyMdoc(lastMdoc, publicKey)
    verifyPerIter.push(performance.now() - t)
  }
  const verifyStats = computeMsStats(verifyPerIter)

  return [
    { format: 'mdoc', operation: 'sign', iterations, totalMs: signStats.avgMs * iterations, ...signStats },
    { format: 'mdoc', operation: 'verify', iterations, totalMs: verifyStats.avgMs * iterations, ...verifyStats },
  ]
}

// --- JSON-LD VC (JCS) benchmark — eddsa-jcs-2022: JCS canonicalization + SHA-256 + Ed25519 ---
function jcsCanonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + (v as unknown[]).map(jcsCanonical).join(',') + ']'
  const obj = v as Record<string, unknown>
  return '{' + Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${jcsCanonical(obj[k])}`).join(',') + '}'
}

export async function benchmarkJsonLdJcsVc(iterations = 100): Promise<SpeedResult[]> {
  const keys = await generateEd25519KeyPair()

  const warmCanon = jcsCanonical(JSONLD_CREDENTIAL)
  const warmHash = await sha256(warmCanon)
  const warmSig = await ed25519Sign(warmHash, keys.privateKey)
  await ed25519Verify(warmSig, warmHash, keys.publicKey)

  const signBreakdown = { canon: 0, hash: 0, sign: 0 }
  const signPerIter: number[] = []
  let lastSig = warmSig

  for (let i = 0; i < iterations; i++) {
    const tTotal = performance.now()
    const t0 = performance.now()
    const canon = jcsCanonical(JSONLD_CREDENTIAL)
    signBreakdown.canon += performance.now() - t0
    const t1 = performance.now()
    const hash = await sha256(canon)
    signBreakdown.hash += performance.now() - t1
    const t2 = performance.now()
    lastSig = await ed25519Sign(hash, keys.privateKey)
    signBreakdown.sign += performance.now() - t2
    signPerIter.push(performance.now() - tTotal)
  }
  const signStats = computeMsStats(signPerIter)

  const verifyBreakdown = { canon: 0, hash: 0, verify: 0 }
  const verifyPerIter: number[] = []
  for (let i = 0; i < iterations; i++) {
    const tTotal = performance.now()
    const t0 = performance.now()
    const canon = jcsCanonical(JSONLD_CREDENTIAL)
    verifyBreakdown.canon += performance.now() - t0
    const t1 = performance.now()
    const hash = await sha256(canon)
    verifyBreakdown.hash += performance.now() - t1
    const t2 = performance.now()
    await ed25519Verify(lastSig, hash, keys.publicKey)
    verifyBreakdown.verify += performance.now() - t2
    verifyPerIter.push(performance.now() - tTotal)
  }
  const verifyStats = computeMsStats(verifyPerIter)

  return [
    {
      format: 'JSON-LD VC (JCS)', operation: 'sign', iterations, totalMs: signStats.avgMs * iterations,
      ...signStats,
      breakdown: { canon: signBreakdown.canon / iterations, hash: signBreakdown.hash / iterations, sign: signBreakdown.sign / iterations },
    },
    {
      format: 'JSON-LD VC (JCS)', operation: 'verify', iterations, totalMs: verifyStats.avgMs * iterations,
      ...verifyStats,
      breakdown: { canon: verifyBreakdown.canon / iterations, hash: verifyBreakdown.hash / iterations, verify: verifyBreakdown.verify / iterations },
    },
  ]
}

export async function runSpeedBenchmarks(
  iterations: number,
  onProgress: (msg: string) => void,
): Promise<SpeedResult[]> {
  onProgress('SD-JWT VC ベンチマーク実行中...')
  const sdJwtResults = await benchmarkSdJwt(iterations)

  onProgress('JSON-LD VC ベンチマーク実行中（URDNA2015 正規化を含む）...')
  const jsonLdResults = await benchmarkJsonLdVc(iterations)

  onProgress('JSON-LD VC (JCS) ベンチマーク実行中（JCS 正規化）...')
  const jsonLdJcsResults = await benchmarkJsonLdJcsVc(iterations)

  onProgress('mdoc (ISO 18013-5) ベンチマーク実行中...')
  const mdocResults = await benchmarkMdoc(iterations)

  onProgress('完了')
  return [...sdJwtResults, ...jsonLdResults, ...jsonLdJcsResults, ...mdocResults]
}
