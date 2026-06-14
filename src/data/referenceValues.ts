// Shared Go/Python reference benchmark values (ops/sec).
// Measured on Apple M2 Pro; users can override via the ⚡ 言語別速度比較 tab.

export type RefValues = Record<string, { Go: number; Python: number }>

export const DEFAULT_REF: RefValues = {
  'SD-JWT VC-withLib-sign':          { Go: 28000, Python: 7200 },
  'SD-JWT VC-withLib-verify':        { Go: 33000, Python: 9100 },
  'SD-JWT VC-noLib-sign':            { Go: 22000, Python: 5800 },
  'SD-JWT VC-noLib-verify':          { Go: 27000, Python: 7600 },
  'JSON-LD VC-withLib-sign':         { Go: 8000,  Python: 160  },
  'JSON-LD VC-withLib-verify':       { Go: 7000,  Python: 160  },
  'JSON-LD VC-noLib-sign':           { Go: 28000, Python: 5500 },
  'JSON-LD VC-noLib-verify':         { Go: 32000, Python: 6500 },
  'JSON-LD VC (JCS)-withLib-sign':   { Go: 30000, Python: 5000 },
  'JSON-LD VC (JCS)-withLib-verify': { Go: 30000, Python: 5000 },
  'JSON-LD VC (JCS)-noLib-sign':     { Go: 30000, Python: 5000 },
  'JSON-LD VC (JCS)-noLib-verify':   { Go: 30000, Python: 5000 },
  'mdoc-withLib-sign':               { Go: 9200,  Python: 2100 },
  'mdoc-withLib-verify':             { Go: 12500, Python: 2600 },
  'mdoc-noLib-sign':                 { Go: 8100,  Python: 1900 },
  'mdoc-noLib-verify':               { Go: 11200, Python: 2300 },
}
