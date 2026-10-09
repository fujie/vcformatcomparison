# -*- coding: utf-8 -*-
"""split_paper.py 用: 分割後の2論文それぞれの要旨と、書き換える段落の定義。

patch(picked, txt, set_text) は抽出済みブロック列を受け取り、
先頭一致した段落を差し替える（new が None のブロックは削除）。
引用番号は元の番号のまま記述する（採番は split_paper.py が行う）。
"""

# ══════════════════════════════════════════════════════════════════
# 論文A: 性能検証
# ══════════════════════════════════════════════════════════════════
PERF_JA = (
    '本稿では、検証可能なデジタルクレデンシャル（Verifiable Credential: VC）の主要3フォーマット'
    '——SD-JWT VC、JSON-LD VC（W3C VCDM 2.0）、mdoc（ISO/IEC 18013-5）——の署名検証性能と'
    '実装複雑性を実証的に比較評価した。SMT無効化・CPUコア固定を施した専用Linuxサーバ上で、'
    'Node.js・Go・Pythonの3言語をナノ秒精度・同一手法（N=2,000×独立5回、統計量は中央値）で'
    '計測した結果、署名はSD-JWT VCが最速（p50: 0.038 ms/op）、検証はmdocが最速（0.090 ms/op）'
    'であり、JSON-LD VCはSD-JWT VCの約1.5倍のレイテンシを示した。この差の主因はURDNA2015正規化'
    'であり、ライブラリを介さない実装ではJSON-LD VCの性能はSD-JWT VCとほぼ同等となる。'
    'さらに、実運用の教育スキーマ（1EdTech OpenBadges v3.0、DCC型学位クレデンシャル）では'
    '正規化コストが単純なクレデンシャルの22〜41倍に達し、検証パイプラインの支配的コストとなる。'
    'Ed25519統一ベンチマークにより署名アルゴリズムの差と検証パイプラインの差を分離した結果、'
    'mdocの検証の高速性がECDSA P-256/COSE構成に部分的に依存することも示した。実装複雑性の分析'
    'では、JSON-LD VCが循環的複雑度8・外部ネットワーク依存ありと最も複雑であった。計測ツールは'
    'オープンソースとして公開しており、再現可能な評価フレームワークとしてフォーマット選定に'
    '資することを目的とする。なお、検証パイプラインのセキュリティ評価は別稿で扱う。'
)

PERF_EN = (
    'This paper empirically compares the signature/verification performance and implementation '
    'complexity of three major Verifiable Credential (VC) formats — SD-JWT VC, JSON-LD VC '
    '(W3C VCDM 2.0), and mdoc (ISO/IEC 18013-5). Node.js, Go, and Python engines were measured on a '
    'dedicated Linux server (SMT disabled, pinned core) with nanosecond-precision timers under an '
    'identical methodology (N=2,000 iterations across five independent runs; medians of each '
    'statistic). SD-JWT VC signs fastest (p50: 0.038 ms/op) and mdoc verifies fastest (0.090 ms/op), '
    'while JSON-LD VC exhibits about 1.5x the verification latency of SD-JWT VC. URDNA2015 '
    'canonicalization accounts for most of that gap: without the JSON-LD library, JSON-LD VC performs '
    'on par with SD-JWT VC. With production education schemas (1EdTech Open Badges v3.0 and a '
    'DCC-style academic credential), canonicalization costs 22-41x that of a simple credential and '
    'becomes the dominant cost of the verification pipeline. An Ed25519-unified benchmark separates '
    'algorithm effects from pipeline effects and shows that mdoc’s verification advantage depends '
    'partly on its ECDSA P-256/COSE configuration. Complexity analysis identifies JSON-LD VC as the '
    'most complex implementation (cyclomatic complexity 8, with external network dependencies). '
    'The measurement kit is released as open source so that the evaluation can be reproduced. '
    'A security evaluation of the verification pipelines is presented in a companion paper.'
)

PERF_PATCH = [
    # 1. はじめに — 評価軸を性能・複雑性の2軸に
    ('しかしながら、これら3フォーマットを同一条件下で',
     'しかしながら、これら3フォーマットを同一条件下で実証的に比較した研究は限られている。また、'
     'EU規則2024/1183（eIDAS 2.0）[6] においてSD-JWT VCおよびmdocがEuropean Digital Identity '
     'Wallet（EUDIW）の必須フォーマットとして規定されたことで、フォーマット間の定量的な比較の'
     '実用的重要性が増している。本稿では、オープンソースで公開したベンチマークツールを用いて、'
     '以下の2つの評価軸で再現可能な比較評価を行う。第一に、署名生成・検証のスループットと'
     'レイテンシを計測する署名検証速度ベンチマークであり、属性数スケーリング・選択的開示・'
     '実運用スキーマにおける正規化コストを含む。第二に、コード行数・循環的複雑度・非同期ステップ数'
     '等を計測するデシリアライズ複雑性分析である。検証パイプラインに由来するセキュリティ上の'
     '攻撃面（DoS・コンテキストインジェクション・SSRF等）については、同一の実験基盤を用いた'
     '別稿で扱う。'),
    # 2. 関連研究 — 冒頭の位置づけ
    ('VCフォーマットの比較に関する先行研究は複数存在するが、',
     'VCフォーマットの比較に関する先行研究は複数存在するが、署名検証性能と実装複雑性を同一環境で'
     '定量的に評価し、かつ複数の言語処理系にわたって再現性を確認した研究は限られている。'
     '本節では、本稿の研究と関連する主要な先行研究を概観し、本稿の位置づけを明確にする。'),
    # 2. 関連研究 — RDFC の位置づけを正規化コストの観点に
    ('RDFデータセット正規化のセキュリティについては、',
     'RDFデータセット正規化については、W3C RDFC-1.0仕様 [10] においてURDNA2015の最悪計算量が'
     '文書化されており、ブランクノードを含むグラフでは正準ラベル付けのコストが入力規模に対して'
     '超線形に増大し得ることが知られている。本稿では、この仕様上の特性が実装レベルの'
     '検証レイテンシにどの程度現れるかを、属性数スケーリングおよび実運用スキーマを用いて'
     '定量的に評価する。'),
    # 2. 関連研究 — 貢献
    ('以上の先行研究に対し、本稿の貢献は',
     '以上の先行研究に対し、本稿の貢献は以下の3点にある。第一に、SD-JWT VC・JSON-LD VC・mdocの'
     '3フォーマットを、SMT無効化・コア固定を施した専用サーバ上でNode.js・Go・Pythonの3言語に'
     'わたり同一手法で計測し、フォーマット間の相対順位が言語処理系に依存するか否かを実証した点。'
     '第二に、単純なクレデンシャルに加えて属性数スケーリングと実運用の教育スキーマを対象とし、'
     'URDNA2015正規化コストが検証パイプラインの支配的コストとなる条件を定量的に示した点。'
     '第三に、統計処理（外れ値の扱い・代表値・独立実行の反復）を全言語で統一した再現可能な'
     '計測フレームワークをオープンソースとして公開した点である。本稿はVCフォーマットの最終的な'
     '優劣判定を目的とするものではなく、実装者・標準化関係者がフォーマット選定時に参照できる'
     '定量的データの提供を主たる目的とする。'),
    # 7. 制約 — セキュリティ固有の項目を削除
    ('第二に、ポイズングラフの規模20ノードでの計測は', None),
    ('第三に、SSRFテストではリモートURLの存在を静的に分析しており', None),
    ('第四に、言語別比較（図1〜3）は同一サーバで実施したが',
     '第二に、言語別比較（図1〜3）は同一サーバで実施したが、各言語のランタイム特性（Go: '
     'ネイティブバイナリ、Python: CPythonインタプリタ、TypeScript: V8 JIT）と暗号ライブラリ実装'
     '（OpenSSL系 vs Go標準ライブラリ等）が異なるため、言語間の絶対的な性能差の解釈には注意が'
     '必要である。本実験ではフォーマット間の相対的な性能順位と傾向の確認を主目的としている。'),
    ('第五に、複雑クレデンシャル評価（5.11節）は',
     '第三に、複雑クレデンシャル評価（5.11節）はOpenBadges v3.0系の2スキーマと合成クレデンシャルに'
     '限定しており、mDL名前空間の多要素mdocやEUDIW（eIDAS 2.0）のPID/EAAスキーマなど、'
     '他の実運用スキーマへの拡張が今後の課題である。'),
    ('本稿では属性数スケーリング（5.6節）、',
     '本稿では属性数スケーリング（5.6節）、選択的開示（5.7節）、Ed25519統一ベンチマーク（5.10節）、'
     '複雑クレデンシャルの正規化評価（5.11節）を追加的に評価した。今後の課題として、物理'
     'ベアメタルサーバでの追試、ブラウザ/WebCrypto環境での計測、メモリ使用量の計測、および'
     '追加の言語・ランタイム環境（Rust、Java等）への拡張が挙げられる。'),
    # 8. Threats — セキュリティ評価の妥当性を削除
    ('セキュリティ評価の妥当性：', None),
    # 9. 結論
    ('本稿は、SD-JWT VC・JSON-LD VC・mdocの3フォーマットについて、',
     '本稿は、SD-JWT VC・JSON-LD VC・mdocの3フォーマットについて、署名検証性能と実装複雑性の'
     '2軸で再現可能な比較評価を実施し、実装者・標準化関係者がフォーマット選定時に参照できる'
     '定量的データを提供した。'),
    ('セキュリティの観点では、JSON-LD/RDFC系の検証パイプラインは', None),
    ('フォーマット選定においては、対象ユースケースの要件',
     'フォーマット選定においては、対象ユースケースの要件（相互運用性・パフォーマンス・規制準拠）を'
     '総合的に評価し、トレードオフを明示的に受容した上で判断することが重要である。本稿では'
     '扱わなかった検証パイプラインのセキュリティ特性（正規化に由来するDoS、コンテキスト'
     'インジェクション、SSRF等）は、同一の実験基盤を用いた別稿で報告する。本稿の評価'
     'フレームワークとベンチマークツールはオープンソースとして公開しており [16]、異なる環境・'
     '条件での再現実験に資することを期待する。'),
]

# ══════════════════════════════════════════════════════════════════
# 論文B: セキュリティ分析
# ══════════════════════════════════════════════════════════════════
SEC_JA = (
    '本稿では、検証可能なデジタルクレデンシャル（Verifiable Credential: VC）の主要3フォーマット'
    '——SD-JWT VC、JSON-LD VC（W3C VCDM 2.0）、mdoc（ISO/IEC 18013-5）——の検証パイプラインが'
    '持つ攻撃面を、明示的な脅威モデルの下で実装レベルで評価した。JSON-LD VCの検証パイプラインでは、'
    'リモートコンテキスト解決とURDNA2015正規化に由来する3つの構造的な攻撃面——ポイズングラフに'
    'よるDoS、@contextを介したコンテキストインジェクション、悪意あるコンテキストURLによるSSRF'
    '——が、緩和策を欠くデフォルト設定において顕在化し得ることを確認した。とりわけDoSについては、'
    '敵対的な入力を用いずとも、実運用の教育スキーマ（1EdTech OpenBadges v3.0、DCC型学位'
    'クレデンシャル）の正規化コストが単純なクレデンシャルの22〜41倍に達し、属性数に対しても'
    '超線形に増大することを実測により示した。緩和策としては、静的document loaderによる'
    'ネットワーク取得の排除（リモート解決比で約859倍のレイテンシ差を解消）、context allowlist、'
    'およびURDNA2015のcall limit設定が有効である。一方、SD-JWT VCおよびmdocは正規化と外部参照を'
    '必要とせず、alg:none攻撃・アルゴリズム混同・データ要素改ざん・COSEヘッダー改ざんを含む'
    '評価した攻撃ベクトルに対し、標準的な検証設定で耐性を示した。これらはフォーマット固有の欠陥では'
    'なく、検証パイプラインと運用設定に依存する攻撃面であり、実装者が採るべき具体的な緩和策を示す。'
)

SEC_EN = (
    'This paper evaluates, at the implementation level and under an explicit threat model, the attack '
    'surface of the verification pipelines of three major Verifiable Credential (VC) formats: '
    'SD-JWT VC, JSON-LD VC (W3C VCDM 2.0), and mdoc (ISO/IEC 18013-5). For JSON-LD VC we confirm three '
    'structural attack surfaces arising from remote context resolution and URDNA2015 canonicalization '
    '— denial of service via poison graphs, context injection through @context, and SSRF via malicious '
    'context URLs — all of which can materialize under default settings that lack mitigations. '
    'For denial of service in particular, we show empirically that adversarial input is not even '
    'required: with production education schemas (1EdTech Open Badges v3.0 and a DCC-style academic '
    'credential), canonicalization costs 22-41x that of a simple credential and grows superlinearly '
    'with the number of attributes. Effective mitigations include a static document loader that '
    'eliminates network retrieval (removing a roughly 859x latency gap relative to remote resolution), '
    'context allowlists, and a call limit for URDNA2015. In contrast, SD-JWT VC and mdoc require '
    'neither canonicalization nor external references and proved resilient under standard verification '
    'settings against the evaluated attack vectors, including alg:none, algorithm confusion, data '
    'element tampering, and COSE header tampering. These are not format-specific defects but attack '
    'surfaces that depend on the verification pipeline and its operational configuration.'
)

SEC_PATCH = [
    # 1. はじめに — セキュリティの問題設定に
    ('しかしながら、これら3フォーマットを同一条件下で',
     'しかしながら、これら3フォーマットの検証パイプラインが持つセキュリティ特性を、明示的な'
     '脅威モデルの下で実装レベルで比較した研究は限られている。特にJSON-LD VCは、署名・検証に'
     'RDF正規化と外部コンテキストの解決を必要とするため、他の2フォーマットには存在しない'
     '処理段階が攻撃面となり得る。W3C RDFC-1.0仕様 [10] はURDNA2015の最悪計算量とDoSの懸念を'
     '文書化しているが、それが実装においてどの程度顕在化し、どの緩和策がどれだけ有効かは'
     '定量的に示されてこなかった。また、EU規則2024/1183（eIDAS 2.0）[6] においてSD-JWT VCおよび'
     'mdocがEuropean Digital Identity Wallet（EUDIW）の必須フォーマットとして規定されたことで、'
     'フォーマット間のセキュリティ特性の比較は実務上の重要性を増している。本稿では、明示的な'
     '脅威モデルに基づき、DoS・コンテキストインジェクション・SSRF・アルゴリズム混同・データ改ざん'
     'といった攻撃ベクトルに対する各フォーマットの耐性を実装レベルで評価し、有効な緩和策を'
     '定量的に示す。なお、フォーマット間の署名検証性能そのものの比較は別稿で扱う。'),
    # 1. はじめに — 交絡因子の注記は性能論文の論点なので削除
    ('なお、本稿の性能比較では各フォーマットのエコシステムで標準的に使用される署名アルゴリズム', None),
    # 2. 関連研究
    ('VCフォーマットの比較に関する先行研究は複数存在するが、',
     'VCフォーマットに関する先行研究は複数存在するが、検証パイプラインに由来する攻撃面を'
     '明示的な脅威モデルの下で実装レベルに落として評価した研究は限られている。本節では、'
     '本稿の研究と関連する主要な先行研究を概観し、本稿の位置づけを明確にする。'),
    # 2. 関連研究 — Brunner et al. をセキュリティ観点で位置づけ直す
    ('Brunner et al. [8] はDID（Decentralized Identifiers）とVCの技術的ランドスケープを',
     'Brunner et al. [8] はDID（Decentralized Identifiers）とVCの技術的ランドスケープを包括的に'
     '調査し、発行者・保持者・検証者それぞれのワークフローを標準に沿って整理した上で、DIDとVCが'
     '抱える課題を信頼・プライバシー・失効・ユーザビリティの4つの観点から議論している。信頼の'
     '観点では、DIDの所持を暗号学的に証明できても実世界のアイデンティティとの結び付けは標準の'
     '範囲外であり、公開発行者によるWeb of Trustの構築、または認証局（CA）とのハイブリッド構成が'
     '必要になると指摘する。失効と鍵管理についても、失効時刻を証明する仕組みが標準に欠けている'
     'ことや、秘密鍵を紛失した場合に回復手段が存在しないことをリスクとして挙げている。すなわち'
     '同研究のセキュリティ上の議論は、DID/VCエコシステム全体の信頼モデルと運用に関わる概念'
     'レベルの分析であり、クレデンシャルフォーマット固有の検証処理——RDF正規化や外部コンテキスト'
     '解決といった処理段階に起因する攻撃面——は対象としていない。本稿は、同研究が整理した検証'
     'ワークフローのうち署名検証の内部に踏み込み、フォーマットごとの攻撃面を明示的な脅威モデルの'
     '下で実装レベルに落として評価する点で、同研究と相補的な位置づけにある。'),
    # 2. 関連研究 — Wu と Tian をセキュリティ観点で位置づけ直す
    ('選択的開示メカニズムの比較については、Wu と Tian',
     '選択的開示メカニズムの比較については、Wu と Tian [8] がBBS+署名とSD-JWTの体系的文献レビュー'
     '（SLR）を実施し、Kitchenhamの手順に従って2017年から2025年にかけてIEEE、ACM、SpringerLink、'
     'ScienceDirect、IETF、W3Cの各リポジトリから226件を選別し、実測データを伴う31の一次研究を'
     '分析した。同研究は性能に加えてセキュリティ・プライバシー保証を明示的な評価軸としており、'
     'BBS+が強い非連結性（unlinkability）・述語証明・ゼロ知識開示を提供するのに対し、SD-JWTは'
     '既存のJOSE/OAuth基盤との統合が容易である一方、ソルト付きダイジェストが提示をまたいで'
     '不変であることに起因する名寄せ（correlation）リスクを抱えると整理している。性能面では、'
     'BBS+の導出証明が約140バイトの固定サイズで検証に約12 msを要する一方、SD-JWTは開示クレーム数に'
     '応じて提示サイズが増大するものの2クレーム開示時の検証は10 ms未満であることを報告し、'
     'プライバシー要求の高い用途にはBBS+を、高スループットが要求されるWebアプリケーションには'
     'SD-JWTを推奨している。ただし、同研究のセキュリティ分析は選択的開示プリミティブが暗号方式'
     'として達成する保証（非連結性・最小開示・述語証明）の比較に閉じており、また文献の統合という'
     '方法論の性質上、検証実装そのものを攻撃入力に晒す実証は行っていない。本稿は、フォーマットの'
     '検証パイプライン（RDF正規化・外部コンテキスト解決）の実装に起因する攻撃面を実験により'
     '評価するものであり、対象とする層が異なる。'),
    # 2. 関連研究 — Buldini et al. のセキュリティ分析を明示
    ('Buldini et al.',
     'Buldini et al. [9] は暗号学的アキュムレータを用いた新たなコンパクト選択的開示方式'
     '（CSD-JWT）を提案し、SD-JWTと比較してメモリ使用量を最大46%、Verifiable Presentation'
     'サイズを最大93%削減することを示した。同研究はDolev-Yao攻撃者モデルに基づく明示的な'
     '脅威モデルを置き、攻撃者の目的をVC内の個人情報の暴露と保持者へのなりすましと定義した'
     '上で、リプレイ攻撃・データ過剰収集・通信路の侵害という3つの脅威に対する耐性を、'
     'リプレイ耐性とデータ最小化の形式的定義とともに論じている点で、セキュリティ分析を含む'
     '先行研究である。とくにSD-JWTに対しては、開示されなかったクレームの個数や位置といった'
     '構造的メタデータが検証時に露見し、サイドチャネル的な推論攻撃を許し得ると指摘し、'
     '全クレームを固定長のアキュムレータ値へ集約することでこれを回避している。ただし、'
     '同研究が分析対象とするのは提示プロトコル層の暗号学的性質であり、評価はSD-JWTと'
     'CSD-JWTの比較に限定される。JSON-LD VCやmdocは対象外であり、正規化や外部コンテキスト'
     '解決といった検証処理の実装に起因する攻撃面も扱っていない。本稿は、この実装層の攻撃面を'
     '3フォーマット横断で評価する点で、同研究を補完する。'),
    ('以上の先行研究に対し、本稿の貢献は',
     '以上の先行研究に対し、本稿の貢献は以下の3点にある。第一に、JSON-LD/RDFC検証パイプラインの'
     'セキュリティリスクを、仕様上の理論的指摘にとどめず、明示的な脅威モデルの下で実装レベルの'
     '実証に落とし込んだ点。第二に、DoSの成立条件を敵対的入力に限定せず、実運用スキーマの'
     '正規化コスト（単純なクレデンシャル比22〜41倍）と属性数に対する超線形の増大として定量化し、'
     '正常系の入力でも検証コストが支配的になり得ることを示した点。第三に、静的document loader・'
     'context allowlist・call limitという緩和策の効果を実測し、実装者が採るべき設定を具体的に'
     '示した点である。本稿はVCフォーマットの優劣判定を目的とするものではなく、検証パイプラインと'
     '運用設定に依存する攻撃面を明らかにすることを主たる目的とする。'),
    # 4.2 テストツール — セキュリティテストの実施環境を明示
    ('本実験では、自作のベンチマークツール（VC Comparison Tool）を使用した。',
     '本実験では、自作のツール群を使用した。セキュリティテスト（4.3.2）はVC Comparison Toolの'
     'TypeScript実装により実施し、攻撃入力の生成・投入と検証側の挙動（例外・拒否・処理時間）を'
     '記録した。正規化コストの計測（5.4節・5.5節）は、同ツールから計測エンジンを切り出した'
     'スタンドアロンのCLIキット（linux-bench。Node.js / Go / Python の3エンジンと共通集計'
     'スクリプトで構成）により、GUIやWebサーバを介さずに実施した。各エンジンはナノ秒精度の'
     'タイムスタンプで生タイミングのみを記録し、統計計算は共通スクリプトで一元的に行う。'
     'ソースコードはGitHubリポジトリにて公開しており [16]、再現実験が可能である。各フォーマットの'
     '署名・検証処理は、以下のライブラリを用いて実装している。'),
    # 5.4（旧5.6）属性数スケーリング — DoSの観点で導入
    ('属性数を5、20、100、500と変化させた場合のシリアライズ速度',
     '正規化コストが入力規模に対してどのように増大するかは、DoS耐性を見積もるうえでの基礎'
     'データとなる。属性数を5、20、100、500と変化させた場合のシリアライズ速度（暗号処理なし、'
     'JSON-LD VCはjsonldライブラリによるURDNA2015正規化を含む）の変化を表11および図4に示す。'
     'process.hrtime.bigint()によりN=2,000（JSON-LD VCの100属性以上はN=400）×5回実行で計測した。'),
    # 5.5（旧5.11）複雑クレデンシャル — 正常系入力でのDoS的コストとして
    ('主要ベンチマークで使用した単純なクレデンシャル（5クワッド、実質的なブランクノードなし）に対し、',
     '前節の結果は属性数という単一の軸に沿った増大を示すものであるが、実運用のクレデンシャルは'
     'ブランクノードとネスト構造を含み、正規化コストはさらに大きくなる。すなわち、敵対的に'
     '構成された入力でなくとも検証コストが著しく増大し得る。単純なクレデンシャル（5クワッド、'
     '実質的なブランクノードなし）に対し、実運用スキーマを用いた複雑なクレデンシャルでの'
     'URDNA2015正規化コストを表16に示す。評価対象は、教育分野で広く使用される1EdTech '
     'OpenBadges v3.0（OB3）のAchievementCredential（criteria・alignment・result等のidを持たない'
     'ノードを含む）、DCC（Digital Credentials Consortium）が発行する学位クレデンシャルを模した'
     'OB3プロファイルのサンプル、およびブランクノード数の影響を分離するための合成クレデンシャル'
     '（idなし子ノード10個・50個）である。いずれもJSON-LDコンテキストは静的埋め込みであり、'
     'ネットワークI/Oは計測に含まれない。'),
    # 7. 制約
    ('第四に、言語別比較（図1〜3）は同一サーバで実施したが', None),
    ('第五に、複雑クレデンシャル評価（5.11節）は',
     '第四に、複雑クレデンシャル評価（5.11節）はOpenBadges v3.0系の2スキーマと合成クレデンシャルに'
     '限定しており、mDL名前空間の多要素mdocやEUDIW（eIDAS 2.0）のPID/EAAスキーマなど、'
     '他の実運用スキーマへの拡張が今後の課題である。'),
    ('本稿では属性数スケーリング（5.6節）、',
     '今後の課題として、より大規模なブランクノードを含むポイズングラフ（20ノード以上）での'
     'DoS耐性の定量化、実ネットワーク環境でのSSRF挙動の確認、緩和策を適用した本番相当設定での'
     'リスク低減効果の定量評価、およびBBS+等の他の署名スイートを含む攻撃面の分析が挙げられる。'),
    # 8. Threats — 性能論文固有の段落を削除
    ('構成妥当性（Construct Validity）：各フォーマットのベンチマークでは、', None),
    ('外的妥当性（External Validity）：主要な署名検証ベンチマーク',
     '外的妥当性（External Validity）：正規化コストの評価に用いたスキーマは教育系のOpenBadges '
     'v3.0プロファイルを中心としており、他分野の実運用スキーマ（mDL名前空間の多要素mdoc、'
     'EUDIWのPID/EAA等）への一般化には追試を要する。また、計測はx86_64（AMD EPYC）サーバ上の'
     'Node.js実装で実施しており、他の言語処理系・ブラウザ/WebCrypto環境・モバイル端末では'
     '絶対値が異なる可能性がある。攻撃面の構造（正規化と外部参照の有無）自体は仕様に由来する'
     'ため実装によらないが、その顕在化の程度は実装とライブラリ設定に依存する。'),
    ('実装複雑性の妥当性：LOC（コード行数）は', None),
    # 5.5 本文 — 削除した表4（署名検証性能）への参照を言い換え
    ('OB3クレデンシャルの正規化はp50で1.992 msと、',
     'OB3クレデンシャルの正規化はp50で1.992 msと、単純なクレデンシャル（0.049 ms）の約41倍に'
     '達した。これは同一環境における署名検証処理全体（p50で0.090〜0.178 ms）の10倍以上であり、'
     '実運用スキーマではURDNA2015正規化が検証パイプラインの支配的コストとなることを示す。'
     'DCC型クレデンシャルでも約22倍（p50: 1.089 ms）であった。増大の要因は2つある。第一に、'
     'OB3の大規模なJSON-LDコンテキスト（数百の用語定義）の展開処理であり、クワッド数（32）や'
     'ブランクノード数（4）に比して処理時間が大きいのはこのためである。第二に、ブランクノードの'
     '正準ラベル付けであり、合成クレデンシャルの比較（10ノード: 0.188 ms、50ノード: 0.751 ms）'
     'から、ブランクノード数に対して超線形にコストが増大することが確認できる。また、OB3・DCC型では'
     '平均とp50の乖離およびσが大きく（OB3: 平均2.449 msに対しσ2.853）、複雑なコンテキスト処理は'
     'レイテンシの裾も長い。'),
    # 付録A — セキュリティテストのみを収録する旨に
    ('本付録では、各フォーマットの署名生成・検証処理について、実際の計測に使用した実装コードを示す。',
     '本付録では、4.3.2で述べたセキュリティテストの実装コードを示す。いずれもVC Comparison Toolの'
     'TypeScript実装からの抜粋であり、攻撃入力の生成と検証側の挙動の判定を行う。'),
    # 9. 結論
    ('本稿は、SD-JWT VC・JSON-LD VC・mdocの3フォーマットについて、',
     '本稿は、SD-JWT VC・JSON-LD VC・mdocの3フォーマットについて、検証パイプラインが持つ攻撃面を'
     '明示的な脅威モデルの下で実装レベルに落として評価し、実装者が採るべき緩和策を定量的に示した。'),
    ('署名検証性能においては、SMT無効化・コア固定を施した専用Linuxサーバでの',
     'JSON-LD/RDFC系の検証パイプラインでは、リモートコンテキスト解決とURDNA2015正規化に由来する'
     '3つの構造的な攻撃面（ポイズングラフDoS・コンテキストインジェクション・SSRF）が、緩和策を'
     '欠くデフォルト設定において顕在化し得ることを確認した。DoSについては、敵対的入力を用いずとも'
     '実運用スキーマの正規化コストが単純なクレデンシャル比22〜41倍に達し、属性数に対しても'
     '超線形に増大することを実測で示した。緩和策としては、静的document loaderによるネットワーク'
     '取得の排除、context allowlist、URDNA2015のcall limit設定が有効である。'),
    ('セキュリティの観点では、JSON-LD/RDFC系の検証パイプラインは',
     '一方、SD-JWT VCおよびmdocは正規化と外部参照を必要とせず、alg:none攻撃・アルゴリズム混同・'
     'データ要素改ざん・COSEプロテクトヘッダー改ざんを含む評価した攻撃ベクトルに対し、標準的な'
     '検証設定で耐性を示した。これらはフォーマット固有の欠陥ではなく、検証パイプラインと運用設定に'
     '依存する攻撃面である。'),
    ('フォーマット選定においては、対象ユースケースの要件',
     'フォーマット選定においては、セマンティック相互運用性の要件とセキュリティ・運用コストの'
     'トレードオフを明示的に受容した上で判断することが重要である。JSON-LD VCを採用する場合は、'
     '本稿で示した緩和策（静的document loader、context allowlist、call limit）を既定として'
     '実装することを推奨する。フォーマット間の署名検証性能そのものの比較は別稿で報告する。'
     '本稿の評価フレームワークとテストツールはオープンソースとして公開しており [16]、'
     '異なる環境・条件での再現実験に資することを期待する。'),
]


def _make_patch(pairs, ja, en):
    def patch(picked, txt, set_text):
        out = []
        used = set()
        for b in picked:
            t = txt(b).strip()
            hit = None
            for k, (pref, new) in enumerate(pairs):
                if t.startswith(pref):
                    hit = (k, new)
                    break
            if hit is None:
                out.append(b)
                continue
            used.add(hit[0])
            if hit[1] is None:      # 段落を削除
                continue
            out.append(set_text(b, hit[1]))
        missing = [pairs[i][0][:26] for i in range(len(pairs)) if i not in used]
        if missing:
            print('  [warn] パッチ未適用:', missing)
        return out
    return {'ja': ja, 'en': en, 'patch': patch}


PERF_ABSTRACT = _make_patch(PERF_PATCH, PERF_JA, PERF_EN)
SEC_ABSTRACT = _make_patch(SEC_PATCH, SEC_JA, SEC_EN)
