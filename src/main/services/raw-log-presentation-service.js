'use strict';

const { attachRawLogTurn } = require('../../shared/contracts/raw-log');

const ROLE_LABELS = {
  system: 'System',
  user: 'User',
  assistant: 'Assistant',
  tool: 'Tool-Ergebnis',
};

const STACK_ROLES = {
  system: { label: 'System', cls: 'system' },
  user: { label: 'Nutzer', cls: 'user' },
  assistant: { label: 'Modell-JSON', cls: 'model' },
  tool: { label: 'Tool-Erg.', cls: 'tool' },
};

const STACK_ROLE_HINTS = {
  system: 'Systemprompt — legt Rolle und Regeln des Modells fest.',
  user: 'Die ursprüngliche Eingabe des Nutzers.',
  assistant: 'JSON-Tool-Wunsch des Modells — die Datei ist damit NICHT gelesen.',
  tool: 'Die ANWENDUNG hat das Tool ausgeführt und reicht das Ergebnis nach.',
};

const AMNESIA_TOOLTIP =
  'Das Modell erinnert sich an nichts — darum reist jedes Mal alles erneut mit.';

const CONTEXT_FOOT_TEXT =
  'Der graue Sockel kehrt jede Runde wieder — die LLM-API ist zustandslos.';

const TOOL_SCHEMAS_PRETTY_MAX = 8_000;
const EXEC_RESULT_TEXT_MAX = 600;

function truncate(text, max) {
  const t = String(text ?? '');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function normalizeMessageContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      if (typeof part === 'string') {
        parts.push(part);
        continue;
      }
      if (part && typeof part === 'object') {
        if (typeof part.text === 'string') parts.push(part.text);
        else if (part.type === 'text' && typeof part.text === 'string') parts.push(part.text);
      }
    }
    if (parts.length) return parts.join('\n');
    try {
      return JSON.stringify(content, null, 2);
    } catch {
      return String(content);
    }
  }
  if (typeof content === 'object') {
    try {
      return JSON.stringify(content, null, 2);
    } catch {
      return String(content);
    }
  }
  return String(content);
}

function compactArgs(argStr) {
  const t = String(argStr ?? '').trim();
  if (!t) return '';
  try {
    return JSON.stringify(JSON.parse(t));
  } catch {
    return t;
  }
}

function prettyMaybeJson(text) {
  const t = String(text ?? '');
  const trimmed = t.trim();
  if (trimmed && (trimmed[0] === '{' || trimmed[0] === '[')) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      /* kein valides JSON */
    }
  }
  return t;
}

function buildToolSchemasPretty(toolDefs) {
  if (!Array.isArray(toolDefs) || toolDefs.length === 0) return '';
  const names = toolDefs.map((t) => (t && t.name) || '?');
  try {
    const compact = JSON.stringify(toolDefs.map((t) => t.schema), null, 2);
    if (compact.length <= TOOL_SCHEMAS_PRETTY_MAX) return compact;
  } catch {
    /* fall through to bounded sections */
  }

  const nameIndex = `Tools: ${names.join(', ')}\n`;
  if (nameIndex.length >= TOOL_SCHEMAS_PRETTY_MAX) {
    return truncate(nameIndex, TOOL_SCHEMAS_PRETTY_MAX);
  }

  const parts = [nameIndex];
  let remaining = TOOL_SCHEMAS_PRETTY_MAX - nameIndex.length;

  for (let i = 0; i < toolDefs.length; i += 1) {
    const header = `\n--- ${names[i]} ---\n`;
    let section;
    try {
      section = JSON.stringify(toolDefs[i].schema, null, 2);
    } catch {
      section = '{}';
    }
    const block = header + section;
    if (block.length <= remaining) {
      parts.push(block);
      remaining -= block.length;
      continue;
    }
    if (remaining > header.length) {
      parts.push(header + truncate(section, remaining - header.length));
    }
    break;
  }

  return parts.join('');
}

function findToolResult(exchanges, callId, fromIndex) {
  if (!callId) return null;
  for (let j = fromIndex + 1; j < exchanges.length; j += 1) {
    const msgs = Array.isArray(exchanges[j]?.messages) ? exchanges[j].messages : [];
    const hit = msgs.find((m) => m && m.role === 'tool' && m.tool_call_id === callId);
    if (hit) return normalizeMessageContent(hit.content);
  }
  return null;
}

function formatExecResultText(result) {
  if (result == null) return '';
  return truncate(prettyMaybeJson(result), EXEC_RESULT_TEXT_MAX);
}

function usageSummary(usage) {
  if (!usage || typeof usage !== 'object') return '';
  const parts = [];
  if (usage.prompt) parts.push(`in ${usage.prompt}`);
  if (usage.completion) parts.push(`out ${usage.completion}`);
  return parts.length ? parts.join(' / ') : '';
}

function formatTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function parseRequestBody(requestBody) {
  if (typeof requestBody !== 'string' || !requestBody) return null;
  try {
    const obj = JSON.parse(requestBody);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

function extractToolDefs(body) {
  const raw = body && Array.isArray(body.tools) ? body.tools : [];
  const defs = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    if (Array.isArray(t.functionDeclarations)) {
      for (const fd of t.functionDeclarations) {
        if (fd && typeof fd === 'object') defs.push({ name: fd.name || '?', schema: fd });
      }
    } else if (t.function && typeof t.function === 'object') {
      defs.push({ name: t.function.name || '?', schema: t });
    } else if (t.name && (t.input_schema || t.description || t.type === 'custom' || t.type === 'tool')) {
      defs.push({ name: t.name, schema: t });
    } else if (t.name) {
      defs.push({ name: t.name, schema: t });
    }
  }
  return defs;
}

function requestToolChoice(body) {
  const tc = body && body.tool_choice;
  if (typeof tc === 'string') return tc;
  if (tc && typeof tc === 'object') return tc.type || 'spezifisch';
  return '';
}

function requestMaxTokens(body) {
  if (!body) return null;
  const cand = body.max_tokens ?? body.max_output_tokens ?? body.generationConfig?.maxOutputTokens;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function describeFinishReason(reason, hasToolCalls) {
  const r = String(reason || '').toLowerCase();
  if (r === 'tool_calls' || r === 'tool_use' || (!r && hasToolCalls)) {
    return { text: 'Tool-Wunsch → weitere Runde nötig', kind: 'tool' };
  }
  if (!r) return null;
  if (r === 'stop' || r === 'end_turn' || r === 'stop_sequence' || r === 'complete' || r === 'completed') {
    return { text: 'fertig (stop)', kind: 'done' };
  }
  if (r === 'length' || r === 'max_tokens' || r === 'model_length' || r === 'max_output_tokens') {
    return { text: 'abgeschnitten — Output-Limit erreicht', kind: 'warn' };
  }
  if (r.includes('safety') || r.includes('filter') || r.includes('content') || r.includes('recitation')) {
    return { text: `gestoppt (${reason})`, kind: 'warn' };
  }
  return { text: `beendet (${reason})`, kind: 'done' };
}

function toolCallForResult(messages, toolCallId) {
  if (!toolCallId) return null;
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!Array.isArray(m.tool_calls)) continue;
    const hit = m.tool_calls.find((tc) => tc && tc.id === toolCallId);
    if (hit) return hit;
  }
  return null;
}

function layerSnippet(m) {
  const content = normalizeMessageContent(m?.content).replace(/\s+/g, ' ').trim();
  if (content) return content;
  if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
    return m.tool_calls
      .map((tc) => `${tc.name || 'tool'}(${compactArgs(tc.arguments)})`)
      .join(', ');
  }
  return '';
}

function sumCharLen(messages) {
  let n = 0;
  for (const m of Array.isArray(messages) ? messages : []) {
    n += normalizeMessageContent(m?.content).length;
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) n += String(tc.name || '').length + String(tc.arguments || '').length;
    }
  }
  return n;
}

function formatFactor(cur, prev) {
  if (!prev) return '';
  const f = cur / prev;
  if (!Number.isFinite(f) || f <= 1) return '';
  return `↑ ${f.toFixed(1).replace('.', ',')}× ggü. Vorrunde`;
}

function roundOutcome(ex) {
  if (ex.error) return 'Fehler';
  if (ex.cancelled) return 'abgebrochen';
  const calls = ex.response?.toolCalls || [];
  if (calls.length) return `→ ${calls.map((c) => c.name || 'tool').join(', ')}`;
  if (ex.response?.text?.trim()) return 'Text-Antwort';
  return '—';
}

function buildRoundDetailVm(ex, roundNo, prevSentCount = 0) {
  const sent = Array.isArray(ex.messages) ? ex.messages : [];
  const newMessageIndices = [];
  for (let i = 0; i < sent.length; i += 1) {
    const m = sent[i];
    if (prevSentCount > 0 && i < prevSentCount) continue;
    if (m && m.role !== 'assistant') newMessageIndices.push(i);
  }
  const ansCalls = ex.response?.toolCalls || [];
  const finish = describeFinishReason(ex.finishReason, ansCalls.length > 0);

  const req = ex.request || {};
  const hasRawSection =
    !!(req.method || req.url || req.headers || req.body || ex.responseRaw);
  const reqBody = parseRequestBody(req.body);
  const reqBits = [];
  const toolChoice = requestToolChoice(reqBody);
  if (toolChoice) reqBits.push(`tool_choice: ${toolChoice}`);
  const maxTokens = requestMaxTokens(reqBody);
  if (maxTokens) reqBits.push(`max_tokens: ${maxTokens}`);

  const metaBits = [];
  if (ex.model) metaBits.push(ex.model);
  const u = usageSummary(ex.usage);
  if (u) metaBits.push(u);
  if (ex.ts) metaBits.push(formatTime(ex.ts));

  const ansText = ex.response?.text || '';

  return {
    roundNo,
    exchangeIndex: roundNo - 1,
    errored: !!(ex.error || ex.cancelled),
    outcome: roundOutcome(ex),
    metaText: metaBits.join('  ·  '),
    sentLabel:
      prevSentCount > 0 ? 'Anwendung → Modell (neu in dieser Runde)' : 'Anwendung → Modell',
    sentEmpty: newMessageIndices.length === 0,
    sentEmptyText: 'Bisheriger Gesprächsverlauf erneut gesendet (nichts Neues).',
    prevSentCount,
    newMessageIndices,
    showAllMessages: prevSentCount > 0 && sent.length > 0,
    allMessagesCount: sent.length,
    errorText: ex.error ? `Fehler: ${ex.error}` : undefined,
    cancelled: !!ex.cancelled,
    answer: {
      hasText: !!ansText.trim(),
      toolCalls: ansCalls.map((c, callIndex) => ({
        callId: c.id || undefined,
        callIndex,
        name: c.name || 'tool',
        nameLine: `→ ${c.name || 'tool'}`,
        hasArguments: !!String(c.arguments ?? '').trim(),
      })),
    },
    finishWarn:
      finish && finish.kind === 'warn' && !ex.error && !ex.cancelled ? `⚠ ${finish.text}` : undefined,
    requestParamsLine: reqBits.length ? reqBits.join('  ·  ') : undefined,
    hasRawSection,
  };
}

function buildContextStackVm(exchanges) {
  if (!Array.isArray(exchanges) || exchanges.length === 0) {
    return { metaStat: '', footText: CONTEXT_FOOT_TEXT, rounds: [] };
  }

  const rounds = exchanges.map((ex) => {
    const messages = Array.isArray(ex.messages) ? ex.messages : [];
    const prompt = Number(ex.usage?.prompt) || 0;
    const completion = Number(ex.usage?.completion) || 0;
    const approx = !(prompt > 0);
    return { ex, messages, prompt, completion, approx, value: approx ? sumCharLen(messages) : prompt };
  });

  const maxValue = Math.max(1, ...rounds.map((r) => r.value));
  const first = rounds[0];
  const last = rounds[rounds.length - 1];
  const unitsConsistent = rounds.every((r) => r.approx === first.approx);
  const unitOf = (r) => (r.approx ? 'Zeichen' : 'Token');
  const toolCount = exchanges.reduce((s, ex) => s + (ex.response?.toolCalls?.length || 0), 0);

  const statBits = [
    `${rounds.length} ${rounds.length === 1 ? 'Runde' : 'Runden'}`,
    `${toolCount} ${toolCount === 1 ? 'Tool' : 'Tools'}`,
  ];
  if (rounds.length > 1 && unitsConsistent && first.value > 0 && last.value > first.value) {
    const delta = last.value - first.value;
    const pct = Math.round((delta / first.value) * 100);
    statBits.push(
      `Kontext wächst: ${first.approx ? '≈ ' : ''}${first.value} → ${last.value} ${unitOf(first)} (+${delta} / +${pct}%)`
    );
  } else {
    statBits.push(`${first.approx ? '≈ ' : ''}${first.value} ${unitOf(first)} gehen rein`);
  }

  let prevSent = 0;
  let prevValue = 0;
  let prevApprox = first.approx;
  const contextRounds = [];

  rounds.forEach((r, i) => {
    const { ex, messages, value, approx, completion } = r;
    const errored = !!(ex.error || ex.cancelled);
    const newFlags = messages.map(
      (m, idx) => m.role !== 'system' && m.role !== 'assistant' && idx >= prevSent
    );
    const newCount = newFlags.filter(Boolean).length;
    const reused = messages.length - newCount;

    const layers = [];
    const toolDefs = extractToolDefs(parseRequestBody(ex.request?.body));
    let toolLayer;
    if (toolDefs.length) {
      toolLayer = {
        count: toolDefs.length,
        namesSnippet: toolDefs.map((t) => t.name).join(', '),
        schemasPretty: buildToolSchemasPretty(toolDefs),
        title:
          'Die Tool-Definitionen reisen in jedem Request erneut mit — nur dadurch weiß das Modell, welche Tools es anfordern darf.',
        ariaLabel: `Tool-Definitionen: ${toolDefs.length} verfügbar. Enter für die Schemas.`,
      };
    }

    messages.forEach((m, idx) => {
      const isNew = newFlags[idx];
      const role = STACK_ROLES[m.role] || { label: m.role || '?', cls: 'system' };
      const resent = idx < prevSent;
      const toolCall = m.role === 'tool' ? toolCallForResult(messages, m.tool_call_id) : null;
      const layer = {
        exchangeIndex: i,
        msgIndex: idx,
        roleLabel: role.label,
        cssCls: role.cls,
        isNew,
        resent,
        snippet: resent ? 'war schon da' : truncate(layerSnippet(m), 60),
        title: isNew ? STACK_ROLE_HINTS[m.role] || '' : AMNESIA_TOOLTIP,
        ariaLabel: isNew
          ? `Neu in Runde ${i + 1}: ${role.label}. Enter für Volltext.`
          : `${role.label} — war schon da, wird erneut gesendet. Enter für Volltext.`,
        showNewBadge: isNew,
        newBadgeSuffix: m.role === 'tool' ? ' · von App' : '',
      };
      if (toolCall) {
        layer.callLabel = `${toolCall.name || 'tool'}(${truncate(compactArgs(toolCall.arguments), 48)})`;
      }
      layers.push(layer);
    });

    const factorText = i > 0 && approx === prevApprox ? formatFactor(value, prevValue) : '';
    const tipBits = [];
    if (!approx) {
      tipBits.push(`prompt ${r.prompt} Token`);
      if (completion) tipBits.push(`completion ${completion} Token`);
    } else {
      tipBits.push(`≈ ${value} Zeichen (keine usage-Daten)`);
    }
    if (factorText) tipBits.push(factorText.replace('↑ ', ''));

    let responseCard;
    if (errored) {
      responseCard = {
        outLabel: completion ? `out ${completion} Token` : 'out —',
        kind: 'error',
        errorText: ex.cancelled ? 'abgebrochen — kam nicht durch' : 'Fehler — kam nicht durch',
      };
    } else {
      const calls = ex.response?.toolCalls || [];
      const text = (ex.response?.text || '').trim();
      if (calls.length) {
        responseCard = {
          outLabel: completion ? `out ${completion} Token` : 'out —',
          kind: 'json',
          jsonCalls: calls.map(
            (c) => `${c.name || 'tool'}(${truncate(compactArgs(c.arguments), 80)})`
          ),
        };
      } else if (text) {
        responseCard = {
          outLabel: completion ? `out ${completion} Token` : 'out —',
          kind: 'text',
          textSnippet: truncate(text, 220),
        };
      } else {
        responseCard = {
          outLabel: completion ? `out ${completion} Token` : 'out —',
          kind: 'empty',
        };
      }
    }

    const execStrips = [];
    const execCalls = ex.response?.toolCalls || [];
    if (execCalls.length && !errored) {
      const nextRound = i + 1 < rounds.length ? rounds[i + 1] : null;
      const added = nextRound && nextRound.approx === approx ? nextRound.value - value : null;
      for (const c of execCalls) {
        const rawResult = findToolResult(exchanges, c.id, i);
        execStrips.push({
          summaryCall: `${c.name || 'tool'}(${truncate(compactArgs(c.arguments), 60)})`,
          bodyCall: `${c.name || 'tool'}(${truncate(compactArgs(c.arguments), 120)})`,
          resultLabel: `→ Ergebnis von ${c.name || 'tool'}`,
          resultRecorded: rawResult != null,
          resultText: formatExecResultText(rawResult),
          noteText:
            added != null && added > 0 && execCalls.length === 1
              ? `heftet ein · Kontext +${added} ${approx ? 'Zeichen' : 'Token'}`
              : 'heftet das Ergebnis in den Verlauf ein',
        });
      }
    }

    contextRounds.push({
      roundNo: i + 1,
      exchangeIndex: i,
      errored,
      sentInfo:
        `gesendet: ${messages.length} ${messages.length === 1 ? 'Nachricht' : 'Nachrichten'}` +
        (i > 0 && reused > 0 ? ` — davon ${reused} erneut` : ''),
      toolLayer,
      layers,
      bar: {
        widthPct: Math.max(4, Math.round((value / maxValue) * 100)),
        label:
          `${approx ? '≈ ' : ''}${value} ${approx ? 'Zeichen' : 'Token'} gehen rein` +
          (factorText ? ` · ${factorText}` : ''),
        title: tipBits.join(' · '),
      },
      responseCard,
      execStrips,
    });

    prevSent = messages.length;
    prevValue = value;
    prevApprox = approx;
  });

  return {
    metaStat: statBits.join(' · '),
    footText: CONTEXT_FOOT_TEXT,
    rounds: contextRounds,
  };
}

function buildRawLogTurnView({ userText = '', ts, exchanges = [], index } = {}) {
  const exs = Array.isArray(exchanges) ? exchanges : [];
  const normalizedUser = String(userText ?? '').trim();
  const summaryText = truncate(normalizedUser.replace(/\s+/g, ' ').trim(), 80) || '(leer)';
  const count = exs.length;

  let prevSentCount = 0;
  const rounds = exs.map((ex, i) => {
    const vm = buildRoundDetailVm(ex, i + 1, prevSentCount);
    prevSentCount = Array.isArray(ex.messages) ? ex.messages.length : prevSentCount;
    return vm;
  });

  const turn = {
    userText: normalizedUser,
    summaryText,
    ts: Number.isFinite(ts) ? ts : Date.now(),
    exchangeCount: count,
    roundsSummary: `${count} ${count === 1 ? 'Aufruf' : 'Aufrufe'}`,
    contextStack: buildContextStackVm(exs),
    rounds,
  };
  if (typeof index === 'number') turn.index = index;
  return turn;
}

function buildExplanationPrompt(turn) {
  const lines = [];
  lines.push(
    'Du erklaerst einem Entwickler, was bei einer Nutzeranfrage zwischen der Anwendung ' +
      'und dem Sprachmodell HIN UND HER ging. Konzentriere dich auf diesen Austausch: ' +
      'Was schickte die Anwendung jeweils an das Modell, und was lieferte das Modell zurueck?\n\n' +
      'Wichtige Sprachregelung — halte dich exakt daran:\n' +
      '- Das Modell „ruft KEIN Tool auf“ und „fuehrt nichts aus“. Es liefert lediglich Text ' +
      'zurueck — entweder eine Antwort, oder ein JSON-Objekt, das einen gewuenschten ' +
      'Tool-Aufruf BESCHREIBT (Name + Argumente).\n' +
      '- Erst die ANWENDUNG interpretiert dieses JSON, fuehrt das Tool aus und schickt das ' +
      'Ergebnis im naechsten Request als weitere Nachricht ans Modell.\n' +
      '- Jede „Runde“ ist genau ein Request/Response-Paar: Anwendung → Modell und zurueck. ' +
      'Mehrere Runden entstehen, weil das Modell ein Tool-Ergebnis braucht, das die ' +
      'Anwendung erst nachreicht.\n\n' +
      'Erklaere auf Deutsch, knapp und in einfachen Worten, als nummerierte Liste der Runden: ' +
      'pro Runde, was die Anwendung sendete und was das Modell zuruecklieferte, und am Ende, ' +
      'wie das Endergebnis zustande kam. Verwende durchgaengig diese korrekte Formulierung ' +
      '(z. B. „das Modell lieferte ein JSON, das den Tool-Aufruf X beschreibt; die Anwendung ' +
      'fuehrte X aus und sendete das Ergebnis zurueck“).'
  );
  lines.push('');
  lines.push(`Ursprüngliche Anfrage des Nutzers: "${truncate((turn.userText || '').trim(), 500)}"`);
  const exs = Array.isArray(turn.exchanges) ? turn.exchanges : [];
  lines.push(`Anzahl Request/Response-Runden: ${exs.length}`);
  lines.push('');

  exs.forEach((ex, i) => {
    lines.push(`### Runde ${i + 1} (Modell: ${ex.model || 'unbekannt'})`);
    const sent = Array.isArray(ex.messages) ? ex.messages : [];
    if (i === 0) {
      const user = sent.find((m) => m.role === 'user');
      if (user) {
        lines.push(
          `Anwendung → Modell: Nutzereingabe "${truncate(normalizeMessageContent(user.content), 400)}"`
        );
      }
    } else {
      const toolMsgs = sent.filter((m) => m.role === 'tool');
      const lastTool = toolMsgs[toolMsgs.length - 1];
      if (lastTool) {
        lines.push(
          'Anwendung → Modell: Ergebnis des zuvor ausgeführten Tools nachgereicht: ' +
            truncate(normalizeMessageContent(lastTool.content), 600)
        );
      } else {
        lines.push('Anwendung → Modell: bisheriger Gesprächsverlauf erneut gesendet');
      }
    }

    if (ex.error) {
      lines.push(`Modell → Anwendung: Fehler (${ex.error})`);
    }

    const calls = ex.response?.toolCalls || [];
    if (calls.length) {
      for (const c of calls) {
        lines.push(
          `Modell → Anwendung: JSON, das einen Tool-Aufruf beschreibt — ${c.name}(${truncate(compactArgs(c.arguments), 300)}). ` +
            'Ausgeführt wird das von der Anwendung.'
        );
      }
    }
    const text = ex.response?.text || '';
    if (text.trim()) lines.push(`Modell → Anwendung: Text "${truncate(text, 600)}"`);
    lines.push('');
  });

  return lines.join('\n');
}

function extractLastUserText(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role === 'user') return normalizeMessageContent(m.content).trim();
  }
  return '';
}

function enrichSendResult(result, payload) {
  if (!result || !Array.isArray(result.rawExchanges) || result.rawExchanges.length === 0) {
    return result;
  }
  const userText = extractLastUserText(payload?.messages);
  const rawLogTurn = buildRawLogTurnView({
    userText,
    ts: result.rawExchanges[0]?.ts || Date.now(),
    exchanges: result.rawExchanges,
  });
  return attachRawLogTurn(result, rawLogTurn);
}

function resolveExplainIntent(payload) {
  if (Array.isArray(payload?.messages) && payload.messages.length > 0) {
    return { kind: 'messages', messages: payload.messages };
  }
  if (payload?.userText != null && Array.isArray(payload?.exchanges) && payload.exchanges.length > 0) {
    return { kind: 'semantic', userText: payload.userText, exchanges: payload.exchanges };
  }
  if (payload?.rawLogTurn) {
    const turn = payload.rawLogTurn;
    const exchanges = Array.isArray(turn.exchanges) ? turn.exchanges : payload.exchanges;
    if (turn.userText != null && Array.isArray(exchanges) && exchanges.length > 0) {
      return { kind: 'semantic', userText: turn.userText, exchanges };
    }
  }
  return null;
}

function resolveExplainMessages(payload) {
  const intent = resolveExplainIntent(payload);
  if (!intent) return null;
  if (intent.kind === 'messages') return intent.messages;
  const prompt = buildExplanationPrompt({
    userText: intent.userText,
    exchanges: intent.exchanges,
  });
  return [{ role: 'user', content: prompt }];
}

function createRawLogPresentationService() {
  return {
    buildRawLogTurnView,
    buildExplanationPrompt,
    enrichSendResult,
    resolveExplainIntent,
    resolveExplainMessages,
    normalizeMessageContent,
    parseRequestBody,
    extractToolDefs,
    requestToolChoice,
    requestMaxTokens,
    describeFinishReason,
    buildContextStackVm,
    buildRoundDetailVm,
    buildToolSchemasPretty,
    findToolResult,
    formatExecResultText,
  };
}

module.exports = {
  createRawLogPresentationService,
};
