# linux-bench — VCフォーマット比較ベンチマーク（Linuxサーバ用計測キット）

論文「Verifiable Credential フォーマットの署名検証性能に関する実証的評価：SD-JWT VC、W3C VCDM、mdoc の3言語横断ベンチマーク」の性能計測を、
Linuxサーバ（ベアメタル推奨）上で言語別・クレデンシャルフォーマット別に再現するための自己完結キットです。
このディレクトリだけをサーバにコピーすれば動作します。

## 1. 構成

```
linux-bench/
├── README.md            このドキュメント
├── config.sh            計測パラメータ設定（N, RUNS, CPUピニング等）
├── run-all.sh           一括実行スクリプト（計測→集計まで）
├── aggregate.mjs        統計集計（全言語共通の統計計算・run間中央値・Markdownサマリ）
├── node/
│   ├── bench.mjs        Node.jsエンジン
│   └── package.json     依存: jose, jsonld, cbor-x, canonicalize, OB3コンテキスト
├── go/
│   ├── main.go          Goエンジン
│   └── go.mod           依存: piprate/json-gold, fxamacker/cbor
├── python/
│   ├── bench.py         Pythonエンジン
│   └── requirements.txt 依存: cryptography, PyLD, cbor2
└── results/             計測結果（実行時に生成）
```

### 対応マトリクス（言語 × フォーマット）

| フォーマット | node | go | python | 内容 |
|---|---|---|---|---|
| `sdjwt` | ✓（node:crypto + jose参考値） | ✓（stdlib） | ✓（cryptography） | Ed25519 JWT の署名/検証 |
| `jsonld` | ✓（jsonld + noLib） | ✓（json-gold + noLib） | ✓（PyLD + noLib） | RDFC-1.0正規化 + SHA-256 + Ed25519。normalize単体も計測（jsonldライブラリはRDFC-1.0をアルゴリズム識別子 `URDNA2015` として提供） |
| `jsonld-jcs` | ✓（canonicalize + noLib） | ✓（noLib） | ✓（noLib） | JCS (RFC 8785) + SHA-256 + Ed25519 |
| `mdoc` | ✓（cbor-x + 手書きCBOR） | ✓（fxamacker/cbor） | ✓（cbor2） | CBOR/COSE_Sign1 + ECDSA P-256（raw r‖s） |
| `jsonld-complex` | ✓（**nodeのみ**） | — | — | Open Badges v3.0 / DCC型 / 合成ブランクノード10・50 のRDFC-1.0正規化（論文表14） |
| `breakdown` | ✓（**nodeのみ**） | — | — | W3C VCDM署名処理の内訳: 正規化/ハッシュ/署名を個別計測（論文表7） |
| `serial` | ✓（**nodeのみ**） | — | — | シリアライズ速度・暗号処理なし + ペイロードサイズ（論文表10） |
| `scaling` | ✓（**nodeのみ**） | — | — | 属性数スケーリング 5/20/100/500 + ペイロードサイズ（論文表11） |
| `seldisc` | ✓（**nodeのみ**） | — | — | 選択的開示 1/3/5/10/20 of 20（論文表12） |
| `unified` | ✓（**nodeのみ**） | — | — | Ed25519統一ベンチ（mdocはCOSE alg -8）（論文表13） |

クレデンシャルのペイロード・実装方式は論文4.2／4.3節と同一です。

## 2. 前提環境

- Linux x86_64 / arm64（Ubuntu 22.04 で動作確認）
- Node.js **v22系**（論文計測: v22.22.3。`nvm install 22` 推奨）
- Go **1.21以上**（`go` エンジンを使う場合）
- Python **3.10以上**（`python` エンジンを使う場合）
- インターネット接続は**セットアップ時のみ**必要（npm/go mod/pip）。計測中の外部通信はありません
  （JSON-LDコンテキストはすべて静的埋め込み）。

## 3. セットアップ

```bash
# キットをサーバへ配置
scp -r linux-bench user@server:~/ && ssh user@server
cd ~/linux-bench

# --- Node.js ---
cd node && npm install && cd ..

# --- Go ---
cd go && go mod tidy && go build -o vc-bench . && cd ..

# --- Python ---
python3 -m venv .venv && source .venv/bin/activate
pip install -r python/requirements.txt
```

Python を venv で入れた場合は、実行時に `PYTHON_BIN=$PWD/.venv/bin/python3` を指定するか、
venv を activate した状態で `run-all.sh` を実行してください。

### ベアメタルでの推奨OS設定（任意・要root）

計測ノイズを最小化するため、可能であれば以下を設定します（論文7章・8章の変動要因対策）:

```bash
# CPUガバナを performance に固定
sudo cpupower frequency-set -g performance
#（cpupowerが無い場合）
echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor

# ターボブースト無効化（Intel）
echo 1 | sudo tee /sys/devices/system/cpu/intel_pstate/no_turbo
# （AMD） echo 0 | sudo tee /sys/devices/system/cpu/cpufreq/boost

# SMT（ハイパースレッディング）無効化
echo off | sudo tee /sys/devices/system/cpu/smt/control

# 計測プロセスを特定コアに固定（run-all.sh の CPU_PIN で指定）
CPU_PIN="2" ./run-all.sh
```

これらは必須ではありません。設定内容は `results/<日時>/environment.txt` に自動記録されます。

## 4. 実行方法

### 一括実行（推奨）

```bash
./run-all.sh
```

既定では **全3言語 × 4フォーマット（+ node の jsonld-complex）を、N=2,000イテレーション × 独立5回**
実行し、`results/<日時>/` に生データと集計（`summary.md` / `summary.json`）を出力します。
所要時間の目安: 数分（jsonld-complex を含む。マシン性能に依存）。

対象・パラメータは環境変数で上書きできます:

```bash
N=500 RUNS=3 ./run-all.sh                    # 短縮実行（動作確認用）
LANGS="node" FORMATS="sdjwt jsonld" ./run-all.sh   # Nodeの2フォーマットだけ
LANGS="go python" NODE_EXTRA_FORMATS="" ./run-all.sh
CPU_PIN="2" ./run-all.sh                     # コア2に固定
```

### 言語別・フォーマット別の個別実行

各エンジンは共通のCLIを持ちます（`--format`/`--n`/`--warmup`/`--out`）:

```bash
# Node.js
node node/bench.mjs --format sdjwt --n 2000 --warmup 50 --out results/node_sdjwt_run1.json

# Go（ビルド済みバイナリ）
./go/vc-bench -format mdoc -n 2000 -warmup 50 -out results/go_mdoc_run1.json

# Python
python3 python/bench.py --format jsonld --n 2000 --warmup 50 --out results/python_jsonld_run1.json

# 複雑クレデンシャル（nodeのみ）
node node/bench.mjs --format jsonld-complex --n 2000 --out results/node_complex_run1.json
```

個別実行した結果も、同じディレクトリに集めて集計できます:

```bash
node aggregate.mjs results/ results/summary
```

## 5. 計測方法（論文4.3.1節と同一）

1. **タイマ**: Node = `process.hrtime.bigint()`、Go = `time.Now()`（モノトニック）、
   Python = `time.perf_counter_ns()`。いずれもナノ秒精度。
2. **手順**: ウォームアップ50回（JIT・キャッシュ安定化）→ 本計測N=2,000回。
   **各イテレーションの所要時間を個別に記録**します（バッチ計測はしない）。
3. **エンジンは生タイミング(ns)のみ出力**し、統計計算は `aggregate.mjs` が全言語共通ロジックで行います:
   - 平均・標本標準偏差(σ)・95%信頼区間
   - p50/p90/p95/p99（線形補間）・min/max
   - 外れ値: Tukey基準（Q1−1.5×IQR 〜 Q3+1.5×IQR の外側）を**検出・件数報告のみ**（除去しない）
   - トリム平均（Tukey外れ値除外。p50との一致確認用の参考値）
4. **独立5回実行**: プロセスを分けてRUNS回繰り返し、**各統計量のrun間中央値**を最終値とします。
   `summary.md` の「p50 run変動%」列でrun間の安定性を確認できます（論文では8%以内を確認）。
5. **代表値**: 分布が右裾に長いため、比較の主たる統計量は**中央値(p50)**、平均は参考値です。

## 6. 出力形式

### 生データ（`<lang>_<format>_run<k>.json`）

```json
{
  "lang": "node", "format": "sdjwt", "n": 2000, "warmup": 50,
  "env": { "node": "v22.22.3", "libraries": { "jose": "6.2.3", ... }, ... },
  "benches": {
    "sdjwt/stdcrypto/sign": { "n": 2000, "warmup": 50, "timings_ns": [26208, ...] }
  }
}
```

ベンチマークキーは `フォーマット/実装(ライブラリ)/操作` の形式です。
例: `jsonld/json-gold/verify`, `mdoc/cbor2/sign`, `jsonld-complex/ob3/normalize`。

### 集計（`summary.md` / `summary.json`）

言語ごとのMarkdown表（平均・σ・95%CI・p50・p95・外れ値%・ops/sec・p50 run変動%、すべて小数第3位）。
`summary.json` は論文の表を差し替える際の機械可読データです。

## 7. 論文への反映

| 論文の表・図 | summary.md の対応キー |
|---|---|
| 表9（Node署名/検証） | `node :: sdjwt/*`, `jsonld/*`, `jsonld-jcs/*`, `mdoc/*` |
| 表9のjose参考行 | `node :: sdjwt/jose/*` |
| 図2（Python） | `python :: */sign, */verify` |
| 図3（Go） | `go :: */sign, */verify` |
| 表14・図6（複雑クレデンシャル） | `node :: jsonld-complex/*/normalize` |
| 表7（署名処理内訳） | `node :: breakdown/normalize|hash|sign`（全体は `breakdown/full-pipeline-sign`） |
| 表10（シリアライズ速度） | `node :: serial/*`（ペイロードサイズはメタ情報 `serial/*/payloadBytes`） |
| 表11・図4（属性数スケーリング） | `node :: scaling/<fmt>/<属性数>`（サイズはメタ情報） |
| 表12・図5（選択的開示） | `node :: seldisc/<fmt>/<開示数>of20` |
| 表13（Ed25519統一） | `node :: unified/<fmt>/sign|verify` |

数値確定後は、リポジトリルートの `generate-paper.js` / `generate-paper-en.js` /
`generate-charts.js` / `generate-charts-en.js` の該当数値を更新し、docx/図を再生成してください。
表4（実行環境）には `results/<日時>/environment.txt` の内容（CPU型番・ガバナ設定等）を反映します。

## 8. トラブルシューティング

- `npm install` でネイティブビルドに失敗する: `cbor-x` はプリビルトバイナリが無い環境で
  ソースビルドにフォールバックします。`build-essential` を導入するか、失敗しても
  pure-JS フォールバックで動作します。
- Go の `json-gold` 取得に失敗する: プロキシ環境では `GOPROXY` を設定してください。
- Python で `pyld` が遅い: 仕様どおりです（pure Python実装）。論文でも言語間比較は
  相対順位の確認が目的である旨を明記しています。
- run間変動（p50 run変動%）が大きい: 他プロセスの干渉が疑われます。`CPU_PIN` の利用、
  ガバナ固定、RUNS を増やす（例: `RUNS=9`）ことを検討してください。

## 9. 論文リポジトリ内の関連ファイル

- `../server/bench/paperBench.mjs` — 論文改訂時に使用した一括ベンチ（Node、スケーリング・選択的開示等を含む）
- `../analysis/agg.json` ほか — 2026-07 改訂時の実測データ
- `../generate-paper.js` / `../generate-paper-en.js` — 論文本文の生成スクリプト
