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

// Lebenslinien des Sequenzdiagramms.
const SEQ_ACTORS = { user: 'Nutzer', app: 'Anwendung', model: 'Modell', tool: 'Tool' };

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

// Wandelt eine Anfrage (Turn) in eine chronologische Liste von Nachrichten
// zwischen den Lebenslinien um — die Datengrundlage des Sequenzdiagramms.
function buildTurnSteps(turn) {
  const exchanges = Array.isArray(turn.exchanges) ? turn.exchanges : [];
  const steps = [];
  const usesTool = exchanges.some((ex) => (ex.response?.toolCalls || []).length);

  steps.push({
    from: 'user',
    to: 'app',
    kind: 'prompt',
    label: 'Nutzereingabe',
    detail: (turn.userText || '').trim() || '(leer)',
  });

  let prevSent = 0;
  exchanges.forEach((ex, i) => {
    const sent = Array.isArray(ex.messages) ? ex.messages : [];
    const newMsgs = (prevSent > 0 ? sent.slice(prevSent) : sent).filter(
      (m) => m && m.role !== 'assistant'
    );
    prevSent = sent.length;

    let reqDetail;
    let reqCode = false;
    if (i === 0) {
      const u = newMsgs.find((m) => m.role === 'user');
      reqDetail = u ? String(u.content || '') : 'Erste Anfrage an das Modell.';
    } else {
      const toolMsgs = newMsgs.filter((m) => m.role === 'tool');
      if (toolMsgs.length) {
        reqDetail = toolMsgs.map((m) => String(m.content || '')).join('\n\n');
        reqCode = true;
      } else {
        reqDetail = 'Bisheriger Gesprächsverlauf erneut gesendet.';
      }
    }
    steps.push({
      from: 'app',
      to: 'model',
      kind: 'request',
      label: i === 0 ? `Runde ${i + 1}: Anfrage` : `Runde ${i + 1}: Tool-Ergebnis nachgereicht`,
      detail: reqDetail,
      code: reqCode,
    });

    if (ex.error) {
      steps.push({ from: 'model', to: 'app', kind: 'error', label: 'Fehler', detail: String(ex.error) });
      return;
    }

    const text = (ex.response?.text || '').trim();
    const calls = ex.response?.toolCalls || [];

    if (text) {
      steps.push({ from: 'model', to: 'app', kind: 'answer', label: 'Text-Antwort', detail: text });
    }
    calls.forEach((c) => {
      const args = prettyMaybeJson(c.arguments) || '{}';
      steps.push({
        from: 'model',
        to: 'app',
        kind: 'toolcall',
        label: `JSON: Tool „${c.name || '?'}“`,
        detail: args,
        code: true,
      });
      steps.push({
        from: 'app',
        to: 'tool',
        kind: 'exec',
        label: `führt „${c.name || 'Tool'}“ aus`,
        detail: args,
        code: true,
      });
      const result = findToolResult(exchanges, c.id, i);
      steps.push({
        from: 'tool',
        to: 'app',
        kind: 'result',
        label: 'Ergebnis',
        detail: result == null ? '(nicht protokolliert)' : result,
        code: result != null,
      });
    });
  });

  let lastText = '';
  for (let i = exchanges.length - 1; i >= 0; i -= 1) {
    const t = (exchanges[i].response?.text || '').trim();
    if (t) {
      lastText = t;
      break;
    }
  }
  if (lastText) {
    steps.push({ from: 'app', to: 'user', kind: 'final', label: 'Antwort an Nutzer', detail: lastText });
  }

  const actors = usesTool ? ['user', 'app', 'model', 'tool'] : ['user', 'app', 'model'];
  return { steps, actors };
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
      try {
        await navigator.clipboard.writeText(getText() || '');
        btn.classList.add('raw-log-copy--ok');
        setTimeout(() => btn.classList.remove('raw-log-copy--ok'), 1200);
      } catch {
        /* Clipboard nicht verfuegbar */
      }
    });
    return btn;
  }

  function buildPre(text, extraClass) {
    const pre = document.createElement('pre');
    pre.className = extraClass ? `raw-log-pre ${extraClass}` : 'raw-log-pre';
    pre.textContent = text || '';
    return pre;
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

  // Ein einzelner LLM-Aufruf (Runde) innerhalb einer Anfrage.
  // prevSentCount = Anzahl Nachrichten, die schon in fruehere Runden gingen —
  // erlaubt, nur das in dieser Runde NEU Gesendete hervorzuheben.
  function buildRound(ex, roundNo, prevSentCount = 0) {
    const det = document.createElement('details');
    det.className = 'raw-log-round';
    if (ex.error) det.classList.add('raw-log-round--error');
    det.open = true;

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

    // — 1. Anwendung → Modell (chronologisch zuerst) —
    // Assistant-Nachrichten hier ausblenden: das sind frühere Modell-Antworten,
    // die bereits als „Antwort" ihrer eigenen Runde erscheinen. Neu und relevant
    // ist, was die Anwendung beisteuert (Nutzereingabe bzw. Tool-Ergebnisse).
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

    // Vollständiger gesendeter Verlauf bei Folge-Runden zusätzlich einklappbar.
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

    // — 2. Modell → Anwendung (Antwort) —
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
    if (!ansText.trim() && !ansCalls.length && !ex.error) {
      const none = document.createElement('p');
      none.className = 'raw-log-muted';
      none.textContent = '(keine Antwort)';
      body.appendChild(none);
    }

    // — 3. Rohdaten (provider-spezifisch, eingeklappt) —
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

  function svgEl(name, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  }

  // Interaktives Sequenzdiagramm einer Anfrage: Lebenslinien (Nutzer, Anwendung,
  // Modell, ggf. Tool), chronologische Pfeile, klickbare Schritte mit Detail.
  function buildSequenceDiagram(turn) {
    const { steps, actors } = buildTurnSteps(turn);
    const wrap = document.createElement('div');
    wrap.className = 'seq';
    if (!steps.length) return wrap;

    const W = 760;
    const M = 64;
    const HEADER_H = 26;
    const Y0 = HEADER_H + 24;
    const ROW_H = 46;
    const H = Y0 + steps.length * ROW_H + 14;

    const n = actors.length;
    const laneX = {};
    actors.forEach((a, i) => {
      laneX[a] = n === 1 ? W / 2 : M + (i * (W - 2 * M)) / (n - 1);
    });

    const svg = svgEl('svg', {
      class: 'seq-svg',
      viewBox: `0 0 ${W} ${H}`,
      width: '100%',
      role: 'group',
      'aria-label': 'Sequenzdiagramm des Anfrageablaufs',
    });

    for (const a of actors) {
      const x = laneX[a];
      svg.appendChild(svgEl('line', { x1: x, y1: HEADER_H, x2: x, y2: H - 8, class: 'seq-lifeline' }));
      svg.appendChild(
        svgEl('rect', { x: x - 46, y: 2, width: 92, height: HEADER_H - 4, rx: 6, class: `seq-actor seq--${a}` })
      );
      const t = svgEl('text', { x, y: HEADER_H / 2 + 4, class: 'seq-actor-label', 'text-anchor': 'middle' });
      t.textContent = SEQ_ACTORS[a] || a;
      svg.appendChild(t);
    }

    const rows = [];
    const detail = document.createElement('div');
    detail.className = 'seq-detail';
    const dHead = document.createElement('div');
    dHead.className = 'seq-detail-head';
    const dRoute = document.createElement('span');
    dRoute.className = 'seq-detail-route';
    const dLabel = document.createElement('span');
    dLabel.className = 'seq-detail-label';
    dHead.appendChild(dRoute);
    dHead.appendChild(dLabel);
    const dBody = document.createElement('pre');
    dBody.className = 'seq-detail-body';
    detail.appendChild(dHead);
    detail.appendChild(dBody);

    function select(idx) {
      rows.forEach((r, i) => r.classList.toggle('seq-row--active', i === idx));
      const s = steps[idx];
      if (!s) return;
      dRoute.textContent = `${SEQ_ACTORS[s.from]} → ${SEQ_ACTORS[s.to]}`;
      dLabel.textContent = s.label;
      dBody.textContent = s.detail || '';
    }

    steps.forEach((s, i) => {
      const rowTop = Y0 + i * ROW_H;
      const yArrow = rowTop + ROW_H - 16;
      const xF = laneX[s.from];
      const xT = laneX[s.to];
      const dir = xT >= xF ? 1 : -1;

      const g = svgEl('g', {
        class: `seq-row seq--${s.kind === 'error' ? 'error' : s.from}`,
        tabindex: '0',
        role: 'button',
        'aria-label': `Schritt ${i + 1}: ${SEQ_ACTORS[s.from]} an ${SEQ_ACTORS[s.to]} — ${s.label}`,
      });
      g.appendChild(svgEl('rect', { x: 2, y: rowTop, width: W - 4, height: ROW_H, class: 'seq-hit' }));
      g.appendChild(svgEl('line', { x1: xF, y1: yArrow, x2: xT - dir * 9, y2: yArrow, class: 'seq-arrow' }));
      g.appendChild(
        svgEl('path', {
          d: `M ${xT} ${yArrow} L ${xT - dir * 9} ${yArrow - 4} L ${xT - dir * 9} ${yArrow + 4} Z`,
          class: 'seq-arrowhead',
        })
      );
      const label = svgEl('text', {
        x: (xF + xT) / 2,
        y: yArrow - 6,
        class: 'seq-label',
        'text-anchor': 'middle',
      });
      label.textContent = truncate(s.label, 34);
      g.appendChild(label);
      const num = svgEl('text', { x: 8, y: yArrow + 4, class: 'seq-num' });
      num.textContent = String(i + 1);
      g.appendChild(num);

      g.addEventListener('click', () => select(i));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          select(i);
        }
      });

      rows.push(g);
      svg.appendChild(g);
    });

    wrap.appendChild(svg);
    wrap.appendChild(detail);
    select(0);
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

    // — Sequenzdiagramm (Überblick über das Hin und Her) —
    det.appendChild(buildSequenceDiagram(turn));

    // — Details je Runde (eingeklappt) —
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
