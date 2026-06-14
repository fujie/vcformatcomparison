// Native Go benchmark for VC Format Comparison Tool.
// Compiled with: go build -o bench-native .
// Runs all format × library combinations plus serialization-only benchmarks.
// Collects per-iteration timings and reports full distribution stats.
// Output: JSON to stdout.

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
	"math"
	"math/big"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	cborlib "github.com/fxamacker/cbor/v2"
	jsonld  "github.com/piprate/json-gold/ld"
)

// ── Result types ─────────────────────────────────────────────────────────────

type BenchEntry struct {
	OpsPerSec  float64 `json:"opsPerSec"`
	AvgMs      float64 `json:"avgMs"`
	AvgNs      float64 `json:"avgNs"`
	Iterations int     `json:"iterations"`
	IsActual   bool    `json:"isActual"`
	// Statistical distribution
	StdDevMs float64 `json:"stdDevMs"`
	StdDevNs float64 `json:"stdDevNs"`
	Ci95Ms   float64 `json:"ci95Ms"`
	P50Ms    float64 `json:"p50Ms"`
	P90Ms    float64 `json:"p90Ms"`
	P95Ms    float64 `json:"p95Ms"`
	P99Ms    float64 `json:"p99Ms"`
	MinMs    float64 `json:"minMs"`
	MaxMs    float64 `json:"maxMs"`
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
	timings := make([]float64, n)
	for i := 0; i < n; i++ {
		start := time.Now().UnixNano()
		fn()
		timings[i] = float64(time.Now().UnixNano() - start)
	}
	return computeStats(n, timings)
}

func computeStats(n int, timings []float64) BenchEntry {
	sort.Float64s(timings)
	totalNs := 0.0
	for _, t := range timings { totalNs += t }
	avgNs := totalNs / float64(n)

	variance := 0.0
	for _, t := range timings { variance += (t - avgNs) * (t - avgNs) }
	variance /= float64(n)
	stdDevNs := math.Sqrt(variance)

	pct := func(p float64) float64 {
		idx := int(float64(n) * p)
		if idx >= n { idx = n - 1 }
		return timings[idx] / 1e6
	}

	return BenchEntry{
		OpsPerSec:  1e9 / avgNs,
		AvgMs:      avgNs / 1e6,
		AvgNs:      avgNs,
		Iterations: n,
		IsActual:   true,
		StdDevNs:   stdDevNs,
		StdDevMs:   stdDevNs / 1e6,
		Ci95Ms:     1.96 * (stdDevNs / 1e6) / math.Sqrt(float64(n)),
		P50Ms:      pct(0.50),
		P90Ms:      pct(0.90),
		P95Ms:      pct(0.95),
		P99Ms:      pct(0.99),
		MinMs:      timings[0] / 1e6,
		MaxMs:      timings[n-1] / 1e6,
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

// ── Inline URDNA2015 normalization (no-lib, blank-node-free) ──────────────────

func inlineNormalizeUrdna2015(issuer, issuanceDate, subjID, name string) []byte {
	s   := "_:c14n0"
	sub := "<" + subjID + ">"
	quads := []string{
		sub + ` <http://schema.org/name> "` + name + `" .`,
		s + ` <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://www.w3.org/2018/credentials#VerifiableCredential> .`,
		s + ` <https://www.w3.org/2018/credentials#credentialSubject> ` + sub + ` .`,
		s + ` <https://www.w3.org/2018/credentials#issuanceDate> "` + issuanceDate + `"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`,
		s + ` <https://www.w3.org/2018/credentials#issuer> <` + issuer + `> .`,
	}
	sort.Strings(quads)
	return []byte(strings.Join(quads, "\n") + "\n")
}

// ── Inline RFC 8785 JCS ───────────────────────────────────────────────────────

var jcsCanon func(interface{}) (string, error)

func init() {
	jcsCanon = func(v interface{}) (string, error) {
		if v == nil { return "null", nil }
		switch val := v.(type) {
		case bool:
			if val { return "true", nil }
			return "false", nil
		case float64:
			b, _ := json.Marshal(val)
			return string(b), nil
		case string:
			b, _ := json.Marshal(val)
			return string(b), nil
		case []interface{}:
			parts := make([]string, len(val))
			for i, item := range val {
				s, e := jcsCanon(item)
				if e != nil { return "", e }
				parts[i] = s
			}
			return "[" + strings.Join(parts, ",") + "]", nil
		case map[string]interface{}:
			keys := make([]string, 0, len(val))
			for k := range val { keys = append(keys, k) }
			sort.Strings(keys)
			pairs := make([]string, len(keys))
			for i, k := range keys {
				kJSON, _ := json.Marshal(k)
				vJSON, e := jcsCanon(val[k])
				if e != nil { return "", e }
				pairs[i] = string(kJSON) + ":" + vJSON
			}
			return "{" + strings.Join(pairs, ",") + "}", nil
		}
		return "", fmt.Errorf("unsupported type %T", v)
	}
}

// ── Benchmarks ────────────────────────────────────────────────────────────────

func runAll(N int) (map[string]*BenchEntry, map[string]string) {
	results := map[string]*BenchEntry{}
	errors  := map[string]string{}

	// ── SD-JWT VC no-lib ─────────────────────────────────────────────────────
	{
		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil { errors["SD-JWT VC-noLib"] = err.Error(); goto sdJwtWithLib }

		hdr := b64url([]byte(`{"alg":"EdDSA","crv":"Ed25519"}`))
		pay := b64url([]byte(`{"iss":"https://issuer.example.com","vct":"identity","sub":"did:example:holder"}`))
		msg := []byte(fmt.Sprintf("%s.%s", hdr, pay))

		var sig []byte
		sr := bench(N, func() { sig = ed25519.Sign(priv, msg) })
		results["SD-JWT VC-noLib-sign"] = &sr

		_ = sig
		finalSig := ed25519.Sign(priv, msg)
		vr := bench(N, func() { ed25519.Verify(pub, msg, finalSig) })
		results["SD-JWT VC-noLib-verify"] = &vr
	}

	// ── SD-JWT VC with-lib ────────────────────────────────────────────────────
sdJwtWithLib:
	{
		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil { errors["SD-JWT VC-withLib"] = err.Error(); goto jsonLdNoLib }

		hdr := b64url([]byte(`{"alg":"EdDSA","crv":"Ed25519"}`))
		pay := b64url([]byte(`{"iss":"https://issuer.example.com","vct":"identity","sub":"did:example:holder"}`))
		msg := []byte(fmt.Sprintf("%s.%s", hdr, pay))

		var sig []byte
		sr := bench(N, func() { sig = ed25519.Sign(priv, msg) })
		results["SD-JWT VC-withLib-sign"] = &sr

		_ = sig
		finalSig := ed25519.Sign(priv, msg)
		vr := bench(N, func() { ed25519.Verify(pub, msg, finalSig) })
		results["SD-JWT VC-withLib-verify"] = &vr
	}

	// ── JSON-LD VC no-lib ─────────────────────────────────────────────────────
jsonLdNoLib:
	{
		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil { errors["JSON-LD VC-noLib"] = err.Error(); goto jsonLdWithLib }

		var sig []byte
		sr := bench(N, func() {
			nq := inlineNormalizeUrdna2015("https://example.com", "2024-01-01T00:00:00Z", "did:example:1", "Taro Yamada")
			h  := sha256.Sum256(nq)
			sig = ed25519.Sign(priv, h[:])
		})
		results["JSON-LD VC-noLib-sign"] = &sr

		nq0 := inlineNormalizeUrdna2015("https://example.com", "2024-01-01T00:00:00Z", "did:example:1", "Taro Yamada")
		h0  := sha256.Sum256(nq0)
		s0  := ed25519.Sign(priv, h0[:])
		vr  := bench(N, func() {
			nq := inlineNormalizeUrdna2015("https://example.com", "2024-01-01T00:00:00Z", "did:example:1", "Taro Yamada")
			h  := sha256.Sum256(nq)
			ed25519.Verify(pub, h[:], s0)
		})
		_ = sig
		results["JSON-LD VC-noLib-verify"] = &vr
	}

	// ── JSON-LD VC with-lib (json-gold URDNA2015) ─────────────────────────────
jsonLdWithLib:
	{
		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil { errors["JSON-LD VC-withLib"] = err.Error(); goto mdocNoLib }

		inlineCtx := map[string]interface{}{
			"@version":             1.1,
			"id":                   "@id",
			"type":                 "@type",
			"VerifiableCredential": "https://www.w3.org/2018/credentials#VerifiableCredential",
			"issuer":               map[string]interface{}{"@id": "https://www.w3.org/2018/credentials#issuer", "@type": "@id"},
			"issuanceDate":         map[string]interface{}{"@id": "https://www.w3.org/2018/credentials#issuanceDate", "@type": "http://www.w3.org/2001/XMLSchema#dateTime"},
			"credentialSubject":    "https://www.w3.org/2018/credentials#credentialSubject",
			"name":                 "http://schema.org/name",
		}
		vcDoc := map[string]interface{}{
			"@context":          inlineCtx,
			"type":              "VerifiableCredential",
			"issuer":            "https://example.com",
			"issuanceDate":      "2024-01-01T00:00:00Z",
			"credentialSubject": map[string]interface{}{"id": "did:example:1", "name": "Taro Yamada"},
		}

		proc := jsonld.NewJsonLdProcessor()
		opts := jsonld.NewJsonLdOptions("")
		opts.Algorithm = "URDNA2015"
		opts.Format = "application/n-quads"

		norm0, err2 := proc.Normalize(vcDoc, opts)
		if err2 != nil { errors["JSON-LD VC-withLib"] = fmt.Sprintf("normalize: %v", err2); goto mdocNoLib }
		h0 := sha256.Sum256([]byte(norm0.(string)))
		sig0 := ed25519.Sign(priv, h0[:])

		nJl := N / 5
		if nJl < 5 { nJl = 5 }

		sr := bench(nJl, func() {
			norm, _ := proc.Normalize(vcDoc, opts)
			h := sha256.Sum256([]byte(norm.(string)))
			ed25519.Sign(priv, h[:])
		})
		results["JSON-LD VC-withLib-sign"] = &sr

		vr := bench(nJl, func() {
			norm, _ := proc.Normalize(vcDoc, opts)
			h := sha256.Sum256([]byte(norm.(string)))
			ed25519.Verify(pub, h[:], sig0)
		})
		results["JSON-LD VC-withLib-verify"] = &vr

		// JSON-LD URDNA2015 serialize-only (no crypto)
		srN := bench(nJl, func() {
			proc.Normalize(vcDoc, opts) //nolint:errcheck
		})
		results["JSON-LD VC-serial-normalize-withLib"] = &srN
	}

	// ── mdoc no-lib ───────────────────────────────────────────────────────────
mdocNoLib:
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
		protHdr := cborMap(cborUint(1), cborNeg(-7))

		var rBytes, sBytes []byte
		sr := bench(N, func() {
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

	// ── mdoc with-lib (fxamacker/cbor) ────────────────────────────────────────
mdocWithLib:
	{
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil { errors["mdoc-withLib"] = err.Error(); goto jcsSection }

		em, _ := cborlib.EncOptions{Sort: cborlib.SortCoreDeterministic}.EncMode()

		type wElement struct {
			DigestID          int    `cbor:"digestID"`
			ElementIdentifier string `cbor:"elementIdentifier"`
			ElementValue      string `cbor:"elementValue"`
		}
		type wMSO struct {
			DocType      string         `cbor:"docType"`
			ValueDigests map[int][]byte `cbor:"valueDigests"`
		}
		type wField struct{ k, v string }
		wFields := []wField{
			{"family_name","Yamada"},{"given_name","Taro"},
			{"birth_date","1990-01-01"},{"issue_date","2024-01-01"},
			{"expiry_date","2029-01-01"},{"issuing_country","JP"},
			{"document_number","JP-12345678"},
		}

		var rBytes, sBytes []byte
		sr := bench(N, func() {
			dm := make(map[int][]byte, len(wFields))
			for i, f := range wFields {
				item, _ := em.Marshal(wElement{i, f.k, f.v})
				h := sha256.Sum256(item)
				dm[i] = h[:]
			}
			prot, _ := em.Marshal(map[int]int{1: -7})
			msoBytes, _ := em.Marshal(wMSO{"org.iso.18013.5.1.mDL", dm})
			ss, _ := em.Marshal([]interface{}{"Signature1", prot, []byte{}, msoBytes})
			h := sha256.Sum256(ss)
			ri, si, _ := ecdsa.Sign(rand.Reader, key, h[:])
			rBytes = ri.FillBytes(make([]byte, 32))
			sBytes = si.FillBytes(make([]byte, 32))
		})
		results["mdoc-withLib-sign"] = &sr

		dm2 := make(map[int][]byte, len(wFields))
		for i, f := range wFields {
			item, _ := em.Marshal(wElement{i, f.k, f.v})
			h := sha256.Sum256(item)
			dm2[i] = h[:]
		}
		prot2, _ := em.Marshal(map[int]int{1: -7})
		msoBytes2, _ := em.Marshal(wMSO{"org.iso.18013.5.1.mDL", dm2})
		ss2, _ := em.Marshal([]interface{}{"Signature1", prot2, []byte{}, msoBytes2})
		h2  := sha256.Sum256(ss2)
		ri2 := new(big.Int).SetBytes(rBytes)
		si2 := new(big.Int).SetBytes(sBytes)
		vr  := bench(N, func() { ecdsa.Verify(&key.PublicKey, h2[:], ri2, si2) })
		results["mdoc-withLib-verify"] = &vr

		// mdoc withLib serialization only
		type mdocLibDoc struct {
			DocType string      `cbor:"docType"`
			Items   []wElement  `cbor:"items"`
		}
		mdocDoc := mdocLibDoc{"org.iso.18013.5.1.mDL", []wElement{}}
		for i, f := range wFields { mdocDoc.Items = append(mdocDoc.Items, wElement{i, f.k, f.v}) }
		mdocEncoded, _ := em.Marshal(mdocDoc)
		dm3, _ := cborlib.DecOptions{}.DecMode()
		encSr := bench(N, func() { em.Marshal(mdocDoc) }) //nolint:errcheck
		results["mdoc-withLib-serial-encode"] = &encSr
		decSr := bench(N, func() {
			var out mdocLibDoc
			dm3.Unmarshal(mdocEncoded, &out) //nolint:errcheck
		})
		results["mdoc-withLib-serial-decode"] = &decSr
	}

	// ── JSON-LD VC (JCS) ──────────────────────────────────────────────────────
jcsSection:
	{
		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil { errors["JSON-LD VC (JCS)"] = err.Error(); goto serialSection }

		jcsVCDoc := map[string]interface{}{
			"@context": map[string]interface{}{
				"@version": 1.1, "id": "@id", "type": "@type",
				"VerifiableCredential": "https://www.w3.org/2018/credentials#VerifiableCredential",
				"issuer":    map[string]interface{}{"@id": "https://www.w3.org/2018/credentials#issuer", "@type": "@id"},
				"issuanceDate": map[string]interface{}{"@id": "https://www.w3.org/2018/credentials#issuanceDate", "@type": "http://www.w3.org/2001/XMLSchema#dateTime"},
				"credentialSubject": "https://www.w3.org/2018/credentials#credentialSubject",
				"name": "http://schema.org/name",
			},
			"type": "VerifiableCredential",
			"issuer": "https://example.com",
			"issuanceDate": "2024-01-01T00:00:00Z",
			"credentialSubject": map[string]interface{}{"id": "did:example:1", "name": "Taro Yamada"},
		}

		canon0, err2 := jcsCanon(jcsVCDoc)
		if err2 != nil { errors["JSON-LD VC (JCS)"] = err2.Error(); goto serialSection }
		h0 := sha256.Sum256([]byte(canon0))
		sig0 := ed25519.Sign(priv, h0[:])

		nlsr := bench(N, func() {
			canon, _ := jcsCanon(jcsVCDoc)
			h := sha256.Sum256([]byte(canon))
			ed25519.Sign(priv, h[:])
		})
		results["JSON-LD VC (JCS)-noLib-sign"] = &nlsr

		nlvr := bench(N, func() {
			canon, _ := jcsCanon(jcsVCDoc)
			h := sha256.Sum256([]byte(canon))
			ed25519.Verify(pub, h[:], sig0)
		})
		results["JSON-LD VC (JCS)-noLib-verify"] = &nlvr

		wlsr := bench(N, func() {
			canon, _ := jcsCanon(jcsVCDoc)
			h := sha256.Sum256([]byte(canon))
			ed25519.Sign(priv, h[:])
		})
		results["JSON-LD VC (JCS)-withLib-sign"] = &wlsr

		wlvr := bench(N, func() {
			canon, _ := jcsCanon(jcsVCDoc)
			h := sha256.Sum256([]byte(canon))
			ed25519.Verify(pub, h[:], sig0)
		})
		results["JSON-LD VC (JCS)-withLib-verify"] = &wlvr

		// JCS canonicalize only (no crypto)
		jcsSer := bench(N, func() { jcsCanon(jcsVCDoc) }) //nolint:errcheck
		results["JSON-LD VC (JCS)-serial-canonicalize"] = &jcsSer
	}

	// ── Serialization-only benchmarks ─────────────────────────────────────────
serialSection:
	{
		// SD-JWT VC: JSON encode/decode
		sdPayload := map[string]interface{}{
			"iss": "https://issuer.example.com", "iat": 0, "exp": 3600,
			"vct": "https://credentials.example.com/identity",
			"sub": "did:example:holder123",
			"given_name": "Taro", "family_name": "Yamada", "birthdate": "1990-01-01",
		}
		sdHdr := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"EdDSA","typ":"vc+sd-jwt"}`))

		sdEncSr := bench(N, func() {
			p, _ := json.Marshal(sdPayload)
			_ = sdHdr + "." + base64.RawURLEncoding.EncodeToString(p) + ".AAABBB"
		})
		results["SD-JWT VC-serial-encode"] = &sdEncSr

		sdToken := sdHdr + "." + func() string {
			p, _ := json.Marshal(sdPayload)
			return base64.RawURLEncoding.EncodeToString(p)
		}() + ".AAABBB"
		sdDecSr := bench(N, func() {
			parts := strings.Split(sdToken, ".")
			raw, _ := base64.RawURLEncoding.DecodeString(parts[1])
			var out map[string]interface{}
			json.Unmarshal(raw, &out) //nolint:errcheck
		})
		results["SD-JWT VC-serial-decode"] = &sdDecSr

		// JSON-LD VC: JSON encode/decode
		jldDoc := map[string]interface{}{
			"@context": map[string]interface{}{
				"@version": 1.1, "id": "@id", "type": "@type",
				"VerifiableCredential": "https://www.w3.org/2018/credentials#VerifiableCredential",
				"issuer": map[string]interface{}{"@id": "https://www.w3.org/2018/credentials#issuer", "@type": "@id"},
				"issuanceDate": map[string]interface{}{"@id": "https://www.w3.org/2018/credentials#issuanceDate", "@type": "http://www.w3.org/2001/XMLSchema#dateTime"},
				"credentialSubject": "https://www.w3.org/2018/credentials#credentialSubject",
				"name": "http://schema.org/name"},
			"type": "VerifiableCredential",
			"issuer": "https://example.com",
			"issuanceDate": "2024-01-01T00:00:00Z",
			"credentialSubject": map[string]interface{}{"id": "did:example:1", "name": "Taro Yamada"},
		}
		jldBytes, _ := json.Marshal(jldDoc)

		jldEncSr := bench(N, func() { json.Marshal(jldDoc) }) //nolint:errcheck
		results["JSON-LD VC-serial-encode"] = &jldEncSr

		jldDecSr := bench(N, func() {
			var out map[string]interface{}
			json.Unmarshal(jldBytes, &out) //nolint:errcheck
		})
		results["JSON-LD VC-serial-decode"] = &jldDecSr

		// JSON-LD VC URDNA2015 normalize inline (no-lib)
		jldNormSr := bench(N, func() {
			inlineNormalizeUrdna2015("https://example.com", "2024-01-01T00:00:00Z", "did:example:1", "Taro Yamada")
		})
		results["JSON-LD VC-serial-normalize"] = &jldNormSr

		// mdoc: manual CBOR encode (no signing, no hashing)
		type serField struct{ k, v string }
		serFields := []serField{
			{"family_name","Yamada"},{"given_name","Taro"},
			{"birth_date","1990-01-01"},{"issue_date","2024-01-01"},
			{"expiry_date","2029-01-01"},{"issuing_country","JP"},
			{"document_number","JP-12345678"},
		}
		mdocSerSr := bench(N, func() {
			items := make([][]byte, 0, len(serFields)*3)
			for i, f := range serFields {
				items = append(items, cborUint(i), cborText(f.k), cborText(f.v))
			}
			cborMap(items...)
		})
		results["mdoc-serial-encode"] = &mdocSerSr
	}

	return results, errors
}

// dummy label to allow goto
var done = struct{}{}

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
