/**
 * RAW-LLM-Protokoll: zeigt die rohen Requests/Antworten aller LLM-Runden der
 * laufenden Sitzung (appStore.rawLlmLog). Reiner Lese-Dialog — die Daten werden
 * im Main maskiert und im Renderer nur per textContent gerendert (kein HTML aus
 * den Payloads), also kein XSS-Risiko.
 */

function formatTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function usageSummary(usage) {
  if (!usage || typeof usage !== 'object') return '';
  const parts = [];
  if (usage.prompt) parts.push(`in ${usage.prompt}`);
  if (usage.completion) parts.push(`out ${usage.completion}`);
  if (usage.total) parts.push(`Σ ${usage.total}`);
  return parts.length ? `Tokens: ${parts.join(' · ')}` : '';
}

function copyIconSvg() {
  return (
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
  );
}

export function initRawLogModal({ appStore }) {
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

  function entries() {
    return Array.isArray(appStore.rawLlmLog) ? appStore.rawLlmLog : [];
  }

  function syncBadge() {
    const n = entries().length;
    if (badgeEl) {
      badgeEl.textContent = String(n);
      badgeEl.classList.toggle('hidden', n === 0);
    }
    if (countEl) {
      countEl.textContent = `${n} ${n === 1 ? 'Aufruf' : 'Aufrufe'}`;
    }
  }

  function addCopyButton(host, getText, label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'raw-log-copy';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = copyIconSvg();
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(getText() || '');
        btn.classList.add('raw-log-copy--ok');
        setTimeout(() => btn.classList.remove('raw-log-copy--ok'), 1200);
      } catch {
        /* Clipboard nicht verfuegbar — still ignorieren */
      }
    });
    host.appendChild(btn);
  }

  function buildPre(text) {
    const pre = document.createElement('pre');
    pre.className = 'raw-log-pre';
    pre.textContent = text || '';
    return pre;
  }

  function buildSection(title, bodyText, copyLabel) {
    const section = document.createElement('div');
    section.className = 'raw-log-section';

    const head = document.createElement('div');
    head.className = 'raw-log-section-head';
    const h = document.createElement('span');
    h.className = 'raw-log-section-title';
    h.textContent = title;
    head.appendChild(h);
    addCopyButton(head, () => bodyText, copyLabel);
    section.appendChild(head);

    section.appendChild(buildPre(bodyText));
    return section;
  }

  function buildEntry(ex, index) {
    const det = document.createElement('details');
    det.className = 'raw-log-entry';
    if (ex.error) det.classList.add('raw-log-entry--error');
    if (index === 0) det.open = true;

    const summary = document.createElement('summary');
    summary.className = 'raw-log-entry-summary';

    const idx = document.createElement('span');
    idx.className = 'raw-log-entry-idx';
    idx.textContent = `#${index + 1}`;

    const main = document.createElement('span');
    main.className = 'raw-log-entry-main';
    const provider = [ex.providerId, ex.model].filter(Boolean).join(' · ') || 'LLM-Aufruf';
    main.textContent = provider;

    const meta = document.createElement('span');
    meta.className = 'raw-log-entry-meta';
    const metaBits = [];
    if (typeof ex.round === 'number') metaBits.push(`Runde ${ex.round + 1}`);
    if (ex.ts) metaBits.push(formatTime(ex.ts));
    if (ex.cancelled) metaBits.push('abgebrochen');
    if (ex.error) metaBits.push('Fehler');
    const u = usageSummary(ex.usage);
    if (u) metaBits.push(u);
    meta.textContent = metaBits.join('  ·  ');

    summary.appendChild(idx);
    summary.appendChild(main);
    summary.appendChild(meta);
    det.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'raw-log-entry-body';

    if (ex.error) {
      const err = document.createElement('p');
      err.className = 'raw-log-error';
      err.textContent = `Fehler: ${ex.error}`;
      body.appendChild(err);
    }

    const req = ex.request || {};
    const reqLines = [];
    if (req.method || req.url) reqLines.push(`${req.method || 'POST'} ${req.url || ''}`.trim());
    if (req.headers && typeof req.headers === 'object') {
      for (const [k, v] of Object.entries(req.headers)) reqLines.push(`${k}: ${v}`);
    }
    const reqHeaderText = reqLines.join('\n');
    const reqBodyText = typeof req.body === 'string' ? req.body : '';
    const reqFull = [reqHeaderText, reqBodyText].filter(Boolean).join('\n\n');
    body.appendChild(buildSection('Request', reqFull || '(kein Request erfasst)', 'Request kopieren'));

    body.appendChild(
      buildSection('Antwort (roh)', ex.responseRaw || '(keine Antwort erfasst)', 'Antwort kopieren')
    );

    det.appendChild(body);
    return det;
  }

  function render() {
    const list = entries();
    listEl.innerHTML = '';
    emptyEl.classList.toggle('hidden', list.length > 0);
    // Neueste zuerst.
    for (let i = list.length - 1; i >= 0; i -= 1) {
      listEl.appendChild(buildEntry(list[i], list.length - 1 - i));
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
