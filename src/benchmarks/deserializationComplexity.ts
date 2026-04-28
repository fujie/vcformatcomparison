import { jwtVerify, generateKeyPair, SignJWT } from 'jose'
import jsonld from 'jsonld'
import { generateEd25519KeyPair, ed25519Sign, ed25519Verify, sha256 } from '../lib/cryptoUtils'
import { makeStaticContextLoader, VC_CONTEXT_URL } from '../data/staticContexts'
import { generateMdocKeyPair, issueMdoc, verifyMdoc } from '../lib/mdocUtils'
import { SD_JWT_PAYLOAD, JSONLD_CREDENTIAL, MDOC_FIELDS } from './signatureSpeed'
import type { FormatName } from './signatureSpeed'

export interface ComplexityMetric {
  format: FormatName
  linesOfCode: number
  asyncSteps: number
  externalDependencies: string[]
  cyclomaticComplexity: number
  branchPoints: string[]
  externalNetworkCalls: number
  networkCallDescription: string[]
  parseTimeMs: number
  parseIterations: number
  codeSnippet: string
  steps: { name: string; description: string; risk?: string }[]
}

async function deserializeSdJwt(token: string, publicKey: CryptoKey): Promise<Record<string, unknown>> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT format')
  const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')))
  if (!['ES256', 'ES384', 'EdDSA', 'RS256'].includes(header.alg)) throw new Error('Unsupported algorithm')
  const { payload } = await jwtVerify(token, publicKey)
  if (!payload.iss) throw new Error('Missing issuer')
  if (!payload.vct) throw new Error('Missing vct claim (SD-JWT VC)')
  return payload as Record<string, unknown>
}

async function deserializeJsonLdVc(document: Record<string, unknown>, signature: Uint8Array, publicKey: Uint8Array) {
  const loader = makeStaticContextLoader()
  const ctx = (document['@context'] as string[]) || []
  if (!ctx.includes(VC_CONTEXT_URL)) throw new Error('Missing VC context')
  const { proof: _proof, ...documentWithoutProof } = document
  await jsonld.expand(documentWithoutProof, { documentLoader: loader, safe: false })
  const normalized = (await jsonld.normalize(documentWithoutProof, { algorithm: 'URDNA2015', format: 'application/n-quads', documentLoader: loader, safe: false })) as string
  const hash = await sha256(normalized)
  const valid = await ed25519Verify(signature, hash, publicKey)
  if (!valid) throw new Error('Signature verification failed')
  if (!(document as Record<string, unknown>)['credentialSubject']) throw new Error('Missing credentialSubject')
  return document
}

export const SD_JWT_CODE_SNIPPET = `// SD-JWT VC デシリアライズ（~10行）
async function parseSDJwtVC(token: string, pubKey: CryptoKey) {
  // 1. コンパクト表現を分割
  const [header64, payload64, sig64] = token.split('.')

  // 2. ヘッダー検証（許可リスト）
  const header = JSON.parse(atob(header64))
  if (!['EdDSA','ES256'].includes(header.alg))
    throw new Error('Unsupported algorithm')

  // 3. 署名検証 + クレーム取得（1 API呼び出し）
  const { payload } = await jwtVerify(token, pubKey)

  // 4. 必須クレーム確認
  if (!payload.iss || !payload.vct) throw new Error('Invalid VC')
  return payload
}`

export const JSONLD_CODE_SNIPPET = `// JSON-LD VC デシリアライズ（~35行）
async function parseJsonLdVC(doc: object, sig: Uint8Array, pubKey: Uint8Array) {
  const loader = buildDocumentLoader() // 外部URL取得（SSRF面）

  // 1. @context 検証
  if (!doc['@context'].includes(VC_CONTEXT_URL))
    throw new Error('Missing context')

  // 2. proof フィールドを除去
  const { proof, ...docWithoutProof } = doc

  // 3. JSON-LD エクスパンション（ネットワーク取得発生）
  await jsonld.expand(docWithoutProof, { documentLoader: loader })

  // 4. URDNA2015 RDF正規化（ブランクノード同定 = グラフ同型問題）
  //    → ポイズングラフで指数時間 DoS になりうる
  const normalized = await jsonld.normalize(docWithoutProof, {
    algorithm: 'URDNA2015', format: 'application/n-quads',
    documentLoader: loader,
  }) as string

  // 5. SHA-256ハッシュ → 6. Ed25519署名検証
  const hash = await sha256(normalized)
  if (!await ed25519Verify(sig, hash, pubKey)) throw new Error('Invalid')

  // 7. VCスキーマ検証
  if (!doc['credentialSubject']) throw new Error('Missing credentialSubject')
  return doc
}`

export const MDOC_CODE_SNIPPET = `// mdoc (ISO 18013-5) デシリアライズ（~25行）
async function parseMdoc(mdocBytes: Uint8Array, pubKey: CryptoKey) {
  // 1. CBOR デコード（バイナリ → JS オブジェクト）
  const doc = decode(mdocBytes)
  const { issuerAuth, nameSpaces } = doc.issuerSigned

  // 2. COSE_Sign1 構造展開
  const [protectedHeader, , msoPayload, signature] = issuerAuth

  // 3. COSE プロテクトヘッダーのアルゴリズム検証
  const alg = decode(protectedHeader).get(1)  // alg = -7 (ES256)
  if (alg !== ALG_ES256) throw new Error('Unexpected algorithm')

  // 4. Sig_Structure 構築 → ECDSA P-256 署名検証
  const sigStructure = encode(['Signature1', protectedHeader,
                               new Uint8Array(0), msoPayload])
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, pubKey, signature, sigStructure)
  if (!valid) throw new Error('COSE signature invalid')

  // 5. MSO（Mobile Security Object）デコード
  const mso = decode(msoPayload)
  const storedDigests = mso.valueDigests['org.iso.18013.5.1']

  // 6. 各データ要素の SHA-256 ダイジェスト検証
  for (const [i, itemBytes] of nameSpaces['org.iso.18013.5.1'].entries()) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', itemBytes))
    if (!digest.every((b, j) => b === storedDigests[i][j]))
      throw new Error(\`Digest mismatch at element \${i}\`)
  }
  return doc
}`

export async function measureDeserializationTime(iterations = 50): Promise<{ sdJwtMs: number; jsonLdMs: number; mdocMs: number }> {
  // SD-JWT setup
  const { privateKey: sdPriv, publicKey: sdPub } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
  const token = await new SignJWT(SD_JWT_PAYLOAD).setProtectedHeader({ alg: 'EdDSA' }).sign(sdPriv)

  // JSON-LD setup
  const edKeys = await generateEd25519KeyPair()
  const loader = makeStaticContextLoader()
  const normalized = (await jsonld.normalize(JSONLD_CREDENTIAL, { algorithm: 'URDNA2015', format: 'application/n-quads', documentLoader: loader, safe: false })) as string
  const hash = await sha256(normalized)
  const sig = await ed25519Sign(hash, edKeys.privateKey)

  // mdoc setup
  const { privateKey: mdPriv, publicKey: mdPub } = await generateMdocKeyPair()
  const mdocBytes = await issueMdoc(MDOC_FIELDS, mdPriv)

  const t0 = performance.now()
  for (let i = 0; i < iterations; i++) await deserializeSdJwt(token, sdPub)
  const sdJwtMs = (performance.now() - t0) / iterations

  const t1 = performance.now()
  for (let i = 0; i < iterations; i++) await deserializeJsonLdVc({ ...JSONLD_CREDENTIAL }, sig, edKeys.publicKey)
  const jsonLdMs = (performance.now() - t1) / iterations

  const t2 = performance.now()
  for (let i = 0; i < iterations; i++) await verifyMdoc(mdocBytes, mdPub)
  const mdocMs = (performance.now() - t2) / iterations

  return { sdJwtMs, jsonLdMs, mdocMs }
}

export async function runComplexityAnalysis(onProgress: (msg: string) => void): Promise<ComplexityMetric[]> {
  onProgress('デシリアライズ時間を計測中...')
  const { sdJwtMs, jsonLdMs, mdocMs } = await measureDeserializationTime(50)

  const results: ComplexityMetric[] = [
    {
      format: 'SD-JWT VC',
      linesOfCode: 10,
      asyncSteps: 1,
      externalDependencies: ['jose'],
      cyclomaticComplexity: 3,
      branchPoints: ['alg許可リスト検証', 'iss欠落チェック', 'vct欠落チェック'],
      externalNetworkCalls: 0,
      networkCallDescription: [],
      parseTimeMs: sdJwtMs,
      parseIterations: 50,
      codeSnippet: SD_JWT_CODE_SNIPPET,
      steps: [
        { name: '1. トークン分割', description: '"." でheader/payload/signatureに分割' },
        { name: '2. ヘッダー検証', description: 'alg を許可リストで検証' },
        { name: '3. 署名検証', description: 'jwtVerify() で JWS 検証（1 API呼び出し）' },
        { name: '4. クレーム検証', description: 'iss / vct / exp など必須クレームを確認' },
      ],
    },
    {
      format: 'JSON-LD VC',
      linesOfCode: 35,
      asyncSteps: 4,
      externalDependencies: ['jsonld', 'DocumentLoader', 'sha256', 'ed25519'],
      cyclomaticComplexity: 8,
      branchPoints: ['@context存在確認', 'proof存在チェック', 'expand失敗分岐', 'normalize失敗分岐', '空正規化結果チェック', '署名検証失敗', 'credentialSubject欠落', 'type検証'],
      externalNetworkCalls: 2,
      networkCallDescription: ['@context URL のフェッチ（SSRFリスク）', '追加コンテキストURL（cryptoスイート用）のフェッチ'],
      parseTimeMs: jsonLdMs,
      parseIterations: 50,
      codeSnippet: JSONLD_CODE_SNIPPET,
      steps: [
        { name: '1. @context 検証', description: '必須コンテキストURLの確認' },
        { name: '2. proof 分離', description: '署名対象外のproofを除去' },
        { name: '3. JSON-LD エクスパンション', description: '外部コンテキストを解決・展開', risk: 'SSRF / DNSポイズニング' },
        { name: '4. URDNA2015 正規化', description: 'ブランクノード同定 = グラフ同型問題', risk: 'ポイズングラフ → DoS（指数時間）' },
        { name: '5. SHA-256 ハッシュ', description: '正規化N-Quadsをハッシュ化' },
        { name: '6. 署名検証', description: 'Ed25519 署名を検証' },
        { name: '7. VCスキーマ検証', description: 'credentialSubject等の検証' },
      ],
    },
    {
      format: 'mdoc',
      linesOfCode: 25,
      asyncSteps: 2,
      externalDependencies: ['cbor-x (CBOR)', 'WebCrypto ECDSA P-256'],
      cyclomaticComplexity: 5,
      branchPoints: ['CBOR デコードエラー', 'COSEアルゴリズム検証', 'COSE署名検証失敗', 'ダイジェスト不一致', '要素数不一致'],
      externalNetworkCalls: 0,
      networkCallDescription: [],
      parseTimeMs: mdocMs,
      parseIterations: 50,
      codeSnippet: MDOC_CODE_SNIPPET,
      steps: [
        { name: '1. CBOR デコード', description: 'バイナリ → JS オブジェクト（cbor-x）' },
        { name: '2. COSE_Sign1 展開', description: '[protected_header, {}, payload, sig] の配列分解' },
        { name: '3. アルゴリズム検証', description: 'COSEヘッダーの alg(-7=ES256) を確認' },
        { name: '4. COSE署名検証', description: 'Sig_Structure を構築しECDSA P-256で検証' },
        { name: '5. MSO デコード', description: 'Mobile Security Object の CBOR デコード' },
        { name: '6. ダイジェスト検証', description: '各データ要素の SHA-256 ダイジェストを個別検証', risk: 'CBOR非決定性エンコードで回避可能（実装依存）' },
      ],
    },
  ]

  onProgress('完了')
  return results
}
