// Runs Go WASM benchmark in the browser.
// The WASM binary (public/go-bench.wasm) is compiled from go/bench/main.go.
// wasm_exec.js (Go's JS runtime helper) is loaded from public/wasm_exec.js.

export interface GoBenchEntry {
  opsPerSec: number
  avgMs: number
  iterations: number
  isActual: true
}

export type GoBenchResults = Record<string, GoBenchEntry>

declare global {
  interface Window {
    Go: new () => GoInstance
    goBench: (() => string) | undefined
  }
}

interface GoInstance {
  importObject: WebAssembly.Imports
  run: (instance: WebAssembly.Instance) => Promise<void>
}

let _loaded = false

/** Load wasm_exec.js script from public/ (idempotent). */
async function loadWasmExec(): Promise<void> {
  if (_loaded || document.querySelector('script[src*="wasm_exec"]')) {
    _loaded = true
    return
  }
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = '/wasm_exec.js'
    s.onload = () => { _loaded = true; resolve() }
    s.onerror = () => reject(new Error('Failed to load wasm_exec.js'))
    document.head.appendChild(s)
  })
}

/** Load and instantiate go-bench.wasm. Registers window.goBench(). */
async function instantiateWasm(): Promise<void> {
  if (typeof window.goBench === 'function') return // already running

  const response = await fetch('/go-bench.wasm')
  if (!response.ok) throw new Error(`Failed to fetch go-bench.wasm: ${response.status}`)
  const wasmBytes = await response.arrayBuffer()

  const go = new window.Go()
  const { instance } = await WebAssembly.instantiate(wasmBytes, go.importObject)
  go.run(instance) // non-blocking: Go main() blocks on channel, exposing goBench()

  // Wait until goBench is registered
  await new Promise<void>((resolve, reject) => {
    let tries = 0
    const check = () => {
      if (typeof window.goBench === 'function') return resolve()
      if (++tries > 50) return reject(new Error('goBench was never registered'))
      setTimeout(check, 100)
    }
    check()
  })
}

export async function runGoBenchmark(
  onProgress: (msg: string) => void,
): Promise<GoBenchResults> {
  onProgress('Loading wasm_exec.js...')
  await loadWasmExec()

  onProgress('Loading go-bench.wasm (4.6 MB)...')
  await instantiateWasm()

  onProgress('Running the Go benchmark (ECDSA P-256)...')
  const raw = window.goBench!()
  const parsed = JSON.parse(raw) as {
    results: Record<string, GoBenchEntry>
    errors: Record<string, string>
  }

  if (Object.keys(parsed.errors ?? {}).length > 0) {
    console.warn('[Go benchmark] errors:', parsed.errors)
  }

  onProgress(`Done — ${Object.keys(parsed.results).length} measurements`)
  return parsed.results
}
