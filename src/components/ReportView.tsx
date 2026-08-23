import { useState, useCallback } from 'react'
import type { SpeedResult } from '../benchmarks/signatureSpeed'
import type { ComplexityMetric } from '../benchmarks/deserializationComplexity'
import type { SecurityTest } from '../benchmarks/normalizationSecurity'
import type { NoLibResult, SerialBenchResult } from '../benchmarks/noLibrary'
import type { ScalingBenchResults } from '../benchmarks/scalingBenchmarks'
import type { RefValues } from '../data/referenceValues'
import type { PyBenchResults } from '../lib/pyodideRunner'
import type { GoBenchResults } from '../lib/goRunner'
import { GO_BENCH_SOURCE, PYTHON_BENCH_SOURCE, TS_SPEED_SOURCE, TS_NOLIB_SOURCE, TS_SECURITY_SOURCE } from '../data/benchmarkSources'
import type { BenchMode, BackendJobResult } from '../types/backendResult'
import { isBackendComplexityArray, isBackendSecurityArray } from '../types/backendResult'

interface Props {
  speedResults:      SpeedResult[]      | null
  complexityResults: ComplexityMetric[] | null
  securityResults:   SecurityTest[]     | null
  noLibResults:      NoLibResult[]      | null
  serialResults:     SerialBenchResult[]| null
  scalingResults?:   ScalingBenchResults | null
  iterations:        number
  refValues:         RefValues
  pythonResults:     PyBenchResults     | null
  goResults:         GoBenchResults     | null
  benchMode?:        BenchMode
  backendResult?:    BackendJobResult   | null
}

// ── Environment detection ─────────────────────────────────────

interface EnvInfo {
  browserName: string
  browserVersion: string
  os: string
  cpuCores: number
  deviceMemoryGB: string
  userAgent: string
  screenResolution: string
  timestamp: string
}

function detectEnv(): EnvInfo {
  const ua = navigator.userAgent

  // Browser name + version
  const chromeM  = ua.match(/Chrome\/([\d.]+)/)
  const ffM      = ua.match(/Firefox\/([\d.]+)/)
  const safariM  = ua.match(/Version\/([\d.]+).*Safari/)
  const edgeM    = ua.match(/Edg\/([\d.]+)/)
  let browserName = 'Unknown', browserVersion = ''
  if (edgeM)    { browserName = 'Edge';    browserVersion = edgeM[1] }
  else if (chromeM) { browserName = 'Chrome';  browserVersion = chromeM[1] }
  else if (ffM)     { browserName = 'Firefox'; browserVersion = ffM[1] }
  else if (safariM) { browserName = 'Safari';  browserVersion = safariM[1] }

  // OS
  let os = 'Unknown'
  if (/Mac OS X/.test(ua)) {
    const v = ua.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g, '.') ?? ''
    os = `macOS ${v}`
  } else if (/Windows NT/.test(ua)) {
    const v = ua.match(/Windows NT ([\d.]+)/)?.[1] ?? ''
    os = `Windows NT ${v}`
  } else if (/Linux/.test(ua)) { os = 'Linux' }
  else if (/Android/.test(ua)) { os = 'Android' }
  else if (/iPhone|iPad/.test(ua)) { os = 'iOS' }

  const mem = (navigator as unknown as Record<string, unknown>)['deviceMemory']
  return {
    browserName,
    browserVersion,
    os,
    cpuCores: navigator.hardwareConcurrency ?? 0,
    deviceMemoryGB: mem ? `${mem} GB` : 'unknown',
    userAgent: ua,
    screenResolution: `${window.screen.width}×${window.screen.height} (devicePixelRatio: ${window.devicePixelRatio})`,
    timestamp: new Date().toLocaleString('ja-JP'),
  }
}

function getBrowserInfo(): string {
  const e = detectEnv()
  return `${e.browserName} ${e.browserVersion} — ${e.os}`
}

function fmt(v: number | undefined, digits = 2): string {
  return v !== undefined ? v.toFixed(digits) : '—'
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}

function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text)
}

// ── JSON export ──────────────────────────────────────────────

function buildJson(props: Props, timestamp: string): string {
  const isBackend = props.benchMode === 'backend'
  return JSON.stringify({
    exportedAt: timestamp,
    benchMode: props.benchMode ?? 'frontend',
    environment: {
      userAgent:  navigator.userAgent,
      platform:   navigator.platform,
      iterations: props.iterations,
      libraries:  ['jose@6.x', '@noble/ed25519@2.x', 'jsonld@8.x', 'cbor-x@1.x', 'recharts@2.x'],
    },
    ...(isBackend ? {
      backendSpeedResults: {
        nodeJs:  props.backendResult?.nodeResult  ?? null,
        python:  props.backendResult?.pythonResult ?? null,
        go:      props.backendResult?.goResult     ?? null,
      },
      complexityResults: props.backendResult?.complexityResult ?? [],
      securityResults:   props.backendResult?.securityResult   ?? [],
    } : {
      speedResults:      props.speedResults      ?? [],
      complexityResults: props.complexityResults ?? [],
      securityResults:   props.securityResults   ?? [],
      noLibResults:      props.noLibResults       ?? [],
      serialResults:     props.serialResults     ?? [],
    }),
    scalingResults: props.scalingResults ?? null,
  }, null, 2)
}

// ── CSV export ───────────────────────────────────────────────

function buildCsv(props: Props, timestamp: string): string {
  const lines: string[] = []
  const row = (...cols: (string | number)[]) =>
    lines.push(cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))

  row('# VC Format Comparison — exported at:', timestamp)
  row('# Browser:', getBrowserInfo())
  row('# Iterations:', props.iterations)
  lines.push('')

  // 1. Signing speed
  if (props.benchMode === 'backend' && props.backendResult) {
    const be = props.backendResult
    for (const [lang, res] of [['Node.js', be.nodeResult], ['Python', be.pythonResult], ['Go', be.goResult]] as const) {
      const entries = Object.entries(res?.results ?? {})
      if (entries.length === 0) continue
      row(`## Signing/verification speed — ${lang} (process.hrtime.bigint / perf_counter_ns)`)
      row('Key', 'Iterations', 'Mean(ms)', 'ops/sec', 'Mean(ns)', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p90(ms)', 'p95(ms)', 'p99(ms)', 'min(ms)', 'max(ms)')
      for (const [key, e] of entries) {
        row(
          key, e.iterations, fmt(e.avgMs, 3), fmt(e.opsPerSec, 1),
          e.avgNs !== undefined ? e.avgNs.toFixed(0) : '—',
          fmt(e.stdDevMs, 4),
          e.ci95Ms != null ? `±${e.ci95Ms.toFixed(4)}` : '—',
          fmt(e.p50Ms, 3), fmt(e.p90Ms, 3), fmt(e.p95Ms, 3), fmt(e.p99Ms, 3),
          fmt(e.minMs, 3), fmt(e.maxMs, 3),
        )
      }
      lines.push('')
    }
  } else {
    row('## Signing/verification speed (distribution)')
    row('Format', 'Operation', 'Iterations', 'Mean(ms)', 'ops/sec', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p90(ms)', 'p95(ms)', 'p99(ms)', 'min(ms)', 'max(ms)')
    for (const r of props.speedResults ?? []) {
      row(
        r.format, r.operation, r.iterations,
        fmt(r.avgMs, 3), fmt(r.opsPerSec, 1),
        fmt(r.stdDevMs, 4),
        r.ci95Ms != null ? `±${r.ci95Ms.toFixed(4)}` : '—',
        fmt(r.p50Ms, 3), fmt(r.p90Ms, 3), fmt(r.p95Ms, 3), fmt(r.p99Ms, 3),
        fmt(r.minMs, 3), fmt(r.maxMs, 3),
      )
    }
    lines.push('')
  }

  // 2. Complexity
  row('## Deserialization complexity')
  row('Format', 'LOC', 'Async steps', 'Cyclomatic complexity', 'Network calls', 'Parse time(ms)', 'External deps')
  for (const r of props.complexityResults ?? []) {
    row(r.format, r.linesOfCode, r.asyncSteps, r.cyclomaticComplexity,
        r.externalNetworkCalls, fmt(r.parseTimeMs, 2), r.externalDependencies.join(' / '))
  }
  lines.push('')

  // 3. Security
  row('## Security tests')
  row('ID', 'Test name', 'Format', 'Category', 'Severity', 'Result', 'Details')
  for (const r of props.securityResults ?? []) {
    row(r.id, r.name, r.format, r.category, r.severity, r.result,
        r.details.replace(/\n/g, ' '))
  }
  lines.push('')

  // 4. Without vs. with library (all languages)
  row('## Without vs. with library (all languages)')
  row('Format', 'Language', 'Mode', 'Operation', 'Iterations/ref', 'Mean(ms)', 'ops/sec', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p95(ms)', 'p99(ms)', 'Notes')
  for (const r of props.noLibResults ?? []) {
    row(
      r.format, 'TypeScript', r.mode === 'withLib' ? 'With library' : 'Without library',
      r.operation, r.iterations, fmt(r.avgMs, 3), fmt(r.opsPerSec, 1),
      fmt(r.stdDevMs, 4),
      r.ci95Ms != null ? `±${r.ci95Ms.toFixed(4)}` : '—',
      fmt(r.p50Ms, 3), fmt(r.p95Ms, 3), fmt(r.p99Ms, 3),
      'measured',
    )
  }
  for (const op of ['sign', 'verify'] as const) {
    const r = props.speedResults?.find(x => x.format === 'JSON-LD VC' && x.operation === op)
    if (r) row('JSON-LD VC', 'TypeScript', 'With library', op, r.iterations, fmt(r.avgMs, 3), fmt(r.opsPerSec, 1), 'measured')
    const rJcs = props.speedResults?.find(x => x.format === 'JSON-LD VC (JCS)' && x.operation === op)
    if (rJcs) row('JSON-LD VC (JCS)', 'TypeScript', 'With library', op, rJcs.iterations, fmt(rJcs.avgMs, 3), fmt(rJcs.opsPerSec, 1), 'measured')
  }
  const _fmts2 = ['SD-JWT VC', 'JSON-LD VC', 'JSON-LD VC (JCS)', 'mdoc'] as const
  const _modes2 = ['withLib', 'noLib'] as const
  for (const f of _fmts2) {
    for (const m of _modes2) {
      for (const op of ['sign', 'verify'] as const) {
        const ref = props.refValues[`${f}-${m}-${op}`]
        if (ref) {
          const mLabel = m === 'withLib' ? 'With library' : 'Without library'
          const goActual = props.goResults?.[`${f}-${m}-${op}`]
          if (goActual) {
            row(f, 'Go', mLabel, op, goActual.iterations, fmt(goActual.avgMs, 3), goActual.opsPerSec.toFixed(1), '✓ Go WASM measured')
          } else {
            row(f, 'Go', mLabel, op, 'ref', '—', ref.Go, 'reference (Apple M2 Pro)')
          }
          const pyActual = props.pythonResults?.[`${f}-${m}-${op}`]
          if (pyActual) {
            row(f, 'Python', mLabel, op, pyActual.iterations, fmt(pyActual.avgMs, 3), pyActual.opsPerSec.toFixed(1), '✓ Pyodide measured')
          } else {
            row(f, 'Python', mLabel, op, 'ref', '—', ref.Python, 'reference (Apple M2 Pro)')
          }
        }
      }
    }
  }
  lines.push('')

  // 5. Serialization speed
  row('## Serialization speed (no cryptography, distribution)')
  row('Format', 'Operation/Label', 'Iterations', 'Mean(ms)', 'ops/sec', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p95(ms)', 'p99(ms)', 'min(ms)', 'max(ms)', 'Payload(bytes)')
  for (const r of props.serialResults ?? []) {
    row(
      r.format, r.label ?? r.operation, r.iterations,
      fmt(r.avgMs, 4), fmt(r.opsPerSec, 1),
      fmt(r.stdDevMs, 5),
      r.ci95Ms != null ? `±${r.ci95Ms.toFixed(5)}` : '—',
      fmt(r.p50Ms, 4), fmt(r.p95Ms, 4), fmt(r.p99Ms, 4),
      fmt(r.minMs, 4), fmt(r.maxMs, 4),
      r.payloadSizeBytes,
    )
  }

  if (props.scalingResults) {
    const sr = props.scalingResults
    row('')
    row('## Attribute-count scaling')
    row('Format', 'Attributes', 'Iterations', 'Mean(ms)', 'ops/sec', 'σ(ms)', 'p95(ms)', 'size(B)')
    for (const r of sr.attrScaling) {
      row(r.format, r.attrCount ?? '—', r.iterations, fmt(r.avgMs, 4), fmt(r.opsPerSec, 1), fmt(r.stdDevMs, 5), fmt(r.p95Ms, 4), r.payloadSizeBytes ?? '—')
    }
    row('')
    row('## Context loader comparison')
    row('Label', 'Iterations', 'Mean(ms)', 'p95(ms)', 'σ(ms)')
    for (const r of sr.contextLoader) {
      row(r.label, r.iterations, fmt(r.avgMs, 2), fmt(r.p95Ms, 2), fmt(r.stdDevMs, 3))
    }
    row('')
    row('## URDNA2015 call limit')
    row('Graph', 'Timeout', 'Measured(ms)', 'Status')
    for (const r of sr.callLimit) {
      row(r.label, r.condition === 'with' ? 'yes' : 'no', fmt(r.avgMs, 1), r.timedOut ? 'protected/TO' : 'completed')
    }
    row('')
    row('## Selective disclosure')
    row('Format', 'Disclosed', 'Iterations', 'Mean(ms)', 'p50(ms)', 'p95(ms)', 'σ(ms)', 'Notes')
    for (const r of sr.selectiveDisc) {
      const note = r.format === 'JSON-LD VC' ? 'URDNA2015 re-canonicalization' : r.format === 'JSON-LD VC (JCS)' ? 'JCS re-canonicalization' : r.format === 'SD-JWT VC' ? 'SHA-256 hashing' : 'CBOR subset'
      row(r.format, r.disclosedCount ?? '—', r.iterations, fmt(r.avgMs, 4), fmt(r.p50Ms, 4), fmt(r.p95Ms, 4), fmt(r.stdDevMs, 5), note)
    }
    row('')
    row('## Ed25519-unified benchmark')
    row('Format', 'Operation', 'Iterations', 'Mean(ms)', 'ops/sec', 'p95(ms)')
    for (const r of sr.unifiedEd25519) {
      row(r.format, r.condition ?? '—', r.iterations, fmt(r.avgMs, 3), fmt(r.opsPerSec, 1), fmt(r.p95Ms, 3))
    }
  }

  return lines.join('\n')
}

// ── Markdown export ──────────────────────────────────────────

function buildMarkdown(props: Props, timestamp: string): string {
  const lines: string[] = []
  const tableRow = (...cols: (string | number)[]) => '| ' + cols.join(' | ') + ' |'
  const sep = (n: number) => '|' + ' --- |'.repeat(n)

  lines.push('# VC Format Comparison Report')
  lines.push('')
  lines.push('## Test conditions')
  lines.push(tableRow('Item', 'Value'))
  lines.push(sep(2))
  lines.push(tableRow('Exported at', timestamp))
  lines.push(tableRow('Browser', getBrowserInfo()))
  lines.push(tableRow('Iterations', props.iterations))
  lines.push(tableRow('Libraries', 'jose@6.x / @noble/ed25519@2.x / jsonld@8.x / cbor-x@1.x'))
  lines.push('')

  if (props.benchMode === 'backend' && props.backendResult) {
    const be = props.backendResult
    for (const [lang, res] of [['Node.js', be.nodeResult], ['Python', be.pythonResult], ['Go', be.goResult]] as const) {
      const entries = Object.entries(res?.results ?? {})
      if (entries.length === 0) continue
      lines.push(`## ⚡ Signing/verification speed — ${lang} (process.hrtime.bigint / perf_counter_ns)`)
      lines.push(tableRow('Key', 'Iterations', 'Mean(ms)', 'ops/sec', 'Mean(ns)', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p90(ms)', 'p95(ms)', 'p99(ms)', 'min(ms)', 'max(ms)'))
      lines.push(sep(13))
      for (const [key, e] of entries) {
        lines.push(tableRow(
          key, e.iterations, fmt(e.avgMs, 3), fmt(e.opsPerSec, 1),
          e.avgNs !== undefined ? e.avgNs.toFixed(0) : '—',
          fmt(e.stdDevMs, 4),
          e.ci95Ms != null ? `±${e.ci95Ms.toFixed(4)}` : '—',
          fmt(e.p50Ms, 3), fmt(e.p90Ms, 3), fmt(e.p95Ms, 3), fmt(e.p99Ms, 3),
          fmt(e.minMs, 3), fmt(e.maxMs, 3),
        ))
      }
      lines.push('')
    }
  } else if (props.speedResults?.length) {
    lines.push('## ⚡ Signing/verification speed (distribution)')
    lines.push(tableRow('Format', 'Operation', 'Mean(ms)', 'ops/sec', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p90(ms)', 'p95(ms)', 'p99(ms)', 'min(ms)', 'max(ms)'))
    lines.push(sep(12))
    for (const r of props.speedResults) {
      lines.push(tableRow(
        r.format, r.operation, fmt(r.avgMs, 3), fmt(r.opsPerSec, 1),
        fmt(r.stdDevMs, 4),
        r.ci95Ms != null ? `±${r.ci95Ms.toFixed(4)}` : '—',
        fmt(r.p50Ms, 3), fmt(r.p90Ms, 3), fmt(r.p95Ms, 3), fmt(r.p99Ms, 3),
        fmt(r.minMs, 3), fmt(r.maxMs, 3),
      ))
    }
    lines.push('')
  }

  if (props.complexityResults?.length) {
    lines.push('## 📐 Deserialization complexity')
    lines.push(tableRow('Format', 'LOC', 'Async steps', 'Cyclomatic complexity', 'Network calls', 'Parse time(ms)'))
    lines.push(sep(6))
    for (const r of props.complexityResults) {
      lines.push(tableRow(r.format, r.linesOfCode, r.asyncSteps,
        r.cyclomaticComplexity, r.externalNetworkCalls, fmt(r.parseTimeMs, 2)))
    }
    lines.push('')
  }

  if (props.securityResults?.length) {
    lines.push('## 🔐 Security tests')
    lines.push(tableRow('Test name', 'Format', 'Severity', 'Result'))
    lines.push(sep(4))
    for (const r of props.securityResults) {
      const resultLabel = r.result === 'vulnerable' ? '✗ vulnerable' : r.result === 'mitigated' ? '✓ mitigated' : r.result === 'partial' ? '△ partial' : '— N/A'
      lines.push(tableRow(r.name, r.format, r.severity.toUpperCase(), resultLabel))
    }
    lines.push('')
  }

  {
    lines.push('## 🧪 Without vs. with library — by language')
    lines.push(tableRow('Format', 'Language', 'Mode', 'Operation', 'Mean(ms)', 'ops/sec', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p95(ms)', 'Notes'))
    lines.push(sep(11))
    for (const r of props.noLibResults ?? []) {
      lines.push(tableRow(
        r.format, 'TypeScript', r.mode === 'withLib' ? 'With library' : 'Without library',
        r.operation, fmt(r.avgMs, 3), fmt(r.opsPerSec, 1),
        fmt(r.stdDevMs, 4),
        r.ci95Ms != null ? `±${r.ci95Ms.toFixed(4)}` : '—',
        fmt(r.p50Ms, 3), fmt(r.p95Ms, 3),
        'measured',
      ))
    }
    for (const op of ['sign', 'verify'] as const) {
      const r = props.speedResults?.find(x => x.format === 'JSON-LD VC' && x.operation === op)
      if (r) lines.push(tableRow('JSON-LD VC', 'TypeScript', 'With library', op, fmt(r.avgMs, 3), fmt(r.opsPerSec, 1), 'measured'))
      const rJcs = props.speedResults?.find(x => x.format === 'JSON-LD VC (JCS)' && x.operation === op)
      if (rJcs) lines.push(tableRow('JSON-LD VC (JCS)', 'TypeScript', 'With library', op, fmt(rJcs.avgMs, 3), fmt(rJcs.opsPerSec, 1), 'measured'))
    }
    const _mfmts = ['SD-JWT VC', 'JSON-LD VC', 'JSON-LD VC (JCS)', 'mdoc'] as const
    for (const f of _mfmts) {
      for (const m of ['withLib', 'noLib'] as const) {
        for (const op of ['sign', 'verify'] as const) {
          const ref = props.refValues[`${f}-${m}-${op}`]
          if (!ref) continue
          const ml = m === 'withLib' ? 'With library' : 'Without library'
          const mdGoAct = props.goResults?.[`${f}-${m}-${op}`]
          lines.push(mdGoAct
            ? tableRow(f, 'Go',     ml, op, fmt(mdGoAct.avgMs, 3),  mdGoAct.opsPerSec.toFixed(1), '✓ Go WASM measured')
            : tableRow(f, 'Go',     ml, op, '—', ref.Go,   'reference')
          )
          const mdPyAct = props.pythonResults?.[`${f}-${m}-${op}`]
          lines.push(mdPyAct
            ? tableRow(f, 'Python', ml, op, fmt(mdPyAct.avgMs, 3), mdPyAct.opsPerSec.toFixed(1), '✓ Pyodide measured')
            : tableRow(f, 'Python', ml, op, '—', ref.Python, 'reference')
          )
        }
      }
    }
    lines.push('')
  }

  if (props.serialResults?.length) {
    lines.push('## 📦 Serialization speed (no cryptography, distribution)')
    lines.push(tableRow('Format', 'Operation/Label', 'Mean(ms)', 'ops/sec', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p95(ms)', 'p99(ms)', 'Payload(bytes)'))
    lines.push(sep(10))
    for (const r of props.serialResults) {
      lines.push(tableRow(
        r.format, r.label ?? r.operation, fmt(r.avgMs, 4), fmt(r.opsPerSec, 1),
        fmt(r.stdDevMs, 5),
        r.ci95Ms != null ? `±${r.ci95Ms.toFixed(5)}` : '—',
        fmt(r.p50Ms, 4), fmt(r.p95Ms, 4), fmt(r.p99Ms, 4),
        r.payloadSizeBytes,
      ))
    }
    lines.push('')
  }

  if (props.scalingResults) {
    const sr = props.scalingResults

    lines.push('## 📊 Attribute-count scaling (serialization speed vs. attribute count)')
    lines.push(tableRow('Format', 'Attributes', 'Iterations', 'Mean(ms)', 'ops/sec', 'σ(ms)', 'p95(ms)', 'size(B)'))
    lines.push(sep(8))
    for (const r of sr.attrScaling) {
      lines.push(tableRow(
        r.format, r.attrCount ?? '—', r.iterations,
        fmt(r.avgMs, 4), fmt(r.opsPerSec, 1), fmt(r.stdDevMs, 5), fmt(r.p95Ms, 4),
        r.payloadSizeBytes ?? '—',
      ))
    }
    lines.push('')

    lines.push('## 🌐 JSON-LD context loader comparison (SSRF and performance risk)')
    lines.push(tableRow('Format', 'Loader', 'Iterations', 'Mean(ms)', 'p95(ms)', 'σ(ms)'))
    lines.push(sep(6))
    for (const r of sr.contextLoader) {
      lines.push(tableRow(r.format, r.label, r.iterations, fmt(r.avgMs, 2), fmt(r.p95Ms, 2), fmt(r.stdDevMs, 3)))
    }
    lines.push('')

    lines.push('## 🛡 URDNA2015 call limit: with vs. without (DoS mitigation)')
    lines.push(tableRow('Graph', 'Timeout', 'Measured time(ms)', 'Status'))
    lines.push(sep(4))
    for (const r of sr.callLimit) {
      lines.push(tableRow(
        r.label,
        r.condition === 'with' ? 'yes' : 'no',
        fmt(r.avgMs, 1),
        r.timedOut ? (r.condition === 'with' ? 'protected' : 'timed out') : 'completed',
      ))
    }
    lines.push('')

    lines.push('## 🔓 Selective disclosure performance (latency by number of disclosed attributes)')
    lines.push(tableRow('Format', 'Disclosed/Total', 'Iterations', 'Mean(ms)', 'p50(ms)', 'p95(ms)', 'σ(ms)', 'Notes'))
    lines.push(sep(8))
    for (const r of sr.selectiveDisc) {
      const note = r.format === 'JSON-LD VC' ? 'URDNA2015 re-canonicalization' : r.format === 'JSON-LD VC (JCS)' ? 'JCS re-canonicalization' : r.format === 'SD-JWT VC' ? 'SHA-256 hashing' : 'CBOR subset'
      lines.push(tableRow(
        r.format, r.disclosedCount != null ? `${r.disclosedCount}/20` : '—',
        r.iterations, fmt(r.avgMs, 4), fmt(r.p50Ms, 4), fmt(r.p95Ms, 4), fmt(r.stdDevMs, 5), note,
      ))
    }
    lines.push('')

    lines.push('## 🔑 Ed25519-unified benchmark (isolating the pure serialization difference)')
    lines.push(tableRow('Format', 'Operation', 'Iterations', 'Mean(ms)', 'ops/sec', 'σ(ms)', 'p50(ms)', 'p95(ms)'))
    lines.push(sep(8))
    for (const r of sr.unifiedEd25519) {
      lines.push(tableRow(
        r.format, r.condition ?? '—', r.iterations,
        fmt(r.avgMs, 3), fmt(r.opsPerSec, 1), fmt(r.stdDevMs, 4), fmt(r.p50Ms, 3), fmt(r.p95Ms, 3),
      ))
    }
    lines.push('')
  }

  lines.push('---')
  lines.push('*Generated by VC Format Comparison Tool*')
  return lines.join('\n')
}

// ── Sub-section table components ─────────────────────────────

// ── Execution Code Section ────────────────────────────────────

function CodeBlock({ label, lang, code, color = '#60a5fa' }: {
  label: string; lang: string; code: string; color?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ border: `1px solid ${color}30`, borderRadius: 10, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 16px', background: '#0f172a', border: 'none', cursor: 'pointer',
          color: '#e2e8f0', fontSize: 13, fontWeight: 500 }}>
        <span>
          <span style={{ color, marginRight: 8 }}>{lang}</span>
          {label}
        </span>
        <span style={{ color: '#64748b', fontSize: 10 }}>{open ? '▲ Collapse' : '▼ Show code'}</span>
      </button>
      {open && (
        <pre style={{ margin: 0, padding: '14px 16px', background: '#020817',
          fontSize: 10, color: '#a5f3fc', overflowX: 'auto',
          lineHeight: 1.6, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {code}
        </pre>
      )}
    </div>
  )
}

function CodeSourceSection({ goResults, pythonResults }: {
  goResults: GoBenchResults | null; pythonResults: PyBenchResults | null
}) {
  return (
    <div style={{ ...panelStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ ...sectionTitle, color: '#a78bfa' }}>📄 Code actually executed</h3>
      <p style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>
        The code that each benchmark actually executed. Click to expand.
      </p>

      <CodeBlock
        lang="TypeScript"
        label="Signing/verification speed benchmark (jose / jsonld / cbor-x)"
        color="#60a5fa"
        code={TS_SPEED_SOURCE}
      />
      <CodeBlock
        lang="TypeScript"
        label="Without-library implementation (Web Crypto API only + hand-written CBOR)"
        color="#f472b6"
        code={TS_NOLIB_SOURCE}
      />
      <CodeBlock
        lang="TypeScript"
        label="Security tests (DoS / Injection / SSRF / Algorithm Confusion)"
        color="#f87171"
        code={TS_SECURITY_SOURCE}
      />
      <CodeBlock
        lang={goResults ? 'Go ✓ measured (WASM)' : 'Go (reference)'}
        label="go/bench/main.go — GOOS=js GOARCH=wasm (crypto/ecdsa standard library)"
        color="#34d399"
        code={GO_BENCH_SOURCE}
      />
      <CodeBlock
        lang={pythonResults ? 'Python ✓ measured (Pyodide)' : 'Python (reference)'}
        label="Pyodide execution code (cryptography / PyJWT / pyld / cbor2)"
        color="#f59e0b"
        code={PYTHON_BENCH_SOURCE}
      />
    </div>
  )
}

function SectionTable({ title, headers, rows, color = '#60a5fa' }: {
  title: string; headers: string[]; rows: (string | number)[][]; color?: string
}) {
  return (
    <div style={panelStyle}>
      <h3 style={{ ...sectionTitle, color }}>{title}</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 500 }}>
          <thead>
            <tr>{headers.map(h => <th key={h} style={thStyle}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                {row.map((cell, j) => <td key={j} style={tdStyle}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function NotRun({ label }: { label: string }) {
  return (
    <div style={{ padding: '8px 14px', background: '#1e293b', borderRadius: 8, fontSize: 12, color: '#475569', border: '1px dashed #334155' }}>
      ⏸ {label} — not run (measure it with "Run benchmark")
    </div>
  )
}

// ── Main component ───────────────────────────────────────────

export function ReportView(props: Props) {
  const [copied, setCopied] = useState<string | null>(null)
  const timestamp = new Date().toLocaleString('ja-JP')
  const isBackend = props.benchMode === 'backend'

  // In backend mode, derive effective results from backendResult
  const beNode     = props.backendResult?.nodeResult
  const bePython   = props.backendResult?.pythonResult
  const beGo       = props.backendResult?.goResult
  const beComplex  = isBackendComplexityArray(props.backendResult?.complexityResult) ? props.backendResult!.complexityResult : null
  const beSecurity = isBackendSecurityArray(props.backendResult?.securityResult)     ? props.backendResult!.securityResult     : null

  const runCount = isBackend
    ? [beNode, bePython, beGo, beComplex, beSecurity].filter(Boolean).length
    : [
        props.speedResults, props.complexityResults, props.securityResults,
        props.noLibResults, props.serialResults, props.scalingResults,
      ].filter(Boolean).length

  const handleCopy = useCallback(async (type: 'csv' | 'markdown' | 'json') => {
    const content =
      type === 'json'     ? buildJson(props, timestamp) :
      type === 'csv'      ? buildCsv(props, timestamp) :
                            buildMarkdown(props, timestamp)
    await copyToClipboard(content)
    setCopied(type)
    setTimeout(() => setCopied(null), 2000)
  }, [props, timestamp])

  const handleDownload = useCallback((type: 'json' | 'csv') => {
    const ts = new Date().toISOString().slice(0, 10)
    if (type === 'json') {
      downloadFile(buildJson(props, timestamp), `vc-report-${ts}.json`, 'application/json')
    } else {
      downloadFile(buildCsv(props, timestamp), `vc-report-${ts}.csv`, 'text/csv;charset=utf-8')
    }
  }, [props, timestamp])

  // Security result label
  const secLabel = (r: string) =>
    r === 'vulnerable' ? '✗ vulnerable' : r === 'mitigated' ? '✓ mitigated' : r === 'partial' ? '△ partial' : '— N/A'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header + export buttons */}
      <div style={{ ...panelStyle, borderColor: isBackend ? '#ea580c30' : '#3b82f630' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>Test results report</h2>
              <span style={{
                fontSize: 11, padding: '2px 10px', borderRadius: 20, fontWeight: 600,
                background: isBackend ? '#ea580c20' : '#3b82f620',
                color: isBackend ? '#fb923c' : '#93c5fd',
                border: `1px solid ${isBackend ? '#ea580c50' : '#3b82f650'}`,
              }}>
                {isBackend ? '🖥 Backend measurement' : '🌐 Browser measurement'}
              </span>
            </div>
            <p style={{ fontSize: 12, color: '#64748b' }}>Exported at: {timestamp}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {([
              { id: 'markdown' as const, label: 'Copy Markdown', icon: '📝' },
              { id: 'csv'      as const, label: 'Copy CSV',      icon: '📊' },
              { id: 'json'     as const, label: 'Copy JSON',     icon: '📋' },
            ]).map(({ id, label, icon }) => (
              <button key={id} onClick={() => handleCopy(id)} style={{
                ...exportBtn,
                background: copied === id ? '#14532d' : '#1e293b',
                borderColor: copied === id ? '#22c55e' : '#334155',
                color: copied === id ? '#86efac' : '#cbd5e1',
              }}>
                {icon} {copied === id ? 'Copied ✓' : label}
              </button>
            ))}
            <button onClick={() => handleDownload('json')} style={{ ...exportBtn, background: '#1e3a5f', borderColor: '#3b82f6', color: '#93c5fd' }}>
              ⬇ Download JSON
            </button>
            <button onClick={() => handleDownload('csv')} style={{ ...exportBtn, background: '#1e3a5f', borderColor: '#3b82f6', color: '#93c5fd' }}>
              ⬇ Download CSV
            </button>
          </div>
        </div>

        {/* Progress indicator */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          {(isBackend ? [
            { label: 'Node.js speed', done: !!(beNode?.results) },
            { label: 'Python speed', done: !!(bePython?.results) },
            { label: 'Go speed', done: !!(beGo?.results) },
            { label: 'Complexity', done: !!beComplex },
            { label: 'Security', done: !!beSecurity },
          ] : [
            { label: 'Signing speed', done: !!props.speedResults },
            { label: 'Complexity', done: !!props.complexityResults },
            { label: 'Security', done: !!props.securityResults },
            { label: 'Without library', done: !!props.noLibResults },
            { label: 'Serialization', done: !!props.serialResults },
            { label: 'Detailed analysis', done: !!props.scalingResults },
          ]).map(({ label, done }) => (
            <span key={label} style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 20,
              background: done ? '#14532d' : '#1e293b',
              color: done ? '#86efac' : '#475569',
              border: `1px solid ${done ? '#22c55e' : '#334155'}`,
            }}>
              {done ? '✓' : '○'} {label}
            </span>
          ))}
          <span style={{ fontSize: 11, color: '#64748b', padding: '3px 6px' }}>
            {runCount}/6 completed
          </span>
        </div>
      </div>

      {/* Test environment (details) */}
      {isBackend ? (
        <SectionTable
          title="🖥 Test environment (backend)"
          color="#a78bfa"
          headers={['Item', 'Value']}
          rows={[
            ['Run at', timestamp],
            ['Run mode', 'Backend (Node.js Express server / process.hrtime.bigint())'],
            ['Node.js runtime', beNode?.runtimeInfo ?? 'Node.js (process.hrtime.bigint)'],
            ['Python runtime', bePython?.runtimeInfo ?? 'Python (time.perf_counter_ns)'],
            ['Go runtime', beGo?.runtimeInfo ?? 'Go native binary (time.Now().UnixNano)'],
            ['Backend port', 'Express localhost:3001'],
            ['Node.js result count', Object.keys(beNode?.results ?? {}).length],
            ['Python result count', Object.keys(bePython?.results ?? {}).length],
            ['Go result count', Object.keys(beGo?.results ?? {}).length],
            ['Complexity metrics', beComplex?.length ?? 0],
            ['Security tests', beSecurity?.length ?? 0],
            ['Libraries (Node.js)', 'node:crypto (ECDSA P-256 / Ed25519) / cbor-x / jsonld'],
            ['Libraries (Python)', 'cryptography / cbor2 / pyld'],
            ['Libraries (Go)', 'standard library only: crypto/ecdsa, crypto/sha256, encoding/base64'],
            ['Specifications', 'IETF RFC 9901 / W3C VCDM 2.0 / ISO 18013-5'],
          ]}
        />
      ) : (() => {
        const env = detectEnv()
        return (
          <SectionTable
            title="🖥 Test environment"
            color="#a78bfa"
            headers={['Item', 'Value']}
            rows={[
              ['Run at', env.timestamp],
              ['Browser', `${env.browserName} ${env.browserVersion}`],
              ['OS', env.os],
              ['CPU cores', `${env.cpuCores} cores (navigator.hardwareConcurrency)`],
              ['Device memory', env.deviceMemoryGB],
              ['Screen resolution', env.screenResolution],
              ['User-Agent', env.userAgent.slice(0, 120) + (env.userAgent.length > 120 ? '…' : '')],
              ['TypeScript runtime', 'Vite 5.4.x / React 18.x / Web Crypto API'],
              ['Go runtime', `Go 1.25.6 WASM (GOOS=js GOARCH=wasm) / wasm_exec.js`],
              ['Python runtime', 'Pyodide 0.26.4 (CPython 3.12 via WebAssembly)'],
              ['Iterations (main)', props.iterations],
              ['Iterations (Go/Python)', 100],
              ['Libraries (TypeScript)', 'jose@6.x / @noble/ed25519@2.x / jsonld@8.x / cbor-x@1.x'],
              ['Libraries (Python)', 'cryptography (bundled) / PyJWT / pyld / cbor2 (micropip)'],
              ['Libraries (Go)', 'standard library only: crypto/ecdsa, crypto/sha256, encoding/base64'],
              ['Specifications', 'IETF RFC 9901 / W3C VCDM 2.0 / ISO 18013-5'],
              ['Signature algorithms', 'SD-JWT VC: EdDSA Ed25519 / JSON-LD VC: Ed25519+SHA-256 / JSON-LD VC (JCS): Ed25519+SHA-256 / mdoc: ECDSA P-256'],
              ['Canonicalization', 'JSON-LD VC: URDNA2015 (RDF Dataset Normalization, eddsa-rdfc-2022) / JSON-LD VC (JCS): JCS RFC 8785 (eddsa-jcs-2022) / others: none'],
              ['Go measurement', props.goResults     ? `✓ measured via WASM (${Object.keys(props.goResults).length} items)` : 'reference (not measured)'],
              ['Python measurement', props.pythonResults ? `✓ measured via Pyodide (${Object.keys(props.pythonResults).length} items)` : 'reference (not measured)'],
            ]}
          />
        )
      })()}

      {/* Signing speed */}
      {isBackend ? (
        <>
          {(['Node.js', 'Python', 'Go'] as const).map(lang => {
            const res = lang === 'Node.js' ? beNode : lang === 'Python' ? bePython : beGo
            const entries = Object.entries(res?.results ?? {})
            const color = lang === 'Node.js' ? '#60a5fa' : lang === 'Python' ? '#f59e0b' : '#34d399'
            return entries.length > 0 ? (
              <SectionTable
                key={lang}
                title={`⚡ Signing/verification speed — ${lang} (process.hrtime.bigint / perf_counter_ns)`}
                color={color}
                headers={['Key', 'Iterations', 'Mean(ms)', 'ops/sec', 'Mean(ns)', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p90(ms)', 'p95(ms)', 'p99(ms)', 'min(ms)', 'max(ms)']}
                rows={entries.map(([key, e]) => [
                  key, e.iterations, fmt(e.avgMs, 3), fmt(e.opsPerSec, 1),
                  e.avgNs !== undefined ? e.avgNs.toFixed(0) : '—',
                  fmt(e.stdDevMs, 4),
                  e.ci95Ms != null ? `±${e.ci95Ms.toFixed(4)}` : '—',
                  fmt(e.p50Ms, 3), fmt(e.p90Ms, 3), fmt(e.p95Ms, 3), fmt(e.p99Ms, 3),
                  fmt(e.minMs, 3), fmt(e.maxMs, 3),
                ])}
              />
            ) : <NotRun key={lang} label={`Signing/verification speed — ${lang}`} />
          })}
        </>
      ) : (
        props.speedResults ? (
          <SectionTable
            title="⚡ Signing/verification speed (distribution)"
            color="#60a5fa"
            headers={['Format', 'Operation', 'Iterations', 'Mean(ms)', 'ops/sec', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p90(ms)', 'p95(ms)', 'p99(ms)', 'min(ms)', 'max(ms)']}
            rows={props.speedResults.map(r => [
              r.format, r.operation, r.iterations,
              fmt(r.avgMs, 3), fmt(r.opsPerSec, 1),
              fmt(r.stdDevMs, 4),
              r.ci95Ms != null ? `±${r.ci95Ms.toFixed(4)}` : '—',
              fmt(r.p50Ms, 3), fmt(r.p90Ms, 3), fmt(r.p95Ms, 3), fmt(r.p99Ms, 3),
              fmt(r.minMs, 3), fmt(r.maxMs, 3),
            ])}
          />
        ) : <NotRun label="Signing/verification speed" />
      )}

      {/* Complexity */}
      {isBackend ? (
        beComplex ? (
          <SectionTable
            title="📐 Deserialization complexity (backend / process.hrtime.bigint)"
            color="#f59e0b"
            headers={['Format', 'Library', 'LOC', 'Async steps', 'Cyclomatic complexity', 'Network calls', 'Parse time(ms)', 'External deps']}
            rows={beComplex.map(r => [
              r.format, r.lib, r.linesOfCode, r.asyncSteps, r.cyclomaticComplexity,
              r.externalNetworkCalls, fmt(r.parseTimeMs, 4),
              r.externalDependencies.join(' / '),
            ])}
          />
        ) : <NotRun label="Deserialization complexity — run the backend measurement" />
      ) : (
        props.complexityResults ? (
          <SectionTable
            title="📐 Deserialization complexity"
            color="#f59e0b"
            headers={['Format', 'LOC', 'Async steps', 'Cyclomatic complexity', 'Network calls', 'Parse time(ms)', 'External deps']}
            rows={props.complexityResults.map(r => [
              r.format, r.linesOfCode, r.asyncSteps, r.cyclomaticComplexity,
              r.externalNetworkCalls, fmt(r.parseTimeMs, 2),
              r.externalDependencies.join(' / '),
            ])}
          />
        ) : <NotRun label="Deserialization complexity" />
      )}

      {/* Security */}
      {isBackend ? (
        beSecurity ? (
          <SectionTable
            title="🔐 Security tests (backend — Node.js)"
            color="#f87171"
            headers={['ID', 'Test name', 'Format', 'Category', 'Severity', 'Result', 'Details']}
            rows={beSecurity.map(r => [
              r.id, r.name, r.format, r.category,
              r.severity.toUpperCase(), secLabel(r.result),
              r.details.length > 60 ? r.details.slice(0, 60) + '…' : r.details,
            ])}
          />
        ) : <NotRun label="Security tests — run the backend measurement" />
      ) : (
        props.securityResults ? (
          <SectionTable
            title="🔐 Security tests"
            color="#f87171"
            headers={['ID', 'Test name', 'Format', 'Category', 'Severity', 'Result', 'Details']}
            rows={props.securityResults.map(r => [
              r.id, r.name, r.format, r.category,
              r.severity.toUpperCase(), secLabel(r.result),
              r.details.length > 60 ? r.details.slice(0, 60) + '…' : r.details,
            ])}
          />
        ) : <NotRun label="Security tests" />
      )}

      {/* Without vs. with library — TypeScript + Go + Python (frontend only) */}
      {!isBackend && (() => {
        const fmts = ['SD-JWT VC', 'JSON-LD VC', 'JSON-LD VC (JCS)', 'mdoc'] as const
        const modes = ['withLib', 'noLib'] as const
        const ops   = ['sign', 'verify'] as const
        const langs = ['Go', 'Python'] as const

        // Build unified rows: TypeScript (actual) + Go/Python (reference)
        const rows: (string | number)[][] = []

        for (const f of fmts) {
          for (const m of modes) {
            for (const op of ops) {
              // TypeScript row: JCS comes from speedResults; JSON-LD VC withLib from speedResults, noLib from noLibResults
              const tsResult = f === 'JSON-LD VC (JCS)'
                ? props.speedResults?.find(r => r.format === f && r.operation === op)
                : f === 'JSON-LD VC' && m === 'withLib'
                  ? props.speedResults?.find(r => r.format === 'JSON-LD VC' && r.operation === op)
                  : props.noLibResults?.find(r => r.format === f && r.mode === m && r.operation === op)
              if (tsResult || props.noLibResults || props.speedResults) {
                rows.push([
                  f,
                  'TypeScript',
                  m === 'withLib' ? 'With library' : 'Without library',
                  op,
                  tsResult ? tsResult.iterations : '—',
                  tsResult ? fmt(tsResult.avgMs, 3) : 'not measured',
                  tsResult ? fmt(tsResult.opsPerSec, 1) : 'not measured',
                  tsResult?.stdDevMs != null ? fmt(tsResult.stdDevMs, 4) : '—',
                  tsResult?.ci95Ms   != null ? `±${tsResult.ci95Ms.toFixed(4)}` : '—',
                  tsResult?.p50Ms    != null ? fmt(tsResult.p50Ms, 3) : '—',
                  tsResult?.p95Ms    != null ? fmt(tsResult.p95Ms, 3) : '—',
                  tsResult?.p99Ms    != null ? fmt(tsResult.p99Ms, 3) : '—',
                  'measured',
                ])
              }
              // Go / Python rows
              const refKey = `${f}-${m}-${op}`
              for (const lang of langs) {
                let opsVal: number
                let note: string
                if (lang === 'Python') {
                  const actual = props.pythonResults?.[refKey]
                  if (actual) {
                    opsVal = actual.opsPerSec
                    note = `✓ Pyodide measured (${actual.iterations} iterations)`
                  } else {
                    opsVal = props.refValues[refKey]?.['Python'] ?? 0
                    note = 'reference (Apple M2 Pro)'
                  }
                } else {
                  const actual = props.goResults?.[refKey]
                  if (actual) {
                    opsVal = actual.opsPerSec
                    note = `✓ Go WASM measured (${actual.iterations} iterations)`
                  } else {
                    opsVal = props.refValues[refKey]?.['Go'] ?? 0
                    note = 'reference (Apple M2 Pro)'
                  }
                }
                rows.push([
                  f,
                  lang,
                  m === 'withLib' ? 'With library' : 'Without library',
                  op,
                  lang === 'Python' && props.pythonResults?.[refKey] ? props.pythonResults[refKey].iterations : 'ref',
                  lang === 'Python' && props.pythonResults?.[refKey] ? fmt(props.pythonResults[refKey].avgMs, 3) : '—',
                  opsVal > 0 ? opsVal.toLocaleString() : '—',
                  '—', '—', '—', '—', '—',
                  note,
                ])
              }
            }
          }
        }

        return (
          <SectionTable
            title="🧪 Without vs. with library — by language (TypeScript measured / Go and Python reference)"
            color="#f472b6"
            headers={['Format', 'Language', 'Mode', 'Operation', 'Iterations', 'Mean(ms)', 'ops/sec', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p95(ms)', 'p99(ms)', 'Notes']}
            rows={rows}
          />
        )
      })()}

      {/* Serialization (frontend only) */}
      {!isBackend && (props.serialResults ? (
        <SectionTable
          title="📦 Serialization speed (no cryptography — CBOR vs JSON vs canonicalization, distribution)"
          color="#34d399"
          headers={['Format', 'Operation/Label', 'Iterations', 'Mean(ms)', 'ops/sec', 'σ(ms)', '95%CI(ms)', 'p50(ms)', 'p95(ms)', 'p99(ms)', 'min(ms)', 'max(ms)', 'Payload(bytes)']}
          rows={props.serialResults.map(r => [
            r.format, r.label ?? r.operation, r.iterations,
            fmt(r.avgMs, 4), fmt(r.opsPerSec, 1),
            fmt(r.stdDevMs, 5),
            r.ci95Ms != null ? `±${r.ci95Ms.toFixed(5)}` : '—',
            fmt(r.p50Ms, 4), fmt(r.p95Ms, 4), fmt(r.p99Ms, 4),
            fmt(r.minMs, 4), fmt(r.maxMs, 4),
            r.payloadSizeBytes,
          ])}
        />
      ) : <NotRun label="Serialization speed" />)}

      {/* Detailed analysis — scaling results (always shown if available, regardless of benchMode) */}
      {props.scalingResults ? (
        <>
          <SectionTable
            title="📊 Attribute-count scaling (serialization speed vs. attribute count)"
            color="#a78bfa"
            headers={['Format', 'Attributes', 'Iterations', 'Mean(ms)', 'ops/sec', 'σ(ms)', 'p95(ms)', 'size(B)']}
            rows={props.scalingResults.attrScaling.map(r => [
              r.format, r.attrCount ?? '—', r.iterations,
              fmt(r.avgMs, 4), fmt(r.opsPerSec, 1), fmt(r.stdDevMs, 5), fmt(r.p95Ms, 4),
              r.payloadSizeBytes ?? '—',
            ])}
          />
          <SectionTable
            title="🌐 JSON-LD context loader comparison (SSRF and performance risk)"
            color="#f59e0b"
            headers={['Format', 'Loader', 'Iterations', 'Mean(ms)', 'p95(ms)', 'σ(ms)']}
            rows={props.scalingResults.contextLoader.map(r => [
              r.format, r.label, r.iterations, fmt(r.avgMs, 2), fmt(r.p95Ms, 2), fmt(r.stdDevMs, 3),
            ])}
          />
          <SectionTable
            title="🛡 URDNA2015 call limit: with vs. without (DoS mitigation)"
            color="#ef4444"
            headers={['Graph', 'Timeout', 'Measured time(ms)', 'Status']}
            rows={props.scalingResults.callLimit.map(r => [
              r.label,
              r.condition === 'with' ? 'yes' : 'no',
              fmt(r.avgMs, 1),
              r.timedOut ? (r.condition === 'with' ? 'protected' : 'timed out') : 'completed',
            ])}
          />
          <SectionTable
            title="🔓 Selective disclosure performance (latency by number of disclosed attributes)"
            color="#34d399"
            headers={['Format', 'Disclosed/Total', 'Iterations', 'Mean(ms)', 'p50(ms)', 'p95(ms)', 'σ(ms)', 'Notes']}
            rows={props.scalingResults.selectiveDisc.map(r => [
              r.format, r.disclosedCount != null ? `${r.disclosedCount}/20` : '—',
              r.iterations, fmt(r.avgMs, 4), fmt(r.p50Ms, 4), fmt(r.p95Ms, 4), fmt(r.stdDevMs, 5),
              r.format === 'JSON-LD VC' ? 'URDNA2015 re-canonicalization' : r.format === 'JSON-LD VC (JCS)' ? 'JCS re-canonicalization' : r.format === 'SD-JWT VC' ? 'SHA-256 hashing' : 'CBOR subset',
            ])}
          />
          <SectionTable
            title="🔑 Ed25519-unified benchmark (isolating the pure serialization difference)"
            color="#60a5fa"
            headers={['Format', 'Operation', 'Iterations', 'Mean(ms)', 'ops/sec', 'σ(ms)', 'p50(ms)', 'p95(ms)']}
            rows={props.scalingResults.unifiedEd25519.map(r => [
              r.format, r.condition ?? '—', r.iterations,
              fmt(r.avgMs, 3), fmt(r.opsPerSec, 1), fmt(r.stdDevMs, 4), fmt(r.p50Ms, 3), fmt(r.p95Ms, 3),
            ])}
          />
        </>
      ) : <NotRun label="Detailed analysis (run it in the Detailed Analysis tab)" />}

      {/* Executed code */}
      {isBackend ? (
        <div style={{ ...panelStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h3 style={{ ...sectionTitle, color: '#fb923c' }}>📄 Code actually executed (backend)</h3>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>
            The code that the backend server actually executed. Click to expand.
          </p>
          <CodeBlock lang="TypeScript" label="server/bench/nodeSpeed.ts — Node.js signing speed benchmark (process.hrtime.bigint())" color="#60a5fa" code={TS_SPEED_SOURCE} />
          <CodeBlock lang="TypeScript" label="server/bench/nodeComplexity.ts — Node.js complexity measurement" color="#f59e0b" code="// server/bench/nodeComplexity.ts\n// returns BackendComplexityEntry[]\n// parseTimeNs is measured with process.hrtime.bigint()\n// linesOfCode / asyncSteps / cyclomaticComplexity are static metrics" />
          <CodeBlock lang="TypeScript" label="server/bench/nodeSecurity.ts — Node.js security tests" color="#f87171" code={TS_SECURITY_SOURCE} />
          <CodeBlock lang="Python" label="server/bench/speed.py — Python speed benchmark (time.perf_counter_ns())" color="#f59e0b" code={PYTHON_BENCH_SOURCE} />
          <CodeBlock lang="Go" label="go/bench-native/main.go — Go native binary (time.Now().UnixNano())" color="#34d399" code={GO_BENCH_SOURCE} />
        </div>
      ) : (
        <CodeSourceSection
          goResults={props.goResults}
          pythonResults={props.pythonResults}
        />
      )}

    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────
const panelStyle: React.CSSProperties = { background: '#1e293b', borderRadius: 12, padding: '18px 22px', border: '1px solid #334155' }
const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 12 }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '7px 10px', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #334155', whiteSpace: 'nowrap' }
const tdStyle: React.CSSProperties = { padding: '7px 10px', color: '#cbd5e1', verticalAlign: 'top' }
const exportBtn: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 8, border: '1px solid', cursor: 'pointer',
  fontSize: 12, fontWeight: 500, transition: 'all 0.15s',
}
