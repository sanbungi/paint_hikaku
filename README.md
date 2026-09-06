# paint_hikaku

ペンタブ（またはマウス）でお手本を模写し、重ね合わせと診断で「どこがどう違うか」を学ぶトレーニングアプリです。  
上手さの点数付けではなく、位置・大きさ・傾き・抜け・はみ出し・線の揺れといった **系統的なクセ** を返します。

D 言語。操作は **dlangui** の標準ウィジェット（ボタン・リスト・ファイルダイアログ・チェックボックス）。キャンバス画素の表示は dlangui の SDL2 バックエンド経由です。

対象: **Windows 11 x64 / Ubuntu 22.04・24.04 amd64**。両OSでSDL2＋FreeTypeを使用します。macOS・ARM64は対象外です。

## 配布版

GitHub ReleasesのWindows ZIPは展開して `paint_hikaku.exe` を起動します。同梱DLL・`fonts`・`licenses`はexeと一緒に保持してください。

UbuntuではAppImageに実行権限を付けて起動します。日本語フォントとアプリ依存ライブラリは同梱しています。画面環境・OpenGLドライバーはOSのものを使います。

```bash
chmod +x paint_hikaku-*.AppImage
./paint_hikaku-v1.0.0-x86_64.AppImage
# FUSEを利用できない場合
./paint_hikaku-v1.0.0-x86_64.AppImage --appimage-extract-and-run
```

ファイル名のバージョンはダウンロードしたものに読み替えてください。配布物のSHA-256はReleaseの `SHA256SUMS` に記載します。

## できること

- なめらかなストローク（Catmull-Rom 補間 + 筆圧で幅）
- 組み込み図形: 直線・円・楕円・矩形・正三角形・正五角形・十字・S 曲線
- 線練習: 2点を結ぶ・斜め3本・円3つ
- 立体: 立方体・直方体・円柱・六角柱・四角錐・円錐・球
- パース: 1点／2点／3点透視・アイソメ、水平角・上下角・距離・地平線、補助線と隠れ線（ガイドは採点対象外）
- 画像をお手本にできる（カラーのまま表示。採点は暗い線をマスク化。PNG / JPEG）
- 答え合わせ: 重ね（青=お手本 / 赤=自分 / 緑=一致）・差分・距離ヒートマップ
- 診断コメント（日本語）と参考スコア（IoU、Chamfer 距離）
- 位置合わせなし（デフォルト）または重心合わせ
- 見本と紙で同期するグリッド（2 / 3×3 / 4×4）と外接箱
- 上下または左右の配置
- 記憶模写（見本を隠す）とチラ見
- セッションをローカル JSON に記録し、同じ題材のクセ傾向を表示

## ビルド

CIのコンパイラはDMD 2.112.0に固定しています。依存: [Dub](https://dub.pm/)、SDL2、FreeType、LinuxではFontconfig・OpenGL。

```bash
# Debian/Ubuntu の例
sudo apt install libsdl2-dev libsdl2-image-dev libfreetype6-dev libfontconfig1-dev libgl1-mesa-dev fonts-noto-cjk
dub build --config=application
./paint_hikaku
# 自分の線画を開く
./paint_hikaku path/to/lineart.png
```

WindowsではDMD 2.112.0の開発用ターミナルで次を実行します。DubのSDL構成がDLLをコピーします。

```powershell
dub build --config=application --arch=x86_64
.\paint_hikaku.exe
# 配布用の固定版SDL2・日本語フォントを含むZIP（Python 3が必要）
python scripts/package.py windows --version local
```

単体・連続操作テスト（ウィンドウ不要）:

```bash
dub test --config=unittest
```

GUIテストと回帰防止の運用は [tests/README.md](tests/README.md) を参照してください。

## 操作

ウィンドウ左側でお手本を選び、中央キャンバスで模写します。上のツールバーは普通のボタンです。

| 操作 | 方法 |
|------|------|
| お手本 | 左リストをクリック（図形／サンプル画像） |
| 画像 | 「画像を開く…」（カラー表示。ファイルダイアログ） |
| 描画 | キャンバスをドラッグ（ペンタブはマウス相当） |
| アンドゥ / クリア / 答え合わせ / もう一度 / 記録 | 見本と紙の間のボタン |
| 答え合わせ | 右ペインに重ね表示と診断 |
| 重ね／差分／ヒート | 右のコンボボックス |
| 重心合わせ | チェックボックス（形だけ見たいとき） |
| 記録 | 「記録」。左下の履歴と、同じ題材の傾向 |
| 配置 | ツールバー「上下 / 左右」（既定は左右。ウィンドウは自由にリサイズ） |
| 設定・診断欄 | 「題材・設定」「診断」で開閉。狭い画面では初期状態で非表示。内容はスクロール可能 |
| グリッド | なし / 2分割 / 3×3 / 4×4（採点対象外） |
| 外接箱 | お手本の外枠をガイド表示 |
| 記憶模写 | 見本を隠す。チラ見で約2秒だけ表示 |
| 筆圧 | ペンの圧力。マウスは Shift=細、Ctrl=太 |

記録先:

- Linux: `~/.local/share/paint_hikaku/sessions/`
- Windows: `%APPDATA%\paint_hikaku\sessions\`

`PAINT_HIKAKU_DATA_DIR` を設定すると保存先を変更できます。テストでは必ず一時ディレクトリを使用します。旧JSON形式は引き続き読み込めます。

## CI / Release

- 通常push・PR: ソース、アセット、Dub定義、テスト、スクリプト、配布設定、workflowが変わった場合に、Windows/Linuxの回帰テストとAppImage作成・Ubuntu 24.04互換性確認を実行します。READMEのみの変更では実行しません。
- `vMAJOR.MINOR.PATCH` タグ: 変更の有無にかかわらず全検証を実行し、Windows ZIP・AppImage・SHA-256一覧をReleaseへ公開します。失敗した場合は公開しません。
- 通常ビルドはコミットSHA、Releaseビルドはタグをファイル名に使用します。
- ブランチ保護を設定する場合のチェック名: `Regression (ubuntu-22.04)`、`Regression (windows-2022)`、`Ubuntu 24.04 compatibility`。パス除外でworkflowが起動しないPRには必須チェックが付かないため、文書のみのPRの扱いをリポジトリ側の運用で決めてください。
- AppImageはUbuntu 22.04でビルドしてください。新しいLinuxで作ったものは22.04互換になりません。

## 設計の要点

- 比較はベクトル一致ではなく **同じ論理解像度（768²）のラスタマスク**。なぞり訓練で厳しすぎないようにしている。
- デフォルトは位置合わせなし。ズレ自体が学習対象。重心合わせは「形は近いが場所が違う」を切り分けるときだけ使う。
- 写真お手本はカラー表示。採点は輝度の暗い部分を線とみなす。

フォントアトラスとサンプル画像を作り直す場合:

```bash
python3 scripts/gen_assets.py
```
