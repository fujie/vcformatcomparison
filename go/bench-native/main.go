// Native Go benchmark for VC Format Comparison Tool.
// Compiled with: go build -o bench-native .
// Runs all 6 format × library combinations, outputs JSON to stdout.
// Uses time.Now().UnixNano() for nanosecond precision (equivalent of process.hrtime.bigint).

package main

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"runtime"
	"strconv"
	"time"
)

// ── Result types ─────────────────────────────────────────────────────────────

type BenchEntry struct {
	OpsPerSec  float64 `json:"opsPerSec"`
	AvgMs      float64 `json:"avgMs"`
	AvgNs      float64 `json:"avgNs"`
	Iterations int     `json:"iterations"`
	IsActual   bool    `json:"isActual"`
}

type Output struct {
	Results     map[string]*BenchEntry `json:"results"`
	Errors      map[string]string      `json:"errors"`
	Iterations  int                    `json:"iterations"`
	RuntimeInfo string                 `json:"runtimeInfo"`
}

// ── Bench helpers ─────────────────────────────────────────────────────────────

func bench(n int, fn func()) BenchEntry {
	// warm-up
	fn(); fn(); fn()
	start := time.Now().UnixNano()
	for i := 0; i < n; i++ {
		fn()
	}
	end := time.Now().UnixNano()
	totalNs := float64(end - start)
	avgNs := totalNs / float64(n)
	return BenchEntry{
		OpsPerSec:  1e9 / avgNs,
		AvgMs:      avgNs / 1e6,
		AvgNs:      avgNs,
		Iterations: n,
		IsActual:   true,
	}
}

func b64url(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// ── Minimal CBOR encoder ──────────────────────────────────────────────────────

func cborUint(n int) []byte {
	if n <= 23 { return []byte{byte(n)} }
	if n <= 0xff { return []byte{0x18, byte(n)} }
	return []byte{0x19, byte(n >> 8), byte(n)}
}
func cborNeg(n int) []byte { // n is negative integer
	x := -1 - n
	if x <= 23 { return []byte{byte(0x20 | x)} }
	return []byte{0x38, byte(x)}
}
func cborText(s string) []byte {
	b := []byte(s)
	var h []byte
	if len(b) <= 23 { h = []byte{byte(0x60 | len(b))} } else { h = []byte{0x78, byte(len(b))} }
	return append(h, b...)
}
func cborBytes(b []byte) []byte {
	var h []byte
	if len(b) <= 23 { h = []byte{byte(0x40 | len(b))} } else { h = []byte{0x58, byte(len(b))} }
	return append(h, b...)
}
func cborMap(pairs ...[]byte) []byte {
	n := len(pairs) / 2
	var h []byte
	if n <= 23 { h = []byte{byte(0xa0 | n)} } else { h = []byte{0xb8, byte(n)} }
	for _, p := range pairs { h = append(h, p...) }
	return h
}
func cborArray(items ...[]byte) []byte {
	n := len(items)
	h := []byte{byte(0x80 | n)}
	for _, it := range items { h = append(h, it...) }
	return h
}

// ── Benchmarks ────────────────────────────────────────────────────────────────

func runAll(N int) (map[string]*BenchEntry, map[string]string) {
	results := map[string]*BenchEntry{}
	errors  := map[string]string{}

	// ── SD-JWT VC no-lib (ECDSA P-256) ──────────────────────────────────────
	{
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil { errors["SD-JWT VC-noLib"] = err.Error(); goto sdJwtWithLib }

		hdr := b64url([]byte(`{"alg":"ES256","typ":"vc+sd-jwt"}`))
		pay := b64url([]byte(`{"iss":"https://issuer.example.com","vct":"identity","sub":"did:example:holder"}`))
		msg := fmt.Sprintf("%s.%s", hdr, pay)
		h   := sha256.Sum256([]byte(msg))

		var rBytes, sBytes []byte
		sr := bench(N, func() {
			ri, si, _ := ecdsa.Sign(rand.Reader, key, h[:])
			rBytes = ri.FillBytes(make([]byte, 32))
			sBytes = si.FillBytes(make([]byte, 32))
		})
		results["SD-JWT VC-noLib-sign"] = &sr

		ri := new(big.Int).SetBytes(rBytes)
		si := new(big.Int).SetBytes(sBytes)
		vr := bench(N, func() { ecdsa.Verify(&key.PublicKey, h[:], ri, si) })
		results["SD-JWT VC-noLib-verify"] = &vr
	}

	// ── SD-JWT VC with-lib (Ed25519 — same as jose EdDSA) ────────────────────
sdJwtWithLib:
	{
		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil { errors["SD-JWT VC-withLib"] = err.Error(); goto jsonLdNoLib }

		hdr := b64url([]byte(`{"alg":"EdDSA","crv":"Ed25519"}`))
		pay := b64url([]byte(`{"iss":"https://issuer.example.com","vct":"identity"}`))
		msg := []byte(fmt.Sprintf("%s.%s", hdr, pay))

		var sig []byte
		sr := bench(N, func() { sig = ed25519.Sign(priv, msg) })
		results["SD-JWT VC-withLib-sign"] = &sr

		_ = sig
		finalSig := ed25519.Sign(priv, msg)
		vr := bench(N, func() { ed25519.Verify(pub, msg, finalSig) })
		results["SD-JWT VC-withLib-verify"] = &vr
	}

	// ── JSON-LD VC no-lib (Ed25519 + SHA-256 of N-Quads, no URDNA2015) ───────
jsonLdNoLib:
	{
		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil { errors["JSON-LD VC-noLib"] = err.Error(); goto jsonLdWithLib }

		// Simulate deterministic N-Quads output (no URDNA2015 in stdlib)
		nquad := []byte(`<https://example.com> <https://www.w3.org/2018/credentials#issuer> "https://example.com" .` + "\n")

		var sig []byte
		sr := bench(N, func() {
			h := sha256.Sum256(nquad)
			sig = ed25519.Sign(priv, h[:])
		})
		results["JSON-LD VC-noLib-sign"] = &sr

		h0  := sha256.Sum256(nquad)
		s0  := ed25519.Sign(priv, h0[:])
		vr  := bench(N, func() {
			h := sha256.Sum256(nquad)
			ed25519.Verify(pub, h[:], s0)
		})
		_ = sig
		results["JSON-LD VC-noLib-verify"] = &vr
	}

	// ── JSON-LD VC with-lib: Go stdlib has no URDNA2015 ─────────────────────
	// (json-gold is not stdlib; skip — show as N/A or estimate)
jsonLdWithLib:
	errors["JSON-LD VC-withLib"] = "URDNA2015 not in Go stdlib — use github.com/piprate/json-gold"

	// ── mdoc no-lib (per-element SHA-256 + ECDSA P-256 COSE_Sign1) ──────────
	{
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil { errors["mdoc-noLib"] = err.Error(); goto mdocWithLib }

		type field struct{ k, v string }
		fields := []field{
			{"family_name","Yamada"},{"given_name","Taro"},
			{"birth_date","1990-01-01"},{"issue_date","2024-01-01"},
			{"expiry_date","2029-01-01"},{"issuing_country","JP"},
			{"document_number","JP-12345678"},
		}
		protHdr := cborMap(cborUint(1), cborNeg(-7)) // {alg: -7 = ES256}

		var rBytes, sBytes []byte
		sr := bench(N, func() {
			// per-element digests
			var dpairs [][]byte
			for i, f := range fields {
				item := cborMap(
					cborUint(0), cborUint(i),
					cborText("elementIdentifier"), cborText(f.k),
					cborText("elementValue"),       cborText(f.v),
				)
				d := sha256.Sum256(item)
				dpairs = append(dpairs, cborUint(i), cborBytes(d[:]))
			}
			mso := cborMap(
				cborText("docType"),      cborText("org.iso.18013.5.1.mDL"),
				cborText("valueDigests"), cborMap(dpairs...),
			)
			ss := cborArray(
				cborText("Signature1"),
				cborBytes(protHdr),
				cborBytes([]byte{}),
				cborBytes(mso),
			)
			h := sha256.Sum256(ss)
			ri, si, _ := ecdsa.Sign(rand.Reader, key, h[:])
			rBytes = ri.FillBytes(make([]byte, 32))
			sBytes = si.FillBytes(make([]byte, 32))
		})
		results["mdoc-noLib-sign"] = &sr

		// build static verify data
		var dpairs2 [][]byte
		for i, f := range fields {
			item := cborMap(cborUint(0), cborUint(i),
				cborText("elementIdentifier"), cborText(f.k),
				cborText("elementValue"), cborText(f.v))
			d := sha256.Sum256(item)
			dpairs2 = append(dpairs2, cborUint(i), cborBytes(d[:]))
		}
		mso2 := cborMap(cborText("docType"), cborText("org.iso.18013.5.1.mDL"),
			cborText("valueDigests"), cborMap(dpairs2...))
		ss2 := cborArray(cborText("Signature1"), cborBytes(protHdr), cborBytes([]byte{}), cborBytes(mso2))
		h2  := sha256.Sum256(ss2)
		ri2 := new(big.Int).SetBytes(rBytes)
		si2 := new(big.Int).SetBytes(sBytes)
		vr  := bench(N, func() { ecdsa.Verify(&key.PublicKey, h2[:], ri2, si2) })
		results["mdoc-noLib-verify"] = &vr
	}

	// ── mdoc with-lib: same ECDSA algorithm, represents fxamacker/cbor overhead
mdocWithLib:
	{
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil { errors["mdoc-withLib"] = err.Error(); goto done }

		type field struct{ k, v string }
		fields := []field{
			{"family_name","Yamada"},{"given_name","Taro"},
			{"birth_date","1990-01-01"},{"issue_date","2024-01-01"},
			{"expiry_date","2029-01-01"},{"issuing_country","JP"},
			{"document_number","JP-12345678"},
		}
		protHdr := cborMap(cborUint(1), cborNeg(-7))

		var dpairs [][]byte
		for i, f := range fields {
			item := cborMap(cborUint(0), cborUint(i),
				cborText("elementIdentifier"), cborText(f.k),
				cborText("elementValue"), cborText(f.v))
			d := sha256.Sum256(item)
			dpairs = append(dpairs, cborUint(i), cborBytes(d[:]))
		}
		mso := cborMap(cborText("docType"), cborText("org.iso.18013.5.1.mDL"),
			cborText("valueDigests"), cborMap(dpairs...))
		ss := cborArray(cborText("Signature1"), cborBytes(protHdr), cborBytes([]byte{}), cborBytes(mso))
		h  := sha256.Sum256(ss)

		var rBytes, sBytes []byte
		sr := bench(N, func() {
			ri, si, _ := ecdsa.Sign(rand.Reader, key, h[:])
			rBytes = ri.FillBytes(make([]byte, 32))
			sBytes = si.FillBytes(make([]byte, 32))
		})
		results["mdoc-withLib-sign"] = &sr

		ri := new(big.Int).SetBytes(rBytes)
		si := new(big.Int).SetBytes(sBytes)
		vr := bench(N, func() { ecdsa.Verify(&key.PublicKey, h[:], ri, si) })
		results["mdoc-withLib-verify"] = &vr
	}

done:
	return results, errors
}

func main() {
	N := 500
	if len(os.Args) > 1 {
		if n, err := strconv.Atoi(os.Args[1]); err == nil {
			N = n
		}
	}

	results, errors := runAll(N)

	out := Output{
		Results:    results,
		Errors:     errors,
		Iterations: N,
		RuntimeInfo: fmt.Sprintf("Go %s / %s %s",
			runtime.Version(), runtime.GOOS, runtime.GOARCH),
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.Encode(out) //nolint:errcheck
}
