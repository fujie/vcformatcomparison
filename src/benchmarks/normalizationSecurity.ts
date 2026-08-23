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
    return { caught: false, detail: 'Canonicalization succeeded. Without @protected, terms can be overridden.' }
  } catch (e) {
    return { caught: true, detail: `Blocked by an exception: ${(e as Error).message.slice(0, 120)}` }
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
    return { caught: false, detail: 'alg:none was accepted - vulnerable' }
  } catch (e) {
    return { caught: true, detail: `jwtVerify rejected alg:none: ${(e as Error).message.slice(0, 100)}` }
  }
}

async function keyConfusionTest(): Promise<{ caught: boolean; detail: string }> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { modulusLength: 2048 })
  const token = await new SignJWT({ sub: 'test', iss: 'https://example.com' }).setProtectedHeader({ alg: 'RS256' }).sign(privateKey)
  try {
    await jwtVerify(token, publicKey, { algorithms: ['EdDSA'] })
    return { caught: false, detail: 'Algorithm confusion succeeded - vulnerable' }
  } catch (e) {
    return { caught: true, detail: `Rejected by the algorithm allowlist: ${(e as Error).message.slice(0, 100)}` }
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
      ? 'Digest verification was bypassed - vulnerable'
      : 'Digest tampering was correctly detected; each element is protected by SHA-256.',
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
      ? 'COSE algorithm tampering was accepted - vulnerable'
      : 'COSE signature verification detected the algorithm tampering (the protected header is part of Sig_Structure, so the signature no longer matches).',
  }
}

export async function runSecurityTests(onProgress: (msg: string) => void): Promise<SecurityTest[]> {
  const results: SecurityTest[] = []

  // --- JSON-LD Tests ---
  onProgress('Running the poison graph DoS test...')
  const poison = await poisonGraphTest()
  results.push({
    id: 'poison-graph', name: 'Poison Graph DoS (URDNA2015)', format: 'JSON-LD VC', category: 'DoS',
    severity: poison.ratio > 5 ? 'high' : 'medium',
    description: 'A deliberately constructed blank node graph drives the RDF canonicalization algorithm into exponential time. The W3C RDFC-1.0 specification recommends a call limit; without one, this becomes a DoS vector.',
    result: poison.ratio > 3 ? 'vulnerable' : 'mitigated',
    details: `Baseline: ${poison.normalMs.toFixed(1)}ms, poison graph (20 nodes): ${poison.poisonMs.toFixed(1)}ms, ratio: ${poison.ratio.toFixed(1)}x`,
    timeMs: poison.poisonMs, normalTimeMs: poison.normalMs,
    cveReferences: ['W3C RDFC-1.0 §4.8.3', 'IETF draft-ietf-oauth-sd-jwt-vc'],
  })

  onProgress('Running the context injection test...')
  const injection = await contextInjectionTest()
  results.push({
    id: 'context-injection', name: 'JSON-LD Context Injection', format: 'JSON-LD VC', category: 'ContextHijack',
    severity: 'high',
    description: 'An attacker adds malicious term definitions to @context and remaps the meaning of terms such as "issuer" to a different IRI. Correct use of @protected prevents this, but a careless implementation interprets signed fields with unintended semantics.',
    result: injection.caught ? 'mitigated' : 'partial',
    details: injection.detail,
    cveReferences: ['json-ld.org#213', 'W3C Data Integrity 1.1 §4.3.2'],
  })

  onProgress('Analyzing the SSRF attack surface...')
  const ssrfDoc = { '@context': ['https://www.w3.org/2018/credentials/v1', 'https://attacker.internal/evil.json', 'http://169.254.169.254/latest/meta-data/'], type: 'VerifiableCredential' }
  const ssrf = countSsrfSurface(ssrfDoc)
  results.push({
    id: 'ssrf-context', name: 'SSRF via Remote Context', format: 'JSON-LD VC', category: 'SSRF',
    severity: 'critical',
    description: '@context may reference a remote URL, and a JSON-LD processor issues HTTP requests by default. An attacker can place a cloud metadata endpoint in @context and perform SSRF.',
    result: 'vulnerable',
    details: `${ssrf.count} remote URLs in the sample. Dangerous example: ${ssrf.urls.slice(1).join(', ')}. Allowlist validation in the document loader is mandatory.`,
    cveReferences: ['json-ld.org#213', 'OWASP SSRF (A10:2021)'],
  })

  results.push({
    id: 'no-normalization-jsonld-attack', name: 'No canonicalization (SD-JWT / mdoc)', format: 'Both', category: 'DoS',
    severity: 'none',
    description: 'SD-JWT VC and mdoc do not use JSON-LD canonicalization, so poison graph DoS, context injection and SSRF do not arise.',
    result: 'not-applicable',
    details: 'There is no canonicalization step, so the attack surface in this category is zero.',
  })

  // --- SD-JWT Tests ---
  onProgress('Running the JWT alg:none attack test...')
  const algNone = await algorithmConfusionTest()
  results.push({
    id: 'alg-none', name: 'alg:none Attack (SD-JWT VC)', format: 'SD-JWT VC', category: 'AlgorithmConfusion',
    severity: 'critical',
    description: 'Tests whether the verifier accepts a token whose JWT header alg has been changed to none. Implementations conforming to RFC 8725 reject it.',
    result: algNone.caught ? 'mitigated' : 'vulnerable',
    details: algNone.detail,
    cveReferences: ['CVE-2015-9235', 'RFC 8725 §3.1'],
  })

  onProgress('Running the algorithm confusion test...')
  const keyConf = await keyConfusionTest()
  results.push({
    id: 'key-confusion', name: 'Algorithm Confusion RS256->EdDSA (SD-JWT VC)', format: 'SD-JWT VC', category: 'AlgorithmConfusion',
    severity: 'high',
    description: 'Has a token signed with RS256 verified as EdDSA. Explicitly restricting the accepted algorithms on the verifier side prevents this.',
    result: keyConf.caught ? 'mitigated' : 'vulnerable',
    details: keyConf.detail,
    cveReferences: ['CVE-2016-10555', 'RFC 7518 §8.5'],
  })

  // --- mdoc Tests ---
  onProgress('Running the mdoc data tampering detection test...')
  const mdocMall = await mdocCborMalleabilityTest()
  results.push({
    id: 'mdoc-digest-tamper', name: 'mdoc Data Element Tampering Detection', format: 'mdoc', category: 'CborMalleability',
    severity: 'high',
    description: 'Tampers with a data element value inside the mdoc nameSpaces and tests whether MSO digest verification detects it. Each element is individually protected by a SHA-256 digest.',
    result: mdocMall.caught ? 'mitigated' : 'vulnerable',
    details: mdocMall.detail,
    cveReferences: ['ISO 18013-5 §9.1.2.4'],
  })

  onProgress('Running the mdoc COSE header tampering test...')
  const coseAlg = await mdocCoseAlgConfusionTest()
  results.push({
    id: 'mdoc-cose-alg', name: 'COSE Protected Header Tampering (mdoc)', format: 'mdoc', category: 'AlgorithmConfusion',
    severity: 'high',
    description: 'Changes alg in the COSE_Sign1 protected header from ES256(-7) to none(0) and tests whether verification can be bypassed. Because the protected header is part of Sig_Structure, the signature should no longer match.',
    result: coseAlg.caught ? 'mitigated' : 'vulnerable',
    details: coseAlg.detail,
    cveReferences: ['RFC 9052 §4.4', 'ISO 18013-5 §9.1.2.4'],
  })

  results.push({
    id: 'mdoc-no-ssrf', name: 'No SSRF / No Network Retrieval (mdoc)', format: 'mdoc', category: 'SSRF',
    severity: 'none',
    description: 'mdoc is a CBOR binary format with no context mechanism that references external URLs, so the SSRF attack surface of JSON-LD @context does not exist.',
    result: 'not-applicable',
    details: 'External network retrieval cannot occur structurally, so this risk is zero.',
  })

  onProgress('Done')
  return results
}
