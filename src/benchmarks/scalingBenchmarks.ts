// ============================================================
// scalingBenchmarks.ts — 5 specialized benchmark categories
// ============================================================

import jsonld from 'jsonld'
import { cborEncode, cborDecode } from './noLibrary'
import { makeStaticContextLoader, VC_CONTEXT_URL } from '../data/staticContexts'
import { generateEd25519KeyPair, ed25519Sign, ed25519Verify } from '../lib/cryptoUtils'
import { generateKeyPair, SignJWT, jwtVerify } from 'jose'

export type ScalingBenchmark =
  | 'attrScaling'
  | 'contextLoader'
  | 'callLimit'
  | 'selectiveDisc'
  | 'unifiedEd25519'

export interface ScalingResult {
  benchmark: ScalingBenchmark
  format: 'SD-JWT VC' | 'JSON-LD VC' | 'JSON-LD VC (JCS)' | 'mdoc'
  label: string
  attrCount?: number
  disclosedCount?: number
  condition?: string
  iterations: number
  avgMs: number
  opsPerSec: number
  stdDevMs: number
  ci95Ms: number
  p50Ms: number
  p90Ms: number
  p95Ms: number
  p99Ms: number
  minMs: number
  maxMs: number
  payloadSizeBytes?: number
  timedOut?: boolean
}

export interface ScalingBenchResults {
  attrScaling: ScalingResult[]
  contextLoader: ScalingResult[]
  callLimit: ScalingResult[]
  selectiveDisc: ScalingResult[]
  unifiedEd25519: ScalingResult[]
}

// ── Stats helper ─────────────────────────────────────────────────
function msStats(timingsMs: number[]) {
  const n = timingsMs.length
  const sorted = [...timingsMs].sort((a, b) => a - b)
  const avg = sorted.reduce((s, v) => s + v, 0) / n
  const variance = sorted.reduce((s, v) => s + (v - avg) ** 2, 0) / n
  const stdDev = Math.sqrt(variance)
  const p = (pct: number) => sorted[Math.min(Math.floor(n * pct), n - 1)]
  return {
    avgMs: avg, opsPerSec: 1000 / avg,
    stdDevMs: stdDev, ci95Ms: 1.96 * stdDev / Math.sqrt(n),
    p50Ms: p(0.50), p90Ms: p(0.90), p95Ms: p(0.95), p99Ms: p(0.99),
    minMs: sorted[0], maxMs: sorted[n - 1],
  }
}

function singleMs(ms: number): Omit<ReturnType<typeof msStats>, never> {
  return {
    avgMs: ms, opsPerSec: ms > 0 ? 1000 / ms : 0,
    stdDevMs: 0, ci95Ms: 0,
    p50Ms: ms, p90Ms: ms, p95Ms: ms, p99Ms: ms,
    minMs: ms, maxMs: ms,
  }
}

// ── Attribute generation ──────────────────────────────────────────
function makeAttrs(n: number): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (let i = 0; i < n; i++) {
    attrs[`attr_${String(i).padStart(3, '0')}`] = `value_${String(i).padStart(3, '0')}`
  }
  return attrs
}

// ── JCS canonical ─────────────────────────────────────────────────
function jcsCanonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + (v as unknown[]).map(jcsCanonical).join(',') + ']'
  const obj = v as Record<string, unknown>
  return '{' + Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${jcsCanonical(obj[k])}`).join(',') + '}'
}

// ── Inline RDF normalize (handles arbitrary @vocab attributes) ────
const VOCAB = 'https://example.com/vocab#'
const _CRED_NS = 'https://www.w3.org/2018/credentials#'
const _RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

function ntLit(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`
}

function attrNormalize(
  credId: string,
  issuerId: string,
  subjectId: string,
  attrs: Record<string, string>,
): string {
  const quads: string[] = []
  quads.push(`<${credId}> <${_RDF_TYPE}> <${_CRED_NS}VerifiableCredential> .`)
  quads.push(`<${credId}> <${_CRED_NS}issuer> <${issuerId}> .`)
  quads.push(`<${credId}> <${_CRED_NS}credentialSubject> <${subjectId}> .`)
  for (const [k, v] of Object.entries(attrs)) {
    quads.push(`<${subjectId}> <${VOCAB}${k}> ${ntLit(v)} .`)
  }
  return quads.sort().join('\n') + '\n'
}

// ── b64url helper ─────────────────────────────────────────────────
function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// ── mdoc with Ed25519 (COSE_Sign1, alg=-8) ───────────────────────
const ALG_EDDSA = -8
const NS_MDL = 'org.iso.18013.5.1'

async function issueMdocEd25519(
  fields: Record<string, string>,
  privateKey: Uint8Array,
): Promise<Uint8Array> {
  const itemBytes: Uint8Array[] = []
  const valueDigestMap = new Map<number, Uint8Array>()
  let id = 0
  for (const [key, value] of Object.entries(fields)) {
    const item = new Map<string, unknown>([
      ['digestID', id], ['random', crypto.getRandomValues(new Uint8Array(16))],
      ['elementIdentifier', key], ['elementValue', value],
    ])
    const encoded = cborEncode(item)
    valueDigestMap.set(id, new Uint8Array(await crypto.subtle.digest('SHA-256', encoded as unknown as BufferSource)))
    itemBytes.push(encoded)
    id++
  }

  const mso = new Map<string, unknown>([
    ['version', '1.0'], ['digestAlgorithm', 'SHA-256'],
    ['valueDigests', new Map([[NS_MDL, valueDigestMap]])],
    ['docType', 'org.iso.18013.5.1.mDL'],
    ['validityInfo', new Map([
      ['signed', new Date().toISOString()],
      ['validFrom', new Date().toISOString()],
      ['validUntil', new Date(Date.now() + 86400000).toISOString()],
    ])],
  ])

  const protectedHeader = cborEncode(new Map<number, number>([[1, ALG_EDDSA]]))
  const msoPayload = cborEncode(mso)
  const sigStructure = cborEncode(['Signature1', protectedHeader, new Uint8Array(0), msoPayload])
  const sig = await ed25519Sign(sigStructure, privateKey)

  return cborEncode(new Map<string, unknown>([
    ['docType', 'org.iso.18013.5.1.mDL'],
    ['issuerSigned', new Map<string, unknown>([
      ['nameSpaces', new Map([[NS_MDL, itemBytes]])],
      ['issuerAuth', [protectedHeader, new Map(), msoPayload, sig]],
    ])],
  ]))
}

type AnyMap = Map<unknown, unknown>

async function verifyMdocEd25519(mdocBytes: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
  const doc = cborDecode(mdocBytes) as AnyMap
  const iSigned = doc.get('issuerSigned') as AnyMap
  const coseSign1 = iSigned.get('issuerAuth') as unknown[]
  const [protHdr, , msoPay, sig] = coseSign1 as [Uint8Array, unknown, Uint8Array, Uint8Array]
  const sigStructure = cborEncode(['Signature1', protHdr, new Uint8Array(0), msoPay])
  return ed25519Verify(sig, sigStructure, publicKey)
}

// ============================================================
// 1. 属性数スケーリング
// ============================================================

export async function runAttrScalingBenchmark(
  attrCounts: number[] = [5, 20, 100, 500],
  iterations = 100,
  onProgress?: (msg: string) => void,
): Promise<ScalingResult[]> {
  const results: ScalingResult[] = []
  const CRED_ID = 'urn:example:cred:001'
  const ISSUER_ID = 'did:example:issuer'
  const SUBJ_ID = 'did:example:subject:001'

  for (const n of attrCounts) {
    onProgress?.(`属性数スケーリング: ${n}属性...`)
    const attrs = makeAttrs(n)

    // SD-JWT VC: JSON.stringify
    const sdPayload = { iss: ISSUER_ID, iat: 0, exp: 3600, vct: 'https://example.com/vc', sub: SUBJ_ID, ...attrs }
    let sdJson = ''
    const sdTimings: number[] = []
    for (let i = 0; i < iterations; i++) {
      const t = performance.now()
      sdJson = JSON.stringify({ ...sdPayload, iat: i })
      sdTimings.push(performance.now() - t)
    }
    results.push({
      benchmark: 'attrScaling', format: 'SD-JWT VC',
      label: `${n}属性`, attrCount: n, iterations,
      payloadSizeBytes: new TextEncoder().encode(sdJson).length,
      ...msStats(sdTimings),
    })

    // JSON-LD VC: inline URDNA2015 (attrNormalize)
    let jldNorm = ''
    const jldTimings: number[] = []
    for (let i = 0; i < iterations; i++) {
      const t = performance.now()
      jldNorm = attrNormalize(CRED_ID, ISSUER_ID, SUBJ_ID, { ...attrs, _seq: String(i) })
      jldTimings.push(performance.now() - t)
    }
    results.push({
      benchmark: 'attrScaling', format: 'JSON-LD VC',
      label: `${n}属性`, attrCount: n, iterations,
      payloadSizeBytes: new TextEncoder().encode(jldNorm).length,
      ...msStats(jldTimings),
    })

    // JSON-LD VC (JCS): JCS canonical
    const jldDoc = {
      '@context': [VC_CONTEXT_URL, { '@vocab': VOCAB }],
      id: CRED_ID, type: ['VerifiableCredential'],
      issuer: ISSUER_ID,
      credentialSubject: { id: SUBJ_ID, ...attrs },
    }
    let jcsResult = ''
    const jcsTimings: number[] = []
    for (let i = 0; i < iterations; i++) {
      const t = performance.now()
      jcsResult = jcsCanonical({ ...jldDoc, iat: i })
      jcsTimings.push(performance.now() - t)
    }
    results.push({
      benchmark: 'attrScaling', format: 'JSON-LD VC (JCS)',
      label: `${n}属性`, attrCount: n, iterations,
      payloadSizeBytes: new TextEncoder().encode(jcsResult).length,
      ...msStats(jcsTimings),
    })

    // mdoc: CBOR encode N items
    const allItems = Object.entries(attrs).map(([k, v], idx) =>
      cborEncode(new Map<string, unknown>([
        ['digestID', idx], ['random', new Uint8Array(8)],
        ['elementIdentifier', k], ['elementValue', v],
      ]))
    )
    let mdocBytes: Uint8Array = new Uint8Array(0)
    const mdocTimings: number[] = []
    for (let i = 0; i < iterations; i++) {
      const t = performance.now()
      const doc = new Map<string, unknown>([
        ['docType', 'org.iso.18013.5.1.mDL'],
        ['issuerSigned', new Map<string, unknown>([
          ['nameSpaces', new Map([[NS_MDL, allItems]])],
          ['issuerAuth', [new Uint8Array([0xa1, 0x01, 0x26]), new Map(), new Uint8Array(16), new Uint8Array(64)]],
        ])],
      ])
      mdocBytes = cborEncode(doc) as unknown as Uint8Array
      mdocTimings.push(performance.now() - t)
    }
    results.push({
      benchmark: 'attrScaling', format: 'mdoc',
      label: `${n}属性`, attrCount: n, iterations,
      payloadSizeBytes: mdocBytes.length,
      ...msStats(mdocTimings),
    })

    await new Promise(resolve => setTimeout(resolve, 0))
  }

  return results
}

// ============================================================
// 2. JSON-LD context loader比較
// ============================================================

export async function runContextLoaderBenchmark(
  iterations = 5,
  onProgress?: (msg: string) => void,
): Promise<ScalingResult[]> {
  const results: ScalingResult[] = []
  const cred = {
    '@context': [VC_CONTEXT_URL],
    id: 'urn:example:cred:001',
    type: ['VerifiableCredential'],
    issuer: 'did:example:issuer',
    issuanceDate: '2024-01-01T00:00:00Z',
    credentialSubject: { id: 'did:example:sub', given_name: 'Taro', family_name: 'Yamada' },
  }

  // 1. Static loader: pre-loaded context, no network
  onProgress?.('コンテキストローダー: 静的ローダー計測中...')
  const staticLoader = makeStaticContextLoader()
  const staticTimings: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    await (jsonld.normalize as unknown as (d: unknown, opts: unknown) => Promise<string>)(cred, {
      algorithm: 'URDNA2015', format: 'application/n-quads',
      documentLoader: staticLoader,
    })
    staticTimings.push(performance.now() - t)
  }
  results.push({
    benchmark: 'contextLoader', format: 'JSON-LD VC',
    label: '静的ローダー (制限あり・SSRF安全)', condition: 'static',
    iterations, ...msStats(staticTimings),
  })

  // 2. Permissive loader: simulates 50ms network latency per normalize call
  //    Each iteration explicitly waits for the "network round-trip" before normalizing.
  //    This demonstrates the performance cost AND SSRF attack surface of permissive loaders.
  onProgress?.('コンテキストローダー: リモートローダー (ネットワーク遅延シミュレーション) 計測中...')
  const NETWORK_DELAY_MS = 50
  const permissiveTimings: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    // Simulate one network round-trip per context URL (typical for permissive loaders)
    await new Promise(resolve => setTimeout(resolve, NETWORK_DELAY_MS))
    // Normalize using cached context (same result, but with added network exposure risk)
    await (jsonld.normalize as unknown as (d: unknown, opts: unknown) => Promise<string>)(cred, {
      algorithm: 'URDNA2015', format: 'application/n-quads',
      documentLoader: staticLoader,
    })
    permissiveTimings.push(performance.now() - t)
  }
  results.push({
    benchmark: 'contextLoader', format: 'JSON-LD VC',
    label: `リモートローダー (${NETWORK_DELAY_MS}ms遅延・SSRF危険)`, condition: 'permissive',
    iterations, ...msStats(permissiveTimings),
  })

  return results
}

// ============================================================
// 3. URDNA2015 call limit / DoS mitigation
// ============================================================

// Blank nodes with identical connectivity → URDNA2015 must try permutations
function makeBlankNodeGraph(nodeCount: number) {
  return {
    '@graph': Array.from({ length: nodeCount }, (_, i) => ({
      '@id': `_:b${i}`,
      '@type': 'http://example.org/Node',
      'http://example.org/next': { '@id': `_:b${(i + 1) % nodeCount}` },
      'http://example.org/prev': { '@id': `_:b${(i + nodeCount - 1) % nodeCount}` },
    })),
  }
}

export async function runCallLimitBenchmark(
  timeoutMs = 2000,
  onProgress?: (msg: string) => void,
): Promise<ScalingResult[]> {
  const results: ScalingResult[] = []
  const staticLoader = makeStaticContextLoader()

  const _normalize = jsonld.normalize as unknown as (d: unknown, opts: unknown) => Promise<string>
  const normalizeDoc = (doc: unknown) =>
    _normalize(doc, { algorithm: 'URDNA2015', format: 'application/n-quads', documentLoader: staticLoader })

  const withTimeout = (doc: unknown, limit: number): Promise<string> =>
    Promise.race([
      normalizeDoc(doc),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timeout:${limit}`)), limit)),
    ])

  for (const nodeCount of [2, 4, 6, 8]) {
    const doc = makeBlankNodeGraph(nodeCount)
    const label = `${nodeCount}ノード 循環グラフ`

    // Without timeout
    onProgress?.(`URDNA2015: ${label} (タイムアウトなし)...`)
    try {
      const t0 = performance.now()
      await normalizeDoc(doc)
      const elapsed = performance.now() - t0
      results.push({
        benchmark: 'callLimit', format: 'JSON-LD VC',
        label, condition: 'without', iterations: 1,
        timedOut: false, ...singleMs(elapsed),
      })
    } catch {
      results.push({
        benchmark: 'callLimit', format: 'JSON-LD VC',
        label, condition: 'without', iterations: 1,
        timedOut: true, ...singleMs(timeoutMs * 2),
      })
    }

    // With timeout
    onProgress?.(`URDNA2015: ${label} (タイムアウト ${timeoutMs}ms)...`)
    let timedOut = false
    const t0 = performance.now()
    try {
      await withTimeout(doc, timeoutMs)
    } catch {
      timedOut = true
    }
    const elapsed = performance.now() - t0
    results.push({
      benchmark: 'callLimit', format: 'JSON-LD VC',
      label, condition: 'with', iterations: 1,
      timedOut, ...singleMs(elapsed),
    })

    await new Promise(resolve => setTimeout(resolve, 10))
  }

  return results
}

// ============================================================
// 4. 選択的開示性能比較
// ============================================================

async function makeDisclosure(key: string, value: string): Promise<{ hash: string; disclosure: string; key: string }> {
  const salt = b64url(crypto.getRandomValues(new Uint8Array(16)))
  const disclosure = b64url(JSON.stringify([salt, key, value]))
  const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(disclosure))
  return { hash: b64url(new Uint8Array(hashBuf)), disclosure, key }
}

export async function runSelectiveDiscBenchmark(
  totalAttrs = 20,
  disclosedCounts: number[] = [1, 3, 5, 10, 20],
  iterations = 50,
  onProgress?: (msg: string) => void,
): Promise<ScalingResult[]> {
  const results: ScalingResult[] = []
  const attrs = makeAttrs(totalAttrs)
  const attrEntries = Object.entries(attrs)
  const CRED_ID = 'urn:example:cred:seldisc'
  const ISSUER_ID = 'did:example:issuer'
  const SUBJ_ID = 'did:example:subject:001'

  onProgress?.('選択的開示: SHA-256 ハッシュ事前計算中...')
  const allDisclosures = await Promise.all(
    attrEntries.map(([k, v]) => makeDisclosure(k, v))
  )

  // Pre-encode mdoc items (once)
  const allMdocItems = attrEntries.map(([k, v], idx) =>
    cborEncode(new Map<string, unknown>([
      ['digestID', idx], ['random', new Uint8Array(8)],
      ['elementIdentifier', k], ['elementValue', v],
    ]))
  )

  for (const n of disclosedCounts) {
    // SD-JWT selective disclosure presentation
    onProgress?.(`選択的開示: SD-JWT ${n}/${totalAttrs}属性...`)
    const hiddenDisclosures = allDisclosures.slice(n)
    const revealedDisclosures = allDisclosures.slice(0, n)
    const sdTimings: number[] = []

    for (let i = 0; i < iterations; i++) {
      const t = performance.now()
      const payload = {
        iss: 'did:example:issuer', iat: i, exp: i + 3600,
        vct: 'https://example.com/vc',
        _sd: hiddenDisclosures.map(d => d.hash),
        ...Object.fromEntries(revealedDisclosures.map(d => [d.key, attrs[d.key]])),
      }
      const hdr = b64url('{"alg":"EdDSA","typ":"vc+sd-jwt"}')
      const pay = b64url(JSON.stringify(payload))
      void `${hdr}.${pay}.FAKESIG~${revealedDisclosures.map(d => d.disclosure).join('~')}`
      sdTimings.push(performance.now() - t)
    }
    results.push({
      benchmark: 'selectiveDisc', format: 'SD-JWT VC',
      label: `SD-JWT ${n}/${totalAttrs}属性開示`, disclosedCount: n,
      iterations, ...msStats(sdTimings),
    })

    // mdoc selective disclosure presentation
    onProgress?.(`選択的開示: mdoc ${n}/${totalAttrs}属性...`)
    const selectedItems = allMdocItems.slice(0, n)
    const mdocTimings: number[] = []
    for (let i = 0; i < iterations; i++) {
      const t = performance.now()
      cborEncode(new Map<string, unknown>([
        ['docType', 'org.iso.18013.5.1.mDL'],
        ['issuerSigned', new Map<string, unknown>([
          ['nameSpaces', new Map([[NS_MDL, selectedItems]])],
          ['issuerAuth', [new Uint8Array([0xa1, 0x01, 0x26]), new Map(), new Uint8Array(16), new Uint8Array(64)]],
        ])],
      ]))
      mdocTimings.push(performance.now() - t)
    }
    results.push({
      benchmark: 'selectiveDisc', format: 'mdoc',
      label: `mdoc ${n}/${totalAttrs}属性開示`, disclosedCount: n,
      iterations, ...msStats(mdocTimings),
    })

    // JSON-LD VC selective disclosure: re-normalize derived credential (URDNA2015)
    onProgress?.(`選択的開示: JSON-LD VC ${n}/${totalAttrs}属性...`)
    const revealedAttrs = Object.fromEntries(attrEntries.slice(0, n))
    const jldTimings: number[] = []
    for (let i = 0; i < iterations; i++) {
      const t = performance.now()
      attrNormalize(CRED_ID, ISSUER_ID, SUBJ_ID, { ...revealedAttrs, _seq: String(i) })
      jldTimings.push(performance.now() - t)
    }
    results.push({
      benchmark: 'selectiveDisc', format: 'JSON-LD VC',
      label: `JSON-LD VC ${n}/${totalAttrs}属性開示`, disclosedCount: n,
      iterations, ...msStats(jldTimings),
    })

    // JSON-LD VC (JCS) selective disclosure: re-canonicalize disclosed subset
    onProgress?.(`選択的開示: JSON-LD VC (JCS) ${n}/${totalAttrs}属性...`)
    const jcsDoc = {
      '@context': [VC_CONTEXT_URL, { '@vocab': VOCAB }],
      id: CRED_ID, type: ['VerifiableCredential'],
      issuer: ISSUER_ID,
      credentialSubject: { id: SUBJ_ID, ...revealedAttrs },
    }
    const jcsTimings: number[] = []
    for (let i = 0; i < iterations; i++) {
      const t = performance.now()
      jcsCanonical({ ...jcsDoc, iat: i })
      jcsTimings.push(performance.now() - t)
    }
    results.push({
      benchmark: 'selectiveDisc', format: 'JSON-LD VC (JCS)',
      label: `JSON-LD VC (JCS) ${n}/${totalAttrs}属性開示`, disclosedCount: n,
      iterations, ...msStats(jcsTimings),
    })
  }

  return results
}

// ============================================================
// 5. Ed25519統一ベンチマーク
// ============================================================

export async function runUnifiedEd25519Benchmark(
  iterations = 50,
  onProgress?: (msg: string) => void,
): Promise<ScalingResult[]> {
  const results: ScalingResult[] = []
  const FIELDS = makeAttrs(5)
  const CRED_ID = 'urn:example:cred:001'
  const ISSUER_ID = 'did:example:issuer'
  const SUBJ_ID = 'did:example:sub'
  const NOW = Math.floor(Date.now() / 1000)

  // ── SD-JWT VC with Ed25519 (jose EdDSA) ─────────────────────
  onProgress?.('Ed25519統一: SD-JWT VC (EdDSA)...')
  const { privateKey: sdPriv, publicKey: sdPub } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
  const sdPayload = { iss: ISSUER_ID, iat: NOW, exp: NOW + 3600, sub: SUBJ_ID, ...FIELDS }
  const warmSd = await new SignJWT(sdPayload).setProtectedHeader({ alg: 'EdDSA' }).sign(sdPriv)
  await jwtVerify(warmSd, sdPub)

  const sdSignTimings: number[] = []
  let lastSd = warmSd
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    lastSd = await new SignJWT({ ...sdPayload, iat: NOW + i }).setProtectedHeader({ alg: 'EdDSA' }).sign(sdPriv)
    sdSignTimings.push(performance.now() - t)
  }
  results.push({
    benchmark: 'unifiedEd25519', format: 'SD-JWT VC',
    label: 'SD-JWT VC / sign', condition: 'sign',
    iterations, ...msStats(sdSignTimings),
  })

  const sdVerifyTimings: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    await jwtVerify(lastSd, sdPub)
    sdVerifyTimings.push(performance.now() - t)
  }
  results.push({
    benchmark: 'unifiedEd25519', format: 'SD-JWT VC',
    label: 'SD-JWT VC / verify', condition: 'verify',
    iterations, ...msStats(sdVerifyTimings),
  })

  // ── JSON-LD VC with Ed25519 (URDNA2015 inline + sha256) ─────
  onProgress?.('Ed25519統一: JSON-LD VC (Ed25519+URDNA2015)...')
  const { privateKey: jldPriv, publicKey: jldPub } = await generateEd25519KeyPair()
  const enc = new TextEncoder()

  const warmNorm = attrNormalize(CRED_ID, ISSUER_ID, SUBJ_ID, FIELDS)
  const warmHash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(warmNorm)))
  const warmJldSig = await ed25519Sign(warmHash, jldPriv)
  await ed25519Verify(warmJldSig, warmHash, jldPub)

  const jldSignTimings: number[] = []
  let lastJldSig = warmJldSig
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    const norm = attrNormalize(CRED_ID, ISSUER_ID, SUBJ_ID, { ...FIELDS, _seq: String(i) })
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(norm)))
    lastJldSig = await ed25519Sign(hash, jldPriv)
    jldSignTimings.push(performance.now() - t)
  }
  results.push({
    benchmark: 'unifiedEd25519', format: 'JSON-LD VC',
    label: 'JSON-LD VC / sign (URDNA2015+SHA-256)', condition: 'sign',
    iterations, ...msStats(jldSignTimings),
  })

  const jldVerifyTimings: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    const norm = attrNormalize(CRED_ID, ISSUER_ID, SUBJ_ID, { ...FIELDS, _seq: String(i) })
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(norm)))
    await ed25519Verify(lastJldSig, hash, jldPub)
    jldVerifyTimings.push(performance.now() - t)
  }
  results.push({
    benchmark: 'unifiedEd25519', format: 'JSON-LD VC',
    label: 'JSON-LD VC / verify (URDNA2015+SHA-256)', condition: 'verify',
    iterations, ...msStats(jldVerifyTimings),
  })

  // ── mdoc with Ed25519 (EdDSA COSE_Sign1, alg=-8) ────────────
  onProgress?.('Ed25519統一: mdoc (Ed25519 COSE_Sign1)...')
  const { privateKey: mdocPriv, publicKey: mdocPub } = await generateEd25519KeyPair()
  const warmMdoc = await issueMdocEd25519(FIELDS, mdocPriv)
  await verifyMdocEd25519(warmMdoc, mdocPub)

  const mdocSignTimings: number[] = []
  let lastMdoc = warmMdoc
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    lastMdoc = await issueMdocEd25519({ ...FIELDS, _seq: String(i) }, mdocPriv)
    mdocSignTimings.push(performance.now() - t)
  }
  results.push({
    benchmark: 'unifiedEd25519', format: 'mdoc',
    label: 'mdoc / sign (Ed25519 COSE_Sign1)', condition: 'sign',
    iterations, ...msStats(mdocSignTimings),
  })

  const mdocVerifyTimings: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t = performance.now()
    await verifyMdocEd25519(lastMdoc, mdocPub)
    mdocVerifyTimings.push(performance.now() - t)
  }
  results.push({
    benchmark: 'unifiedEd25519', format: 'mdoc',
    label: 'mdoc / verify (Ed25519 COSE_Sign1)', condition: 'verify',
    iterations, ...msStats(mdocVerifyTimings),
  })

  return results
}

// ============================================================
// Main runner
// ============================================================

export async function runScalingBenchmarks(
  iterations = 50,
  onProgress?: (msg: string) => void,
): Promise<ScalingBenchResults> {
  onProgress?.('[1/5] 属性数スケーリング...')
  const attrScaling = await runAttrScalingBenchmark([5, 20, 100, 500], Math.max(iterations, 100), onProgress)

  onProgress?.('[2/5] JSON-LD コンテキストローダー比較...')
  const contextLoader = await runContextLoaderBenchmark(Math.min(iterations, 5), onProgress)

  onProgress?.('[3/5] URDNA2015 call limit 比較...')
  const callLimit = await runCallLimitBenchmark(2000, onProgress)

  onProgress?.('[4/5] 選択的開示性能比較...')
  const selectiveDisc = await runSelectiveDiscBenchmark(20, [1, 3, 5, 10, 20], Math.max(iterations, 50), onProgress)

  onProgress?.('[5/5] Ed25519 統一ベンチマーク...')
  const unifiedEd25519 = await runUnifiedEd25519Benchmark(iterations, onProgress)

  return { attrScaling, contextLoader, callLimit, selectiveDisc, unifiedEd25519 }
}
