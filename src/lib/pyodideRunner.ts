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
import time, json, base64, hashlib
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric import ed25519 as ed_lib
from cryptography.hazmat.primitives import hashes

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

# ── SD-JWT VC — noLib (Ed25519, same algorithm as withLib) ──────────────────
nl_key = ed_lib.Ed25519PrivateKey.generate()
nl_pub = nl_key.public_key()
h_hdr  = b64url(json.dumps({"alg": "EdDSA", "crv": "Ed25519"}).encode())
h_pay  = b64url(json.dumps({"iss": "https://issuer.example.com", "vct": "identity"}).encode())
msg    = f"{h_hdr}.{h_pay}".encode()

def sd_sign_nolib(): return nl_key.sign(msg)
token_sig = b64url(sd_sign_nolib())
token_str = f"{h_hdr}.{h_pay}.{token_sig}"

def sd_verify_nolib():
    parts = token_str.split('.')
    raw = base64.urlsafe_b64decode(parts[2] + '==')
    nl_pub.verify(raw, f"{parts[0]}.{parts[1]}".encode())

results["SD-JWT VC-noLib-sign"]   = bench(sd_sign_nolib, N)
results["SD-JWT VC-noLib-verify"] = bench(sd_verify_nolib, N)

# ── SD-JWT VC — withLib (Ed25519, equivalent of jose's EdDSA) ───────────────
ed_key = ed_lib.Ed25519PrivateKey.generate()
ed_pub = ed_key.public_key()
h_hdr2 = b64url(json.dumps({"alg": "EdDSA", "crv": "Ed25519"}).encode())
h_pay2 = b64url(json.dumps({"iss": "https://issuer.example.com", "vct": "identity"}).encode())
msg2   = f"{h_hdr2}.{h_pay2}".encode()

def ed_sign(): return ed_key.sign(msg2)
ed_sig = ed_sign()
def ed_verify(): ed_pub.verify(ed_sig, msg2)

results["SD-JWT VC-withLib-sign"]   = bench(ed_sign, N)
results["SD-JWT VC-withLib-verify"] = bench(ed_verify, N)

# ── mdoc — noLib (manual CBOR + ECDSA P-256) ─────────────────────────────────
md_key = ec.generate_private_key(ec.SECP256R1())
md_pub = md_key.public_key()

MDOC_FIELDS = [
    ("family_name","Yamada"), ("given_name","Taro"),
    ("birth_date","1990-01-01"), ("issue_date","2024-01-01"),
    ("expiry_date","2029-01-01"), ("issuing_country","JP"),
    ("document_number","JP-12345678"),
]

def cbor_uint(n):
    if n <= 23: return bytes([n])
    if n <= 0xff: return bytes([0x18, n])
    return bytes([0x19, (n >> 8) & 0xff, n & 0xff])

def cbor_neg(n):
    x = -1 - n
    return bytes([0x20 | x]) if x <= 23 else bytes([0x38, x])

def cbor_text(s):
    b = s.encode()
    if len(b) <= 23:    h = bytes([0x60 | len(b)])
    elif len(b) <= 0xff: h = bytes([0x78, len(b)])
    else:                h = bytes([0x79, (len(b) >> 8) & 0xff, len(b) & 0xff])
    return h + b

def cbor_byt(b):
    if len(b) <= 23:    h = bytes([0x40 | len(b)])
    elif len(b) <= 0xff: h = bytes([0x58, len(b)])
    else:                h = bytes([0x59, (len(b) >> 8) & 0xff, len(b) & 0xff])
    return h + b

def cbor_map(*pairs):
    n = len(pairs) // 2
    if n <= 23:    h = bytes([0xa0 | n])
    elif n <= 0xff: h = bytes([0xb8, n])
    else:           h = bytes([0xb9, (n >> 8) & 0xff, n & 0xff])
    return h + b''.join(pairs)

def cbor_arr(*items):
    n = len(items)
    h = bytes([0x80 | n]) if n <= 23 else bytes([0x98, n])
    return h + b''.join(items)

def mdoc_nolib_sign():
    dp = []
    for i, (k, v) in enumerate(MDOC_FIELDS):
        item = cbor_map(cbor_uint(0), cbor_uint(i), cbor_text("elementIdentifier"), cbor_text(k), cbor_text("elementValue"), cbor_text(v))
        dp.extend([cbor_uint(i), cbor_byt(hashlib.sha256(item).digest())])
    mso = cbor_map(cbor_text("docType"), cbor_text("org.iso.18013.5.1.mDL"), cbor_text("valueDigests"), cbor_map(*dp))
    prot = cbor_map(cbor_uint(1), cbor_neg(-7))
    ss = cbor_arr(cbor_text("Signature1"), cbor_byt(prot), cbor_byt(b''), cbor_byt(mso))
    md_key.sign(ss, ec.ECDSA(hashes.SHA256()))

# pre-build static verify data outside bench loop (same approach as speed.py)
_dp = []
for _i, (_k, _v) in enumerate(MDOC_FIELDS):
    _item = cbor_map(cbor_uint(0), cbor_uint(_i), cbor_text("elementIdentifier"), cbor_text(_k), cbor_text("elementValue"), cbor_text(_v))
    _dp.extend([cbor_uint(_i), cbor_byt(hashlib.sha256(_item).digest())])
_mso = cbor_map(cbor_text("docType"), cbor_text("org.iso.18013.5.1.mDL"), cbor_text("valueDigests"), cbor_map(*_dp))
_prot = cbor_map(cbor_uint(1), cbor_neg(-7))
_ss = cbor_arr(cbor_text("Signature1"), cbor_byt(_prot), cbor_byt(b''), cbor_byt(_mso))
_der = md_key.sign(_ss, ec.ECDSA(hashes.SHA256()))

def mdoc_nolib_verify():
    md_pub.verify(_der, _ss, ec.ECDSA(hashes.SHA256()))

results["mdoc-noLib-sign"]   = bench(mdoc_nolib_sign, N)
results["mdoc-noLib-verify"] = bench(mdoc_nolib_verify, N)

# ── JSON-LD VC — withLib (pyld URDNA2015) ─────────────────────────────────────
try:
    from pyld import jsonld

    INLINE_VC_CONTEXT = {
        "@version": 1.1, "id": "@id", "type": "@type",
        "VerifiableCredential": "https://www.w3.org/2018/credentials#VerifiableCredential",
        "issuer":       {"@id": "https://www.w3.org/2018/credentials#issuer", "@type": "@id"},
        "issuanceDate": {"@id": "https://www.w3.org/2018/credentials#issuanceDate", "@type": "http://www.w3.org/2001/XMLSchema#dateTime"},
        "credentialSubject": "https://www.w3.org/2018/credentials#credentialSubject",
        "name":         "http://schema.org/name",
    }

    def offline_loader(url, options=None):
        if "w3.org/2018/credentials" in url:
            return {"contextUrl": None, "documentUrl": url, "document": {"@context": INLINE_VC_CONTEXT}}
        raise Exception(f"blocked: {url}")

    jsonld.set_document_loader(offline_loader)

    jl2_key = ed_lib.Ed25519PrivateKey.generate()
    jl2_pub = jl2_key.public_key()

    vc_doc2 = {
        "@context": INLINE_VC_CONTEXT,
        "type": "VerifiableCredential",
        "issuer": "https://example.com",
        "issuanceDate": "2024-01-01T00:00:00Z",
        "credentialSubject": {"id": "did:example:1", "name": "Taro Yamada"},
    }

    n_jl = max(N // 5, 10)

    def jl_withlib_sign():
        norm = jsonld.normalize(vc_doc2, {"algorithm": "URDNA2015", "format": "application/n-quads"})
        h = hashlib.sha256(norm.encode()).digest()
        jl2_key.sign(h)

    _norm0 = jsonld.normalize(vc_doc2, {"algorithm": "URDNA2015", "format": "application/n-quads"})
    _h0 = hashlib.sha256(_norm0.encode()).digest()
    _sig0 = jl2_key.sign(_h0)

    def jl_withlib_verify():
        norm = jsonld.normalize(vc_doc2, {"algorithm": "URDNA2015", "format": "application/n-quads"})
        h = hashlib.sha256(norm.encode()).digest()
        jl2_pub.verify(_sig0, h)

    results["JSON-LD VC-withLib-sign"]   = bench(jl_withlib_sign, n_jl)
    results["JSON-LD VC-withLib-verify"] = bench(jl_withlib_verify, n_jl)
except ImportError:
    errors["pyld"] = "pyld not available"
except Exception as e:
    errors["JSON-LD VC-withLib"] = str(e)

# ── mdoc — withLib (cbor2 + ECDSA P-256) ──────────────────────────────────────
try:
    import cbor2
    cbor_key = ec.generate_private_key(ec.SECP256R1())
    cbor_pub = cbor_key.public_key()

    MDOC_FIELDS2 = {
        "family_name": "Yamada", "given_name": "Taro",
        "birth_date": "1990-01-01", "issue_date": "2024-01-01",
        "expiry_date": "2029-01-01", "issuing_country": "JP",
        "document_number": "JP-12345678",
    }

    def mdoc_lib_sign():
        dm = {}
        for i, (k, v) in enumerate(MDOC_FIELDS2.items()):
            item = cbor2.dumps({"digestID": i, "elementIdentifier": k, "elementValue": v})
            dm[i] = hashlib.sha256(item).digest()
        prot = cbor2.dumps({1: -7})
        mso  = cbor2.dumps({"docType": "org.iso.18013.5.1.mDL", "valueDigests": dm})
        ss   = cbor2.dumps(["Signature1", prot, b'', mso])
        cbor_key.sign(ss, ec.ECDSA(hashes.SHA256()))

    _dm2 = {}
    for _i2, (_k2, _v2) in enumerate(MDOC_FIELDS2.items()):
        _it2 = cbor2.dumps({"digestID": _i2, "elementIdentifier": _k2, "elementValue": _v2})
        _dm2[_i2] = hashlib.sha256(_it2).digest()
    _prot2 = cbor2.dumps({1: -7})
    _mso2  = cbor2.dumps({"docType": "org.iso.18013.5.1.mDL", "valueDigests": _dm2})
    _ss2   = cbor2.dumps(["Signature1", _prot2, b'', _mso2])
    _der2  = cbor_key.sign(_ss2, ec.ECDSA(hashes.SHA256()))

    def mdoc_lib_verify():
        cbor_pub.verify(_der2, _ss2, ec.ECDSA(hashes.SHA256()))

    results["mdoc-withLib-sign"]   = bench(mdoc_lib_sign, N)
    results["mdoc-withLib-verify"] = bench(mdoc_lib_verify, N)
except ImportError:
    errors["cbor2"] = "cbor2 not available"
except Exception as e:
    errors["mdoc-withLib"] = str(e)


# ── JSON-LD VC (JCS) — eddsa-jcs-2022 (RFC 8785 + SHA-256 + EdDSA) ──────────
try:
    _jcs_key = ed_lib.Ed25519PrivateKey.generate()
    _jcs_pub = _jcs_key.public_key()

    JCS_VC_DOC = {
        "@context": {
            "@version": 1.1, "id": "@id", "type": "@type",
            "VerifiableCredential": "https://www.w3.org/2018/credentials#VerifiableCredential",
            "issuer": {"@id": "https://www.w3.org/2018/credentials#issuer", "@type": "@id"},
            "issuanceDate": {"@id": "https://www.w3.org/2018/credentials#issuanceDate", "@type": "http://www.w3.org/2001/XMLSchema#dateTime"},
            "credentialSubject": "https://www.w3.org/2018/credentials#credentialSubject",
            "name": "http://schema.org/name",
        },
        "type": "VerifiableCredential",
        "issuer": "https://example.com",
        "issuanceDate": "2024-01-01T00:00:00Z",
        "credentialSubject": {"id": "did:example:1", "name": "Taro Yamada"},
    }

    def jcs_canonical(v):
        if not isinstance(v, (dict, list)):
            return json.dumps(v, ensure_ascii=False, separators=(',', ':'))
        if isinstance(v, list):
            return '[' + ','.join(jcs_canonical(i) for i in v) + ']'
        return '{' + ','.join(
            json.dumps(k, ensure_ascii=False) + ':' + jcs_canonical(v[k])
            for k in sorted(v.keys())
        ) + '}'

    _jcs_canon0 = jcs_canonical(JCS_VC_DOC)
    _jcs_h0 = hashlib.sha256(_jcs_canon0.encode('utf-8')).digest()
    _jcs_sig0 = _jcs_key.sign(_jcs_h0)

    def jcs_nolib_sign():
        c = jcs_canonical(JCS_VC_DOC)
        h = hashlib.sha256(c.encode('utf-8')).digest()
        _jcs_key.sign(h)

    def jcs_nolib_verify():
        c = jcs_canonical(JCS_VC_DOC)
        h = hashlib.sha256(c.encode('utf-8')).digest()
        _jcs_pub.verify(_jcs_sig0, h)

    results["JSON-LD VC (JCS)-noLib-sign"]   = bench(jcs_nolib_sign, N)
    results["JSON-LD VC (JCS)-noLib-verify"] = bench(jcs_nolib_verify, N)
    results["JSON-LD VC (JCS)-withLib-sign"]  = bench(jcs_nolib_sign, N)
    results["JSON-LD VC (JCS)-withLib-verify"] = bench(jcs_nolib_verify, N)

except Exception as e:
    errors["JSON-LD VC (JCS)"] = str(e)

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
