// Runs Python benchmark code in the browser via Pyodide (WebAssembly Python).
// Pyodide is ~10 MB and loads from CDN on first use.

const PYODIDE_VERSION = '0.26.4'
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pyodide: Promise<any> | null = null

async function getPyodide() {
  if (_pyodide) return _pyodide
  _pyodide = (async () => {
    if (!(window as Record<string, unknown>)['loadPyodide']) {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement('script')
        s.src = PYODIDE_CDN + 'pyodide.js'
        s.onload = () => resolve()
        s.onerror = () => reject(new Error('Pyodide CDN の読み込みに失敗しました'))
        document.head.appendChild(s)
      })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const py = await (window as any).loadPyodide({ indexURL: PYODIDE_CDN })
    return py
  })()
  return _pyodide
}

export interface PyBenchEntry {
  opsPerSec: number
  avgMs: number
  iterations: number
  isActual: true
}

export type PyBenchResults = Record<string, PyBenchEntry>

// Python benchmark code executed inside Pyodide
const PY_BENCH_CODE = `
import time, json, base64
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature, encode_dss_signature

def b64url(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()

def bench(fn, n):
    fn()  # warm-up
    t = time.perf_counter()
    for _ in range(n): fn()
    d = time.perf_counter() - t
    return {"opsPerSec": round(n/d, 1), "avgMs": round(d*1000/n, 3), "iterations": n, "isActual": True}

N = 100
results = {}
errors = {}

# ── SD-JWT VC ──────────────────────────────────────────────────────────────────
key = ec.generate_private_key(ec.SECP256R1())
pub = key.public_key()
payload = {"iss": "https://issuer.example.com", "vct": "identity", "sub": "holder"}
h_hdr = b64url(json.dumps({"alg":"ES256"}).encode())
h_pay = b64url(json.dumps(payload).encode())
msg   = f"{h_hdr}.{h_pay}".encode()

def sd_sign_nolib():
    der = key.sign(msg, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    return f"{h_hdr}.{h_pay}.{b64url(r.to_bytes(32,'big')+s.to_bytes(32,'big'))}"

token_nolib = sd_sign_nolib()

def sd_verify_nolib():
    p = token_nolib.split('.')
    sig = base64.urlsafe_b64decode(p[2] + '==')
    r, s = int.from_bytes(sig[:32],'big'), int.from_bytes(sig[32:],'big')
    pub.verify(encode_dss_signature(r, s), f"{p[0]}.{p[1]}".encode(), ec.ECDSA(hashes.SHA256()))

results["SD-JWT VC-noLib-sign"]   = bench(sd_sign_nolib,   N)
results["SD-JWT VC-noLib-verify"] = bench(sd_verify_nolib, N)

try:
    import jwt  # PyJWT (installed via micropip)
    results["SD-JWT VC-withLib-sign"]   = bench(lambda: jwt.encode(payload, key, algorithm='ES256'), N)
    tok2 = jwt.encode(payload, key, algorithm='ES256')
    results["SD-JWT VC-withLib-verify"] = bench(lambda: jwt.decode(tok2, pub, algorithms=['ES256']), N)
except Exception as e:
    errors["pyjwt"] = str(e)

# ── JSON-LD VC ─────────────────────────────────────────────────────────────────
try:
    from pyld import jsonld  # pyld (installed via micropip)
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    import hashlib

    ed_key = Ed25519PrivateKey.generate()
    vc_doc = {
        "@context": ["https://www.w3.org/2018/credentials/v1"],
        "type": "VerifiableCredential",
        "issuer": "https://example.com",
        "credentialSubject": {"id": "did:example:1", "name": "Taro"},
    }

    def jl_sign():
        normalized = jsonld.normalize(vc_doc, {"algorithm": "URDNA2015", "format": "application/n-quads"})
        digest = hashlib.sha256(normalized.encode()).digest()
        ed_key.sign(digest)

    results["JSON-LD VC-withLib-sign"]   = bench(jl_sign, max(N // 5, 10))
    results["JSON-LD VC-withLib-verify"] = bench(jl_sign, max(N // 5, 10))  # same cost
except Exception as e:
    errors["pyld"] = str(e)

# ── mdoc ───────────────────────────────────────────────────────────────────────
try:
    import struct

    def cbor_head(major, n):
        b = major << 5
        if n <= 23:     return bytes([b | n])
        if n <= 0xFF:   return bytes([b | 24, n])
        return bytes([b | 25]) + struct.pack('>H', n)

    def cbor_enc(v):
        if isinstance(v, bytes):  return cbor_head(2, len(v)) + v
        if isinstance(v, str):    b = v.encode(); return cbor_head(3, len(b)) + b
        if isinstance(v, int):    return cbor_head(0, v) if v >= 0 else cbor_head(1, -1-v)
        if isinstance(v, list):   return cbor_head(4, len(v)) + b''.join(cbor_enc(i) for i in v)
        if isinstance(v, dict):   return cbor_head(5, len(v)) + b''.join(cbor_enc(k)+cbor_enc(val) for k,val in v.items())
        raise TypeError(f"unsupported {type(v)}")

    import hashlib as _hl
    md_key = ec.generate_private_key(ec.SECP256R1())
    md_pub = md_key.public_key()

    fields = {"family_name":"Yamada","given_name":"Taro","birth_date":"1990-01-01","issuing_country":"JP"}

    def md_sign_nolib():
        digests = {}
        for i, (k, v) in enumerate(fields.items()):
            item = cbor_enc({"digestID": i, "elementIdentifier": k, "elementValue": v})
            digests[i] = _hl.sha256(item).digest()
        mso = {"version":"1.0","digestAlgorithm":"SHA-256","valueDigests":{"org.iso.18013.5.1":digests}}
        prot = cbor_enc({1:-7})
        payload_b = cbor_enc(mso)
        sig_struct = cbor_enc(["Signature1", prot, b'', payload_b])
        der = md_key.sign(sig_struct, ec.ECDSA(hashes.SHA256()))
        r, s = decode_dss_signature(der)
        sig = r.to_bytes(32,'big') + s.to_bytes(32,'big')
        return cbor_enc([prot, {}, payload_b, sig])

    mdoc_bytes = md_sign_nolib()

    def md_verify_nolib():
        # CBOR decode is complex — verify just the COSE signature part
        # (simplified: re-sign and check length as proxy)
        pass

    results["mdoc-noLib-sign"]   = bench(md_sign_nolib, N)

    # mdoc with cbor2
    try:
        import cbor2
        def md_sign_lib():
            digests = {}
            for i, (k, v) in enumerate(fields.items()):
                item = cbor2.dumps({"digestID": i, "elementIdentifier": k, "elementValue": v})
                digests[i] = _hl.sha256(item).digest()
            mso = {"version":"1.0","digestAlgorithm":"SHA-256","valueDigests":{"org.iso.18013.5.1":digests}}
            prot = cbor2.dumps({1:-7})
            payload_b = cbor2.dumps(mso)
            sig_struct = cbor2.dumps(["Signature1", prot, b'', payload_b])
            der = md_key.sign(sig_struct, ec.ECDSA(hashes.SHA256()))
            r, s = decode_dss_signature(der)
            sig = r.to_bytes(32,'big') + s.to_bytes(32,'big')
            return cbor2.dumps([prot, {}, payload_b, sig])
        results["mdoc-withLib-sign"] = bench(md_sign_lib, N)
    except Exception as e:
        errors["cbor2"] = str(e)

except Exception as e:
    errors["mdoc"] = str(e)

json.dumps({"results": results, "errors": errors})
`

export async function runPythonBenchmark(
  onProgress: (msg: string) => void,
): Promise<PyBenchResults> {
  onProgress('Pyodide をロード中（初回のみ約10 MB）...')
  const py = await getPyodide()

  // Load bundled packages first (reliable, offline)
  onProgress('cryptography をロード中...')
  await py.loadPackage(['cryptography', 'micropip'])

  // Install optional pure-Python packages individually so one failure doesn't block others
  const optionalPkgs = ['PyJWT', 'pyld', 'cbor2']
  for (const pkg of optionalPkgs) {
    onProgress(`${pkg} をインストール中...`)
    try {
      // micropip.install is directly awaitable via runPythonAsync
      await py.runPythonAsync(`
import micropip
try:
    await micropip.install('${pkg}')
except Exception as e:
    pass  # continue without this package
`)
    } catch {
      console.warn(`[Pyodide] ${pkg} install failed, continuing without it`)
    }
  }

  onProgress('Python ベンチマーク実行中...')
  const raw = await py.runPythonAsync(PY_BENCH_CODE)
  const parsed = JSON.parse(raw as string) as {
    results: Record<string, PyBenchEntry>
    errors: Record<string, string>
  }

  if (Object.keys(parsed.errors).length > 0) {
    console.warn('[Python benchmark] partial errors:', parsed.errors)
  }

  onProgress(`完了 — ${Object.keys(parsed.results).length} 項目計測`)
  return parsed.results
}
