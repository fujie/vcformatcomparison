#!/usr/bin/env python3
"""
Backend Python benchmark — runs natively (not via Pyodide).
Uses process.hrtime equivalent: time.perf_counter_ns() for nanosecond precision.
Output: JSON to stdout.

Requirements:
  pip install cryptography pyjwt pyld cbor2
"""

import sys
import time
import json
import base64
import hashlib

results: dict = {}
errors: dict = {}

def b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()

def bench(n: int, fn) -> dict:
    """Warm-up 3 times, then measure n iterations with perf_counter_ns."""
    for _ in range(3):
        fn()
    start = time.perf_counter_ns()
    for _ in range(n):
        fn()
    end = time.perf_counter_ns()
    total_ns = end - start
    avg_ns = total_ns / n
    avg_ms = avg_ns / 1_000_000
    ops_per_sec = 1_000_000_000 / avg_ns
    return {
        "opsPerSec": round(ops_per_sec, 1),
        "avgMs":     round(avg_ms, 4),
        "avgNs":     round(avg_ns, 1),
        "iterations": n,
        "isActual": True,
    }

N = int(sys.argv[1]) if len(sys.argv) > 1 else 200

# ── cryptography (stdlib-equivalent, always available) ───────────────────────
try:
    from cryptography.hazmat.primitives.asymmetric import ec, ed25519
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric.utils import (
        decode_dss_signature, encode_dss_signature
    )

    # SD-JWT VC — no-lib (ECDSA P-256)
    ec_key  = ec.generate_private_key(ec.SECP256R1())
    ec_pub  = ec_key.public_key()
    h_hdr   = b64url(json.dumps({"alg": "ES256", "typ": "vc+sd-jwt"}).encode())
    h_pay   = b64url(json.dumps({"iss": "https://issuer.example.com", "vct": "identity"}).encode())
    msg     = f"{h_hdr}.{h_pay}".encode()

    def sd_sign():
        der = ec_key.sign(msg, ec.ECDSA(hashes.SHA256()))
        r, s = decode_dss_signature(der)
        return b64url(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))

    token_sig = sd_sign()
    token_str = f"{h_hdr}.{h_pay}.{token_sig}"

    def sd_verify():
        parts = token_str.split('.')
        raw = base64.urlsafe_b64decode(parts[2] + '==')
        r, s = int.from_bytes(raw[:32], 'big'), int.from_bytes(raw[32:], 'big')
        ec_pub.verify(encode_dss_signature(r, s), f"{parts[0]}.{parts[1]}".encode(),
                      ec.ECDSA(hashes.SHA256()))

    results["SD-JWT VC-noLib-sign"]   = bench(N, sd_sign)
    results["SD-JWT VC-noLib-verify"] = bench(N, sd_verify)

    # SD-JWT VC — with-lib (Ed25519 — equivalent of jose's EdDSA)
    ed_key = ed25519.Ed25519PrivateKey.generate()
    ed_pub = ed_key.public_key()
    h_hdr2 = b64url(json.dumps({"alg": "EdDSA", "crv": "Ed25519"}).encode())
    h_pay2 = b64url(json.dumps({"iss": "https://issuer.example.com", "vct": "identity"}).encode())
    msg2   = f"{h_hdr2}.{h_pay2}".encode()

    def ed_sign():
        return ed_key.sign(msg2)

    ed_sig = ed_sign()

    def ed_verify():
        ed_pub.verify(ed_sig, msg2)

    results["SD-JWT VC-withLib-sign"]   = bench(N, ed_sign)
    results["SD-JWT VC-withLib-verify"] = bench(N, ed_verify)

    # JSON-LD VC — no-lib (Ed25519 + manual SHA-256 of N-Quads string)
    nquad  = b'<https://example.com> <https://www.w3.org/2018/credentials#issuer> "https://example.com" .\n'
    jl_key = ed25519.Ed25519PrivateKey.generate()
    jl_pub = jl_key.public_key()

    def jl_nolib_sign():
        h = hashlib.sha256(nquad).digest()
        jl_key.sign(h)

    jl_hash = hashlib.sha256(nquad).digest()
    jl_sig  = jl_key.sign(jl_hash)

    def jl_nolib_verify():
        h = hashlib.sha256(nquad).digest()
        jl_pub.verify(jl_sig, h)

    results["JSON-LD VC-noLib-sign"]   = bench(N, jl_nolib_sign)
    results["JSON-LD VC-noLib-verify"] = bench(N, jl_nolib_verify)

    # mdoc — no-lib (manual CBOR + ECDSA P-256)
    mdoc_key = ec.generate_private_key(ec.SECP256R1())
    mdoc_pub = mdoc_key.public_key()

    MDOC_FIELDS = [
        ("family_name", "Yamada"), ("given_name", "Taro"),
        ("birth_date",  "1990-01-01"), ("issue_date", "2024-01-01"),
        ("expiry_date", "2029-01-01"), ("issuing_country", "JP"),
        ("document_number", "JP-12345678"),
    ]

    def cbor_uint(n: int) -> bytes:
        if n <= 23: return bytes([n])
        if n <= 0xff: return bytes([0x18, n])
        return bytes([0x19, (n >> 8) & 0xff, n & 0xff])

    def cbor_neg(n: int) -> bytes:
        x = -1 - n
        return bytes([0x20 | x]) if x <= 23 else bytes([0x38, x])

    def cbor_text(s: str) -> bytes:
        b = s.encode()
        if len(b) <= 23:    h = bytes([0x60 | len(b)])
        elif len(b) <= 0xff: h = bytes([0x78, len(b)])
        else:                h = bytes([0x79, (len(b) >> 8) & 0xff, len(b) & 0xff])
        return h + b

    def cbor_bytes(b: bytes) -> bytes:
        if len(b) <= 23:    h = bytes([0x40 | len(b)])
        elif len(b) <= 0xff: h = bytes([0x58, len(b)])
        else:                h = bytes([0x59, (len(b) >> 8) & 0xff, len(b) & 0xff])
        return h + b

    def cbor_map(*pairs) -> bytes:
        n = len(pairs) // 2
        if n <= 23:    h = bytes([0xa0 | n])
        elif n <= 0xff: h = bytes([0xb8, n])
        else:           h = bytes([0xb9, (n >> 8) & 0xff, n & 0xff])
        return h + b''.join(pairs)

    def cbor_array(*items) -> bytes:
        n = len(items)
        h = bytes([0x80 | n]) if n <= 23 else bytes([0x98, n])
        return h + b''.join(items)

    def mdoc_nolib_sign():
        digest_pairs = []
        for i, (k, v) in enumerate(MDOC_FIELDS):
            item = cbor_map(
                cbor_uint(0), cbor_uint(i),
                cbor_text("elementIdentifier"), cbor_text(k),
                cbor_text("elementValue"),       cbor_text(v),
            )
            d = hashlib.sha256(item).digest()
            digest_pairs.extend([cbor_uint(i), cbor_bytes(d)])
        mso = cbor_map(
            cbor_text("docType"), cbor_text("org.iso.18013.5.1.mDL"),
            cbor_text("valueDigests"), cbor_map(*digest_pairs),
        )
        prot = cbor_map(cbor_uint(1), cbor_neg(-7))  # {alg: ES256}
        sig_struct = cbor_array(
            cbor_text("Signature1"),
            cbor_bytes(prot),
            cbor_bytes(b''),
            cbor_bytes(mso),
        )
        mdoc_key.sign(sig_struct, ec.ECDSA(hashes.SHA256()))

    # build static data for verify
    _dp = []
    for i, (k, v) in enumerate(MDOC_FIELDS):
        _item = cbor_map(cbor_uint(0), cbor_uint(i),
                         cbor_text("elementIdentifier"), cbor_text(k),
                         cbor_text("elementValue"), cbor_text(v))
        _dp.extend([cbor_uint(i), cbor_bytes(hashlib.sha256(_item).digest())])
    _mso = cbor_map(cbor_text("docType"), cbor_text("org.iso.18013.5.1.mDL"),
                    cbor_text("valueDigests"), cbor_map(*_dp))
    _prot = cbor_map(cbor_uint(1), cbor_neg(-7))
    _sig_struct = cbor_array(cbor_text("Signature1"), cbor_bytes(_prot),
                              cbor_bytes(b''), cbor_bytes(_mso))
    _mdoc_der = mdoc_key.sign(_sig_struct, ec.ECDSA(hashes.SHA256()))

    def mdoc_nolib_verify():
        mdoc_pub.verify(_mdoc_der, _sig_struct, ec.ECDSA(hashes.SHA256()))

    results["mdoc-noLib-sign"]   = bench(N, mdoc_nolib_sign)
    results["mdoc-noLib-verify"] = bench(N, mdoc_nolib_verify)

except Exception as e:
    errors["cryptography"] = str(e)

# ── JSON-LD VC — with-lib (pyld) ──────────────────────────────────────────────
try:
    from pyld import jsonld
    from cryptography.hazmat.primitives.asymmetric import ed25519

    jl2_key = ed25519.Ed25519PrivateKey.generate()
    vc_doc = {
        "@context": ["https://www.w3.org/2018/credentials/v1"],
        "type": "VerifiableCredential",
        "issuer": "https://example.com",
        "credentialSubject": {"id": "did:example:1"},
    }

    def jl_sign():
        norm = jsonld.normalize(vc_doc, {
            "algorithm": "URDNA2015",
            "format": "application/n-quads",
        })
        h = hashlib.sha256(norm.encode()).digest()
        jl2_key.sign(h)

    n_jl = max(N // 5, 20)
    results["JSON-LD VC-withLib-sign"] = bench(n_jl, jl_sign)

    # verify
    _norm0 = jsonld.normalize(vc_doc, {"algorithm": "URDNA2015", "format": "application/n-quads"})
    _h0    = hashlib.sha256(_norm0.encode()).digest()
    _sig0  = jl2_key.sign(_h0)
    jl2_pub = jl2_key.public_key()

    def jl_verify():
        norm = jsonld.normalize(vc_doc, {
            "algorithm": "URDNA2015",
            "format": "application/n-quads",
        })
        h = hashlib.sha256(norm.encode()).digest()
        jl2_pub.verify(_sig0, h)

    results["JSON-LD VC-withLib-verify"] = bench(n_jl, jl_verify)

except ImportError:
    errors["pyld"] = "pyld not installed. Run: pip install pyld"
except Exception as e:
    errors["JSON-LD VC-withLib"] = str(e)

# ── mdoc — with-lib (cbor2) ───────────────────────────────────────────────────
try:
    import cbor2
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import hashes

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
    for i2, (k2, v2) in enumerate(MDOC_FIELDS2.items()):
        _it2 = cbor2.dumps({"digestID": i2, "elementIdentifier": k2, "elementValue": v2})
        _dm2[i2] = hashlib.sha256(_it2).digest()
    _prot2 = cbor2.dumps({1: -7})
    _mso2  = cbor2.dumps({"docType": "org.iso.18013.5.1.mDL", "valueDigests": _dm2})
    _ss2   = cbor2.dumps(["Signature1", _prot2, b'', _mso2])
    _der2  = cbor_key.sign(_ss2, ec.ECDSA(hashes.SHA256()))

    def mdoc_lib_verify():
        cbor_pub.verify(_der2, _ss2, ec.ECDSA(hashes.SHA256()))

    results["mdoc-withLib-sign"]   = bench(N, mdoc_lib_sign)
    results["mdoc-withLib-verify"] = bench(N, mdoc_lib_verify)

except ImportError:
    errors["cbor2"] = "cbor2 not installed. Run: pip install cbor2"
except Exception as e:
    errors["mdoc-withLib"] = str(e)

# ── Output ────────────────────────────────────────────────────────────────────
import platform, sys

output = {
    "results": results,
    "errors":  errors,
    "iterations": N,
    "runtimeInfo": f"Python {sys.version.split()[0]} / {platform.system()} {platform.machine()}",
}
print(json.dumps(output))
