import { SignJWT, generateKeyPair, jwtVerify } from 'jose'
import jsonld from 'jsonld'
import { generateEd25519KeyPair, ed25519Sign, ed25519Verify, sha256 } from '../lib/cryptoUtils'
import { makeStaticContextLoader, VC_CONTEXT_URL } from '../data/staticContexts'
import { generateMdocKeyPair, issueMdoc, verifyMdoc } from '../lib/mdocUtils'

export type FormatName = 'SD-JWT VC' | 'JSON-LD VC' | 'mdoc'

export interface SpeedResult {
  format: FormatName
  operation: 'sign' | 'verify'
  iterations: number
  totalMs: number
  avgMs: number
  opsPerSec: number
  breakdown?: Record<string, number>
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

  const signStart = performance.now()
  let token = ''
  for (let i = 0; i < iterations; i++) {
    token = await new SignJWT({ ...SD_JWT_PAYLOAD, iat: Math.floor(Date.now() / 1000) + i })
      .setProtectedHeader({ alg: 'EdDSA' })
      .sign(privateKey)
  }
  const signTotal = performance.now() - signStart

  const verifyStart = performance.now()
  for (let i = 0; i < iterations; i++) {
    await jwtVerify(token, publicKey)
  }
  const verifyTotal = performance.now() - verifyStart

  return [
    { format: 'SD-JWT VC', operation: 'sign', iterations, totalMs: signTotal, avgMs: signTotal / iterations, opsPerSec: (iterations / signTotal) * 1000 },
    { format: 'SD-JWT VC', operation: 'verify', iterations, totalMs: verifyTotal, avgMs: verifyTotal / iterations, opsPerSec: (iterations / verifyTotal) * 1000 },
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

  const signTimings = { normalize: 0, hash: 0, sign: 0 }
  const signStart = performance.now()
  let lastSig = warmSig

  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now()
    const normalized = (await jsonld.normalize(JSONLD_CREDENTIAL, normalizeOpts)) as string
    signTimings.normalize += performance.now() - t0
    const t1 = performance.now()
    const hash = await sha256(normalized)
    signTimings.hash += performance.now() - t1
    const t2 = performance.now()
    lastSig = await ed25519Sign(hash, keys.privateKey)
    signTimings.sign += performance.now() - t2
  }
  const signTotal = performance.now() - signStart

  const verifyTimings = { normalize: 0, hash: 0, verify: 0 }
  const verifyStart = performance.now()
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now()
    const normalized = (await jsonld.normalize(JSONLD_CREDENTIAL, normalizeOpts)) as string
    verifyTimings.normalize += performance.now() - t0
    const t1 = performance.now()
    const hash = await sha256(normalized)
    verifyTimings.hash += performance.now() - t1
    const t2 = performance.now()
    await ed25519Verify(lastSig, hash, keys.publicKey)
    verifyTimings.verify += performance.now() - t2
  }
  const verifyTotal = performance.now() - verifyStart

  return [
    {
      format: 'JSON-LD VC', operation: 'sign', iterations, totalMs: signTotal,
      avgMs: signTotal / iterations, opsPerSec: (iterations / signTotal) * 1000,
      breakdown: { normalize: signTimings.normalize / iterations, hash: signTimings.hash / iterations, sign: signTimings.sign / iterations },
    },
    {
      format: 'JSON-LD VC', operation: 'verify', iterations, totalMs: verifyTotal,
      avgMs: verifyTotal / iterations, opsPerSec: (iterations / verifyTotal) * 1000,
      breakdown: { normalize: verifyTimings.normalize / iterations, hash: verifyTimings.hash / iterations, verify: verifyTimings.verify / iterations },
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
  const signTimings = { cbor: 0, digest: 0, cose: 0 }
  const signStart = performance.now()
  let lastMdoc = warmMdoc

  for (let i = 0; i < iterations; i++) {
    // issueMdoc already has internal timing split; we measure full sign here
    lastMdoc = await issueMdoc({ ...MDOC_FIELDS, document_number: `JP-${i}` }, privateKey)
  }
  const signTotal = performance.now() - signStart

  // Benchmark verify (CBOR decode + COSE verify + digest checks)
  const verifyStart = performance.now()
  for (let i = 0; i < iterations; i++) {
    await verifyMdoc(lastMdoc, publicKey)
  }
  const verifyTotal = performance.now() - verifyStart

  return [
    { format: 'mdoc', operation: 'sign', iterations, totalMs: signTotal, avgMs: signTotal / iterations, opsPerSec: (iterations / signTotal) * 1000 },
    { format: 'mdoc', operation: 'verify', iterations, totalMs: verifyTotal, avgMs: verifyTotal / iterations, opsPerSec: (iterations / verifyTotal) * 1000 },
  ]
}

export async function runSpeedBenchmarks(
  iterations: number,
  onProgress: (msg: string) => void,
): Promise<SpeedResult[]> {
  onProgress('SD-JWT VC ベンチマーク実行中...')
  const sdJwtResults = await benchmarkSdJwt(iterations)

  onProgress('JSON-LD VC ベンチマーク実行中（正規化を含む）...')
  const jsonLdResults = await benchmarkJsonLdVc(iterations)

  onProgress('mdoc (ISO 18013-5) ベンチマーク実行中...')
  const mdocResults = await benchmarkMdoc(iterations)

  onProgress('完了')
  return [...sdJwtResults, ...jsonLdResults, ...mdocResults]
}
