/**
 * Backend security tests — Node.js (same test suite as the browser frontend)
 * Returns SecurityTest-compatible objects so the frontend SecurityResults component
 * can render them without modification.
 */

import crypto from 'node:crypto'

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'none'

export interface BackendSecurityTest {
  id: string
  name: string
  format: 'SD-JWT VC' | 'JSON-LD VC' | 'mdoc' | 'Both'
  category: 'DoS' | 'Injection' | 'SSRF' | 'AlgorithmConfusion' | 'ContextHijack' | 'CborMalleability'
  severity: Severity
  description: string
  result: 'vulnerable' | 'mitigated' | 'partial' | 'not-applicable'
  details: string
  timeMs?: number
  normalTimeMs?: number
  cveReferences?: string[]
}

export type ProgressCallback = (msg: string) => void

// ── Helpers ───────────────────────────────────────────────────────────────────

function b64url(b: Buffer | Uint8Array) {
  return Buffer.from(b).toString('base64url')
}

function now() { return Number(process.hrtime.bigint()) / 1_000_000 }

// ── Tests ─────────────────────────────────────────────────────────────────────

async function testPoisonGraph(): Promise<BackendSecurityTest> {
  const jsonld = (await import('jsonld')).default
  const normalOpts = { algorithm: 'URDNA2015' as const, format: 'application/n-quads' as const, safe: false }

  const normalDoc = {
    '@context': { vc: 'https://www.w3.org/2018/credentials#', type: 'vc:type', issuer: 'vc:issuer' },
    type: 'vc:VerifiableCredential', issuer: 'https://example.com',
  }

  const t0 = now()
  await (jsonld as any).normalize(normalDoc, normalOpts)
  const normalMs = now() - t0

  // Circular blank-node graph (depth=16)
  const nodes: object[] = []
  for (let i = 0; i < 16; i++) {
    nodes.push({ '@type': 'http://example.org/Node', 'http://example.org/link': { '@id': `_:b${(i + 1) % 16}` } })
    nodes.push({ '@type': 'http://example.org/Node', 'http://example.org/link': { '@id': `_:b${i}` } })
  }
  const poisonDoc = { '@graph': nodes }

  const t1 = now()
  try { await (jsonld as any).normalize(poisonDoc, normalOpts) } catch { /* ok */ }
  const poisonMs = now() - t1

  const ratio = poisonMs / Math.max(normalMs, 0.1)
  return {
    id: 'jsonld-dos', name: 'ポイズングラフ DoS (URDNA2015)',
    format: 'JSON-LD VC', category: 'DoS',
    severity: 'high',
    description: '循環ブランクノード(n=16)を含むグラフで URDNA2015 正規化を実行し、指数的時間増大を確認。',
    result: ratio > 5 ? 'vulnerable' : 'partial',
    details: `正常グラフ: ${normalMs.toFixed(1)} ms / ポイズングラフ: ${poisonMs.toFixed(1)} ms / 比率: ×${ratio.toFixed(1)}`,
    timeMs: poisonMs, normalTimeMs: normalMs,
    cveReferences: ['CVE-2022-21680 (marked)', 'GHSA-3xqr-m5hm-m3q4'],
  }
}

async function testContextInjection(): Promise<BackendSecurityTest> {
  const jsonld = (await import('jsonld')).default
  const opts = { algorithm: 'URDNA2015' as const, format: 'application/n-quads' as const, safe: false }

  // Try to override 'issuer' via malicious second context
  const maliciousDoc = {
    '@context': [
      { issuer: 'https://www.w3.org/2018/credentials#issuer',
        credentialSubject: 'https://www.w3.org/2018/credentials#credentialSubject', id: '@id' },
      { issuer: 'http://attacker.example.com/vocab#maliciousIssuer' },
    ],
    issuer: 'https://legitimate-issuer.example.com',
    credentialSubject: { id: 'did:example:1' },
  }

  let caught = false
  let detail = ''
  try {
    const norm = await (jsonld as any).normalize(maliciousDoc, opts) as string
    // Check if the legitimate issuer URL is replaced
    const hasLegit = norm.includes('legitimate-issuer.example.com')
    const hasMalicious = norm.includes('attacker.example.com')
    caught = !hasMalicious
    detail = `正規化結果に正当なissuerが${hasLegit ? '含まれる' : '含まれない'}、攻撃者URLが${hasMalicious ? '含まれる(⚠危険)' : '含まれない(安全)'}`
  } catch (e) {
    caught = true
    detail = `jsonld が例外をスロー: ${(e as Error).message.slice(0, 80)}`
  }

  return {
    id: 'jsonld-context-injection', name: 'コンテキストインジェクション',
    format: 'JSON-LD VC', category: 'ContextHijack',
    severity: 'high',
    description: '悪意ある @context で issuer URI を上書きしてクレームを偽装しようとする攻撃。',
    result: caught ? 'mitigated' : 'vulnerable',
    details: detail,
  }
}

async function testSSRF(): Promise<BackendSecurityTest> {
  // Test whether jsonld would attempt external URL fetch for unknown context
  const jsonld = (await import('jsonld')).default

  let ssrfAttempted = false
  let ssrfUrl = ''

  const safeLoader = async (url: string) => {
    if (!url.startsWith('data:') && url.startsWith('http')) {
      ssrfAttempted = true
      ssrfUrl = url
      throw new Error(`SSRF blocked: ${url}`)
    }
    return { contextUrl: undefined as unknown as string, document: {}, documentUrl: url }
  }

  const externalCtxDoc = {
    '@context': 'https://external-untrusted.example.com/context.json',
    type: 'VerifiableCredential',
  }

  try {
    await (jsonld as any).normalize(externalCtxDoc, {
      algorithm: 'URDNA2015', format: 'application/n-quads',
      safe: false, documentLoader: safeLoader,
    })
  } catch { /* ok — we intercepted */ }

  return {
    id: 'jsonld-ssrf', name: 'SSRF / 外部コンテキスト取得リスク',
    format: 'JSON-LD VC', category: 'SSRF',
    severity: ssrfAttempted ? 'high' : 'low',
    description: '外部 @context URL を持つドキュメントを処理する際のSSRFリスク。カスタムローダーで緩和可能。',
    result: ssrfAttempted ? 'partial' : 'mitigated',
    details: ssrfAttempted
      ? `外部URL取得を試みた: ${ssrfUrl} — documentLoader でブロック済み`
      : '外部URL取得は試みられなかった(インラインコンテキスト)',
    cveReferences: ['GHSA-4xc9-xhrj-v574'],
  }
}

async function testAlgNone(): Promise<BackendSecurityTest> {
  const { SignJWT, generateKeyPair, jwtVerify } = await import('jose')
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })

  const realToken = await new SignJWT({ sub: 'did:example:1', iss: 'https://issuer.example.com' })
    .setProtectedHeader({ alg: 'EdDSA' })
    .sign(privateKey)

  const [, payloadB64] = realToken.split('.')
  const noneHeader = b64url(Buffer.from(JSON.stringify({ alg: 'none' })))
  const noneToken = `${noneHeader}.${payloadB64}.`

  let mitigated = false
  let detail = ''
  try {
    await jwtVerify(noneToken, publicKey)
    detail = '⚠ alg:none トークンが検証を通過（脆弱）'
  } catch (e) {
    mitigated = true
    detail = `jose が alg:none を正しく拒否: ${(e as Error).message.slice(0, 80)}`
  }

  return {
    id: 'jwt-alg-none', name: 'JWT alg:none 攻撃',
    format: 'SD-JWT VC', category: 'AlgorithmConfusion',
    severity: 'critical',
    description: 'alg:none を指定したトークンで署名検証をスキップできるか確認。RFC 8725 §3.1 対策。',
    result: mitigated ? 'mitigated' : 'vulnerable',
    details: detail,
    cveReferences: ['CVE-2015-9235', 'RFC 8725 §3.1'],
  }
}

async function testKeyConfusion(): Promise<BackendSecurityTest> {
  const { SignJWT, generateKeyPair, jwtVerify } = await import('jose')

  // Sign with EdDSA key
  const edPair = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
  const token = await new SignJWT({ sub: 'did:example:1' })
    .setProtectedHeader({ alg: 'EdDSA' })
    .sign(edPair.privateKey)

  // Try to verify with ECDSA P-256 key (wrong type)
  const ecPair = await generateKeyPair('ES256')
  let mitigated = false
  let detail = ''
  try {
    await jwtVerify(token, ecPair.publicKey)
    detail = '⚠ 異なる鍵タイプで検証が通過（脆弱）'
  } catch (e) {
    mitigated = true
    detail = `jose が鍵タイプ不一致を正しく拒否: ${(e as Error).message.slice(0, 80)}`
  }

  return {
    id: 'jwt-key-confusion', name: '鍵タイプ混同攻撃',
    format: 'SD-JWT VC', category: 'AlgorithmConfusion',
    severity: 'high',
    description: 'EdDSA 署名トークンを ECDSA 鍵で検証できるか確認（アルゴリズム混同攻撃）。',
    result: mitigated ? 'mitigated' : 'vulnerable',
    details: detail,
    cveReferences: ['CVE-2022-21449'],
  }
}

async function testMdocTampering(): Promise<BackendSecurityTest> {
  let enc: (v: unknown) => Uint8Array
  try {
    const cx = await import('cbor-x')
    enc = cx.encode
  } catch {
    return {
      id: 'mdoc-tampering', name: 'mdoc データ改ざん検出',
      format: 'mdoc', category: 'CborMalleability', severity: 'medium',
      description: 'cbor-x が利用できないためスキップ',
      result: 'not-applicable', details: 'cbor-x not available',
    }
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })

  const fields = { family_name: 'Yamada', given_name: 'Taro', birth_date: '1990-01-01' }
  const digestMap = new Map<number, Uint8Array>()
  let id2 = 0
  const itemBuffers: Buffer[] = []

  for (const [k, v] of Object.entries(fields)) {
    const item = Buffer.from(enc({ digestID: id2, elementIdentifier: k, elementValue: v }))
    itemBuffers.push(item)
    digestMap.set(id2++, new Uint8Array(crypto.createHash('sha256').update(item).digest()))
  }

  const protHdr = Buffer.from(enc(new Map([[1, -7]])))
  const msoPayload = Buffer.from(enc({ docType: 'org.iso.18013.5.1.mDL', valueDigests: digestMap }))
  const sigStruct = Buffer.from(enc(['Signature1', new Uint8Array(protHdr), new Uint8Array(0), new Uint8Array(msoPayload)]))
  const sig = crypto.sign('SHA256', sigStruct, { key: privateKey, dsaEncoding: 'ieee-p1363' })

  // Tamper: recompute digests with modified value
  const tamperedDigests = new Map<number, Uint8Array>()
  for (let i = 0; i < itemBuffers.length; i++) {
    const item = i === 0
      ? Buffer.from(enc({ digestID: 0, elementIdentifier: 'family_name', elementValue: 'ATTACKER' }))
      : itemBuffers[i]
    tamperedDigests.set(i, new Uint8Array(crypto.createHash('sha256').update(item).digest()))
  }
  const tamperedMso = Buffer.from(enc({ docType: 'org.iso.18013.5.1.mDL', valueDigests: tamperedDigests }))
  const tamperedSigStruct = Buffer.from(enc(['Signature1', new Uint8Array(protHdr), new Uint8Array(0), new Uint8Array(tamperedMso)]))

  // Verify tampered struct against original sig — should FAIL
  let detected = false
  try {
    detected = !crypto.verify('SHA256', tamperedSigStruct, { key: crypto.createPublicKey(privateKey), dsaEncoding: 'ieee-p1363' }, sig)
  } catch { detected = true }

  return {
    id: 'mdoc-tampering', name: 'mdoc データ改ざん検出',
    format: 'mdoc', category: 'CborMalleability', severity: 'medium',
    description: '要素値を改ざんした mdoc に対して MSO 署名検証が失敗するか（SHA-256 ダイジェスト保護）。',
    result: detected ? 'mitigated' : 'vulnerable',
    details: detected
      ? '改ざんされた MSO に対して署名検証が正しく失敗し、改ざんを検出'
      : '⚠ 改ざんが検出されなかった（脆弱）',
  }
}

async function testCoseTampering(): Promise<BackendSecurityTest> {
  let enc: (v: unknown) => Uint8Array
  try {
    const cx = await import('cbor-x')
    enc = cx.encode
  } catch {
    return {
      id: 'cose-header-tampering', name: 'COSE 保護ヘッダー改ざん',
      format: 'mdoc', category: 'CborMalleability', severity: 'medium',
      description: 'cbor-x が利用できないためスキップ',
      result: 'not-applicable', details: 'cbor-x not available',
    }
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const msoPayload = Buffer.from(enc({ docType: 'org.iso.18013.5.1.mDL' }))

  // Legitimate protected header: {alg: -7 (ES256)}
  const legitProt = Buffer.from(enc(new Map([[1, -7]])))
  const legitSS = Buffer.from(enc(['Signature1', new Uint8Array(legitProt), new Uint8Array(0), new Uint8Array(msoPayload)]))
  const sig = crypto.sign('SHA256', legitSS, { key: privateKey, dsaEncoding: 'ieee-p1363' })

  // Tampered header: {alg: -37 (PS256, different algorithm)}
  const tamperedProt = Buffer.from(enc(new Map([[1, -37]])))
  const tamperedSS = Buffer.from(enc(['Signature1', new Uint8Array(tamperedProt), new Uint8Array(0), new Uint8Array(msoPayload)]))

  let detected = false
  try {
    detected = !crypto.verify('SHA256', tamperedSS, { key: crypto.createPublicKey(privateKey), dsaEncoding: 'ieee-p1363' }, sig)
  } catch { detected = true }

  return {
    id: 'cose-header-tampering', name: 'COSE 保護ヘッダー改ざん',
    format: 'mdoc', category: 'CborMalleability', severity: 'medium',
    description: '保護ヘッダーのアルゴリズムを変更した場合、署名検証が失敗するか確認（ヘッダーは Sig_Structure に含まれる）。',
    result: detected ? 'mitigated' : 'vulnerable',
    details: detected
      ? '保護ヘッダー改ざんにより署名が無効化され、改ざんを正しく検出'
      : '⚠ ヘッダー改ざんが検出されなかった（脆弱）',
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runNodeSecurity(onProgress: ProgressCallback): Promise<BackendSecurityTest[]> {
  const results: BackendSecurityTest[] = []

  onProgress('ポイズングラフ DoS テスト実行中...')
  try { results.push(await testPoisonGraph()) } catch (e) { console.error('[security] poisonGraph:', e) }

  onProgress('コンテキストインジェクション テスト実行中...')
  try { results.push(await testContextInjection()) } catch (e) { console.error('[security] contextInjection:', e) }

  onProgress('SSRF テスト実行中...')
  try { results.push(await testSSRF()) } catch (e) { console.error('[security] ssrf:', e) }

  onProgress('JWT alg:none 攻撃テスト実行中...')
  try { results.push(await testAlgNone()) } catch (e) { console.error('[security] algNone:', e) }

  onProgress('鍵タイプ混同テスト実行中...')
  try { results.push(await testKeyConfusion()) } catch (e) { console.error('[security] keyConfusion:', e) }

  onProgress('mdoc 改ざん検出テスト実行中...')
  try { results.push(await testMdocTampering()) } catch (e) { console.error('[security] mdocTampering:', e) }

  onProgress('COSE ヘッダー改ざんテスト実行中...')
  try { results.push(await testCoseTampering()) } catch (e) { console.error('[security] coseTampering:', e) }

  onProgress(`セキュリティテスト完了 — ${results.length} 項目`)
  return results
}
