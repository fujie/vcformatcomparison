import jsonld from 'jsonld'
import { makeStaticContextLoader, VC_CONTEXT_URL } from '../data/staticContexts'
import { SignJWT, generateKeyPair, jwtVerify } from 'jose'
import { generateMdocKeyPair, issueMdoc, verifyMdoc } from '../lib/mdocUtils'
import { MDOC_FIELDS } from './signatureSpeed'
import { encode, decode } from 'cbor-x'

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'none'

export interface SecurityTest {
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

const loader = makeStaticContextLoader()
const normalizeOpts = { algorithm: 'URDNA2015' as const, format: 'application/n-quads' as const, documentLoader: loader, safe: false }

// --- JSON-LD Tests ---

async function baselineNormalization(): Promise<number> {
  const doc = { '@context': [VC_CONTEXT_URL], id: 'https://example.com/c/1', type: 'VerifiableCredential', issuer: 'https://issuer.example.com', issuanceDate: '2024-01-01T00:00:00Z', credentialSubject: { id: 'did:example:123' } }
  const t0 = performance.now()
  await jsonld.normalize(doc, normalizeOpts)
  return performance.now() - t0
}

function buildPoisonGraph(depth: number): Record<string, unknown> {
  const nodes: Record<string, unknown>[] = []
  for (let i = 0; i < depth; i++) {
    nodes.push({ '@type': 'http://example.org/Node', 'http://example.org/link': { '@id': `_:b${(i + 1) % depth}` } })
    nodes.push({ '@type': 'http://example.org/Node', 'http://example.org/link': { '@id': `_:b${i}` } })
  }
  return { '@graph': nodes }
}

async function poisonGraphTest(): Promise<{ normalMs: number; poisonMs: number; ratio: number }> {
  const normalDoc = { '@context': [VC_CONTEXT_URL], id: 'https://example.com/c/1', type: 'VerifiableCredential', issuer: 'https://example.com', issuanceDate: '2024-01-01T00:00:00Z', credentialSubject: { id: 'did:example:1' } }
  const t0 = performance.now()
  await jsonld.normalize(normalDoc, normalizeOpts)
  const normalMs = performance.now() - t0

  const poisonDoc = buildPoisonGraph(20)
  const t1 = performance.now()
  try { await jsonld.normalize(poisonDoc, { ...normalizeOpts }) } catch {}
  const poisonMs = performance.now() - t1

  return { normalMs, poisonMs, ratio: poisonMs / Math.max(normalMs, 0.1) }
}

async function contextInjectionTest(): Promise<{ caught: boolean; detail: string }> {
  const maliciousDoc = {
    '@context': [VC_CONTEXT_URL, { issuer: 'http://attacker.example.com/vocab#maliciousIssuer', credentialSubject: 'http://attacker.example.com/vocab#maliciousSubject' }],
    id: 'https://example.com/c/inject', type: 'VerifiableCredential',
    issuer: 'https://legitimate-issuer.example.com', issuanceDate: '2024-01-01T00:00:00Z', credentialSubject: { id: 'did:example:victim' },
  }
  try {
    await jsonld.normalize(maliciousDoc, normalizeOpts)
    return { caught: false, detail: '正規化は成功。@protected なしのコンテキストでは用語の上書きが可能。' }
  } catch (e) {
    return { caught: true, detail: `例外でブロック: ${(e as Error).message.slice(0, 120)}` }
  }
}

function countSsrfSurface(doc: Record<string, unknown>): { urls: string[]; count: number } {
  const urls: string[] = []
  const ctx = doc['@context']
  if (Array.isArray(ctx)) ctx.forEach((c) => { if (typeof c === 'string') urls.push(c) })
  else if (typeof ctx === 'string') urls.push(ctx)
  return { urls, count: urls.length }
}

// --- SD-JWT Tests ---

async function algorithmConfusionTest(): Promise<{ caught: boolean; detail: string }> {
  const { privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
  const { publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
  const token = await new SignJWT({ sub: 'victim', iss: 'https://issuer.example.com', vct: 'test' }).setProtectedHeader({ alg: 'EdDSA' }).sign(privateKey)
  const [h64, p64] = token.split('.')
  const header = JSON.parse(atob(h64.replace(/-/g, '+').replace(/_/g, '/')))
  const noneHeader = btoa(JSON.stringify({ ...header, alg: 'none' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  try {
    await jwtVerify(`${noneHeader}.${p64}.`, publicKey)
    return { caught: false, detail: 'alg:none が受理された — 脆弱' }
  } catch (e) {
    return { caught: true, detail: `jwtVerify が alg:none を拒否: ${(e as Error).message.slice(0, 100)}` }
  }
}

async function keyConfusionTest(): Promise<{ caught: boolean; detail: string }> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { modulusLength: 2048 })
  const token = await new SignJWT({ sub: 'test', iss: 'https://example.com' }).setProtectedHeader({ alg: 'RS256' }).sign(privateKey)
  try {
    await jwtVerify(token, publicKey, { algorithms: ['EdDSA'] })
    return { caught: false, detail: 'アルゴリズム混同が成功した — 脆弱' }
  } catch (e) {
    return { caught: true, detail: `alg制限により拒否: ${(e as Error).message.slice(0, 100)}` }
  }
}

// --- mdoc Tests ---

async function mdocCborMalleabilityTest(): Promise<{ caught: boolean; detail: string }> {
  const { privateKey, publicKey } = await generateMdocKeyPair()
  const mdocBytes = await issueMdoc(MDOC_FIELDS, privateKey)

  // Tamper: modify an element value in nameSpaces without updating digest
  const doc = decode(mdocBytes) as Record<string, unknown>
  const issuerSigned = doc.issuerSigned as Record<string, unknown>
  const nameSpaces = issuerSigned.nameSpaces as Record<string, Uint8Array[]>
  const items = nameSpaces['org.iso.18013.5.1']

  // Decode and re-encode first item with tampered value
  const originalItem = decode(items[0]) as Record<string, unknown>
  const tamperedItem = { ...originalItem, elementValue: 'ATTACKER' }
  items[0] = encode(tamperedItem)

  const tamperedMdoc = encode(doc)
  const valid = await verifyMdoc(tamperedMdoc, publicKey).catch(() => false)

  return {
    caught: !valid,
    detail: valid
      ? 'ダイジェスト検証がバイパスされた — 脆弱'
      : 'ダイジェスト改ざんを正しく検出。SHA-256により保護されている。',
  }
}

async function mdocCoseAlgConfusionTest(): Promise<{ caught: boolean; detail: string }> {
  const { privateKey, publicKey } = await generateMdocKeyPair()
  const mdocBytes = await issueMdoc(MDOC_FIELDS, privateKey)

  const doc = decode(mdocBytes) as Record<string, unknown>
  const issuerSigned = doc.issuerSigned as Record<string, unknown>
  const coseSign1 = issuerSigned.issuerAuth as unknown[]

  // Tamper protected header: change alg from ES256(-7) to none(0)
  const tamperedProtected = encode(new Map<number, number>([[1, 0]]))
  coseSign1[0] = tamperedProtected

  const tamperedMdoc = encode(doc)
  const valid = await verifyMdoc(tamperedMdoc, publicKey).catch(() => false)
  return {
    caught: !valid,
    detail: valid
      ? 'COSEアルゴリズム改ざんが受理された — 脆弱'
      : 'COSE署名検証がアルゴリズム改ざんを検出（Sig_Structureの保護ヘッダーが変わり署名不一致）。',
  }
}

export async function runSecurityTests(onProgress: (msg: string) => void): Promise<SecurityTest[]> {
  const results: SecurityTest[] = []

  // --- JSON-LD Tests ---
  onProgress('ポイズングラフ DoS テスト実行中...')
  const poison = await poisonGraphTest()
  results.push({
    id: 'poison-graph', name: 'ポイズングラフ DoS (URDNA2015)', format: 'JSON-LD VC', category: 'DoS',
    severity: poison.ratio > 5 ? 'high' : 'medium',
    description: '意図的に構成したブランクノードグラフがRDF正規化アルゴリズムを指数時間に追い込む。W3C RDFC-1.0仕様は呼び出し上限を推奨しているが未実装の場合DoS攻撃になる。',
    result: poison.ratio > 3 ? 'vulnerable' : 'mitigated',
    details: `ベースライン: ${poison.normalMs.toFixed(1)}ms, ポイズングラフ(20ノード): ${poison.poisonMs.toFixed(1)}ms, 比率: ${poison.ratio.toFixed(1)}x`,
    timeMs: poison.poisonMs, normalTimeMs: poison.normalMs,
    cveReferences: ['W3C RDFC-1.0 §4.8.3', 'IETF draft-ietf-oauth-sd-jwt-vc'],
  })

  onProgress('コンテキストインジェクションテスト実行中...')
  const injection = await contextInjectionTest()
  results.push({
    id: 'context-injection', name: 'JSON-LD コンテキストインジェクション', format: 'JSON-LD VC', category: 'ContextHijack',
    severity: 'high',
    description: '攻撃者が @context に悪意ある用語定義を追加し "issuer" 等の意味を別の IRI に変更する。@protected が正しく設定されていれば防げるが、不適切な実装では署名済みフィールドが意図と異なるセマンティクスで解釈される。',
    result: injection.caught ? 'mitigated' : 'partial',
    details: injection.detail,
    cveReferences: ['json-ld.org#213', 'W3C Data Integrity 1.1 §4.3.2'],
  })

  onProgress('SSRF攻撃面を分析中...')
  const ssrfDoc = { '@context': ['https://www.w3.org/2018/credentials/v1', 'https://attacker.internal/evil.json', 'http://169.254.169.254/latest/meta-data/'], type: 'VerifiableCredential' }
  const ssrf = countSsrfSurface(ssrfDoc)
  results.push({
    id: 'ssrf-context', name: 'リモートコンテキスト経由 SSRF', format: 'JSON-LD VC', category: 'SSRF',
    severity: 'critical',
    description: '@context にはリモート URL を指定でき、JSON-LD プロセッサはデフォルトで HTTP リクエストを送信する。攻撃者はクラウドメタデータエンドポイント等を @context に含め SSRF を実行できる。',
    result: 'vulnerable',
    details: `サンプルに ${ssrf.count} 個のリモートURL。危険な例: ${ssrf.urls.slice(1).join(', ')}。Document Loader で許可リスト検証が必須。`,
    cveReferences: ['json-ld.org#213', 'OWASP SSRF (A10:2021)'],
  })

  results.push({
    id: 'no-normalization-jsonld-attack', name: '正規化なし (SD-JWT / mdoc)', format: 'Both', category: 'DoS',
    severity: 'none',
    description: 'SD-JWT VC と mdoc は JSON-LD 正規化を使用しないため、ポイズングラフ DoS・コンテキストインジェクション・SSRF は発生しない。',
    result: 'not-applicable',
    details: '正規化ステップが存在しないためこのカテゴリの攻撃面はゼロ。',
  })

  // --- SD-JWT Tests ---
  onProgress('JWT alg:none 攻撃テスト実行中...')
  const algNone = await algorithmConfusionTest()
  results.push({
    id: 'alg-none', name: 'alg:none 攻撃 (SD-JWT VC)', format: 'SD-JWT VC', category: 'AlgorithmConfusion',
    severity: 'critical',
    description: 'JWT ヘッダーの alg を none に改ざんしたトークンを検証者が受理するかテスト。RFC 8725 準拠の実装では拒否される。',
    result: algNone.caught ? 'mitigated' : 'vulnerable',
    details: algNone.detail,
    cveReferences: ['CVE-2015-9235', 'RFC 8725 §3.1'],
  })

  onProgress('アルゴリズム混同テスト実行中...')
  const keyConf = await keyConfusionTest()
  results.push({
    id: 'key-confusion', name: 'アルゴリズム混同 RS256→EdDSA (SD-JWT VC)', format: 'SD-JWT VC', category: 'AlgorithmConfusion',
    severity: 'high',
    description: 'RS256 で署名されたトークンを EdDSA として検証させる。検証側でアルゴリズムを明示制限している場合は防御できる。',
    result: keyConf.caught ? 'mitigated' : 'vulnerable',
    details: keyConf.detail,
    cveReferences: ['CVE-2016-10555', 'RFC 7518 §8.5'],
  })

  // --- mdoc Tests ---
  onProgress('mdoc データ改ざん検出テスト実行中...')
  const mdocMall = await mdocCborMalleabilityTest()
  results.push({
    id: 'mdoc-digest-tamper', name: 'mdoc データ要素改ざん検出', format: 'mdoc', category: 'CborMalleability',
    severity: 'high',
    description: 'mdoc の nameSpaces 内のデータ要素値を改ざんし、MSO のダイジェスト検証で検出されるかテスト。各要素は SHA-256 ダイジェストで個別に保護されている。',
    result: mdocMall.caught ? 'mitigated' : 'vulnerable',
    details: mdocMall.detail,
    cveReferences: ['ISO 18013-5 §9.1.2.4'],
  })

  onProgress('mdoc COSE ヘッダー改ざんテスト実行中...')
  const coseAlg = await mdocCoseAlgConfusionTest()
  results.push({
    id: 'mdoc-cose-alg', name: 'COSE プロテクトヘッダー改ざん (mdoc)', format: 'mdoc', category: 'AlgorithmConfusion',
    severity: 'high',
    description: 'COSE_Sign1 のプロテクトヘッダーの alg を ES256(-7) から none(0) に改ざんし、検証をバイパスできるかテスト。Sig_Structure にプロテクトヘッダーが含まれるため署名不一致になるはず。',
    result: coseAlg.caught ? 'mitigated' : 'vulnerable',
    details: coseAlg.detail,
    cveReferences: ['RFC 9052 §4.4', 'ISO 18013-5 §9.1.2.4'],
  })

  results.push({
    id: 'mdoc-no-ssrf', name: 'SSRF なし・ネットワーク取得なし (mdoc)', format: 'mdoc', category: 'SSRF',
    severity: 'none',
    description: 'mdoc は CBOR バイナリフォーマットであり、外部 URL を参照するコンテキスト機構を持たない。JSON-LD の @context のような SSRF 攻撃面は存在しない。',
    result: 'not-applicable',
    details: '外部ネットワーク取得が構造的に発生しないためこのリスクはゼロ。',
  })

  onProgress('完了')
  return results
}
