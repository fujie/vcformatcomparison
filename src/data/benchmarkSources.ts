// Actual source code used in each benchmark, embedded as string constants.
// These are shown verbatim in the Results Report for reproducibility.

// ── Go WASM (go/bench/main.go) ───────────────────────────────────────────────
export const GO_BENCH_SOURCE = `//go:build js && wasm

// Compiled: GOOS=js GOARCH=wasm go build -o public/go-bench.wasm .
// Runtime:  wasm_exec.js (Go standard library)

package main

import (
  "crypto/ecdsa"
  "crypto/elliptic"
  "crypto/rand"
  "crypto/sha256"
  "encoding/base64"
  "encoding/json"
  "fmt"
  "math/big"
  "syscall/js"
  "time"
)

type BenchResult struct {
  OpsPerSec  float64 \`json:"opsPerSec"\`
  AvgMs      float64 \`json:"avgMs"\`
  Iterations int     \`json:"iterations"\`
  IsActual   bool    \`json:"isActual"\`
}

func bench(n int, fn func()) BenchResult {
  fn() // warm-up
  start := time.Now()
  for i := 0; i < n; i++ { fn() }
  d := time.Since(start)
  return BenchResult{OpsPerSec: float64(n)/d.Seconds(),
    AvgMs: d.Seconds()*1000/float64(n), Iterations: n, IsActual: true}
}

func runBenchmarks(this js.Value, args []js.Value) interface{} {
  N   := 100
  key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)

  hdr     := base64.RawURLEncoding.EncodeToString([]byte(\`{"alg":"ES256"}\`))
  pay     := base64.RawURLEncoding.EncodeToString([]byte(\`{"iss":"https://issuer.example.com","vct":"identity"}\`))
  msg     := fmt.Sprintf("%s.%s", hdr, pay)
  msgHash := sha256.Sum256([]byte(msg))

  results := map[string]*BenchResult{}

  // SD-JWT VC no-lib: ECDSA P-256 sign
  var rBytes, sBytes []byte
  r := bench(N, func() {
    ri, si, _ := ecdsa.Sign(rand.Reader, key, msgHash[:])
    rBytes, sBytes = ri.FillBytes(make([]byte,32)), si.FillBytes(make([]byte,32))
  })
  results["SD-JWT VC-noLib-sign"] = &r

  // SD-JWT VC no-lib: ECDSA P-256 verify
  ri, si := new(big.Int).SetBytes(rBytes), new(big.Int).SetBytes(sBytes)
  v := bench(N, func() { ecdsa.Verify(&key.PublicKey, msgHash[:], ri, si) })
  results["SD-JWT VC-noLib-verify"] = &v

  // mdoc no-lib: per-element SHA-256 + ECDSA sign over COSE Sig_Structure
  // (Minimal CBOR encoder is included in the full source at go/bench/main.go)
  // ...

  out, _ := json.Marshal(map[string]interface{}{"results": results})
  return js.ValueOf(string(out))
}

func main() { js.Global().Set("goBench", js.FuncOf(runBenchmarks)); select{} }`

// ── Python (Pyodide / WebAssembly) ───────────────────────────────────────────
export const PYTHON_BENCH_SOURCE = `# Runtime: Pyodide v0.26.4 (CPython 3.12 via WebAssembly)
# Packages: cryptography (bundled), PyJWT / pyld / cbor2 (micropip)

import time, json, base64
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.utils import (
    decode_dss_signature, encode_dss_signature)

def b64url(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()
def bench(fn, n):
    fn()  # warm-up
    t = time.perf_counter()
    for _ in range(n): fn()
    d = time.perf_counter() - t
    return {"opsPerSec": round(n/d,1), "avgMs": round(d*1000/n,3), "iterations": n, "isActual": True}

N = 100
key = ec.generate_private_key(ec.SECP256R1())
pub = key.public_key()
payload = {"iss": "https://issuer.example.com", "vct": "identity"}
h_hdr = b64url(json.dumps({"alg": "ES256"}).encode())
h_pay = b64url(json.dumps(payload).encode())
msg   = f"{h_hdr}.{h_pay}".encode()

results = {}

# SD-JWT VC no-lib: sign (DER → IEEE P1363)
def sd_sign():
    der = key.sign(msg, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    return f"{h_hdr}.{h_pay}.{b64url(r.to_bytes(32,'big')+s.to_bytes(32,'big'))}"

token = sd_sign()
results["SD-JWT VC-noLib-sign"] = bench(sd_sign, N)

# SD-JWT VC no-lib: verify (P1363 → DER)
def sd_verify():
    p = token.split('.')
    sig = base64.urlsafe_b64decode(p[2]+'==')
    r,s = int.from_bytes(sig[:32],'big'), int.from_bytes(sig[32:],'big')
    pub.verify(encode_dss_signature(r,s), f"{p[0]}.{p[1]}".encode(),
               ec.ECDSA(hashes.SHA256()))
results["SD-JWT VC-noLib-verify"] = bench(sd_verify, N)

# SD-JWT VC with PyJWT
import jwt
results["SD-JWT VC-withLib-sign"]   = bench(lambda: jwt.encode(payload, key, algorithm='ES256'), N)
tok2 = jwt.encode(payload, key, algorithm='ES256')
results["SD-JWT VC-withLib-verify"] = bench(lambda: jwt.decode(tok2, pub, algorithms=['ES256']), N)

# JSON-LD VC with pyld (URDNA2015 normalization + Ed25519)
from pyld import jsonld
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
import hashlib
ed_key = Ed25519PrivateKey.generate()
vc_doc = {"@context":["https://www.w3.org/2018/credentials/v1"],
          "type":"VerifiableCredential","issuer":"https://example.com",
          "credentialSubject":{"id":"did:example:1"}}
def jl_sign():
    normalized = jsonld.normalize(vc_doc,{"algorithm":"URDNA2015","format":"application/n-quads"})
    ed_key.sign(hashlib.sha256(normalized.encode()).digest())
results["JSON-LD VC-withLib-sign"] = bench(jl_sign, max(N//5, 10))

# mdoc no-lib: manual CBOR + ECDSA P-256
# (see full Python CBOR encoder in src/benchmarks/noLibrary.ts PY_BENCH_CODE)

print(json.dumps(results))`

// ── TypeScript 署名速度ベンチマーク (src/benchmarks/signatureSpeed.ts) ─────────
export const TS_SPEED_SOURCE = `// Runtime: Browser (Web Crypto API) via Vite + React
// Library:  jose@6.x (@panva) / @noble/ed25519@2.x / jsonld@8.x / cbor-x@1.x

import { SignJWT, generateKeyPair, jwtVerify } from 'jose'

// ── SD-JWT VC: EdDSA (Ed25519) ──────────────────────────────────────
const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
const N = 50  // iterations

// sign
const t0 = performance.now()
for (let i = 0; i < N; i++) {
  await new SignJWT(payload)
    .setProtectedHeader({ alg: 'EdDSA' })
    .sign(privateKey)
}
const signOpsPerSec = N / ((performance.now() - t0) / 1000)

// verify
const t1 = performance.now()
for (let i = 0; i < N; i++) {
  await jwtVerify(token, publicKey)
}
const verifyOpsPerSec = N / ((performance.now() - t1) / 1000)

// ── JSON-LD VC: URDNA2015 + SHA-256 + Ed25519 ──────────────────────
import jsonld from 'jsonld'
import * as ed from '@noble/ed25519'

const t2 = performance.now()
for (let i = 0; i < N; i++) {
  const normalized = await jsonld.normalize(vcDoc, {
    algorithm: 'URDNA2015', format: 'application/n-quads',
    documentLoader: staticLoader, safe: false,
  }) as string
  const hash = new Uint8Array(await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(normalized)))
  await ed.signAsync(hash, privateKey)
}

// ── mdoc: CBOR encode + SHA-256×N + COSE_Sign1 (ECDSA P-256) ────────
import { encode } from 'cbor-x'

const t3 = performance.now()
for (let i = 0; i < N; i++) {
  // Per-element digests
  for (const [key, value] of Object.entries(fields)) {
    const item = encode({ digestID, random, elementIdentifier: key, elementValue: value })
    await crypto.subtle.digest('SHA-256', item)
  }
  // COSE_Sign1 Sig_Structure → ECDSA P-256
  const sigStruct = encode(['Signature1', protHdr, new Uint8Array(0), msoPayload])
  await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, sigStruct)
}`

// ── TypeScript ライブラリなし実装 (src/benchmarks/noLibrary.ts) ───────────────
export const TS_NOLIB_SOURCE = `// ライブラリなし実装: Web Crypto API のみ使用（外部パッケージ不要）

// ── SD-JWT VC no-lib ──────────────────────────────────────────────────
// 鍵生成
const keyPair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])

// 署名
const h = b64url(JSON.stringify({ alg: 'ES256' }))
const p = b64url(JSON.stringify(payload))
const sig = new Uint8Array(await crypto.subtle.sign(
  { name: 'ECDSA', hash: 'SHA-256' },
  keyPair.privateKey,
  new TextEncoder().encode(\`\${h}.\${p}\`)))
const token = \`\${h}.\${p}.\${b64url(sig)}\`

// 検証
const ok = await crypto.subtle.verify(
  { name: 'ECDSA', hash: 'SHA-256' }, keyPair.publicKey, sig,
  new TextEncoder().encode(\`\${h}.\${p}\`))

// ── mdoc no-lib: 手書き CBOR + COSE_Sign1 ────────────────────────────
// CBOR エンコーダ (RFC 7049, 外部ライブラリなし)
function cborEncode(v: unknown): Uint8Array { /* ... 80行の手実装 ... */ }

// per-element SHA-256 ダイジェスト
for (const [k, val] of Object.entries(fields)) {
  const item = cborEncode(new Map([['digestID',id],['elementIdentifier',k],['elementValue',val]]))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', item))
  valueDigestMap.set(id, digest)
}

// COSE Sig_Structure 構築
const protHdr   = cborEncode(new Map([[1, -7]]))  // {alg: ES256}
const msoPayload = cborEncode(mso)
const sigStruct = cborEncode(['Signature1', protHdr, new Uint8Array(0), msoPayload])

// ECDSA P-256 署名
const signature = new Uint8Array(await crypto.subtle.sign(
  { name: 'ECDSA', hash: 'SHA-256' }, privateKey, sigStruct))`

// ── TypeScript セキュリティテスト (src/benchmarks/normalizationSecurity.ts) ────
export const TS_SECURITY_SOURCE = `// セキュリティテスト実行コード

// 1. ポイズングラフ DoS: URDNA2015 を指数時間に追い込む循環ブランクノード
const poisonDoc = {
  '@graph': Array.from({length: 20}, (_, i) => ({
    '@type': 'http://example.org/Node',
    'http://example.org/link': { '@id': \`_:b\${(i+1)%20}\` }
  }))
}
const t0 = performance.now()
await jsonld.normalize(poisonDoc, { algorithm: 'URDNA2015', ... })
const poisonMs = performance.now() - t0  // >> 通常グラフの時間

// 2. コンテキストインジェクション: @protected 項目の上書き試行
const maliciousDoc = {
  '@context': [VC_CONTEXT_URL, {
    issuer: 'http://attacker.example.com/vocab#maliciousIssuer'  // 上書き試行
  }],
  type: 'VerifiableCredential', issuer: 'https://legitimate-issuer.example.com'
}
try { await jsonld.normalize(maliciousDoc, opts) }
catch (e) { /* @protected により拒否 */ }

// 3. JWT alg:none 攻撃
const [h64, p64] = token.split('.')
const noneHeader = btoa(JSON.stringify({ alg: 'none' }))...
try { await jwtVerify(\`\${noneHeader}.\${p64}.\`, publicKey) }
catch { /* jose が正しく拒否 */ }

// 4. mdoc ダイジェスト改ざん検出
const tamperedItem = encode({ ...originalItem, elementValue: 'ATTACKER' })
items[0] = tamperedItem
const valid = await verifyMdoc(tamperedMdoc, publicKey)  // → false`
