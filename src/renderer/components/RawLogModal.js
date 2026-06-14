/**
 * RAW-LLM-Protokoll: zeigt die LLM-Aufrufe der laufenden Sitzung — gruppiert
 * pro User-Anfrage, damit sichtbar wird, wie viele LLM-Runden eine Anfrage
 * ausgeloest hat und was darin steckt.
 *
 * Die lesbare Sicht (gesendete Konversation + geparste Antwort) liefert der
 * Main provider-unabhaengig; die Rohdaten (provider-spezifischer Body + roher
 * Stream) liegen einklappbar darunter. Roh-Payloads werden nur per textContent
 * gerendert (kein XSS); die LLM-Erklaerung als Markdown via DOMPurify.
 */

import { markdownToSafeHtml } from '../utils/helpers.js';

const ROLE_LABELS = {
  system: 'System',
  user: 'User',
  assistant: 'Assistant',
  tool: 'Tool-Ergebnis',
};

function formatTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function truncate(text, max) {
  const t = String(text ?? '');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// Tool-Argumente bzw. -Ergebnisse huebsch ausgeben, wenn es JSON ist.
function prettyMaybeJson(text) {
  const t = String(text ?? '');
  const trimmed = t.trim();
  if (trimmed && (trimmed[0] === '{' || trimmed[0] === '[')) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      /* kein valides JSON — Rohtext lassen */
    }
  }
  return t;
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

function usageSummary(usage) {
  if (!usage || typeof usage !== 'object') return '';
  const parts = [];
  if (usage.prompt) parts.push(`in ${usage.prompt}`);
  if (usage.completion) parts.push(`out ${usage.completion}`);
  return parts.length ? parts.join(' / ') : '';
}

function copyIconSvg() {
  return (
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
  );
}

// Baut aus einer Anfrage-Gruppe einen kompakten Prompt, den das LLM in Prosa
// erklaeren soll. Inhalte werden gekuerzt, um den Erklaer-Aufruf guenstig zu
// halten.
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

    // Nur das in dieser Runde NEU Hinzugekommene zeigen (System/User-Nachrichten
    // wiederholen sich sonst jede Runde).
    const sent = Array.isArray(ex.messages) ? ex.messages : [];
    if (i === 0) {
      const user = sent.find((m) => m.role === 'user');
      if (user) {
        lines.push(`Anwendung → Modell: Nutzereingabe "${truncate(String(user.content || ''), 400)}"`);
      }
    } else {
      const toolMsgs = sent.filter((m) => m.role === 'tool');
      const lastTool = toolMsgs[toolMsgs.length - 1];
      if (lastTool) {
        lines.push(
          'Anwendung → Modell: Ergebnis des zuvor ausgeführten Tools nachgereicht: ' +
            truncate(String(lastTool.content || ''), 600)
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

// Sucht das Ergebnis eines Tool-Aufrufs (per call_id) in einer der Folge-Runden,
// in der die Anwendung es ans Modell nachreicht.
function findToolResult(exchanges, callId, fromIndex) {
  for (let j = fromIndex + 1; j < exchanges.length; j += 1) {
    const msgs = Array.isArray(exchanges[j].messages) ? exchanges[j].messages : [];
    const hit = msgs.find((m) => m && m.role === 'tool' && m.tool_call_id === callId);
    if (hit) return String(hit.content || '');
  }
  return null;
}

// Findet den zugehörigen tool_call (per id) zu einer Tool-Ergebnis-Nachricht in
// den Assistant-Nachrichten desselben Verlaufs. So bleibt auch in einer Folge-
// Runde erkennbar, zu welchem Aufruf (Name + Argumente) das Ergebnis gehört.
function toolCallForResult(messages, toolCallId) {
  if (!toolCallId) return null;
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!Array.isArray(m.tool_calls)) continue;
    const hit = m.tool_calls.find((tc) => tc && tc.id === toolCallId);
    if (hit) return hit;
  }
  return null;
}

// Parst den rohen Request-Body (JSON-String) einmal zu einem Objekt — Grundlage,
// um die mitgesendeten, sonst versteckten Felder (tools, tool_choice, max_tokens)
// sichtbar zu machen. Gibt null zurück, wenn nichts/Ungültiges vorliegt.
function parseRequestBody(requestBody) {
  if (typeof requestBody !== 'string' || !requestBody) return null;
  try {
    const obj = JSON.parse(requestBody);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

// Liest die Tool-Definitionen aus dem geparsten Request-Body (Feld `tools`). Sie
// reisen in JEDEM Request als eigenes Feld mit (nicht als Nachricht) — nur so
// weiß das Modell, welche Tools es anfordern darf. Die Schema-Form ist
// provider-spezifisch; dieser Parser deckt alle hier genutzten Formen ab:
//  - Anthropic / OpenAI-Responses:  { name, description, input_schema|parameters }
//  - OpenAI-ChatCompletions / Ollama / MLX:  { type:'function', function:{ name, … } }
//  - Google:  { functionDeclarations: [ { name, … } ] }
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
    } else if (t.name) {
      defs.push({ name: t.name, schema: t });
    }
  }
  return defs;
}

// Tool-Wahl-Modus aus dem Body (OpenAI/MLX setzen `tool_choice:'auto'`). Leer,
// wenn der Provider nichts sendet.
function requestToolChoice(body) {
  const tc = body && body.tool_choice;
  if (typeof tc === 'string') return tc;
  if (tc && typeof tc === 'object') return tc.type || 'spezifisch';
  return '';
}

// Output-Limit aus dem Body — provider-spezifische Feldnamen.
function requestMaxTokens(body) {
  if (!body) return null;
  const cand = body.max_tokens ?? body.max_output_tokens ?? body.generationConfig?.maxOutputTokens;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Übersetzt den (provider-spezifischen) Abschlussgrund in eine verständliche
// Aussage + Kategorie (tool = treibt eine weitere Runde, done = fertig,
// warn = abgeschnitten/gestoppt).
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

// Rollen-Konfiguration für die Schichten des Kontext-Stapels: Anzeigename und
// CSS-Klassen-Suffix (das die Rollenfarbe trägt). Reihenfolge entspricht der
// üblichen Verlaufsstruktur System → Nutzer → Modell-JSON → Tool-Ergebnis.
const STACK_ROLES = {
  system: { label: 'System', cls: 'system' },
  user: { label: 'Nutzer', cls: 'user' },
  assistant: { label: 'Modell-JSON', cls: 'model' },
  tool: { label: 'Tool-Erg.', cls: 'tool' },
};

// Knapper Lehrsatz je Schicht-Typ (Didaktik ohne Klick-Overhead) — als Tooltip
// an NEUEN Schichten. Alte Schichten tragen stattdessen den Amnesie-Tooltip.
const STACK_ROLE_HINTS = {
  system: 'Systemprompt — legt Rolle und Regeln des Modells fest.',
  user: 'Die ursprüngliche Eingabe des Nutzers.',
  assistant: 'JSON-Tool-Wunsch des Modells — die Datei ist damit NICHT gelesen.',
  tool: 'Die ANWENDUNG hat das Tool ausgeführt und reicht das Ergebnis nach.',
};

const AMNESIA_TOOLTIP =
  'Das Modell erinnert sich an nichts — darum reist jedes Mal alles erneut mit.';

// Kurzes Snippet einer gesendeten Nachricht für die Schicht-Zeile.
function layerSnippet(m) {
  const content = String(m.content || '').replace(/\s+/g, ' ').trim();
  if (content) return content;
  if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
    return m.tool_calls.map((tc) => `${tc.name || 'tool'}(${compactArgs(tc.arguments)})`).join(', ');
  }
  return '';
}

// Zeichen-Schätzung des gesendeten Verlaufs — Fallback für den Token-Balken,
// wenn keine usage-Daten vorliegen (lokale Modelle, Fehlerrunden).
function sumCharLen(messages) {
  let n = 0;
  for (const m of Array.isArray(messages) ? messages : []) {
    n += String(m.content || '').length;
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) n += String(tc.name || '').length + String(tc.arguments || '').length;
    }
  }
  return n;
}

// Faktor „↑ x,x×" gegenüber der Vorrunde (deutsche Dezimalschreibweise).
function formatFactor(cur, prev) {
  if (!prev) return '';
  const f = cur / prev;
  if (!Number.isFinite(f) || f <= 1) return '';
  return `↑ ${f.toFixed(1).replace('.', ',')}× ggü. Vorrunde`;
}

// Roher Request + Response-Stream einer Runde fürs Clipboard (wie übertragen).
function formatRoundRawForClipboard(ex, roundNo) {
  const parts = [];
  parts.push(`=== Runde ${roundNo} · REQUEST (roh) ===`);

  const req = ex.request || {};
  const reqLines = [];
  if (req.method || req.url) reqLines.push(`${req.method || 'POST'} ${req.url || ''}`.trim());
  if (req.headers && typeof req.headers === 'object') {
    for (const [k, v] of Object.entries(req.headers)) reqLines.push(`${k}: ${v}`);
  }
  if (reqLines.length) parts.push(reqLines.join('\n'));
  if (typeof req.body === 'string' && req.body) {
    parts.push('');
    parts.push(req.body);
  }
  if (!reqLines.length && !req.body) parts.push('(kein Request protokolliert)');

  parts.push('');
  parts.push(`=== Runde ${roundNo} · RESPONSE (roh) ===`);
  parts.push(ex.responseRaw || '(leer)');

  return parts.join('\n');
}

export function initRawLogModal({ api, appStore }) {
  const modal = document.getElementById('modal-raw-log');
  const backdrop = document.getElementById('modal-raw-log-backdrop');
  const btnOpen = document.getElementById('btn-raw-log');
  const btnCloseX = document.getElementById('btn-raw-log-close');
  const btnFooterClose = document.getElementById('btn-raw-log-footer-close');
  const listEl = document.getElementById('raw-log-list');
  const emptyEl = document.getElementById('raw-log-empty');
  const countEl = document.getElementById('raw-log-count');
  const badgeEl = document.getElementById('raw-log-badge');

  if (!modal || !btnOpen) {
    return { openRawLogModal() {}, closeRawLogModal() {}, syncBadge() {} };
  }

  function turns() {
    return Array.isArray(appStore.rawLlmLog) ? appStore.rawLlmLog : [];
  }

  function totalCalls() {
    return turns().reduce((sum, t) => sum + (Array.isArray(t.exchanges) ? t.exchanges.length : 0), 0);
  }

  function syncBadge() {
    const calls = totalCalls();
    if (badgeEl) {
      badgeEl.textContent = String(calls);
      badgeEl.classList.toggle('hidden', calls === 0);
    }
    if (countEl) {
      const nTurns = turns().length;
      countEl.textContent =
        `${calls} ${calls === 1 ? 'Aufruf' : 'Aufrufe'} · ` +
        `${nTurns} ${nTurns === 1 ? 'Anfrage' : 'Anfragen'}`;
    }
  }

  function buildPre(text, extraClass) {
    const pre = document.createElement('pre');
    pre.className = extraClass ? `raw-log-pre ${extraClass}` : 'raw-log-pre';
    pre.textContent = text || '';
    return pre;
  }

  function makeCopyButton(getText, label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'raw-log-copy';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = copyIconSvg();
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const text = getText() || '';
      let ok = false;
      try {
        if (typeof api.writeClipboardText === 'function') {
          api.writeClipboardText(text);
          ok = true;
        } else if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          ok = true;
        }
      } catch {
        /* Fallback unten */
      }
      if (!ok) {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          ok = document.execCommand('copy');
          document.body.removeChild(ta);
        } catch {
          ok = false;
        }
      }
      if (ok) {
        btn.classList.add('raw-log-copy--ok');
        setTimeout(() => btn.classList.remove('raw-log-copy--ok'), 1200);
      }
    });
    return btn;
  }

  function sectionLabel(text) {
    const el = document.createElement('div');
    el.className = 'raw-log-section-title';
    el.textContent = text;
    return el;
  }

  // Eine gesendete Nachricht (System/User/Assistant/Tool) als kompakter Block.
  function buildMessageBlock(m) {
    const block = document.createElement('div');
    block.className = `raw-log-msg raw-log-msg--${m.role || 'unknown'}`;

    const chip = document.createElement('span');
    chip.className = 'raw-log-role';
    chip.textContent = ROLE_LABELS[m.role] || m.role || '?';
    block.appendChild(chip);

    const text = typeof m.content === 'string' ? m.content : '';
    if (text.trim()) {
      block.appendChild(buildPre(prettyMaybeJson(text), 'raw-log-pre--inline'));
    }

    if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
      for (const tc of m.tool_calls) {
        const line = document.createElement('div');
        line.className = 'raw-log-toolcall';
        const args = compactArgs(tc.arguments);
        line.textContent = `→ ${tc.name || 'tool'}(${truncate(args, 200)})`;
        block.appendChild(line);
      }
    }
    return block;
  }

  function roundOutcome(ex) {
    if (ex.error) return 'Fehler';
    if (ex.cancelled) return 'abgebrochen';
    const calls = ex.response?.toolCalls || [];
    if (calls.length) return `→ ${calls.map((c) => c.name || 'tool').join(', ')}`;
    if (ex.response?.text?.trim()) return 'Text-Antwort';
    return '—';
  }

  // Ein einzelner LLM-Aufruf (Runde) — Volltext, Rohdaten und Stream als Drilldown.
  function buildRound(ex, roundNo, prevSentCount = 0) {
    const det = document.createElement('details');
    det.className = 'raw-log-round';
    if (ex.error || ex.cancelled) det.classList.add('raw-log-round--error');
    det.open = false;

    const summary = document.createElement('summary');
    summary.className = 'raw-log-round-summary';

    const tag = document.createElement('span');
    tag.className = 'raw-log-round-tag';
    tag.textContent = `Runde ${roundNo}`;

    const mid = document.createElement('span');
    mid.className = 'raw-log-round-mid';
    mid.textContent = roundOutcome(ex);

    const meta = document.createElement('span');
    meta.className = 'raw-log-round-meta';
    const bits = [];
    if (ex.model) bits.push(ex.model);
    const u = usageSummary(ex.usage);
    if (u) bits.push(u);
    if (ex.ts) bits.push(formatTime(ex.ts));
    meta.textContent = bits.join('  ·  ');

    summary.appendChild(tag);
    summary.appendChild(mid);
    summary.appendChild(meta);
    det.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'raw-log-round-body';

    const sent = Array.isArray(ex.messages) ? ex.messages : [];
    const newMsgs = (prevSentCount > 0 ? sent.slice(prevSentCount) : sent).filter(
      (m) => m && m.role !== 'assistant'
    );

    const sentHead = document.createElement('div');
    sentHead.className = 'raw-log-section-head';
    sentHead.appendChild(
      sectionLabel(prevSentCount > 0 ? 'Anwendung → Modell (neu in dieser Runde)' : 'Anwendung → Modell')
    );
    body.appendChild(sentHead);

    if (newMsgs.length) {
      const msgs = document.createElement('div');
      msgs.className = 'raw-log-msgs';
      for (const m of newMsgs) msgs.appendChild(buildMessageBlock(m));
      body.appendChild(msgs);
    } else {
      const none = document.createElement('p');
      none.className = 'raw-log-muted';
      none.textContent = 'Bisheriger Gesprächsverlauf erneut gesendet (nichts Neues).';
      body.appendChild(none);
    }

    if (prevSentCount > 0 && sent.length) {
      const allDet = document.createElement('details');
      allDet.className = 'raw-log-sub';
      const allSum = document.createElement('summary');
      allSum.textContent = `Ganzer gesendeter Verlauf · ${sent.length} ${sent.length === 1 ? 'Nachricht' : 'Nachrichten'}`;
      allDet.appendChild(allSum);
      const allMsgs = document.createElement('div');
      allMsgs.className = 'raw-log-msgs';
      for (const m of sent) allMsgs.appendChild(buildMessageBlock(m));
      allDet.appendChild(allMsgs);
      body.appendChild(allDet);
    }

    if (ex.error) {
      const err = document.createElement('p');
      err.className = 'raw-log-error';
      err.textContent = `Fehler: ${ex.error}`;
      body.appendChild(err);
    }

    const ansHead = document.createElement('div');
    ansHead.className = 'raw-log-section-head';
    ansHead.appendChild(sectionLabel('Modell → Anwendung (Antwort)'));
    const ansText = ex.response?.text || '';
    const ansCalls = ex.response?.toolCalls || [];
    ansHead.appendChild(
      makeCopyButton(
        () =>
          [ansText, ...ansCalls.map((c) => `${c.name}(${compactArgs(c.arguments)})`)]
            .filter(Boolean)
            .join('\n'),
        'Antwort kopieren'
      )
    );
    body.appendChild(ansHead);

    if (ansText.trim()) body.appendChild(buildPre(ansText));
    if (ansCalls.length) {
      const hint = document.createElement('p');
      hint.className = 'raw-log-muted';
      hint.textContent =
        'Das Modell lieferte JSON, das diese Tool-Aufrufe beschreibt — ausgeführt werden sie von der Anwendung:';
      body.appendChild(hint);
      for (const c of ansCalls) {
        const wrap = document.createElement('div');
        wrap.className = 'raw-log-toolcall raw-log-toolcall--out';
        const name = document.createElement('span');
        name.className = 'raw-log-toolcall-name';
        name.textContent = `→ ${c.name || 'tool'}`;
        wrap.appendChild(name);
        const pretty = prettyMaybeJson(c.arguments);
        if (pretty.trim()) wrap.appendChild(buildPre(pretty, 'raw-log-pre--inline'));
        body.appendChild(wrap);
      }
    }
    if (!ansText.trim() && !ansCalls.length && !ex.error && !ex.cancelled) {
      const none = document.createElement('p');
      none.className = 'raw-log-muted';
      none.textContent = '(keine Antwort)';
      body.appendChild(none);
    }
    if (ex.cancelled && !ex.error) {
      const cancelled = document.createElement('p');
      cancelled.className = 'raw-log-error';
      cancelled.textContent = 'Abgebrochen — kam nicht durch';
      body.appendChild(cancelled);
    }

    // Abschlussgrund — nur die Warnfälle (abgeschnitten / Safety-Filter) sind
    // eigenständig wichtig; „stop" und „tool_calls" verrät bereits roundOutcome.
    const finish = describeFinishReason(ex.finishReason, ansCalls.length > 0);
    if (finish && finish.kind === 'warn' && !ex.error && !ex.cancelled) {
      const warn = document.createElement('p');
      warn.className = 'raw-log-error';
      warn.textContent = `⚠ ${finish.text}`;
      body.appendChild(warn);
    }

    const req = ex.request || {};
    const reqLines = [];
    if (req.method || req.url) reqLines.push(`${req.method || 'POST'} ${req.url || ''}`.trim());
    if (req.headers && typeof req.headers === 'object') {
      for (const [k, v] of Object.entries(req.headers)) reqLines.push(`${k}: ${v}`);
    }
    const rawReq = [reqLines.join('\n'), typeof req.body === 'string' ? req.body : '']
      .filter(Boolean)
      .join('\n\n');
    const rawResp = ex.responseRaw || '';
    if (rawReq || rawResp) {
      const rawDet = document.createElement('details');
      rawDet.className = 'raw-log-sub';
      const rawSum = document.createElement('summary');
      rawSum.textContent = 'Rohdaten (Request / Stream)';
      rawDet.appendChild(rawSum);

      if (rawReq) {
        const h = document.createElement('div');
        h.className = 'raw-log-section-head';
        h.appendChild(sectionLabel('Request (roh)'));
        h.appendChild(makeCopyButton(() => rawReq, 'Request kopieren'));
        rawDet.appendChild(h);
        // Steuerparameter aus dem Body hervorheben (sonst gehen sie im JSON unter).
        const reqBody = parseRequestBody(req.body);
        const reqBits = [];
        const toolChoice = requestToolChoice(reqBody);
        if (toolChoice) reqBits.push(`tool_choice: ${toolChoice}`);
        const maxTokens = requestMaxTokens(reqBody);
        if (maxTokens) reqBits.push(`max_tokens: ${maxTokens}`);
        if (reqBits.length) {
          const params = document.createElement('p');
          params.className = 'raw-log-muted';
          params.textContent = reqBits.join('  ·  ');
          rawDet.appendChild(params);
        }
        rawDet.appendChild(buildPre(rawReq));
      }
      const h2 = document.createElement('div');
      h2.className = 'raw-log-section-head';
      h2.appendChild(sectionLabel('Antwort-Stream (roh)'));
      h2.appendChild(makeCopyButton(() => rawResp, 'Stream kopieren'));
      rawDet.appendChild(h2);
      rawDet.appendChild(buildPre(rawResp || '(leer)'));

      body.appendChild(rawDet);
    }

    det.appendChild(body);
    return det;
  }

  function sparkleSvg() {
    return (
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>' +
      '<path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>'
    );
  }

  // Bittet das aktive LLM, den Ablauf dieser Anfrage zu erklaeren. Einmal-Aufruf
  // ohne Workspace/Tools; landet bewusst NICHT im RAW-Protokoll selbst.
  async function runExplanation(turn, btn, labelEl, outEl) {
    if (turn.__explaining) return;
    turn.__explaining = true;
    btn.disabled = true;
    const labelBefore = labelEl.textContent;
    labelEl.textContent = 'Erkläre …';
    outEl.classList.remove('hidden');
    outEl.classList.add('raw-log-explain--loading');
    outEl.textContent = 'Das Modell erklärt diesen Durchlauf …';
    try {
      const prompt = buildExplanationPrompt(turn);
      const result = await api.explainChat([{ role: 'user', content: prompt }]);
      outEl.classList.remove('raw-log-explain--loading');
      if (result?.error) {
        turn.explanation = null;
        outEl.classList.add('raw-log-explain--error');
        outEl.textContent = `Erklärung fehlgeschlagen: ${result.error}`;
        return;
      }
      const text = (result?.content || '').trim() || '(leere Antwort)';
      turn.explanation = text;
      outEl.classList.remove('raw-log-explain--error');
      outEl.innerHTML = markdownToSafeHtml(text);
    } catch (err) {
      outEl.classList.remove('raw-log-explain--loading');
      outEl.classList.add('raw-log-explain--error');
      outEl.textContent = `Erklärung fehlgeschlagen: ${err?.message || 'Unbekannter Fehler'}`;
    } finally {
      turn.__explaining = false;
      btn.disabled = false;
      labelEl.textContent = labelBefore;
    }
  }

  function plusIconSvg() {
    return (
      '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M12 5v14M5 12h14"/></svg>'
    );
  }

  function checkIconSvg() {
    return (
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M20 6L9 17l-5-5"/></svg>'
    );
  }

  // Vertikaler Kontext-Schichtstapel einer Anfrage: zeigt pro Runde den komplett
  // erneut gesendeten Verlauf als Schicht-Stapel (alte Schichten grau, neue
  // farbig + „neu"), einen wachsenden Gesamt-Token-Balken und eine bewusst
  // schmale Modell-Antwort-Karte rechts (rein ≫ raus). Zwischen den Runden liegt
  // der „Anwendung führt aus"-Streifen (kein Modell-Element).
  function buildContextStack(turn) {
    const wrap = document.createElement('div');
    wrap.className = 'cstack';
    const exchanges = Array.isArray(turn.exchanges) ? turn.exchanges : [];
    if (!exchanges.length) return wrap;

    // Pro Runde den „rein"-Wert ermitteln: usage.prompt exakt, sonst ≈ Zeichen
    // der gesendeten Nachrichten (lokale Modelle / Fehlerrunden ohne usage).
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
    // „rein"-Werte sind nur vergleichbar, wenn alle Runden dieselbe Einheit
    // benutzen — entweder durchgängig Token (usage) oder durchgängig ≈ Zeichen.
    // Mischt sich das (z. B. erste Runde mit usage, spätere Fehlerrunde ohne),
    // darf weder die Wachstums-Statistik noch eine Pro-Runden-Zunahme über die
    // Einheiten hinweg rechnen — sonst stünde Token gegen Zeichen.
    const unitsConsistent = rounds.every((r) => r.approx === first.approx);
    const unitOf = (r) => (r.approx ? 'Zeichen' : 'Token');
    const toolCount = exchanges.reduce((s, ex) => s + (ex.response?.toolCalls?.length || 0), 0);

    // — Meta-/Steuerzeile —
    const meta = document.createElement('div');
    meta.className = 'cstack-meta';
    const stat = document.createElement('div');
    stat.className = 'cstack-meta-stat';
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
    stat.textContent = statBits.join(' · ');
    meta.appendChild(stat);

    const toggle = document.createElement('label');
    toggle.className = 'cstack-toggle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.addEventListener('change', () => wrap.classList.toggle('cstack--new-only', cb.checked));
    toggle.appendChild(cb);
    const tlabel = document.createElement('span');
    tlabel.textContent = 'nur Neues zeigen';
    toggle.appendChild(tlabel);
    meta.appendChild(toggle);
    wrap.appendChild(meta);

    // — Legende der Schicht-Farben —
    const legend = document.createElement('div');
    legend.className = 'cstack-legend';
    for (const [cls, label] of [
      ['system', 'System'],
      ['tools', 'Tools'],
      ['user', 'Nutzer'],
      ['model', 'Modell'],
      ['tool', 'Tool-Erg.'],
      ['new', 'neu in dieser Runde'],
    ]) {
      const item = document.createElement('span');
      item.className = 'cstack-legend-item';
      const sw = document.createElement('i');
      sw.className = `cstack-sw cstack-sw--${cls}`;
      item.appendChild(sw);
      item.appendChild(document.createTextNode(label));
      legend.appendChild(item);
    }
    wrap.appendChild(legend);

    // Hover über eine Schicht hebt dieselbe Nachricht (gleicher Schlüssel) in
    // allen Runden hervor — „dieselbe Nachricht, erneut geschickt".
    function highlightIndex(key, on) {
      wrap
        .querySelectorAll(`.cstack-layer[data-msg-index="${key}"]`)
        .forEach((el) => el.classList.toggle('cstack-layer--hl', on));
    }

    // Macht eine Schicht per Klick/Tastatur zum Volltext-Drilldown auf- und
    // zuklappbar und verknüpft Hover mit der runden-übergreifenden Hervorhebung.
    function wireLayer(layer, full) {
      function toggleFull() {
        const nowHidden = full.classList.toggle('hidden');
        layer.classList.toggle('cstack-layer--open', !nowHidden);
      }
      layer.addEventListener('click', toggleFull);
      layer.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleFull();
        }
      });
      const key = layer.dataset.msgIndex;
      layer.addEventListener('mouseenter', () => highlightIndex(key, true));
      layer.addEventListener('mouseleave', () => highlightIndex(key, false));
    }

    // — Runden-Blöcke (vertikal gestapelt) —
    let prevSent = 0;
    let prevValue = 0;
    let prevApprox = first.approx;
    rounds.forEach((r, i) => {
      const { ex, messages, value, approx, completion } = r;
      const errored = !!(ex.error || ex.cancelled);

      const block = document.createElement('div');
      block.className = 'cstack-round';
      if (errored) block.classList.add('cstack-round--error');

      const head = document.createElement('div');
      head.className = 'cstack-round-head';
      const tag = document.createElement('span');
      tag.className = 'cstack-round-tag';
      tag.textContent = `Runde ${i + 1}`;
      // Genuin „neu" ist nur, was die ANWENDUNG in dieser Runde beisteuert:
      // die Nutzereingabe (Runde 1) bzw. Tool-Ergebnisse. System ist der
      // ewige Sockel, Assistant-Nachrichten sind Echos früherer Modell-
      // Antworten — beide kehren als grauer Sockel wieder.
      const newFlags = messages.map(
        (m, idx) => m.role !== 'system' && m.role !== 'assistant' && idx >= prevSent
      );
      const newCount = newFlags.filter(Boolean).length;

      const sentInfo = document.createElement('span');
      sentInfo.className = 'cstack-round-sent';
      const reused = messages.length - newCount;
      sentInfo.textContent =
        `gesendet: ${messages.length} ${messages.length === 1 ? 'Nachricht' : 'Nachrichten'}` +
        (i > 0 && reused > 0 ? ` — davon ${reused} erneut` : '');
      head.appendChild(tag);
      const headRight = document.createElement('div');
      headRight.className = 'cstack-round-head-right';
      headRight.appendChild(sentInfo);
      headRight.appendChild(
        makeCopyButton(() => formatRoundRawForClipboard(ex, i + 1), `Runde ${i + 1} Rohdaten kopieren`)
      );
      head.appendChild(headRight);
      block.appendChild(head);

      const cols = document.createElement('div');
      cols.className = 'cstack-round-cols';

      // Links: Schicht-Stapel + Gesamt-Balken
      const left = document.createElement('div');
      left.className = 'cstack-sent';
      const layers = document.createElement('div');
      layers.className = 'cstack-layers';

      // Tool-Definitionen reisen als eigenes Request-Feld (body.tools) in JEDER
      // Runde mit — keine Nachricht, aber Teil dessen, was „rein" geht. Eine
      // dauerhaft graue Schicht ganz oben (Teil des Sockels, kehrt jede Runde
      // wieder); klickbar zum Aufklappen der vollen Schemas.
      const toolDefs = extractToolDefs(parseRequestBody(ex.request?.body));
      if (toolDefs.length) {
        const tLayer = document.createElement('div');
        tLayer.className = 'cstack-layer cstack-layer--tools is-old';
        tLayer.dataset.msgIndex = 'tools';
        tLayer.tabIndex = 0;
        tLayer.setAttribute('role', 'button');
        tLayer.title =
          'Die Tool-Definitionen reisen in jedem Request erneut mit — nur dadurch weiß das Modell, welche Tools es anfordern darf.';
        tLayer.setAttribute('aria-label', `Tool-Definitionen: ${toolDefs.length} verfügbar. Enter für die Schemas.`);

        const tRole = document.createElement('span');
        tRole.className = 'cstack-layer-role';
        tRole.textContent = 'Tools';
        tLayer.appendChild(tRole);

        const tCount = document.createElement('span');
        tCount.className = 'cstack-layer-role cstack-layer-call';
        tCount.textContent = `${toolDefs.length} ${toolDefs.length === 1 ? 'Definition' : 'Definitionen'}`;
        tLayer.appendChild(tCount);

        const tSnip = document.createElement('span');
        tSnip.className = 'cstack-layer-snippet';
        tSnip.textContent = toolDefs.map((t) => t.name).join(', ');
        tLayer.appendChild(tSnip);

        const tFull = document.createElement('div');
        tFull.className = 'cstack-layer-full hidden';
        tFull.appendChild(buildPre(JSON.stringify(toolDefs.map((t) => t.schema), null, 2)));
        tLayer.appendChild(tFull);

        wireLayer(tLayer, tFull);
        layers.appendChild(tLayer);
      }

      messages.forEach((m, idx) => {
        const isNew = newFlags[idx];
        const role = STACK_ROLES[m.role] || { label: m.role || '?', cls: 'system' };
        const layer = document.createElement('div');
        layer.className = `cstack-layer cstack-layer--${role.cls} ${isNew ? 'is-new' : 'is-old'}`;
        layer.dataset.msgIndex = String(idx);
        layer.tabIndex = 0;
        layer.setAttribute('role', 'button');

        const roleEl = document.createElement('span');
        roleEl.className = 'cstack-layer-role';
        roleEl.textContent = role.label;
        layer.appendChild(roleEl);

        // Bei Tool-Ergebnissen den zugehörigen Aufruf (Name + Parameter) im
        // gleichen Stil hinter „Tool-Erg." setzen, damit erkennbar bleibt, zu
        // welchem Aufruf das Ergebnis gehört — auch als grauer Sockel in einer
        // Folge-Runde. Lange Parameter werden gekürzt.
        const toolCall = m.role === 'tool' ? toolCallForResult(messages, m.tool_call_id) : null;
        if (toolCall) {
          const callEl = document.createElement('span');
          callEl.className = 'cstack-layer-role cstack-layer-call';
          callEl.textContent = `${toolCall.name || 'tool'}(${truncate(compactArgs(toolCall.arguments), 48)})`;
          layer.appendChild(callEl);
        }

        // „war schon da" nur, wenn die Nachricht in einer FRÜHEREN Runde bereits
        // mitgesendet wurde. In Runde 1 (und beim erstmaligen Echo der Modell-
        // Antwort) zeigt auch eine graue Schicht ihren echten Inhalt.
        const resent = idx < prevSent;
        const snip = document.createElement('span');
        snip.className = 'cstack-layer-snippet';
        snip.textContent = resent ? 'war schon da' : truncate(layerSnippet(m), 60);
        layer.appendChild(snip);

        if (isNew) {
          const badge = document.createElement('span');
          badge.className = 'cstack-layer-badge';
          badge.innerHTML = `${plusIconSvg()}<span>neu${m.role === 'tool' ? ' · von App' : ''}</span>`;
          layer.appendChild(badge);
          layer.title = STACK_ROLE_HINTS[m.role] || '';
          layer.setAttribute('aria-label', `Neu in Runde ${i + 1}: ${role.label}. Enter für Volltext.`);
        } else {
          layer.title = AMNESIA_TOOLTIP;
          layer.setAttribute(
            'aria-label',
            `${role.label} — war schon da, wird erneut gesendet. Enter für Volltext.`
          );
        }

        // Volltext-Drilldown beim Klick.
        const full = document.createElement('div');
        full.className = 'cstack-layer-full hidden';
        full.appendChild(buildMessageBlock(m));
        layer.appendChild(full);

        wireLayer(layer, full);
        layers.appendChild(layer);
      });
      left.appendChild(layers);

      const bar = document.createElement('div');
      bar.className = 'cstack-bar';
      // Wachstumsfaktor nur, wenn die Vorrunde dieselbe Einheit hatte.
      const factorText = i > 0 && approx === prevApprox ? formatFactor(value, prevValue) : '';
      const tipBits = [];
      if (!approx) {
        tipBits.push(`prompt ${r.prompt} Token`);
        if (completion) tipBits.push(`completion ${completion} Token`);
      } else {
        tipBits.push(`≈ ${value} Zeichen (keine usage-Daten)`);
      }
      if (factorText) tipBits.push(factorText.replace('↑ ', ''));
      bar.title = tipBits.join(' · ');
      const track = document.createElement('div');
      track.className = 'cstack-bar-track';
      const fill = document.createElement('div');
      fill.className = 'cstack-bar-fill';
      fill.style.width = `${Math.max(4, Math.round((value / maxValue) * 100))}%`;
      track.appendChild(fill);
      bar.appendChild(track);
      const barLabel = document.createElement('div');
      barLabel.className = 'cstack-bar-label';
      barLabel.textContent =
        `${approx ? '≈ ' : ''}${value} ${approx ? 'Zeichen' : 'Token'} gehen rein` +
        (factorText ? ` · ${factorText}` : '');
      bar.appendChild(barLabel);
      left.appendChild(bar);
      cols.appendChild(left);

      // Rechts: schmale Modell-Antwort-Karte (rein ≫ raus).
      const right = document.createElement('div');
      right.className = 'cstack-resp';
      const card = document.createElement('div');
      card.className = 'cstack-resp-card';
      if (errored) card.classList.add('cstack-resp-card--error');
      const rHead = document.createElement('div');
      rHead.className = 'cstack-resp-head';
      rHead.textContent = 'Modell → Anwendung';
      card.appendChild(rHead);

      const outEl = document.createElement('div');
      outEl.className = 'cstack-resp-out';
      outEl.textContent = completion ? `out ${completion} Token` : 'out —';
      card.appendChild(outEl);

      if (errored) {
        const e = document.createElement('div');
        e.className = 'cstack-resp-kind cstack-resp-kind--error';
        e.textContent = ex.cancelled ? 'abgebrochen — kam nicht durch' : 'Fehler — kam nicht durch';
        card.appendChild(e);
      } else {
        const calls = ex.response?.toolCalls || [];
        const text = (ex.response?.text || '').trim();
        if (calls.length) {
          const k = document.createElement('div');
          k.className = 'cstack-resp-kind';
          k.textContent = 'JSON, KEIN Text:';
          card.appendChild(k);
          for (const c of calls) {
            const code = document.createElement('code');
            code.className = 'cstack-resp-call';
            code.textContent = `${c.name || 'tool'}(${truncate(compactArgs(c.arguments), 80)})`;
            card.appendChild(code);
          }
        } else if (text) {
          const k = document.createElement('div');
          k.className = 'cstack-resp-kind cstack-resp-kind--text';
          k.innerHTML = `${checkIconSvg()}<span>Text</span>`;
          card.appendChild(k);
          const t = document.createElement('div');
          t.className = 'cstack-resp-text';
          t.textContent = truncate(text, 220);
          card.appendChild(t);
        } else {
          const k = document.createElement('div');
          k.className = 'cstack-resp-kind';
          k.textContent = '(keine Antwort)';
          card.appendChild(k);
        }
      }
      right.appendChild(card);
      cols.appendChild(right);
      block.appendChild(cols);
      wrap.appendChild(block);

      // — „Anwendung führt aus"-Streifen zwischen den Runden —
      const execCalls = ex.response?.toolCalls || [];
      if (execCalls.length && !errored) {
        // Zunahme nur ausweisen, wenn die Folge-Runde dieselbe Einheit nutzt —
        // sonst verglichen wir Token gegen Zeichen.
        const nextRound = i + 1 < rounds.length ? rounds[i + 1] : null;
        const added = nextRound && nextRound.approx === approx ? nextRound.value - value : null;
        execCalls.forEach((c) => {
          const exec = document.createElement('details');
          exec.className = 'cstack-exec';
          const sum = document.createElement('summary');
          sum.className = 'cstack-exec-summary';
          const callLabel = `${c.name || 'tool'}(${truncate(compactArgs(c.arguments), 60)})`;
          const callEl = document.createElement('code');
          callEl.className = 'cstack-exec-summary-call';
          callEl.textContent = callLabel;
          sum.appendChild(callEl);
          sum.appendChild(document.createTextNode(' — Klick für Ergebnis'));
          exec.appendChild(sum);
          const body = document.createElement('div');
          body.className = 'cstack-exec-body';
          const call = document.createElement('code');
          call.className = 'cstack-exec-call';
          call.textContent = `${c.name || 'tool'}(${truncate(compactArgs(c.arguments), 120)})`;
          body.appendChild(call);
          const result = findToolResult(exchanges, c.id, i);
          const resultLabel = document.createElement('div');
          resultLabel.className = 'cstack-exec-result-label';
          resultLabel.textContent = `→ Ergebnis von ${c.name || 'tool'}`;
          body.appendChild(resultLabel);
          const pre = document.createElement('pre');
          pre.className = 'cstack-exec-result';
          pre.textContent = result == null ? '(nicht protokolliert)' : truncate(prettyMaybeJson(result), 600);
          body.appendChild(pre);
          const note = document.createElement('div');
          note.className = 'cstack-exec-note';
          note.textContent =
            added != null && added > 0 && execCalls.length === 1
              ? `heftet ein · Kontext +${added} ${approx ? 'Zeichen' : 'Token'}`
              : 'heftet das Ergebnis in den Verlauf ein';
          body.appendChild(note);
          exec.appendChild(body);
          wrap.appendChild(exec);
        });
      }

      prevSent = messages.length;
      prevValue = value;
      prevApprox = approx;
    });

    // — Fuß —
    const foot = document.createElement('p');
    foot.className = 'cstack-foot';
    foot.textContent = 'Der graue Sockel kehrt jede Runde wieder — die LLM-API ist zustandslos.';
    wrap.appendChild(foot);

    return wrap;
  }

  function buildTurn(turn, isLatest) {
    const det = document.createElement('details');
    det.className = 'raw-log-turn';
    det.open = isLatest;

    const summary = document.createElement('summary');
    summary.className = 'raw-log-turn-summary';

    const idx = document.createElement('span');
    idx.className = 'raw-log-turn-idx';
    idx.textContent = `Anfrage ${turn.index}`;

    const txt = document.createElement('span');
    txt.className = 'raw-log-turn-text';
    txt.textContent = truncate((turn.userText || '').replace(/\s+/g, ' ').trim(), 80) || '(leer)';

    const count = document.createElement('span');
    count.className = 'raw-log-turn-count';
    const n = Array.isArray(turn.exchanges) ? turn.exchanges.length : 0;
    count.textContent = `${n} ${n === 1 ? 'Aufruf' : 'Aufrufe'}`;

    summary.appendChild(idx);
    summary.appendChild(txt);
    summary.appendChild(count);
    det.appendChild(summary);

    // Erklär-Leiste + Ergebnisbereich.
    const tools = document.createElement('div');
    tools.className = 'raw-log-turn-tools';
    const explainBtn = document.createElement('button');
    explainBtn.type = 'button';
    explainBtn.className = 'raw-log-explain-btn';
    explainBtn.title = 'Das aktive Modell erklären lassen, was in dieser Anfrage ablief';
    explainBtn.innerHTML = `${sparkleSvg()}<span class="raw-log-explain-label">Ablauf erklären</span>`;
    tools.appendChild(explainBtn);
    det.appendChild(tools);

    const out = document.createElement('div');
    out.className = 'raw-log-explain hidden';
    if (turn.explanation) {
      out.classList.remove('hidden');
      out.innerHTML = markdownToSafeHtml(turn.explanation);
    }
    det.appendChild(out);

    explainBtn.addEventListener('click', (e) => {
      e.preventDefault();
      runExplanation(turn, explainBtn, explainBtn.querySelector('.raw-log-explain-label'), out);
    });

    // — Kontext-Schichtstapel (Überblick über das Hin und Her) —
    det.appendChild(buildContextStack(turn));

    // — Details je Runde (Volltext, Rohdaten, Stream) —
    const exs = Array.isArray(turn.exchanges) ? turn.exchanges : [];
    const roundsDet = document.createElement('details');
    roundsDet.className = 'raw-log-rounds-wrap';
    const roundsSum = document.createElement('summary');
    roundsSum.className = 'raw-log-rounds-summary';
    roundsSum.textContent = `Details je Runde · ${exs.length} ${exs.length === 1 ? 'Aufruf' : 'Aufrufe'}`;
    roundsDet.appendChild(roundsSum);

    const rounds = document.createElement('div');
    rounds.className = 'raw-log-rounds';
    let prevSentCount = 0;
    exs.forEach((ex, i) => {
      rounds.appendChild(buildRound(ex, i + 1, prevSentCount));
      prevSentCount = Array.isArray(ex.messages) ? ex.messages.length : prevSentCount;
    });
    roundsDet.appendChild(rounds);
    det.appendChild(roundsDet);

    return det;
  }

  function render() {
    const list = turns();
    listEl.innerHTML = '';
    emptyEl.classList.toggle('hidden', list.length > 0);
    // Chronologisch: älteste Anfrage zuerst, neueste unten (= aufgeklappt).
    for (let i = 0; i < list.length; i += 1) {
      listEl.appendChild(buildTurn(list[i], i === list.length - 1));
    }
  }

  function getFocusable() {
    const dlg = modal.querySelector('.modal-dialog.raw-log-dialog');
    if (!dlg) return [];
    return [...dlg.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), details > summary'
    )].filter((el) => el.offsetParent !== null);
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeRawLogModal();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = getFocusable();
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function openRawLogModal() {
    appStore.lastFocusBeforeModal = document.activeElement;
    render();
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    modal.addEventListener('keydown', handleKeydown);
    queueMicrotask(() => {
      try { btnCloseX?.focus(); } catch { /* ignore */ }
      // Neueste Anfrage steht unten — direkt dorthin scrollen.
      const bodyEl = modal.querySelector('.raw-log-dialog__body');
      if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
    });
  }

  function closeRawLogModal() {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    modal.removeEventListener('keydown', handleKeydown);
    if (appStore.lastFocusBeforeModal && typeof appStore.lastFocusBeforeModal.focus === 'function') {
      try { appStore.lastFocusBeforeModal.focus(); } catch { /* ignore */ }
    }
    appStore.lastFocusBeforeModal = null;
  }

  btnOpen.addEventListener('click', openRawLogModal);
  btnCloseX?.addEventListener('click', closeRawLogModal);
  btnFooterClose?.addEventListener('click', closeRawLogModal);
  backdrop?.addEventListener('click', closeRawLogModal);

  syncBadge();

  return { openRawLogModal, closeRawLogModal, syncBadge };
}
