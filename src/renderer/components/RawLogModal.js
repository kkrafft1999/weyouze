/**
 * RAW-LLM-Protokoll — reine Präsentationsschicht.
 *
 * Rendert vom Main gelieferte RawLogTurn-View-Modelle plus lokal gepaarte
 * rawExchanges. Kein provider-spezifisches Wire-Parsing — nur generische
 * Nutzung normalisierter Exchange-Felder (messages, request, responseRaw).
 */

import { markdownToSafeHtml } from '../utils/helpers.js';

const ROLE_LABELS = {
  system: 'System',
  user: 'User',
  assistant: 'Assistant',
  tool: 'Tool-Ergebnis',
};

const INCOMPLETE_TURN_MESSAGE =
  'Kontext-Stack und normalisierte Runden-Details sind für diese Anfrage nicht verfügbar ' +
  '(View-Modell fehlt). Unten: rohe Request-/Response-Daten je Runde. ' +
  '„Ablauf erklären“ nutzt die vorhandenen Exchange-Daten.';

function copyIconSvg() {
  return (
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
  );
}

function sparkleSvg() {
  return (
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>' +
    '<path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>'
  );
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

function compactArgs(argStr) {
  const t = String(argStr ?? '').trim();
  if (!t) return '';
  try {
    return JSON.stringify(JSON.parse(t));
  } catch {
    return t;
  }
}

function truncate(text, max) {
  const t = String(text ?? '');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function exchangeAt(turn, index) {
  const exchanges = Array.isArray(turn?.exchanges) ? turn.exchanges : [];
  return exchanges[index] || null;
}

function messageAt(exchange, msgIndex) {
  const messages = Array.isArray(exchange?.messages) ? exchange.messages : [];
  return messages[msgIndex] || null;
}

function messageToBlock(m) {
  const role = m?.role || 'unknown';
  const block = {
    role,
    roleLabel: ROLE_LABELS[role] || role || '?',
    cssRole: role || 'unknown',
  };
  const text = normalizeMessageContent(m?.content);
  if (text.trim()) block.content = prettyMaybeJson(text);
  if (Array.isArray(m?.tool_calls) && m.tool_calls.length) {
    block.toolCallLines = m.tool_calls.map((tc) => ({
      line: `→ ${tc.name || 'tool'}(${truncate(compactArgs(tc.arguments), 200)})`,
    }));
  }
  return block;
}

function formatRawRequestText(ex) {
  const req = ex?.request || {};
  const reqLines = [];
  if (req.method || req.url) reqLines.push(`${req.method || 'POST'} ${req.url || ''}`.trim());
  if (req.headers && typeof req.headers === 'object') {
    for (const [k, v] of Object.entries(req.headers)) reqLines.push(`${k}: ${v}`);
  }
  const body = typeof req.body === 'string' ? req.body : '';
  return [reqLines.join('\n'), body].filter(Boolean).join('\n\n');
}

function formatRawResponseText(ex) {
  return ex?.responseRaw || '(leer)';
}

function formatRoundClipboard(ex, roundNo) {
  const parts = [];
  parts.push(`=== Runde ${roundNo} · REQUEST (roh) ===`);
  const rawReq = formatRawRequestText(ex);
  parts.push(rawReq || '(kein Request protokolliert)');
  parts.push('');
  parts.push(`=== Runde ${roundNo} · RESPONSE (roh) ===`);
  parts.push(formatRawResponseText(ex));
  return parts.join('\n');
}

function buildAnswerCopyText(ex) {
  const ansText = ex?.response?.text || '';
  const ansCalls = ex?.response?.toolCalls || [];
  return [ansText, ...ansCalls.map((c) => `${c.name}(${compactArgs(c.arguments)})`)]
    .filter(Boolean)
    .join('\n');
}

function resolveExchangeToolCall(ex, vmCall) {
  const calls = Array.isArray(ex?.response?.toolCalls) ? ex.response.toolCalls : [];
  if (vmCall?.callId) {
    const byId = calls.find((tc) => tc && tc.id === vmCall.callId);
    if (byId) return byId;
  }
  if (typeof vmCall?.callIndex === 'number' && calls[vmCall.callIndex]) {
    return calls[vmCall.callIndex];
  }
  return null;
}

function genericRoundOutcome(ex) {
  if (ex?.error) return 'Fehler';
  if (ex?.cancelled) return 'abgebrochen';
  const calls = ex?.response?.toolCalls || [];
  if (calls.length) return `→ ${calls.map((c) => c.name || 'tool').join(', ')}`;
  if (ex?.response?.text?.trim()) return 'Text-Antwort';
  return '—';
}

function genericRoundMeta(ex) {
  const bits = [];
  if (ex?.model) bits.push(ex.model);
  const usage = ex?.usage;
  if (usage?.prompt) bits.push(`in ${usage.prompt}`);
  if (usage?.completion) bits.push(`out ${usage.completion}`);
  return bits.join('  ·  ');
}

function turnIsComplete(turn) {
  return !turn?.incomplete && Array.isArray(turn?.rounds) && turn.rounds.length > 0;
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

  function turnCallCount(turn) {
    return turn.exchangeCount ?? turn.rounds?.length ?? turn.exchanges?.length ?? 0;
  }

  function totalCalls() {
    return turns().reduce((sum, t) => sum + turnCallCount(t), 0);
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
        /* Fallback */
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

  function renderMessageBlock(block) {
    const row = document.createElement('div');
    row.className = `raw-log-msg raw-log-msg--${block.cssRole || 'unknown'}`;
    const chip = document.createElement('span');
    chip.className = 'raw-log-role';
    chip.textContent = block.roleLabel || '?';
    row.appendChild(chip);
    if (block.content) row.appendChild(buildPre(block.content, 'raw-log-pre--inline'));
    for (const tc of block.toolCallLines || []) {
      const line = document.createElement('div');
      line.className = 'raw-log-toolcall';
      line.textContent = tc.line;
      row.appendChild(line);
    }
    return row;
  }

  function wireLayer(layerEl, fullEl, wrap, msgIndex) {
    const highlight = (on) => {
      wrap
        .querySelectorAll(`.cstack-layer[data-msg-index="${msgIndex}"]`)
        .forEach((el) => el.classList.toggle('cstack-layer--hl', on));
    };
    const toggleFull = () => {
      const nowHidden = fullEl.classList.toggle('hidden');
      layerEl.classList.toggle('cstack-layer--open', !nowHidden);
    };
    layerEl.addEventListener('click', toggleFull);
    layerEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleFull();
      }
    });
    layerEl.addEventListener('mouseenter', () => highlight(true));
    layerEl.addEventListener('mouseleave', () => highlight(false));
  }

  function renderContextStack(stack, turn) {
    const wrap = document.createElement('div');
    wrap.className = 'cstack';
    if (!stack?.rounds?.length) return wrap;

    const exchanges = Array.isArray(turn.exchanges) ? turn.exchanges : [];

    const meta = document.createElement('div');
    meta.className = 'cstack-meta';
    const stat = document.createElement('div');
    stat.className = 'cstack-meta-stat';
    stat.textContent = stack.metaStat || '';
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

    for (const round of stack.rounds) {
      const ex = exchangeAt(turn, round.exchangeIndex ?? round.roundNo - 1);
      const block = document.createElement('div');
      block.className = 'cstack-round';
      if (round.errored) block.classList.add('cstack-round--error');

      const head = document.createElement('div');
      head.className = 'cstack-round-head';
      const tag = document.createElement('span');
      tag.className = 'cstack-round-tag';
      tag.textContent = `Runde ${round.roundNo}`;
      head.appendChild(tag);
      const headRight = document.createElement('div');
      headRight.className = 'cstack-round-head-right';
      const sentInfo = document.createElement('span');
      sentInfo.className = 'cstack-round-sent';
      sentInfo.textContent = round.sentInfo || '';
      headRight.appendChild(sentInfo);
      headRight.appendChild(
        makeCopyButton(
          () => (ex ? formatRoundClipboard(ex, round.roundNo) : ''),
          `Runde ${round.roundNo} Rohdaten kopieren`
        )
      );
      head.appendChild(headRight);
      block.appendChild(head);

      const cols = document.createElement('div');
      cols.className = 'cstack-round-cols';
      const left = document.createElement('div');
      left.className = 'cstack-sent';
      const layers = document.createElement('div');
      layers.className = 'cstack-layers';

      if (round.toolLayer) {
        const tl = round.toolLayer;
        const tLayer = document.createElement('div');
        tLayer.className = 'cstack-layer cstack-layer--tools is-old';
        tLayer.dataset.msgIndex = 'tools';
        tLayer.tabIndex = 0;
        tLayer.setAttribute('role', 'button');
        tLayer.title = tl.title || '';
        tLayer.setAttribute('aria-label', tl.ariaLabel || '');
        const tRole = document.createElement('span');
        tRole.className = 'cstack-layer-role';
        tRole.textContent = 'Tools';
        tLayer.appendChild(tRole);
        const tCount = document.createElement('span');
        tCount.className = 'cstack-layer-role cstack-layer-call';
        tCount.textContent = `${tl.count} ${tl.count === 1 ? 'Definition' : 'Definitionen'}`;
        tLayer.appendChild(tCount);
        const tSnip = document.createElement('span');
        tSnip.className = 'cstack-layer-snippet';
        tSnip.textContent = tl.namesSnippet || '';
        tLayer.appendChild(tSnip);
        const tFull = document.createElement('div');
        tFull.className = 'cstack-layer-full hidden';
        tFull.appendChild(buildPre(tl.schemasPretty || ''));
        tLayer.appendChild(tFull);
        wireLayer(tLayer, tFull, wrap, 'tools');
        layers.appendChild(tLayer);
      }

      for (const layer of round.layers || []) {
        const layerEl = document.createElement('div');
        layerEl.className = `cstack-layer cstack-layer--${layer.cssCls} ${layer.isNew ? 'is-new' : 'is-old'}`;
        layerEl.dataset.msgIndex = String(layer.msgIndex);
        layerEl.tabIndex = 0;
        layerEl.setAttribute('role', 'button');
        layerEl.title = layer.title || '';
        layerEl.setAttribute('aria-label', layer.ariaLabel || '');
        const roleEl = document.createElement('span');
        roleEl.className = 'cstack-layer-role';
        roleEl.textContent = layer.roleLabel;
        layerEl.appendChild(roleEl);
        if (layer.callLabel) {
          const callEl = document.createElement('span');
          callEl.className = 'cstack-layer-role cstack-layer-call';
          callEl.textContent = layer.callLabel;
          layerEl.appendChild(callEl);
        }
        const snip = document.createElement('span');
        snip.className = 'cstack-layer-snippet';
        snip.textContent = layer.snippet || '';
        layerEl.appendChild(snip);
        if (layer.showNewBadge) {
          const badge = document.createElement('span');
          badge.className = 'cstack-layer-badge';
          badge.innerHTML = `${plusIconSvg()}<span>neu${layer.newBadgeSuffix || ''}</span>`;
          layerEl.appendChild(badge);
        }
        const full = document.createElement('div');
        full.className = 'cstack-layer-full hidden';
        const msg = ex ? messageAt(ex, layer.msgIndex) : null;
        full.appendChild(renderMessageBlock(msg ? messageToBlock(msg) : { role: 'unknown', roleLabel: '?', cssRole: 'unknown' }));
        layerEl.appendChild(full);
        wireLayer(layerEl, full, wrap, String(layer.msgIndex));
        layers.appendChild(layerEl);
      }

      left.appendChild(layers);
      const bar = document.createElement('div');
      bar.className = 'cstack-bar';
      bar.title = round.bar?.title || '';
      const track = document.createElement('div');
      track.className = 'cstack-bar-track';
      const fill = document.createElement('div');
      fill.className = 'cstack-bar-fill';
      fill.style.width = `${round.bar?.widthPct || 4}%`;
      track.appendChild(fill);
      bar.appendChild(track);
      const barLabel = document.createElement('div');
      barLabel.className = 'cstack-bar-label';
      barLabel.textContent = round.bar?.label || '';
      bar.appendChild(barLabel);
      left.appendChild(bar);
      cols.appendChild(left);

      const right = document.createElement('div');
      right.className = 'cstack-resp';
      const card = document.createElement('div');
      card.className = 'cstack-resp-card';
      if (round.errored) card.classList.add('cstack-resp-card--error');
      const rHead = document.createElement('div');
      rHead.className = 'cstack-resp-head';
      rHead.textContent = 'Modell → Anwendung';
      card.appendChild(rHead);
      const outEl = document.createElement('div');
      outEl.className = 'cstack-resp-out';
      outEl.textContent = round.responseCard?.outLabel || 'out —';
      card.appendChild(outEl);
      const rc = round.responseCard;
      if (rc?.kind === 'error') {
        const e = document.createElement('div');
        e.className = 'cstack-resp-kind cstack-resp-kind--error';
        e.textContent = rc.errorText || '';
        card.appendChild(e);
      } else if (rc?.kind === 'json') {
        const k = document.createElement('div');
        k.className = 'cstack-resp-kind';
        k.textContent = 'JSON, KEIN Text:';
        card.appendChild(k);
        for (const call of rc.jsonCalls || []) {
          const code = document.createElement('code');
          code.className = 'cstack-resp-call';
          code.textContent = call;
          card.appendChild(code);
        }
      } else if (rc?.kind === 'text') {
        const k = document.createElement('div');
        k.className = 'cstack-resp-kind cstack-resp-kind--text';
        k.innerHTML = `${checkIconSvg()}<span>Text</span>`;
        card.appendChild(k);
        const t = document.createElement('div');
        t.className = 'cstack-resp-text';
        t.textContent = rc.textSnippet || '';
        card.appendChild(t);
      } else {
        const k = document.createElement('div');
        k.className = 'cstack-resp-kind';
        k.textContent = '(keine Antwort)';
        card.appendChild(k);
      }
      right.appendChild(card);
      cols.appendChild(right);
      block.appendChild(cols);
      wrap.appendChild(block);

      for (const strip of round.execStrips || []) {
        const exec = document.createElement('details');
        exec.className = 'cstack-exec';
        const sum = document.createElement('summary');
        sum.className = 'cstack-exec-summary';
        const callEl = document.createElement('code');
        callEl.className = 'cstack-exec-summary-call';
        callEl.textContent = strip.summaryCall;
        sum.appendChild(callEl);
        sum.appendChild(document.createTextNode(' — Klick für Ergebnis'));
        exec.appendChild(sum);
        const body = document.createElement('div');
        body.className = 'cstack-exec-body';
        const call = document.createElement('code');
        call.className = 'cstack-exec-call';
        call.textContent = strip.bodyCall;
        body.appendChild(call);
        const resultLabel = document.createElement('div');
        resultLabel.className = 'cstack-exec-result-label';
        resultLabel.textContent = strip.resultLabel;
        body.appendChild(resultLabel);
        const pre = document.createElement('pre');
        pre.className = 'cstack-exec-result';
        pre.textContent = strip.resultRecorded
          ? strip.resultText || '(leer)'
          : '(nicht protokolliert)';
        body.appendChild(pre);
        const note = document.createElement('div');
        note.className = 'cstack-exec-note';
        note.textContent = strip.noteText;
        body.appendChild(note);
        exec.appendChild(body);
        wrap.appendChild(exec);
      }
    }

    const foot = document.createElement('p');
    foot.className = 'cstack-foot';
    foot.textContent = stack.footText || '';
    wrap.appendChild(foot);
    return wrap;
  }

  function renderRoundDetail(round, turn) {
    const ex = exchangeAt(turn, round.exchangeIndex ?? round.roundNo - 1);
    const det = document.createElement('details');
    det.className = 'raw-log-round';
    if (round.errored) det.classList.add('raw-log-round--error');

    const summary = document.createElement('summary');
    summary.className = 'raw-log-round-summary';
    const tag = document.createElement('span');
    tag.className = 'raw-log-round-tag';
    tag.textContent = `Runde ${round.roundNo}`;
    const mid = document.createElement('span');
    mid.className = 'raw-log-round-mid';
    mid.textContent = round.outcome || '—';
    const meta = document.createElement('span');
    meta.className = 'raw-log-round-meta';
    meta.textContent = round.metaText || '';
    summary.appendChild(tag);
    summary.appendChild(mid);
    summary.appendChild(meta);
    det.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'raw-log-round-body';

    const sentHead = document.createElement('div');
    sentHead.className = 'raw-log-section-head';
    sentHead.appendChild(sectionLabel(round.sentLabel || 'Anwendung → Modell'));
    body.appendChild(sentHead);

    if (round.sentEmpty) {
      const none = document.createElement('p');
      none.className = 'raw-log-muted';
      none.textContent = round.sentEmptyText || '';
      body.appendChild(none);
    } else {
      const msgs = document.createElement('div');
      msgs.className = 'raw-log-msgs';
      for (const idx of round.newMessageIndices || []) {
        const m = ex ? messageAt(ex, idx) : null;
        if (m) msgs.appendChild(renderMessageBlock(messageToBlock(m)));
      }
      body.appendChild(msgs);
    }

    if (round.showAllMessages && ex) {
      const allDet = document.createElement('details');
      allDet.className = 'raw-log-sub';
      const allSum = document.createElement('summary');
      const count = round.allMessagesCount || ex.messages?.length || 0;
      allSum.textContent = `Ganzer gesendeter Verlauf · ${count} ${count === 1 ? 'Nachricht' : 'Nachrichten'}`;
      allDet.appendChild(allSum);
      const allMsgs = document.createElement('div');
      allMsgs.className = 'raw-log-msgs';
      for (const m of ex.messages || []) allMsgs.appendChild(renderMessageBlock(messageToBlock(m)));
      allDet.appendChild(allMsgs);
      body.appendChild(allDet);
    }

    if (round.errorText) {
      const err = document.createElement('p');
      err.className = 'raw-log-error';
      err.textContent = round.errorText;
      body.appendChild(err);
    }

    const ansHead = document.createElement('div');
    ansHead.className = 'raw-log-section-head';
    ansHead.appendChild(sectionLabel('Modell → Anwendung (Antwort)'));
    ansHead.appendChild(makeCopyButton(() => (ex ? buildAnswerCopyText(ex) : ''), 'Antwort kopieren'));
    body.appendChild(ansHead);

    const ansText = ex?.response?.text || '';
    if (round.answer?.hasText && ansText.trim()) body.appendChild(buildPre(ansText));
    if (round.answer?.toolCalls?.length) {
      const hint = document.createElement('p');
      hint.className = 'raw-log-muted';
      hint.textContent =
        'Das Modell lieferte JSON, das diese Tool-Aufrufe beschreibt — ausgeführt werden sie von der Anwendung:';
      body.appendChild(hint);
      for (const c of round.answer.toolCalls) {
        const wrap = document.createElement('div');
        wrap.className = 'raw-log-toolcall raw-log-toolcall--out';
        const name = document.createElement('span');
        name.className = 'raw-log-toolcall-name';
        name.textContent = c.nameLine;
        wrap.appendChild(name);
        const call = resolveExchangeToolCall(ex, c);
        const argsPretty = call?.arguments ? prettyMaybeJson(call.arguments) : '';
        if (argsPretty.trim()) wrap.appendChild(buildPre(argsPretty, 'raw-log-pre--inline'));
        body.appendChild(wrap);
      }
    }
    if (!round.answer?.hasText && !round.answer?.toolCalls?.length && !round.errorText && !round.cancelled) {
      const none = document.createElement('p');
      none.className = 'raw-log-muted';
      none.textContent = '(keine Antwort)';
      body.appendChild(none);
    }
    if (round.cancelled && !round.errorText) {
      const cancelled = document.createElement('p');
      cancelled.className = 'raw-log-error';
      cancelled.textContent = 'Abgebrochen — kam nicht durch';
      body.appendChild(cancelled);
    }
    if (round.finishWarn) {
      const warn = document.createElement('p');
      warn.className = 'raw-log-error';
      warn.textContent = round.finishWarn;
      body.appendChild(warn);
    }

    if (round.hasRawSection && ex) {
      const rawDet = document.createElement('details');
      rawDet.className = 'raw-log-sub';
      const rawSum = document.createElement('summary');
      rawSum.textContent = 'Rohdaten (Request / Stream)';
      rawDet.appendChild(rawSum);
      const rawReq = formatRawRequestText(ex);
      if (rawReq) {
        const h = document.createElement('div');
        h.className = 'raw-log-section-head';
        h.appendChild(sectionLabel('Request (roh)'));
        h.appendChild(makeCopyButton(() => rawReq, 'Request kopieren'));
        rawDet.appendChild(h);
        if (round.requestParamsLine) {
          const params = document.createElement('p');
          params.className = 'raw-log-muted';
          params.textContent = round.requestParamsLine;
          rawDet.appendChild(params);
        }
        rawDet.appendChild(buildPre(rawReq));
      }
      const h2 = document.createElement('div');
      h2.className = 'raw-log-section-head';
      h2.appendChild(sectionLabel('Antwort-Stream (roh)'));
      const rawResp = formatRawResponseText(ex);
      h2.appendChild(makeCopyButton(() => rawResp, 'Stream kopieren'));
      rawDet.appendChild(h2);
      rawDet.appendChild(buildPre(rawResp));
      body.appendChild(rawDet);
    }

    det.appendChild(body);
    return det;
  }

  function renderMinimalIncompleteRounds(turn) {
    const exchanges = Array.isArray(turn.exchanges) ? turn.exchanges : [];
    const wrap = document.createElement('details');
    wrap.className = 'raw-log-rounds-wrap raw-log-rounds-wrap--incomplete';
    wrap.open = true;
    const roundsSum = document.createElement('summary');
    roundsSum.className = 'raw-log-rounds-summary';
    roundsSum.textContent =
      `Rohdaten je Runde · ${exchanges.length} ${exchanges.length === 1 ? 'Aufruf' : 'Aufrufe'}`;
    wrap.appendChild(roundsSum);

    const roundsEl = document.createElement('div');
    roundsEl.className = 'raw-log-rounds';

    exchanges.forEach((ex, i) => {
      const roundNo = i + 1;
      const det = document.createElement('details');
      det.className = 'raw-log-round raw-log-round--minimal';
      if (ex?.error || ex?.cancelled) det.classList.add('raw-log-round--error');

      const summary = document.createElement('summary');
      summary.className = 'raw-log-round-summary';
      const tag = document.createElement('span');
      tag.className = 'raw-log-round-tag';
      tag.textContent = `Runde ${roundNo}`;
      const mid = document.createElement('span');
      mid.className = 'raw-log-round-mid';
      mid.textContent = genericRoundOutcome(ex);
      const meta = document.createElement('span');
      meta.className = 'raw-log-round-meta';
      meta.textContent = genericRoundMeta(ex);
      summary.appendChild(tag);
      summary.appendChild(mid);
      summary.appendChild(meta);
      det.appendChild(summary);

      const body = document.createElement('div');
      body.className = 'raw-log-round-body';

      const head = document.createElement('div');
      head.className = 'raw-log-section-head';
      head.appendChild(sectionLabel(`Runde ${roundNo} · Rohdaten`));
      head.appendChild(
        makeCopyButton(() => formatRoundClipboard(ex, roundNo), `Runde ${roundNo} Rohdaten kopieren`)
      );
      body.appendChild(head);

      const rawReq = formatRawRequestText(ex);
      if (rawReq) {
        const reqHead = document.createElement('div');
        reqHead.className = 'raw-log-section-head';
        reqHead.appendChild(sectionLabel('Request (roh)'));
        reqHead.appendChild(makeCopyButton(() => rawReq, 'Request kopieren'));
        body.appendChild(reqHead);
        body.appendChild(buildPre(rawReq));
      }

      const respHead = document.createElement('div');
      respHead.className = 'raw-log-section-head';
      respHead.appendChild(sectionLabel('Antwort-Stream (roh)'));
      const rawResp = formatRawResponseText(ex);
      respHead.appendChild(makeCopyButton(() => rawResp, 'Stream kopieren'));
      body.appendChild(respHead);
      body.appendChild(buildPre(rawResp));

      if (ex?.error) {
        const err = document.createElement('p');
        err.className = 'raw-log-error';
        err.textContent = `Fehler: ${ex.error}`;
        body.appendChild(err);
      }
      if (ex?.cancelled && !ex?.error) {
        const cancelled = document.createElement('p');
        cancelled.className = 'raw-log-error';
        cancelled.textContent = 'Abgebrochen — kam nicht durch';
        body.appendChild(cancelled);
      }

      det.appendChild(body);
      roundsEl.appendChild(det);
    });

    wrap.appendChild(roundsEl);
    return wrap;
  }

  async function runExplanation(turn, btn, labelEl, outEl) {
    if (turn.__explaining) return;
    if (!Array.isArray(turn.exchanges) || turn.exchanges.length === 0) return;
    turn.__explaining = true;
    btn.disabled = true;
    const labelBefore = labelEl.textContent;
    labelEl.textContent = 'Erkläre …';
    outEl.classList.remove('hidden');
    outEl.classList.add('raw-log-explain--loading');
    outEl.textContent = 'Das Modell erklärt diesen Durchlauf …';
    try {
      const result = await api.explainChat({
        userText: turn.userText,
        exchanges: turn.exchanges,
      });
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

  function buildTurn(turn, isLatest) {
    const complete = turnIsComplete(turn);
    const hasExchanges = Array.isArray(turn.exchanges) && turn.exchanges.length > 0;
    const det = document.createElement('details');
    det.className = 'raw-log-turn';
    if (!complete) det.classList.add('raw-log-turn--incomplete');
    det.open = isLatest;

    const summary = document.createElement('summary');
    summary.className = 'raw-log-turn-summary';
    const idx = document.createElement('span');
    idx.className = 'raw-log-turn-idx';
    idx.textContent = `Anfrage ${turn.index}`;
    const txt = document.createElement('span');
    txt.className = 'raw-log-turn-text';
    txt.textContent = turn.summaryText || '(leer)';
    const count = document.createElement('span');
    count.className = 'raw-log-turn-count';
    count.textContent = turn.roundsSummary || `${turnCallCount(turn)} Aufrufe`;
    summary.appendChild(idx);
    summary.appendChild(txt);
    summary.appendChild(count);
    det.appendChild(summary);

    const tools = document.createElement('div');
    tools.className = 'raw-log-turn-tools';
    const explainBtn = document.createElement('button');
    explainBtn.type = 'button';
    explainBtn.className = 'raw-log-explain-btn';
    explainBtn.title = hasExchanges
      ? 'Das aktive Modell erklären lassen, was in dieser Anfrage ablief'
      : 'Erklärung nicht verfügbar — keine Exchange-Daten';
    explainBtn.innerHTML = `${sparkleSvg()}<span class="raw-log-explain-label">Ablauf erklären</span>`;
    explainBtn.disabled = !hasExchanges;
    tools.appendChild(explainBtn);
    det.appendChild(tools);

    const out = document.createElement('div');
    out.className = 'raw-log-explain hidden';
    if (turn.explanation) {
      out.classList.remove('hidden');
      out.innerHTML = markdownToSafeHtml(turn.explanation);
    }
    det.appendChild(out);

    if (hasExchanges) {
      explainBtn.addEventListener('click', (e) => {
        e.preventDefault();
        runExplanation(turn, explainBtn, explainBtn.querySelector('.raw-log-explain-label'), out);
      });
    }

    if (!complete) {
      const notice = document.createElement('p');
      notice.className = 'raw-log-incomplete';
      notice.textContent = INCOMPLETE_TURN_MESSAGE;
      det.appendChild(notice);
      if (hasExchanges) det.appendChild(renderMinimalIncompleteRounds(turn));
      return det;
    }

    if (turn.contextStack) det.appendChild(renderContextStack(turn.contextStack, turn));

    const rounds = turn.rounds || [];
    const roundsDet = document.createElement('details');
    roundsDet.className = 'raw-log-rounds-wrap';
    const roundsSum = document.createElement('summary');
    roundsSum.className = 'raw-log-rounds-summary';
    roundsSum.textContent = `Details je Runde · ${turn.roundsSummary || `${rounds.length} Aufrufe`}`;
    roundsDet.appendChild(roundsSum);
    const roundsEl = document.createElement('div');
    roundsEl.className = 'raw-log-rounds';
    for (const round of rounds) roundsEl.appendChild(renderRoundDetail(round, turn));
    roundsDet.appendChild(roundsEl);
    det.appendChild(roundsDet);

    return det;
  }

  function render() {
    const list = turns();
    listEl.innerHTML = '';
    emptyEl.classList.toggle('hidden', list.length > 0);
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
