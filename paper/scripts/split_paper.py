#!/usr/bin/env python3
"""
split_paper.py — VC_Format_Comparison_Paper.docx を2本に分割する。

  論文A: 性能検証   VC_Format_Comparison_Performance.docx
  論文B: セキュリティ分析 VC_Format_Comparison_Security.docx

元ファイルは変更しない。ブロック（w:p / w:tbl）単位で章を抽出し、
章番号・図表番号・引用番号を各論文向けに振り直す。

使い方: python3 split_paper.py <入力docx> <出力ディレクトリ>
"""
import re
import sys
import zipfile

SRC = sys.argv[1]
OUTDIR = sys.argv[2].rstrip('/')

BLOCK_RE = re.compile(r'<w:(p|tbl)(?:\s[^>]*)?>.*?</w:\1>|<w:p(?:\s[^>]*)?/>', re.S)


def txt(x):
    return re.sub(r'<[^>]+>', '', x)


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def set_text(block, text):
    """ブロック内の先頭 <w:t> に text を入れ、残りを空にする（書式は保持）"""
    done = [False]

    def repl(m):
        if not done[0]:
            done[0] = True
            return '<w:t xml:space="preserve">%s</w:t>' % esc(text)
        return '<w:t xml:space="preserve"></w:t>'
    return re.sub(r'<w:t(?:\s[^>]*)?>.*?</w:t>', repl, block, flags=re.S)


def map_text(block, fn):
    """ブロック内の各 <w:t> のテキストに fn を適用する"""
    return re.sub(r'<w:t(?:\s[^>]*)?>(.*?)</w:t>',
                  lambda m: '<w:t xml:space="preserve">%s</w:t>' % fn(m.group(1)),
                  block, flags=re.S)


# ══════════════════════════════════════════════════════════════════
# 論文A: 性能検証
# ══════════════════════════════════════════════════════════════════
PERF = {
    'file': 'VC_Format_Comparison_Performance.docx',
    'title_ja': ['Verifiable Credential フォーマットの署名検証性能に関する実証的評価：',
                 'SD-JWT VC、JSON-LD VC、mdoc の3言語横断ベンチマーク'],
    'title_en': ['An Empirical Evaluation of Signature and Verification Performance of Verifiable Credential Formats:',
                 'A Cross-Language Benchmark of SD-JWT VC, JSON-LD VC, and mdoc'],
    'keywords_ja': 'キーワード：Verifiable Credentials, SD-JWT, JSON-LD, mdoc, 署名検証性能, RDF正規化, URDNA2015, ベンチマーク',
    'keywords_en': 'Keywords: Verifiable Credentials, SD-JWT, JSON-LD, mdoc, Signature Verification Performance, '
                   'RDF Canonicalization, URDNA2015, Benchmarking',
    'header': 'Verifiable Credentialフォーマットの署名検証性能に関する実証的評価',
    # (元の見出しタイトル, 新しい見出しテキスト) — None は見出しをそのまま使う
    'sections': [
        ('1. はじめに', '1. はじめに'),
        ('2. 関連研究', '2. 関連研究'),
        ('3. 各フォーマットの技術仕様', None),
        ('3.1 概要', None), ('3.2 SD-JWT VC', None),
        ('3.2.1 規格の位置づけ', None), ('3.2.2 データモデル', None), ('3.2.3 署名処理', None),
        ('3.2.4 検証処理', None), ('3.2.5 選択的開示', None),
        ('3.3 JSON-LD VC（W3C Verifiable Credentials Data Model 2.0）', None),
        ('3.3.1 規格の位置づけ', None), ('3.3.2 データモデル', None),
        ('3.3.3 Data Integrity Proof仕様', None), ('3.3.4 暗号スイートのアーキテクチャ', None),
        ('3.3.5 署名処理（Add Proof Algorithm）', None), ('3.3.6 検証処理（Verify Proof Algorithm）', None),
        ('3.3.7 URDNA2015正規化アルゴリズムの詳細', None), ('3.3.8 セマンティック相互運用性', None),
        ('3.4 mdoc（ISO/IEC 18013-5）', None),
        ('3.4.1 規格の位置づけ', None), ('3.4.2 データモデル', None),
        ('3.4.3 Mobile Security Object（MSO）', None), ('3.4.4 署名処理', None),
        ('3.4.5 検証処理', None), ('3.4.6 選択的開示とプライバシー保護', None),
        ('3.4.7 ISO/IEC TS 18013-7によるオンライン提示への拡張', None),
        ('4. 実験設計', None), ('4.1 実行環境', None), ('4.2 テストツールの構成', None),
        ('4.3 ベンチマーク手法', None),
        ('4.3.1 署名検証速度ベンチマーク', None),
        ('4.3.2 デシリアライズ複雑性分析', None),
        ('4.3.5 複雑クレデンシャルにおける正規化評価', '4.3.3 複雑クレデンシャルにおける正規化評価'),
        ('5. 実験結果', None),
        ('5.1 署名検証速度', None),
        ('5.2 デシリアライズ複雑性', None),
        ('5.2.1 SD-JWT VC（循環的複雑度: 3）', None),
        ('5.2.2 JSON-LD VC（循環的複雑度: 8）', None),
        ('5.2.3 mdoc（循環的複雑度: 5）', None),
        ('5.4 言語・実行環境別の性能比較', '5.3 言語・実行環境別の性能比較'),
        ('5.5 シリアライズ速度（暗号処理なし）', '5.4 シリアライズ速度（暗号処理なし）'),
        ('5.6 属性数スケーリング評価', '5.5 属性数スケーリング評価'),
        ('5.7 選択的開示性能', '5.6 選択的開示性能'),
        ('5.10 Ed25519統一アルゴリズムベンチマーク', '5.7 Ed25519統一アルゴリズムベンチマーク'),
        ('5.11 複雑クレデンシャルにおけるURDNA2015正規化', '5.8 複雑クレデンシャルにおけるURDNA2015正規化'),
        ('6. 考察', None),
        ('6.1 署名検証性能に関する考察', None),
        ('6.2 実装複雑性に関する考察', None),
        ('6.4 フォーマット特性のトレードオフ構造', '6.3 フォーマット特性のトレードオフ構造'),
        ('6.5 ユースケース別の推奨', '6.4 ユースケース別の推奨'),
        ('7. 制約と今後の課題', None),
        ('8. Threats to Validity', None),
        ('9. 結論', None),
        ('付録A 実装コード', None),
        ('A.1 SD-JWT VCの署名・検証', None),
        ('A.2 JSON-LD VCの署名・検証', None),
        ('A.3 mdoc (ISO 18013-5) の署名・検証', None),
        ('A.5 複雑性分析の対象コード（アノテーション付き）', 'A.4 複雑性分析の対象コード（アノテーション付き）'),
    ],
    # 節番号の相互参照マップ（本文中の「5.11節」などの置換）
    'secref': {'5.4': '5.3', '5.5': '5.4', '5.6': '5.5', '5.7': '5.6', '5.10': '5.7', '5.11': '5.8',
               '6.4': '6.3', '6.5': '6.4', '4.3.5': '4.3.3'},
    # 表・図・リスト番号の再採番
    'tabref': {'1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '8': '7', '9': '8',
               '11': '9', '12': '10', '15': '11', '16': '12', '10': '13'},
    'figref': {'1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6'},
    'lstref': {'1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6',
               '9': '7', '10': '8', '11': '9'},
}

# ══════════════════════════════════════════════════════════════════
# 論文B: セキュリティ分析
# ══════════════════════════════════════════════════════════════════
SEC = {
    'file': 'VC_Format_Comparison_Security.docx',
    'title_ja': ['Verifiable Credential 検証パイプラインのセキュリティ分析：',
                 'JSON-LD/RDFC 正規化に由来する攻撃面と SD-JWT VC・mdoc との比較'],
    'title_en': ['A Security Analysis of Verifiable Credential Verification Pipelines:',
                 'Attack Surface Arising from JSON-LD/RDFC Canonicalization Compared with SD-JWT VC and mdoc'],
    'keywords_ja': 'キーワード：Verifiable Credentials, セキュリティ評価, URDNA2015, RDF正規化, DoS, '
                   'コンテキストインジェクション, SSRF, alg:none',
    'keywords_en': 'Keywords: Verifiable Credentials, Security Evaluation, URDNA2015, RDF Canonicalization, '
                   'Denial of Service, Context Injection, SSRF, alg:none',
    'header': 'Verifiable Credential検証パイプラインのセキュリティ分析',
    'sections': [
        ('1. はじめに', '1. はじめに'),
        ('2. 関連研究', '2. 関連研究'),
        ('3. 各フォーマットの技術仕様', None),
        ('3.1 概要', None), ('3.2 SD-JWT VC', None),
        ('3.2.1 規格の位置づけ', None), ('3.2.2 データモデル', None), ('3.2.3 署名処理', None),
        ('3.2.4 検証処理', None), ('3.2.5 選択的開示', None),
        ('3.3 JSON-LD VC（W3C Verifiable Credentials Data Model 2.0）', None),
        ('3.3.1 規格の位置づけ', None), ('3.3.2 データモデル', None),
        ('3.3.3 Data Integrity Proof仕様', None), ('3.3.4 暗号スイートのアーキテクチャ', None),
        ('3.3.5 署名処理（Add Proof Algorithm）', None), ('3.3.6 検証処理（Verify Proof Algorithm）', None),
        ('3.3.7 URDNA2015正規化アルゴリズムの詳細', None), ('3.3.8 セマンティック相互運用性', None),
        ('3.4 mdoc（ISO/IEC 18013-5）', None),
        ('3.4.1 規格の位置づけ', None), ('3.4.2 データモデル', None),
        ('3.4.3 Mobile Security Object（MSO）', None), ('3.4.4 署名処理', None),
        ('3.4.5 検証処理', None), ('3.4.6 選択的開示とプライバシー保護', None),
        ('3.4.7 ISO/IEC TS 18013-7によるオンライン提示への拡張', None),
        ('4. 実験設計', None), ('4.1 実行環境', None), ('4.2 テストツールの構成', None),
        ('4.3 ベンチマーク手法', '4.3 評価手法'),
        ('4.3.3 脅威モデル', '4.3.1 脅威モデル'),
        ('4.3.4 正規化セキュリティテスト', '4.3.2 正規化セキュリティテスト'),
        ('4.3.5 複雑クレデンシャルにおける正規化評価', '4.3.3 複雑クレデンシャルにおける正規化評価'),
        ('5. 実験結果', None),
        ('5.3 正規化セキュリティテスト', '5.1 正規化セキュリティテスト'),
        ('5.8 JSON-LDコンテキストローダー比較', '5.2 JSON-LDコンテキストローダー比較'),
        ('5.9 URDNA2015 call limitによるDoS緩和', '5.3 URDNA2015 call limitによるDoS緩和'),
        ('5.6 属性数スケーリング評価', '5.4 正規化コストの属性数スケーリング'),
        ('5.11 複雑クレデンシャルにおけるURDNA2015正規化', '5.5 実運用スキーマにおける正規化コスト'),
        ('6. 考察', None),
        ('6.3.1 JSON-LD/RDFC検証パイプラインの攻撃面', '6.1 JSON-LD/RDFC検証パイプラインの攻撃面'),
        ('6.3.2 SD-JWT VCのセキュリティ', '6.2 SD-JWT VCのセキュリティ'),
        ('6.3.3 mdocのセキュリティ', '6.3 mdocのセキュリティ'),
        ('7. 制約と今後の課題', None),
        ('8. Threats to Validity', None),
        ('9. 結論', None),
        ('付録A 実装コード', ' 付録A セキュリティテストの実装コード'),
        ('A.4 セキュリティテストの実装例', 'A.1 セキュリティテストの実装例'),
    ],
    'secref': {'5.3': '5.1', '5.8': '5.2', '5.9': '5.3', '5.6': '5.4', '5.11': '5.5',
               '6.3.1': '6.1', '6.3.2': '6.2', '6.3.3': '6.3', '6.3': '6',
               '4.3.3': '4.3.1', '4.3.4': '4.3.2', '4.3.5': '4.3.3'},
    'tabref': {'1': '1', '2': '2', '3': '3', '7': '4', '13': '5', '14': '6', '11': '7', '16': '8'},
    'figref': {'4': '1', '6': '2'},
    'lstref': {'7': '1', '8': '2'},
    'pretext': [('単純（表4と同一）', '単純クレデンシャル')],
}


def build(src_blocks, spec, front, abstract_ja, abstract_en, sections_index, refs_new, ref_template):
    """spec に従って新しいブロック列を組み立てる"""
    out = []

    # ── 前付け（タイトル〜キーワード）──
    fb = [b for b in front]
    ti = [i for i, b in enumerate(fb) if txt(b).strip()]
    # 1,2: 和文タイトル / 4,5: 英文タイトル / 15: 概要 / 17: キーワード / 20: Abstract / 22: Keywords
    fb[1] = set_text(fb[1], spec['title_ja'][0])
    fb[2] = set_text(fb[2], spec['title_ja'][1])
    fb[4] = set_text(fb[4], spec['title_en'][0])
    fb[5] = set_text(fb[5], spec['title_en'][1])
    fb[15] = set_text(fb[15], abstract_ja)
    fb[17] = set_text(fb[17], spec['keywords_ja'])
    fb[20] = set_text(fb[20], abstract_en)
    fb[22] = set_text(fb[22], spec['keywords_en'])
    out.extend(fb)

    # ── 本体（選択した章を順に）──
    for old_title, new_title in spec['sections']:
        rng = sections_index.get(old_title)
        if rng is None:
            raise SystemExit('section not found: ' + old_title)
        s, e = rng
        for k in range(s, e + 1):
            blk = src_blocks[k]
            if k == s and new_title:
                blk = set_text(blk, new_title)
            out.append(blk)

    # ── 参考文献 ──
    out.append(set_text(src_blocks[sections_index['参考文献'][0]], '参考文献'))
    for r in refs_new:
        out.append(set_text(ref_template, r))
    return out


def renumber(blocks, spec, cite_map):
    """章・図表・引用の番号を振り直す"""
    def fix(t):
        for a, b in spec.get('pretext', []):
            t = t.replace(a, b)
        # 表・図・リスト参照
        t = re.sub(r'表\s?([0-9]{1,2})',
                   lambda m: '表' + spec['tabref'].get(m.group(1), '?' + m.group(1)), t)
        t = re.sub(r'図\s?([0-9]{1,2})',
                   lambda m: '図' + spec['figref'].get(m.group(1), '?' + m.group(1)), t)
        t = re.sub(r'リスト\s?([0-9]{1,2})',
                   lambda m: 'リスト' + spec['lstref'].get(m.group(1), '?' + m.group(1)), t)
        # 節参照（長い番号から先に）
        for old in sorted(spec['secref'], key=len, reverse=True):
            t = t.replace(old + '節', spec['secref'][old] + '節')
            t = t.replace('（' + old + '）', '（' + spec['secref'][old] + '）')
        # 引用番号
        t = re.sub(r'\[(\d{1,2})\]',
                   lambda m: '[#%s#]' % cite_map[m.group(1)] if m.group(1) in cite_map else '[!%s!]' % m.group(1), t)
        return t.replace('[#', '[').replace('#]', ']')

    out = []
    for b in blocks:
        if 'Courier New' in b:          # コードは触らない
            out.append(b); continue
        out.append(map_text(b, fix))
    return out


def main():
    zin = zipfile.ZipFile(SRC)
    entries = [(item, zin.read(item.filename)) for item in zin.infolist()]
    zin.close()
    xml = dict((i.filename, d) for i, d in entries)['word/document.xml'].decode('utf-8')
    head = xml[:xml.index('<w:body>') + len('<w:body>')]
    body = xml[xml.index('<w:body>') + len('<w:body>'):xml.rindex('</w:body>')]
    tail = xml[xml.rindex('</w:body>'):]

    blocks = [m.group(0) for m in BLOCK_RE.finditer(body)]
    sectpr = body[body.rindex('<w:sectPr'):] if '<w:sectPr' in body else ''

    # 章の範囲を索引化
    heads = []
    for i, b in enumerate(blocks):
        m = re.search(r'w:pStyle w:val="([123])"', b)
        if m and txt(b).strip():
            heads.append((i, txt(b).strip()))
    index = {}
    for j, (i, t) in enumerate(heads):
        end = heads[j + 1][0] - 1 if j + 1 < len(heads) else len(blocks) - 1
        index[t] = (i, end)

    front = blocks[:heads[0][0]]
    ref_blocks = blocks[index['参考文献'][0] + 1:index['参考文献'][1] + 1]
    ref_template = ref_blocks[0]
    old_refs = [txt(b).strip() for b in ref_blocks]

    import importlib.util
    spec_mod = importlib.util.spec_from_file_location('abst', OUTDIR + '/_abstracts.py')
    ab = importlib.util.module_from_spec(spec_mod)
    spec_mod.loader.exec_module(ab)

    for spec, abst in ((PERF, ab.PERF_ABSTRACT), (SEC, ab.SEC_ABSTRACT)):
        # 1) 章を抽出（引用番号は旧番号のまま）
        picked = []
        for old_title, new_title in spec['sections']:
            s, e = index[old_title]
            for k in range(s, e + 1):
                blk = blocks[k]
                if k == s and new_title:
                    blk = set_text(blk, new_title)
                picked.append(blk)
        # 差し替え段落（はじめに・結論など）
        picked = abst['patch'](picked, txt, set_text)

        # 2) 抽出後の本文から引用の初出順を求める
        order = []
        for b in picked:
            if 'Courier New' in b:
                continue
            for m in re.finditer(r'\[(\d{1,2})\]', txt(b)):
                if m.group(1) not in order:
                    order.append(m.group(1))
        cite_map = {old: str(i + 1) for i, old in enumerate(order)}

        # 3) 番号振り直し
        picked = renumber(picked, spec, cite_map)

        # 4) 参考文献を新しい順序で
        refs_new = []
        for old, new in sorted(cite_map.items(), key=lambda kv: int(kv[1])):
            body_txt = re.sub(r'^\[\d+\]\s*', '', old_refs[int(old) - 1])
            refs_new.append('[%s] %s' % (new, body_txt))

        # 5) 前付け
        fb = list(front)
        fb[1] = set_text(fb[1], spec['title_ja'][0])
        fb[2] = set_text(fb[2], spec['title_ja'][1])
        fb[4] = set_text(fb[4], spec['title_en'][0])
        fb[5] = set_text(fb[5], spec['title_en'][1])
        fb[15] = set_text(fb[15], abst['ja'])
        fb[17] = set_text(fb[17], spec['keywords_ja'])
        fb[20] = set_text(fb[20], abst['en'])
        fb[22] = set_text(fb[22], spec['keywords_en'])

        newblocks = fb + picked
        newblocks.append(set_text(blocks[index['参考文献'][0]], '参考文献'))
        newblocks += [set_text(ref_template, r) for r in refs_new]

        newxml = head + ''.join(newblocks) + sectpr + tail
        dst = OUTDIR + '/' + spec['file']
        zout = zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED)
        for item, data in entries:
            if item.filename == 'word/document.xml':
                data = newxml.encode('utf-8')
            elif item.filename == 'word/header1.xml' and spec.get('header'):
                # ヘッダー文字列は複数 run に分割されているため set_text で先頭にまとめる
                data = set_text(data.decode('utf-8'), spec['header']).encode('utf-8')
            zout.writestr(item, data)
        zout.close()

        unresolved = set()
        for b in newblocks:
            for m in re.finditer(r'[?!]\d{1,2}[!]?', txt(b)):
                unresolved.add(m.group(0))
        print(f"{spec['file']}: ブロック{len(newblocks)} / 参考文献{len(refs_new)}件 / "
              f"未解決参照 {sorted(unresolved) if unresolved else 'なし'}")


if __name__ == '__main__':
    main()
