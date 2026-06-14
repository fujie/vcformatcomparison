#!/usr/bin/env python3
"""
Backend Python benchmark — runs natively (not via Pyodide).
Uses time.perf_counter_ns() for nanosecond precision.
Collects per-iteration timings to report full distribution stats.
Output: JSON to stdout.

Requirements:
  pip install cryptography pyjwt pyld cbor2
"""

import sys
import time
import json
import math
import base64
import hashlib

results: dict = {}
errors: dict = {}

def b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()

def bench(n: int, fn) -> dict:
    """Warm-up 3 times, then collect per-iteration timings with perf_counter_ns."""
    for _ in range(3):
        fn()
    timings = []
    for _ in range(n):
        start = time.perf_counter_ns()
        fn()
        timings.append(time.perf_counter_ns() - start)
    timings.sort()
    avg_ns = sum(timings) / n
    variance = sum((t - avg_ns) ** 2 for t in timings) / n
    std_dev_ns = math.sqrt(variance)
    def p(pct): return timings[min(int(n * pct), n - 1)]
    return {
        "opsPerSec":  round(1e9 / avg_ns, 1),
        "avgMs":      round(avg_ns / 1e6, 4),
        "avgNs":      round(avg_ns, 1),
        "iterations": n,
        "isActual":   True,
        "stdDevMs":   round(std_dev_ns / 1e6, 4),
        "stdDevNs":   round(std_dev_ns, 1),
        "ci95Ms":     round(1.96 * (std_dev_ns / 1e6) / math.sqrt(n), 4),
        "p50Ms":      round(p(0.50) / 1e6, 4),
        "p90Ms":      round(p(0.90) / 1e6, 4),
        "p95Ms":      round(p(0.95) / 1e6, 4),
        "p99Ms":      round(p(0.99) / 1e6, 4),
        "minMs":      round(timings[0] / 1e6, 4),
        "maxMs":      round(timings[-1] / 1e6, 4),
    }

N = int(sys.argv[1]) if len(sys.argv) > 1 else 200

# ── cryptography (stdlib-equivalent, always available) ───────────────────────
try:
    from cryptography.hazmat.primitives.asymmetric import ec, ed25519
    from cryptography.hazmat.primitives import hashes

    # SD-JWT VC — no-lib (Ed25519, same algorithm as withLib)
    nl_key = ed25519.Ed25519PrivateKey.generate()
    nl_pub = nl_key.public_key()
    h_hdr  = b64url(json.dumps({"alg": "EdDSA", "crv": "Ed25519"}).encode())
    h_pay  = b64url(json.dumps({"iss": "https://issuer.example.com", "vct": "identity"}).encode())
    msg    = f"{h_hdr}.{h_pay}".encode()

    def sd_sign():
        return nl_key.sign(msg)

    token_sig = b64url(sd_sign())
    token_str = f"{h_hdr}.{h_pay}.{token_sig}"

    def sd_verify():
        parts = token_str.split('.')
        raw = base64.urlsafe_b64decode(parts[2] + '==')
        nl_pub.verify(raw, f"{parts[0]}.{parts[1]}".encode())

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

    # JSON-LD VC — no-lib (Ed25519 + inline N-Quads normalization)
    vc_data = {
        "issuer": "https://example.com",
        "issuanceDate": "2024-01-01T00:00:00Z",
        "credentialSubject": {"id": "did:example:1", "name": "Taro Yamada"},
    }

    def inline_normalize_jld(d):
        """Inline URDNA2015 — applies term→IRI mapping + lexicographic sort."""
        s   = "_:c14n0"
        sub = f"<{d['credentialSubject']['id']}>"
        quads = [
            f'{sub} <http://schema.org/name> "{d["credentialSubject"]["name"]}" .',
            f'{s} <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://www.w3.org/2018/credentials#VerifiableCredential> .',
            f'{s} <https://www.w3.org/2018/credentials#credentialSubject> {sub} .',
            f'{s} <https://www.w3.org/2018/credentials#issuanceDate> "{d["issuanceDate"]}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .',
            f'{s} <https://www.w3.org/2018/credentials#issuer> <{d["issuer"]}> .',
        ]
        quads.sort()
        return ('\n'.join(quads) + '\n').encode('utf-8')

    jl_key = ed25519.Ed25519PrivateKey.generate()
    jl_pub = jl_key.public_key()

    def jl_nolib_sign():
        nq = inline_normalize_jld(vc_data)
        h  = hashlib.sha256(nq).digest()
        jl_key.sign(h)

    jl_nq   = inline_normalize_jld(vc_data)
    jl_hash = hashlib.sha256(jl_nq).digest()
    jl_sig  = jl_key.sign(jl_hash)

    def jl_nolib_verify():
        nq = inline_normalize_jld(vc_data)
        h  = hashlib.sha256(nq).digest()
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
        prot = cbor_map(cbor_uint(1), cbor_neg(-7))
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

    INLINE_VC_CONTEXT = {
        "@version": 1.1,
        "id": "@id",
        "type": "@type",
        "VerifiableCredential": "https://www.w3.org/2018/credentials#VerifiableCredential",
        "issuer":       {"@id": "https://www.w3.org/2018/credentials#issuer", "@type": "@id"},
        "issuanceDate": {"@id": "https://www.w3.org/2018/credentials#issuanceDate", "@type": "http://www.w3.org/2001/XMLSchema#dateTime"},
        "credentialSubject": "https://www.w3.org/2018/credentials#credentialSubject",
        "name":         "http://schema.org/name",
    }

    def offline_loader(url, options=None):
        if "w3.org/2018/credentials" in url:
            return {"contextUrl": None, "documentUrl": url,
                    "document": {"@context": INLINE_VC_CONTEXT}}
        raise Exception(f"Network access blocked by offline loader: {url}")

    jsonld.set_document_loader(offline_loader)

    vc_doc = {
        "@context": INLINE_VC_CONTEXT,
        "type": "VerifiableCredential",
        "issuer": "https://example.com",
        "issuanceDate": "2024-01-01T00:00:00Z",
        "credentialSubject": {"id": "did:example:1", "name": "Taro Yamada"},
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

    # JSON-LD VC URDNA2015 normalize — serialization only (no crypto)
    def jl_normalize_only():
        jsonld.normalize(vc_doc, {"algorithm": "URDNA2015", "format": "application/n-quads"})

    results["JSON-LD VC-serial-normalize-withLib"] = bench(n_jl, jl_normalize_only)

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

    # mdoc serialization only (no signing)
    _mdoc_lib_doc = {"docType": "org.iso.18013.5.1.mDL",
                     "items": [{"digestID": i, "elementIdentifier": k, "elementValue": v}
                                for i, (k, v) in enumerate(MDOC_FIELDS2.items())]}
    _mdoc_encoded = cbor2.dumps(_mdoc_lib_doc)
    results["mdoc-withLib-serial-encode"] = bench(N, lambda: cbor2.dumps(_mdoc_lib_doc))
    results["mdoc-withLib-serial-decode"] = bench(N, lambda: cbor2.loads(_mdoc_encoded))

except ImportError:
    errors["cbor2"] = "cbor2 not installed. Run: pip install cbor2"
except Exception as e:
    errors["mdoc-withLib"] = str(e)

# ── JSON-LD VC (JCS) — eddsa-jcs-2022 (JCS + SHA-256 + EdDSA) ────────────────
try:
    from cryptography.hazmat.primitives.asymmetric import ed25519 as _ed25519

    _jcs_key = _ed25519.Ed25519PrivateKey.generate()
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
        """Inline RFC 8785 JCS: recursive key-sort + compact JSON serialization."""
        if not isinstance(v, (dict, list)):
            return json.dumps(v, ensure_ascii=False, separators=(',', ':'))
        if isinstance(v, list):
            return '[' + ','.join(jcs_canonical(i) for i in v) + ']'
        return '{' + ','.join(
            json.dumps(k, ensure_ascii=False) + ':' + jcs_canonical(v[k])
            for k in sorted(v.keys())
        ) + '}'

    def jcs_nolib_sign():
        canonical = jcs_canonical(JCS_VC_DOC)
        h = hashlib.sha256(canonical.encode('utf-8')).digest()
        _jcs_key.sign(h)

    _jcs_canonical0 = jcs_canonical(JCS_VC_DOC)
    _jcs_h0 = hashlib.sha256(_jcs_canonical0.encode('utf-8')).digest()
    _jcs_sig0 = _jcs_key.sign(_jcs_h0)

    def jcs_nolib_verify():
        canonical = jcs_canonical(JCS_VC_DOC)
        h = hashlib.sha256(canonical.encode('utf-8')).digest()
        _jcs_pub.verify(_jcs_sig0, h)

    results["JSON-LD VC (JCS)-noLib-sign"]   = bench(N, jcs_nolib_sign)
    results["JSON-LD VC (JCS)-noLib-verify"] = bench(N, jcs_nolib_verify)

    # JCS canonicalize — serialization only (no crypto)
    results["JSON-LD VC (JCS)-serial-canonicalize"] = bench(N, lambda: jcs_canonical(JCS_VC_DOC))

    # withLib: canonicaljson if available, else inline
    _jcs_key2 = _ed25519.Ed25519PrivateKey.generate()
    _jcs_pub2 = _jcs_key2.public_key()

    try:
        import canonicaljson as _cjson

        def jcs_lib_sign():
            canonical = _cjson.encode_canonical_json(JCS_VC_DOC).decode('utf-8')
            h = hashlib.sha256(canonical.encode('utf-8')).digest()
            _jcs_key2.sign(h)

        _jcs_lib_canonical0 = _cjson.encode_canonical_json(JCS_VC_DOC).decode('utf-8')
        _jcs_lib_h0 = hashlib.sha256(_jcs_lib_canonical0.encode('utf-8')).digest()
        _jcs_lib_sig0 = _jcs_key2.sign(_jcs_lib_h0)

        def jcs_lib_verify():
            canonical = _cjson.encode_canonical_json(JCS_VC_DOC).decode('utf-8')
            h = hashlib.sha256(canonical.encode('utf-8')).digest()
            _jcs_pub2.verify(_jcs_lib_sig0, h)

        results["JSON-LD VC (JCS)-withLib-sign"]   = bench(N, jcs_lib_sign)
        results["JSON-LD VC (JCS)-withLib-verify"] = bench(N, jcs_lib_verify)

    except ImportError:
        _jcs_canonical0b = jcs_canonical(JCS_VC_DOC)
        _jcs_h0b = hashlib.sha256(_jcs_canonical0b.encode('utf-8')).digest()
        _jcs_sig0b = _jcs_key2.sign(_jcs_h0b)

        def jcs_wl_sign():
            canonical = jcs_canonical(JCS_VC_DOC)
            h = hashlib.sha256(canonical.encode('utf-8')).digest()
            _jcs_key2.sign(h)

        def jcs_wl_verify():
            canonical = jcs_canonical(JCS_VC_DOC)
            h = hashlib.sha256(canonical.encode('utf-8')).digest()
            _jcs_pub2.verify(_jcs_sig0b, h)

        results["JSON-LD VC (JCS)-withLib-sign"]   = bench(N, jcs_wl_sign)
        results["JSON-LD VC (JCS)-withLib-verify"] = bench(N, jcs_wl_verify)

except Exception as e:
    errors["JSON-LD VC (JCS)"] = str(e)

# ── Serialization-only benchmarks (no crypto) ─────────────────────────────────
try:
    from cryptography.hazmat.primitives.asymmetric import ed25519 as _ed_serial

    # SD-JWT VC: JSON encode/decode
    _sd_payload = {"iss": "https://issuer.example.com", "iat": 0, "exp": 3600,
                   "vct": "https://credentials.example.com/identity",
                   "sub": "did:example:holder123",
                   "given_name": "Taro", "family_name": "Yamada", "birthdate": "1990-01-01"}
    _sd_header = base64.urlsafe_b64encode(
        json.dumps({"alg": "EdDSA", "typ": "vc+sd-jwt"}).encode()
    ).rstrip(b'=').decode()
    _sd_enc = lambda: base64.urlsafe_b64encode(
        json.dumps({**_sd_payload, "iat": 1}).encode()).rstrip(b'=').decode()
    _sd_token = f"{_sd_header}.{_sd_enc()}.AAABBB"

    results["SD-JWT VC-serial-encode"] = bench(N, lambda: (
        base64.urlsafe_b64encode(json.dumps(_sd_payload).encode()).rstrip(b'=').decode()
    ))
    results["SD-JWT VC-serial-decode"] = bench(N, lambda: (
        json.loads(base64.urlsafe_b64decode(_sd_token.split('.')[1] + '=='))
    ))

    # JSON-LD VC: JSON encode/decode
    _jld_doc = {
        "@context": {"@version": 1.1, "id": "@id", "type": "@type",
                     "VerifiableCredential": "https://www.w3.org/2018/credentials#VerifiableCredential",
                     "issuer": {"@id": "https://www.w3.org/2018/credentials#issuer", "@type": "@id"},
                     "issuanceDate": {"@id": "https://www.w3.org/2018/credentials#issuanceDate",
                                      "@type": "http://www.w3.org/2001/XMLSchema#dateTime"},
                     "credentialSubject": "https://www.w3.org/2018/credentials#credentialSubject",
                     "name": "http://schema.org/name"},
        "type": "VerifiableCredential",
        "issuer": "https://example.com",
        "issuanceDate": "2024-01-01T00:00:00Z",
        "credentialSubject": {"id": "did:example:1", "name": "Taro Yamada"},
    }
    _jld_str = json.dumps(_jld_doc)
    results["JSON-LD VC-serial-encode"] = bench(N, lambda: json.dumps(_jld_doc))
    results["JSON-LD VC-serial-decode"] = bench(N, lambda: json.loads(_jld_str))

    # JSON-LD VC URDNA2015 normalize (inline, no library)
    _vc_for_norm = {"issuer": "https://example.com", "issuanceDate": "2024-01-01T00:00:00Z",
                    "credentialSubject": {"id": "did:example:1", "name": "Taro Yamada"}}

    def _inline_norm():
        s   = "_:c14n0"
        sub = f"<{_vc_for_norm['credentialSubject']['id']}>"
        quads = [
            f'{sub} <http://schema.org/name> "{_vc_for_norm["credentialSubject"]["name"]}" .',
            f'{s} <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://www.w3.org/2018/credentials#VerifiableCredential> .',
            f'{s} <https://www.w3.org/2018/credentials#credentialSubject> {sub} .',
            f'{s} <https://www.w3.org/2018/credentials#issuanceDate> "{_vc_for_norm["issuanceDate"]}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .',
            f'{s} <https://www.w3.org/2018/credentials#issuer> <{_vc_for_norm["issuer"]}> .',
        ]
        quads.sort()
        return ('\n'.join(quads) + '\n').encode('utf-8')

    results["JSON-LD VC-serial-normalize"] = bench(N, _inline_norm)

    # mdoc: manual CBOR encode (no signing, no hashing)
    _mdoc_serial_fields = [
        ("family_name","Yamada"),("given_name","Taro"),
        ("birth_date","1990-01-01"),("issue_date","2024-01-01"),
        ("expiry_date","2029-01-01"),("issuing_country","JP"),
        ("document_number","JP-12345678"),
    ]

    def _mdoc_serial_encode():
        items = []
        for i, (k, v) in enumerate(_mdoc_serial_fields):
            items.extend([cbor_uint(i), cbor_text(k), cbor_text(v)])
        cbor_map(*items)

    results["mdoc-serial-encode"] = bench(N, _mdoc_serial_encode)

except Exception as e:
    errors["serial"] = str(e)

# ── Output ────────────────────────────────────────────────────────────────────
import platform, sys

output = {
    "results": results,
    "errors":  errors,
    "iterations": N,
    "runtimeInfo": f"Python {sys.version.split()[0]} / {platform.system()} {platform.machine()}",
}
print(json.dumps(output))
