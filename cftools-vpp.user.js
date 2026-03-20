// ==UserScript==
// @name         CFTools Tools: VPP Coord Copier
// @namespace    austin.cftools.vpp
// @version      5.1
// @description  Adds coordinate copy tools, Discord ban entry creation, and profile trace comparison helpers for CFTools
// @match        https://*cftools*/*
// @match        https://*.cftools.cloud/*
// @match        https://cftools.cloud/*
// @updateURL    https://github.com/worstpotato/CFTools-TamperMonkey/raw/refs/heads/main/cftools-vpp.user.js
// @downloadURL  https://github.com/worstpotato/CFTools-TamperMonkey/raw/refs/heads/main/cftools-vpp.user.js
// @match        https://app.cftools.cloud/*
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
  'use strict';

  /*************** Toast ***************/
  // Small temporary message shown at the top of the page for status updates.
  function toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    const offset = 20 + (document.querySelectorAll('.codex-toast').length * 42);
    t.className = 'codex-toast';
    t.style.cssText = `
      position: fixed; left: 50%; top: ${offset}px; transform: translateX(-50%);
      background: #111; color: #fff; padding: 8px 14px; border-radius: 999px;
      border: 1px solid #333; font: 13px system-ui,sans-serif;
      box-shadow: 0 8px 25px rgba(0,0,0,.3); z-index: 2147483647; opacity: 0;
      transition: opacity .15s ease-out;
    `;
    document.body.appendChild(t);
    requestAnimationFrame(() => (t.style.opacity = '1'));
    setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 200);
    }, 1500);
  }

  // Centralized clipboard helper.
  // It tries the Tampermonkey API first, then normal browser clipboard APIs,
  // and finally falls back to the old textarea copy trick.
  async function copyText(text) {
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text, 'text');
        return true;
      }
    } catch {}

    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}

    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.left = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);

    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {}

    ta.remove();
    return copied;
  }

  /*************** VPP copier ***************/
  // Supported coordinate formats:
  // 1. X: 123, Y: 456, Z: 789
  // 2. position: [ 123, 456, 789 ]
  // 3. [ 123, 456, 789 ] when "position:" is rendered in a separate element
  const XYZ_COORD_RE = /X:\s*(-?\d+(?:\.\d+)?)\s*,?\s*Y:\s*(-?\d+(?:\.\d+)?)\s*,?\s*Z:\s*(-?\d+(?:\.\d+)?)/i;
  const POSITION_COORD_RE = /position:\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/i;
  const BRACKET_COORD_RE = /^\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]\s*$/;

  // Converts CFTools coordinates into the X,Z,Y order used by DayZ admin tools.
  function parseCoords(text) {
    const rawText = text || '';
    const xyzMatch = XYZ_COORD_RE.exec(rawText);
    const positionMatch = POSITION_COORD_RE.exec(rawText);
    const bracketMatch = BRACKET_COORD_RE.exec(rawText);
    const m = xyzMatch || positionMatch || bracketMatch;
    if (!m) return null;
    const [, x, y, z] = m;
    return `${x},${z},${y}`; // X,Z,Y
  }

  // Some CFTools rows render the label and the actual value in separate elements.
  // This lets us confirm that a bare [x, y, z] span belongs to a "position:" field.
  function isPositionValueSpan(span) {
    const container = span.parentElement;
    if (!container) return false;

    const label = container.querySelector('b.text-code');
    return /position:/i.test(label?.textContent || '');
  }

  // Adds "Copy VPP" buttons next to any coordinate-looking span we can safely parse.
  function addCopyButtons(root = document) {
    root.querySelectorAll('span.text-code').forEach(span => {
      if (span.dataset.vppButtonAdded) return;

      const hasCoords = Boolean(parseCoords(span.textContent));
      const isPositionCoords = isPositionValueSpan(span) && Boolean(parseCoords(span.textContent));
      if (!hasCoords && !isPositionCoords) return;

      span.dataset.vppButtonAdded = '1';

      const btn = document.createElement('button');
      btn.className = 'vpp-copy-btn';
      btn.type = 'button';
      btn.textContent = 'Copy VPP';
      btn.style.cssText = `
        margin-left: 6px; background: #222; color: #fff;
        border: 1px solid #444; border-radius: 6px; cursor: pointer;
        font-size: 12px; padding: 2px 6px;
      `;
      btn.addEventListener('mouseenter', () => (btn.style.background = '#333'));
      btn.addEventListener('mouseleave', () => (btn.style.background = '#222'));

      btn.addEventListener('click', async () => {
        const vppNow = parseCoords(span.textContent || '');
        if (!vppNow) {
          toast('Could not find coordinates to copy.');
          return;
        }
        const copied = await copyText(vppNow);
        toast(copied ? `Copied: ${vppNow}` : 'Could not copy coordinates.');
      });

      span.after(btn);
    });
  }

  // Coord refreshes are debounced so a burst of DOM mutations only triggers one scan.
  const scheduleCoordRefresh = makeScheduler(() => addCopyButtons());
  addCopyButtons();

  /*************** Ban entry helper ***************/
  // Profile URLs contain the CFTools id, so this is the fastest way to find it.
  function getCfIdFromUrl(href = location.href) {
    try {
      const u = new URL(href);
      const parts = u.pathname.split('/').filter(Boolean);
      const i = parts.indexOf('profile');
      if (i !== -1 && parts[i + 1]) return parts[i + 1];
    } catch {}
    const m = href.match(/\/profile\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  // Fallback: if the URL format changes, try to read the visible CFTools ID from the page.
  function getCfIdFromPage() {
    const labels = document.querySelectorAll('.profile-container-item');
    for (const item of labels) {
      const label = item.querySelector('.h6');
      if (!/cftools id/i.test(label?.textContent || '')) continue;

      const valueNode = item.querySelector('.text-copyable.text-code');
      const value = (valueNode?.childNodes?.[0]?.textContent || valueNode?.textContent || '').trim();
      if (value) return value;
    }

    return '';
  }

  function getCfId() {
    return getCfIdFromUrl() || getCfIdFromPage();
  }

  // Reads the visible in-game name from the profile summary card.
  function getProfileName() {
    const candidates = [
      '.card-body.position-relative .row .col h3.mb-0',
      '.card-body .row .col h3.mb-0',
      'div.col-lg-4.col-sm-12 div.col h3.mb-0',
    ];

    for (const selector of candidates) {
      const headings = document.querySelectorAll(selector);
      for (const heading of headings) {
        const text = (heading.textContent || '').trim();
        if (!text) continue;
        if (/aliases:/i.test(text)) continue;
        return text;
      }
    }

    return '';
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Debounces repeated calls into one repaint-cycle refresh.
  // This keeps MutationObserver traffic from re-running expensive DOM scans dozens of times.
  function makeScheduler(fn) {
    let queued = false;

    return () => {
      if (queued) return;
      queued = true;

      requestAnimationFrame(() => {
        queued = false;
        Promise.resolve(fn()).catch(err => {
          console.error('Scheduled refresh failed:', err);
        });
      });
    };
  }

  // Helper used by observers: true if a new node is either the thing we care about
  // or contains it somewhere inside.
  function nodeMatchesOrContains(node, selector) {
    if (!(node instanceof Element)) return false;
    return node.matches(selector) || Boolean(node.querySelector(selector));
  }

  // Helper used by observers to ignore unrelated DOM churn.
  function mutationsContainRelevantNode(mutations, selector) {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && nodeMatchesOrContains(mutation.target, selector)) {
        return true;
      }

      for (const node of mutation.addedNodes) {
        if (nodeMatchesOrContains(node, selector)) return true;
      }
    }
    return false;
  }

  // CFTools behaves like a single-page app, so route changes do not always reload the page.
  // This hooks pushState/replaceState/back-forward navigation so our buttons get refreshed.
  function installRouteWatcher(onRouteChange) {
    let lastHref = location.href;

    const notifyIfChanged = () => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      onRouteChange();
    };

    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      setTimeout(notifyIfChanged, 0);
      return result;
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      setTimeout(notifyIfChanged, 0);
      return result;
    };

    window.addEventListener('popstate', notifyIfChanged);
  }

  function getCleanText(node) {
    return (node?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // Finds left-side profile links like Overview / Identities / Activities.
  function findProfileLink(label) {
    const links = document.querySelectorAll('.profile-links .profile-link.text-muted');
    for (const link of links) {
      if ((link.textContent || '').trim().toLowerCase() === label.toLowerCase()) {
        return link;
      }
    }
    return null;
  }

  function getActiveServerLink() {
    return document.querySelector('.profile-links .profile-server-link.profile-link-active');
  }

  // The active server is used in the Discord ban template.
  function getActiveServerName() {
    const activeServer = getActiveServerLink();
    if (!activeServer) return '';

    const text = getCleanText(activeServer);
    return text.replace(/\s+/g, ' ').trim();
  }

  // In the Identities screen, Steam64 is shown in a readonly input with a nearby Copy button.
  // This intentionally avoids grabbing any random readonly 17-digit field elsewhere on the page.
  function readSteam64FromInputs() {
    const groups = document.querySelectorAll('.input-group.w-100.input-group-lg');
    for (const group of groups) {
      const input = group.querySelector('input.form-control[readonly]');
      const copyButton = group.querySelector('.input-group-append .btn.btn-primary');
      if (!input || !copyButton) continue;

      const value = (input.value || '').trim();
      if (/^\d{17}$/.test(value)) return value;
    }
    return '';
  }

  // Waits until the Identities view has actually rendered the Steam64 input.
  async function waitForSteam64(timeoutMs = 10000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const steam64 = readSteam64FromInputs();
      if (steam64) return steam64;
      await delay(200);
    }
    throw new Error('Timed out waiting for Steam64 in identities view.');
  }

  // Temporarily switches to Identities, reads Steam64, then returns to the active server view.
  // This only clicks navigation links, not destructive action buttons.
  async function fetchSteam64FromUi() {
    const activeServer = getActiveServerLink();
    const activeServerName = getActiveServerName();
    const identitiesLink = findProfileLink('Identities');
    if (!identitiesLink) {
      throw new Error('Could not find the Identities tab.');
    }

    identitiesLink.click();
    await delay(250);

    const steam64 = await waitForSteam64();

    if (activeServer) {
      activeServer.click();
    }

    return {
      steam64,
      server: activeServerName,
    };
  }

  // Builds the Discord-friendly ban entry text that gets copied to the clipboard.
  function buildBanEntry(steam64, serverName = '', reason = '', term = '', ignName = '') {
    const ign = ignName || getProfileName();
    const cftUrl = location.href;
    const server = serverName || getActiveServerName();

    return [
      `IngameName (IGN): ${ign}`,
      `CFTurl (CFT): ${cftUrl}`,
      `Steamid64 (S64): ${steam64 || ''}`,
      'DC ID: ',
      `Server: ${server}`,
      `Reason: ${reason}`,
      `Term: ${term}`,
      'Evidence: ',
    ].join('\n');
  }

  /*************** Trace compare helper ***************/
  // sessionStorage lets the compare continue after navigating from profile A to profile B.
  const TRACE_COMPARE_KEY = 'codex-trace-compare-state';
  // Safety valve so an abandoned compare job does not wake up much later.
  const TRACE_COMPARE_RESUME_TTL_MS = 5 * 60 * 1000;
  let traceCompareRunning = false;

  // Snapshot of the current profile for reporting and resume safety checks.
  function getCurrentProfileSummary() {
    return {
      url: location.href,
      cfid: getCfId(),
      name: getProfileName(),
    };
  }

  function loadTraceCompareState() {
    try {
      return JSON.parse(sessionStorage.getItem(TRACE_COMPARE_KEY) || 'null');
    } catch {
      return null;
    }
  }

  // Every saved state gets a timestamp so it can expire automatically.
  function saveTraceCompareState(state) {
    sessionStorage.setItem(TRACE_COMPARE_KEY, JSON.stringify({
      createdAt: Date.now(),
      ...state,
    }));
  }

  function clearTraceCompareState() {
    sessionStorage.removeItem(TRACE_COMPARE_KEY);
  }

  // Used to confirm we resumed on the profile we expected to be on.
  function getProfileIdFromUrl(href) {
    return getCfIdFromUrl(href || '');
  }

  function isTraceCompareStateExpired(state) {
    if (!state?.createdAt) return true;
    return (Date.now() - state.createdAt) > TRACE_COMPARE_RESUME_TTL_MS;
  }

  // Top nav inside the Identities area: "Identities" / "Traces".
  function findTopNavLink(label) {
    const links = document.querySelectorAll('.c-nav-link');
    for (const link of links) {
      if (getCleanText(link).toLowerCase() === label.toLowerCase()) {
        return link;
      }
    }
    return null;
  }

  function getActiveTopNavLabel() {
    const activeItem = document.querySelector('.c-nav-item-active .c-nav-link, .c-nav-item.active .c-nav-link');
    return getCleanText(activeItem);
  }

  // Polls until a piece of UI exists. Useful because CFTools renders a lot of views asynchronously.
  async function waitForElement(getter, timeoutMs = 10000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const result = getter();
      if (result) return result;
      await delay(200);
    }
    throw new Error('Timed out waiting for page content.');
  }

  // Basic "profile page is ready" check before we start clicking around.
  async function waitForPageReady() {
    await waitForElement(() => document.querySelector('.profile-links'));
    await waitForElement(() => document.querySelector('.profile-container-left, .card-body.position-relative'));
  }

  async function clickProfileLink(label) {
    const link = await waitForElement(() => findProfileLink(label), 15000);
    clickElement(link);
    return link;
  }

  // Some CFTools UI elements behave more reliably with a real mouse-event sequence
  // than with a plain element.click(), so this is used for navigation-style controls.
  function clickElement(element) {
    if (!element) return false;

    const eventView = element.ownerDocument?.defaultView || null;
    const mouseOptions = eventView
      ? { bubbles: true, cancelable: true, view: eventView }
      : { bubbles: true, cancelable: true };

    try {
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch {}

    try {
      element.click();
    } catch {}

    element.dispatchEvent(new MouseEvent('mousedown', mouseOptions));
    element.dispatchEvent(new MouseEvent('mouseup', mouseOptions));
    return element.dispatchEvent(new MouseEvent('click', mouseOptions));
  }

  // Finds the server links in the left profile sidebar that show the blue person badge,
  // which means the player has server-specific data available there.
  function getServerEntryNames() {
    const names = new Set();
    const links = document.querySelectorAll('.profile-links .profile-server-link');

    for (const link of links) {
      const hasEntryBadge = Boolean(link.querySelector('.badge.badge-primary .fa-user'));
      if (!hasEntryBadge) continue;

      const name = getCleanText(link);
      if (name) names.add(name);
    }

    return Array.from(names);
  }

  function findServerLinkByName(serverName) {
    const links = document.querySelectorAll('.profile-links .profile-server-link');
    for (const link of links) {
      const text = getCleanText(link);
      if (text === serverName || text.startsWith(serverName)) {
        return link;
      }
    }
    return null;
  }

  function findIpHistoryButton() {
    const buttons = document.querySelectorAll('button.btn.btn-primary.btn-rounded.btn-sm');
    for (const button of buttons) {
      if (getCleanText(button) === 'IP history') {
        return button;
      }
    }
    return null;
  }

  function getIpHistoryModal() {
    const modals = document.querySelectorAll('.modal-content');
    for (const modal of modals) {
      const title = getCleanText(modal.querySelector('.modal-title'));
      if (title === 'IP history') {
        return modal;
      }
    }
    return null;
  }

  function extractIpsFromModal(modal) {
    const ips = [];
    const seen = new Set();
    const ipNodes = modal.querySelectorAll('tbody th .text-copyable');

    for (const node of ipNodes) {
      const value = getCleanText(node);
      if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) continue;
      if (seen.has(value)) continue;

      seen.add(value);
      ips.push(value);
    }

    return ips;
  }

  async function closeIpHistoryModal(modal) {
    const closeButton = modal.querySelector('.modal-header .close');
    if (!closeButton) return;

    clickElement(closeButton);
    await waitForElement(() => !getIpHistoryModal(), 10000);
  }

  async function openServerEntry(serverName, timeoutMs = 15000) {
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const serverLink = await waitForElement(() => findServerLinkByName(serverName), 5000);
      const ipButtonBefore = findIpHistoryButton();
      clickElement(serverLink);

      try {
        await waitForElement(() => {
          const refreshedServerLink = findServerLinkByName(serverName);
          const activeServerName = getActiveServerName();
          const isActive = Boolean(refreshedServerLink?.classList.contains('profile-link-active'));
          const ipButton = findIpHistoryButton();
          return ((isActive || activeServerName === serverName) && ipButton)
            || (ipButton && ipButton !== ipButtonBefore)
            ? ipButton
            : null;
        }, 4000);
        return;
      } catch {}

      await delay(250);
    }

    throw new Error(`Timed out opening server entry for ${serverName}.`);
  }

  // Goes back to Overview, then checks every server entry that has the blue badge
  // and collects all IPs from the IP history modal.
  async function collectAllIps() {
    const collected = new Set();

    await clickProfileLink('Overview');
    await waitForElement(() => {
      return document.querySelector('.card-body.position-relative')
        || document.querySelector('.profile-links .profile-server-link');
    }, 15000);

    const serverNames = getServerEntryNames();
    for (const serverName of serverNames) {
      await openServerEntry(serverName);

      const ipButton = await waitForElement(() => findIpHistoryButton(), 10000);
      clickElement(ipButton);

      const modal = await waitForElement(() => getIpHistoryModal(), 10000);
      const ips = extractIpsFromModal(modal);
      ips.forEach(ip => collected.add(ip));

      await closeIpHistoryModal(modal);
    }

    return Array.from(collected);
  }

  // Opens Identities, then Traces, and waits until the trace content is really visible.
  async function openTracesTab() {
    await waitForPageReady();
    await clickProfileLink('Identities');
    await waitForElement(() => findTopNavLink('Traces'), 15000);

    const tracesNav = await waitForElement(() => findTopNavLink('Traces'), 15000);
    tracesNav.click();
    await waitForElement(() => getActiveTopNavLabel().toLowerCase() === 'traces', 15000);
    await waitForElement(() => extractTracesFromPage().length || document.querySelector('.btn-group.btn-group-sm'), 15000);
  }

  // Only keep cards that actually represent a trace name entry.
  // This prevents unrelated cards on the page from being treated as trace values.
  function getTraceCards() {
    return Array.from(document.querySelectorAll('.card .card-body')).filter(cardBody => {
      const label = getCleanText(cardBody.querySelector('button.btn.btn-sm h6, button.btn-sm h6'));
      return label === 'Player Name' || label === 'Profile Name';
    });
  }

  // Pulls the visible trace values from the current page of results.
  function extractTracesFromPage() {
    const traces = [];
    const seen = new Set();

    for (const cardBody of getTraceCards()) {
      const copyable = cardBody.querySelector('h4 .text-copyable');
      if (!copyable) continue;

      const value = getCleanText(copyable);
      if (!value || seen.has(value)) continue;

      seen.add(value);
      traces.push(value);
    }

    return traces;
  }

  // Finds the traces pagination group by looking for the left/right arrow buttons and an active page.
  function getTracePaginationNextButton() {
    const groups = document.querySelectorAll('.btn-group.btn-group-sm');
    for (const group of groups) {
      const buttons = group.querySelectorAll('button');
      if (buttons.length < 3) continue;
      const firstArrow = buttons[0].querySelector('.fa-arrow-left');
      const lastArrow = buttons[buttons.length - 1].querySelector('.fa-arrow-right');
      const activePage = group.querySelector('.btn-primary h5');
      if (!firstArrow || !lastArrow || !activePage) continue;
      return buttons[buttons.length - 1];
    }
    return null;
  }

  // Current page number, used to detect when pagination really advanced.
  function getTracePageNumber() {
    const activePage = document.querySelector('.btn-group.btn-group-sm .btn-primary h5');
    return getCleanText(activePage);
  }

  // Walks every traces page and collects a de-duplicated set of names.
  // pageGuard prevents an accidental infinite loop if the site ever changes.
  async function collectAllTraces() {
    const collected = new Set();
    let pageGuard = 0;

    while (pageGuard < 200) {
      pageGuard += 1;

      const pageTraces = extractTracesFromPage();
      pageTraces.forEach(trace => collected.add(trace));

      const nextButton = getTracePaginationNextButton();
      if (!nextButton) break;

      const disabled = nextButton.disabled || nextButton.classList.contains('disabled');
      if (disabled) break;

      const beforeSnapshot = pageTraces.join('|');
      const beforePageNumber = getTracePageNumber();
      nextButton.click();

      // Wait until either the page number changed or the visible results changed.
      await waitForElement(() => {
        const afterSnapshot = extractTracesFromPage().join('|');
        const afterPageNumber = getTracePageNumber();
        return (afterPageNumber && afterPageNumber !== beforePageNumber)
          || (afterSnapshot && afterSnapshot !== beforeSnapshot);
      }, 10000);

      await delay(250);
    }

    return Array.from(collected);
  }

  // Final compare output keeps the report simple: shared traces and shared IPs.
  function buildTraceCompareReport(sourceProfile, targetProfile, sourceTraces, targetTraces, sourceIps, targetIps) {
    const targetSet = new Map(targetTraces.map(trace => [trace.toLowerCase(), trace]));
    const shared = sourceTraces
      .filter(trace => targetSet.has(trace.toLowerCase()))
      .map(trace => targetSet.get(trace.toLowerCase()) || trace)
      .sort((a, b) => a.localeCompare(b));

    const uniqueShared = Array.from(new Set(shared));
    const targetIpSet = new Set(targetIps);
    const sharedIps = Array.from(new Set(sourceIps.filter(ip => targetIpSet.has(ip)))).sort((a, b) => a.localeCompare(b));

    return [
      'Shared Traces:',
      ...(uniqueShared.length ? uniqueShared : ['None found']),
      '',
      'Shared IPs:',
      ...(sharedIps.length ? sharedIps : ['None found']),
    ].join('\n');
  }

  // Only allow compare targets that look like real CFTools profile URLs.
  function normalizeCompareTargetUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, location.origin);
      const hostname = url.hostname.toLowerCase();
      const isCfToolsHost = hostname === 'cftools.cloud'
        || hostname === 'app.cftools.cloud'
        || hostname.endsWith('.cftools.cloud');
      const targetCfid = getCfIdFromUrl(url.href);

      if (!isCfToolsHost || !targetCfid) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  // Button shown on the Identities area for launching a trace compare job.
  function createTraceCompareButton() {
    const btn = document.createElement('button');
    btn.id = 'trace-compare-btn';
    btn.type = 'button';
    btn.textContent = 'Compare Traces';
    btn.style.cssText = `
      margin-left: 10px;
      background: #1f6f4a;
      color: #fff;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      line-height: 1.2;
      padding: 6px 10px;
      white-space: nowrap;
    `;
    btn.addEventListener('mouseenter', () => (btn.style.background = '#27885b'));
    btn.addEventListener('mouseleave', () => (btn.style.background = '#1f6f4a'));
    btn.addEventListener('click', async () => {
      const targetUrlInput = (window.prompt('Paste the other profile URL:', '') || '').trim();
      if (!targetUrlInput) return;

      const targetUrl = normalizeCompareTargetUrl(targetUrlInput);
      if (!targetUrl) {
        toast('Please enter a valid CFTools profile URL.');
        return;
      }

      const sourceProfile = getCurrentProfileSummary();
      saveTraceCompareState({
        stage: 'collect-source',
        sourceProfile,
        targetUrl,
      });

      toast('Starting trace comparison...');
      await resumeTraceCompareWorkflow();
    });
    return btn;
  }

  // Makes sure the Compare Traces button exists once, and only in the Traces nav area.
  function ensureTraceCompareButton() {
    const tracesNav = findTopNavLink('Traces');
    const existing = document.getElementById('trace-compare-btn');

    if (!tracesNav) {
      if (existing) existing.remove();
      return;
    }

    const navItem = tracesNav.closest('.c-nav-item');
    if (!navItem) {
      if (existing) existing.remove();
      return;
    }

    const navList = navItem.parentElement;
    if (!navList) {
      if (existing) existing.remove();
      return;
    }

    if (existing && existing.parentElement === navList) return;
    if (existing) existing.remove();

    navList.appendChild(createTraceCompareButton());
  }

  // Two-stage workflow:
  // 1. Collect traces on the current profile.
  // 2. Navigate to the target profile and collect theirs.
  // 3. Copy and show the overlap report.
  async function resumeTraceCompareWorkflow() {
    if (traceCompareRunning) return;

    const state = loadTraceCompareState();
    if (!state) return;
    if (isTraceCompareStateExpired(state)) {
      clearTraceCompareState();
      return;
    }

    traceCompareRunning = true;

    try {
      if (state.stage === 'collect-source') {
        const expectedSourceCfid = state.sourceProfile?.cfid || getProfileIdFromUrl(state.sourceProfile?.url);
        const currentCfid = getCfId();
        if (expectedSourceCfid && currentCfid && expectedSourceCfid !== currentCfid) {
          return;
        }

        toast('Collecting traces from first profile...');
        await openTracesTab();
        const sourceTraces = await collectAllTraces();
        toast('Collecting IPs from first profile...');
        const sourceIps = await collectAllIps();

        saveTraceCompareState({
          stage: 'collect-target',
          sourceProfile: state.sourceProfile,
          sourceTraces,
          sourceIps,
          targetUrl: state.targetUrl,
        });

        // Move to the second profile so the workflow can continue there.
        location.href = state.targetUrl;
        return;
      }

      if (state.stage === 'collect-target') {
        const expectedTargetCfid = getProfileIdFromUrl(state.targetUrl);
        const currentCfid = getCfId();
        if (expectedTargetCfid && currentCfid && expectedTargetCfid !== currentCfid) {
          return;
        }

        toast('Collecting traces from second profile...');
        await openTracesTab();
        const targetTraces = await collectAllTraces();
        toast('Collecting IPs from second profile...');
        const targetIps = await collectAllIps();
        const targetProfile = getCurrentProfileSummary();
        const report = buildTraceCompareReport(
          state.sourceProfile,
          targetProfile,
          state.sourceTraces || [],
          targetTraces,
          state.sourceIps || [],
          targetIps
        );

        clearTraceCompareState();

        const copied = await copyText(report);
        console.log(report);
        toast(copied ? 'Trace comparison copied to clipboard.' : 'Trace comparison ready. Copy failed.');
        window.alert(report);
      }
    } catch (err) {
      console.error('Trace comparison failed:', err);
      clearTraceCompareState();
      toast('Trace comparison failed. Check console for details.');
    } finally {
      traceCompareRunning = false;
    }
  }

  // Button shown in the profile header that prepares a Discord ban-entry template.
  function createBanEntryButton() {
    const btn = document.createElement('button');
    btn.id = 'ban-entry-btn';
    btn.type = 'button';
    btn.textContent = 'Create Discord Ban Entry';
    btn.style.cssText = `
      margin-left: 10px;
      background: #c0392b;
      color: #fff;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      line-height: 1.2;
      padding: 6px 10px;
      white-space: nowrap;
    `;
    btn.addEventListener('mouseenter', () => (btn.style.background = '#e74c3c'));
    btn.addEventListener('mouseleave', () => (btn.style.background = '#c0392b'));
    btn.addEventListener('click', async () => {
      let steam64 = '';
      let ignName = getProfileName();
      let serverName = getActiveServerName();
      // Reason and term are manual because they depend on staff judgment.
      const reason = window.prompt('Enter ban reason:', '') || '';
      const term = window.prompt('Enter ban term:', '') || '';

      try {
        toast('Looking up Steam64 from Identities...');
        const result = await fetchSteam64FromUi();
        steam64 = result.steam64;
        serverName = result.server || serverName;
      } catch (err) {
        console.error('Steam64 lookup failed:', err);
        toast('Could not fetch Steam64 from Identities. Check console, copying template anyway.');
      }

      const banEntry = buildBanEntry(steam64, serverName, reason, term, ignName);
      const copied = await copyText(banEntry);
      toast(copied ? 'Ban entry template copied.' : 'Could not copy ban entry.');
    });
    return btn;
  }

  // Only show the Discord ban helper when we have enough profile context,
  // including an actively selected server.
  function ensureBanEntryButton() {
    const cfid = getCfId();
    const idSpan = document.querySelector('.profile-container-left .text-copyable.text-code');
    const existing = document.getElementById('ban-entry-btn');
    const activeServer = getActiveServerLink();

    if (!cfid || !idSpan || !activeServer) {
      if (existing) existing.remove();
      return;
    }

    const targetContainer = idSpan.closest('.profile-container-item');
    if (!targetContainer) {
      if (existing) existing.remove();
      return;
    }

    if (existing && existing.parentElement === targetContainer) return;
    if (existing) existing.remove();

    targetContainer.style.display = 'flex';
    targetContainer.style.alignItems = 'center';
    targetContainer.appendChild(createBanEntryButton());
  }

  // Profile-side refreshes are also debounced so repeated rerenders do not spam DOM work.
  const scheduleProfileRefresh = makeScheduler(async () => {
    ensureBanEntryButton();
    ensureTraceCompareButton();
    await resumeTraceCompareWorkflow();
  });

  // Mutation observers only react when relevant parts of the page are added.
  const COORD_OBSERVER_SELECTOR = 'span.text-code, .event-details';
  const PROFILE_OBSERVER_SELECTOR = '.profile-container-left, .profile-container-item, .text-copyable.text-code, .profile-links, .profile-link, .profile-server-link, .profile-link-active, .c-page-header, .c-nav, .c-nav-item, .c-nav-link, .card-body.position-relative';

  scheduleCoordRefresh();
  scheduleProfileRefresh();

  const coordObserver = new MutationObserver(mutations => {
    if (!mutationsContainRelevantNode(mutations, COORD_OBSERVER_SELECTOR)) return;
    scheduleCoordRefresh();
  });
  coordObserver.observe(document.body, { childList: true, subtree: true });

  const profileObserver = new MutationObserver(mutations => {
    if (!mutationsContainRelevantNode(mutations, PROFILE_OBSERVER_SELECTOR)) return;
    scheduleProfileRefresh();
  });
  profileObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });

  // Re-run setup when CFTools changes routes without doing a full page reload.
  installRouteWatcher(() => {
    scheduleCoordRefresh();
    scheduleProfileRefresh();
  });
})();
