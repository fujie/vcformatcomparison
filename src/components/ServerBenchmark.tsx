/**
 * ServerBenchmark — バックエンド計測タブ
 *
 * ブラウザから /api/bench/start を POST してジョブを開始し、
 * SSE (/api/bench/stream/:jobId) で進捗をリアルタイム受信。
 * 結果を Node.js / Python / Go 別に表にまとめて表示。
 * process.hrtime.bigint() / time.perf_counter_ns() / time.Now().UnixNano() 使用。
 */

import React, { useState, useRef } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

// ── Types ───────────────────────────────────────────────────────────────────

interface BenchEntry {
  opsPerSec: number
  avgMs: number
  avgNs?: number
  iterations: number
  isActual?: boolean
}

interface LangResult {
  results?: Record<string, BenchEntry>
  errors?: Record<string, string>
  iterations?: number
  runtimeInfo?: string
  error?: string
}

interface JobResult {
  jobId: string
  status: 'pending' | 'running' | 'done' | 'error'
  progress: string[]
  nodeResult?: LangResult
  pythonResult?: LangResult
  goResult?: LangResult
  error?: string
  durationMs?: number
}

// ── Key ordering / display ──────────────────────────────────────────────────

const RESULT_KEYS = [
  'SD-JWT VC-noLib-sign', 'SD-JWT VC-noLib-verify',
  'SD-JWT VC-withLib-sign', 'SD-JWT VC-withLib-verify',
  'JSON-LD VC-noLib-sign', 'JSON-LD VC-noLib-verify',
  'JSON-LD VC-withLib-sign', 'JSON-LD VC-withLib-verify',
  'mdoc-noLib-sign', 'mdoc-noLib-verify',
  'mdoc-withLib-sign', 'mdoc-withLib-verify',
]

const FORMAT_COLORS: Record<string, string> = {
  'SD-JWT VC': '#60a5fa',
  'JSON-LD VC': '#34d399',
  'mdoc': '#f97316',
}

function getFormat(key: string): string {
  if (key.startsWith('SD-JWT')) return 'SD-JWT VC'
  if (key.startsWith('JSON-LD')) return 'JSON-LD VC'
  return 'mdoc'
}

function getLib(key: string): string {
  return key.includes('noLib') ? 'no-lib' : 'with-lib'
}

function getOp(key: string): string {
  return key.endsWith('-sign') ? 'Sign' : 'Verify'
}

// ── Styles ──────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: '1.2rem 1.5rem', marginBottom: '1rem',
}
const th: React.CSSProperties = {
  textAlign: 'left', padding: '6px 10px', fontSize: 12, color: '#94a3b8',
  borderBottom: '1px solid #334155', whiteSpace: 'nowrap',
}
const td: React.CSSProperties = {
  padding: '5px 10px', fontSize: 12, borderBottom: '1px solid #1e293b',
}
const badge = (col: string): React.CSSProperties => ({
  display: 'inline-block', padding: '1px 6px', borderRadius: 4,
  background: col + '22', color: col, fontSize: 11, fontWeight: 600,
})

// ── Sub-components ──────────────────────────────────────────────────────────

function ResultTable({ lang, data }: { lang: string; data: LangResult }) {
  if (data.error) {
    return <p style={{ color: '#ef4444', fontSize: 13 }}>⚠ {data.error}</p>
  }
  const results = data.results ?? {}
  if (Object.keys(results).length === 0) {
    return <p style={{ color: '#94a3b8', fontSize: 13 }}>結果なし</p>
  }

  // find max for bar scaling
  const maxOps = Math.max(...Object.values(results).map(r => r.opsPerSec))

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={th}>キー</th>
          <th style={th}>ライブラリ</th>
          <th style={th}>操作</th>
          <th style={{ ...th, textAlign: 'right' }}>ops/sec</th>
          <th style={{ ...th, textAlign: 'right' }}>avg ms</th>
          <th style={{ ...th, textAlign: 'right' }}>avg ns</th>
          <th style={th}>速度バー</th>
        </tr>
      </thead>
      <tbody>
        {RESULT_KEYS.map(k => {
          const r = results[k]
          if (!r) return null
          const fmt = getFormat(k)
          const col = FORMAT_COLORS[fmt]
          const barW = Math.max(2, Math.round((r.opsPerSec / maxOps) * 200))
          return (
            <tr key={k} style={{ background: '#0f172a' }}>
              <td style={td}><span style={badge(col)}>{fmt}</span></td>
              <td style={{ ...td, color: '#94a3b8', fontSize: 11 }}>{getLib(k)}</td>
              <td style={{ ...td, color: '#e2e8f0', fontSize: 11 }}>{getOp(k)}</td>
              <td style={{ ...td, textAlign: 'right', color: '#f8fafc', fontVariantNumeric: 'tabular-nums' }}>
                {r.opsPerSec.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}
              </td>
              <td style={{ ...td, textAlign: 'right', color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
                {r.avgMs.toFixed(4)}
              </td>
              <td style={{ ...td, textAlign: 'right', color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
                {r.avgNs != null ? Math.round(r.avgNs).toLocaleString() : '—'}
              </td>
              <td style={td}>
                <div style={{ background: col, height: 10, width: barW, borderRadius: 3 }} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── Chart data ──────────────────────────────────────────────────────────────

function buildChartData(
  nodeResult?: LangResult,
  pythonResult?: LangResult,
  goResult?: LangResult,
) {
  return RESULT_KEYS
    .filter(k => {
      const any = nodeResult?.results?.[k] || pythonResult?.results?.[k] || goResult?.results?.[k]
      return !!any
    })
    .map(k => ({
      name: k.replace(' VC', '').replace('-noLib', '').replace('-withLib', ' (lib)'),
      'Node.js': nodeResult?.results?.[k]?.opsPerSec ?? 0,
      'Python': pythonResult?.results?.[k]?.opsPerSec ?? 0,
      'Go': goResult?.results?.[k]?.opsPerSec ?? 0,
    }))
}

// ── Main component ──────────────────────────────────────────────────────────

export default function ServerBenchmark() {
  const [iterations, setIterations] = useState(200)
  const [doNode, setDoNode] = useState(true)
  const [doPython, setDoPython] = useState(true)
  const [doGo, setDoGo] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<string[]>([])
  const [result, setResult] = useState<JobResult | null>(null)
  const [activeTab, setActiveTab] = useState<'node' | 'python' | 'go' | 'chart'>('chart')
  const [health, setHealth] = useState<{ ok: boolean; node?: string } | null>(null)
  const progressRef = useRef<HTMLDivElement>(null)

  // Check backend health on mount
  React.useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(d => setHealth(d))
      .catch(() => setHealth({ ok: false }))
  }, [])

  const startBenchmark = async () => {
    if (running) return
    setRunning(true)
    setProgress([])
    setResult(null)

    try {
      const r = await fetch('/api/bench/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iterations, runNode: doNode, runPython: doPython, runGo: doGo }),
      })
      const { jobId } = await r.json() as { jobId: string }

      // SSE stream
      const es = new EventSource(`/api/bench/stream/${jobId}`)

      es.addEventListener('progress', (e) => {
        const { message } = JSON.parse((e as MessageEvent).data)
        setProgress(p => {
          const next = [...p, message]
          setTimeout(() => progressRef.current?.scrollTo(0, 1e9), 50)
          return next
        })
      })

      es.addEventListener('done', (e) => {
        const data = JSON.parse((e as MessageEvent).data) as JobResult
        setResult(data)
        setRunning(false)
        es.close()
      })

      es.onerror = () => {
        setProgress(p => [...p, '接続エラー — ポーリングにフォールバック'])
        es.close()
        // Poll once more
        setTimeout(async () => {
          const pr = await fetch(`/api/bench/result/${jobId}`)
          const data = await pr.json() as JobResult
          setResult(data)
          setRunning(false)
        }, 1000)
      }
    } catch (e) {
      setProgress(p => [...p, `エラー: ${e}`])
      setRunning(false)
    }
  }

  const chartData = result
    ? buildChartData(result.nodeResult, result.pythonResult, result.goResult)
    : []

  const tabStyle = (t: string): React.CSSProperties => ({
    padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
    background: activeTab === t ? '#3b82f6' : '#1e293b',
    color: activeTab === t ? '#fff' : '#94a3b8',
    border: 'none', marginRight: 6,
  })

  return (
    <div style={{ padding: '1.5rem', color: '#e2e8f0', maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#f8fafc' }}>
          🖥 バックエンド精密計測
        </h2>
        <p style={{ margin: '0.4rem 0 0', color: '#94a3b8', fontSize: 13 }}>
          Node.js <code style={{ color: '#60a5fa' }}>process.hrtime.bigint()</code>、
          Python <code style={{ color: '#34d399' }}>time.perf_counter_ns()</code>、
          Go <code style={{ color: '#f97316' }}>time.Now().UnixNano()</code> によるナノ秒精度計測。
          ブラウザ JIT 最適化の影響を排除した実測値です。
        </p>
      </div>

      {/* Backend status */}
      <div style={{ ...card, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 13, color: '#94a3b8' }}>バックエンドサーバー:</span>
        {health === null
          ? <span style={{ color: '#fbbf24', fontSize: 13 }}>確認中...</span>
          : health.ok
            ? <span style={{ color: '#34d399', fontSize: 13 }}>✓ 接続済み ({health.node})</span>
            : <span style={{ color: '#ef4444', fontSize: 13 }}>
                ✗ 未起動 —&nbsp;
                <code style={{ fontSize: 11 }}>npm run server</code>
                &nbsp;を別ターミナルで実行してください
              </span>
        }
      </div>

      {/* Settings */}
      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>イテレーション数</div>
          <input
            type="number" min={50} max={2000} step={50} value={iterations}
            onChange={e => setIterations(Number(e.target.value))}
            style={{
              background: '#0f172a', border: '1px solid #334155', color: '#f8fafc',
              borderRadius: 6, padding: '5px 10px', width: 90, fontSize: 13,
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: '1.5rem' }}>
          {([['Node.js', doNode, setDoNode, '#60a5fa'],
             ['Python', doPython, setDoPython, '#34d399'],
             ['Go', doGo, setDoGo, '#f97316']] as [string, boolean, React.Dispatch<React.SetStateAction<boolean>>, string][])
            .map(([label, val, setter, col]) => (
            <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
              <input type="checkbox" checked={val} onChange={e => setter(e.target.checked)} />
              <span style={{ color: col, fontWeight: 600 }}>{label}</span>
            </label>
          ))}
        </div>
        <button
          onClick={startBenchmark}
          disabled={running || health?.ok === false}
          style={{
            background: running ? '#1e40af' : '#3b82f6',
            color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px',
            fontWeight: 700, fontSize: 14, cursor: running ? 'not-allowed' : 'pointer',
          }}
        >
          {running ? '⏳ 計測中...' : '▶ バックエンド計測開始'}
        </button>
        {result && !running && (
          <span style={{ fontSize: 12, color: '#64748b' }}>
            完了 {((result.durationMs ?? 0) / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {/* Progress log */}
      {(running || progress.length > 0) && (
        <div style={{ ...card }}>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>進捗ログ</div>
          <div
            ref={progressRef}
            style={{
              background: '#0f172a', borderRadius: 6, padding: '0.8rem 1rem',
              fontFamily: 'monospace', fontSize: 11, color: '#94a3b8',
              maxHeight: 180, overflowY: 'auto', lineHeight: 1.7,
            }}
          >
            {progress.map((msg, i) => (
              <div key={i} style={{ color: msg.includes('完了') || msg.includes('✅') ? '#34d399' : msg.includes('❌') || msg.includes('エラー') ? '#ef4444' : '#94a3b8' }}>
                {msg}
              </div>
            ))}
            {running && <div style={{ color: '#fbbf24' }}>⏳ 実行中...</div>}
          </div>
        </div>
      )}

      {/* Results */}
      {result && result.status === 'done' && (
        <>
          {/* Tab switcher */}
          <div style={{ marginBottom: '0.8rem', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <button style={tabStyle('chart')} onClick={() => setActiveTab('chart')}>📊 言語比較チャート</button>
            {result.nodeResult && <button style={tabStyle('node')} onClick={() => setActiveTab('node')}>🟦 Node.js</button>}
            {result.pythonResult && <button style={tabStyle('python')} onClick={() => setActiveTab('python')}>🐍 Python</button>}
            {result.goResult && <button style={tabStyle('go')} onClick={() => setActiveTab('go')}>🔵 Go</button>}
          </div>

          {/* Chart view */}
          {activeTab === 'chart' && chartData.length > 0 && (
            <div style={card}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#f8fafc', marginBottom: '1rem' }}>
                言語別 ops/sec 比較（Sign / Verify）
              </div>
              <ResponsiveContainer width="100%" height={380}>
                <BarChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }}
                    tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid #334155', fontSize: 12 }}
                    formatter={(v: number) => [v.toLocaleString('ja-JP', { maximumFractionDigits: 0 }) + ' ops/s', '']}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                  <Bar dataKey="Node.js" fill="#60a5fa" radius={[3,3,0,0]} />
                  <Bar dataKey="Python" fill="#34d399" radius={[3,3,0,0]} />
                  <Bar dataKey="Go" fill="#f97316" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>

              {/* Summary table */}
              <div style={{ marginTop: '1.5rem' }}>
                <SummaryTable
                  nodeResult={result.nodeResult}
                  pythonResult={result.pythonResult}
                  goResult={result.goResult}
                />
              </div>
            </div>
          )}

          {/* Language detail views */}
          {activeTab === 'node' && result.nodeResult && (
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                <span style={{ fontWeight: 600, color: '#60a5fa' }}>🟦 Node.js 詳細結果</span>
                <span style={{ fontSize: 11, color: '#64748b' }}>{result.nodeResult.runtimeInfo}</span>
              </div>
              <ResultTable lang="Node.js" data={result.nodeResult} />
            </div>
          )}
          {activeTab === 'python' && result.pythonResult && (
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                <span style={{ fontWeight: 600, color: '#34d399' }}>🐍 Python 詳細結果</span>
                <span style={{ fontSize: 11, color: '#64748b' }}>{result.pythonResult.runtimeInfo}</span>
              </div>
              <ResultTable lang="Python" data={result.pythonResult} />
            </div>
          )}
          {activeTab === 'go' && result.goResult && (
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                <span style={{ fontWeight: 600, color: '#f97316' }}>🔵 Go 詳細結果</span>
                <span style={{ fontSize: 11, color: '#64748b' }}>{result.goResult.runtimeInfo}</span>
              </div>
              <ResultTable lang="Go" data={result.goResult} />
            </div>
          )}

          {/* Env info */}
          <EnvInfo nodeResult={result.nodeResult} pythonResult={result.pythonResult} goResult={result.goResult} />
        </>
      )}

      {/* How-to note when server not running */}
      {!health?.ok && (
        <div style={{ ...card, borderColor: '#f97316', marginTop: '1rem' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#f97316', marginBottom: 8 }}>
            バックエンドサーバーの起動方法
          </div>
          <pre style={{ margin: 0, background: '#0f172a', borderRadius: 6, padding: '0.8rem', fontSize: 12, color: '#e2e8f0', overflowX: 'auto' }}>{`# 別ターミナルで実行:
npm run server

# または Vite + サーバーを同時起動:
npm run dev:full

# Python ライブラリ (オプション):
pip install pyld cbor2

# Go バイナリのビルド (初回のみ):
npm run go:build`}</pre>
        </div>
      )}
    </div>
  )
}

// ── Summary table (all 3 languages side by side) ────────────────────────────

function SummaryTable({
  nodeResult, pythonResult, goResult,
}: {
  nodeResult?: LangResult
  pythonResult?: LangResult
  goResult?: LangResult
}) {
  const keys = RESULT_KEYS.filter(k =>
    nodeResult?.results?.[k] || pythonResult?.results?.[k] || goResult?.results?.[k])

  const fmt = (v?: number) => v ? v.toLocaleString('ja-JP', { maximumFractionDigits: 0 }) : '—'

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#f8fafc', marginBottom: 8 }}>
        3 言語比較サマリー (ops/sec)
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={th}>フォーマット</th>
              <th style={th}>ライブラリ</th>
              <th style={th}>操作</th>
              <th style={{ ...th, textAlign: 'right', color: '#60a5fa' }}>Node.js</th>
              <th style={{ ...th, textAlign: 'right', color: '#34d399' }}>Python</th>
              <th style={{ ...th, textAlign: 'right', color: '#f97316' }}>Go</th>
              <th style={th}>Go / Node 倍率</th>
            </tr>
          </thead>
          <tbody>
            {keys.map(k => {
              const nOps = nodeResult?.results?.[k]?.opsPerSec
              const pOps = pythonResult?.results?.[k]?.opsPerSec
              const gOps = goResult?.results?.[k]?.opsPerSec
              const ratio = nOps && gOps ? (gOps / nOps).toFixed(1) : '—'
              const col = FORMAT_COLORS[getFormat(k)]
              return (
                <tr key={k} style={{ background: '#0f172a' }}>
                  <td style={td}><span style={badge(col)}>{getFormat(k)}</span></td>
                  <td style={{ ...td, color: '#94a3b8' }}>{getLib(k)}</td>
                  <td style={{ ...td, color: '#e2e8f0' }}>{getOp(k)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#60a5fa', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(nOps)}
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: '#34d399', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(pOps)}
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: '#f97316', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(gOps)}
                  </td>
                  <td style={{ ...td, color: '#94a3b8' }}>
                    {ratio !== '—' ? `× ${ratio}` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Env info ─────────────────────────────────────────────────────────────────

function EnvInfo({ nodeResult, pythonResult, goResult }: {
  nodeResult?: LangResult; pythonResult?: LangResult; goResult?: LangResult
}) {
  return (
    <div style={{ ...card, marginTop: '1rem' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#f8fafc', marginBottom: 8 }}>
        実行環境
      </div>
      <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
        <tbody>
          {[
            ['Node.js', nodeResult?.runtimeInfo ?? '—', '#60a5fa'],
            ['Python', pythonResult?.runtimeInfo ?? '—', '#34d399'],
            ['Go', goResult?.runtimeInfo ?? '—', '#f97316'],
          ].map(([lang, info, col]) => (
            <tr key={lang}>
              <td style={{ ...td, color: col as string, fontWeight: 600, paddingRight: 20 }}>{lang}</td>
              <td style={{ ...td, color: '#94a3b8' }}>{info}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...td, color: '#94a3b8', fontWeight: 600, paddingRight: 20 }}>計測精度</td>
            <td style={{ ...td, color: '#94a3b8' }}>
              Node.js: process.hrtime.bigint() (ns) / Python: time.perf_counter_ns() (ns) / Go: time.Now().UnixNano() (ns)
            </td>
          </tr>
          <tr>
            <td style={{ ...td, color: '#94a3b8', fontWeight: 600, paddingRight: 20 }}>ウォームアップ</td>
            <td style={{ ...td, color: '#94a3b8' }}>3 iterations（計測前に 3 回実行して JIT / キャッシュを安定化）</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
