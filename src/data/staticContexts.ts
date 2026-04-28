// Pre-embedded JSON-LD contexts to avoid network fetches in browser benchmarks.
// @version:1.1 and @protected are intentionally omitted to avoid jsonld v8 safe-mode events.

export const VC_CONTEXT_URL = 'https://www.w3.org/2018/credentials/v1'
export const VC2_CONTEXT_URL = 'https://www.w3.org/ns/credentials/v2'
export const ED25519_CONTEXT_URL = 'https://w3id.org/security/suites/ed25519-2020/v1'

const CRED = 'https://www.w3.org/2018/credentials#'
const SEC  = 'https://w3id.org/security#'
const XSD  = 'http://www.w3.org/2001/XMLSchema#'

export const VC_CONTEXT = {
  '@context': {
    id: '@id',
    type: '@type',
    cred: CRED,
    sec: SEC,
    xsd: XSD,
    VerifiableCredential:   `${CRED}VerifiableCredential`,
    VerifiablePresentation: `${CRED}VerifiablePresentation`,
    credentialSchema:   { '@id': `${CRED}credentialSchema`,   '@type': '@id', '@container': '@set' },
    credentialStatus:   { '@id': `${CRED}credentialStatus`,   '@type': '@id' },
    credentialSubject:  { '@id': `${CRED}credentialSubject`,  '@type': '@id' },
    evidence:           { '@id': `${CRED}evidence`,           '@type': '@id' },
    expirationDate:     { '@id': `${CRED}expirationDate`,     '@type': `${XSD}dateTime` },
    issuanceDate:       { '@id': `${CRED}issuanceDate`,       '@type': `${XSD}dateTime` },
    issuer:             { '@id': `${CRED}issuer`,             '@type': '@id' },
    proof:              { '@id': `${SEC}proof`,               '@type': '@id', '@container': '@graph' },
    validFrom:          { '@id': `${CRED}validFrom`,          '@type': `${XSD}dateTime` },
    validUntil:         { '@id': `${CRED}validUntil`,         '@type': `${XSD}dateTime` },
    name:               'http://schema.org/name',
    given_name:         'http://schema.org/givenName',
    family_name:        'http://schema.org/familyName',
    birthdate:          'http://schema.org/birthDate',
  },
}

export const ED25519_CONTEXT = {
  '@context': {
    id: '@id',
    type: '@type',
    sec: SEC,
    xsd: XSD,
    Ed25519VerificationKey2020: `${SEC}Ed25519VerificationKey2020`,
    Ed25519Signature2020: `${SEC}Ed25519Signature2020`,
    controller:       { '@id': `${SEC}controller`,       '@type': '@id' },
    publicKeyMultibase: `${SEC}publicKeyMultibase`,
    proofPurpose:     { '@id': `${SEC}proofPurpose`,     '@type': '@vocab' },
    proofValue:       `${SEC}proofValue`,
    verificationMethod: { '@id': `${SEC}verificationMethod`, '@type': '@id' },
    created:          { '@id': 'http://purl.org/dc/terms/created', '@type': `${XSD}dateTime` },
  },
}

/** Suppress jsonld v8 safe-mode warning events (e.g. @version processing). */
export function jsonldEventHandler(event: { level: string; message: string; code?: string }) {
  if (event.level === 'warning') return  // suppress expected warnings
  // Allow errors to propagate as exceptions from the caller
}

/** Static document loader — returns pre-embedded contexts without network access. */
export function makeStaticContextLoader() {
  const cache: Record<string, unknown> = {
    [VC_CONTEXT_URL]:     VC_CONTEXT,
    [VC2_CONTEXT_URL]:    VC_CONTEXT,
    [ED25519_CONTEXT_URL]: ED25519_CONTEXT,
  }

  return async (url: string) => {
    if (cache[url]) {
      return { contextUrl: null, document: cache[url], documentUrl: url }
    }
    throw new Error(
      `Context not pre-loaded: ${url}\n(本番環境ではここでネットワーク取得が発生し、SSRF攻撃面となる)`,
    )
  }
}
