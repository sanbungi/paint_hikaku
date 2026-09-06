# 回帰テスト

期待動作をテストIDと対応づけます。修正時は、修正前に失敗し修正後に通るケースを追加してください。単なる「落ちない」判定ではなく、状態・画素・数値・保存内容を検証します。

| テストID / モジュール | 固定する期待動作 |
|---|---|
| STATE-SAVE | 比較前の保存拒否、同じ結果の二重保存拒否、位置合わせ変更後の再保存、表示変更では記録済みを保持 |
| STATE-SAVE-RETRY | 保存例外時に記録済みとせず、再試行できる |
| STATE-IMAGE-PERSPECTIVE | 外部画像にパース設定を適用しても画像や描画を破壊しない |
| STATE-PEEK | チラ見の連打で期限更新、古い期限通知を無視、題材変更時の解除、比較時の再表示 |
| CATALOG-PERSPECTIVE | 全18題材×全4投影×距離1/55/90、通常距離の非空描画 |
| STATE-PERSPECTIVE-GUIDES | 補助線・隠れ線変更は結果を保持、投影変更は結果を無効化して描画を保持 |
| GUIDES-NONSCORING | 全グリッド・外接箱の生成が採点マスクを変えない |
| HISTORY-PATHS | 日本語Windowsパス、安全なファイル名、同時刻の別記録、旧JSON、破損JSONのスキップ |
| COMPARE-PIXELS | 重ね・差分の期待RGBA、距離ヒート色、スライド0/100%、既知IoU、空描画 |
| engine.regression | 円の縦横比、題材変更時の線の扱い、紙への見本混入防止、診断方向、アンドゥ |
| engine.stroke / viewgeom / templates | 補間端点、任意縦横比での正方形、カラー画像のフィット |
| GUI-EVENTS | 実ウィジェットイベント経由の題材同期、描画、比較、保存、位置合わせ、比較方式、再開 |
| GUI-IMAGES | PNG/JPEG、日本語・空白パス、カラーと縦横比、パース操作、欠損・破損画像の状態保持 |
| GUI-LAYOUT | 96/120/144/192 DPI × 1366×768/1920×1080 × 上下/左右の非空・非重複キャンバス、サイドバーの横はみ出し防止・説明文折り返し・スライダー幅・±1操作と上下限 |
| GUI-SMOKE | 実行時ライブラリ、日本語フォント登録、ウィンドウ生成、サンプル読込、初回描画 |

## 実行

```bash
dub test --config=unittest
dub build --config=gui-test
python3 scripts/run_checks.py --name gui --expect 'PASS GUI-EVENTS' --expect 'PASS GUI-IMAGES' --expect 'PASS GUI-LAYOUT' --expect 'PASS GUI-SMOKE' -- ./paint_hikaku
# Linuxの画面なし環境ではコマンド末尾を xvfb-run -a ./paint_hikaku に変更
```

Windowsでは `python` と `.\paint_hikaku.exe` を使用します。配布用のDLL・フォントを含めた確認は `scripts/package.py windows --version gui --stage-only` でステージしたexeを使います。

`run_checks.py` は保存先を一時ディレクトリへ切り替え、終了コード・タイムアウト・必須PASSマーカーを確認します。GUIテストはテスト用Dub構成だけに組み込みます。配布exeの `--smoke-test` も隔離保存先を必須とします。

ログとレイアウトPNGは `test-results/` に保存され、CIがArtifactとして保持します。失敗時には直前のGUI画像も出力します。スクリーンショットは確認用で、OS間の文字描画の完全一致は判定しません。DPI変更はテーマの測定キャッシュも無効化します。

期待画素は `COMPARE-PIXELS` に明示しており、自動更新しません。変更時は意図と変更前後の結果をPRに記載してください。

## 検出能力の確認

```bash
python3 scripts/check_mutations.py
```

一時コピーに保存無効化・タイマー・カメラ距離・色の故障を1つずつ注入し、テストのassertで検出できることを確認します。元のソースは変更せず、コンパイル失敗は検出成功と見なしません。通常CIの実行時間を増やさないよう、テスト基盤変更時に実施します。

## 手動で残す確認

Windows 11の実OS表示倍率100/125/150/200%、最大化・復元・モニター移動、実機ペンタブの入力、OSファイルダイアログの操作をRelease前に確認してください。GUIの自動DPIテストはOS側の表示倍率や実機ドライバーの検証を代替しません。
