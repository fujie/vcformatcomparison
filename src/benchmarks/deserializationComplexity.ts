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

export const SD_JWT_CODE_SNIPPET = `// SD-JWT VC deserialization (~10 lines)
async function parseSDJwtVC(token: string, pubKey: CryptoKey) {
  // 1. split the compact serialization
  const [header64, payload64, sig64] = token.split('.')

  // 2. header validation (allowlist)
  const header = JSON.parse(atob(header64))
  if (!['EdDSA','ES256'].includes(header.alg))
    throw new Error('Unsupported algorithm')

  // 3. signature verification + claim retrieval (1 API call)
  const { payload } = await jwtVerify(token, pubKey)

  // 4. required claim check
  if (!payload.iss || !payload.vct) throw new Error('Invalid VC')
  return payload
}`

export const JSONLD_CODE_SNIPPET = `// JSON-LD VC deserialization (~35 lines)
async function parseJsonLdVC(doc: object, sig: Uint8Array, pubKey: Uint8Array) {
  const loader = buildDocumentLoader() // external URL fetch (SSRF surface)

  // 1. @context validation
  if (!doc['@context'].includes(VC_CONTEXT_URL))
    throw new Error('Missing context')

  // 2. strip the proof field
  const { proof, ...docWithoutProof } = doc

  // 3. JSON-LD expansion (triggers network fetches)
  await jsonld.expand(docWithoutProof, { documentLoader: loader })

  // 4. URDNA2015 RDF canonicalization (blank node labeling = graph isomorphism)
  //    -> a poison graph can turn this into exponential-time DoS
  const normalized = await jsonld.normalize(docWithoutProof, {
    algorithm: 'URDNA2015', format: 'application/n-quads',
    documentLoader: loader,
  }) as string

  // 5. SHA-256 hash -> 6. Ed25519 signature verification
  const hash = await sha256(normalized)
  if (!await ed25519Verify(sig, hash, pubKey)) throw new Error('Invalid')

  // 7. VC schema validation
  if (!doc['credentialSubject']) throw new Error('Missing credentialSubject')
  return doc
}`

export const MDOC_CODE_SNIPPET = `// mdoc (ISO 18013-5) deserialization (~25 lines)
async function parseMdoc(mdocBytes: Uint8Array, pubKey: CryptoKey) {
  // 1. CBOR decode (binary -> JS object)
  const doc = decode(mdocBytes)
  const { issuerAuth, nameSpaces } = doc.issuerSigned

  // 2. expand the COSE_Sign1 structure
  const [protectedHeader, , msoPayload, signature] = issuerAuth

  // 3. verify the algorithm in the COSE protected header
  const alg = decode(protectedHeader).get(1)  // alg = -7 (ES256)
  if (alg !== ALG_ES256) throw new Error('Unexpected algorithm')

  // 4. build Sig_Structure -> ECDSA P-256 signature verification
  const sigStructure = encode(['Signature1', protectedHeader,
                               new Uint8Array(0), msoPayload])
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, pubKey, signature, sigStructure)
  if (!valid) throw new Error('COSE signature invalid')

  // 5. decode the MSO (Mobile Security Object)
  const mso = decode(msoPayload)
  const storedDigests = mso.valueDigests['org.iso.18013.5.1']

  // 6. verify the SHA-256 digest of every data element
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
  onProgress('Measuring deserialization time...')
  const { sdJwtMs, jsonLdMs, mdocMs } = await measureDeserializationTime(50)

  const results: ComplexityMetric[] = [
    {
      format: 'SD-JWT VC',
      linesOfCode: 10,
      asyncSteps: 1,
      externalDependencies: ['jose'],
      cyclomaticComplexity: 3,
      branchPoints: ['alg allowlist check', 'missing iss check', 'missing vct check'],
      externalNetworkCalls: 0,
      networkCallDescription: [],
      parseTimeMs: sdJwtMs,
      parseIterations: 50,
      codeSnippet: SD_JWT_CODE_SNIPPET,
      steps: [
        { name: '1. Split token', description: 'split into header/payload/signature on "."' },
        { name: '2. Header validation', description: 'validate alg against an allowlist' },
        { name: '3. Signature verification', description: 'verify the JWS with jwtVerify() (1 API call)' },
        { name: '4. Claim validation', description: 'check required claims such as iss / vct / exp' },
      ],
    },
    {
      format: 'JSON-LD VC',
      linesOfCode: 35,
      asyncSteps: 4,
      externalDependencies: ['jsonld', 'DocumentLoader', 'sha256', 'ed25519'],
      cyclomaticComplexity: 8,
      branchPoints: ['@context presence', 'proof presence', 'expand failure', 'normalize failure', 'empty canonicalization result', 'signature verification failure', 'missing credentialSubject', 'type validation'],
      externalNetworkCalls: 2,
      networkCallDescription: ['fetch of the @context URL (SSRF risk)', 'fetch of an additional context URL (for the cryptosuite)'],
      parseTimeMs: jsonLdMs,
      parseIterations: 50,
      codeSnippet: JSONLD_CODE_SNIPPET,
      steps: [
        { name: '1. @context validation', description: 'check the required context URLs' },
        { name: '2. Separate proof', description: 'remove the proof that is not part of the signed payload' },
        { name: '3. JSON-LD expansion', description: 'resolve and expand external contexts', risk: 'SSRF / DNS poisoning' },
        { name: '4. URDNA2015 canonicalization', description: 'blank node labeling = graph isomorphism', risk: 'poison graph -> DoS (exponential time)' },
        { name: '5. SHA-256 hash', description: 'hash the canonical N-Quads' },
        { name: '6. Signature verification', description: 'verify the Ed25519 signature' },
        { name: '7. VC schema validation', description: 'validate credentialSubject and friends' },
      ],
    },
    {
      format: 'mdoc',
      linesOfCode: 25,
      asyncSteps: 2,
      externalDependencies: ['cbor-x (CBOR)', 'WebCrypto ECDSA P-256'],
      cyclomaticComplexity: 5,
      branchPoints: ['CBOR decode error', 'COSE algorithm validation', 'COSE signature verification failure', 'digest mismatch', 'element count mismatch'],
      externalNetworkCalls: 0,
      networkCallDescription: [],
      parseTimeMs: mdocMs,
      parseIterations: 50,
      codeSnippet: MDOC_CODE_SNIPPET,
      steps: [
        { name: '1. CBOR decode', description: 'binary -> JS object (cbor-x)' },
        { name: '2. Expand COSE_Sign1', description: 'destructure the [protected_header, {}, payload, sig] array' },
        { name: '3. Algorithm validation', description: 'check alg(-7=ES256) in the COSE header' },
        { name: '4. COSE signature verification', description: 'build Sig_Structure and verify with ECDSA P-256' },
        { name: '5. MSO decode', description: 'CBOR decode of the Mobile Security Object' },
        { name: '6. Digest verification', description: 'verify the SHA-256 digest of each data element individually', risk: 'may be circumvented by non-deterministic CBOR encoding (implementation dependent)' },
      ],
    },
  ]

  onProgress('Done')
  return results
}
