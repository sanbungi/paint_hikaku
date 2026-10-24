# paint_hikaku

ペンタブ（またはマウス）でお手本を模写し、重ね合わせと診断で「どこがどう違うか」を学ぶトレーニングアプリです。  
上手さの点数付けではなく、位置・大きさ・傾き・抜け・はみ出し・線の揺れといった **系統的なクセ** を返します。

<img width="5111" height="2853" alt="image" src="https://github.com/user-attachments/assets/2be3b980-2ea9-430c-917d-f684788e6ac0" />


Electron（Node.js + HTML/CSS）製のデスクトップアプリです。採点エンジン（ラスタ化・比較・診断・パース）は GUI 非依存の JavaScript モジュールで、Node.js 単体でテストできます。

対象: **Windows 10/11 x64**（主対象）、Ubuntu 22.04・24.04 amd64（AppImage）。

## ダウンロード

- **最新のビルド**: GitHub の [Actions](../../actions/workflows/ci.yml) で成功した実行を開き、Artifacts の `paint_hikaku-windows-exe` をダウンロードします（ZIP の中に exe が入っています）。
- **リリース版**: `v1.2.3` 形式のタグを push すると、検証済みの exe / AppImage と `SHA256SUMS` が GitHub Releases に公開されます。

| ファイル | 内容 |
|---|---|
| `paint_hikaku-<版>-windows-x64-portable.exe` | インストール不要。ダブルクリックで起動 |
| `paint_hikaku-<版>-windows-x64-setup.exe` | インストーラー（スタートメニュー登録・アンインストール対応） |
| `paint_hikaku-<版>-linux-x86_64.AppImage` | Ubuntu 用。`chmod +x` して起動 |

コード署名はしていないため、Windows の SmartScreen で「詳細情報 → 実行」が必要な場合があります。

## できること

- なめらかなストローク（Catmull-Rom 補間 + 筆圧で幅。ペンタブの筆圧は Pointer Events で直接取得）
- 組み込み図形: 直線・円・楕円・矩形・正三角形・正五角形・十字・S 曲線
- 線練習: 2点を結ぶ・斜め3本・円3つ
- 立体: 立方体・直方体・円柱・六角柱・四角錐・円錐・球
- パース: 1点／2点／3点透視・アイソメ、水平角・上下角・距離・地平線、補助線と隠れ線（ガイドは採点対象外）
- 画像をお手本にできる（カラーのまま表示。採点は暗い線をマスク化。PNG / JPEG / BMP / WebP / GIF。ウィンドウへのドラッグ＆ドロップにも対応）
- 答え合わせ: 重ね（青=お手本 / 赤=自分 / 緑=一致）・差分・距離ヒートマップ
- 診断コメント（日本語）と参考スコア（IoU、Chamfer 距離）
- 位置合わせなし（デフォルト）または重心合わせ
- 見本と紙で同期するグリッド（2 / 3×3 / 4×4）と外接箱
- 上下または左右の配置
- 記憶模写（見本を隠す）とチラ見
- セッションをローカル JSON に記録し、同じ題材のクセ傾向を表示

## 開発

Node.js 22 以上が必要です。

```bash
npm ci
npm start                     # 起動
npm start -- path/to/lineart.png   # 自分の線画を開いて起動
npm test                      # 単体・シナリオ回帰（ウィンドウ不要）
npm run test:gui              # 実ウィンドウを操作する GUI 回帰（Linux の画面なし環境では xvfb-run -a を前に付ける）
npm run dist:win              # Windows 用 exe（portable / setup）を dist/ に生成
npm run dist:linux            # AppImage を dist/ に生成
```

構成:

| パス | 役割 |
|---|---|
| `src/engine/` | 採点エンジン（GUI 非依存。D 版から移植） |
| `src/main/` | Electron メインプロセス（ウィンドウ、ファイルダイアログ、履歴 JSON の保存） |
| `src/renderer/` | 画面（HTML/CSS/JS）。描画・入力・表示切替 |
| `test/unit/`, `test/gui/` | 回帰テスト。詳細は [test/README.md](test/README.md) |

## 操作

ウィンドウ左側でお手本を選び、中央キャンバスで模写します。上のツールバーは普通のボタンです。

| 操作 | 方法 |
|------|------|
| お手本 | 左リストをクリック（図形／線練習／立体／サンプル画像） |
| 画像 | 「画像を開く…」またはウィンドウへドロップ（カラー表示） |
| 描画 | キャンバスをドラッグ（ペンタブはマウス相当） |
| アンドゥ / クリア / 答え合わせ / もう一度 / 記録 | 見本と紙の間のボタン（Ctrl+Z / Ctrl+Enter / Ctrl+S） |
| 答え合わせ | 右ペインに重ね表示と診断 |
| 重ね／差分／ヒート／スライド | 右のコンボボックス |
| 重心合わせ | チェックボックス（形だけ見たいとき） |
| 記録 | 「記録」。左下の履歴と、同じ題材の傾向 |
| 配置 | ツールバー「上下 / 左右」（既定は左右。ウィンドウは自由にリサイズ） |
| 設定・診断欄 | 「題材・設定」「診断」で開閉。狭い画面では初期状態で非表示。内容はスクロール可能 |
| グリッド | なし / 2分割 / 3×3 / 4×4（採点対象外） |
| 外接箱 | お手本の外枠をガイド表示 |
| 記憶模写 | 見本を隠す。チラ見で約2秒だけ表示 |
| 筆圧 | ペンタブの筆圧で線幅が変わる。マウスは Shift=細、Ctrl=太 |

記録先:

- Linux: `~/.local/share/paint_hikaku/sessions/`
- Windows: `%APPDATA%\paint_hikaku\sessions\`

`PAINT_HIKAKU_DATA_DIR` を設定すると保存先を変更できます。テストでは必ず一時ディレクトリを使用します。保存先・JSON 形式は D 言語版と同じなので、以前の記録もそのまま読み込めます。

## CI / Release

- push・PR ごとに Windows / Ubuntu で単体・GUI 回帰とスモークテストを実行し、通過すると Windows exe（portable / setup）と AppImage を作って、パッケージ済みアプリでもスモークテストをしてから Artifacts に保存します。README などの `.md` だけの変更では実行しません。
- `vMAJOR.MINOR.PATCH` タグ: タグの版番号でビルドし、exe・AppImage・`SHA256SUMS` を Release へ公開します。どれかが失敗した場合は公開しません。
- ブランチ保護を設定する場合のチェック名: `Test (ubuntu-24.04)`、`Test (windows-2022)`、`Windows exe`、`Linux AppImage`。

## 設計の要点

- 比較はベクトル一致ではなく **同じ論理解像度（768²）のラスタマスク**。なぞり訓練で厳しすぎないようにしている。表示サイズはウィンドウに合わせて拡縮するが、採点解像度は変わらない。
- デフォルトは位置合わせなし。ズレ自体が学習対象。重心合わせは「形は近いが場所が違う」を切り分けるときだけ使う。
- 写真お手本はカラー表示。採点は輝度の暗い部分を線とみなす（透明部分は紙として扱う）。
- 画面はレンダラープロセスの素の HTML/CSS/JS（バンドラーなし）。Node.js の機能はプリロード経由の最小限の IPC（画像を開く・履歴の読み書き）だけに限定し、`contextIsolation` と `sandbox` を有効にしている。
