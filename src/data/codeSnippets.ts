// Code snippets for the language comparison view.
// Each entry has: language, format, mode (withLib/noLib), LOC, dependencies, code.

export type Lang   = 'TypeScript' | 'Go' | 'Python'
export type FmtKey = 'SD-JWT VC' | 'JSON-LD VC' | 'JSON-LD VC (JCS)' | 'mdoc'
export type Mode   = 'withLib' | 'noLib'

export interface Snippet {
  language: Lang
  format: FmtKey
  mode: Mode
  loc: number
  dependencies: string[]
  stdlibOnly: boolean       // true if no external packages at all
  impractical?: boolean     // true if "no-lib" is unrealistic (JSON-LD URDNA2015)
  estimatedLoc?: number     // estimated full LOC if impractical
  code: string
  notes?: string
}

// ============================================================
// SD-JWT VC
// ============================================================

const SD_JWT_TS_NOLIB: Snippet = {
  language: 'TypeScript', format: 'SD-JWT VC', mode: 'noLib',
  loc: 28, dependencies: [], stdlibOnly: true,
  notes: 'Web Crypto API (ECDSA P-256) + btoa/atob。外部パッケージ不要。',
  code: `// SD-JWT VC 署名 — ライブラリなし（Web Crypto API のみ）
function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '')
}

async function sign(payload: object, key: CryptoKey): Promise<string> {
  const h = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'ES256' })))
  const p = b64url(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key,
      new TextEncoder().encode(\`\${h}.\${p}\`))
  )
  return \`\${h}.\${p}.\${b64url(sig)}\`
}

async function verify(token: string, key: CryptoKey): Promise<object> {
  const [h, p, s] = token.split('.')
  const hdr = JSON.parse(atob(h.replace(/-/g,'+').replace(/_/g,'/')))
  if (hdr.alg !== 'ES256') throw new Error('Unexpected alg')
  const sig = Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0))
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig,
    new TextEncoder().encode(\`\${h}.\${p}\`))
  if (!ok) throw new Error('Invalid signature')
  return JSON.parse(atob(p.replace(/-/g,'+').replace(/_/g,'/')))
}`,
}

const SD_JWT_TS_WITHLIB: Snippet = {
  language: 'TypeScript', format: 'SD-JWT VC', mode: 'withLib',
  loc: 8, dependencies: ['jose@6.x'],  stdlibOnly: false,
  notes: 'jose が JWS の全処理を抽象化。鍵生成から署名まで統一API。',
  code: `import { SignJWT, jwtVerify, generateKeyPair } from 'jose'

const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })

// 署名
const token = await new SignJWT(payload)
  .setProtectedHeader({ alg: 'EdDSA' })
  .sign(privateKey)

// 検証
const { payload: claims } = await jwtVerify(token, publicKey)`,
}

const SD_JWT_GO_NOLIB: Snippet = {
  language: 'Go', format: 'SD-JWT VC', mode: 'noLib',
  loc: 45, dependencies: [], stdlibOnly: true,
  notes: 'crypto/ecdsa, encoding/base64, encoding/json, crypto/elliptic のみ使用。',
  code: `// SD-JWT VC 署名 — 標準ライブラリのみ
import (
  "crypto/ecdsa"
  "crypto/rand"
  "crypto/sha256"
  "encoding/base64"
  "encoding/json"
  "strings"
)

func b64url(b []byte) string {
  return base64.RawURLEncoding.EncodeToString(b)
}

func Sign(payload map[string]any, key *ecdsa.PrivateKey) (string, error) {
  hdr, _ := json.Marshal(map[string]string{"alg": "ES256"})
  pay, _ := json.Marshal(payload)
  h, p := b64url(hdr), b64url(pay)
  msg := h + "." + p
  hash := sha256.Sum256([]byte(msg))
  r, s, err := ecdsa.Sign(rand.Reader, key, hash[:])
  if err != nil { return "", err }
  sig := make([]byte, 64)
  r.FillBytes(sig[:32]); s.FillBytes(sig[32:])
  return msg + "." + b64url(sig), nil
}

func Verify(token string, pub *ecdsa.PublicKey) (map[string]any, error) {
  parts := strings.Split(token, ".")
  if len(parts) != 3 { return nil, errors.New("invalid JWT") }
  input := []byte(parts[0] + "." + parts[1])
  hash := sha256.Sum256(input)
  sig, _ := base64.RawURLEncoding.DecodeString(parts[2])
  r := new(big.Int).SetBytes(sig[:32])
  s := new(big.Int).SetBytes(sig[32:])
  if !ecdsa.Verify(pub, hash[:], r, s) { return nil, errors.New("invalid sig") }
  // decode payload ...
  return result, nil
}`,
}

const SD_JWT_GO_WITHLIB: Snippet = {
  language: 'Go', format: 'SD-JWT VC', mode: 'withLib',
  loc: 10, dependencies: ['github.com/golang-jwt/jwt/v5'],  stdlibOnly: false,
  notes: 'golang-jwt/jwt が RS256/ES256/EdDSA を統一インターフェースで提供。',
  code: `import (
  "github.com/golang-jwt/jwt/v5"
  "crypto/ecdsa"
)

// 署名
claims := jwt.MapClaims{"iss": "https://issuer.example.com", "vct": "identity"}
tok := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
signed, err := tok.SignedString(privateKey)

// 検証
parsed, err := jwt.Parse(signed, func(t *jwt.Token) (any, error) {
  return publicKey.(*ecdsa.PublicKey), nil
})`,
}

const SD_JWT_PY_NOLIB: Snippet = {
  language: 'Python', format: 'SD-JWT VC', mode: 'noLib',
  loc: 38, dependencies: ['cryptography'],  stdlibOnly: false,
  notes: 'cryptography は署名のみ。base64/json は stdlib。DER→IEEE P1363 変換が必要。',
  code: `import base64, json, struct
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()

def sign(payload: dict, key: ec.EllipticCurvePrivateKey) -> str:
    h = b64url(json.dumps({"alg": "ES256"}).encode())
    p = b64url(json.dumps(payload).encode())
    msg = f"{h}.{p}".encode()
    # cryptography returns DER; JOSE needs raw r||s (IEEE P1363)
    der = key.sign(msg, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    raw = r.to_bytes(32, 'big') + s.to_bytes(32, 'big')
    return f"{h}.{p}.{b64url(raw)}"

def verify(token: str, pub: ec.EllipticCurvePublicKey) -> dict:
    h, p, s = token.split('.')
    raw = base64.urlsafe_b64decode(s + '==')
    r = int.from_bytes(raw[:32], 'big')
    s_int = int.from_bytes(raw[32:], 'big')
    # P1363 → DER via encode_dss_signature
    from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
    der = encode_dss_signature(r, s_int)
    msg = f"{h}.{p}".encode()
    pub.verify(der, msg, ec.ECDSA(hashes.SHA256()))  # raises if invalid
    return json.loads(base64.urlsafe_b64decode(p + '=='))`,
}

const SD_JWT_PY_WITHLIB: Snippet = {
  language: 'Python', format: 'SD-JWT VC', mode: 'withLib',
  loc: 7, dependencies: ['PyJWT>=2.8'],  stdlibOnly: false,
  notes: 'PyJWT が DER/P1363 変換・検証を自動処理。',
  code: `import jwt
from cryptography.hazmat.primitives.asymmetric import ec

# 鍵生成
private_key = ec.generate_private_key(ec.SECP256R1())
public_key  = private_key.public_key()

# 署名
token = jwt.encode({"iss": "https://issuer.example.com", "vct": "identity"},
                   private_key, algorithm='ES256')
# 検証
claims = jwt.decode(token, public_key, algorithms=['ES256'])`,
}

// ============================================================
// JSON-LD VC
// ============================================================

const JSONLD_TS_NOLIB: Snippet = {
  language: 'TypeScript', format: 'JSON-LD VC', mode: 'noLib',
  loc: 62, dependencies: [], stdlibOnly: true,
  notes: 'blank node がない資格情報では URDNA2015 は「静的コンテキスト展開 → N-Quads → ソート」に簡略化できる。blank node を含む汎用実装は別途 ~1200行が必要。',
  code: `// URDNA2015 (blank-node-free 向け簡略実装)
// ブランクノードがない場合: 展開 → N-Quads → ソート のみ

const CRED  = 'https://www.w3.org/2018/credentials#'
const SCH   = 'http://schema.org/'
const XSD   = 'http://www.w3.org/2001/XMLSchema#'
const RDF_T = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

// 静的コンテキストマッピング（VC_CONTEXT から抽出）
const TERMS: Record<string, { iri: string; vt?: string }> = {
  VerifiableCredential: { iri: CRED + 'VerifiableCredential' },
  credentialSubject:    { iri: CRED + 'credentialSubject', vt: '@id' },
  issuanceDate:         { iri: CRED + 'issuanceDate', vt: XSD + 'dateTime' },
  issuer:               { iri: CRED + 'issuer',        vt: '@id' },
  given_name:           { iri: SCH + 'givenName' },
  family_name:          { iri: SCH + 'familyName' },
  birthdate:            { iri: SCH + 'birthDate' },
  // ... 他の用語
}

function ntLit(v: string, type?: string): string {
  const e = v.replace(/\\/g,'\\\\').replace(/"/g,'\\"')
              .replace(/\\n/g,'\\\\n').replace(/\\r/g,'\\\\r')
  return type ? \`"\${e}"^^<\${type}>\` : \`"\${e}"\`
}

function expandTriples(subj: string, obj: Record<string, unknown>): string[] {
  const q: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'id' || k === '@context') continue
    if (k === 'type') {
      for (const t of Array.isArray(v) ? v : [v])
        q.push(\`<\${subj}> <\${RDF_T}> <\${TERMS[t]?.iri ?? t}> .\`)
      continue
    }
    const term = TERMS[k]; if (!term) continue
    if (term.vt === '@id') {
      if (typeof v === 'object' && v !== null) {
        const nestedId = (v as any).id as string
        q.push(\`<\${subj}> <\${term.iri}> <\${nestedId}> .\`)
        q.push(...expandTriples(nestedId, v as any))
      } else {
        q.push(\`<\${subj}> <\${term.iri}> <\${v}> .\`)
      }
    } else {
      q.push(\`<\${subj}> <\${term.iri}> \${ntLit(v as string, term.vt)} .\`)
    }
  }
  return q
}

function jsonLdNormalize(doc: Record<string, unknown>): string {
  return expandTriples(doc.id as string, doc).sort().join('\\n') + '\\n'
}

async function sign(doc: object, privateKey: CryptoKey): Promise<ArrayBuffer> {
  const norm = jsonLdNormalize(doc as Record<string, unknown>)
  const hash = await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(norm))
  return crypto.subtle.sign({ name: 'Ed25519' }, privateKey, hash)
}`,
}

const JSONLD_TS_WITHLIB: Snippet = {
  language: 'TypeScript', format: 'JSON-LD VC', mode: 'withLib',
  loc: 18, dependencies: ['jsonld@8.x', '@noble/ed25519@2.x'],  stdlibOnly: false,
  notes: 'URDNA2015正規化はjsonldライブラリに委任。署名自体はEd25519で軽量。',
  code: `import jsonld from 'jsonld'
import * as ed from '@noble/ed25519'

async function sign(doc: object, privateKey: Uint8Array): Promise<string> {
  // 1. URDNA2015 正規化（ライブラリなしでは ~1200行）
  const normalized = await jsonld.normalize(doc, {
    algorithm: 'URDNA2015',
    format: 'application/n-quads',
    documentLoader: myLoader,  // コンテキスト取得（SSRF注意）
    safe: false,
  }) as string

  // 2. SHA-256 → Ed25519 署名
  const hash = new Uint8Array(await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(normalized)))
  return Buffer.from(await ed.signAsync(hash, privateKey)).toString('hex')
}`,
}

const JSONLD_GO_NOLIB: Snippet = {
  language: 'Go', format: 'JSON-LD VC', mode: 'noLib',
  loc: 65, dependencies: [], stdlibOnly: true,
  notes: 'blank node なし資格情報向けの静的コンテキスト展開 + N-Quads ソート実装。汎用 URDNA2015 は ~1500行。',
  code: `package main

import (
    "crypto/ed25519"
    "crypto/sha256"
    "encoding/json"
    "fmt"
    "sort"
    "strings"
)

const credNS = "https://www.w3.org/2018/credentials#"
const schNS  = "http://schema.org/"
const xsdNS  = "http://www.w3.org/2001/XMLSchema#"
const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"

var terms = map[string]struct{ iri, vt string }{
    "VerifiableCredential": {credNS + "VerifiableCredential", ""},
    "credentialSubject":    {credNS + "credentialSubject", "@id"},
    "issuanceDate":         {credNS + "issuanceDate", xsdNS + "dateTime"},
    "issuer":               {credNS + "issuer", "@id"},
    "given_name":           {schNS + "givenName", ""},
    "family_name":          {schNS + "familyName", ""},
    "birthdate":            {schNS + "birthDate", ""},
}

func ntLit(v, dtype string) string {
    e := strings.NewReplacer(\`\\\\\`, \`\\\\\\\\\`, \`"\`, \`\\\\"\`, "\\n", \`\\\\n\`).Replace(v)
    if dtype == "" { return fmt.Sprintf(\`"%s"\`, e) }
    return fmt.Sprintf(\`"%s"^^<%s>\`, e, dtype)
}

func expandTriples(subj string, obj map[string]any) []string {
    var q []string
    for k, v := range obj {
        if k == "id" || k == "@context" { continue }
        if k == "type" {
            typeIRI := terms[v.(string)].iri
            q = append(q, fmt.Sprintf("<%s> <%s> <%s> .", subj, rdfType, typeIRI))
            continue
        }
        t, ok := terms[k]; if !ok { continue }
        if t.vt == "@id" {
            if nested, ok := v.(map[string]any); ok {
                nid := nested["id"].(string)
                q = append(q, fmt.Sprintf("<%s> <%s> <%s> .", subj, t.iri, nid))
                q = append(q, expandTriples(nid, nested)...)
            } else {
                q = append(q, fmt.Sprintf("<%s> <%s> <%s> .", subj, t.iri, v))
            }
        } else {
            q = append(q, fmt.Sprintf("<%s> <%s> %s .", subj, t.iri, ntLit(v.(string), t.vt)))
        }
    }
    return q
}

func jsonLdNormalize(doc map[string]any) string {
    q := expandTriples(doc["id"].(string), doc)
    sort.Strings(q)
    return strings.Join(q, "\\n") + "\\n"
}

func sign(doc map[string]any, priv ed25519.PrivateKey) []byte {
    norm := jsonLdNormalize(doc)
    h := sha256.Sum256([]byte(norm))
    return ed25519.Sign(priv, h[:])
}`,
}

const JSONLD_GO_WITHLIB: Snippet = {
  language: 'Go', format: 'JSON-LD VC', mode: 'withLib',
  loc: 20, dependencies: ['github.com/piprate/json-gold'],  stdlibOnly: false,
  notes: 'json-gold が URDNA2015を提供。署名は crypto/ed25519 (stdlib)。',
  code: `import (
  "github.com/piprate/json-gold/ld"
  "crypto/ed25519"
  "crypto/sha256"
)

func Sign(doc map[string]any, privKey ed25519.PrivateKey) ([]byte, error) {
  proc := ld.NewJsonLdProcessor()
  opts := ld.NewJsonLdOptions("")
  opts.Format        = "application/n-quads"
  opts.Algorithm     = "URDNA2015"

  normalized, err := proc.Normalize(doc, opts)
  if err != nil { return nil, err }

  hash := sha256.Sum256([]byte(normalized.(string)))
  return ed25519.Sign(privKey, hash[:]), nil
}`,
}

const JSONLD_PY_NOLIB: Snippet = {
  language: 'Python', format: 'JSON-LD VC', mode: 'noLib',
  loc: 55, dependencies: [], stdlibOnly: true,
  notes: 'blank node なし資格情報向けの静的コンテキスト展開 + N-Quads ソート実装。汎用 URDNA2015 は ~1300行。',
  code: `import hashlib, json
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

CRED  = 'https://www.w3.org/2018/credentials#'
SCH   = 'http://schema.org/'
XSD   = 'http://www.w3.org/2001/XMLSchema#'
RDF_T = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

TERMS = {
    'VerifiableCredential': {'iri': CRED+'VerifiableCredential', 'vt': None},
    'credentialSubject':    {'iri': CRED+'credentialSubject',    'vt': '@id'},
    'issuanceDate':         {'iri': CRED+'issuanceDate',         'vt': XSD+'dateTime'},
    'issuer':               {'iri': CRED+'issuer',               'vt': '@id'},
    'given_name':           {'iri': SCH+'givenName',             'vt': None},
    'family_name':          {'iri': SCH+'familyName',            'vt': None},
    'birthdate':            {'iri': SCH+'birthDate',             'vt': None},
}

def nt_lit(v: str, vt: str | None) -> str:
    e = v.replace('\\\\', '\\\\\\\\').replace('"', '\\\\"')\\
         .replace('\\n', '\\\\n').replace('\\r', '\\\\r')
    return f'"{e}"^^<{vt}>' if vt else f'"{e}"'

def expand_triples(subj: str, obj: dict) -> list[str]:
    q = []
    for k, v in obj.items():
        if k in ('id', '@context'): continue
        if k == 'type':
            q.append(f'<{subj}> <{RDF_T}> <{TERMS[v]["iri"]}> .')
            continue
        t = TERMS.get(k)
        if not t: continue
        if t['vt'] == '@id':
            if isinstance(v, dict):
                nid = v['id']
                q.append(f'<{subj}> <{t["iri"]}> <{nid}> .')
                q.extend(expand_triples(nid, v))
            else:
                q.append(f'<{subj}> <{t["iri"]}> <{v}> .')
        else:
            q.append(f'<{subj}> <{t["iri"]}> {nt_lit(v, t["vt"])} .')
    return q

def jsonld_normalize(doc: dict) -> str:
    quads = expand_triples(doc['id'], doc)
    return '\\n'.join(sorted(quads)) + '\\n'

def sign(doc: dict, private_key: Ed25519PrivateKey) -> bytes:
    norm   = jsonld_normalize(doc)
    digest = hashlib.sha256(norm.encode()).digest()
    return private_key.sign(digest)`,
}

const JSONLD_PY_WITHLIB: Snippet = {
  language: 'Python', format: 'JSON-LD VC', mode: 'withLib',
  loc: 15, dependencies: ['pyld>=2.0', 'cryptography'],  stdlibOnly: false,
  notes: 'pyld が URDNA2015 を提供。Ed25519は cryptography.io ライブラリ。',
  code: `from pyld import jsonld
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
import hashlib

def sign(doc: dict, private_key: Ed25519PrivateKey) -> bytes:
    # URDNA2015 正規化
    normalized = jsonld.normalize(doc, {
        'algorithm': 'URDNA2015',
        'format': 'application/n-quads',
    })
    digest = hashlib.sha256(normalized.encode()).digest()
    return private_key.sign(digest)  # Ed25519

def verify(doc: dict, signature: bytes, public_key) -> bool:
    normalized = jsonld.normalize(doc, {'algorithm': 'URDNA2015', 'format': 'application/n-quads'})
    digest = hashlib.sha256(normalized.encode()).digest()
    public_key.verify(signature, digest)  # raises if invalid
    return True`,
}

// ============================================================
// mdoc
// ============================================================

const MDOC_TS_NOLIB: Snippet = {
  language: 'TypeScript', format: 'mdoc', mode: 'noLib',
  loc: 130, dependencies: [], stdlibOnly: true,
  notes: 'CBOR エンコーダ/デコーダ (~80行) + COSE_Sign1 + ダイジェスト検証を手実装。Web Crypto API のみ。',
  code: `// CBOR encode（抜粋 ~80行）
function cborHead(major: number, n: number): Uint8Array { /* ... */ }
export function cborEncode(v: unknown): Uint8Array {
  if (v instanceof Map) { /* map encoding */ }
  if (v instanceof Uint8Array) { return cat(cborHead(2,v.length), v) }
  if (typeof v === 'string') {
    const b = new TextEncoder().encode(v)
    return cat(cborHead(3, b.length), b)
  }
  // ... uint, negint, array, bool, null
}
export function cborDecode(b: Uint8Array): CborVal { /* ... */ }

// COSE_Sign1 (RFC 9052)
const ALG_ES256 = -7
async function mdocSign(fields: Record<string,unknown>, key: CryptoKey) {
  // 各要素を CBOR エンコードして SHA-256
  const digests = await buildDigests(fields)
  // MSO (Mobile Security Object) を構築
  const mso = { version:'1.0', digestAlgorithm:'SHA-256', valueDigests: digests, ... }
  // Sig_Structure = ["Signature1", protected_header, empty, payload]
  const protHdr = cborEncode(new Map([[1, ALG_ES256]]))
  const payload = cborEncode(mso)
  const sigStruct = cborEncode(['Signature1', protHdr, new Uint8Array(0), payload])
  const sig = await crypto.subtle.sign({ name:'ECDSA', hash:'SHA-256' }, key, sigStruct)
  return cborEncode({ issuerAuth: [protHdr, {}, payload, new Uint8Array(sig)] })
}`,
}

const MDOC_TS_WITHLIB: Snippet = {
  language: 'TypeScript', format: 'mdoc', mode: 'withLib',
  loc: 45, dependencies: ['cbor-x@1.x'],  stdlibOnly: false,
  notes: 'cbor-x が CBOR の煩雑なバイト操作を隠蔽。COSE は手実装（cbor-x で Sig_Structure を構築）。',
  code: `import { encode, decode } from 'cbor-x'

const ALG_ES256 = -7

async function mdocSign(fields: Record<string,unknown>, key: CryptoKey) {
  // 要素ごとの SHA-256 ダイジェスト
  const items = []; const digests: Record<number, Uint8Array> = {}
  for (const [i, [k, v]] of Object.entries(fields).entries()) {
    const b = encode({ digestID: i, random: crypto.getRandomValues(new Uint8Array(16)),
                       elementIdentifier: k, elementValue: v })
    digests[i] = new Uint8Array(await crypto.subtle.digest('SHA-256', b))
    items.push(b)
  }
  const protHdr = encode(new Map([[1, ALG_ES256]]))
  const msoPayload = encode({ version:'1.0', digestAlgorithm:'SHA-256',
    valueDigests: { 'org.iso.18013.5.1': digests }, ... })
  const sigStruct = encode(['Signature1', protHdr, new Uint8Array(0), msoPayload])
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name:'ECDSA', hash:'SHA-256' }, key, sigStruct))
  return encode({ issuerAuth: [protHdr, {}, msoPayload, sig], nameSpaces: items })
}`,
}

const MDOC_GO_NOLIB: Snippet = {
  language: 'Go', format: 'mdoc', mode: 'noLib',
  loc: 160, dependencies: [], stdlibOnly: true,
  notes: 'encoding/binary で CBOR バイト列を手組み。crypto/ecdsa で COSE_Sign1。',
  code: `// CBOR encoding (抜粋)
func cborHead(major, n int) []byte {
    b := byte(major << 5)
    switch {
    case n <= 23:   return []byte{b | byte(n)}
    case n <= 0xFF: return []byte{b | 24, byte(n)}
    default: /* 2/4byte variants */ }
}
func cborEncodeMap(m map[int]int) []byte { /* ... */ }
func cborEncodeBytes(b []byte) []byte    { /* ... */ }
func cborEncodeText(s string) []byte     { /* ... */ }

// COSE_Sign1 = [protected_header, {}, payload, signature]
func MdocSign(fields map[string]any, key *ecdsa.PrivateKey) ([]byte, error) {
    protHdr := cborEncodeMap(map[int]int{1: -7})  // {alg: ES256}
    mso     := buildMSO(fields)
    msoBytes := cborEncode(mso)
    // Sig_Structure
    sigStruct := cborEncodeArray([][]byte{
        cborEncodeText("Signature1"), protHdr, {}, msoBytes})
    h := sha256.Sum256(sigStruct)
    r, s, _ := ecdsa.Sign(rand.Reader, key, h[:])
    sig := append(r.FillBytes(make([]byte,32)), s.FillBytes(make([]byte,32))...)
    return assembleMdoc(protHdr, msoBytes, sig), nil
}`,
}

const MDOC_GO_WITHLIB: Snippet = {
  language: 'Go', format: 'mdoc', mode: 'withLib',
  loc: 50, dependencies: ['github.com/fxamacker/cbor/v2'],  stdlibOnly: false,
  notes: 'fxamacker/cbor が CBOR を担当。COSE_Sign1 の Sig_Structure は cbor.Marshal で構築。',
  code: `import (
  "github.com/fxamacker/cbor/v2"
  "crypto/ecdsa"
  "crypto/sha256"
)

func MdocSign(fields map[string]any, key *ecdsa.PrivateKey) ([]byte, error) {
  // 各要素のダイジェスト
  digests := map[int][]byte{}
  for i, item := range buildItems(fields) {
    b, _ := cbor.Marshal(item)
    h    := sha256.Sum256(b); digests[i] = h[:]
  }
  // MSO
  mso := MSO{Version:"1.0", DigestAlgorithm:"SHA-256", ValueDigests: digests}
  msoBytes, _ := cbor.Marshal(mso)

  // Sig_Structure
  protHdr, _ := cbor.Marshal(cbor.RawTag{})  // {1: -7}
  sigStruct, _ := cbor.Marshal([]any{"Signature1", protHdr, []byte{}, msoBytes})
  h := sha256.Sum256(sigStruct)
  r, s, _ := ecdsa.Sign(rand.Reader, key, h[:])
  sig := append(r.FillBytes(make([]byte,32)), s.FillBytes(make([]byte,32))...)
  return cbor.Marshal(MdocDoc{IssuerAuth: []any{protHdr, map[any]any{}, msoBytes, sig}})
}`,
}

const MDOC_PY_NOLIB: Snippet = {
  language: 'Python', format: 'mdoc', mode: 'noLib',
  loc: 145, dependencies: ['cryptography'],  stdlibOnly: false,
  notes: 'struct モジュールで CBOR バイト組み立て。cryptography で ECDSA P-256。',
  code: `import struct, hashlib
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

def cbor_head(major: int, n: int) -> bytes:
    b = major << 5
    if n <= 23:   return bytes([b | n])
    if n <= 0xFF: return bytes([b | 24, n])
    return bytes([b | 25]) + struct.pack('>H', n)

def cbor_encode(v) -> bytes:
    if isinstance(v, bytes):  return cbor_head(2, len(v)) + v
    if isinstance(v, str):    b = v.encode(); return cbor_head(3, len(b)) + b
    if isinstance(v, int):
        if v >= 0: return cbor_head(0, v)
        return cbor_head(1, -1 - v)
    if isinstance(v, list):
        return cbor_head(4, len(v)) + b''.join(cbor_encode(i) for i in v)
    if isinstance(v, dict):
        return cbor_head(5, len(v)) + b''.join(
            cbor_encode(k) + cbor_encode(val) for k, val in v.items())
    raise TypeError(f"cbor_encode: {type(v)}")

def mdoc_sign(fields: dict, key: ec.EllipticCurvePrivateKey) -> bytes:
    prot_hdr = cbor_encode({1: -7})  # {alg: ES256}
    mso = build_mso(fields)          # MSO with digests
    sig_struct = cbor_encode(["Signature1", prot_hdr, b'', cbor_encode(mso)])
    der = key.sign(sig_struct, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    sig = r.to_bytes(32,'big') + s.to_bytes(32,'big')
    return cbor_encode({"issuerAuth": [prot_hdr, {}, cbor_encode(mso), sig]})`,
}

const MDOC_PY_WITHLIB: Snippet = {
  language: 'Python', format: 'mdoc', mode: 'withLib',
  loc: 35, dependencies: ['cbor2>=5.4', 'cryptography'],  stdlibOnly: false,
  notes: 'cbor2 がエンコード/デコードを担当。COSE_Sign1 は手実装（cbor2 で Sig_Structure を構築）。',
  code: `import cbor2, hashlib
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

def mdoc_sign(fields: dict, key: ec.EllipticCurvePrivateKey) -> bytes:
    items, digests = [], {}
    for i, (k, v) in enumerate(fields.items()):
        item_bytes = cbor2.dumps({"digestID": i, "elementIdentifier": k, "elementValue": v})
        digests[i] = hashlib.sha256(item_bytes).digest()
        items.append(item_bytes)

    mso = {"version": "1.0", "digestAlgorithm": "SHA-256",
           "valueDigests": {"org.iso.18013.5.1": digests}}
    prot_hdr = cbor2.dumps({1: -7})          # {alg: ES256}
    mso_bytes = cbor2.dumps(mso)
    sig_struct = cbor2.dumps(["Signature1", prot_hdr, b'', mso_bytes])
    der = key.sign(sig_struct, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    sig = r.to_bytes(32,'big') + s.to_bytes(32,'big')
    return cbor2.dumps({"issuerAuth": [prot_hdr, {}, mso_bytes, sig],
                        "nameSpaces": items})`,
}

// ============================================================
// Exported registry
// ============================================================

export const SNIPPETS: Snippet[] = [
  SD_JWT_TS_NOLIB, SD_JWT_TS_WITHLIB,
  SD_JWT_GO_NOLIB, SD_JWT_GO_WITHLIB,
  SD_JWT_PY_NOLIB, SD_JWT_PY_WITHLIB,
  JSONLD_TS_NOLIB, JSONLD_TS_WITHLIB,
  JSONLD_GO_NOLIB, JSONLD_GO_WITHLIB,
  JSONLD_PY_NOLIB, JSONLD_PY_WITHLIB,
  MDOC_TS_NOLIB,   MDOC_TS_WITHLIB,
  MDOC_GO_NOLIB,   MDOC_GO_WITHLIB,
  MDOC_PY_NOLIB,   MDOC_PY_WITHLIB,
]

export function getSnippet(lang: Lang, fmt: FmtKey, mode: Mode): Snippet | undefined {
  return SNIPPETS.find(s => s.language === lang && s.format === fmt && s.mode === mode)
}

/** LOC summary table: format → language → {withLib, noLib} */
export function getLOCMatrix(): Record<FmtKey, Record<Lang, { withLib: number; noLib: number; noLibImpractical?: boolean; estimatedLoc?: number }>> {
  const fmts: FmtKey[] = ['SD-JWT VC', 'JSON-LD VC', 'JSON-LD VC (JCS)', 'mdoc']
  const langs: Lang[]  = ['TypeScript', 'Go', 'Python']
  const result = {} as ReturnType<typeof getLOCMatrix>
  for (const f of fmts) {
    result[f] = {} as Record<Lang, { withLib: number; noLib: number }>
    for (const l of langs) {
      const w = getSnippet(l, f, 'withLib')
      const n = getSnippet(l, f, 'noLib')
      result[f][l] = {
        withLib: w?.loc ?? 0,
        noLib:   n?.loc ?? 0,
        noLibImpractical: n?.impractical,
        estimatedLoc: n?.estimatedLoc,
      }
    }
  }
  return result
}
