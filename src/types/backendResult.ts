/**
 * Shared types for backend benchmark results received from the server API.
 * These are compatible with (or adaptable to) the existing frontend component types.
 */

export type BenchMode = 'frontend' | 'backend'

// ── Speed results ─────────────────────────────────────────────────────────────

export interface LangSpeedEntry {
  opsPerSec: number
  avgMs: number
  avgNs?: number
  iterations: number
  isActual?: boolean
  // Statistical distribution
  stdDevMs?: number
  stdDevNs?: number
  ci95Ms?: number
  p50Ms?: number
  p90Ms?: number
  p95Ms?: number
  p99Ms?: number
  minMs?: number
  maxMs?: number
}

export interface LangSpeedResult {
  results?: Record<string, LangSpeedEntry>
  errors?: Record<string, string>
  iterations?: number
  runtimeInfo?: string
  error?: string
}

// ── Complexity results ────────────────────────────────────────────────────────

export interface BackendComplexityEntry {
  format: 'SD-JWT VC' | 'JSON-LD VC' | 'mdoc'
  lib: 'withLib' | 'noLib'
  parseTimeMs: number
  parseTimeNs: number
  parseIterations: number
  linesOfCode: number
  asyncSteps: number
  cyclomaticComplexity: number
  externalNetworkCalls: number
  externalDependencies: string[]
  networkCallDescription: string[]
}

// ── Security results ──────────────────────────────────────────────────────────

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'none'

export interface BackendSecurityTest {
  id: string
  name: string
  format: 'SD-JWT VC' | 'JSON-LD VC' | 'mdoc' | 'Both'
  category: 'DoS' | 'Injection' | 'SSRF' | 'AlgorithmConfusion' | 'ContextHijack' | 'CborMalleability'
  severity: Severity
  description: string
  result: 'vulnerable' | 'mitigated' | 'partial' | 'not-applicable'
  details: string
  timeMs?: number
  normalTimeMs?: number
  cveReferences?: string[]
}

// ── Unified job result ────────────────────────────────────────────────────────

export interface BackendJobResult {
  jobId: string
  status: 'pending' | 'running' | 'done' | 'error'
  progress: string[]
  nodeResult?: LangSpeedResult
  pythonResult?: LangSpeedResult
  goResult?: LangSpeedResult
  complexityResult?: BackendComplexityEntry[] | { error: string }
  securityResult?: BackendSecurityTest[] | { error: string }
  error?: string
  durationMs?: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert backend speed entry key (e.g. "SD-JWT VC-withLib-sign") to SpeedResult-like shape */
export function adaptBackendToSpeedResults(
  nodeResult: LangSpeedResult | undefined,
  lib: 'withLib' | 'noLib',
): Array<{ format: string; operation: 'sign' | 'verify'; avgMs: number; opsPerSec: number; iterations: number; totalMs: number }> {
  if (!nodeResult?.results) return []
  const formats = ['SD-JWT VC', 'JSON-LD VC', 'JSON-LD VC (JCS)', 'mdoc'] as const
  const out = []
  for (const fmt of formats) {
    for (const op of ['sign', 'verify'] as const) {
      const key = `${fmt}-${lib}-${op}`
      const e = nodeResult.results[key]
      if (e && e.opsPerSec > 0) {
        out.push({
          format: fmt,
          operation: op,
          avgMs: e.avgMs,
          opsPerSec: e.opsPerSec,
          iterations: e.iterations,
          totalMs: e.avgMs * e.iterations,
        })
      }
    }
  }
  return out
}

export function isBackendComplexityArray(v: unknown): v is BackendComplexityEntry[] {
  return Array.isArray(v)
}

export function isBackendSecurityArray(v: unknown): v is BackendSecurityTest[] {
  return Array.isArray(v)
}
