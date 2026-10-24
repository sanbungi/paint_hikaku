# 回帰テスト

期待動作をテストIDと対応づけます。修正時は、修正前に失敗し修正後に通るケースを追加してください。単なる「落ちない」判定ではなく、状態・画素・数値・保存内容を検証します。

| テストID / ファイル | 固定する期待動作 |
|---|---|
| STATE-SAVE | 比較前の保存拒否、同じ結果の二重保存拒否、位置合わせ変更後の再保存、表示変更では記録済みを保持 |
| STATE-SAVE-RETRY | 保存例外時に記録済みとせず、再試行できる |
| STATE-SAVE-CONCURRENT | 書き込み中の連打で二重記録しない |
| STATE-IMAGE-PERSPECTIVE | 外部画像にパース設定を適用しても画像や描画を破壊しない |
| STATE-PEEK | チラ見の連打で期限更新、古い期限通知を無視、題材変更時の解除、比較時の再表示 |
| CATALOG-PERSPECTIVE | 全18題材×全4投影×距離1/55/90、通常距離の非空描画 |
| STATE-PERSPECTIVE-GUIDES | 補助線・隠れ線変更は結果を保持、投影変更は結果を無効化して描画を保持 |
| GUIDES-NONSCORING | 全グリッド・外接箱の生成と画面合成が採点マスクを変えない |
| HISTORY-PATHS | 日本語Windowsパス、安全なファイル名、同時刻の別記録、旧JSON、破損JSONのスキップ、件数上限 |
| HISTORY-ROOT / HISTORY-TREND | D版と同じ保存先、傾向・前回比の文言、タイムスタンプ形式 |
| COMPARE-PIXELS | 重ね・差分の期待RGBA、距離ヒート色、スライド0/100%、既知IoU、空描画 |
| RUN-CHECKS | CIゲートが失敗・マーカー欠落・ハング・保存先未隔離を検出する |
| engine.* (`test/unit/engine.test.js`) | 円の縦横比、題材変更時の線の扱い、紙への見本混入防止、診断方向、アンドゥ、補間端点、任意縦横比での正方形、画像のレターボックス |
| FIGURE-POSES | 全サンプルポーズが VRM のボーン名と妥当な角度だけを使う |
| FIGURE-EDGES / FIGURE-DEPTH | 深度・法線バッファからの輪郭・重なり・折れ目の抽出、線の太さ、深度の線形化 |
| FIGURE-OVERLAY / FIGURE-IDS | 見本への線の重ね、題材ID・表示名、カメラ距離の算出 |
| STATE-FIGURE-VIEW | カメラ変更は描画を残して結果を無効化、表示だけの変更は結果と記録済みを保持 |
| GUI-EVENTS | 実マウス・クリック・キー操作での題材選択、描画、比較、保存、位置合わせ、比較方式、再開、Ctrl+Z / Ctrl+Enter |
| GUI-MEMORY | 記憶模写で見本を隠す、チラ見が約2秒で戻る、答え合わせで再表示 |
| GUI-PERSPECTIVE | パース設定のスライダー・±1・上下限、投影切替、平面題材では無効、描画を保持 |
| GUI-IMAGES | PNG/JPEG、日本語・空白パス、カラーと縦横比、欠損・破損画像の状態保持、ドラッグ＆ドロップ、サンプル画像 |
| GUI-FIGURE | デッサン人形、ポーズごとに異なる線、スライダー・ドラッグ・ホイールでのカメラ操作、表示切替、輪郭のみ、記録と履歴名 |
| GUI-VRM | 日本語・空白パスの VRM を起動引数で読込、作者表示、ポーズでボーンが動く、ドロップ読込、壊れた VRM で状態保持 |
| GUI-LAYOUT | 1366×768/1920×1080 × 表示倍率100/125/150/200% × 上下/左右で、正方形・非重複のキャンバス、ページのはみ出しなし、狭い画面でサイドバーを畳む |
| GUI-SMOKE | 起動、サンプル読込、描画、答え合わせ、隔離保存先への記録、3D 人物の描画（WebGL）、初回描画（パッケージ済み exe / AppImage でも実行） |

## 実行

```bash
npm test
npm run test:gui            # Linux の画面なし環境: xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:gui
node scripts/run-checks.js --name smoke --expect "PASS GUI-SMOKE" -- node_modules/.bin/electron . --smoke-test
```

テスト用の VRM は `test/fixtures/vrm.js` が毎回生成します（外部のモデルファイルに依存しません）。

GUI テストは Playwright の Electron 操作（`playwright-core`、ブラウザのダウンロード不要）で実際のウィンドウを起動し、毎回一時ディレクトリを保存先にします。Linux ではコンテナや Ubuntu 24.04 で Chromium のサンドボックスが使えないため `--no-sandbox` を付けて起動します。

`run-checks.js` は保存先を一時ディレクトリへ切り替え、終了コード・タイムアウト・必須PASSマーカーを確認します。`--smoke-test` は `PAINT_HIKAKU_DATA_DIR` が未設定だと起動を拒否します。

ログとスクリーンショットは `test-results/` に保存され、CI が Artifact として保持します。失敗したテストは直前の画面も保存します。スクリーンショットは確認用で、OS 間の文字描画の完全一致は判定しません。

期待画素は `COMPARE-PIXELS` に明示しており、自動更新しません。変更時は意図と変更前後の結果をPRに記載してください。

## 手動で残す確認

Windows 11 の実OS表示倍率100/125/150/200%、最大化・復元・モニター移動、実機ペンタブの入力（筆圧）、実在の VRM モデル（VRoid 製など、MToon・髪の透過・VRM 0.x）での見た目と線、OSファイルダイアログの操作を Release 前に確認してください。GUI の自動 DPI テストはズーム倍率による近似で、OS 側の表示倍率や実機ドライバーの検証を代替しません。
