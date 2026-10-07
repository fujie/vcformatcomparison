#!/usr/bin/env python3
"""
fix_paper_refs.py — VC_Format_Comparison_Paper.docx への3件の修正を適用する。

1. 参考文献を本文の初出順で採番し直し、リストを並べ替える（未引用の NIST SP 800-63-4 は削除）
2. Web 検証で判明した誤りを修正（RFC 番号の取り違え、著者名、巻号・節番号、URL）
3. 概要 / Abstract を簡潔に書き直す

使い方: python3 fix_paper_refs.py <入力docx> <出力docx>
"""
import re
import shutil
import sys
import zipfile

SRC = sys.argv[1]
DST = sys.argv[2]

# ── 旧番号 → 新番号（本文の初出順。旧13は未引用のため削除）────────────
RENUM = {1: 1, 2: 2, 3: 3, 7: 4, 4: 5, 18: 6, 16: 7, 17: 8, 15: 9, 9: 10,
         11: 11, 5: 12, 10: 13, 12: 14, 6: 15, 14: 16, 8: 17, 19: 18, 20: 19}

# ── 新しい参考文献リスト（Web検証済み。★は今回の修正箇所）──────────────
REFS = [
    # ★ SD-JWT VC は RFC ではなく Internet-Draft（旧: IETF RFC 9901）
    '[1] O. Terbu, D. Fett, and B. Campbell, "SD-JWT-based Verifiable Digital Credentials '
    '(SD-JWT VC)," IETF Internet-Draft draft-ietf-oauth-sd-jwt-vc-18, Aug. 2026. [Online]. '
    'Available: https://datatracker.ietf.org/doc/draft-ietf-oauth-sd-jwt-vc/',

    # ★ W3C 勧告は2025年5月15日（旧: 2024）
    '[2] M. Sporny, D. Longley, D. Chadwick, and I. Herman, "Verifiable Credentials Data Model v2.0," '
    'W3C Recommendation, May 2025. [Online]. Available: https://www.w3.org/TR/vc-data-model-2.0/',

    '[3] ISO/IEC 18013-5:2021, "Personal identification — ISO-compliant driving licence — '
    'Part 5: Mobile driving licence (mDL) application," 2021.',

    # ★ SD-JWT は RFC 9901（旧: RFC 9449 = DPoP。著者もDPoPのものが混入していた）
    '[4] D. Fett, K. Yasuda, and B. Campbell, "Selective Disclosure for JSON Web Tokens," '
    'IETF RFC 9901, Nov. 2025.',

    # ★ 編者は Longley, Kellogg, Yamamoto（旧: Longley and Sporny）
    '[5] D. Longley, G. Kellogg, and D. Yamamoto, "RDF Dataset Canonicalization (RDFC-1.0)," '
    'W3C Recommendation, May 2024. [Online]. Available: https://www.w3.org/TR/rdf-canon/',

    '[6] European Parliament and Council of the European Union, "Regulation (EU) 2024/1183 of 11 April 2024 '
    'amending Regulation (EU) No 910/2014 as regards establishing the European Digital Identity Framework '
    '(eIDAS 2.0)," Official Journal of the European Union, 2024. [Online]. '
    'Available: https://eur-lex.europa.eu/eli/reg/2024/1183/oj',

    # ★ 著者・会議・ページを実際の論文に修正（旧: S. Abraham, S. More, et al., ACM CODASPY 2021, pp.169–180）
    '[7] C. Brunner, U. Gallersdörfer, F. Knirsch, D. Engel, and F. Matthes, "DID and VC: Untangling '
    'Decentralized Identifiers and Verifiable Credentials for the Web of Trust," in Proc. 3rd Int. Conf. '
    'on Blockchain Technology and Applications (ICBTA), 2020, pp. 61–66. doi: 10.1145/3446983.3446992',

    # ★ 著者を TechRxiv 掲載ページの記載に修正（旧: A. Helm, T. Lodderstedt, K. Yasuda）＋DOI付加
    '[8] Y. Wu and J. Tian, "Selective-Disclosure in Decentralised Identity: '
    'A Comparative Evaluation of BBS+ and SD-JWT," TechRxiv preprint, Aug. 2025. '
    'doi: 10.36227/techrxiv.175492163.32399388',

    '[9] A. Buldini, C. Mazzocca, R. Montanari, and S. Uluagac, "Compact and Selective Disclosure for '
    'Verifiable Credentials," arXiv:2506.00262, 2025. [Online]. Available: https://arxiv.org/abs/2506.00262',

    # ★ セキュリティ考慮事項は §7.1 Dataset Poisoning（旧: §4.8）
    '[10] W3C, "Security Considerations — Dataset Poisoning," in RDF Dataset Canonicalization (RDFC-1.0), '
    '§7.1, W3C Recommendation, 2024. [Online]. '
    'Available: https://www.w3.org/TR/rdf-canon/#dataset-poisoning',

    '[11] M. Jones, J. Bradley, and N. Sakimura, "JSON Web Token (JWT)," IETF RFC 7519, 2015.',

    '[12] Y. Sheffer, D. Hardt, and M. Jones, "JSON Web Token Best Current Practices," '
    'IETF RFC 8725 (BCP 225), 2020.',

    # ★ 正式名称・W3C勧告（2025年5月）に修正（旧: "Data Integrity 1.0," W3C Working Draft, 2024）
    '[13] M. Sporny, T. Thibodeau Jr., I. Herman, D. Longley, and G. Bernstein, '
    '"Verifiable Credential Data Integrity 1.0," W3C Recommendation, May 2025. [Online]. '
    'Available: https://www.w3.org/TR/vc-data-integrity/',

    '[14] C. Bormann and P. Hoffman, "Concise Binary Object Representation (CBOR)," '
    'IETF RFC 8949 (STD 94), 2020.',

    '[15] J. Schaad, "CBOR Object Signing and Encryption (COSE): Structures and Process," '
    'IETF RFC 9052 (STD 96), 2022.',

    '[16] N. Fujie, "vcbench — Verifiable Credential Format Benchmark," GitHub, 2026. [Online]. '
    'Available: https://github.com/fujie/vcbench',

    # ★ 発見者は Tim McLean（旧: T. McLaughlin）。NVDのURLを付加
    '[17] T. McLean, "Critical vulnerabilities in JSON Web Token libraries," 2015; CVE-2015-9235, NVD. '
    '[Online]. Available: https://nvd.nist.gov/vuln/detail/CVE-2015-9235',

    # ★ 文書バージョン・発行日を明記
    '[18] 1EdTech Consortium, "Open Badges Specification, Version 3.0, Final Release," '
    'Document Version 1.4.5, Jun. 2026. [Online]. Available: https://www.imsglobal.org/spec/ob/v3p0/',

    # ★ 現行URLへ更新（digitalcredentials.mit.edu は dcconsortium.org へ転送）
    '[19] Digital Credentials Consortium, "Digital Credentials Consortium," 2026. [Online]. '
    'Available: https://dcconsortium.org/',
]

# ── 本文の事実誤りの修正（採番前に適用。引用番号は旧番号のまま書く）──────
BODY_FIXES = [
    ('SD-JWT VCはIETF RFC 9901として標準化され、',
     'SD-JWT VCはIETFで策定が進むInternet-Draftとして規定されており、'),
    ('SD-JWT VC（SD-JWT-based Verifiable Credentials）はIETF RFC 9901 [1] として標準化されたクレデンシャルフォーマットである。',
     'SD-JWT VC（SD-JWT-based Verifiable Digital Credentials）はIETFで策定中のInternet-Draft [1] として規定されるクレデンシャルフォーマットである。'),
    ('選択的開示にはSD-JWT（Selective Disclosure for JWTs, RFC 9449 [7]）の仕組みを用いる',
     '選択的開示にはSD-JWT（Selective Disclosure for JSON Web Tokens, RFC 9901 [7]）の仕組みを用いる'),
    ('使用可能な署名アルゴリズムはRFC 9901において規定されており、',
     '使用可能な署名アルゴリズムはSD-JWT（RFC 9901）において規定されており、'),
    ('Abraham et al. [16] はDID', 'Brunner et al. [16] はDID'),
    ('Helm et al. [17] がBBS+署名', 'Wu と Tian [17] がBBS+署名'),
    # 表1のセル
    ('IETF RFC 9901', 'IETF draft-ietf-oauth-sd-jwt-vc'),
]

# ── 簡潔化した概要 / Abstract ──────────────────────────────────────
ABSTRACT_JA = (
    '本稿では、検証可能なデジタルクレデンシャル（Verifiable Credential: VC）の主要3フォーマット'
    '——SD-JWT VC、JSON-LD VC（W3C VCDM 2.0）、mdoc（ISO/IEC 18013-5）——を、署名検証性能・'
    '実装複雑性・正規化セキュリティの3軸で実証的に比較評価した。SMT無効化・CPUコア固定を施した'
    '専用Linuxサーバ上で、Node.js・Go・Pythonの3言語をナノ秒精度・同一手法（N=2,000×独立5回、'
    '統計量は中央値）で計測した結果、署名はSD-JWT VCが最速（p50: 0.038 ms/op）、検証はmdocが最速'
    '（0.090 ms/op）であり、JSON-LD VCはSD-JWT VCの約1.5倍のレイテンシを示した。この差の主因は'
    'URDNA2015正規化であり、実運用の教育スキーマ（1EdTech OpenBadges v3.0、DCC型学位クレデンシャル）'
    'では正規化コストが単純なクレデンシャルの22〜41倍に達し、検証パイプラインの支配的コストとなる。'
    'Ed25519統一ベンチマークにより、mdocの検証の高速性がECDSA P-256/COSE構成に部分的に依存すること'
    'も示した。セキュリティ評価では、JSON-LD/RDFC系の検証パイプラインがリモートコンテキスト解決と'
    '正規化に由来する追加の攻撃面（DoS・コンテキストインジェクション・SSRF）を持つ一方、SD-JWT VC'
    'およびmdocは評価した攻撃ベクトルの範囲で標準的な検証設定に対し耐性を示した。計測ツールは'
    'オープンソースとして公開しており、再現可能な評価フレームワークとしてフォーマット選定に資する'
    'ことを目的とする。'
)

ABSTRACT_EN = (
    'This paper empirically compares three major Verifiable Credential (VC) formats — SD-JWT VC, '
    'JSON-LD VC (W3C VCDM 2.0), and mdoc (ISO/IEC 18013-5) — along three axes: signature verification '
    'performance, implementation complexity, and canonicalization security. Node.js, Go, and Python '
    'engines were measured on a dedicated Linux server (SMT disabled, pinned core) with '
    'nanosecond-precision timers under an identical methodology (N=2,000 iterations across five '
    'independent runs; medians of each statistic). SD-JWT VC signs fastest (p50: 0.038 ms/op) and mdoc '
    'verifies fastest (0.090 ms/op), while JSON-LD VC exhibits about 1.5x the verification latency of '
    'SD-JWT VC. URDNA2015 canonicalization accounts for most of that gap: with production education '
    'schemas (1EdTech Open Badges v3.0 and a DCC-style academic credential), canonicalizing credentials '
    'containing blank nodes costs 22-41x a simple credential and becomes the dominant cost of the '
    'verification pipeline. An Ed25519-unified benchmark further shows that mdoc’s verification '
    'advantage depends partly on its ECDSA P-256/COSE configuration. On security, the JSON-LD/RDFC '
    'pipeline carries additional attack surface arising from remote context resolution and '
    'canonicalization (DoS, context injection, and SSRF), whereas SD-JWT VC and mdoc proved resilient '
    'under standard verification settings for the attack vectors evaluated. The measurement kit is '
    'released as open source so that the evaluation can be reproduced.'
)


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def para_text(p):
    return re.sub(r'<[^>]+>', '', p)


def set_para_text(p, text):
    """段落の全 <w:t> のうち先頭に text を入れ、残りを空にする（書式は保持）"""
    done = [False]

    def repl(m):
        if not done[0]:
            done[0] = True
            return '<w:t xml:space="preserve">%s</w:t>' % esc(text)
        return '<w:t xml:space="preserve"></w:t>'
    return re.sub(r'<w:t(?:\s[^>]*)?>.*?</w:t>', repl, p, flags=re.S)


def transform(p, i, ref_start, stats):
    """段落1つを変換して返す（None を返すと段落を削除）"""
    if i == 15:                       # 概要
        return set_para_text(p, ABSTRACT_JA)
    if i == 20:                       # Abstract
        return set_para_text(p, ABSTRACT_EN)

    if i > ref_start:                 # 参考文献リスト
        k = i - ref_start - 1
        if k < len(REFS):
            return set_para_text(p, REFS[k])
        return None                   # 余った段落（未引用文献）は削除

    if 'Courier New' in p:            # コードリストは触らない
        return p

    q = p
    # 1) 本文の事実誤り修正
    for old, new in BODY_FIXES:
        if old in para_text(q):
            def fix(m, old=old, new=new):
                return '<w:t xml:space="preserve">%s</w:t>' % \
                    m.group(1).replace(esc(old), esc(new))
            before = q
            q = re.sub(r'<w:t(?:\s[^>]*)?>(.*?)</w:t>', fix, q, flags=re.S)
            if q != before:
                stats['body_fix'] += 1

    # 2) 引用番号の採番し直し（衝突回避のため2段階）
    def renum(m):
        t = m.group(1)
        t2 = re.sub(r'\[(\d{1,2})\]',
                    lambda mm: '[#%d#]' % RENUM[int(mm.group(1))]
                    if int(mm.group(1)) in RENUM else mm.group(0), t)
        t2 = t2.replace('[#', '[').replace('#]', ']')
        if t2 != t:
            stats['renum'] += 1
        return '<w:t xml:space="preserve">%s</w:t>' % t2
    return re.sub(r'<w:t(?:\s[^>]*)?>(.*?)</w:t>', renum, q, flags=re.S)


def main():
    zin = zipfile.ZipFile(SRC)
    xml = zin.read('word/document.xml').decode('utf-8')

    paras = re.findall(r'<w:p[ >].*?</w:p>', xml, re.S)
    ref_start = next(i for i, p in enumerate(paras) if para_text(p).strip() == '参考文献')
    n_old_refs = len(paras) - ref_start - 1

    stats = {'body_fix': 0, 'renum': 0, 'idx': 0}

    def sub_para(m):
        i = stats['idx']
        stats['idx'] += 1
        out = transform(m.group(0), i, ref_start, stats)
        return '' if out is None else out

    out = re.sub(r'<w:p[ >].*?</w:p>', sub_para, xml, flags=re.S)
    assert stats['idx'] == len(paras), 'paragraph count mismatch'

    zout = zipfile.ZipFile(DST, 'w', zipfile.ZIP_DEFLATED)
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == 'word/document.xml':
            data = out.encode('utf-8')
        zout.writestr(item, data)
    zout.close()
    print(f"本文修正: {stats['body_fix']}箇所 / 引用番号更新: {stats['renum']}箇所 / "
          f"参考文献: {len(paras) - ref_start - 1}件 → {len(REFS)}件")
    print('wrote', DST)


if __name__ == '__main__':
    main()
