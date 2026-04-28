// Simplified mdoc (ISO 18013-5) implementation using CBOR + COSE_Sign1 (ECDSA P-256).
// Follows the structure: IssuerSigned { nameSpaces, issuerAuth: COSE_Sign1(MSO) }

import { encode, decode } from 'cbor-x'

const NS = 'org.iso.18013.5.1'
const ALG_ES256 = -7  // COSE alg identifier for ECDSA w/ SHA-256

export interface MdocKeyPair {
  privateKey: CryptoKey
  publicKey: CryptoKey
}

export async function generateMdocKeyPair(): Promise<MdocKeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  return { privateKey: pair.privateKey, publicKey: pair.publicKey }
}

// Build Sig_Structure per RFC 8152 §4.4
function buildSigStructure(protectedHeader: Uint8Array, payload: Uint8Array): Uint8Array {
  return encode(['Signature1', protectedHeader, new Uint8Array(0), payload])
}

// Issue: encode credential fields → compute per-element digests → COSE_Sign1(MSO) → assemble mdoc
export async function issueMdoc(
  fields: Record<string, unknown>,
  privateKey: CryptoKey,
): Promise<Uint8Array> {
  // 1. Build IssuerSignedItems with SHA-256 digests
  const itemBytes: Uint8Array[] = []
  const valueDigests: Record<number, Uint8Array> = {}
  let digestID = 0

  for (const [key, value] of Object.entries(fields)) {
    const item = {
      digestID,
      random: crypto.getRandomValues(new Uint8Array(16)),
      elementIdentifier: key,
      elementValue: value,
    }
    const encoded = encode(item)
    valueDigests[digestID] = new Uint8Array(await crypto.subtle.digest('SHA-256', encoded))
    itemBytes.push(encoded)
    digestID++
  }

  // 2. Build MSO (Mobile Security Object)
  const mso = {
    version: '1.0',
    digestAlgorithm: 'SHA-256',
    valueDigests: { [NS]: valueDigests },
    docType: 'org.iso.18013.5.1.mDL',
    validityInfo: {
      signed: new Date().toISOString(),
      validFrom: new Date().toISOString(),
      validUntil: new Date(Date.now() + 86400000).toISOString(),
    },
  }

  // 3. Build COSE_Sign1
  const protectedHeader = encode(new Map<number, number>([[1, ALG_ES256]]))
  const msoPayload = encode(mso)
  const sigStructure = buildSigStructure(protectedHeader, msoPayload)
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, sigStructure),
  )

  // COSE_Sign1 = [protected_header: bstr, unprotected: {}, payload: bstr, signature: bstr]
  const issuerAuth = [protectedHeader, {}, msoPayload, signature]

  // 4. Assemble mdoc
  const doc = {
    docType: 'org.iso.18013.5.1.mDL',
    issuerSigned: {
      nameSpaces: { [NS]: itemBytes },
      issuerAuth,
    },
  }
  return encode(doc)
}

// Verify: CBOR decode → verify COSE signature → verify per-element digests
export async function verifyMdoc(mdocBytes: Uint8Array, publicKey: CryptoKey): Promise<boolean> {
  // 1. CBOR decode
  const doc = decode(mdocBytes) as Record<string, unknown>
  const issuerSigned = doc.issuerSigned as Record<string, unknown>
  const coseSign1 = issuerSigned.issuerAuth as [Uint8Array, unknown, Uint8Array, Uint8Array]
  const [protectedHeader, , msoPayload, signature] = coseSign1

  // 2. Verify COSE_Sign1 signature
  const sigStructure = buildSigStructure(protectedHeader, msoPayload)
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    signature,
    sigStructure,
  )
  if (!valid) return false

  // 3. Verify per-element digests (IssuerAuthentication)
  const mso = decode(msoPayload) as Record<string, unknown>
  const storedDigests = (mso.valueDigests as Record<string, Record<number, Uint8Array>>)[NS]
  const items = (issuerSigned.nameSpaces as Record<string, Uint8Array[]>)[NS]

  for (let i = 0; i < items.length; i++) {
    const computed = new Uint8Array(await crypto.subtle.digest('SHA-256', items[i]))
    const expected = storedDigests[i]
    if (expected.length !== computed.length) return false
    for (let j = 0; j < computed.length; j++) {
      if (computed[j] !== expected[j]) return false
    }
  }

  return true
}
