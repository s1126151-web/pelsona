# 彼という人（3部作・プロトタイプ）

一人の男性「彼」を、異なる時代・異なる立場から見つめる作品です。
プレイヤーが彼を「変える」ことが目的ではなく、
「変えようとすること」「変わるものと変わらないもの」を体験するための作品です。

DB・ログイン機能はありません（進行状況はブラウザのメモリ上のみ）。

## 全体の流れ

```
タイトル
  → (フェード)
  → 第一部：チャット（彼=18歳／プレイヤー=父親）
      → AIが終了と判断 → 玄関を出ていく描写 → (フェード)
  → 第二部：自動再生の帯（固定演出、彼が最も彼らしく生きた時代）
      タイプライターで地の文が積み重なっていく。ユーザー操作なし。
      → 最後まで再生されたら自動で (フェード)
  → 第三部：チャット（彼=67歳／プレイヤー=成人した息子）
      → サーバー側の進捗管理により終了 → (フェード)
  → エピローグ（固定文章、タイプライターで表示）
  → タイトルへ戻る
```

## 構成

```
young-chat-app/
  server.js                        … Express サーバー本体。/api/chat のみ
  prompts/
    shared-core.js                 … 両時代に共通する人物の核・会話運用ルール（01_shared_core.md）
    output-format.js                … AIの出力形式(JSON)の全章共通ベースルール
    young-context.js                … 第一部専用の背景ストーリー・会話傾向（02_young_context.md）＋終了条件
    present-context.js              … 第三部専用の背景ストーリー・会話傾向（03_present_context.md）＋話題出力ルール
    runtime-templates.js            … 毎ターン、その時点の状態を埋め込む「現在地テンプレート」（04_runtime_templates.md）
  public/index.html                … フロントエンド一式（タイトル〜エピローグまで全フェーズ、タイプライター演出）
  .env.example
  package.json
```

`prompts/` 以下の内容は、GPTと一緒に作成した「01_shared_core.md」「02_young_context.md」
「03_present_context.md」「04_runtime_templates.md」を、そのままJSファイルへ移したものです。
トークン量は気にせず、毎ターン全文をそのままAIへ送ります。

## 毎ターンAIへ渡す内容（system相当のメッセージ）

### 第一部
```
shared-core.js
+ output-format.js
+ young-context.js（背景ストーリー・会話傾向）
+ young-context.js の終了条件
+ runtime-templates.js（第一部用・現在地テンプレート）
+ 第一部だけの会話履歴
+ 今回のユーザーの発言
```

### 第三部
```
shared-core.js
+ output-format.js
+ present-context.js（背景ストーリー・会話傾向）
+ present-context.js の話題出力ルール
+ runtime-templates.js（第三部用・現在地テンプレート、進捗を反映）
+ (終了を指示するターンのみ)今回の指示
+ 第三部だけの会話履歴
+ 今回のユーザーの発言
```

第一部に第三部専用の内容を渡すことはなく、第三部にも第一部の全文を渡す必要はない
（若い頃の必要な記憶は `present-context.js` 内に含まれています）、という
元データの `00_README.md` の設計方針のとおりに実装しています。

## 第一部の終了条件

AI自身が、5〜8往復ほどのやり取りのあと「もう我慢しない、という核を示し切った」と
判断したら、次の2つを満たす返答をして章を終えます（`young-context.js`の
`buildYoungEndingInstruction()`）。

- 彼が「もういい」というニュアンスの台詞を残す
- 地の文に、彼が玄関を出ていく描写を含める

## 第三部の終了条件（サーバー側で進捗管理）

AIには「今回の返答で、どの話題に触れたか」だけを毎回報告させ（`topicsExpressed`）、
実際の終了判定は `server.js` 側が進捗を積算して行います。

- 管理する3つの話題：`gameRegret`（ゲームを強くやめさせたことへの部分的な後悔）、
  `wishForSon`（息子にはやりたいことをしてほしいという願い）、
  `selfDefense`（自分の人生・人格全体を否定されることは拒む姿勢）
- 最低5往復までは終了しない（`MIN_TURNS_BEFORE_END`）
- 8往復目までに出ていない話題は、AIに自然に持ち出すよう指示する（`BRING_UP_FROM_TURN`）
- 3つの話題がすべて出たあと、2〜3往復（ランダム）経過したら終了
- 最大12往復で強制的に終了する（`MAX_TURNS`）
- しきい値は `server.js` 冒頭の定数で調整できます

終了が決まったターンでは、AIに「今回の返答でこの章を締めくくってください」と
指示したうえで最後の返答を生成させ、それを表示し終えてから次のフェーズへ進みます。

## runtime-templates.js の `relationshipSummary` / `recentEventSummary` について

現状は簡易な実装です。`recentEventSummary` は直前の1往復をそのまま短く要約している
だけで、`relationshipSummary` はまだ固定のプレースホルダーです。本格的な関係値の
蓄積や要約が必要になったら、`server.js` の該当箇所を拡張してください。

## 第二部について

AIは使いません。`public/index.html` の `PART2_LINES`（配列）に書かれた文章を、
上から順にタイプライターで自動再生するだけの固定演出です。

## 「この章を終える（テスト用）」ボタンについて

第一部・第三部の右上にあるボタンは、AIの判定を待たずに、その場で章を終えて
次のフェーズへ進むための動作確認用のボタンです。不要になったら、
`public/index.html` 内の `skipBtn` 関連のコードを削除すれば取り除けます。

## セットアップ

1. `npm install`
2. `cp .env.example .env` し、`.env` の `OPENAI_API_KEY` を設定
3. `npm start`
4. ブラウザで `http://localhost:3000/` を開く

## APIの仕様（/api/chat）

**リクエスト**
```json
{
  "message": "話しかけた内容",
  "history": [ { "role": "user", "content": "..." }, ... ],
  "mode": "present",
  "progress": { "turnCount": 3, "topics": { "gameRegret": true, "wishForSon": false, "selfDefense": false }, "turnsSinceAllCovered": null, "endAfterExtraTurns": null }
}
```
`progress` は `mode: "present"` のときだけ使います（初回は省略可）。

**レスポンス（成功時、mode: "young"）**
```json
{ "narration": "...", "dialogue": "...", "sceneComplete": false }
```

**レスポンス（成功時、mode: "present"）**
```json
{ "narration": "...", "dialogue": "...", "sceneComplete": false, "progress": { ...更新後の進捗... } }
```

**レスポンス（失敗時）** … HTTP 4xx/5xx とともに `{ "error": "..." }` を返します。
通信中は「少し考えている……」、失敗時は「返事が途切れた。もう一度伝えてください」と表示します。
