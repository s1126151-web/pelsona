require('dotenv').config();
const express = require('express');
const path = require('path');
const os = require('os');

const { buildSharedCore } = require('./prompts/shared-core');
const { buildOutputFormatRules } = require('./prompts/output-format');
const { buildYoungContext, buildYoungEndingInstruction } = require('./prompts/young-context');
const {
  buildPresentContext,
  buildPresentTopicsInstruction,
} = require('./prompts/present-context');
const {
  buildYoungRuntimeTemplate,
  buildPresentRuntimeTemplate,
} = require('./prompts/runtime-templates');

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 第三部で管理する3つの話題
// unchangedCore: 自分の人生・人格を否定されることは拒む、という変わっていない核
// foundPurpose: やりたいことを見つけ、それを続けてきたという発言
// rationalReflection: 多少なりとも理性的に自分の一部を振り返る発言
const TOPIC_KEYS = ['unchangedCore', 'foundPurpose', 'rationalReflection'];

// 第三部の終了条件のしきい値
const MIN_TURNS_BEFORE_END = 5;
const BRING_UP_FROM_TURN = 8;
const MAX_TURNS = 12;

function emptyProgress() {
  return {
    turnCount: 0,
    topics: { unchangedCore: false, foundPurpose: false, rationalReflection: false },
    turnsSinceAllCovered: null,
    endAfterExtraTurns: null,
  };
}

function normalizeProgress(input) {
  const base = emptyProgress();
  if (!input || typeof input !== 'object') return base;
  return {
    turnCount: Number.isFinite(input.turnCount) ? input.turnCount : 0,
    topics: {
      unchangedCore: !!(input.topics && input.topics.unchangedCore),
      foundPurpose: !!(input.topics && input.topics.foundPurpose),
      rationalReflection: !!(input.topics && input.topics.rationalReflection),
    },
    turnsSinceAllCovered:
      typeof input.turnsSinceAllCovered === 'number' ? input.turnsSinceAllCovered : null,
    endAfterExtraTurns:
      typeof input.endAfterExtraTurns === 'number' ? input.endAfterExtraTurns : null,
  };
}

function allTopicsCovered(topics) {
  return TOPIC_KEYS.every((k) => topics[k]);
}

function missingTopics(topics) {
  return TOPIC_KEYS.filter((k) => !topics[k]);
}

function decideDirective(progress) {
  const nextTurnCount = progress.turnCount + 1;

  if (nextTurnCount >= MAX_TURNS) {
    return { type: 'MUST_END', reason: 'max_turns' };
  }

  if (
    allTopicsCovered(progress.topics) &&
    progress.turnsSinceAllCovered !== null &&
    progress.endAfterExtraTurns !== null &&
    progress.turnsSinceAllCovered + 1 >= progress.endAfterExtraTurns &&
    nextTurnCount >= MIN_TURNS_BEFORE_END
  ) {
    return { type: 'MUST_END', reason: 'topics_covered' };
  }

  if (nextTurnCount >= BRING_UP_FROM_TURN) {
    const missing = missingTopics(progress.topics);
    if (missing.length > 0) {
      return { type: 'BRING_UP_MISSING', topics: missing };
    }
  }

  return { type: 'CONTINUE' };
}

function buildTurnInstruction(directive) {
  const topicLabel = {
    unchangedCore: '自分の人生・人格を否定されることは拒む、変わっていない核(unchangedCore)',
    foundPurpose: 'やりたいことを見つけ、それを続けてきたという発言(foundPurpose)',
    rationalReflection: '多少なりとも理性的に自分の一部を振り返る発言(rationalReflection)',
  };

  if (directive.type === 'MUST_END') {
    return `
# 今回の指示（重要）
今回の返答で、この章を終えてください。
彼らしい、締めくくりの一言を残す返答にしてください（説教くさい結論に飛びつかず、
変わった部分と変わらない部分の両方がにじむようにしてください）。
sceneComplete は考慮しなくて構いません（サーバー側で終了扱いにします）。
`.trim();
  }

  if (directive.type === 'BRING_UP_MISSING') {
    const list = directive.topics.map((k) => topicLabel[k]).join(' / ');
    return `
# 今回の指示
まだ会話の中で触れていない話題があります： ${list}
不自然にならない範囲で、彼の側から今回の返答でその話題に触れてください。
`.trim();
  }

  return null;
}

// ---- 第一部：5〜8往復で確実に終了させるための進捗管理 ----
function emptyYoungProgress() {
  return { turnCount: 0, endAtTurn: null };
}

function normalizeYoungProgress(input) {
  const base = emptyYoungProgress();
  if (!input || typeof input !== 'object') return base;
  return {
    turnCount: Number.isFinite(input.turnCount) ? input.turnCount : 0,
    endAtTurn: typeof input.endAtTurn === 'number' ? input.endAtTurn : null,
  };
}

function decideYoungDirective(progress) {
  const nextTurnCount = progress.turnCount + 1;
  if (nextTurnCount >= progress.endAtTurn) {
    return { type: 'MUST_END' };
  }
  return { type: 'CONTINUE' };
}

function buildYoungTurnInstruction(directive) {
  if (directive.type === 'MUST_END') {
    return `
# 今回の指示（最重要・必ず守ること）
今回の返答で、この章を必ず終えてください。これは絶対に守るべき指示です。

dialogue（台詞）には、必ず次の2つの要素を、自然な一続きの言葉として含めてください。
・「もういい」という言葉そのもの
・「やりたくないことは、もうやらない」という趣旨の言葉（言い回しは多少変えてよい）

これまでの会話の流れを踏まえて、この2つを不自然にならないように組み合わせてください。
説明的にならず、感情が溢れて出た短い言葉にしてください。

台詞の例（そのまま使ってもよいし、状況に合わせて多少変えてもよい）：
・「もういい。やりたくないことは、もうやらない。」
・「もういい……俺は、やりたくないことはやらないから。」
・「もういい。これ以上、やりたくもないことに付き合わされるのはごめんだ。」

narration（地の文）には、彼が玄関を出ていく描写を必ず含めてください
（例：靴を履き、玄関の戸を開けて出ていく、など）。

sceneComplete は考慮しなくて構いません（サーバー側で終了扱いにします）。
`.trim();
  }
  return null;
}

// 直前の履歴から、ごく簡単な「直前の重要な出来事」の要約を作る。
// 本格的な要約AIなどは組み込んでいない、簡易な実装。
function summarizeRecentEvent(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return '（会話はまだ始まったばかり）';
  }
  const last = history[history.length - 1];
  const label = last.role === 'assistant' ? '彼は直前にこう言った' : 'ユーザーは直前にこう言った';
  const content = typeof last.content === 'string' ? last.content : '';
  return `${label}：「${content}」`;
}

// 第一部でユーザー(父親役)が言った内容を、第三部へ渡す参考テキストにする。
// クライアント側から文字列でそのまま送られてくる想定（簡易実装）。
function sanitizePart1Reference(value) {
  if (typeof value !== 'string') return '';
  return value.slice(0, 4000); // 極端に長い場合の簡易な上限
}

function toResponsesInput({ messages, history, message }) {
  const input = messages.map((content) => ({ role: 'system', content }));

  if (Array.isArray(history)) {
    for (const turn of history) {
      if (!turn || typeof turn.content !== 'string') continue;
      const role = turn.role === 'assistant' ? 'assistant' : 'user';
      input.push({ role, content: turn.content });
    }
  }

  input.push({ role: 'user', content: message });
  return input;
}

function extractOutputText(data) {
  if (typeof data.output_text === 'string' && data.output_text.length > 0) {
    return data.output_text;
  }
  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        const textPart = item.content.find(
          (c) => c.type === 'output_text' && typeof c.text === 'string'
        );
        if (textPart) return textPart.text;
      }
    }
  }
  return null;
}

function stripCodeFence(text) {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

function extractJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

// JSON全体としては壊れていても、"narration": "..." / "dialogue": "..." の
// 部分文字列だけは正しい形で書かれていることが多いため、正規表現で直接取り出す。
// これにより、JSON.parseが失敗した場合でも、choicesやsceneCompleteなどの
// 後続の断片がdialogueに混ざるのを防ぐ。
function extractFieldsByRegex(text) {
  const unescape = (s) => s.replace(/\\"/g, '"').replace(/\\n/g, ' ');

  const dialogueMatch = text.match(/"dialogue"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!dialogueMatch) return null;

  const narrationMatch = text.match(/"narration"\s*:\s*"((?:[^"\\]|\\.)*)"/);

  return {
    narration: narrationMatch ? unescape(narrationMatch[1]) : '',
    dialogue: unescape(dialogueMatch[1]),
    topicsExpressed: {},
    choices: [],
    sceneComplete: false,
  };
}

// dialogue/narrationの末尾に、JSONキーらしき断片(choices: [...] など)が
// 紛れ込んでしまった場合の、最後の保険としての除去処理。
function stripJsonArtifacts(text) {
  if (typeof text !== 'string') return text;
  return text
    // "choice"/"choices" という単語が出てきたら、それ以降は全部切り捨てる
    // （配列表記 [...] でも、日本語のカギ括弧の並びでも、単数形でも対応）
    .replace(/\s*"?choices?"?\s*[:：][\s\S]*$/i, '')
    .replace(/\s*"?scene ?complete"?\s*[:：][\s\S]*$/i, '')
    .replace(/\s*"?topics ?expressed"?\s*[:：][\s\S]*$/i, '')
    .trim();
}

// 画面側がdialogueの前後に「」を付けて表示するため、AIが自分でも「」を
// 付けてしまうと二重になる。外側の「」だけを1組取り除く（安全策）。
function stripOuterKagiQuotes(text) {
  if (typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (trimmed.startsWith('「') && trimmed.endsWith('」')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseAsPlainText(rawText) {
  const lines = rawText
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return null;
  if (lines.length === 1) {
    return { narration: '', dialogue: lines[0], topicsExpressed: {}, choices: [], sceneComplete: false };
  }
  const [narration, ...rest] = lines;
  return { narration, dialogue: rest.join(' '), topicsExpressed: {}, choices: [], sceneComplete: false };
}

function parseModelReply(rawText) {
  const cleaned = stripCodeFence(rawText);

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // 次の手を試す
  }

  const extracted = extractJsonObject(cleaned);
  if (extracted) {
    try {
      return JSON.parse(extracted);
    } catch (e) {
      // 次の手を試す
    }
  }

  const byRegex = extractFieldsByRegex(cleaned);
  if (byRegex) {
    console.warn('JSON全体の解析に失敗したため、正規表現でnarration/dialogueを抽出しました:', cleaned);
    return byRegex;
  }

  const fallback = parseAsPlainText(cleaned);
  if (fallback) {
    console.warn('JSONではなくプレーンテキストとして解釈しました:', cleaned);
    return fallback;
  }

  return null;
}

function sanitizeChoices(choices) {
  if (!Array.isArray(choices)) return [];
  return choices
    .filter((c) => typeof c === 'string' && c.trim().length > 0)
    .slice(0, 3)
    .map((c) => c.trim());
}

// JSON全体の解析には失敗していても、choices部分だけは救い出せることが多い。
// 配列表記("choices": ["a","b","c"])でも、カギ括弧の並び(choices: 「a」「b」「c」)でも
// 対応する。
function salvageChoices(rawText) {
  const arrayMatch = rawText.match(/"?choices?"?\s*[:：]\s*\[([^\]]*)\]/i);
  if (arrayMatch) {
    const items = arrayMatch[1].match(/"([^"]*)"/g);
    if (items && items.length > 0) {
      return items.map((s) => s.slice(1, -1).trim()).filter(Boolean).slice(0, 3);
    }
  }

  const afterChoices = rawText.match(/choices?\s*[:：]\s*([\s\S]*)$/i);
  if (afterChoices) {
    const kagiItems = afterChoices[1].match(/「([^」]*)」/g);
    if (kagiItems && kagiItems.length > 0) {
      return kagiItems.map((s) => s.slice(1, -1).trim()).filter(Boolean).slice(0, 3);
    }
  }

  return [];
}

app.post('/api/chat', async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY が設定されていません。.env を確認してください。');
      return res.status(500).json({ error: 'server_not_configured' });
    }

    const { message, history, mode } = req.body || {};

    if (typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'invalid_message' });
    }

    if (mode !== 'young' && mode !== 'present') {
      return res.status(400).json({ error: 'invalid_mode' });
    }

    const isPresent = mode === 'present';
    const sharedCore = buildSharedCore();
    const outputFormat = buildOutputFormatRules();
    const recentEventSummary = summarizeRecentEvent(history);

    let messages;
    let incomingProgress = null;
    let directive = null;

    if (isPresent) {
      incomingProgress = normalizeProgress(req.body.progress);
      directive = decideDirective(incomingProgress);
      const turnInstruction = buildTurnInstruction(directive);
      const part1Reference = sanitizePart1Reference(req.body.part1Reference);

      const runtimeTemplate = buildPresentRuntimeTemplate({
        location: '彼の作業場',
        sceneState: '母親は自営業の彼の仕事を手伝っており、その中でやり方・方向性について議論になり、喧嘩に至った直後。父親は作業を続けており、一人では固定できない部品を息子に手伝わせている',
        relationshipSummary: '(簡易実装。今後拡張可能)',
        recentEventSummary,
        progress: incomingProgress,
        part1Reference,
      });

      messages = [
        sharedCore,
        outputFormat,
        buildPresentContext(),
        buildPresentTopicsInstruction(),
        runtimeTemplate,
      ];
      if (turnInstruction) messages.push(turnInstruction);
    } else {
      incomingProgress = normalizeYoungProgress(req.body.progress);
      if (incomingProgress.endAtTurn === null) {
        incomingProgress.endAtTurn = 5 + Math.floor(Math.random() * 4); // 5〜8のいずれか
      }
      directive = decideYoungDirective(incomingProgress);
      const turnInstruction = buildYoungTurnInstruction(directive);

      const runtimeTemplate = buildYoungRuntimeTemplate({
        location: '実家の玄関先',
        sceneState: '赤点だらけのテストの答案を親に見られた直後',
        relationshipSummary: '(簡易実装。今後拡張可能)',
        recentEventSummary,
      });

      messages = [
        sharedCore,
        outputFormat,
        buildYoungContext(),
        buildYoungEndingInstruction(),
        runtimeTemplate,
      ];
      if (turnInstruction) messages.push(turnInstruction);
    }

    const input = toResponsesInput({ messages, history, message });

    const openaiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input,
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text().catch(() => '');
      console.error('OpenAI API error:', openaiRes.status, errText);
      return res.status(502).json({ error: 'upstream_error' });
    }

    const data = await openaiRes.json();
    const rawText = extractOutputText(data);

    if (!rawText) {
      console.error('OpenAI応答からテキストを取得できませんでした:', JSON.stringify(data));
      return res.status(502).json({ error: 'empty_response' });
    }

    const parsed = parseModelReply(rawText);
    if (!parsed) {
      console.error('AIの返答を解析できませんでした:', rawText);
      return res.status(502).json({ error: 'invalid_json' });
    }

    const narration = stripJsonArtifacts(typeof parsed.narration === 'string' ? parsed.narration : '');
    let dialogue = stripOuterKagiQuotes(stripJsonArtifacts(typeof parsed.dialogue === 'string' ? parsed.dialogue : ''));
    let choices = sanitizeChoices(parsed.choices);
    if (choices.length === 0) {
      choices = sanitizeChoices(salvageChoices(rawText));
    }

    if (!dialogue) {
      console.error('彼の台詞を取得できませんでした:', rawText);
      return res.status(502).json({ error: 'empty_response' });
    }

    if (!isPresent) {
      const sceneComplete = directive.type === 'MUST_END';
      // 安全策：終了ターンなのに「もういい」が含まれていなければ補う
      if (sceneComplete && !dialogue.includes('もういい')) {
        dialogue = `もういい。やりたくないことは、もうやらない。${dialogue}`;
      }
      const updatedYoungProgress = {
        turnCount: incomingProgress.turnCount + 1,
        endAtTurn: incomingProgress.endAtTurn,
      };
      return res.json({ narration, dialogue, choices, sceneComplete, progress: updatedYoungProgress });
    }

    const expressedNow = parsed.topicsExpressed || {};
    const updatedTopics = { ...incomingProgress.topics };
    TOPIC_KEYS.forEach((k) => {
      if (expressedNow[k]) updatedTopics[k] = true;
    });

    const updatedProgress = {
      turnCount: incomingProgress.turnCount + 1,
      topics: updatedTopics,
      turnsSinceAllCovered: incomingProgress.turnsSinceAllCovered,
      endAfterExtraTurns: incomingProgress.endAfterExtraTurns,
    };

    if (allTopicsCovered(updatedTopics)) {
      if (updatedProgress.turnsSinceAllCovered === null) {
        updatedProgress.turnsSinceAllCovered = 0;
        updatedProgress.endAfterExtraTurns = Math.random() < 0.5 ? 2 : 3;
      } else {
        updatedProgress.turnsSinceAllCovered += 1;
      }
    }

    const sceneComplete = directive.type === 'MUST_END';

    return res.json({ narration, dialogue, choices, sceneComplete, progress: updatedProgress });
  } catch (err) {
    console.error('chat エラー:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

function getLanUrls(port) {
  const interfaces = os.networkInterfaces();
  const urls = [];
  Object.values(interfaces).forEach((entries) => {
    (entries || []).forEach((entry) => {
      if (entry.family === 'IPv4' && !entry.internal) {
        urls.push(`http://${entry.address}:${port}`);
      }
    });
  });
  return urls;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`app running at http://localhost:${PORT}`);
  const lanUrls = getLanUrls(PORT);
  if (lanUrls.length > 0) {
    console.log('同じネットワーク(Wi-Fi等)の他の端末からは、次のURLでアクセスできます:');
    lanUrls.forEach((u) => console.log(`  ${u}`));
    console.log(`QRコード表示ページ: ${lanUrls[0]}/host.html`);
  } else {
    console.log('LAN上のIPアドレスが見つかりませんでした。Wi-Fi等に接続されているか確認してください。');
  }
});
