import { useState, useCallback, useRef, useEffect } from 'react'
import type { SpeedResult } from './benchmarks/signatureSpeed'
import type { ComplexityMetric } from './benchmarks/deserializationComplexity'
import type { SecurityTest } from './benchmarks/normalizationSecurity'
import type { NoLibResult, SerialBenchResult } from './benchmarks/noLibrary'
import type { ScalingBenchResults } from './benchmarks/scalingBenchmarks'
import { DEFAULT_REF } from './data/referenceValues'
import type { RefValues } from './data/referenceValues'
import type { PyBenchResults } from './lib/pyodideRunner'
import type { GoBenchResults } from './lib/goRunner'
import type { BenchMode, BackendJobResult } from './types/backendResult'
import { SpeedResults } from './components/SpeedResults'
import { ComplexityResults } from './components/ComplexityResults'
import { SecurityResults } from './components/SecurityResults'
import { ImplComparison } from './components/ImplComparison'
import { ScalingResults } from './components/ScalingResults'
import { ReportView } from './components/ReportView'

type Tab = 'speed' | 'complexity' | 'security' | 'impl' | 'scaling' | 'report'
type Status = 'idle' | 'running' | 'done' | 'error'

const TABS: { id: Tab; label: string; icon: string; desc: string }[] = [
  { id: 'speed',      icon: '⚡', label: '署名検証速度',       desc: 'sign/verify のops/sec & レイテンシ' },
  { id: 'complexity', icon: '📐', label: 'デシリアライズ複雑性', desc: 'LOC・非同期ステップ・循環的複雑度' },
  { id: 'security',   icon: '🔐', label: '正規化セキュリティ',   desc: 'DoS・SSRF・インジェクション定量評価' },
  { id: 'impl',       icon: '🔤', label: '実装比較',             desc: 'Go・Python・TS / ライブラリなし実装' },
  { id: 'scaling',    icon: '📊', label: '詳細分析',             desc: '属性数スケーリング・選択的開示・Ed25519統一' },
  { id: 'report',     icon: '📋', label: '結果レポート',         desc: '一覧表示・JSON/CSV/Markdown エクスポート' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('speed')
  const [iterations, setIterations] = useState(50)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  // ── Execution mode ──────────────────────────────────────────────────────────
  const [benchMode, setBenchMode] = useState<BenchMode>('frontend')
  const [backendResult, setBackendResult] = useState<BackendJobResult | null>(null)
  const [backendRunning, setBackendRunning] = useState(false)
  const [backendProgress, setBackendProgress] = useState<string[]>([])
  const [backendHealth, setBackendHealth] = useState<boolean | null>(null)

  // ── Frontend state ──────────────────────────────────────────────────────────
  const [speedResults, setSpeedResults] = useState<SpeedResult[] | null>(null)
  const [complexityResults, setComplexityResults] = useState<ComplexityMetric[] | null>(null)
  const [securityResults, setSecurityResults] = useState<SecurityTest[] | null>(null)
  const [noLibResults, setNoLibResults] = useState<NoLibResult[] | null>(null)
  const [serialResults, setSerialResults] = useState<SerialBenchResult[] | null>(null)
  const [noLibRunning, setNoLibRunning] = useState(false)
  const [noLibProgress, setNoLibProgress] = useState('')
  const [refValues, setRefValues] = useState<RefValues>(DEFAULT_REF)
  const [pythonResults, setPythonResults] = useState<PyBenchResults | null>(null)
  const [pythonRunning, setPythonRunning] = useState(false)
  const [pythonProgress, setPythonProgress] = useState('')
  const [goResults, setGoResults] = useState<GoBenchResults | null>(null)
  const [goRunning, setGoRunning] = useState(false)
  const [goProgress, setGoProgress] = useState('')
  const [scalingResults, setScalingResults] = useState<ScalingBenchResults | null>(null)
  const [scalingRunning, setScalingRunning] = useState(false)
  const [scalingProgress, setScalingProgress] = useState('')

  const hasAutoRun = useRef(false)

  // Check backend health when switching to backend mode
  const checkBackendHealth = useCallback(async () => {
    try {
      const r = await fetch('/api/health', { signal: AbortSignal.timeout(2000) })
      setBackendHealth(r.ok)
      return r.ok
    } catch {
      setBackendHealth(false)
      return false
    }
  }, [])

  const handleModeChange = useCallback((mode: BenchMode) => {
    setBenchMode(mode)
    if (mode === 'backend') checkBackendHealth()
  }, [checkBackendHealth])

  // ── Backend benchmark runner ────────────────────────────────────────────────
  const runBackendBenchmarks = useCallback(async () => {
    if (backendRunning) return
    setBackendRunning(true)
    setBackendProgress([])
    setBackendResult(null)

    const addProgress = (msg: string) =>
      setBackendProgress(p => [...p, msg])

    try {
      const r = await fetch('/api/bench/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          iterations,
          runNode: true, runPython: true, runGo: true,
          runComplexity: true, runSecurity: true,
        }),
      })
      const { jobId } = await r.json() as { jobId: string }

      const es = new EventSource(`/api/bench/stream/${jobId}`)
      es.addEventListener('progress', (e) => {
        const { message } = JSON.parse((e as MessageEvent).data)
        addProgress(message)
      })
      es.addEventListener('done', (e) => {
        const data = JSON.parse((e as MessageEvent).data) as BackendJobResult
        setBackendResult(data)
        setBackendRunning(false)
        es.close()
      })
      es.onerror = () => {
        addProgress('SSE接続エラー — ポーリングにフォールバック')
        es.close()
        setTimeout(async () => {
          try {
            const pr = await fetch(`/api/bench/result/${jobId}`)
            const data = await pr.json() as BackendJobResult
            setBackendResult(data)
          } catch { /* ignore */ }
          setBackendRunning(false)
        }, 1000)
      }
    } catch (e) {
      addProgress(`エラー: ${e}`)
      setBackendRunning(false)
    }
  }, [backendRunning, iterations])

  // ── Frontend benchmark runner ───────────────────────────────────────────────
  const runFrontendBenchmarks = useCallback(async () => {
    setStatus('running')
    setError('')
    setProgress('ベンチマークを開始しています...')

    try {
      const { runSpeedBenchmarks } = await import('./benchmarks/signatureSpeed')
      const { runComplexityAnalysis } = await import('./benchmarks/deserializationComplexity')
      const { runSecurityTests } = await import('./benchmarks/normalizationSecurity')

      setProgress('[1/5] 署名検証速度ベンチマーク実行中...')
      const speed = await runSpeedBenchmarks(iterations, setProgress)
      setSpeedResults(speed)

      setProgress('[2/5] デシリアライズ複雑性分析中...')
      const complexity = await runComplexityAnalysis(setProgress)
      setComplexityResults(complexity)

      setProgress('[3/5] セキュリティテスト実行中...')
      const security = await runSecurityTests(setProgress)
      setSecurityResults(security)

      setProgress('[4/5] Go WASM 実測中...')
      try {
        const { runGoBenchmark } = await import('./lib/goRunner')
        const goRes = await runGoBenchmark((msg) => setProgress(`[4/5] Go: ${msg}`))
        setGoResults(goRes)
      } catch (e) {
        setProgress(`Go WASM スキップ: ${(e as Error).message}`)
      }

      setProgress('[5/5] Python (Pyodide) 実測中...')
      try {
        const { runPythonBenchmark } = await import('./lib/pyodideRunner')
        const pyRes = await runPythonBenchmark((msg) => setProgress(`[5/5] Python: ${msg}`))
        setPythonResults(pyRes)
      } catch (e) {
        setProgress(`Python スキップ: ${(e as Error).message}`)
      }

      setStatus('done')
      setProgress('すべてのテスト完了')
    } catch (e) {
      setStatus('error')
      setError((e as Error).message)
      console.error(e)
    }
  }, [iterations])

  // ── Unified run handler ─────────────────────────────────────────────────────
  const runBenchmarks = useCallback(async () => {
    if (benchMode === 'backend') {
      await runBackendBenchmarks()
    } else {
      await runFrontendBenchmarks()
    }
  }, [benchMode, runBackendBenchmarks, runFrontendBenchmarks])

  // ── Derived state ───────────────────────────────────────────────────────────
  const isBusy = benchMode === 'backend' ? backendRunning : status === 'running'
  const hasDone = benchMode === 'backend'
    ? backendResult?.status === 'done'
    : status === 'done'

  const handleRefChange = useCallback((key: string, lang: 'Go' | 'Python', val: string) => {
    const n = parseFloat(val)
    if (!isNaN(n) && n >= 0)
      setRefValues(prev => ({ ...prev, [key]: { ...prev[key], [lang]: n } }))
  }, [])

  const runPythonBench = useCallback(async () => {
    setPythonRunning(true)
    setPythonProgress('準備中...')
    try {
      const { runPythonBenchmark } = await import('./lib/pyodideRunner')
      const results = await runPythonBenchmark((msg) => setPythonProgress(msg))
      setPythonResults(results)
      setPythonProgress(`完了 — ${Object.keys(results).length} 項目計測`)
    } catch (e) {
      setPythonProgress(`エラー: ${(e as Error).message}`)
    } finally {
      setPythonRunning(false)
    }
  }, [])

  const runGoBench = useCallback(async () => {
    setGoRunning(true)
    setGoProgress('準備中...')
    try {
      const { runGoBenchmark } = await import('./lib/goRunner')
      const results = await runGoBenchmark((msg) => setGoProgress(msg))
      setGoResults(results)
      setGoProgress(`完了 — ${Object.keys(results).length} 項目計測`)
    } catch (e) {
      setGoProgress(`エラー: ${(e as Error).message}`)
    } finally {
      setGoRunning(false)
    }
  }, [])

  const runScaling = useCallback(async () => {
    setScalingRunning(true)
    setScalingProgress('準備中...')
    try {
      const { runScalingBenchmarks } = await import('./benchmarks/scalingBenchmarks')
      const results = await runScalingBenchmarks(50, setScalingProgress)
      setScalingResults(results)
      setScalingProgress('完了')
    } catch (e) {
      setScalingProgress(`エラー: ${(e as Error).message}`)
    } finally {
      setScalingRunning(false)
    }
  }, [])

  const runNoLib = useCallback(async () => {
    setNoLibRunning(true)
    setNoLibProgress('準備中...')
    try {
      const { runNoLibBenchmarks, runSerialBenchmarks } = await import('./benchmarks/noLibrary')
      setNoLibProgress('[1/4] TypeScript 署名速度ベンチマーク中...')
      const results = await runNoLibBenchmarks(iterations, setNoLibProgress)
      setNoLibResults(results)
      setNoLibProgress('[2/4] シリアライズ速度ベンチマーク中...')
      const serial = await runSerialBenchmarks(200)
      setSerialResults(serial)
      setNoLibProgress('[3/4] Go WASM 実測中...')
      try {
        const { runGoBenchmark } = await import('./lib/goRunner')
        const goRes = await runGoBenchmark((msg) => setNoLibProgress(`[3/4] Go: ${msg}`))
        setGoResults(goRes)
      } catch (e) {
        setNoLibProgress(`Go WASM エラー: ${(e as Error).message}`)
      }
      setNoLibProgress('[4/4] Python (Pyodide) 実測中...')
      try {
        const { runPythonBenchmark } = await import('./lib/pyodideRunner')
        const pyRes = await runPythonBenchmark((msg) => setNoLibProgress(`[4/4] Python: ${msg}`))
        setPythonResults(pyRes)
      } catch (e) {
        setNoLibProgress(`Python エラー: ${(e as Error).message}`)
      }
      setNoLibProgress('完了')
    } catch (e) {
      setNoLibProgress(`エラー: ${(e as Error).message}`)
    } finally {
      setNoLibRunning(false)
    }
  }, [iterations])

  return (
    <div style={appStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={headerInner}>
          <div>
            <h1 style={h1Style}>VC Format Comparison Tool</h1>
            <p style={subtitleStyle}>
              SD-JWT VC / JSON-LD VC (W3C VCDM 2.0) / mdoc (ISO 18013-5) — 定量的比較分析
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Mode toggle */}
            <div style={toggleWrap}>
              <button
                onClick={() => handleModeChange('frontend')}
                style={{ ...toggleBtn, ...(benchMode === 'frontend' ? toggleBtnActiveFront : {}) }}
              >
                🌐 ブラウザ
              </button>
              <button
                onClick={() => handleModeChange('backend')}
                style={{ ...toggleBtn, ...(benchMode === 'backend' ? toggleBtnActiveBack : {}) }}
              >
                🖥 バックエンド
              </button>
            </div>

            {/* Backend health indicator */}
            {benchMode === 'backend' && (
              <span style={{ fontSize: 11, color: backendHealth === false ? '#ef4444' : backendHealth === true ? '#34d399' : '#64748b' }}>
                {backendHealth === false ? '⚠ サーバー未起動' : backendHealth === true ? '✓ 接続済み' : '確認中...'}
              </span>
            )}

            {benchMode === 'frontend' && (
              <label style={{ fontSize: 12, color: '#64748b' }}>
                イテレーション数
                <select value={iterations} onChange={(e) => setIterations(Number(e.target.value))}
                  style={selectStyle} disabled={isBusy}>
                  {[20, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}
            {benchMode === 'backend' && (
              <label style={{ fontSize: 12, color: '#64748b' }}>
                イテレーション数
                <select value={iterations} onChange={(e) => setIterations(Number(e.target.value))}
                  style={selectStyle} disabled={isBusy}>
                  {[50, 100, 200, 500].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}

            <button
              onClick={runBenchmarks}
              disabled={isBusy || (benchMode === 'backend' && backendHealth === false)}
              style={{ ...btnStyle, ...(isBusy ? btnDisabledStyle : benchMode === 'backend' ? btnBackStyle : btnActiveStyle) }}
            >
              {isBusy
                ? (benchMode === 'backend' ? '⏳ バックエンド計測中...' : '実行中...')
                : hasDone
                  ? '再実行'
                  : benchMode === 'backend' ? '🖥 バックエンド計測実行' : 'ベンチマーク実行'}
            </button>
          </div>
        </div>

        {/* Progress / status — Frontend */}
        {benchMode === 'frontend' && status === 'running' && (
          <div style={progressBarWrap}>
            <div style={progressBar} />
            <span style={{ fontSize: 12, color: '#60a5fa', marginLeft: 12 }}>{progress}</span>
          </div>
        )}
        {benchMode === 'frontend' && status === 'error' && (
          <div style={{ padding: '8px 16px', background: '#7f1d1d', color: '#fca5a5', fontSize: 13, borderTop: '1px solid #dc2626' }}>
            エラー: {error}
          </div>
        )}
        {benchMode === 'frontend' && status === 'done' && (
          <div style={{ padding: '6px 16px', background: '#14532d', color: '#86efac', fontSize: 12, borderTop: '1px solid #22c55e' }}>
            ✓ {progress}
          </div>
        )}

        {/* Progress — Backend */}
        {benchMode === 'backend' && backendRunning && (
          <div style={progressBarWrap}>
            <div style={progressBar} />
            <span style={{ fontSize: 12, color: '#f97316', marginLeft: 12 }}>
              {backendProgress[backendProgress.length - 1] ?? '準備中...'}
            </span>
          </div>
        )}
        {benchMode === 'backend' && backendResult?.status === 'done' && (
          <div style={{ padding: '6px 16px', background: '#172554', color: '#93c5fd', fontSize: 12, borderTop: '1px solid #3b82f6' }}>
            ✓ バックエンド計測完了 ({((backendResult.durationMs ?? 0) / 1000).toFixed(1)}s) — Node.js / Python / Go
          </div>
        )}
        {benchMode === 'backend' && backendHealth === false && !backendRunning && (
          <div style={{ padding: '7px 16px', background: '#451a03', color: '#fed7aa', fontSize: 12, borderTop: '1px solid #f97316' }}>
            ⚠ バックエンドサーバー未起動 — ターミナルで <code style={{ background: '#0f172a', padding: '1px 6px', borderRadius: 4 }}>npm run server</code> を実行してください
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={tabBarStyle}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ ...tabBtnStyle, ...(tab === t.id ? tabBtnActiveStyle : {}) }}>
            <span style={{ fontSize: 16 }}>{t.icon}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: tab === t.id ? 600 : 400 }}>{t.label}</div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>{t.desc}</div>
            </div>
          </button>
        ))}
        {/* Mode badge in tab bar */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', paddingRight: 8 }}>
          <span style={{
            fontSize: 11, padding: '3px 8px', borderRadius: 6,
            background: benchMode === 'backend' ? '#f97316' + '22' : '#3b82f6' + '22',
            color: benchMode === 'backend' ? '#f97316' : '#60a5fa',
            border: `1px solid ${benchMode === 'backend' ? '#f97316' : '#3b82f6'}44`,
          }}>
            {benchMode === 'backend' ? '🖥 バックエンド' : '🌐 ブラウザ'}
          </span>
        </div>
      </div>

      {/* Content */}
      <div style={contentStyle}>
        {/* 実装比較タブ — 常に表示 */}
        {tab === 'impl' && (
          <ImplComparison
            benchmarkResults={noLibResults}
            serialResults={serialResults}
            benchmarkRunning={noLibRunning}
            benchmarkProgress={noLibProgress}
            onRunBenchmark={runNoLib}
            speedResults={speedResults}
            refValues={refValues}
            onRefChange={handleRefChange}
            pythonResults={pythonResults}
            pythonRunning={pythonRunning}
            pythonProgress={pythonProgress}
            onRunPython={runPythonBench}
            goResults={goResults}
            goRunning={goRunning}
            goProgress={goProgress}
            onRunGo={runGoBench}
            benchMode={benchMode}
            backendResult={backendResult}
          />
        )}

        {/* 詳細分析タブ — 常に表示 */}
        {tab === 'scaling' && (
          <ScalingResults
            results={scalingResults}
            running={scalingRunning}
            progress={scalingProgress}
            onRun={runScaling}
          />
        )}

        {/* 結果レポートタブ — 常に表示 */}
        {tab === 'report' && (
          <ReportView
            speedResults={speedResults}
            complexityResults={complexityResults}
            securityResults={securityResults}
            noLibResults={noLibResults}
            serialResults={serialResults}
            scalingResults={scalingResults}
            iterations={iterations}
            refValues={refValues}
            pythonResults={pythonResults}
            goResults={goResults}
            benchMode={benchMode}
            backendResult={backendResult}
          />
        )}

        {/* Speed / Complexity / Security tabs */}
        {tab !== 'impl' && tab !== 'report' && tab !== 'scaling' && (
          <>
            {/* Empty state */}
            {!hasDone && !isBusy && (
              <EmptyState />
            )}

            {/* Loading */}
            {isBusy && (
              <>
                {tab === 'speed'      && <LoadingPlaceholder label="署名検証速度を計測中..." />}
                {tab === 'complexity' && <LoadingPlaceholder label="デシリアライズ複雑性を分析中..." />}
                {tab === 'security'   && <LoadingPlaceholder label="セキュリティテストを実行中..." />}
              </>
            )}

            {/* Results */}
            {hasDone && !isBusy && (
              <>
                {tab === 'speed' && (
                  <SpeedResults
                    results={speedResults}
                    benchMode={benchMode}
                    backendResult={backendResult}
                  />
                )}
                {tab === 'complexity' && (
                  <ComplexityResults
                    results={complexityResults}
                    benchMode={benchMode}
                    backendResult={backendResult}
                  />
                )}
                {tab === 'security' && (
                  <SecurityResults
                    results={securityResults}
                    benchMode={benchMode}
                    backendResult={backendResult}
                  />
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div style={footerStyle}>
        <span>使用ライブラリ: </span>
        {['jose@6.x', '@noble/ed25519@2.x', 'jsonld@8.x', 'recharts@2.x'].map((l) =>
          <span key={l} style={tagStyle}>{l}</span>)}
        <span style={{ marginLeft: 8 }}>|</span>
        <span style={{ marginLeft: 8 }}>W3C VCDM 2.0 / IETF SD-JWT VC (RFC 9901)</span>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div style={emptyStyle}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🔬</div>
      <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 8 }}>比較ベンチマークを実行してください</h2>
      <p style={{ color: '#64748b', fontSize: 14, maxWidth: 540, textAlign: 'center', lineHeight: 1.6 }}>
        「ベンチマーク実行」ボタンを押すと、ブラウザ内で3フォーマットの
        署名検証速度・デシリアライズ複雑性・正規化セキュリティを定量測定します。
      </p>
      <div style={{ display: 'flex', gap: 14, marginTop: 28, flexWrap: 'wrap', justifyContent: 'center' }}>
        {[
          { color: '#60a5fa', label: 'SD-JWT VC',  spec: 'IETF RFC 9901',   serial: 'JWT (JSON)',      crypto: 'EdDSA / Ed25519',    norm: 'なし' },
          { color: '#f59e0b', label: 'JSON-LD VC', spec: 'W3C VCDM 2.0',    serial: 'JSON-LD (JSON)',  crypto: 'Ed25519 + SHA-256',   norm: 'URDNA2015 (RDF)' },
          { color: '#34d399', label: 'mdoc',        spec: 'ISO 18013-5',     serial: 'CBOR (バイナリ)', crypto: 'ECDSA P-256 (ES256)', norm: 'なし' },
        ].map(({ color, label, spec, serial, crypto, norm }) => (
          <div key={label} style={{ background: '#1e293b', borderRadius: 12, padding: '16px 20px', border: `1px solid ${color}40`, minWidth: 180, maxWidth: 220 }}>
            <div style={{ color, fontWeight: 700, fontSize: 15, marginBottom: 10 }}>{label}</div>
            {[['規格', spec], ['シリアライズ', serial], ['暗号アルゴリズム', crypto], ['正規化', norm]].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: 10, color: '#475569', whiteSpace: 'nowrap' }}>{k}</span>
                <span style={{ fontSize: 10, color: '#94a3b8', textAlign: 'right' }}>{v}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function LoadingPlaceholder({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 48 }}>
      <div style={spinner} />
      <span style={{ color: '#64748b', fontSize: 14 }}>{label}</span>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const appStyle: React.CSSProperties = {
  minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#0f1117',
}
const headerStyle: React.CSSProperties = {
  background: '#0f172a', borderBottom: '1px solid #1e293b', position: 'sticky', top: 0, zIndex: 10,
}
const headerInner: React.CSSProperties = {
  maxWidth: 1280, margin: '0 auto', padding: '14px 24px',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10,
}
const h1Style: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: '#f1f5f9' }
const subtitleStyle: React.CSSProperties = { fontSize: 12, color: '#475569', marginTop: 2 }
const tabBarStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 0,
  background: '#0f172a', borderBottom: '1px solid #1e293b',
  maxWidth: 1280, margin: '0 auto', width: '100%', padding: '0 24px',
}
const tabBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px',
  background: 'none', border: 'none', cursor: 'pointer', color: '#64748b',
  borderBottom: '2px solid transparent', transition: 'all 0.15s',
}
const tabBtnActiveStyle: React.CSSProperties = {
  color: '#e2e8f0', borderBottom: '2px solid #60a5fa',
}
const contentStyle: React.CSSProperties = {
  flex: 1, maxWidth: 1280, margin: '0 auto', width: '100%', padding: '24px',
}
const emptyStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400,
}
const btnStyle: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
  fontSize: 13, fontWeight: 600, transition: 'all 0.15s', whiteSpace: 'nowrap',
}
const btnActiveStyle: React.CSSProperties = { background: '#3b82f6', color: '#fff' }
const btnBackStyle: React.CSSProperties = { background: '#f97316', color: '#fff' }
const btnDisabledStyle: React.CSSProperties = { background: '#1e293b', color: '#475569', cursor: 'not-allowed' }
const selectStyle: React.CSSProperties = {
  marginLeft: 6, padding: '4px 8px', borderRadius: 6, background: '#1e293b',
  border: '1px solid #334155', color: '#e2e8f0', fontSize: 13,
}
const toggleWrap: React.CSSProperties = {
  display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #334155',
}
const toggleBtn: React.CSSProperties = {
  padding: '5px 12px', background: '#1e293b', color: '#64748b',
  border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
  transition: 'all 0.15s', whiteSpace: 'nowrap',
}
const toggleBtnActiveFront: React.CSSProperties = { background: '#1d4ed8', color: '#fff' }
const toggleBtnActiveBack: React.CSSProperties  = { background: '#c2410c', color: '#fff' }
const progressBarWrap: React.CSSProperties = {
  display: 'flex', alignItems: 'center', padding: '6px 16px',
  background: '#0f172a', borderTop: '1px solid #1e293b',
}
const progressBar: React.CSSProperties = {
  width: 120, height: 4, background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
  borderRadius: 2, animation: 'pulse 1.5s ease-in-out infinite',
}
const footerStyle: React.CSSProperties = {
  background: '#0f172a', borderTop: '1px solid #1e293b',
  padding: '10px 24px', display: 'flex', gap: 8, alignItems: 'center',
  fontSize: 11, color: '#475569', flexWrap: 'wrap',
}
const tagStyle: React.CSSProperties = {
  background: '#1e293b', border: '1px solid #334155', borderRadius: 4, padding: '1px 6px', fontSize: 11, color: '#64748b',
}
const spinner: React.CSSProperties = {
  width: 32, height: 32, borderRadius: '50%',
  border: '3px solid #334155', borderTopColor: '#60a5fa',
  animation: 'spin 0.8s linear infinite',
}
