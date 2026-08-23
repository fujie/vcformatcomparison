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
  { id: 'speed',      icon: '⚡', label: 'Signing & Verification',      desc: 'ops/sec and latency for sign/verify' },
  { id: 'complexity', icon: '📐', label: 'Deserialization Complexity',  desc: 'LOC, async steps, cyclomatic complexity' },
  { id: 'security',   icon: '🔐', label: 'Canonicalization Security',   desc: 'Quantitative DoS / SSRF / injection tests' },
  { id: 'impl',       icon: '🔤', label: 'Implementation Comparison',   desc: 'Go / Python / TS and without-library implementations' },
  { id: 'scaling',    icon: '📊', label: 'Detailed Analysis',           desc: 'Attribute scaling, selective disclosure, Ed25519-unified' },
  { id: 'report',     icon: '📋', label: 'Results Report',              desc: 'Overview and JSON/CSV/Markdown export' },
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
        addProgress('SSE connection error - falling back to polling')
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
      addProgress(`Error: ${e}`)
      setBackendRunning(false)
    }
  }, [backendRunning, iterations])

  // ── Frontend benchmark runner ───────────────────────────────────────────────
  const runFrontendBenchmarks = useCallback(async () => {
    setStatus('running')
    setError('')
    setProgress('Starting the benchmark...')

    try {
      const { runSpeedBenchmarks } = await import('./benchmarks/signatureSpeed')
      const { runComplexityAnalysis } = await import('./benchmarks/deserializationComplexity')
      const { runSecurityTests } = await import('./benchmarks/normalizationSecurity')

      setProgress('[1/5] Running the signing/verification benchmark...')
      const speed = await runSpeedBenchmarks(iterations, setProgress)
      setSpeedResults(speed)

      setProgress('[2/5] Analyzing deserialization complexity...')
      const complexity = await runComplexityAnalysis(setProgress)
      setComplexityResults(complexity)

      setProgress('[3/5] Running the security tests...')
      const security = await runSecurityTests(setProgress)
      setSecurityResults(security)

      setProgress('[4/5] Measuring Go WASM...')
      try {
        const { runGoBenchmark } = await import('./lib/goRunner')
        const goRes = await runGoBenchmark((msg) => setProgress(`[4/5] Go: ${msg}`))
        setGoResults(goRes)
      } catch (e) {
        setProgress(`Go WASM skipped: ${(e as Error).message}`)
      }

      setProgress('[5/5] Measuring Python (Pyodide)...')
      try {
        const { runPythonBenchmark } = await import('./lib/pyodideRunner')
        const pyRes = await runPythonBenchmark((msg) => setProgress(`[5/5] Python: ${msg}`))
        setPythonResults(pyRes)
      } catch (e) {
        setProgress(`Python skipped: ${(e as Error).message}`)
      }

      setStatus('done')
      setProgress('All tests completed')
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
    setPythonProgress('Preparing...')
    try {
      const { runPythonBenchmark } = await import('./lib/pyodideRunner')
      const results = await runPythonBenchmark((msg) => setPythonProgress(msg))
      setPythonResults(results)
      setPythonProgress(`Done - ${Object.keys(results).length} measurements`)
    } catch (e) {
      setPythonProgress(`Error: ${(e as Error).message}`)
    } finally {
      setPythonRunning(false)
    }
  }, [])

  const runGoBench = useCallback(async () => {
    setGoRunning(true)
    setGoProgress('Preparing...')
    try {
      const { runGoBenchmark } = await import('./lib/goRunner')
      const results = await runGoBenchmark((msg) => setGoProgress(msg))
      setGoResults(results)
      setGoProgress(`Done - ${Object.keys(results).length} measurements`)
    } catch (e) {
      setGoProgress(`Error: ${(e as Error).message}`)
    } finally {
      setGoRunning(false)
    }
  }, [])

  const runScaling = useCallback(async () => {
    setScalingRunning(true)
    setScalingProgress('Preparing...')
    try {
      const { runScalingBenchmarks } = await import('./benchmarks/scalingBenchmarks')
      const results = await runScalingBenchmarks(50, setScalingProgress)
      setScalingResults(results)
      setScalingProgress('Done')
    } catch (e) {
      setScalingProgress(`Error: ${(e as Error).message}`)
    } finally {
      setScalingRunning(false)
    }
  }, [])

  const runNoLib = useCallback(async () => {
    setNoLibRunning(true)
    setNoLibProgress('Preparing...')
    try {
      const { runNoLibBenchmarks, runSerialBenchmarks } = await import('./benchmarks/noLibrary')
      setNoLibProgress('[1/4] TypeScript signing speed benchmark...')
      const results = await runNoLibBenchmarks(iterations, setNoLibProgress)
      setNoLibResults(results)
      setNoLibProgress('[2/4] Serialization speed benchmark...')
      const serial = await runSerialBenchmarks(200)
      setSerialResults(serial)
      setNoLibProgress('[3/4] Measuring Go WASM...')
      try {
        const { runGoBenchmark } = await import('./lib/goRunner')
        const goRes = await runGoBenchmark((msg) => setNoLibProgress(`[3/4] Go: ${msg}`))
        setGoResults(goRes)
      } catch (e) {
        setNoLibProgress(`Go WASM error: ${(e as Error).message}`)
      }
      setNoLibProgress('[4/4] Measuring Python (Pyodide)...')
      try {
        const { runPythonBenchmark } = await import('./lib/pyodideRunner')
        const pyRes = await runPythonBenchmark((msg) => setNoLibProgress(`[4/4] Python: ${msg}`))
        setPythonResults(pyRes)
      } catch (e) {
        setNoLibProgress(`Python error: ${(e as Error).message}`)
      }
      setNoLibProgress('Done')
    } catch (e) {
      setNoLibProgress(`Error: ${(e as Error).message}`)
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
              SD-JWT VC / JSON-LD VC (W3C VCDM 2.0) / mdoc (ISO 18013-5) — quantitative comparison
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Mode toggle */}
            <div style={toggleWrap}>
              <button
                onClick={() => handleModeChange('frontend')}
                style={{ ...toggleBtn, ...(benchMode === 'frontend' ? toggleBtnActiveFront : {}) }}
              >
                🌐 Browser
              </button>
              <button
                onClick={() => handleModeChange('backend')}
                style={{ ...toggleBtn, ...(benchMode === 'backend' ? toggleBtnActiveBack : {}) }}
              >
                🖥 Backend
              </button>
            </div>

            {/* Backend health indicator */}
            {benchMode === 'backend' && (
              <span style={{ fontSize: 11, color: backendHealth === false ? '#ef4444' : backendHealth === true ? '#34d399' : '#64748b' }}>
                {backendHealth === false ? '⚠ Server not running' : backendHealth === true ? '✓ Connected' : 'Checking...'}
              </span>
            )}

            {benchMode === 'frontend' && (
              <label style={{ fontSize: 12, color: '#64748b' }}>
                Iterations
                <select value={iterations} onChange={(e) => setIterations(Number(e.target.value))}
                  style={selectStyle} disabled={isBusy}>
                  {[20, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}
            {benchMode === 'backend' && (
              <label style={{ fontSize: 12, color: '#64748b' }}>
                Iterations
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
                ? (benchMode === 'backend' ? '⏳ Measuring on the backend...' : 'Running...')
                : hasDone
                  ? 'Run again'
                  : benchMode === 'backend' ? '🖥 Run backend measurement' : 'Run benchmark'}
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
            Error: {error}
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
              {backendProgress[backendProgress.length - 1] ?? 'Preparing...'}
            </span>
          </div>
        )}
        {benchMode === 'backend' && backendResult?.status === 'done' && (
          <div style={{ padding: '6px 16px', background: '#172554', color: '#93c5fd', fontSize: 12, borderTop: '1px solid #3b82f6' }}>
            ✓ Backend measurement completed ({((backendResult.durationMs ?? 0) / 1000).toFixed(1)}s) — Node.js / Python / Go
          </div>
        )}
        {benchMode === 'backend' && backendHealth === false && !backendRunning && (
          <div style={{ padding: '7px 16px', background: '#451a03', color: '#fed7aa', fontSize: 12, borderTop: '1px solid #f97316' }}>
            ⚠ Backend server not running — run <code style={{ background: '#0f172a', padding: '1px 6px', borderRadius: 4 }}>npm run server</code> in a terminal
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
            {benchMode === 'backend' ? '🖥 Backend' : '🌐 Browser'}
          </span>
        </div>
      </div>

      {/* Content */}
      <div style={contentStyle}>
        {/* Implementation comparison tab — always visible */}
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

        {/* Detailed analysis tab — always visible */}
        {tab === 'scaling' && (
          <ScalingResults
            results={scalingResults}
            running={scalingRunning}
            progress={scalingProgress}
            onRun={runScaling}
          />
        )}

        {/* Results report tab — always visible */}
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
                {tab === 'speed'      && <LoadingPlaceholder label="Measuring signing/verification speed..." />}
                {tab === 'complexity' && <LoadingPlaceholder label="Analyzing deserialization complexity..." />}
                {tab === 'security'   && <LoadingPlaceholder label="Running the security tests..." />}
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
        <span>Libraries used: </span>
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
      <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 8 }}>Run the comparison benchmark</h2>
      <p style={{ color: '#64748b', fontSize: 14, maxWidth: 540, textAlign: 'center', lineHeight: 1.6 }}>
        Pressing "Run benchmark" measures, inside your browser, the signing/verification speed,
        deserialization complexity and canonicalization security of the three formats.
      </p>
      <div style={{ display: 'flex', gap: 14, marginTop: 28, flexWrap: 'wrap', justifyContent: 'center' }}>
        {[
          { color: '#60a5fa', label: 'SD-JWT VC',  spec: 'IETF RFC 9901',   serial: 'JWT (JSON)',      crypto: 'EdDSA / Ed25519',    norm: 'None' },
          { color: '#f59e0b', label: 'JSON-LD VC', spec: 'W3C VCDM 2.0',    serial: 'JSON-LD (JSON)',  crypto: 'Ed25519 + SHA-256',   norm: 'URDNA2015 (RDF)' },
          { color: '#34d399', label: 'mdoc',        spec: 'ISO 18013-5',     serial: 'CBOR (binary)',   crypto: 'ECDSA P-256 (ES256)', norm: 'None' },
        ].map(({ color, label, spec, serial, crypto, norm }) => (
          <div key={label} style={{ background: '#1e293b', borderRadius: 12, padding: '16px 20px', border: `1px solid ${color}40`, minWidth: 180, maxWidth: 220 }}>
            <div style={{ color, fontWeight: 700, fontSize: 15, marginBottom: 10 }}>{label}</div>
            {[['Specification', spec], ['Serialization', serial], ['Signature algorithm', crypto], ['Canonicalization', norm]].map(([k, v]) => (
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
