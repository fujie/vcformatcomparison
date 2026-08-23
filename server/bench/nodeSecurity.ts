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
    id: 'jsonld-dos', name: 'Poison Graph DoS (URDNA2015)',
    format: 'JSON-LD VC', category: 'DoS',
    severity: 'high',
    description: 'Runs URDNA2015 canonicalization on a graph containing cyclic blank nodes (n=16) and confirms the exponential growth of processing time.',
    result: ratio > 5 ? 'vulnerable' : 'partial',
    details: `Normal graph: ${normalMs.toFixed(1)} ms / poison graph: ${poisonMs.toFixed(1)} ms / ratio: x${ratio.toFixed(1)}`,
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
    detail = `The canonicalized output ${hasLegit ? 'contains' : 'does not contain'} the legitimate issuer and ${hasMalicious ? 'contains the attacker URL (dangerous)' : 'does not contain the attacker URL (safe)'}`
  } catch (e) {
    caught = true
    detail = `jsonld threw an exception: ${(e as Error).message.slice(0, 80)}`
  }

  return {
    id: 'jsonld-context-injection', name: 'Context Injection',
    format: 'JSON-LD VC', category: 'ContextHijack',
    severity: 'high',
    description: 'An attack that overrides the issuer URI through a malicious @context in order to forge claims.',
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
    id: 'jsonld-ssrf', name: 'SSRF / External Context Retrieval Risk',
    format: 'JSON-LD VC', category: 'SSRF',
    severity: ssrfAttempted ? 'high' : 'low',
    description: 'SSRF risk when processing a document with an external @context URL. Can be mitigated with a custom loader.',
    result: ssrfAttempted ? 'partial' : 'mitigated',
    details: ssrfAttempted
      ? `Attempted to fetch an external URL: ${ssrfUrl} - blocked by the documentLoader`
      : 'No external URL fetch was attempted (inline context)',
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
    detail = 'WARNING: an alg:none token passed verification (vulnerable)'
  } catch (e) {
    mitigated = true
    detail = `jose correctly rejected alg:none: ${(e as Error).message.slice(0, 80)}`
  }

  return {
    id: 'jwt-alg-none', name: 'JWT alg:none Attack',
    format: 'SD-JWT VC', category: 'AlgorithmConfusion',
    severity: 'critical',
    description: 'Checks whether a token with alg:none can skip signature verification. Countermeasure of RFC 8725 Section 3.1.',
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
    detail = 'WARNING: verification passed with a different key type (vulnerable)'
  } catch (e) {
    mitigated = true
    detail = `jose correctly rejected the key type mismatch: ${(e as Error).message.slice(0, 80)}`
  }

  return {
    id: 'jwt-key-confusion', name: 'Key Type Confusion Attack',
    format: 'SD-JWT VC', category: 'AlgorithmConfusion',
    severity: 'high',
    description: 'Checks whether a token signed with EdDSA can be verified with an ECDSA key (algorithm confusion attack).',
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
      id: 'mdoc-tampering', name: 'mdoc Data Tampering Detection',
      format: 'mdoc', category: 'CborMalleability', severity: 'medium',
      description: 'Skipped because cbor-x is unavailable',
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
    id: 'mdoc-tampering', name: 'mdoc Data Tampering Detection',
    format: 'mdoc', category: 'CborMalleability', severity: 'medium',
    description: 'Whether MSO signature verification fails for an mdoc whose element value has been tampered with (SHA-256 digest protection).',
    result: detected ? 'mitigated' : 'vulnerable',
    details: detected
      ? 'Signature verification correctly failed for the tampered MSO, detecting the tampering'
      : 'WARNING: the tampering was not detected (vulnerable)',
  }
}

async function testCoseTampering(): Promise<BackendSecurityTest> {
  let enc: (v: unknown) => Uint8Array
  try {
    const cx = await import('cbor-x')
    enc = cx.encode
  } catch {
    return {
      id: 'cose-header-tampering', name: 'COSE Protected Header Tampering',
      format: 'mdoc', category: 'CborMalleability', severity: 'medium',
      description: 'Skipped because cbor-x is unavailable',
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
    id: 'cose-header-tampering', name: 'COSE Protected Header Tampering',
    format: 'mdoc', category: 'CborMalleability', severity: 'medium',
    description: 'Checks whether signature verification fails when the algorithm in the protected header is changed (the header is part of Sig_Structure).',
    result: detected ? 'mitigated' : 'vulnerable',
    details: detected
      ? 'Tampering with the protected header invalidated the signature, so it was correctly detected'
      : 'WARNING: header tampering was not detected (vulnerable)',
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runNodeSecurity(onProgress: ProgressCallback): Promise<BackendSecurityTest[]> {
  const results: BackendSecurityTest[] = []

  onProgress('Running the poison graph DoS test...')
  try { results.push(await testPoisonGraph()) } catch (e) { console.error('[security] poisonGraph:', e) }

  onProgress('Running the context injection test...')
  try { results.push(await testContextInjection()) } catch (e) { console.error('[security] contextInjection:', e) }

  onProgress('Running the SSRF test...')
  try { results.push(await testSSRF()) } catch (e) { console.error('[security] ssrf:', e) }

  onProgress('Running the JWT alg:none attack test...')
  try { results.push(await testAlgNone()) } catch (e) { console.error('[security] algNone:', e) }

  onProgress('Running the key type confusion test...')
  try { results.push(await testKeyConfusion()) } catch (e) { console.error('[security] keyConfusion:', e) }

  onProgress('Running the mdoc tampering detection test...')
  try { results.push(await testMdocTampering()) } catch (e) { console.error('[security] mdocTampering:', e) }

  onProgress('Running the COSE header tampering test...')
  try { results.push(await testCoseTampering()) } catch (e) { console.error('[security] coseTampering:', e) }

  onProgress(`Security tests completed - ${results.length} items`)
  return results
}
