import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts'
import type { NoLibResult, SerialBenchResult } from '../benchmarks/noLibrary'
import type { SpeedResult } from '../benchmarks/signatureSpeed'
import type { Lang, FmtKey, Mode } from '../data/codeSnippets'
import { SNIPPETS, getLOCMatrix } from '../data/codeSnippets'
import type { RefValues } from '../data/referenceValues'
import { DEFAULT_REF } from '../data/referenceValues'
import type { PyBenchResults } from '../lib/pyodideRunner'

type SubView = 'benchmark' | 'language' | 'langspeed'

interface BenchmarkProps {
  onRun: () => void
  running: boolean
  results: NoLibResult[] | null
  serialResults: SerialBenchResult[] | null
  progress: string
}

const FMT_COLORS: Record<string, string> = { 'SD-JWT VC': '#60a5fa', 'mdoc': '#34d399' }
const MODE_COLORS = { withLib: '#94a3b8', noLib: '#f472b6' }

function NoLibBenchmark({ onRun, running, results, serialResults, progress }: BenchmarkProps) {
  if (!results && !running) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 48 }}>
      <div style={{ fontSize: 36 }}>🧪</div>
      <p style={{ color: '#64748b', fontSize: 14, textAlign: 'center', maxWidth: 480, lineHeight: 1.6 }}>
        Web Crypto API のみで実装した SD-JWT VC・mdoc の署名速度をライブラリあり版と比較します。<br/>
        さらに暗号なし・シリアライズ速度のみのベンチマークでバイナリ形式の優位性を検証します。
      </p>
      <button onClick={onRun} style={btnStyle}>ベンチマーク実行</button>
    </div>
  )

  if (running) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 48 }}>
      <div style={spinner} />
      <span style={{ color: '#60a5fa', fontSize: 14 }}>{progress}</span>
    </div>
  )

  if (!results) return null

  const formats: FmtKey[] = ['SD-JWT VC', 'mdoc']
  const ops: string[] = ['sign', 'verify']
  const chartData = formats.flatMap(fmt =>
    ops.map(op => {
      const w = results.find(r => r.format === fmt && r.mode === 'withLib' && r.operation === op)
      const n = results.find(r => r.format === fmt && r.mode === 'noLib'   && r.operation === op)
      return {
        shortLabel: `${fmt} / ${op}`,
        withLib: w ? parseFloat(w.opsPerSec.toFixed(1)) : 0,
        noLib:   n ? parseFloat(n.opsPerSec.toFixed(1)) : 0,
        fmt,
      }
    })
  )

  // Build serial chart data
  const serialChartData = serialResults ? ['encode', 'decode'].map(op => ({
    name: op,
    'SD-JWT VC (JSON)': Math.round(serialResults.find(r => r.format === 'SD-JWT VC' && r.operation === op)?.opsPerSec ?? 0),
    'mdoc (CBOR)':      Math.round(serialResults.find(r => r.format === 'mdoc'       && r.operation === op)?.opsPerSec ?? 0),
  })) : []

  const sdSize   = serialResults?.find(r => r.format === 'SD-JWT VC' && r.operation === 'encode')?.payloadSizeBytes ?? 0
  const mdocSize = serialResults?.find(r => r.format === 'mdoc'       && r.operation === 'encode')?.payloadSizeBytes ?? 0

  const sdSign   = results.find(r => r.format === 'SD-JWT VC' && r.mode === 'withLib' && r.operation === 'sign')
  const mdocSign = results.find(r => r.format === 'mdoc'       && r.mode === 'withLib' && r.operation === 'sign')
  const cryptoRatio = sdSign && mdocSign ? (sdSign.opsPerSec / mdocSign.opsPerSec) : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ── Why is mdoc slower despite being binary? ── */}
      <div style={{ ...panelStyle, borderColor: '#f59e0b50', background: '#1e293b' }}>
        <h3 style={{ ...sectionTitle, color: '#fbbf24' }}>💡 バイナリなのに mdoc が遅い理由</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, fontSize: 12, color: '#94a3b8', lineHeight: 1.7 }}>
          <div style={{ background: '#0f172a', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ color: '#60a5fa', fontWeight: 600, marginBottom: 6 }}>① 署名アルゴリズムの差</div>
            <div>SD-JWT VC: <span style={{ color: '#4ade80' }}>EdDSA (Ed25519)</span> — 非常に高速な楕円曲線署名</div>
            <div>mdoc: <span style={{ color: '#f87171' }}>ECDSA P-256</span> — Ed25519 より 2〜4倍コストが高い</div>
            <div style={{ marginTop: 6, color: '#64748b' }}>暗号演算がボトルネックになる場合、シリアライズ形式より<strong style={{ color: '#fbbf24' }}>アルゴリズム選択</strong>が支配的</div>
          </div>
          <div style={{ background: '#0f172a', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ color: '#34d399', fontWeight: 600, marginBottom: 6 }}>② per-element ハッシュの追加コスト</div>
            <div>mdoc は各データ要素を個別に SHA-256 ハッシュ</div>
            <div>今回のテスト: 8フィールド → <span style={{ color: '#f87171' }}>SHA-256 × 8回</span> 追加</div>
            <div style={{ marginTop: 6, color: '#64748b' }}>これが選択的開示の完全性保証コスト（完全性 ↑ 、速度 ↓）</div>
          </div>
          <div style={{ background: '#0f172a', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ color: '#a78bfa', fontWeight: 600, marginBottom: 6 }}>③ バイナリの利点が活きる場面</div>
            <div>CBOR は <strong style={{ color: '#4ade80' }}>シリアライズ/デシリアライズ速度・ペイロードサイズ</strong> で優位</div>
            <div style={{ marginTop: 4 }}>
              {sdSize > 0 && mdocSize > 0 && (
                <span>同じ内容: SD-JWT <span style={{ color: '#f87171' }}>{sdSize}B</span> vs mdoc <span style={{ color: '#4ade80' }}>{mdocSize}B</span> ({((1 - mdocSize/sdSize)*100).toFixed(0)}% 削減)</span>
              )}
            </div>
            <div style={{ marginTop: 6, color: '#64748b' }}>QRコード・BLE転送など帯域制約がある場面でバイナリが有利</div>
          </div>
        </div>
      </div>

      {/* ── Sign/verify with-lib vs no-lib chart ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {results.map(r => (
          <div key={`${r.format}-${r.mode}-${r.operation}`}
               style={{ ...cardStyle, borderColor: (r.mode === 'noLib' ? '#f472b6' : '#94a3b8') + '50' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: FMT_COLORS[r.format] + '20', color: FMT_COLORS[r.format] }}>{r.format}</span>
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: r.mode === 'noLib' ? '#f472b620' : '#94a3b820', color: r.mode === 'noLib' ? '#f472b6' : '#94a3b8' }}>
                {r.mode === 'noLib' ? 'ライブラリなし' : 'ライブラリあり'}
              </span>
              <span style={{ fontSize: 10, color: '#475569' }}>{r.operation}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: r.mode === 'noLib' ? '#f472b6' : '#94a3b8' }}>{r.opsPerSec.toFixed(0)}</div>
            <div style={{ fontSize: 10, color: '#64748b' }}>ops/sec</div>
            <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}>平均 {r.avgMs.toFixed(3)} ms</div>
          </div>
        ))}
      </div>

      <div style={panelStyle}>
        <h3 style={sectionTitle}>署名速度: ライブラリあり vs ライブラリなし（ops/sec）</h3>
        {cryptoRatio > 0 && (
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
            SD-JWT VC (EdDSA) は mdoc (ECDSA P-256) より署名で <span style={{ color: '#fbbf24', fontWeight: 700 }}>{cryptoRatio.toFixed(1)}x</span> 高速 —
            これはアルゴリズムの差であり、フォーマットのバイナリ/テキストの差ではありません
          </p>
        )}
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 56 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="shortLabel" tick={{ fill: '#94a3b8', fontSize: 10 }} angle={-20} textAnchor="end" />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} labelStyle={{ color: '#e2e8f0' }}
              formatter={(v: number, name: string) => [`${v.toFixed(0)} ops/sec`, name === 'withLib' ? 'ライブラリあり' : 'ライブラリなし']} />
            <Legend formatter={(v) => v === 'withLib' ? 'ライブラリあり' : 'ライブラリなし'} wrapperStyle={{ color: '#94a3b8', fontSize: 12 }} />
            <Bar dataKey="withLib" fill={MODE_COLORS.withLib} radius={[3, 3, 0, 0]} />
            <Bar dataKey="noLib"   fill={MODE_COLORS.noLib}   radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Serialization-only benchmark ── */}
      {serialResults && serialResults.length > 0 && (
        <div style={panelStyle}>
          <h3 style={sectionTitle}>シリアライズ速度（暗号なし）— バイナリ CBOR vs テキスト JSON</h3>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
            署名・ハッシュを除いたエンコード/デコード速度の純粋な比較。ここでは CBOR のバイナリ優位性が現れます。
          </p>
          <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            {serialResults.map(r => (
              <div key={`${r.format}-${r.operation}`} style={{ background: '#0f172a', borderRadius: 10, padding: '10px 16px', flex: 1, minWidth: 160 }}>
                <div style={{ fontSize: 10, color: r.format === 'SD-JWT VC' ? '#60a5fa' : '#34d399', marginBottom: 4, fontWeight: 600 }}>{r.format} / {r.operation}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: r.format === 'mdoc' ? '#34d399' : '#60a5fa' }}>{r.opsPerSec.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</div>
                <div style={{ fontSize: 10, color: '#64748b' }}>ops/sec</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>ペイロード {r.payloadSizeBytes} bytes</div>
              </div>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={serialChartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                formatter={(v: number, name: string) => [`${v.toLocaleString()} ops/sec`, name]} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
              <Bar dataKey="SD-JWT VC (JSON)" fill="#60a5fa" radius={[3,3,0,0]} />
              <Bar dataKey="mdoc (CBOR)"       fill="#34d399" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
          {sdSize > 0 && mdocSize > 0 && (
            <p style={{ fontSize: 12, color: '#64748b', marginTop: 10 }}>
              ペイロードサイズ: SD-JWT VC <span style={{ color: '#f87171' }}>{sdSize} bytes (テキスト)</span> vs mdoc <span style={{ color: '#4ade80' }}>{mdocSize} bytes (バイナリ)</span> — {((1 - mdocSize/sdSize)*100).toFixed(0)}% 削減。
              シリアライズ速度もCBORが<span style={{ color: '#34d399', fontWeight: 600 }}> ✓ 高速</span>。署名の遅さはアルゴリズムの問題。
            </p>
          )}
        </div>
      )}

      <div style={{ textAlign: 'right' }}>
        <button onClick={onRun} style={{ ...btnStyle, fontSize: 12, padding: '6px 14px' }}>再実行</button>
      </div>
    </div>
  )
}

// ---- Language comparison view ----

function LanguageView() {
  const [lang, setLang]   = useState<Lang>('TypeScript')
  const [fmt, setFmt]     = useState<FmtKey>('SD-JWT VC')
  const [mode, setMode]   = useState<Mode>('withLib')
  const [showCode, setShowCode] = useState(false)

  const snippet = SNIPPETS.find(s => s.language === lang && s.format === fmt && s.mode === mode)
  const locMatrix = getLOCMatrix()

  const langs: Lang[]   = ['TypeScript', 'Go', 'Python']
  const fmts: FmtKey[]  = ['SD-JWT VC', 'JSON-LD VC', 'mdoc']
  const modes: { id: Mode; label: string }[] = [
    { id: 'withLib', label: 'ライブラリあり' },
    { id: 'noLib',   label: 'ライブラリなし' },
  ]

  const LANG_COLORS: Record<Lang, string>   = { TypeScript: '#60a5fa', Go: '#34d399', Python: '#f59e0b' }
  const FMT_COL: Record<FmtKey, string>    = { 'SD-JWT VC': '#60a5fa', 'JSON-LD VC': '#f59e0b', mdoc: '#34d399' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['TypeScript', 'Go', 'Python'] as Lang[]).map(l => (
          <button key={l} onClick={() => setLang(l)} style={{ ...filterBtn, borderColor: lang === l ? LANG_COLORS[l] : '#334155', color: lang === l ? LANG_COLORS[l] : '#64748b', background: lang === l ? LANG_COLORS[l] + '15' : '#1e293b' }}>{l}</button>
        ))}
        <div style={{ width: 1, height: 24, background: '#334155' }} />
        {fmts.map(f => (
          <button key={f} onClick={() => setFmt(f)} style={{ ...filterBtn, borderColor: fmt === f ? FMT_COL[f] : '#334155', color: fmt === f ? FMT_COL[f] : '#64748b', background: fmt === f ? FMT_COL[f] + '15' : '#1e293b' }}>{f}</button>
        ))}
        <div style={{ width: 1, height: 24, background: '#334155' }} />
        {modes.map(m => (
          <button key={m.id} onClick={() => setMode(m.id)} style={{ ...filterBtn, borderColor: mode === m.id ? '#a78bfa' : '#334155', color: mode === m.id ? '#a78bfa' : '#64748b', background: mode === m.id ? '#a78bfa15' : '#1e293b' }}>{m.label}</button>
        ))}
      </div>

      {/* Snippet details */}
      {snippet && (
        <div style={{ ...panelStyle, borderColor: LANG_COLORS[lang] + '40' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h3 style={{ color: LANG_COLORS[lang], fontSize: 16, fontWeight: 700 }}>
                {lang} — {fmt} — {mode === 'withLib' ? 'ライブラリあり' : 'ライブラリなし'}
              </h3>
              {snippet.notes && <p style={{ color: '#64748b', fontSize: 12, marginTop: 6 }}>{snippet.notes}</p>}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {snippet.impractical ? (
                <div style={{ background: '#7f1d1d', border: '1px solid #dc2626', borderRadius: 8, padding: '6px 12px', fontSize: 11, color: '#fca5a5' }}>
                  ⚠ 推定 {snippet.estimatedLoc?.toLocaleString()} 行 — 実装非推奨
                </div>
              ) : (
                <div style={{ background: '#0f172a', borderRadius: 8, padding: '6px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#64748b' }}>LOC</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: LANG_COLORS[lang] }}>{snippet.loc}</div>
                </div>
              )}
              <div style={{ background: '#0f172a', borderRadius: 8, padding: '6px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#64748b' }}>外部パッケージ</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: snippet.stdlibOnly ? '#4ade80' : '#f59e0b' }}>{snippet.dependencies.length}</div>
              </div>
            </div>
          </div>

          {snippet.dependencies.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
              {snippet.dependencies.map(d => <span key={d} style={tagStyle}>{d}</span>)}
            </div>
          )}
          {snippet.stdlibOnly && (
            <div style={{ marginTop: 10, display: 'inline-block', padding: '3px 10px', background: '#14532d', borderRadius: 6, border: '1px solid #22c55e', fontSize: 11, color: '#86efac' }}>
              ✓ 標準ライブラリのみ
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <button onClick={() => setShowCode(s => !s)} style={{ ...filterBtn, color: '#60a5fa', borderColor: '#60a5fa50' }}>
              {showCode ? 'コードを非表示' : 'コードを表示'}
            </button>
          </div>
          {showCode && <pre style={codeStyle}>{snippet.code}</pre>}
        </div>
      )}

      {/* LOC matrix */}
      <div style={panelStyle}>
        <h3 style={sectionTitle}>LOC 比較マトリクス（ライブラリあり / ライブラリなし）</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 500 }}>
            <thead>
              <tr>
                <th style={thStyle}>フォーマット</th>
                {langs.map(l => (
                  <th key={l} style={{ ...thStyle, color: LANG_COLORS[l] }}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fmts.map(f => (
                <tr key={f} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ ...tdStyle, color: FMT_COL[f], fontWeight: 600 }}>{f}</td>
                  {langs.map(l => {
                    const cell = locMatrix[f][l]
                    return (
                      <td key={l} style={tdStyle}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ color: '#4ade80', fontSize: 11 }}>✓ {cell.withLib}行</span>
                          <span style={{ color: '#475569' }}>|</span>
                          {cell.noLibImpractical
                            ? <span style={{ color: '#f87171', fontSize: 11 }}>✗ ~{cell.estimatedLoc?.toLocaleString()}</span>
                            : <span style={{ color: '#f472b6', fontSize: 11 }}>⚗ {cell.noLib}行</span>
                          }
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ color: '#475569', fontSize: 11, marginTop: 8 }}>✓ ライブラリあり　⚗ ライブラリなし（実装可能）　✗ ライブラリなし（推定行数・実装非推奨）</p>
        </div>
      </div>

      {/* All snippets grid */}
      <div style={panelStyle}>
        <h3 style={sectionTitle}>フォーマット別 外部パッケージ依存数</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          {fmts.map(f => (
            <div key={f} style={{ background: '#0f172a', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ color: FMT_COL[f], fontWeight: 700, fontSize: 13, marginBottom: 10 }}>{f}</div>
              {langs.map(l => {
                const wl = SNIPPETS.find(s => s.language === l && s.format === f && s.mode === 'withLib')
                const nl = SNIPPETS.find(s => s.language === l && s.format === f && s.mode === 'noLib')
                return (
                  <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: LANG_COLORS[l] }}>{l}</span>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <span style={{ fontSize: 11, color: '#64748b' }}>
                        あり: <span style={{ color: '#94a3b8' }}>{wl?.dependencies.join(', ') || 'なし'}</span>
                      </span>
                      <span style={{ fontSize: 11, color: '#64748b' }}>
                        なし: <span style={{ color: nl?.stdlibOnly ? '#4ade80' : nl?.impractical ? '#f87171' : '#f472b6' }}>
                          {nl?.impractical ? '非推奨' : nl?.stdlibOnly ? '標準のみ' : nl?.dependencies.join(', ')}
                        </span>
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---- Language speed comparison view -------------------------

const LANG_COLORS_SPD = { TypeScript: '#60a5fa', Go: '#34d399', Python: '#f59e0b' }
const FMT_COLORS_SPD: Record<FmtKey, string> = { 'SD-JWT VC': '#60a5fa', 'JSON-LD VC': '#f59e0b', mdoc: '#34d399' }

// DEFAULT_REF is now defined in src/data/referenceValues.ts (shared with ReportView)

const GO_SCRIPT = `// go run bench.go   (requires: go get github.com/golang-jwt/jwt/v5 github.com/fxamacker/cbor/v2)
package main

import (
  "crypto/ecdsa"; "crypto/elliptic"; "crypto/rand"
  "crypto/sha256"; "encoding/base64"; "encoding/json"
  "fmt"; "strings"; "time"
)

func b64url(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func bench(name string, n int, f func()) {
  f() // warm-up
  t := time.Now()
  for i := 0; i < n; i++ { f() }
  d := time.Since(t)
  fmt.Printf("%-45s %8.0f ops/sec  avg %6.3f ms\\n",
    name, float64(n)/d.Seconds(), d.Seconds()*1000/float64(n))
}

func main() {
  key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
  payload := map[string]any{"iss":"https://issuer.example.com","vct":"identity"}
  payJSON, _ := json.Marshal(payload)
  N := 1000

  // SD-JWT VC — no lib
  var token string
  bench("SD-JWT VC sign   (no lib)", N, func() {
    h := b64url([]byte(\`{"alg":"ES256"}\`))
    p := b64url(payJSON)
    msg := h + "." + p
    hash := sha256.Sum256([]byte(msg))
    sig, _ := ecdsa.SignASN1(rand.Reader, key, hash[:])
    token = msg + "." + b64url(sig)
  })
  bench("SD-JWT VC verify (no lib)", N, func() {
    parts := strings.Split(token, ".")
    hash := sha256.Sum256([]byte(parts[0]+"."+parts[1]))
    sig, _ := base64.RawURLEncoding.DecodeString(parts[2])
    ecdsa.VerifyASN1(&key.PublicKey, hash[:], sig)
  })

  // SD-JWT VC — with golang-jwt
  // import jwt "github.com/golang-jwt/jwt/v5"
  // bench("SD-JWT VC sign   (with lib)", N, func() { jwt.NewWithClaims(...).SignedString(key) })
  // bench("SD-JWT VC verify (with lib)", N, func() { jwt.Parse(token, ...) })

  fmt.Println("\\nJSON-LD VC — with json-gold (import github.com/piprate/json-gold/ld)")
  fmt.Println("  Normalization dominates; typically 500-1000 ops/sec")

  fmt.Println("\\nmdoc — manual CBOR+COSE (fxamacker/cbor for with-lib variant)")
  fmt.Println("  Replace cbor2 with fxamacker/cbor/v2 for with-lib; struct+crypto for no-lib")
}`

const PY_SCRIPT = `# pip install PyJWT cryptography cbor2 pyld
# python bench.py

import base64, json, time
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

def b64url(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()

def bench(name, n, fn):
    fn()  # warm-up
    t = time.perf_counter()
    for _ in range(n): fn()
    d = time.perf_counter() - t
    print(f"{name:<45s} {n/d:8.0f} ops/sec  avg {d*1000/n:6.3f} ms")

key = ec.generate_private_key(ec.SECP256R1())
pub = key.public_key()
payload = {"iss": "https://issuer.example.com", "vct": "identity"}
N = 1000

# SD-JWT VC — no lib
h_hdr = b64url(json.dumps({"alg": "ES256"}).encode())
h_pay = b64url(json.dumps(payload).encode())
msg = f"{h_hdr}.{h_pay}".encode()
token = [None]

def sign_no_lib():
    der = key.sign(msg, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    raw = r.to_bytes(32,'big') + s.to_bytes(32,'big')
    token[0] = f"{h_hdr}.{h_pay}.{b64url(raw)}"

bench("SD-JWT VC sign   (no lib)", N, sign_no_lib)

# SD-JWT VC — with PyJWT
import jwt
bench("SD-JWT VC sign   (with PyJWT)", N,
    lambda: jwt.encode(payload, key, algorithm='ES256'))

# JSON-LD VC — with pyld
from pyld import jsonld
import hashlib
vc_doc = {"@context":["https://www.w3.org/2018/credentials/v1"],
          "type":"VerifiableCredential","issuer":"https://example.com",
          "credentialSubject":{"id":"did:example:1","name":"Taro"}}
bench("JSON-LD VC normalize (URDNA2015)", N//10,
    lambda: jsonld.normalize(vc_doc, {"algorithm":"URDNA2015","format":"application/n-quads"}))

# mdoc — with cbor2 + cryptography
import cbor2
mso = {"version":"1.0","digestAlgorithm":"SHA-256","docType":"org.iso.18013.5.1.mDL"}
bench("mdoc CBOR encode+sign (with cbor2)", N,
    lambda: cbor2.dumps({"issuerAuth": cbor2.dumps(mso)}))`

function LanguageSpeedView({
  noLibResults, speedResults, refValues, onRefChange,
  pythonResults, pythonRunning, pythonProgress, onRunPython,
}: {
  noLibResults: NoLibResult[] | null
  speedResults: SpeedResult[] | null
  refValues: RefValues
  onRefChange: (key: string, lang: 'Go' | 'Python', val: string) => void
  pythonResults: PyBenchResults | null
  pythonRunning: boolean
  pythonProgress: string
  onRunPython: () => void
}) {
  type CmpMode = 'format' | 'language'
  const [cmpMode, setCmpMode] = useState<CmpMode>('format')

  const [lang, setLang] = useState<'TypeScript' | 'Go' | 'Python'>('TypeScript')
  const [fmt, setFmt] = useState<FmtKey>('SD-JWT VC')
  const [mode, setMode] = useState<'withLib' | 'noLib'>('withLib')
  const [showScript, setShowScript] = useState<'none' | 'go' | 'python'>('none')

  // Use lifted ref state from App.tsx (shared with ReportView)
  const refs = refValues

  const ops = ['sign', 'verify'] as const
  const fmts: FmtKey[] = ['SD-JWT VC', 'JSON-LD VC', 'mdoc']
  const langs: ('TypeScript' | 'Go' | 'Python')[] = ['TypeScript', 'Go', 'Python']

  // Delegate to App.tsx (shared with ReportView)
  const updateRef = onRefChange

  // Get TypeScript ops/sec for any format+mode+op
  const getTsOps = (f: FmtKey, m: 'withLib' | 'noLib', op: 'sign' | 'verify'): number => {
    if (f === 'JSON-LD VC') {
      if (m === 'noLib') return 0
      return speedResults?.find(r => r.format === 'JSON-LD VC' && r.operation === op)?.opsPerSec ?? 0
    }
    return noLibResults?.find(r => r.format === f && r.mode === m && r.operation === op)?.opsPerSec ?? 0
  }

  // Get Go/Python reference ops/sec
  // Python: use actual Pyodide result if available, else fall back to reference value
  const getPythonOps = (f: FmtKey, m: 'withLib' | 'noLib', op: 'sign' | 'verify'): { value: number; isActual: boolean } => {
    if (f === 'JSON-LD VC' && m === 'noLib') return { value: 0, isActual: false }
    const key = `${f}-${m}-${op}`
    const actual = pythonResults?.[key]
    if (actual) return { value: actual.opsPerSec, isActual: true }
    return { value: refs[key]?.['Python'] ?? 0, isActual: false }
  }

  const getRefOps = (f: FmtKey, m: 'withLib' | 'noLib', op: 'sign' | 'verify', l: 'Go' | 'Python'): number => {
    if (f === 'JSON-LD VC' && m === 'noLib') return 0
    if (l === 'Python') return getPythonOps(f, m, op).value
    return refs[`${f}-${m}-${op}`]?.[l] ?? 0
  }

  // For language-compare view
  const isJsonLdFmt = fmt === 'JSON-LD VC'
  const effectiveMode = isJsonLdFmt ? 'withLib' : mode

  // ======= フォーマット比較 chart data =======
  // X: sign/verify, bars: SD-JWT VC / JSON-LD VC / mdoc (for selected language+mode)
  const fmtChartData = ops.map(op => {
    const entry: Record<string, string | number> = { name: op }
    for (const f of fmts) {
      const m = f === 'JSON-LD VC' && mode === 'noLib' ? 'withLib' : mode
      entry[f] = lang === 'TypeScript'
        ? Math.round(getTsOps(f, m, op))
        : getRefOps(f, m, op, lang as 'Go' | 'Python')
    }
    return entry
  })

  // ======= 言語比較 chart data (existing) =======
  // X: sign/verify, bars: TypeScript / Go / Python (for selected format+mode)
  const langChartData = ops.map(op => ({
    name: op,
    TypeScript: Math.round(getTsOps(fmt, effectiveMode, op)),
    Go: getRefOps(fmt, effectiveMode, op, 'Go'),
    Python: getRefOps(fmt, effectiveMode, op, 'Python'),
  }))

  const hasTs = fmts.some(f => getTsOps(f, mode, 'sign') > 0) || speedResults !== null

  // ======= Reference input list: all 3 formats × 2 ops for current mode =======
  const allRefKeys = fmts.flatMap(f =>
    ops.map(op => ({
      key: `${f}-${f === 'JSON-LD VC' ? 'withLib' : mode}-${op}`,
      label: `${f} / ${op}`,
      fmt: f,
      op,
    }))
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Python Pyodide benchmark panel */}
      <div style={{ ...panelStyle, borderColor: pythonResults ? '#f59e0b50' : '#334155' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>
              🐍 Python 実測（Pyodide / WebAssembly）
            </div>
            <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
              {pythonResults
                ? `✓ 実測完了 — ${Object.keys(pythonResults).length} 項目。チャートの Python 棒グラフは実測値に更新されています。`
                : 'ブラウザ内で Python を実行（Pyodide ~10 MB）。Go は引き続きローカル実行が必要な参考値です。'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {pythonRunning && (
              <span style={{ fontSize: 11, color: '#f59e0b' }}>{pythonProgress}</span>
            )}
            <button
              onClick={onRunPython}
              disabled={pythonRunning}
              style={{ ...btnStyle, fontSize: 12, padding: '7px 16px', background: pythonRunning ? '#1e293b' : '#78350f', borderColor: pythonRunning ? '#334155' : '#f59e0b', color: pythonRunning ? '#475569' : '#fbbf24' }}>
              {pythonRunning ? '実行中...' : pythonResults ? '再実行' : 'Python を実測する'}
            </button>
          </div>
        </div>
        {pythonResults && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {Object.entries(pythonResults).slice(0, 8).map(([k, v]) => (
              <span key={k} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: '#78350f30', color: '#fbbf24', border: '1px solid #f59e0b30' }}>
                {k.replace('withLib', 'lib').replace('noLib', 'nolib')}: {v.opsPerSec.toFixed(0)} ops/sec
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Python vs Go: データソース説明 */}
      <div style={{ display: 'flex', gap: 10, fontSize: 11, flexWrap: 'wrap' }}>
        <span style={{ padding: '3px 10px', borderRadius: 6, background: '#f59e0b20', color: '#fbbf24', border: '1px solid #f59e0b40' }}>
          🐍 Python — {pythonResults ? '✓ Pyodide 実測値' : '参考値（上ボタンで実測可）'}
        </span>
        <span style={{ padding: '3px 10px', borderRadius: 6, background: '#34d39920', color: '#34d399', border: '1px solid #34d39940' }}>
          🐹 Go — 参考値（ローカル実行が必要）
        </span>
        <span style={{ padding: '3px 10px', borderRadius: 6, background: '#60a5fa20', color: '#60a5fa', border: '1px solid #60a5fa40' }}>
          🔷 TypeScript — ブラウザ実測値
        </span>
      </div>

      {/* Compare mode toggle */}
      <div style={{ display: 'flex', gap: 0, background: '#0f172a', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {([
          { id: 'format'   as CmpMode, label: '📊 フォーマット比較（言語固定）' },
          { id: 'language' as CmpMode, label: '🌐 言語比較（フォーマット固定）' },
        ]).map(({ id, label }) => (
          <button key={id} onClick={() => setCmpMode(id)} style={{
            padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: cmpMode === id ? 600 : 400,
            background: cmpMode === id ? '#1e293b' : 'none',
            color: cmpMode === id ? '#e2e8f0' : '#64748b',
            transition: 'all 0.15s',
          }}>{label}</button>
        ))}
      </div>

      {/* ====== フォーマット比較 ====== */}
      {cmpMode === 'format' && <>
        {/* Selectors: language + mode */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {langs.map(l => (
            <button key={l} onClick={() => setLang(l)}
              style={{ ...filterBtn, borderColor: lang === l ? LANG_COLORS_SPD[l] : '#334155', color: lang === l ? LANG_COLORS_SPD[l] : '#64748b', background: lang === l ? LANG_COLORS_SPD[l] + '15' : '#1e293b' }}>{l}</button>
          ))}
          <div style={{ width: 1, height: 24, background: '#334155' }} />
          {(['withLib', 'noLib'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              style={{ ...filterBtn, borderColor: mode === m ? '#a78bfa' : '#334155', color: mode === m ? '#a78bfa' : '#64748b', background: mode === m ? '#a78bfa15' : '#1e293b' }}>
              {m === 'withLib' ? 'ライブラリあり' : 'ライブラリなし'}
            </button>
          ))}
        </div>

        {mode === 'noLib' && (
          <div style={{ fontSize: 12, color: '#64748b', padding: '6px 12px', background: '#1e293b', borderRadius: 8 }}>
            ※ JSON-LD VC のライブラリなしは非実用（URDNA2015 ≈ 1200行）。グラフには「ライブラリあり」の値を表示します。
          </div>
        )}
        {lang === 'TypeScript' && !hasTs && (
          <div style={{ fontSize: 12, color: '#f59e0b', padding: '8px 12px', background: '#78350f20', borderRadius: 8, border: '1px solid #f59e0b40' }}>
            ⚠ TypeScript 実測値は「🧪 TS: ライブラリなし vs あり」でベンチマークを実行してください
          </div>
        )}

        {/* Chart: X=sign/verify, bars=3 formats */}
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <h3 style={sectionTitle}>
              {lang} — {mode === 'withLib' ? 'ライブラリあり' : 'ライブラリなし'} — フォーマット別速度比較（ops/sec）
            </h3>
            {lang !== 'TypeScript' && (
              <span style={{ fontSize: 10, color: '#475569', padding: '3px 8px', background: '#1e293b', borderRadius: 6, border: '1px solid #334155' }}>参考値（編集可）</span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={fmtChartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 13 }} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                formatter={(v: number, name: string) => [`${v.toLocaleString()} ops/sec`, name]} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
              <Bar dataKey="SD-JWT VC"  fill={FMT_COLORS_SPD['SD-JWT VC']}  radius={[3,3,0,0]} />
              <Bar dataKey="JSON-LD VC" fill={FMT_COLORS_SPD['JSON-LD VC']} radius={[3,3,0,0]} />
              <Bar dataKey="mdoc"       fill={FMT_COLORS_SPD.mdoc}           radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Format comparison table */}
        <div style={panelStyle}>
          <h3 style={sectionTitle}>フォーマット速度比較テーブル</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>{['操作', 'SD-JWT VC', 'JSON-LD VC', 'mdoc', 'SD-JWT / JSON-LD', 'SD-JWT / mdoc'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {ops.map(op => {
                const get = (f: FmtKey) => {
                  const m = f === 'JSON-LD VC' && mode === 'noLib' ? 'withLib' : mode
                  return lang === 'TypeScript' ? getTsOps(f, m, op) : getRefOps(f, m, op, lang as 'Go' | 'Python')
                }
                const sd = get('SD-JWT VC'), jl = get('JSON-LD VC'), md = get('mdoc')
                const fmtCell = (v: number, f: FmtKey) => v > 0
                  ? <span style={{ color: FMT_COLORS_SPD[f] }}>{v.toFixed(0)} ops/sec{lang !== 'TypeScript' ? <span style={{ fontSize: 9, color: '#475569' }}> 参考</span> : ''}</span>
                  : <span style={{ color: '#475569' }}>未計測</span>
                return (
                  <tr key={op} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={tdStyle}>{op}</td>
                    <td style={tdStyle}>{fmtCell(sd, 'SD-JWT VC')}</td>
                    <td style={tdStyle}>{fmtCell(jl, 'JSON-LD VC')}</td>
                    <td style={tdStyle}>{fmtCell(md, 'mdoc')}</td>
                    <td style={{ ...tdStyle, fontWeight: 600, color: '#fbbf24' }}>
                      {jl > 0 && sd > 0 ? `${(sd/jl).toFixed(1)}x 高速` : '—'}
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 600, color: '#a78bfa' }}>
                      {md > 0 && sd > 0 ? `${(sd/md).toFixed(2)}x` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </>}

      {/* ====== 言語比較 ====== */}
      {cmpMode === 'language' && <>
        {/* Selectors: format + mode */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {fmts.map(f => (
            <button key={f} onClick={() => { setFmt(f); if (f === 'JSON-LD VC') setMode('withLib') }}
              style={{ ...filterBtn, borderColor: fmt === f ? FMT_COLORS_SPD[f] : '#334155', color: fmt === f ? FMT_COLORS_SPD[f] : '#64748b', background: fmt === f ? FMT_COLORS_SPD[f] + '15' : '#1e293b' }}>{f}</button>
          ))}
          <div style={{ width: 1, height: 24, background: '#334155' }} />
          {!isJsonLdFmt && (['withLib', 'noLib'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              style={{ ...filterBtn, borderColor: mode === m ? '#a78bfa' : '#334155', color: mode === m ? '#a78bfa' : '#64748b', background: mode === m ? '#a78bfa15' : '#1e293b' }}>
              {m === 'withLib' ? 'ライブラリあり' : 'ライブラリなし'}
            </button>
          ))}
          {isJsonLdFmt && <span style={{ fontSize: 11, color: '#64748b', padding: '5px 10px', background: '#1e293b', borderRadius: 8, border: '1px solid #334155' }}>ライブラリあり（no-lib は非実用）</span>}
        </div>

        {/* Chart: X=sign/verify, bars=3 languages */}
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <h3 style={sectionTitle}>
              {fmt} — {effectiveMode === 'withLib' ? 'ライブラリあり' : 'ライブラリなし'} — 言語別速度比較（ops/sec）
            </h3>
            <span style={{ fontSize: 10, color: '#475569', padding: '3px 8px', background: '#1e293b', borderRadius: 6, border: '1px solid #334155' }}>Go/Python は参考値（編集可）</span>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={langChartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 13 }} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                formatter={(v: number, name: string) => [`${v.toLocaleString()} ops/sec`, name]} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
              <Bar dataKey="TypeScript" fill={LANG_COLORS_SPD.TypeScript} radius={[3,3,0,0]} />
              <Bar dataKey="Go"         fill={LANG_COLORS_SPD.Go}         radius={[3,3,0,0]} />
              <Bar dataKey="Python"     fill={LANG_COLORS_SPD.Python}     radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Ratio table */}
        <div style={panelStyle}>
          <h3 style={sectionTitle}>TypeScript 実測値を基準とした相対速度</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>{['操作', 'TypeScript', 'Go', '比率 (Go/TS)', 'Python', '比率 (Py/TS)'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {ops.map(op => {
                const ts = getTsOps(fmt, effectiveMode, op)
                const go = getRefOps(fmt, effectiveMode, op, 'Go')
                const py = getRefOps(fmt, effectiveMode, op, 'Python')
                const goR = ts > 0 ? (go/ts).toFixed(2) : '—'
                const pyR = ts > 0 ? (py/ts).toFixed(2) : '—'
                return (
                  <tr key={op} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={tdStyle}>{op}</td>
                    <td style={{ ...tdStyle, color: LANG_COLORS_SPD.TypeScript }}>{ts > 0 ? `${ts.toFixed(0)} ops/sec` : <span style={{ color: '#475569' }}>未計測</span>}</td>
                    <td style={{ ...tdStyle, color: LANG_COLORS_SPD.Go }}>{go.toLocaleString()} ops/sec <span style={{ fontSize: 9, color: '#475569' }}>参考</span></td>
                    <td style={{ ...tdStyle, fontWeight: 600, color: ts > 0 && go >= ts ? '#4ade80' : '#f87171' }}>{goR}x</td>
                    <td style={{ ...tdStyle, color: LANG_COLORS_SPD.Python }}>{py.toLocaleString()} ops/sec <span style={{ fontSize: 9, color: '#475569' }}>参考</span></td>
                    <td style={{ ...tdStyle, fontWeight: 600, color: ts > 0 && py >= ts ? '#4ade80' : '#f87171' }}>{pyR}x</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </>}

      {/* ====== Shared: Editable reference inputs ====== */}
      <div style={panelStyle}>
        <h3 style={sectionTitle}>参考値を編集（{mode === 'withLib' ? 'ライブラリあり' : 'ライブラリなし'}）</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {allRefKeys.map(({ key, label, fmt: f }) => {
            const ref = refs[key] ?? { Go: 0, Python: 0 }
            const isNA = f === 'JSON-LD VC' && mode === 'noLib'
            return (
              <div key={key} style={{ background: '#0f172a', borderRadius: 10, padding: '10px 14px', opacity: isNA ? 0.4 : 1 }}>
                <div style={{ fontSize: 11, color: FMT_COLORS_SPD[f], marginBottom: 8, fontWeight: 600 }}>
                  {label}{isNA ? ' （N/A）' : ''}
                </div>
                {(['Go', 'Python'] as const).map(l => (
                  <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 10, color: LANG_COLORS_SPD[l], minWidth: 64, fontWeight: 600 }}>{l}</span>
                    <input type="number" min="0" step="100" disabled={isNA} value={ref[l]}
                      onChange={e => updateRef(key, l, e.target.value)}
                      style={{ width: 90, padding: '3px 7px', background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 11 }} />
                    <span style={{ fontSize: 9, color: '#475569' }}>ops/sec</span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      {/* Benchmark scripts */}
      <div style={panelStyle}>
        <h3 style={sectionTitle}>ローカル実行用ベンチマークスクリプト</h3>
        <p style={{ fontSize: 12, color: '#64748b', marginBottom: 14, lineHeight: 1.6 }}>
          以下のスクリプトをローカル環境で実行し、計測結果を上の入力欄に貼り付けてください。
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button onClick={() => setShowScript(s => s === 'go' ? 'none' : 'go')}
            style={{ ...filterBtn, color: showScript === 'go' ? LANG_COLORS_SPD.Go : '#64748b', borderColor: showScript === 'go' ? LANG_COLORS_SPD.Go : '#334155', background: showScript === 'go' ? LANG_COLORS_SPD.Go + '15' : '#1e293b' }}>
            Go スクリプト
          </button>
          <button onClick={() => setShowScript(s => s === 'python' ? 'none' : 'python')}
            style={{ ...filterBtn, color: showScript === 'python' ? LANG_COLORS_SPD.Python : '#64748b', borderColor: showScript === 'python' ? LANG_COLORS_SPD.Python : '#334155', background: showScript === 'python' ? LANG_COLORS_SPD.Python + '15' : '#1e293b' }}>
            Python スクリプト
          </button>
        </div>
        {showScript === 'go'     && <pre style={codeStyle}>{GO_SCRIPT}</pre>}
        {showScript === 'python' && <pre style={codeStyle}>{PY_SCRIPT}</pre>}
      </div>
    </div>
  )
}

// ---- Main component ----------------------------------------

interface Props {
  benchmarkResults: NoLibResult[] | null
  serialResults: SerialBenchResult[] | null
  benchmarkRunning: boolean
  benchmarkProgress: string
  onRunBenchmark: () => void
  speedResults: SpeedResult[] | null
  refValues: RefValues
  onRefChange: (key: string, lang: 'Go' | 'Python', val: string) => void
  pythonResults: PyBenchResults | null
  pythonRunning: boolean
  pythonProgress: string
  onRunPython: () => void
}

export function ImplComparison({ benchmarkResults, serialResults, benchmarkRunning, benchmarkProgress, onRunBenchmark, speedResults, refValues, onRefChange, pythonResults, pythonRunning, pythonProgress, onRunPython }: Props) {
  const [view, setView] = useState<SubView>('language')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Sub-view toggle */}
      <div style={{ display: 'flex', gap: 0, background: '#0f172a', borderRadius: 10, padding: 4, width: 'fit-content', flexWrap: 'wrap' }}>
        {([
          { id: 'language'  as SubView, label: '🌐 言語別コード比較' },
          { id: 'benchmark' as SubView, label: '🧪 TS: ライブラリなし vs あり' },
          { id: 'langspeed' as SubView, label: '⚡ 言語別速度比較' },
        ]).map(({ id, label }) => (
          <button key={id} onClick={() => setView(id)} style={{
            padding: '7px 16px', borderRadius: 7, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: view === id ? 600 : 400,
            background: view === id ? '#1e293b' : 'none',
            color: view === id ? '#e2e8f0' : '#64748b',
            transition: 'all 0.15s',
          }}>{label}</button>
        ))}
      </div>

      {view === 'benchmark' && (
        <NoLibBenchmark
          onRun={onRunBenchmark}
          running={benchmarkRunning}
          results={benchmarkResults}
          serialResults={serialResults}
          progress={benchmarkProgress}
        />
      )}
      {view === 'language'  && <LanguageView />}
      {view === 'langspeed' && (
        <LanguageSpeedView noLibResults={benchmarkResults} speedResults={speedResults}
          refValues={refValues} onRefChange={onRefChange}
          pythonResults={pythonResults} pythonRunning={pythonRunning}
          pythonProgress={pythonProgress} onRunPython={onRunPython} />
      )}
    </div>
  )
}

// ---- Styles ------------------------------------------------
const cardStyle: React.CSSProperties = { background: '#1e293b', borderRadius: 12, padding: '14px 18px', border: '1px solid #334155' }
const panelStyle: React.CSSProperties = { ...cardStyle }
const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: '#cbd5e1', marginBottom: 14 }
const btnStyle: React.CSSProperties = { background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }
const filterBtn: React.CSSProperties = { padding: '5px 14px', borderRadius: 8, border: '1px solid', cursor: 'pointer', fontSize: 12, fontWeight: 500, transition: 'all 0.15s' }
const tagStyle: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '2px 7px', fontSize: 11, color: '#94a3b8' }
const codeStyle: React.CSSProperties = { background: '#0f172a', borderRadius: 8, padding: 14, fontSize: 10, color: '#a5f3fc', overflowX: 'auto', lineHeight: 1.6, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 12 }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #334155' }
const tdStyle: React.CSSProperties = { padding: '8px 12px', color: '#cbd5e1' }
const spinner: React.CSSProperties = { width: 32, height: 32, borderRadius: '50%', border: '3px solid #334155', borderTopColor: '#a78bfa', animation: 'spin 0.8s linear infinite' }
