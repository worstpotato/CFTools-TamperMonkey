// ==UserScript==
// @name         CFTools Tools: Helper Script
// @namespace    austin.cftools.vpp
// @version      5.25.0
// @description  Adds coordinate copy tools, Discord ban entry creation, profile trace comparison helpers, and server-log shortcuts for CFTools
// @match        https://*cftools*/*
// @match        https://*.cftools.cloud/*
// @match        https://cftools.cloud/*
// @updateURL    https://github.com/worstpotato/CFTools-TamperMonkey/raw/refs/heads/main/cftools-vpp.user.js
// @downloadURL  https://github.com/worstpotato/CFTools-TamperMonkey/raw/refs/heads/main/cftools-vpp.user.js
// @match        https://app.cftools.cloud/*
// @noframes
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  // Settings live in the script's own Tampermonkey storage, so they are toggled
  // from the Tampermonkey menu (click the toolbar icon while on a CFTools page)
  // and are also editable from the Storage tab in the dashboard.
  const SERVER_LOGS_BUTTONS_STORAGE_KEY = 'codex-server-logs-buttons';
  const BAN_ENTRY_BUTTON_STORAGE_KEY = 'codex-ban-entry-button';
  const CHEATER_SCAN_BUTTON_STORAGE_KEY = 'codex-cheater-scan-button';
  // Not a toggle: the server picker's last selection, as a JSON list of ids.
  const CHEATER_SCAN_SERVERS_STORAGE_KEY = 'codex-cheater-scan-servers';
  const DEBUG_MODE_STORAGE_KEY = 'codex-debug-mode';

  /*************** Toast ***************/
  // Small temporary message shown at the top of the page for status updates.
  // Tracked explicitly so the stack closes up when an earlier toast expires.
  // Deriving the offset from a live element count left gaps, and let a new toast
  // reuse the slot of one that was still fading out.
  const activeToasts = [];

  function repositionToasts() {
    activeToasts.forEach((el, index) => {
      el.style.top = `${20 + (index * 42)}px`;
    });
  }

  function toast(msg, durationMs = 1500) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.className = 'codex-toast';
    t.style.cssText = `
      position: fixed; left: 50%; top: 20px; transform: translateX(-50%);
      background: #111; color: #fff; padding: 8px 14px; border-radius: 999px;
      border: 1px solid #333; font: 13px system-ui,sans-serif;
      box-shadow: 0 8px 25px rgba(0,0,0,.3); z-index: 2147483647; opacity: 0;
      transition: opacity .15s ease-out, top .15s ease-out;
    `;
    document.body.appendChild(t);
    activeToasts.push(t);
    repositionToasts();

    requestAnimationFrame(() => (t.style.opacity = '1'));
    setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => {
        t.remove();
        const index = activeToasts.indexOf(t);
        if (index !== -1) activeToasts.splice(index, 1);
        repositionToasts();
      }, 200);
    }, durationMs);
  }

  /*************** Settings ***************/
  // Every GM_* API is feature-detected so the script still runs under a manager
  // that does not provide them - it just loses the menu toggles and falls back to
  // each setting's default. `typeof` on an undeclared identifier is safe and does
  // not throw.
  const HAS_GM_STORAGE = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
  const HAS_GM_MENU = typeof GM_registerMenuCommand === 'function';
  const HAS_GM_MENU_UNREGISTER = typeof GM_unregisterMenuCommand === 'function';
  const HAS_GM_VALUE_LISTENER = typeof GM_addValueChangeListener === 'function';

  // Tampermonkey has no declarative settings UI, so each setting is a menu command
  // whose caption reflects the action it performs, re-registered after every flip.
  const menuToggles = [];
  let menuCommandsRendered = false;

  // Re-registering a command appends it to the bottom of the menu, so every
  // command is re-registered together in declaration order whenever any one of
  // them changes. Refreshing just the one that changed would shuffle the menu.
  function renderMenuCommands() {
    if (!HAS_GM_MENU || !HAS_GM_STORAGE) return;
    // Without unregister support, refreshing captions would pile up duplicate
    // entries. Register once and leave the captions as they are.
    if (menuCommandsRendered && !HAS_GM_MENU_UNREGISTER) return;

    for (const toggle of menuToggles) {
      if (toggle.commandId === null) continue;
      try {
        GM_unregisterMenuCommand(toggle.commandId);
      } catch {}
      toggle.commandId = null;
    }

    for (const toggle of menuToggles) {
      try {
        toggle.commandId = GM_registerMenuCommand(toggle.caption(), toggle.flip);
      } catch {
        toggle.commandId = null;
      }
    }

    menuCommandsRendered = true;
  }

  // The value is cached because callers read it in hot paths (per log line, per
  // table row).
  function createMenuToggle({ storageKey, defaultValue, captionFor, toastFor, onChange }) {
    let enabled = defaultValue;
    if (HAS_GM_STORAGE) {
      try {
        enabled = GM_getValue(storageKey, defaultValue) === true;
      } catch {}
    }

    function apply(next) {
      enabled = next;
      renderMenuCommands();
      if (onChange) onChange(next);
    }

    function flip() {
      const next = !enabled;
      try {
        GM_setValue(storageKey, next);
      } catch {
        toast('Could not save the setting.');
        return;
      }
      apply(next);
      toast(toastFor(next));
    }

    if (HAS_GM_VALUE_LISTENER) {
      // Picks up a flip made in another CFTools tab, or an edit made by hand in
      // the dashboard's Storage tab, without needing a reload.
      try {
        GM_addValueChangeListener(storageKey, (key, oldValue, newValue, remote) => {
          if (!remote) return;
          apply(newValue === true);
        });
      } catch {}
    }

    menuToggles.push({ commandId: null, caption: () => captionFor(enabled), flip });

    return { isEnabled: () => enabled };
  }

  // Registered first so it sits above the debug entry in the Tampermonkey menu.
  // The refresh puts the buttons back or strips them from the page right away;
  // onChange only ever fires after the script has finished loading, so reaching
  // the scheduler defined further down is safe.
  const serverLogsButtonsToggle = createMenuToggle({
    storageKey: SERVER_LOGS_BUTTONS_STORAGE_KEY,
    defaultValue: true,
    captionFor: enabled => `${enabled ? 'Hide' : 'Show'} Server Logs buttons`,
    toastFor: enabled => (enabled ? 'Server Logs buttons shown.' : 'Server Logs buttons hidden.'),
    onChange: () => scheduleServerLogsRefresh(),
  });

  function isServerLogsButtonsEnabled() {
    return serverLogsButtonsToggle.isEnabled();
  }

  // Same deal as the toggle above: the refresh takes the button away or puts it
  // back immediately, and onChange cannot run before the scheduler exists.
  const banEntryButtonToggle = createMenuToggle({
    storageKey: BAN_ENTRY_BUTTON_STORAGE_KEY,
    defaultValue: true,
    captionFor: enabled => `${enabled ? 'Hide' : 'Show'} Create Discord Ban Entry button`,
    toastFor: enabled => (enabled
      ? 'Create Discord Ban Entry button shown.'
      : 'Create Discord Ban Entry button hidden.'),
    onChange: () => scheduleProfileRefresh(),
  });

  function isBanEntryButtonEnabled() {
    return banEntryButtonToggle.isEnabled();
  }

  // Dashboard-side helper. Same deal again: the refresh puts the button on the
  // player list or takes it away immediately.
  const cheaterScanButtonToggle = createMenuToggle({
    storageKey: CHEATER_SCAN_BUTTON_STORAGE_KEY,
    defaultValue: true,
    captionFor: enabled => `${enabled ? 'Hide' : 'Show'} Scan Bans buttons`,
    toastFor: enabled => (enabled ? 'Scan Bans buttons shown.' : 'Scan Bans buttons hidden.'),
    onChange: () => scheduleProfileRefresh(),
  });

  function isCheaterScanButtonEnabled() {
    return cheaterScanButtonToggle.isEnabled();
  }

  // Verbose console logging for when CFTools changes its markup and a button
  // stops appearing.
  const debugModeToggle = createMenuToggle({
    storageKey: DEBUG_MODE_STORAGE_KEY,
    defaultValue: false,
    captionFor: enabled => `${enabled ? 'Disable' : 'Enable'} debug logging`,
    toastFor: enabled => (enabled ? 'Debug logging enabled.' : 'Debug logging disabled.'),
  });

  function isDebugModeEnabled() {
    return debugModeToggle.isEnabled();
  }

  function debugLog(...args) {
    if (!isDebugModeEnabled()) return;
    console.log(...args);
  }

  renderMenuCommands();

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
  // Bare [x, y, z] arrays are only accepted when the caller confirms the span
  // belongs to a "position:" field, so random bracketed number triples on the
  // page do not get copy buttons.
  function parseCoords(text, options = {}) {
    const { allowBareBrackets = false } = options;
    const rawText = text || '';
    const m = XYZ_COORD_RE.exec(rawText)
      || POSITION_COORD_RE.exec(rawText)
      || (allowBareBrackets ? BRACKET_COORD_RE.exec(rawText) : null);
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

      const allowBareBrackets = isPositionValueSpan(span);
      if (!parseCoords(span.textContent, { allowBareBrackets })) return;

      span.dataset.vppButtonAdded = '1';

      const btn = document.createElement('button');
      btn.className = 'vpp-copy-btn';
      btn.type = 'button';
      btn.textContent = 'Copy X, Z, Y';
      btn.style.cssText = `
        margin-left: 6px; background: #222; color: #fff;
        border: 1px solid #444; border-radius: 6px; cursor: pointer;
        font-size: 12px; padding: 2px 6px;
      `;
      btn.addEventListener('mouseenter', () => (btn.style.background = '#333'));
      btn.addEventListener('mouseleave', () => (btn.style.background = '#222'));

      btn.addEventListener('click', async () => {
        const vppNow = parseCoords(span.textContent || '', { allowBareBrackets: isPositionValueSpan(span) });
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

    // The flag clears only once fn has settled, so two async refreshes cannot
    // interleave. It used to clear before fn even ran.
    const run = () => {
      Promise.resolve()
        .then(fn)
        .catch(err => {
          console.error('Scheduled refresh failed:', err);
        })
        .finally(() => {
          queued = false;
        });
    };

    return () => {
      if (queued) return;
      queued = true;

      // requestAnimationFrame never fires in a background tab, which could leave a
      // finished comparison report waiting until the user switched back.
      if (document.hidden) {
        setTimeout(run, 100);
      } else {
        requestAnimationFrame(run);
      }
    };
  }

  function getRelevantElement(node) {
    if (!node) return null;
    if (node.nodeType === Node.ELEMENT_NODE) return node;
    if (node.nodeType === Node.TEXT_NODE) return node.parentElement;
    return null;
  }

  // Helper used by observers: true if a new node is either the thing we care about
  // or contains it somewhere inside.
  // includeAncestors also accepts a node sitting inside a match, which is how a
  // re-rendered <td> or a changed text node registers as a row change. It is
  // deliberately off for attribute mutations, where it would make every class
  // toggle anywhere inside a card look relevant.
  // includeDescendants scans the node's own subtree. That is the right cost for an
  // added or removed node, where the subtree is the thing that changed, but it is
  // wrong for a mutation *target*: the target can be any ancestor, and scanning its
  // subtree made a change near the top of the document match on something unrelated
  // far below it. Appending a toast to <body> matched, because <body> contains a
  // profile container somewhere, so ordinary churn forced a full refresh per frame.
  function nodeMatchesOrContains(node, selector, { includeAncestors = true, includeDescendants = true } = {}) {
    const element = getRelevantElement(node);
    if (!element) return false;
    if (element.matches(selector)) return true;
    if (includeAncestors && element.closest(selector)) return true;
    return includeDescendants ? Boolean(element.querySelector(selector)) : false;
  }

  // Helper used by observers to ignore unrelated DOM churn.
  function mutationsContainRelevantNode(mutations, selector) {
    for (const mutation of mutations) {
      const isRelevantType = mutation.type === 'attributes'
        || mutation.type === 'childList'
        || mutation.type === 'characterData';
      if (!isRelevantType) continue;

      // For the target itself: an attribute change is only relevant on a matching
      // element, while a childList/characterData change is also relevant inside one
      // (a re-rendered <td> or a changed text node registers as a row change).
      if (nodeMatchesOrContains(mutation.target, selector, {
        includeAncestors: mutation.type !== 'attributes',
        includeDescendants: false,
      })) {
        return true;
      }

      for (const node of mutation.addedNodes) {
        if (nodeMatchesOrContains(node, selector)) return true;
      }

      // Removals matter too: the ensure* helpers tear their buttons down when the
      // section they attach to disappears.
      for (const node of mutation.removedNodes) {
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

  function cleanWhitespace(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  // Takes a node. Pass strings to cleanWhitespace instead - a string has no
  // .textContent, so this would silently return ''.
  function getCleanText(node) {
    return cleanWhitespace(node?.textContent);
  }

  // The text that belongs to this element itself, with anything nested inside it
  // left out. Used where a label shares its element with a badge or an icon:
  // "Bans 2 public ban(s)" has to read back as just "Bans".
  function getOwnText(node) {
    return node ? cleanWhitespace(getBoldDirectText(node)) : '';
  }

  /*************** Server logs helper ***************/
  // Jumping into a server's logs needs that server's CFTools id, but the profile
  // sidebar only offers its name: `.profile-server-link` is a plain div with no
  // href and no data attribute. The id is on the page all the same. CFTools' own
  // nav renders a card per server holding both the name and links to
  // /server/<id>/..., on every page including profiles, so the name -> id map is
  // read back out of the DOM rather than pinned in the source. That also means a
  // server added, renamed or removed in CFTools needs no change here.
  const SERVER_LINK_SELECTOR = 'a[href*="/server/"]';
  const SERVER_ID_HREF_RE = /\/server\/([a-f0-9]{24})(?:\/|$)/i;
  // A name sits next to other text in a card ("KKCherno#1 112 / 115"), so a match
  // has to land on a whole name rather than mid-word. Without this "KKCherno#1"
  // resolves to "KKCherno#10" and quietly opens the wrong server's logs.
  const SERVER_NAME_BOUNDARY_RE = /[\s([)\]]/;
  // addServerLogsButtons runs on every table mutation and the walk below is far
  // too much work to repeat per row, so the map is cached and rebuilt only when
  // the number of server links changes. A rename that leaves the count alone is
  // picked up on the next reload, which is when the nav itself is re-rendered.
  let serverMapCache = { linkCount: -1, servers: [] };

  function getServerIdFromHref(href) {
    const match = SERVER_ID_HREF_RE.exec(href || '');
    return match ? match[1].toLowerCase() : null;
  }

  // Walks out from a server link until the next step up would take in a second
  // server, which lands on that server's own card: the smallest element holding
  // both its links and its name. Grouping by id instead of by class keeps this
  // working if CFTools renames the card element.
  function findServerCardForLink(link, serverId) {
    let card = link;
    let node = link;

    for (let depth = 0; depth < 8 && node.parentElement; depth += 1) {
      node = node.parentElement;

      const ids = new Set(
        Array.from(node.querySelectorAll(SERVER_LINK_SELECTOR))
          .map(anchor => getServerIdFromHref(anchor.getAttribute('href')))
          .filter(Boolean)
      );
      if (ids.size !== 1 || !ids.has(serverId)) break;

      card = node;
    }

    return card;
  }

  function getServerNameFromCard(card) {
    // CFTools gives the name its own element, so take it verbatim when it is
    // there. Everything below is for a card that does not have one.
    const namedElement = card.querySelector('.c-server-name');
    const namedText = getCleanText(namedElement);
    if (namedText) return namedText;

    // Such a card reads "<name> <online> / <slots>+<queue>" followed by its
    // buttons. The links go first, then everything from the player count on,
    // which leaves the name.
    const clone = card.cloneNode(true);
    clone.querySelectorAll('a, button').forEach(node => node.remove());

    const text = getCleanText(clone);
    const countIndex = text.search(/\d+\s*\/\s*\d+/);
    return cleanWhitespace(countIndex === -1 ? text : text.slice(0, countIndex));
  }

  function readServerMap() {
    const links = document.querySelectorAll(SERVER_LINK_SELECTOR);
    if (links.length === serverMapCache.linkCount) return serverMapCache.servers;

    const servers = [];
    const seenIds = new Set();

    for (const link of links) {
      const id = getServerIdFromHref(link.getAttribute('href'));
      if (!id || seenIds.has(id)) continue;

      const name = getServerNameFromCard(findServerCardForLink(link, id));
      if (!name) continue;

      seenIds.add(id);
      servers.push({ name, normalized: name.toLowerCase(), id });
    }

    serverMapCache = { linkCount: links.length, servers };
    debugLog('[CFTools Tools] Server Logs debug: server map built', servers.length, servers);
    return servers;
  }

  function isServerNameBoundary(char) {
    return char === '' || SERVER_NAME_BOUNDARY_RE.test(char);
  }

  // The sidebar name and the nav name are rendered by CFTools from the same
  // string, so this is an exact hit in practice. The prefix pass only covers a
  // nav name carrying a suffix the sidebar drops, and is boundary-checked so it
  // cannot silently resolve to a neighbouring server.
  function getServerLogsServerIdFromName(name) {
    const wanted = cleanWhitespace(name).toLowerCase();
    if (!wanted) return null;

    const servers = readServerMap();

    const exact = servers.find(server => server.normalized === wanted);
    if (exact) return exact.id;

    const prefixed = servers.find(server => server.normalized.startsWith(wanted)
      && isServerNameBoundary(server.normalized.charAt(wanted.length)));
    return prefixed ? prefixed.id : null;
  }

  // For the card-text fallback. A card holding an activity table opens with its
  // server's name, so only the start of the text is considered: matching anywhere
  // in it lets an unrelated server mentioned further down win, which is exactly
  // how a KKNam#1 row ended up opening another server's logs.
  // Longest name first so a name that begins with a shorter server's name does
  // not lose to it.
  function findServerLogsServerIdAtTextStart(text) {
    const haystack = cleanWhitespace(text).toLowerCase();
    if (!haystack) return null;

    const servers = [...readServerMap()].sort((a, b) => b.normalized.length - a.normalized.length);
    const found = servers.find(server => haystack.startsWith(server.normalized)
      && isServerNameBoundary(haystack.charAt(server.normalized.length)));
    return found ? found.id : null;
  }

  // The activity view names the server it is showing in its own header. That is
  // the table's server; the sidebar's active link is a different control and is
  // not always in sync with it, so it is consulted only as a fallback.
  const ACTIVITY_SERVER_NAME_SELECTOR = '.option__title';
  // With the dropdown open, every server in the list renders a title of its own.
  const ACTIVITY_SERVER_OPTION_SELECTOR = '.multiselect__content, .multiselect__option, [role="listbox"], [role="option"]';

  function getActivityViewServerName() {
    const selected = document.querySelector(`.multiselect__single ${ACTIVITY_SERVER_NAME_SELECTOR}`);
    const selectedName = getCleanText(selected);
    if (selectedName) return selectedName;

    // Dropping the option list usually leaves exactly the selected value. If it
    // leaves more than one, the header cannot be read without guessing which
    // server the table belongs to, and no button beats the wrong server's logs.
    const candidates = Array.from(document.querySelectorAll(ACTIVITY_SERVER_NAME_SELECTOR))
      .filter(node => !node.closest(ACTIVITY_SERVER_OPTION_SELECTOR));
    if (candidates.length !== 1) return '';

    return getCleanText(candidates[0]);
  }

  // Ordered most to least authoritative. Each name is only accepted if it maps to
  // a server CFTools actually lists, which keeps an unrelated dropdown elsewhere
  // on the page from being mistaken for the server picker.
  function getServerLogsServerIdFromPage() {
    const names = [getActivityViewServerName(), getActiveServerName()];

    for (const name of names) {
      const id = getServerLogsServerIdFromName(name);
      if (id) return id;
    }

    return null;
  }

  // No trailing \b: it would anchor to the end of the whole alternation and
  // reject the forms these branches exist for ("gas infected", "broke both legs").
  const SERVER_LOGS_EVENT_RE = /\b(damaged by|killed by|murdered by|broke.{0,10}legs?|gas.{0,10}infect|infect.{0,10}gas)/i;
  const SERVER_LOGS_FILTER_KEY = 'codex-server-logs-filter';
  const SERVER_LOGS_FILTER_TTL_MS = 5 * 60 * 1000;
  const SERVER_LOGS_FILTER_MAX_ATTEMPTS = 3;
  let serverLogsFilterApplying = false;
  let serverLogsRefreshMutating = false;

  function isProfilePage() {
    return Boolean(getCfIdFromUrl());
  }

  function getServerLogsPageServerId() {
    const match = /\/server\/([a-f0-9]+)\/logs-server/i.exec(location.pathname);
    return match ? match[1] : null;
  }

  function isServerLogsPage() {
    return Boolean(getServerLogsPageServerId());
  }

  // Activity tables live inside cards that also open with the server's name. We
  // prefer the view's own header, but keep this card-text fallback in case
  // CFTools renders the table before the header finishes updating.
  function getServerLogsServerIdFromTable(table) {
    const pageServerId = getServerLogsServerIdFromPage();
    if (pageServerId) return pageServerId;

    let parent = table.parentElement;
    for (let i = 0; i < 6; i += 1) {
      if (!parent) break;
      // Once an ancestor is large enough to contain the server nav, its text
      // opens with the nav's own first server rather than this table's.
      if (parent.querySelector(SERVER_LINK_SELECTOR)) break;

      const className = parent.className || '';
      if (className.includes('card') || className.includes('c-force-height')) {
        const serverId = findServerLogsServerIdAtTextStart(getCleanText(parent));
        if (serverId) return serverId;
      }

      parent = parent.parentElement;
    }

    return null;
  }

  // CFTools renders activity timestamps with the viewer's own locale, so neither
  // the field order nor the clock is fixed:
  // - 8/14/2026, 08:46:02      (en-US, 24h)
  // - 5/13/2026, 11:33:10 PM   (en-US, 12h)
  // - 14/08/2026, 08:46:02     (en-GB, day first)
  // - 14.8.2026, 08:46:02      (de-DE, day first)
  // Guessing wrong here is silent and expensive: a day/month swap can shift the
  // log window by months, and a dropped PM shifts it by 12 hours.
  // The (?![a-z]) stops the meridiem branch from latching onto an ordinary word
  // when we fall back to matching against the whole row's text ("08:46:02 a match").
  const SERVER_LOGS_DATE_RE = /(\d{1,2})([./-])(\d{1,2})\2(\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])\.?\s?m\.?(?![a-z])/i;
  const SERVER_LOGS_DATE_RE_NO_MERIDIEM = /(\d{1,2})([./-])(\d{1,2})\2(\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/;
  let cachedLocaleDayFirst = null;

  // Asks the browser how it orders its own short dates. Only consulted when a
  // value is genuinely ambiguous (both numbers <= 12).
  function isLocaleDayFirst() {
    if (cachedLocaleDayFirst !== null) return cachedLocaleDayFirst;

    cachedLocaleDayFirst = false;
    try {
      const parts = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' })
        .formatToParts(new Date(2026, 0, 2));
      const fieldOrder = parts.filter(part => part.type === 'day' || part.type === 'month').map(part => part.type);
      cachedLocaleDayFirst = fieldOrder[0] === 'day';
    } catch {}

    return cachedLocaleDayFirst;
  }

  function parseServerLogsDate(text) {
    const rawText = (text || '').trim();
    const match = SERVER_LOGS_DATE_RE.exec(rawText) || SERVER_LOGS_DATE_RE_NO_MERIDIEM.exec(rawText);
    if (!match) return null;

    const [, firstField, separator, secondField, yearText, hourText, minuteText, secondText, meridiem] = match;
    const first = +firstField;
    const second = +secondField;

    // Dotted dates are day-first in every locale that uses them. Otherwise a
    // value above 12 can only be the day; if both could be either, defer to the
    // browser's own ordering.
    let dayFirst;
    if (separator === '.') dayFirst = true;
    else if (first > 12) dayFirst = true;
    else if (second > 12) dayFirst = false;
    else dayFirst = isLocaleDayFirst();

    const day = dayFirst ? first : second;
    const month = dayFirst ? second : first;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    let hour = +hourText;
    if (meridiem) {
      const isAfternoon = meridiem.toLowerCase() === 'p';
      if (hour === 12) hour = isAfternoon ? 12 : 0;
      else if (isAfternoon) hour += 12;
    }
    if (hour > 23) return null;

    const parsed = new Date(+yearText, month - 1, day, hour, +minuteText, +(secondText || 0));
    // Date silently rolls impossible values over (31 April becomes 1 May), so
    // reject anything that did not survive the round trip.
    if (parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;

    return parsed;
  }

  function formatServerLogsDatetime(date) {
    if (!date) return '';

    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
  }

  // Server-log geo search wants the on-map X/Y pair, not the VPP X/Z/Y order.
  function parseServerLogsCoords(text) {
    const match = /X:\s*(-?\d+(?:\.\d+)?)[^Y\n]{0,20}Y:\s*(-?\d+(?:\.\d+)?)/i.exec(text || '');
    if (!match) return null;

    return {
      x: parseFloat(match[1]),
      y: parseFloat(match[2]),
    };
  }

  function getServerLogsCoordsFromEventDetails(detailsDiv) {
    const labels = detailsDiv.querySelectorAll('b');
    let murdererCoords = null;
    let playerCoords = null;

    for (const label of labels) {
      const fieldName = getCleanText(label).toLowerCase();
      const valueNode = label.nextElementSibling;
      const valueText = valueNode?.textContent || '';

      if (fieldName.includes('player_position')) {
        playerCoords = parseServerLogsCoords(valueText);
      }
      if (fieldName.includes('murderer_position')) {
        murdererCoords = parseServerLogsCoords(valueText);
      }
    }

    return playerCoords || murdererCoords || null;
  }

  // The spread comes after createdAt so a re-save (see the failure counter below)
  // keeps the original timestamp and does not extend the TTL.
  function saveServerLogsFilter(filter) {
    try {
      localStorage.setItem(SERVER_LOGS_FILTER_KEY, JSON.stringify({
        createdAt: Date.now(),
        ...filter,
      }));
      return true;
    } catch (err) {
      console.error('Could not save the server-log filter:', err);
      return false;
    }
  }

  // A pending filter is only ever valid for the server it was created from.
  // Without that check a filter left behind by a blocked popup would ambush an
  // unrelated server's logs page later, and two rows opened back to back would
  // hand one tab the other's time window.
  function loadServerLogsFilter(serverId) {
    try {
      const filter = JSON.parse(localStorage.getItem(SERVER_LOGS_FILTER_KEY) || 'null');
      if (!filter) return null;
      if (filter.createdAt && (Date.now() - filter.createdAt) > SERVER_LOGS_FILTER_TTL_MS) {
        clearServerLogsFilter();
        return null;
      }
      if (serverId && filter.serverId !== serverId) return null;
      return filter;
    } catch {
      return null;
    }
  }

  function clearServerLogsFilter() {
    try {
      localStorage.removeItem(SERVER_LOGS_FILTER_KEY);
    } catch (err) {
      console.error('Could not clear the server-log filter:', err);
    }
  }

  // Counts failed auto-fill attempts so a filter that cannot be mapped stops
  // retrying (and re-toasting) on every table mutation until the TTL expires.
  function recordServerLogsFilterFailure(filter) {
    const attempts = (filter.attempts || 0) + 1;
    if (attempts >= SERVER_LOGS_FILTER_MAX_ATTEMPTS) {
      clearServerLogsFilter();
      toast('Server-log filter auto-fill stopped after repeated failures.', 5000);
      return;
    }
    saveServerLogsFilter({ ...filter, attempts });
  }

  function getServerLogsTimestampFromRow(row) {
    const candidates = [
      row.querySelector('td[aria-colindex="1"]')?.textContent || '',
      row.querySelector('td:first-child')?.textContent || '',
      row.textContent || '',
    ];

    for (const candidate of candidates) {
      const parsed = parseServerLogsDate(candidate);
      if (parsed) return parsed;
    }

    return null;
  }

  function getBoldDirectText(node) {
    return Array.from(node.childNodes)
      .filter(child => child.nodeType === Node.TEXT_NODE)
      .map(child => child.textContent)
      .join('');
  }

  // The qualification test on its own: does this row describe an event we can jump
  // to? Split out of getServerLogsRowContext so a row that already has a button can
  // be re-validated without also paying for timestamp parsing and coordinate
  // extraction, which addServerLogsButtons would then throw away.
  function isServerLogsActionCell(cell) {
    const bold = cell?.querySelector('b.text-code');
    if (!bold) return false;
    return SERVER_LOGS_EVENT_RE.test(getBoldDirectText(bold));
  }

  function findServerLogsActionCell(row) {
    if (!row) return null;

    const cells = row.querySelectorAll('td');
    if (cells.length < 2) return null;

    return Array.from(cells).find(isServerLogsActionCell) || null;
  }

  // knownServerId lets a caller that is walking many rows resolve the server once
  // per table instead of once per row.
  function getServerLogsRowContext(row, knownServerId = null) {
    if (!row) return null;

    const table = row.closest('table');
    if (!table) return null;

    const actionCell = findServerLogsActionCell(row);
    if (!actionCell) return null;

    const bold = actionCell.querySelector('b.text-code');
    const actionText = bold ? cleanWhitespace(getBoldDirectText(bold)) : '';
    const timestamp = getServerLogsTimestampFromRow(row);
    const detailsDiv = actionCell.querySelector('.event-details');
    const coords = detailsDiv ? getServerLogsCoordsFromEventDetails(detailsDiv) : null;
    const serverId = knownServerId || getServerLogsServerIdFromTable(table);

    return {
      row,
      table,
      actionCell,
      actionText,
      timestamp,
      detailsDiv,
      coords,
      serverId,
    };
  }

  function getServerLogsContextFromButton(button) {
    return getServerLogsRowContext(button?.closest('tr') || null);
  }

  function createServerLogsButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Server Logs';
    button.setAttribute('data-server-logs-btn', '1');
    button.style.cssText = `
      margin: 0 4px;
      background: #0d2137;
      color: #7ec8f7;
      border: 1px solid #1b6ca8;
      border-radius: 5px;
      cursor: pointer;
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.6;
      padding: 3px 10px;
      vertical-align: middle;
      position: relative;
      z-index: 2;
      pointer-events: auto;
    `;
    button.addEventListener('mouseenter', () => (button.style.background = '#143352'));
    button.addEventListener('mouseleave', () => (button.style.background = '#0d2137'));
    const handleActivate = () => {
      const context = getServerLogsContextFromButton(button);
      debugLog('[CFTools Tools] Server Logs debug: button context', context ? {
        actionText: context.actionText,
        serverId: context.serverId,
        timestamp: context.timestamp ? context.timestamp.toISOString() : null,
        coords: context.coords,
      } : null);

      if (!context) {
        toast('Could not read row for server logs.');
        return;
      }

      openServerLogs(context.serverId, context.timestamp, context.coords);
    };
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      handleActivate();
    });
    button.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      handleActivate();
    });
    return button;
  }

  function openServerLogs(serverId, dateObj, coords) {
    if (!serverId) {
      debugLog('[CFTools Tools] Server Logs debug: missing server id', { dateObj, coords });
      toast('Could not detect server. Select the correct tab.');
      return;
    }

    const filter = {
      serverId,
      startDate: dateObj ? formatServerLogsDatetime(new Date(dateObj.getTime() - (30 * 60 * 1000))) : '',
      endDate: dateObj ? formatServerLogsDatetime(new Date(dateObj.getTime() + (10 * 60 * 1000))) : '',
      geo: coords ? `${coords.x}, ${coords.y}` : '',
    };
    debugLog('[CFTools Tools] Server Logs debug: opening logs', {
      serverId,
      timestamp: dateObj ? dateObj.toISOString() : null,
      coords,
      filter,
    });
    saveServerLogsFilter(filter);

    const popup = window.open(`https://app.cftools.cloud/server/${serverId}/logs-server`, '_blank');
    debugLog('[CFTools Tools] Server Logs debug: popup result', Boolean(popup));

    if (!popup) {
      // Nothing is going to consume the filter, so drop it rather than leave it
      // waiting to fire on the next logs page the user happens to open.
      clearServerLogsFilter();
      toast('Popup blocked. Allow popups for CFTools.');
      return;
    }

    toast('Opening server logs...');
  }

  function removeAllServerLogsButtons(root = document) {
    root.querySelectorAll('[data-server-logs-btn]').forEach(button => button.remove());
  }

  // Reconciles buttons against rows instead of clearing and rebuilding them.
  // This runs on every relevant table mutation, so rebuilding meant re-walking
  // every card's text once per row on pages with large activity tables.
  function addServerLogsButtons(root = document) {
    if (!isServerLogsButtonsEnabled()) {
      removeAllServerLogsButtons(root);
      return;
    }
    if (!isProfilePage()) return;

    const pageServerId = getServerLogsServerIdFromPage();
    if (!pageServerId) {
      debugLog('[CFTools Tools] Server Logs debug: no server id for page',
        { activityName: getActivityViewServerName(), sidebarName: getActiveServerName() },
        readServerMap());
    }

    root.querySelectorAll('table').forEach(table => {
      const tableServerId = pageServerId || getServerLogsServerIdFromTable(table);

      table.querySelectorAll('tr').forEach(row => {
        const existing = row.querySelector('[data-server-logs-btn]');

        // Rows that already have a button are the steady state, and the button
        // reads its row again on click, so an already-placed one stays correct
        // even if the row's contents changed underneath it. Re-checking only the
        // cell the button already sits in keeps this loop from parsing a
        // timestamp and walking event details for every row on every table
        // mutation, only to discard the result.
        // If the action moved to a different cell this drops the button, and the
        // next pass re-adds it in the right place.
        if (existing) {
          if (!isServerLogsActionCell(existing.closest('td'))) existing.remove();
          return;
        }

        const context = getServerLogsRowContext(row, tableServerId);
        if (!context) return;

        const button = createServerLogsButton();
        debugLog('[CFTools Tools] Server Logs debug: adding button', {
          actionText: context.actionText,
          serverId: context.serverId,
          timestamp: context.timestamp ? context.timestamp.toISOString() : null,
          coords: context.coords,
        });

        const icon = context.actionCell.querySelector('i.fad, i.fa, i[class*="info"]');
        if (context.detailsDiv) {
          context.detailsDiv.insertAdjacentElement('beforebegin', button);
        } else if (icon) {
          icon.insertAdjacentElement('afterend', button);
        } else {
          context.actionCell.appendChild(button);
        }
      });
    });
  }

  function setServerLogsInputValue(input, value) {
    if (!input) return;

    input.focus();
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(input, value);
    } else {
      input.value = value;
    }

    ['input', 'change', 'blur'].forEach(eventName => {
      input.dispatchEvent(new Event(eventName, { bubbles: true }));
    });
    input.blur();
  }

  function ensureServerLogsCheckboxChecked(checkbox) {
    if (!checkbox || checkbox.checked) return;
    checkbox.click();
  }

  function getServerLogsFiltersRoot() {
    return Array.from(document.querySelectorAll('.c-table-header')).find(header => {
      const titleText = getCleanText(header.querySelector('.c-table-title'));
      return /^filters\b/i.test(titleText) && /search term/i.test(getCleanText(header));
    }) || null;
  }

  function getServerLogsFilterControl(root, labelText) {
    const normalizedLabel = labelText.toLowerCase();
    const label = Array.from(root.querySelectorAll('.custom-control-label')).find(node => getCleanText(node).toLowerCase() === normalizedLabel);
    if (!label) return null;

    const controlWrap = label.closest('.custom-control');
    const row = label.closest('.row');
    const checkbox = controlWrap?.querySelector('input[type="checkbox"]')
      || (label.getAttribute('for') ? root.querySelector(`input#${CSS.escape(label.getAttribute('for'))}`) : null);

    let input = null;
    if (normalizedLabel === 'start date' || normalizedLabel === 'end date') {
      input = row?.querySelector('input[type="datetime-local"]') || null;
    } else if (normalizedLabel === 'geo-search') {
      input = row?.querySelector('.input-group input[type="text"], input[type="text"]') || null;
    }

    return { checkbox, input };
  }

  async function ensureServerLogsFiltersExpanded(root) {
    if (getServerLogsFilterControl(root, 'Start date')) return;

    const toggle = root.querySelector('.c-table-title .badge.badge-primary, .c-table-title');
    if (toggle) {
      toggle.click();
      toast('Expanding filters...', 1500);
      // If the filters never expand, fall through and let the control-mapping
      // check below report the failure instead of throwing here.
      try {
        await waitForElement(() => {
          const refreshedRoot = getServerLogsFiltersRoot();
          return refreshedRoot && getServerLogsFilterControl(refreshedRoot, 'Start date');
        }, 5000);
      } catch {}
    }
  }

  async function applyPendingServerLogsFilter() {
    const pageServerId = getServerLogsPageServerId();
    if (!pageServerId) return;
    if (serverLogsFilterApplying) return;

    // Filters for a different server are left alone, not cleared: the tab they
    // were meant for may still be loading.
    const filter = loadServerLogsFilter(pageServerId);
    if (!filter) return;

    serverLogsFilterApplying = true;

    try {
      toast('Loading server-log filters...', 6000);
      let filtersRoot = null;
      try {
        filtersRoot = await waitForElement(() => getServerLogsFiltersRoot(), 15000);
      } catch {
        toast('Could not find server-log filters.');
        recordServerLogsFilterFailure(filter);
        return;
      }

      await delay(2000);

      await ensureServerLogsFiltersExpanded(filtersRoot);
      await delay(600);

      filtersRoot = getServerLogsFiltersRoot() || filtersRoot;
      const startControl = getServerLogsFilterControl(filtersRoot, 'Start date');
      const endControl = getServerLogsFilterControl(filtersRoot, 'End date');
      const geoControl = getServerLogsFilterControl(filtersRoot, 'Geo-Search');
      const startCheckbox = startControl?.checkbox || null;
      const startInput = startControl?.input || null;
      const endCheckbox = endControl?.checkbox || null;
      const endInput = endControl?.input || null;
      const geoCheckbox = geoControl?.checkbox || null;
      const geoInput = geoControl?.input || null;

      if (!startCheckbox || !startInput || !endCheckbox || !endInput || (filter.geo && (!geoCheckbox || !geoInput))) {
        toast('Could not map server-log filters.');
        recordServerLogsFilterFailure(filter);
        return;
      }

      ensureServerLogsCheckboxChecked(startCheckbox);
      await delay(300);
      ensureServerLogsCheckboxChecked(endCheckbox);
      await delay(300);
      if (filter.geo) {
        ensureServerLogsCheckboxChecked(geoCheckbox);
        await delay(300);
      }

      if (filter.startDate && startInput) {
        setServerLogsInputValue(startInput, filter.startDate);
        await delay(300);
      }
      if (filter.endDate && endInput) {
        setServerLogsInputValue(endInput, filter.endDate);
        await delay(300);
      }
      if (filter.geo && geoInput) {
        setServerLogsInputValue(geoInput, filter.geo);
        await delay(300);
      }

      clearServerLogsFilter();

      await delay(400);
      const searchButton = Array.from(filtersRoot.querySelectorAll('button')).find(button => /^\s*(search|buscar)\s*$/i.test((button.textContent || '').trim()));
      if (searchButton) {
        searchButton.click();
        toast('Server-log filters applied!', 4000);
      } else {
        toast('Filters filled - press Search manually.', 5000);
      }
    } finally {
      serverLogsFilterApplying = false;
    }
  }

  // Finds left-side profile links like Overview / Identities / Activities.
  // This deliberately does not require `text-muted`: the active link can drop that
  // class, and requiring it made clicking the section you are already on time out
  // after 15s and abort the whole comparison. Server rows live in the same list, so
  // they are excluded by class instead.
  function findProfileLink(label) {
    const links = document.querySelectorAll('.profile-links .profile-link');
    for (const link of links) {
      if (link.classList.contains('profile-server-link')) continue;
      if (getCleanText(link).toLowerCase() === label.toLowerCase()) {
        return link;
      }
    }
    return null;
  }

  function getSidebarServerLinks() {
    return Array.from(document.querySelectorAll('.profile-links .profile-server-link'));
  }

  function getActiveServerLink() {
    return document.querySelector('.profile-links .profile-server-link.profile-link-active');
  }

  function hasServerEntryBadge(link) {
    return Boolean(link?.querySelector('.badge.badge-primary .fa-user'));
  }

  // Records the active server as data rather than as an element reference, so it can
  // be re-resolved after the SPA re-renders. See findServerLink.
  function getActiveServerEntry() {
    const links = getSidebarServerLinks();
    const index = links.findIndex(link => link.classList.contains('profile-link-active'));
    if (index === -1) return null;
    return { name: getCleanText(links[index]), index };
  }

  // Section links are Overview / Identities / Activities. The :not() guard keeps
  // this from matching an active *server* row, which would hide the ban button
  // exactly when it is wanted.
  function getActiveProfileSectionLink() {
    return document.querySelector('.profile-links .profile-link.profile-link-active:not(.profile-server-link)');
  }

  function getActiveServerEntryLink() {
    const activeServer = getActiveServerLink();
    return hasServerEntryBadge(activeServer) ? activeServer : null;
  }

  // Some profile variants do not mark the server row itself as active.
  // In those cases, the blue person badge still tells us which server has a usable player entry.
  function getServerEntryLink() {
    return getSidebarServerLinks().find(hasServerEntryBadge) || null;
  }

  function getPreferredServerLink() {
    return getActiveServerLink() || getServerEntryLink();
  }

  // The active server is used in the Discord ban template.
  function getActiveServerName() {
    const activeServer = getActiveServerLink();
    if (!activeServer) return '';

    const text = getCleanText(activeServer);
    return text.replace(/\s+/g, ' ').trim();
  }

  function getPreferredServerName() {
    const serverLink = getPreferredServerLink();
    if (!serverLink) return '';

    const text = getCleanText(serverLink);
    return text.replace(/\s+/g, ' ').trim();
  }

  function findProfileHeaderLeft() {
    return document.querySelector('.page-title-card .profile-container-left')
      || document.querySelector('.profile-container-left');
  }

  function findProfileIdItem(root = document) {
    const items = root.querySelectorAll('.profile-container-item, .mobile-profile-container-item');
    for (const item of items) {
      const label = getCleanText(item.querySelector('.h6')) || getCleanText(item);
      if (/cftools id/i.test(label)) return item;
    }
    return null;
  }

  function findProfileIdSpan(cfid = '') {
    const normalizedCfid = (cfid || '').trim();
    const spans = document.querySelectorAll('.page-title-card .text-copyable.text-code, .profile-container .text-copyable.text-code');

    for (const span of spans) {
      const value = getCleanText(span);
      if (!value) continue;
      if (normalizedCfid && value.includes(normalizedCfid)) return span;
      if (/^[a-f0-9]{24}$/i.test(value)) return span;
    }

    return null;
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
    // Record where to return to as data, not as element references: the nodes
    // captured here are detached once the SPA re-renders, and clicking a detached
    // node is a silent no-op that used to strand the user on Identities.
    const activeServerEntry = getActiveServerEntry();
    const preferredServerName = getPreferredServerName();
    const activeTopNav = getActiveTopNavLabel();
    const identitiesLink = findProfileLink('Identities');
    if (!identitiesLink) {
      throw new Error('Could not find the Identities tab.');
    }

    clickElement(identitiesLink);

    // The Identities sub-nav renders asynchronously, so wait for it rather than
    // guessing with a fixed delay.
    let identitiesTopNav = null;
    try {
      identitiesTopNav = await waitForElement(() => findTopNavLink('Identities'), 3000);
    } catch {}

    if (identitiesTopNav) {
      if (getActiveTopNavLabel().toLowerCase() !== 'identities') {
        clickElement(identitiesTopNav);
      }
      // Only read once Identities is genuinely the active view. Reading earlier can
      // pick up the previous view's still-mounted input, i.e. another player's id.
      await waitForElement(() => getActiveTopNavLabel().toLowerCase() === 'identities', 15000);
    }

    const steam64 = await waitForSteam64();

    if (activeTopNav && activeTopNav.toLowerCase() === 'traces') {
      const tracesTopNav = findTopNavLink('Traces');
      if (tracesTopNav) clickElement(tracesTopNav);
    } else if (activeServerEntry) {
      const serverLink = findServerLink(activeServerEntry);
      if (serverLink) clickElement(serverLink);
    } else {
      const overviewLink = findProfileLink('Overview');
      if (overviewLink) clickElement(overviewLink);
    }

    return {
      steam64,
      server: preferredServerName,
    };
  }

  // Builds the Discord-friendly ban entry text that gets copied to the clipboard.
  // profileUrl is passed in by the caller because the Steam64 lookup navigates to
  // Identities first; reading location.href here recorded the sub-route instead of
  // the profile the entry is about.
  function buildBanEntry(steam64, serverName = '', reason = '', term = '', ignName = '', profileUrl = '') {
    const ign = ignName || getProfileName();
    const cftUrl = profileUrl || location.href;
    const server = serverName || getPreferredServerName();

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
  // Storage can be full or blocked, and an exception here used to escape straight
  // out of a click handler with no explanation.
  function saveTraceCompareState(state) {
    try {
      sessionStorage.setItem(TRACE_COMPARE_KEY, JSON.stringify({
        createdAt: Date.now(),
        ...state,
      }));
      return true;
    } catch (err) {
      console.error('Could not save trace comparison state:', err);
      toast('Could not save comparison progress.');
      return false;
    }
  }

  function clearTraceCompareState() {
    try {
      sessionStorage.removeItem(TRACE_COMPARE_KEY);
    } catch (err) {
      console.error('Could not clear trace comparison state:', err);
    }
  }

  // Used to confirm we resumed on the profile we expected to be on.
  function getProfileIdFromUrl(href) {
    return getCfIdFromUrl(href || '');
  }

  // Reads the profile id from the rendered page content only.
  // This is safer than the URL during SPA route changes, because the URL can update
  // before the visible profile content has finished switching over.
  function getRenderedProfileId() {
    return getCfIdFromPage();
  }

  // The report should only show after the original profile is visibly rendered again,
  // not just after the SPA URL changes.
  function isRenderedSourceProfileReady(sourceProfile) {
    const expectedSourceCfid = sourceProfile?.cfid || getProfileIdFromUrl(sourceProfile?.url);
    const renderedCfid = getRenderedProfileId();
    if (!renderedCfid) return false;
    if (expectedSourceCfid && renderedCfid !== expectedSourceCfid) return false;

    const expectedName = (sourceProfile?.name || '').trim();
    const renderedName = getProfileName();
    if (expectedName && renderedName && renderedName !== expectedName) return false;

    const hasProfileHeader = Boolean(document.querySelector('.profile-container-left .text-copyable.text-code'));
    const hasProfileLinks = Boolean(document.querySelector('.profile-links .profile-link'));
    return hasProfileHeader && hasProfileLinks;
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
  async function waitForElement(getter, timeoutMs = 10000, pollMs = 200) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const result = getter();
      if (result) return result;
      await delay(pollMs);
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
  //
  // It dispatches the sequence *instead of* calling element.click(), not in addition
  // to it. Doing both ran every handler twice, which double-navigated SPA links and
  // could re-toggle a modal straight back closed, and it delivered the events in the
  // wrong order (click, mousedown, mouseup, click).
  function clickElement(element) {
    if (!element) return false;

    const eventView = element.ownerDocument?.defaultView || null;
    const mouseOptions = eventView
      ? { bubbles: true, cancelable: true, view: eventView }
      : { bubbles: true, cancelable: true };

    try {
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch {}

    element.dispatchEvent(new MouseEvent('mousedown', mouseOptions));
    element.dispatchEvent(new MouseEvent('mouseup', mouseOptions));
    return element.dispatchEvent(new MouseEvent('click', mouseOptions));
  }

  // Finds the server links in the left profile sidebar that show the blue person badge,
  // which means the player has server-specific data available there.
  // Entries keep their position in the sidebar so that two servers sharing a visible
  // name are still visited separately; a name-keyed Set collapsed them into one and
  // silently skipped the second server's IP history.
  function getServerEntries() {
    const entries = [];

    getSidebarServerLinks().forEach((link, index) => {
      if (!hasServerEntryBadge(link)) return;

      const name = getCleanText(link);
      if (name) entries.push({ name, index });
    });

    return entries;
  }

  // Re-resolves an entry after the sidebar has re-rendered. Position is preferred and
  // confirmed by name; an exact name match is the fallback if the list reordered.
  // Unanchored prefix matching is gone: it resolved "KKCherno#1" to "KKCherno#10" and
  // collected the wrong server's IPs -- the same trap the server-logs name lookup
  // already guards against with isServerNameBoundary.
  function findServerLink(entry) {
    if (!entry) return null;

    const links = getSidebarServerLinks();
    const byIndex = links[entry.index];
    if (byIndex && getCleanText(byIndex) === entry.name) return byIndex;

    const exact = links.filter(link => getCleanText(link) === entry.name);
    if (exact.length === 1) return exact[0];

    return byIndex || null;
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

  // Opens a server entry and waits for its IP history button to be ready.
  // Clicks are capped and skipped when the entry is already open, so a slow render
  // no longer turns into a click storm against the SPA router.
  async function openServerEntry(entry, timeoutMs = 15000) {
    const started = Date.now();
    const maxClicks = 3;
    let clicks = 0;

    while (Date.now() - started < timeoutMs) {
      const serverLink = await waitForElement(() => findServerLink(entry), 5000);
      const ipButtonBefore = findIpHistoryButton();
      const isAlreadyOpen = serverLink.classList.contains('profile-link-active') && ipButtonBefore;

      if (!isAlreadyOpen) {
        clicks += 1;
        clickElement(serverLink);
      }

      try {
        await waitForElement(() => {
          const ipButton = findIpHistoryButton();
          if (!ipButton) return null;

          const refreshedServerLink = findServerLink(entry);
          const isActive = Boolean(refreshedServerLink?.classList.contains('profile-link-active'))
            || getActiveServerName() === entry.name;
          return (isActive || ipButton !== ipButtonBefore) ? ipButton : null;
        }, 4000);
        return;
      } catch {}

      if (clicks >= maxClicks) break;
      await delay(250);
    }

    throw new Error(`Timed out opening server entry for ${entry.name}.`);
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

    for (const entry of getServerEntries()) {
      // One slow or broken server must not discard the IPs already collected from
      // every other server, which is what an escaping timeout used to do.
      try {
        await openServerEntry(entry);

        const ipButton = await waitForElement(() => findIpHistoryButton(), 10000);
        clickElement(ipButton);

        const modal = await waitForElement(() => getIpHistoryModal(), 10000);
        extractIpsFromModal(modal).forEach(ip => collected.add(ip));

        await closeIpHistoryModal(modal);
      } catch (err) {
        console.warn(`Skipped IP history for ${entry.name}:`, err);

        // Leave the page usable for the next server even if we bailed mid-modal.
        const strandedModal = getIpHistoryModal();
        if (strandedModal) {
          try {
            await closeIpHistoryModal(strandedModal);
          } catch {}
        }
      }
    }

    return Array.from(collected);
  }

  // Opens Identities, then Traces, and waits until the trace content is really visible.
  async function openTracesTab() {
    await waitForPageReady();
    await clickProfileLink('Identities');

    const tracesNav = await waitForElement(() => findTopNavLink('Traces'), 15000);
    if (getActiveTopNavLabel().toLowerCase() !== 'traces') {
      clickElement(tracesNav);
    }
    await waitForElement(() => getActiveTopNavLabel().toLowerCase() === 'traces', 15000);
    await waitForElement(() => extractTracesFromVm().length || extractTracesFromPage().length || document.querySelector('.btn-group.btn-group-sm'), 15000);
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
  function isIgnoredTraceName(value) {
    return /^survivor(?:\s*\(\d+\))?$/i.test(value);
  }

  function extractTracesFromPage(options = {}) {
    const { includeIgnored = true } = options;
    const traces = [];
    const seen = new Set();

    for (const cardBody of getTraceCards()) {
      const copyable = cardBody.querySelector('h4 .text-copyable');
      if (!copyable) continue;

      const value = getCleanText(copyable);
      if (!value || seen.has(value)) continue;
      if (!includeIgnored && isIgnoredTraceName(value)) continue;

      seen.add(value);
      traces.push(value);
    }

    return traces;
  }

  function getPageObjectProperty(object, propertyName) {
    try {
      const directValue = object?.[propertyName];
      if (directValue) return directValue;
    } catch {}

    try {
      const wrappedValue = object?.wrappedJSObject?.[propertyName];
      if (wrappedValue) return wrappedValue;
    } catch {}

    return null;
  }

  function getPageWindow() {
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow) {
        debugLog('[CFTools Tools] Trace debug: using unsafeWindow');
        return unsafeWindow;
      }
    } catch {}

    debugLog('[CFTools Tools] Trace debug: falling back to window');
    return window;
  }

  function getRawPageNode(node) {
    try {
      return node?.wrappedJSObject || node || null;
    } catch {
      return node || null;
    }
  }

  const TRACES_VM_FULL_SCAN_INTERVAL_MS = 2000;
  let cachedTracesVm = null;
  let cachedTracesVmHref = '';
  let lastTracesVmFullScanAt = 0;

  function getTracesVmName(vm) {
    try {
      return vm?.$options?.name || vm?.wrappedJSObject?.$options?.name || '';
    } catch {
      return '';
    }
  }

  function isTracesVmCandidate(vm) {
    if (!vm) return false;

    const componentName = getTracesVmName(vm);
    if (componentName === 'Traces') return true;

    const traces = getPageObjectProperty(vm, 'traces');
    const meta = getPageObjectProperty(vm, 'meta');
    const page = getPageObjectProperty(vm, 'page');
    const perPage = getPageObjectProperty(vm, 'perPage');

    return Array.isArray(traces)
      && traces.length > 0
      && Boolean(meta && typeof meta === 'object')
      && (typeof page === 'number' || typeof perPage === 'number');
  }

  function queryPageElements(selector) {
    const elements = [];
    const seen = new Set();

    const pushElement = element => {
      if (!element || seen.has(element)) return;
      seen.add(element);
      elements.push(element);
    };

    try {
      document.querySelectorAll(selector).forEach(pushElement);
    } catch {}

    try {
      const pageDocument = getPageWindow()?.document;
      if (pageDocument) {
        pageDocument.querySelectorAll(selector).forEach(element => {
          pushElement(element);
          pushElement(getRawPageNode(element));
        });
      }
    } catch {}

    return elements;
  }

  function findTracesVmFromElement(element) {
    let current = element;
    let rawCurrent = getRawPageNode(element);

    while (current || rawCurrent) {
      const vm = getPageObjectProperty(current, '__vue__') || getPageObjectProperty(rawCurrent, '__vue__');
      if (isTracesVmCandidate(vm)) {
        return vm;
      }

      current = current?.parentElement || null;
      rawCurrent = getRawPageNode(rawCurrent?.parentElement || null);
    }
    return null;
  }

  function findTracesVm() {
    // findTracesVm runs inside waitForElement predicates that poll every 200ms,
    // so both the result and the cost of the full-DOM fallback are worth caching.
    if (cachedTracesVmHref === location.href && isTracesVmCandidate(cachedTracesVm)) {
      return cachedTracesVm;
    }

    cachedTracesVm = null;
    cachedTracesVmHref = location.href;

    const rememberVm = vm => {
      cachedTracesVm = vm;
      cachedTracesVmHref = location.href;
      return vm;
    };

    const seedSelectors = [
      '.btn-group.btn-group-sm',
      '.card .card-body h4 .text-copyable',
      '.c-nav-container',
    ];

    for (const selector of seedSelectors) {
      const elements = queryPageElements(selector);
      debugLog('[CFTools Tools] Trace debug: seed selector', selector, 'elements', elements.length);
      for (const element of elements) {
        const vm = findTracesVmFromElement(element);
        if (vm) {
          debugLog('[CFTools Tools] Trace debug: found Traces vm from selector', selector, 'component', getTracesVmName(vm) || '<empty string>');
          return rememberVm(vm);
        }
      }
    }

    // Fallback: scan the DOM for a Vue host that identifies itself as the
    // Traces component. This touches every element in the page, so it is
    // throttled - a caller polling every 200ms must not drag the whole DOM
    // through this on each tick. The seeded walk above is the normal path.
    const now = Date.now();
    if ((now - lastTracesVmFullScanAt) < TRACES_VM_FULL_SCAN_INTERVAL_MS) {
      debugLog('[CFTools Tools] Trace debug: skipping throttled full scan');
      return null;
    }
    lastTracesVmFullScanAt = now;

    const elements = queryPageElements('*');
    debugLog('[CFTools Tools] Trace debug: fallback scan element count', elements.length);
    for (const element of elements) {
      const vm = getPageObjectProperty(element, '__vue__');
      if (isTracesVmCandidate(vm)) {
        const traceRecords = getPageObjectProperty(vm, 'traces');
        debugLog('[CFTools Tools] Trace debug: found Traces vm via full scan', 'component', getTracesVmName(vm) || '<empty string>', 'traces', Array.isArray(traceRecords) ? traceRecords.length : null);
        return rememberVm(vm);
      }
    }

    debugLog('[CFTools Tools] Trace debug: no Traces vm found');
    return null;
  }

  function extractTracesFromVm(options = {}) {
    const { includeIgnored = true } = options;
    const vm = findTracesVm();
    if (!vm) {
      debugLog('[CFTools Tools] Trace debug: extractTracesFromVm no vm');
      return [];
    }

    const pageOwnedTraceRecords = getPageObjectProperty(vm, 'traces');
    debugLog('[CFTools Tools] Trace debug: vm component', getTracesVmName(vm) || '<empty string>', 'has traces array', Array.isArray(pageOwnedTraceRecords), 'length', Array.isArray(pageOwnedTraceRecords) ? pageOwnedTraceRecords.length : null);
    const traceRecords = Array.isArray(pageOwnedTraceRecords) ? Array.from(pageOwnedTraceRecords) : [];
    const traces = [];
    const seen = new Set();

    for (const record of traceRecords) {
      const recordType = getPageObjectProperty(record, 'type');
      if (recordType === 'ipv4') continue;

      const recordKey = getPageObjectProperty(record, 'key');
      const value = typeof recordKey === 'string'
        ? recordKey.replace(/\s+/g, ' ').trim()
        : '';
      if (!value || seen.has(value)) continue;
      if (!includeIgnored && isIgnoredTraceName(value)) continue;

      seen.add(value);
      traces.push(value);
    }

    debugLog('[CFTools Tools] Trace debug: extracted traces from vm', traces.length, traces);
    return traces;
  }

  // Finds the traces pagination group by looking for the left/right arrow buttons and an active page.
  function getTracePaginationGroup() {
    const groups = document.querySelectorAll('.btn-group.btn-group-sm');
    for (const group of groups) {
      const buttons = group.querySelectorAll('button');
      if (buttons.length < 3) continue;
      const firstArrow = buttons[0].querySelector('.fa-arrow-left');
      const lastArrow = buttons[buttons.length - 1].querySelector('.fa-arrow-right');
      const activePage = group.querySelector('.btn-primary h5');
      if (!firstArrow || !lastArrow || !activePage) continue;
      return group;
    }
    return null;
  }

  function getTracePaginationNextButton(group = getTracePaginationGroup()) {
    if (!group) return null;
    const buttons = group.querySelectorAll('button');
    return buttons[buttons.length - 1] || null;
  }

  // Current page number, used to detect when pagination really advanced.
  // It reads from the same group whose button we click; a document-wide lookup
  // could watch a different paginated widget rendered higher up the page.
  function getTracePageNumber(group = getTracePaginationGroup()) {
    if (!group) return '';
    return getCleanText(group.querySelector('.btn-primary h5'));
  }

  // Walks every traces page and collects a de-duplicated set of names.
  // pageGuard prevents an accidental infinite loop if the site ever changes.
  async function collectAllTraces() {
    for (let i = 0; i < 10; i += 1) {
      const tracesFromVm = extractTracesFromVm({ includeIgnored: false });
      if (tracesFromVm.length) {
        debugLog('[CFTools Tools] Trace debug: using vm fast path on attempt', i + 1, 'count', tracesFromVm.length);
        return tracesFromVm;
      }

      debugLog('[CFTools Tools] Trace debug: vm fast path empty on attempt', i + 1);
      await delay(200);
    }

    debugLog('[CFTools Tools] Trace debug: falling back to pagination');
    const collected = new Set();
    const seenPages = new Set();
    let pageGuard = 0;

    while (pageGuard < 200) {
      pageGuard += 1;

      const pageTraces = extractTracesFromPage({ includeIgnored: false });
      pageTraces.forEach(trace => collected.add(trace));

      const group = getTracePaginationGroup();
      const nextButton = getTracePaginationNextButton(group);
      if (!nextButton) break;

      const disabled = nextButton.disabled || nextButton.classList.contains('disabled');
      if (disabled) break;

      const beforePageNumber = getTracePageNumber(group);

      // Stop if pagination wrapped back to a page we already read instead of
      // disabling the next button, rather than looping to the 200-page guard.
      if (beforePageNumber) {
        if (seenPages.has(beforePageNumber)) break;
        seenPages.add(beforePageNumber);
      }

      const beforeSnapshot = extractTracesFromPage().join('|');
      clickElement(nextButton);

      try {
        // Wait until either the page number changed or the visible results changed.
        await waitForElement(() => {
          const afterGroup = getTracePaginationGroup();
          const afterPageNumber = getTracePageNumber(afterGroup);
          const afterSnapshot = extractTracesFromPage().join('|');
          return (afterPageNumber && afterPageNumber !== beforePageNumber)
            || (afterSnapshot && afterSnapshot !== beforeSnapshot);
        }, 10000);
      } catch {
        // A stalled page should end pagination with what we already have instead of
        // throwing away the whole comparison.
        debugLog('[CFTools Tools] Trace debug: pagination stalled, keeping partial results');
        console.warn('Traces pagination stalled; keeping the results collected so far.');
        break;
      }

      await delay(250);
    }

    return Array.from(collected);
  }

  const SIMILAR_TRACE_THRESHOLD = 0.72;
  const MIN_SIMILAR_TRACE_LENGTH = 4;

  function normalizeTraceForSimilarity(value) {
    return (value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function getLevenshteinDistance(a, b) {
    const source = a || '';
    const target = b || '';

    if (source === target) return 0;
    if (!source.length) return target.length;
    if (!target.length) return source.length;

    // Single-row dynamic programming: previous[j] holds the prior row's value
    // until it is overwritten with the current row's, and `diagonal` carries the
    // prior row's j-1 value forward for the substitution cost.
    const previous = Array.from({ length: target.length + 1 }, (_, index) => index);

    for (let i = 1; i <= source.length; i += 1) {
      let diagonal = previous[0];
      previous[0] = i;

      for (let j = 1; j <= target.length; j += 1) {
        const up = previous[j];
        const cost = source[i - 1] === target[j - 1] ? 0 : 1;

        previous[j] = Math.min(
          up + 1,
          previous[j - 1] + 1,
          diagonal + cost
        );
        diagonal = up;
      }
    }

    return previous[target.length];
  }

  // Takes already-normalized values. buildSimilarTraceMatches precomputes them once
  // per trace and reuses them, because this runs once per source/target pair -- on
  // two 600-name profiles that is 360k pairs, and re-normalizing both strings inside
  // the loop was the bulk of the cost.
  //
  // Scores below SIMILAR_TRACE_THRESHOLD are only ever compared against that
  // threshold, so they are allowed to be approximate.
  function getNormalizedTraceSimilarity(source, target) {
    if (!source || !target) return 0;
    if (source === target) return 1;

    const maxLength = Math.max(source.length, target.length);
    if (!maxLength) return 0;

    const shorter = source.length <= target.length ? source : target;
    const longer = source.length > target.length ? source : target;
    const sourceBase = source.replace(/\d+$/, '');
    const targetBase = target.replace(/\d+$/, '');

    // Treat obvious "same name with numeric suffix/prefix extension" patterns
    // as strong fuzzy matches. These are common in reused DayZ names.
    // They are checked first because they stay valid even when the length gap is
    // wide enough to rule out a good edit distance.
    let score = 0;
    if (sourceBase && targetBase && sourceBase === targetBase && sourceBase.length >= MIN_SIMILAR_TRACE_LENGTH) {
      score = 0.95;
    } else if (shorter.length >= MIN_SIMILAR_TRACE_LENGTH && longer.startsWith(shorter)) {
      score = 0.9;
    } else if (shorter.length >= 6 && longer.includes(shorter)) {
      score = 0.82;
    }

    // Edit distance is at least the length difference, so the best score it could
    // possibly return is capped. Skip the O(n*m) matrix when that cap cannot beat
    // what we already have, or cannot reach the threshold at all.
    const distanceCeiling = 1 - (Math.abs(source.length - target.length) / maxLength);
    if (distanceCeiling <= score || distanceCeiling < SIMILAR_TRACE_THRESHOLD) {
      return score;
    }

    return Math.max(score, 1 - (getLevenshteinDistance(source, target) / maxLength));
  }

  function buildSimilarTraceMatches(sourceTraces, targetTraces) {
    const sourceEntries = Array.from(new Map(
      sourceTraces.map(trace => [trace.toLowerCase(), {
        raw: trace,
        lower: trace.toLowerCase(),
        normalized: normalizeTraceForSimilarity(trace),
      }])
    ).values());
    const targetEntries = Array.from(new Map(
      targetTraces.map(trace => [trace.toLowerCase(), {
        raw: trace,
        lower: trace.toLowerCase(),
        normalized: normalizeTraceForSimilarity(trace),
      }])
    ).values());
    const similarMatches = [];
    const seenPairs = new Set();

    for (const sourceEntry of sourceEntries) {
      if (sourceEntry.normalized.length < MIN_SIMILAR_TRACE_LENGTH) continue;

      let bestMatch = null;
      for (const targetEntry of targetEntries) {
        if (targetEntry.normalized.length < MIN_SIMILAR_TRACE_LENGTH) continue;
        if (sourceEntry.lower === targetEntry.lower) continue;

        const score = getNormalizedTraceSimilarity(sourceEntry.normalized, targetEntry.normalized);
        if (score < SIMILAR_TRACE_THRESHOLD) continue;

        if (!bestMatch || score > bestMatch.score || (score === bestMatch.score && targetEntry.raw.localeCompare(bestMatch.raw) < 0)) {
          bestMatch = {
            raw: targetEntry.raw,
            lower: targetEntry.lower,
            score,
          };
        }
      }

      if (!bestMatch) continue;

      const pairKey = `${sourceEntry.lower}||${bestMatch.lower}`;
      if (seenPairs.has(pairKey)) continue;

      seenPairs.add(pairKey);
      similarMatches.push(`${sourceEntry.raw} - ${bestMatch.raw}`);
    }

    return similarMatches.sort((a, b) => a.localeCompare(b));
  }

  function buildSharedMatchData(sourceTraces, targetTraces, sourceIps, targetIps) {
    const targetTraceSet = new Map(targetTraces.map(trace => [trace.toLowerCase(), trace]));
    const sharedTraces = sourceTraces
      .filter(trace => targetTraceSet.has(trace.toLowerCase()))
      .map(trace => targetTraceSet.get(trace.toLowerCase()) || trace)
      .sort((a, b) => a.localeCompare(b));

    const uniqueSharedTraces = Array.from(new Set(sharedTraces));
    const similarMatches = buildSimilarTraceMatches(sourceTraces, targetTraces);
    const targetIpSet = new Set(targetIps);
    const sharedIps = Array.from(new Set(sourceIps.filter(ip => targetIpSet.has(ip)))).sort((a, b) => a.localeCompare(b));

    return {
      sharedTraces: uniqueSharedTraces,
      similarMatches,
      sharedIps,
    };
  }

  async function collectProfileComparisonData(profileLabel) {
    // Each section is isolated so a failure in one still produces a partial report
    // rather than aborting the whole comparison and clearing its saved state.
    let traces = [];
    try {
      toast(`Collecting traces from ${profileLabel}...`);
      await openTracesTab();
      traces = await collectAllTraces();
    } catch (err) {
      console.warn(`Trace collection failed for ${profileLabel}:`, err);
      toast(`Could not read traces from ${profileLabel}.`);
    }

    let steam64 = '';
    try {
      toast(`Collecting Steam64 from ${profileLabel}...`);
      const steamResult = await fetchSteam64FromUi();
      steam64 = steamResult.steam64 || '';
    } catch {}

    let ips = [];
    try {
      toast(`Collecting IPs from ${profileLabel}...`);
      ips = await collectAllIps();
    } catch (err) {
      console.warn(`IP collection failed for ${profileLabel}:`, err);
      toast(`Could not read IPs from ${profileLabel}.`);
    }

    return {
      profile: getCurrentProfileSummary(),
      traces,
      steam64,
      ips,
    };
  }

  // Final compare output keeps the report simple: shared traces, shared IPs,
  // and the two compared profile URLs with Steam64 values.
  function buildTraceCompareReport(sourceProfile, targetProfile, sourceTraces, targetTraces, sourceIps, targetIps, targetUrl = '', sourceSteam64 = '', targetSteam64 = '') {
    const matches = buildSharedMatchData(sourceTraces, targetTraces, sourceIps, targetIps);
    const sourceUrl = sourceProfile?.url || '';
    const compareTargetUrl = targetUrl || targetProfile?.url || '';
    const sourceAccountLine = sourceSteam64 ? `${sourceUrl} (${sourceSteam64})` : sourceUrl;
    const targetAccountLine = targetSteam64 ? `${compareTargetUrl} (${targetSteam64})` : compareTargetUrl;

    return [
      'Exact Traces:',
      ...(matches.sharedTraces.length ? matches.sharedTraces : ['None found']),
      '',
      'Similar Traces:',
      ...(matches.similarMatches.length ? matches.similarMatches : ['None found']),
      '',
      'Shared IPs:',
      ...(matches.sharedIps.length ? matches.sharedIps : ['None found']),
      '',
      'Accounts:',
      sourceAccountLine,
      targetAccountLine,
    ].join('\n');
  }

  function buildAltCompareReport(sourceProfile, sourceSteam64, altResults) {
    const sourceUrl = sourceProfile?.url || '';
    const sourceAccountLine = sourceSteam64 ? `${sourceUrl} (${sourceSteam64})` : sourceUrl;
    // A shared IP alone is still worth reporting, so the header stays broader
    // than "shared traces".
    const matchedAltResults = (altResults || []).filter(result => {
      return Boolean(
        result?.sharedTraces?.length
        || result?.similarMatches?.length
        || result?.sharedIps?.length
      );
    });
    const lines = [
      'Source Account:',
      sourceAccountLine,
      '',
      'Potential Alt Matches:',
    ];

    if (!matchedAltResults.length) {
      lines.push('None found');
      return lines.join('\n');
    }

    matchedAltResults.forEach((result, index) => {
      const targetUrl = result.url || '';
      const targetAccountLine = result.steam64 ? `${targetUrl} (${result.steam64})` : targetUrl;

      if (index > 0) lines.push('');
      lines.push(targetAccountLine);
      lines.push('Exact Traces:');
      lines.push(...(result.sharedTraces.length ? result.sharedTraces : ['None found']));
      lines.push('Similar Traces:');
      lines.push(...(result.similarMatches.length ? result.similarMatches : ['None found']));
      lines.push('Shared IPs:');
      lines.push(...(result.sharedIps.length ? result.sharedIps : ['None found']));
    });

    return lines.join('\n');
  }

  function saveReportState(sourceProfile, report, successToast, failureToast) {
    saveTraceCompareState({
      stage: 'show-report',
      sourceProfile,
      report,
      successToast,
      failureToast,
    });
  }

  // Only allow compare targets that look like real CFTools profile URLs.
  function normalizeCompareTargetUrl(rawUrl) {
    const trimmed = (rawUrl || '').trim();
    if (!trimmed) return null;

    // Require an absolute or root-relative URL. Resolving something like
    // "app.cftools.cloud/profile/123" against the current origin produced
    // "<origin>/app.cftools.cloud/profile/123", which still passed the host and id
    // checks below and then navigated to a dead page.
    if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('/')) return null;

    try {
      const url = new URL(trimmed, location.origin);
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

  // Shared chrome for the script's dialogs. The two of them are built separately
  // because their bodies have nothing in common, but they are meant to look like
  // one thing, so the styling lives in one place.
  const DIALOG_OVERLAY_CSS = `
    position: fixed; top: 0; right: 0; bottom: 0; left: 0;
    background: rgba(0,0,0,.55); display: flex;
    align-items: center; justify-content: center;
    z-index: 2147483646; font: 13px system-ui,sans-serif;
  `;
  const DIALOG_PANEL_CSS = `
    background: #16181d; color: #fff; border: 1px solid #333;
    border-radius: 10px; box-shadow: 0 18px 50px rgba(0,0,0,.45);
    padding: 18px; width: min(560px, calc(100vw - 40px));
    max-height: calc(100vh - 80px); overflow: auto;
  `;
  const DIALOG_TITLE_CSS = 'font-size: 15px; font-weight: 600; margin-bottom: 4px;';
  const DIALOG_HINT_CSS = 'color: #9aa0a6; margin-bottom: 12px; line-height: 1.4;';
  const DIALOG_ERROR_CSS = 'color: #ff7676; margin-top: 10px; min-height: 16px;';
  const DIALOG_ACTIONS_CSS = 'display: flex; align-items: center; gap: 8px; margin-top: 12px;';
  const DIALOG_NEUTRAL_BG = '#2c313a';
  const DIALOG_NEUTRAL_HOVER = '#3a414c';
  const DIALOG_CONFIRM_BG = '#1f6f4a';
  const DIALOG_CONFIRM_HOVER = '#27885b';

  function createDialogButton(label, background, hover) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText = `
      background: ${background}; color: #fff; border: none; border-radius: 6px;
      cursor: pointer; font: inherit; padding: 7px 12px; white-space: nowrap;
    `;
    button.addEventListener('mouseenter', () => (button.style.background = hover));
    button.addEventListener('mouseleave', () => (button.style.background = background));
    return button;
  }

  // Reports are mostly profile URLs, and window.alert renders them as dead text
  // that cannot even be selected in some browsers. This is the same chrome as the
  // dialogs above, with the links live and the body still copyable.
  //
  // It does not block the way alert does. Nothing runs after these calls, and the
  // saved state is already cleared by the time one is shown.
  const REPORT_URL_RE = /https?:\/\/[^\s)]+/g;

  // Built out of text nodes rather than markup: a report carries player names taken
  // off the page, and those are not ours to trust as HTML.
  function appendLinkifiedText(container, text) {
    let lastIndex = 0;
    let match;

    REPORT_URL_RE.lastIndex = 0;
    while ((match = REPORT_URL_RE.exec(text)) !== null) {
      if (match.index > lastIndex) {
        container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }

      // Trailing sentence punctuation is not part of the URL.
      const href = match[0].replace(/[.,;]+$/, '');
      const link = document.createElement('a');
      link.href = href;
      link.textContent = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.style.cssText = 'color: #6fb1ff; text-decoration: underline;';
      container.appendChild(link);

      if (href.length < match[0].length) {
        container.appendChild(document.createTextNode(match[0].slice(href.length)));
      }
      lastIndex = REPORT_URL_RE.lastIndex;
    }

    if (lastIndex < text.length) {
      container.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  }

  function showReportModal(report, title = 'Report') {
    // A second report replaces the first rather than stacking on top of it.
    document.getElementById('codex-report-modal')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'codex-report-modal';
    overlay.style.cssText = DIALOG_OVERLAY_CSS;

    const panel = document.createElement('div');
    panel.style.cssText = `
      ${DIALOG_PANEL_CSS}
      width: min(760px, calc(100vw - 40px));
    `;

    const heading = document.createElement('div');
    heading.textContent = title;
    heading.style.cssText = DIALOG_TITLE_CSS;

    const body = document.createElement('div');
    body.style.cssText = `
      white-space: pre-wrap; word-break: break-word; margin-top: 8px;
      max-height: 60vh; overflow: auto; background: #0f1114;
      border: 1px solid #2c313a; border-radius: 6px; padding: 10px 12px;
      font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    `;
    appendLinkifiedText(body, report);

    function close() {
      document.removeEventListener('keydown', onDocumentKeydown, true);
      overlay.remove();
    }

    function onDocumentKeydown(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    }

    const copyButton = createDialogButton('Copy', DIALOG_NEUTRAL_BG, DIALOG_NEUTRAL_HOVER);
    copyButton.addEventListener('click', async () => {
      const copied = await copyText(report);
      toast(copied ? 'Report copied to clipboard.' : 'Could not copy the report.');
    });

    const spacer = document.createElement('div');
    spacer.style.cssText = 'flex: 1;';

    const closeButton = createDialogButton('Close', DIALOG_CONFIRM_BG, DIALOG_CONFIRM_HOVER);
    closeButton.addEventListener('click', () => close());

    const actions = document.createElement('div');
    actions.style.cssText = DIALOG_ACTIONS_CSS;
    actions.append(copyButton, spacer, closeButton);

    panel.append(heading, body, actions);
    overlay.appendChild(panel);
    overlay.addEventListener('mousedown', event => {
      if (event.target === overlay) close();
    });

    document.addEventListener('keydown', onDocumentKeydown, true);
    document.body.appendChild(overlay);
    closeButton.focus();
  }

  // window.prompt only ever returns one line, so compare targets get their own small
  // dialog. Shift+Enter opens another field, Enter starts the comparison, Escape
  // closes it. Resolves with the normalized URLs, or null when it was cancelled.
  //
  // Validation happens in here rather than in the caller so a bad entry can be
  // pointed at and fixed instead of throwing away everything else that was typed.
  function promptForCompareUrls() {
    const open = document.getElementById('trace-compare-dialog');
    if (open) {
      open.querySelector('input')?.focus();
      return Promise.resolve(null);
    }

    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.id = 'trace-compare-dialog';
      overlay.style.cssText = DIALOG_OVERLAY_CSS;

      const panel = document.createElement('div');
      panel.style.cssText = DIALOG_PANEL_CSS;

      const title = document.createElement('div');
      title.textContent = 'Compare Traces';
      title.style.cssText = DIALOG_TITLE_CSS;

      const hint = document.createElement('div');
      hint.textContent = 'Paste a CFTools profile URL. Shift+Enter adds another field, Enter starts the comparison.';
      hint.style.cssText = DIALOG_HINT_CSS;

      const rows = document.createElement('div');

      const error = document.createElement('div');
      error.style.cssText = DIALOG_ERROR_CSS;

      function close(result) {
        document.removeEventListener('keydown', onDocumentKeydown, true);
        overlay.remove();
        resolve(result);
      }

      function onDocumentKeydown(event) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        close(null);
      }

      function submit() {
        const inputs = Array.from(rows.querySelectorAll('input'));
        const urls = [];
        const seen = new Set();
        let firstInvalid = null;

        for (const input of inputs) {
          const raw = input.value.trim();
          if (!raw) continue;

          const normalized = normalizeCompareTargetUrl(raw);
          if (!normalized) {
            input.style.borderColor = '#ff7676';
            if (!firstInvalid) firstInvalid = input;
            continue;
          }

          // The same profile twice is one visit's worth of work for no extra answer.
          if (seen.has(normalized)) continue;
          seen.add(normalized);
          urls.push(normalized);
        }

        if (firstInvalid) {
          error.textContent = 'That is not a CFTools profile URL.';
          firstInvalid.focus();
          return;
        }

        if (!urls.length) {
          error.textContent = 'Enter at least one CFTools profile URL.';
          inputs[0]?.focus();
          return;
        }

        close(urls);
      }

      function addRowAfter(row) {
        const next = createRow();
        row.insertAdjacentElement('afterend', next);
        next.querySelector('input').focus();
      }

      function createRow() {
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; gap: 6px; margin-bottom: 6px;';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'https://app.cftools.cloud/profile/...';
        input.style.cssText = `
          flex: 1; min-width: 0; background: #0f1114; color: #fff;
          border: 1px solid #3a3f46; border-radius: 6px;
          padding: 7px 9px; font: inherit;
        `;
        input.addEventListener('input', () => {
          input.style.borderColor = '#3a3f46';
          error.textContent = '';
        });
        input.addEventListener('keydown', event => {
          if (event.key !== 'Enter') return;
          event.preventDefault();

          if (event.shiftKey) {
            addRowAfter(row);
            return;
          }
          submit();
        });

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.title = 'Remove this field';
        remove.style.cssText = `
          background: transparent; color: #9aa0a6; border: 1px solid #3a3f46;
          border-radius: 6px; cursor: pointer; font: inherit; padding: 0 9px;
        `;
        remove.addEventListener('click', () => {
          // The last field stays put: an empty dialog has nothing left to type into.
          if (rows.children.length === 1) {
            input.value = '';
            input.style.borderColor = '#3a3f46';
            input.focus();
            return;
          }

          row.remove();
          rows.querySelector('input')?.focus();
        });

        row.append(input, remove);
        return row;
      }

      const addButton = createDialogButton('Add another', DIALOG_NEUTRAL_BG, DIALOG_NEUTRAL_HOVER);
      addButton.addEventListener('click', () => addRowAfter(rows.lastElementChild));

      const spacer = document.createElement('div');
      spacer.style.cssText = 'flex: 1;';

      const cancelButton = createDialogButton('Cancel', DIALOG_NEUTRAL_BG, DIALOG_NEUTRAL_HOVER);
      cancelButton.addEventListener('click', () => close(null));

      const compareButton = createDialogButton('Compare', DIALOG_CONFIRM_BG, DIALOG_CONFIRM_HOVER);
      compareButton.addEventListener('click', () => submit());

      const actions = document.createElement('div');
      actions.style.cssText = DIALOG_ACTIONS_CSS;
      actions.append(addButton, spacer, cancelButton, compareButton);

      rows.appendChild(createRow());
      panel.append(title, hint, rows, error, actions);
      overlay.appendChild(panel);
      overlay.addEventListener('mousedown', event => {
        if (event.target === overlay) close(null);
      });

      document.addEventListener('keydown', onDocumentKeydown, true);
      document.body.appendChild(overlay);
      rows.querySelector('input').focus();
    });
  }

  // The multi-target version of buildTraceCompareReport. Unlike the alt report it
  // keeps the targets that came back empty: these URLs were asked for by hand, so
  // "nothing shared" is an answer the user wants to see rather than a row to hide.
  function buildMultiCompareReport(sourceProfile, sourceSteam64, results) {
    const sourceUrl = sourceProfile?.url || '';
    const lines = [
      'Source Account:',
      sourceSteam64 ? `${sourceUrl} (${sourceSteam64})` : sourceUrl,
      '',
      `Compared Against ${results.length} Profile(s):`,
    ];

    results.forEach(result => {
      const targetUrl = result.url || '';

      lines.push('');
      lines.push(result.steam64 ? `${targetUrl} (${result.steam64})` : targetUrl);
      lines.push('Exact Traces:');
      lines.push(...(result.sharedTraces.length ? result.sharedTraces : ['None found']));
      lines.push('Similar Traces:');
      lines.push(...(result.similarMatches.length ? result.similarMatches : ['None found']));
      lines.push('Shared IPs:');
      lines.push(...(result.sharedIps.length ? result.sharedIps : ['None found']));
    });

    return lines.join('\n');
  }

  // Both multi-target workflows end the same way, and the alt path reached that
  // ending from two places with the block copied out twice. reportMode is what
  // tells the two apart: the Compare Alts button leaves it unset, while Compare
  // Traces sets it when it hands several URLs to the same stages.
  async function finishMultiCompare(state, results) {
    const isExplicitCompare = state.reportMode === 'compare';
    const report = isExplicitCompare
      ? buildMultiCompareReport(state.sourceProfile, state.sourceSteam64 || '', results)
      : buildAltCompareReport(state.sourceProfile, state.sourceSteam64 || '', results);
    const successToast = isExplicitCompare
      ? 'Trace comparison copied to clipboard.'
      : 'Alt comparison copied to clipboard.';
    const failureToast = isExplicitCompare
      ? 'Trace comparison ready. Copy failed.'
      : 'Alt comparison ready. Copy failed.';
    const returnUrl = state.sourceProfile?.url || '';

    if (returnUrl && returnUrl !== location.href) {
      saveReportState(state.sourceProfile, report, successToast, failureToast);
      location.href = returnUrl;
      return;
    }

    clearTraceCompareState();

    const copied = await copyText(report);
    console.log(report);
    toast(copied ? successToast : failureToast);
    showReportModal(report, isExplicitCompare ? 'Trace Comparison' : 'Alt Comparison');
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
      const targetUrls = await promptForCompareUrls();
      if (!targetUrls?.length) return;

      const sourceProfile = getCurrentProfileSummary();

      // A single target keeps the original two-profile workflow and the report
      // shape that goes with it. Several reuse the multi-target stages the alt
      // compare already runs on, marked so they report as a compare rather than
      // as an alt hunt.
      if (targetUrls.length === 1) {
        saveTraceCompareState({
          stage: 'collect-source',
          sourceProfile,
          targetUrl: targetUrls[0],
        });
        toast('Starting trace comparison...');
      } else {
        saveTraceCompareState({
          stage: 'alt-collect-source',
          sourceProfile,
          reportMode: 'compare',
          altUrls: targetUrls,
          altResults: [],
          currentAltIndex: 0,
        });
        toast(`Starting trace comparison on ${targetUrls.length} profiles...`);
      }

      await resumeTraceCompareWorkflow();
    });
    return btn;
  }

  const ALT_ROW_LABEL_RE = /^Potential alternate accounts$/i;
  let cachedAltRow = null;

  function isPotentialAltRow(row) {
    return Boolean(row)
      && row.isConnected
      && ALT_ROW_LABEL_RE.test(getCleanText(row.querySelector('td h5')));
  }

  // Cached because this runs on every profile refresh and the uncached form walks
  // every row of every table on the page. Unlike querySelector, querySelectorAll
  // cannot short-circuit, so a large activity table made this the most expensive
  // part of a refresh.
  function getPotentialAltRow() {
    if (isPotentialAltRow(cachedAltRow)) return cachedAltRow;

    cachedAltRow = null;
    const rows = document.querySelectorAll('.card .card-body tbody tr');
    for (const row of rows) {
      const label = getCleanText(row.querySelector('td h5'));
      if (ALT_ROW_LABEL_RE.test(label)) {
        cachedAltRow = row;
        break;
      }
    }

    return cachedAltRow;
  }

  function getGeneralCardBody() {
    const altRow = getPotentialAltRow();
    if (!altRow) return null;

    const cardBody = altRow.closest('.card-body');
    return cardBody || null;
  }

  function getPotentialAltProfileUrls() {
    const altRow = getPotentialAltRow();
    if (!altRow) return [];

    const currentCfid = getCfId();
    const altUrls = new Map();

    altRow.querySelectorAll('a[href*="/profile/"]').forEach(anchor => {
      const rawHref = anchor.href || anchor.getAttribute('href') || '';
      const normalizedUrl = normalizeCompareTargetUrl(rawHref);
      const targetCfid = getCfIdFromUrl(normalizedUrl || '');

      if (!normalizedUrl || !targetCfid) return;
      if (currentCfid && targetCfid === currentCfid) return;

      altUrls.set(targetCfid, normalizedUrl);
    });

    return Array.from(altUrls.values());
  }

  function createAltCompareButton() {
    const btn = document.createElement('button');
    btn.id = 'compare-alts-btn';
    btn.type = 'button';
    btn.textContent = 'Compare Alts';
    btn.style.cssText = `
      margin-left: 10px;
      background: #2c5aa0;
      color: #fff;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      line-height: 1.2;
      padding: 6px 10px;
      white-space: nowrap;
      vertical-align: middle;
    `;
    btn.addEventListener('mouseenter', () => (btn.style.background = '#3569bb'));
    btn.addEventListener('mouseleave', () => (btn.style.background = '#2c5aa0'));
    btn.addEventListener('click', async () => {
      const altUrls = getPotentialAltProfileUrls();
      if (!altUrls.length) {
        toast('No Alt Accounts Found');
        return;
      }

      const sourceProfile = getCurrentProfileSummary();
      saveTraceCompareState({
        stage: 'alt-collect-source',
        sourceProfile,
        altUrls,
        altResults: [],
        currentAltIndex: 0,
      });

      toast('Starting alt comparison...');
      await resumeTraceCompareWorkflow();
    });
    return btn;
  }

  function ensureAltCompareButton() {
    const cardBody = getGeneralCardBody();
    const existing = document.getElementById('compare-alts-btn');

    // Keep the button tied to the presence of the "Potential alternate accounts" section
    // itself, not to whether the alt links are fully rendered in this exact DOM moment.
    // CFTools often rerenders Overview in stages, which can make the anchors disappear
    // briefly and cause the button to flicker if we remove it too aggressively.
    if (!cardBody) {
      if (existing) existing.remove();
      return;
    }

    const title = cardBody.querySelector('.card-title');
    if (!title) {
      if (existing) existing.remove();
      return;
    }

    if (existing && existing.parentElement === title) return;
    if (existing) existing.remove();

    title.style.display = 'inline-flex';
    title.style.alignItems = 'center';

    title.appendChild(createAltCompareButton());
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
  // 3. Navigate back to the source profile.
  // 4. Copy and show the overlap report there.
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

        const sourceData = await collectProfileComparisonData('first profile');

        saveTraceCompareState({
          stage: 'collect-target',
          sourceProfile: state.sourceProfile,
          sourceTraces: sourceData.traces,
          sourceIps: sourceData.ips,
          sourceSteam64: sourceData.steam64,
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

        const targetData = await collectProfileComparisonData('second profile');
        const report = buildTraceCompareReport(
          state.sourceProfile,
          targetData.profile,
          state.sourceTraces || [],
          targetData.traces,
          state.sourceIps || [],
          targetData.ips,
          state.targetUrl,
          state.sourceSteam64 || '',
          targetData.steam64
        );
        const returnUrl = state.sourceProfile?.url || '';

        if (returnUrl && returnUrl !== location.href) {
          saveReportState(
            state.sourceProfile,
            report,
            'Trace comparison copied to clipboard.',
            'Trace comparison ready. Copy failed.'
          );
          location.href = returnUrl;
          return;
        }

        clearTraceCompareState();

        const copied = await copyText(report);
        console.log(report);
        toast(copied ? 'Trace comparison copied to clipboard.' : 'Trace comparison ready. Copy failed.');
        showReportModal(report, 'Trace Comparison');
      }

      if (state.stage === 'alt-collect-source') {
        const expectedSourceCfid = state.sourceProfile?.cfid || getProfileIdFromUrl(state.sourceProfile?.url);
        const currentCfid = getCfId();
        if (expectedSourceCfid && currentCfid && expectedSourceCfid !== currentCfid) {
          return;
        }

        const sourceData = await collectProfileComparisonData('source account');

        saveTraceCompareState({
          stage: 'alt-collect-target',
          sourceProfile: state.sourceProfile,
          reportMode: state.reportMode,
          sourceTraces: sourceData.traces,
          sourceIps: sourceData.ips,
          sourceSteam64: sourceData.steam64,
          altUrls: state.altUrls || [],
          altResults: state.altResults || [],
          currentAltIndex: 0,
        });

        const firstAltUrl = (state.altUrls || [])[0];
        if (firstAltUrl) {
          location.href = firstAltUrl;
          return;
        }

        clearTraceCompareState();
        toast(state.reportMode === 'compare' ? 'No profiles to compare.' : 'No Alt Accounts Found');
        return;
      }

      if (state.stage === 'alt-collect-target') {
        const altUrls = state.altUrls || [];
        const currentAltIndex = state.currentAltIndex || 0;
        const currentAltUrl = altUrls[currentAltIndex];
        if (!currentAltUrl) {
          await finishMultiCompare(state, state.altResults || []);
          return;
        }

        const expectedTargetCfid = getProfileIdFromUrl(currentAltUrl);
        const currentCfid = getCfId();
        if (expectedTargetCfid && currentCfid && expectedTargetCfid !== currentCfid) {
          return;
        }

        // The progress toasts say what the user actually asked for, so a compare
        // does not narrate itself as an alt hunt.
        const targetLabel = state.reportMode === 'compare'
          ? `profile ${currentAltIndex + 1} of ${altUrls.length}`
          : `alt account ${currentAltIndex + 1}`;
        const targetData = await collectProfileComparisonData(targetLabel);
        const matches = buildSharedMatchData(
          state.sourceTraces || [],
          targetData.traces,
          state.sourceIps || [],
          targetData.ips
        );
        const altResults = [
          ...(state.altResults || []),
          {
            url: currentAltUrl,
            steam64: targetData.steam64 || '',
            sharedTraces: matches.sharedTraces,
            similarMatches: matches.similarMatches,
            sharedIps: matches.sharedIps,
          },
        ];
        const nextAltIndex = currentAltIndex + 1;

        if (nextAltIndex < altUrls.length) {
          saveTraceCompareState({
            stage: 'alt-collect-target',
            sourceProfile: state.sourceProfile,
            reportMode: state.reportMode,
            sourceTraces: state.sourceTraces || [],
            sourceIps: state.sourceIps || [],
            sourceSteam64: state.sourceSteam64 || '',
            altUrls,
            altResults,
            currentAltIndex: nextAltIndex,
          });
          location.href = altUrls[nextAltIndex];
          return;
        }

        await finishMultiCompare(state, altResults);
        return;
      }

      if (state.stage === 'show-report') {
        if (!isRenderedSourceProfileReady(state.sourceProfile)) {
          if (state.readySince) {
            saveTraceCompareState({
              ...state,
              readySince: undefined,
            });
          }
          return;
        }

        if (!state.readySince) {
          saveTraceCompareState({
            ...state,
            readySince: Date.now(),
          });
          setTimeout(() => {
            scheduleProfileRefresh();
          }, 900);
          return;
        }

        const settledFor = Date.now() - state.readySince;
        if (settledFor < 800) {
          // Re-arm rather than relying solely on the timer set when readySince was
          // first recorded; without this the report could stall if no further
          // mutations arrived.
          setTimeout(() => scheduleProfileRefresh(), Math.max(100, 900 - settledFor));
          return;
        }

        const report = state.report || 'None found';
        clearTraceCompareState();

        const copied = await copyText(report);
        console.log(report);
        toast(copied ? (state.successToast || 'Trace comparison copied to clipboard.') : (state.failureToast || 'Trace comparison ready. Copy failed.'));
        showReportModal(report, 'Trace Comparison');
      }
    } catch (err) {
      console.error('Trace comparison failed:', err);
      clearTraceCompareState();
      toast('Trace comparison failed. Check console for details.');
    } finally {
      traceCompareRunning = false;
    }
  }

  /*************** Cheater ban scan ***************/
  // Walks the dashboard's player list, opens every player wearing a public-ban
  // badge, and reports back the ones whose ban reasons name them a cheater.
  //
  // Like the trace compare, this drives the page rather than calling an API: the
  // bans only exist in the DOM once a profile's Bans tab has rendered, so the job
  // navigates the tab and picks itself back up out of sessionStorage after every
  // load.
  const CHEATER_SCAN_KEY = 'codex-cheater-scan-state';
  // Refreshed on every hop, so this is the budget for one profile rather than for
  // the whole scan, which can legitimately take a while on a full server.
  const CHEATER_SCAN_RESUME_TTL_MS = 10 * 60 * 1000;
  // Case-insensitive substring match against the ban reason. "cheat" and
  // "cheating" are deliberately left out: the reason has to actually say cheater.
  // Add entries here to widen it.
  const CHEATER_BAN_KEYWORDS = ['cheater'];
  // Checked first and wins outright: a ban handed out for associating with a
  // cheater still says "cheater" in its reason, but it is not a cheater ban.
  const CHEATER_BAN_EXCLUSIONS = ['association'];
  // The dashboard renders this badge as "2 public bans"; the profile sidebar uses
  // "2 public ban(s)". Matching the singular covers both.
  const PUBLIC_BAN_BADGE_RE = /public ban/i;
  let cheaterScanRunning = false;

  function loadCheaterScanState() {
    try {
      return JSON.parse(sessionStorage.getItem(CHEATER_SCAN_KEY) || 'null');
    } catch {
      return null;
    }
  }

  // Timestamped on every save so an abandoned scan expires instead of waking up
  // much later, and so a storage failure is reported rather than escaping out of a
  // click handler unexplained.
  function saveCheaterScanState(state) {
    try {
      sessionStorage.setItem(CHEATER_SCAN_KEY, JSON.stringify({
        createdAt: Date.now(),
        ...state,
      }));
      return true;
    } catch (err) {
      console.error('Could not save cheater scan state:', err);
      toast('Could not save scan progress.');
      return false;
    }
  }

  function clearCheaterScanState() {
    try {
      sessionStorage.removeItem(CHEATER_SCAN_KEY);
    } catch (err) {
      console.error('Could not clear cheater scan state:', err);
    }
  }

  function isCheaterScanStateExpired(state) {
    if (!state?.createdAt) return true;
    return (Date.now() - state.createdAt) > CHEATER_SCAN_RESUME_TTL_MS;
  }

  // Query strings and hashes are ignored when checking whether the return trip has
  // landed: the dashboard route can pick one up on its own, and it is still the
  // same page.
  function isSameLocation(a, b) {
    try {
      const left = new URL(a || '', location.origin);
      const right = new URL(b || '', location.origin);
      return left.origin === right.origin && left.pathname === right.pathname;
    } catch {
      return false;
    }
  }

  function getDashboardPlayerCards() {
    return Array.from(document.querySelectorAll('.c-players-col .c-player'));
  }

  // The visible label of a `.text-copyable` lives in its first text node; the rest
  // of the span is the offscreen textarea CFTools uses for its own copy button.
  function getCopyableText(node) {
    if (!node) return '';

    for (const child of node.childNodes) {
      if (child.nodeType !== Node.TEXT_NODE) continue;
      const text = cleanWhitespace(child.textContent);
      if (text) return text;
    }

    return getCleanText(node);
  }

  function getDashboardPlayerName(card) {
    return getCopyableText(card.querySelector('.c-player-names .c-truncate-text .text-copyable'));
  }

  // Player rows carry several badge slots (VPN, VAC, public bans). Only a public
  // ban has a CFTools ban list behind it with a reason to read; a VAC ban is
  // Steam-side and carries no text to match on.
  function getPublicBanBadge(card) {
    for (const badge of card.querySelectorAll('.c-player-badge .badge')) {
      if (PUBLIC_BAN_BADGE_RE.test(getCleanText(badge))) return badge;
    }
    return null;
  }

  // Every card keeps its "Open profile" link in the collapsed body, so the rows do
  // not have to be expanded first.
  function getDashboardPlayerProfileUrl(card) {
    const href = card.querySelector('a[href*="/profile/"]')?.getAttribute('href');
    if (!href) return '';

    try {
      return new URL(href, location.origin).href;
    } catch {
      return '';
    }
  }

  // Deduplicated by CFTools id: a player who reconnects during the scan can show up
  // in the list twice, and visiting the same profile twice only pads the report.
  function getBannedDashboardPlayers() {
    const players = [];
    const seen = new Set();

    for (const card of getDashboardPlayerCards()) {
      const badge = getPublicBanBadge(card);
      if (!badge) continue;

      const url = getDashboardPlayerProfileUrl(card);
      const cfid = getCfIdFromUrl(url);
      if (!url || !cfid || seen.has(cfid)) continue;

      seen.add(cfid);
      players.push({
        cfid,
        url,
        name: getDashboardPlayerName(card) || cfid,
        badge: getCleanText(badge),
      });
    }

    return players;
  }

  // The sidebar's Bans entry carries a count badge ("Bans 2 public ban(s)"), so the
  // exact-text match findProfileLink uses cannot find it.
  function findBansProfileLink() {
    for (const link of document.querySelectorAll('.profile-links .profile-link')) {
      if (link.classList.contains('profile-server-link')) continue;
      if (/^bans$/i.test(getOwnText(link))) return link;
    }
    return null;
  }

  // The Bans view renders a plain bootstrap-vue table. Matching on its header text
  // rather than on an id keeps this working when CFTools renumbers its __BVID__s.
  function findBanTable() {
    for (const table of document.querySelectorAll('table')) {
      const headers = Array.from(table.querySelectorAll('thead th'))
        .map(th => getCleanText(th).toLowerCase());
      if (headers.includes('ban list') && headers.includes('reason')) return table;
    }
    return null;
  }

  // Column positions are read off the header row instead of being hard-coded, so an
  // added or reordered column cannot shift the reason out from under us. Expires is
  // read past rather than recorded: the report does not quote it.
  function getBanTableColumnIndexes(table) {
    const indexes = {};

    Array.from(table.querySelectorAll('thead th')).forEach((th, index) => {
      const label = getCleanText(th).toLowerCase();
      if (label && !(label in indexes)) indexes[label] = index;
    });

    return indexes;
  }

  // The ban list cell also holds the game-mode badge and a hidden preview card, so
  // only the cell's own text is the list's name.
  function getBanListName(cell) {
    const header = cell?.querySelector('.c-banlist-header');
    if (!header) return getCleanText(cell);
    return getOwnText(header) || getCleanText(header);
  }

  function readBansFromPage() {
    const table = findBanTable();
    if (!table) return [];

    const indexes = getBanTableColumnIndexes(table);
    const bans = [];

    for (const row of table.querySelectorAll('tbody tr')) {
      const cells = Array.from(row.querySelectorAll('td'));
      if (!cells.length) continue;

      const cellText = label => {
        const index = indexes[label];
        return index === undefined ? '' : getCleanText(cells[index]);
      };

      bans.push({
        banList: getBanListName(cells[indexes['ban list']]),
        issued: cellText('issue date'),
        reason: cellText('reason'),
      });
    }

    return bans;
  }

  function isCheaterBan(ban) {
    const reason = (ban?.reason || '').toLowerCase();
    if (!reason) return false;
    if (CHEATER_BAN_EXCLUSIONS.some(keyword => reason.includes(keyword))) return false;
    return CHEATER_BAN_KEYWORDS.some(keyword => reason.includes(keyword));
  }

  // Opens the profile's Bans tab and reads the table out of it.
  async function collectProfileBans(label) {
    toast(`Checking ${label}...`, 2500);
    await waitForPageReady();

    const bansLink = await waitForElement(() => findBansProfileLink(), 15000, 100);
    if (!bansLink.classList.contains('profile-link-active')) {
      clickElement(bansLink);
      await waitForElement(
        () => findBansProfileLink()?.classList.contains('profile-link-active') || null,
        10000,
        100
      );
    }

    // A missing table is a result, not a failure: the badge counts can lag, and a
    // profile can end up on the Bans tab with nothing to show. The shorter wait
    // keeps that case from costing the full element timeout on every player.
    try {
      await waitForElement(() => findBanTable(), 8000, 100);
    } catch {
      debugLog('[CFTools Tools] Cheater scan: no ban table rendered for', label);
      return [];
    }

    return readBansFromPage();
  }

  function buildCheaterScanReport(state) {
    if (state.mode === 'multi') return buildMultiServerCheaterScanReport(state);

    const results = state.results || [];
    const flagged = results.filter(result => result.matches?.length);
    const keywords = CHEATER_BAN_KEYWORDS.join(' / ');

    const lines = [
      'Cheater Ban Scan',
      `Players with a ${keywords} ban: ${flagged.length}`,
      '',
      'Flagged Players:',
    ];

    if (!flagged.length) {
      lines.push('None found');
    } else {
      flagged.forEach((result, index) => {
        if (index > 0) lines.push('');
        lines.push(`${result.name} - ${result.url}`);

        result.matches.forEach(ban => {
          const suffix = ban.issued ? ` (issued ${ban.issued})` : '';
          lines.push(`- [${ban.banList || 'Unknown ban list'}] ${ban.reason || 'No reason given'}${suffix}`);
        });
      });
    }

    return lines.join('\n');
  }

  async function showCheaterScanReport(report) {
    // The run is over by the time this is called, so the stop button goes before
    // the report does rather than lingering behind it until the next refresh.
    ensureCheaterScanStopButton();

    const copied = await copyText(report);
    console.log(report);
    toast(copied ? 'Cheater scan copied to clipboard.' : 'Cheater scan ready. Copy failed.');
    showReportModal(report, 'Cheater Ban Scan');
  }

  // The dashboard is a different page by the time the queue runs dry, so the report
  // rides along in the saved state and is shown once the return trip lands.
  async function finishCheaterScan(state) {
    const report = buildCheaterScanReport(state);

    if (state.returnUrl && !isSameLocation(state.returnUrl, location.href)) {
      if (saveCheaterScanState({ stage: 'show-report', returnUrl: state.returnUrl, report })) {
        location.href = state.returnUrl;
        return;
      }
    }

    clearCheaterScanState();
    await showCheaterScanReport(report);
  }

  // Three-stage workflow:
  // 1. Queue up every dashboard player carrying a public ban.
  // 2. Visit each of their profiles in turn, reading the Bans tab on each.
  // 3. Navigate back to the dashboard and show the report there.
  async function resumeCheaterScanWorkflow() {
    if (cheaterScanRunning) return;

    const state = loadCheaterScanState();
    if (!state) return;
    if (isCheaterScanStateExpired(state)) {
      clearCheaterScanState();
      return;
    }

    cheaterScanRunning = true;

    try {
      if (state.stage === 'collect') {
        const queue = state.queue || [];
        const index = state.index || 0;
        const player = queue[index];

        if (!player) {
          await finishCheaterScan(state);
          return;
        }

        // Resumed somewhere other than the profile we were sent to, most likely
        // because the user navigated away mid-scan. Leave the state alone so the
        // job picks up again if they come back, and let the TTL clear it if not.
        const currentCfid = getCfId();
        if (!currentCfid || currentCfid !== player.cfid) return;

        const results = [...(state.results || [])];

        // A profile that will not load is one skipped player, not a dead scan, so the
        // failure goes to the console and the queue moves on.
        try {
          const bans = await collectProfileBans(`${player.name} (${index + 1}/${queue.length})`);
          results.push({
            name: player.name,
            url: player.url,
            matches: bans.filter(isCheaterBan),
          });
        } catch (err) {
          console.error(`Cheater scan could not read ${player.url}:`, err);
        }

        if (isCheaterScanCancelled()) return;

        const nextState = { ...state, stage: 'collect', index: index + 1, results };
        const nextPlayer = queue[index + 1];

        if (!nextPlayer) {
          await finishCheaterScan(nextState);
          return;
        }

        if (!saveCheaterScanState(nextState)) {
          clearCheaterScanState();
          return;
        }

        location.href = nextPlayer.url;
        return;
      }

      if (state.stage === 'server-collect') {
        const servers = state.serverQueue || [];
        const serverIndex = state.serverIndex || 0;
        const server = servers[serverIndex];

        if (!server) {
          await startCheaterScanProfilePhase(state);
          return;
        }

        // Not on the dashboard we were sent to: either still on the way, or the
        // user has navigated off mid-sweep.
        if (getDashboardServerIdFromUrl() !== server.id) return;

        // A server whose list never renders is one gap in the report, not a dead
        // sweep, so the failure goes to the console and the queue moves on.
        let players = [];
        try {
          toast(`Reading ${server.name} (${serverIndex + 1}/${servers.length})...`, 2500);
          await waitForDashboardPlayerList();
          players = getBannedDashboardPlayers();
        } catch (err) {
          console.error(`Ban scan could not read the player list for ${server.name}:`, err);
        }

        if (isCheaterScanCancelled()) return;

        const serverPlayers = { ...(state.serverPlayers || {}), [server.id]: players };
        const nextState = { ...state, serverPlayers, serverIndex: serverIndex + 1 };
        const nextServer = servers[serverIndex + 1];

        if (!nextServer) {
          await startCheaterScanProfilePhase(nextState);
          return;
        }

        if (!saveCheaterScanState(nextState)) {
          clearCheaterScanState();
          return;
        }

        location.href = nextServer.url;
        return;
      }

      if (state.stage === 'profile-collect') {
        const queue = state.profileQueue || [];
        const index = state.profileIndex || 0;
        const player = queue[index];

        if (!player) {
          await finishCheaterScan(state);
          return;
        }

        const currentCfid = getCfId();
        if (!currentCfid || currentCfid !== player.cfid) return;

        const banMatches = { ...(state.banMatches || {}) };

        try {
          const bans = await collectProfileBans(`${player.name} (${index + 1}/${queue.length})`);
          banMatches[player.cfid] = bans.filter(isCheaterBan);
        } catch (err) {
          console.error(`Ban scan could not read ${player.url}:`, err);
          banMatches[player.cfid] = [];
        }

        if (isCheaterScanCancelled()) return;

        const nextState = { ...state, banMatches, profileIndex: index + 1 };
        const nextPlayer = queue[index + 1];

        if (!nextPlayer) {
          await finishCheaterScan(nextState);
          return;
        }

        if (!saveCheaterScanState(nextState)) {
          clearCheaterScanState();
          return;
        }

        location.href = nextPlayer.url;
        return;
      }

      if (state.stage === 'show-report') {
        // Still on the way back to where the scan was started from.
        if (state.returnUrl && !isSameLocation(state.returnUrl, location.href)) return;

        const report = state.report || 'No players scanned.';
        clearCheaterScanState();
        await showCheaterScanReport(report);
      }
    } catch (err) {
      console.error('Cheater scan failed:', err);
      clearCheaterScanState();
      toast('Cheater scan failed. Check console for details.');
    } finally {
      cheaterScanRunning = false;
    }
  }

  async function startCheaterScan() {
    // An expired leftover is not a running scan: it would otherwise block every
    // later scan until a refresh happened to clear it.
    const pending = loadCheaterScanState();
    if (cheaterScanRunning || (pending && !isCheaterScanStateExpired(pending))) {
      toast('A cheater scan is already running.');
      return;
    }

    const players = getBannedDashboardPlayers();
    if (!players.length) {
      toast('No players with public bans in this list.');
      return;
    }

    const saved = saveCheaterScanState({
      stage: 'collect',
      returnUrl: location.href,
      queue: players,
      index: 0,
      results: [],
    });
    if (!saved) return;

    toast(`Starting cheater scan on ${players.length} player(s)...`);
    location.href = players[0].url;
  }

  // Button shown on the dashboard's player-list toolbar, attached to the right-hand
  // edge of the Search field the way the Sort group's own button is.
  function createCheaterScanButton() {
    const btn = document.createElement('button');
    btn.id = 'cheater-scan-btn';
    btn.type = 'button';
    btn.className = 'btn btn-outline-danger btn-sm';
    btn.textContent = 'Scan Bans';
    btn.title = 'Open every player carrying a public ban and report the ones banned as a cheater';
    btn.addEventListener('click', () => {
      startCheaterScan().catch(err => {
        console.error('Cheater scan failed to start:', err);
        toast('Cheater scan failed to start. Check console for details.');
      });
    });
    return btn;
  }

  // Anchored to the Search label rather than to a column position, because the
  // toolbar's grid classes are shared with every other input group on the page.
  function findDashboardSearchInputGroup() {
    for (const label of document.querySelectorAll('.c-players-col .input-group .input-group-text')) {
      if (getCleanText(label).toLowerCase() !== 'search') continue;

      const group = label.closest('.input-group');
      if (group) return group;
    }
    return null;
  }

  function removeCheaterScanButton() {
    document.getElementById('cheater-scan-slot')?.remove();
  }

  function ensureCheaterScanButton() {
    if (!isCheaterScanButtonEnabled()) {
      removeCheaterScanButton();
      return;
    }

    const group = findDashboardSearchInputGroup();
    if (!group) {
      removeCheaterScanButton();
      return;
    }

    const existing = document.getElementById('cheater-scan-slot');
    // The append has to stay last inside the group, or bootstrap rounds the wrong
    // edge. A Vue rerender of the search field can drop it back in the middle.
    if (existing && existing.parentElement === group && existing === group.lastElementChild) return;

    const slot = existing || document.createElement('div');
    if (!existing) {
      slot.id = 'cheater-scan-slot';
      slot.className = 'input-group-append';
      slot.appendChild(createCheaterScanButton());
    }

    group.appendChild(slot);
  }

  /*************** Cheater ban scan: whole-server sweep ***************/
  // The player-list button scans the server you are looking at. This one scans a
  // set of them: it walks each selected server's dashboard collecting the banned
  // players, then visits every one of those profiles, then comes back and reports
  // per server.
  const DASHBOARD_ID_RE = /\/dashboard\/([a-f0-9]{24})(?:\/|$)/i;
  // The stages a run can be interrupted during, which is also when the stop button
  // is worth showing.
  const CHEATER_SCAN_ACTIVE_STAGES = ['collect', 'server-collect', 'profile-collect'];

  function getDashboardServerIdFromUrl(href = location.href) {
    try {
      const match = DASHBOARD_ID_RE.exec(new URL(href, location.origin).pathname);
      return match ? match[1].toLowerCase() : '';
    } catch {
      return '';
    }
  }

  function buildDashboardUrl(serverId) {
    return new URL(`/dashboard/${serverId}`, location.origin).href;
  }

  // The picker's last selection, kept in the script's own Tampermonkey storage so
  // it survives a restart and is shared with the other CFTools tabs.
  function loadSelectedScanServerIds() {
    if (!HAS_GM_STORAGE) return [];

    try {
      const parsed = JSON.parse(GM_getValue(CHEATER_SCAN_SERVERS_STORAGE_KEY, '[]'));
      return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }

  function saveSelectedScanServerIds(serverIds) {
    if (!HAS_GM_STORAGE) return;

    try {
      GM_setValue(CHEATER_SCAN_SERVERS_STORAGE_KEY, JSON.stringify(serverIds));
    } catch (err) {
      console.error('Could not save the scan server selection:', err);
    }
  }

  // Checkbox picker over the servers CFTools' own nav says you have access to.
  // Resolves with the chosen ids, or null if it was cancelled.
  function openScanServerPicker(servers) {
    const open = document.getElementById('cheater-scan-picker');
    if (open) {
      open.querySelector('input')?.focus();
      return Promise.resolve(null);
    }

    return new Promise(resolve => {
      const previous = new Set(loadSelectedScanServerIds());

      const overlay = document.createElement('div');
      overlay.id = 'cheater-scan-picker';
      overlay.style.cssText = DIALOG_OVERLAY_CSS;

      const panel = document.createElement('div');
      panel.style.cssText = DIALOG_PANEL_CSS;

      const title = document.createElement('div');
      title.textContent = 'Scan Bans';
      title.style.cssText = DIALOG_TITLE_CSS;

      const hint = document.createElement('div');
      hint.textContent = 'Pick the servers to sweep. Each one is opened in turn, and every player on it carrying a public ban gets their profile checked.';
      hint.style.cssText = DIALOG_HINT_CSS;

      const list = document.createElement('div');
      list.style.cssText = `
        max-height: 45vh; overflow: auto; border: 1px solid #2c313a;
        border-radius: 6px; padding: 6px 8px;
      `;

      const error = document.createElement('div');
      error.style.cssText = DIALOG_ERROR_CSS;

      const boxes = servers.map(server => {
        const row = document.createElement('label');
        row.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 5px 2px; cursor: pointer;';

        const box = document.createElement('input');
        box.type = 'checkbox';
        box.value = server.id;
        box.checked = previous.has(server.id);
        box.style.cssText = 'width: 15px; height: 15px; accent-color: #1f6f4a; flex: none;';
        box.addEventListener('change', () => {
          error.textContent = '';
        });

        const name = document.createElement('span');
        name.textContent = server.name;

        row.append(box, name);
        list.appendChild(row);
        return box;
      });

      function close(result) {
        document.removeEventListener('keydown', onDocumentKeydown, true);
        overlay.remove();
        resolve(result);
      }

      function onDocumentKeydown(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          close(null);
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          submit();
        }
      }

      function submit() {
        const chosen = boxes.filter(box => box.checked).map(box => box.value);
        if (!chosen.length) {
          error.textContent = 'Pick at least one server.';
          return;
        }
        close(chosen);
      }

      const allButton = createDialogButton('Select all', DIALOG_NEUTRAL_BG, DIALOG_NEUTRAL_HOVER);
      allButton.addEventListener('click', () => {
        boxes.forEach(box => (box.checked = true));
        error.textContent = '';
      });

      const noneButton = createDialogButton('Select none', DIALOG_NEUTRAL_BG, DIALOG_NEUTRAL_HOVER);
      noneButton.addEventListener('click', () => boxes.forEach(box => (box.checked = false)));

      const spacer = document.createElement('div');
      spacer.style.cssText = 'flex: 1;';

      const cancelButton = createDialogButton('Cancel', DIALOG_NEUTRAL_BG, DIALOG_NEUTRAL_HOVER);
      cancelButton.addEventListener('click', () => close(null));

      const scanButton = createDialogButton('Scan', DIALOG_CONFIRM_BG, DIALOG_CONFIRM_HOVER);
      scanButton.addEventListener('click', () => submit());

      const actions = document.createElement('div');
      actions.style.cssText = DIALOG_ACTIONS_CSS;
      actions.append(allButton, noneButton, spacer, cancelButton, scanButton);

      panel.append(title, hint, list, error, actions);
      overlay.appendChild(panel);
      overlay.addEventListener('mousedown', event => {
        if (event.target === overlay) close(null);
      });

      document.addEventListener('keydown', onDocumentKeydown, true);
      document.body.appendChild(overlay);
      (boxes.find(box => box.checked) || boxes[0])?.focus();
    });
  }

  // The sidebar card for a server carries its live player count ("20 / 115"), which
  // is the only thing on the page that says how long the list still has to go. It
  // can be a moment stale either way, so it is a fast path rather than the whole
  // answer: hitting it ends the wait immediately, missing it falls through to the
  // settle window below.
  function getExpectedDashboardPlayerCount(serverId) {
    if (!serverId) return null;

    for (const link of document.querySelectorAll(SERVER_LINK_SELECTOR)) {
      if (getServerIdFromHref(link.getAttribute('href')) !== serverId) continue;

      const card = findServerCardForLink(link, serverId);
      const match = /(\d+)\s*\/\s*\d+/.exec(getCleanText(card.querySelector('.badge')));
      if (match) return Number(match[1]);
    }

    return null;
  }

  // How long the card total has to hold still before the list counts as finished.
  // Cards on screen settle fast; an empty list has to be waited out, and is given
  // less rope when the nav agrees the server is empty.
  function getDashboardListSettleMs(count, expected) {
    if (count > 0) return 600;
    return expected === 0 ? 1200 : 4000;
  }

  // The list paints over several frames and an empty server never paints a card at
  // all, so short of the count above this waits for the card total to stop moving
  // rather than for a card to turn up. Without either, a fast hop reads a
  // half-rendered list and under-reports.
  async function waitForDashboardPlayerList(timeoutMs = 25000) {
    const serverId = getDashboardServerIdFromUrl();
    await waitForElement(() => findDashboardSearchInputGroup(), timeoutMs, 100);

    // Read once the toolbar is up, by which point the nav has long rendered.
    const expected = getExpectedDashboardPlayerCount(serverId);
    const started = Date.now();
    let lastCount = -1;
    let stableSince = Date.now();

    while (Date.now() - started < timeoutMs) {
      const count = getDashboardPlayerCards().length;

      // Everyone the nav knows about is on screen, so there is nothing to settle.
      // Only a positive count is trusted outright: a nav that has not filled in yet
      // also reads as 0, and taking that at face value would skip a busy server.
      if (expected && count >= expected) return count;

      if (count !== lastCount) {
        lastCount = count;
        stableSince = Date.now();
      } else if (Date.now() - stableSince > getDashboardListSettleMs(count, expected)) {
        return count;
      }

      await delay(100);
    }

    return getDashboardPlayerCards().length;
  }

  // The stop button clears the saved state out from under a run that is already
  // mid-flight, so every hop re-checks that the job it is continuing is still
  // wanted before it saves progress or navigates anywhere.
  function isCheaterScanCancelled() {
    try {
      return !sessionStorage.getItem(CHEATER_SCAN_KEY);
    } catch {
      return false;
    }
  }

  // Deliberately not a full parse: during a large sweep that JSON holds every
  // queued player, and this runs on every refresh.
  function hasActiveCheaterScan() {
    let raw = '';
    try {
      raw = sessionStorage.getItem(CHEATER_SCAN_KEY) || '';
    } catch {
      return false;
    }
    if (!raw) return false;

    return CHEATER_SCAN_ACTIVE_STAGES.some(stage => raw.includes(`"stage":"${stage}"`));
  }

  function createCheaterScanStopButton() {
    const btn = document.createElement('button');
    btn.id = 'cheater-scan-stop-btn';
    btn.type = 'button';
    btn.textContent = 'Stop ban scan';
    btn.style.cssText = `
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;
      background: #c0392b; color: #fff; border: none; border-radius: 999px;
      cursor: pointer; font: 13px system-ui,sans-serif; padding: 9px 16px;
      box-shadow: 0 8px 25px rgba(0,0,0,.35);
    `;
    btn.addEventListener('mouseenter', () => (btn.style.background = '#e74c3c'));
    btn.addEventListener('mouseleave', () => (btn.style.background = '#c0392b'));
    btn.addEventListener('click', () => {
      clearCheaterScanState();
      btn.remove();
      toast('Ban scan stopped.');
    });
    return btn;
  }

  // Not gated on the button toggle: hiding the entry points should not strip the
  // only way to call off a run that is already going.
  function ensureCheaterScanStopButton() {
    const existing = document.getElementById('cheater-scan-stop-btn');

    if (!hasActiveCheaterScan()) {
      existing?.remove();
      return;
    }
    if (existing) return;

    document.body.appendChild(createCheaterScanStopButton());
  }

  async function startMultiServerCheaterScan() {
    const pending = loadCheaterScanState();
    if (cheaterScanRunning || (pending && !isCheaterScanStateExpired(pending))) {
      toast('A ban scan is already running.');
      return;
    }

    const servers = readServerMap();
    if (!servers.length) {
      toast('No servers found in the sidebar.');
      return;
    }

    const chosenIds = await openScanServerPicker(servers);
    if (!chosenIds?.length) return;

    saveSelectedScanServerIds(chosenIds);

    // Built from the nav's own order so the report reads the way the sidebar does.
    const serverQueue = servers
      .filter(server => chosenIds.includes(server.id))
      .map(server => ({ id: server.id, name: server.name, url: buildDashboardUrl(server.id) }));
    if (!serverQueue.length) return;

    const saved = saveCheaterScanState({
      stage: 'server-collect',
      mode: 'multi',
      returnUrl: location.href,
      serverQueue,
      serverIndex: 0,
      serverPlayers: {},
    });
    if (!saved) return;

    toast(`Starting ban scan on ${serverQueue.length} server(s)...`);
    location.href = serverQueue[0].url;
  }

  // Every server has been read, so the players are flattened into one visit list.
  // A player online on two selected servers is visited once and then reported
  // under both, which the per-server layout gets for free.
  async function startCheaterScanProfilePhase(state) {
    const serverPlayers = state.serverPlayers || {};
    const profileQueue = [];
    const seen = new Set();

    for (const server of state.serverQueue || []) {
      for (const player of serverPlayers[server.id] || []) {
        if (seen.has(player.cfid)) continue;
        seen.add(player.cfid);
        profileQueue.push(player);
      }
    }

    const nextState = {
      ...state,
      stage: 'profile-collect',
      profileQueue,
      profileIndex: 0,
      banMatches: {},
    };

    if (!profileQueue.length) {
      await finishCheaterScan(nextState);
      return;
    }

    if (!saveCheaterScanState(nextState)) {
      clearCheaterScanState();
      return;
    }

    location.href = profileQueue[0].url;
  }

  function buildMultiServerCheaterScanReport(state) {
    const servers = state.serverQueue || [];
    const serverPlayers = state.serverPlayers || {};
    const banMatches = state.banMatches || {};
    const flaggedCfids = new Set();
    const lines = [];

    // A server only earns a section by having someone to report. A sweep of a dozen
    // servers is mostly quiet ones, and listing them all buries the hits.
    servers.forEach(server => {
      const flagged = (serverPlayers[server.id] || [])
        .filter(player => (banMatches[player.cfid] || []).length);
      if (!flagged.length) return;

      lines.push('');
      lines.push(server.name);

      flagged.forEach(player => {
        flaggedCfids.add(player.cfid);
        lines.push(`${player.name} - ${player.url}`);

        banMatches[player.cfid].forEach(ban => {
          const suffix = ban.issued ? ` (issued ${ban.issued})` : '';
          lines.push(`- [${ban.banList || 'Unknown ban list'}] ${ban.reason || 'No reason given'}${suffix}`);
        });
      });
    });

    if (!lines.length) {
      lines.push('');
      lines.push('None found');
    }

    return [
      'Cheater Ban Scan',
      `Players with a ${CHEATER_BAN_KEYWORDS.join(' / ')} ban: ${flaggedCfids.size}`,
      ...lines,
    ].join('\n');
  }

  // Sidebar entry point, sat on the Servers heading with the add-server and
  // nav-settings icons. The heading has no room for a labelled button, so it is an
  // icon in their style: a red magnifying glass, with the tooltip carrying the
  // wording.
  function createCheaterScanServersButton() {
    const slot = document.createElement('div');
    slot.id = 'cheater-scan-servers-slot';
    slot.className = 'd-inline-block float-right ml-1 mr-1';

    const link = document.createElement('a');
    link.href = 'javascript: void(0);';
    link.className = 'p-0 m-0 float-right';
    link.title = 'Scan Bans: sweep servers for players banned as cheaters';
    // The neighbouring icons carry these overrides, so a plain anchor here would be
    // laid out differently to the two sat next to it.
    link.style.cssText = 'pointer-events: auto !important; position: unset !important; display: unset !important;';

    const icon = document.createElement('i');
    icon.className = 'fad fa-search text-danger align-middle';
    icon.style.cssText = 'font-size: 20px;';

    link.appendChild(icon);
    link.addEventListener('click', event => {
      event.preventDefault();
      startMultiServerCheaterScan().catch(err => {
        console.error('Ban scan failed to start:', err);
        toast('Ban scan failed to start. Check console for details.');
      });
    });

    slot.appendChild(link);
    return slot;
  }

  function findServersMenuTitle() {
    for (const item of document.querySelectorAll('#side-menu li.menu-title')) {
      if (/^servers$/i.test(getCleanText(item))) return item;
    }
    return null;
  }

  function ensureCheaterScanServersButton() {
    const existing = document.getElementById('cheater-scan-servers-slot');

    if (!isCheaterScanButtonEnabled()) {
      existing?.remove();
      return;
    }

    const heading = findServersMenuTitle();
    if (!heading) {
      existing?.remove();
      return;
    }

    // The heading's right-hand half is the tray the other two icons float in.
    const tray = heading.querySelector('.d-inline-block.align-middle') || heading;
    if (existing && existing.parentElement === tray) return;

    existing?.remove();
    tray.appendChild(createCheaterScanServersButton());
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
      // Captured before the Steam64 lookup navigates away from this view.
      const profileUrl = location.href;
      const ignName = getProfileName();
      let serverName = getPreferredServerName();
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

      const banEntry = buildBanEntry(steam64, serverName, reason, term, ignName, profileUrl);
      const copied = await copyText(banEntry);
      toast(copied ? 'Ban entry template copied.' : 'Could not copy ban entry.');
    });
    return btn;
  }

  // Only show the Discord ban helper when we have enough profile context,
  // and the user is currently on an active server page.
  // The slot goes too: it is ours, and leaving an empty one behind would keep a
  // gap in the profile header next to the CFTools ID.
  function removeBanEntryButton() {
    document.getElementById('ban-entry-btn')?.remove();
    document.getElementById('ban-entry-slot')?.remove();
  }

  function ensureBanEntryButton() {
    if (!isBanEntryButtonEnabled()) {
      removeBanEntryButton();
      return;
    }

    const cfid = getCfId();
    const headerLeft = findProfileHeaderLeft();
    const idItem = headerLeft
      ? findProfileIdItem(headerLeft)
      : findProfileIdItem(document.querySelector('.page-title-card') || document);
    const idSpan = idItem?.querySelector('.text-copyable.text-code') || findProfileIdSpan(cfid) || null;
    const existing = document.getElementById('ban-entry-btn');
    const activeServer = getActiveServerLink();
    const activeServerEntry = getActiveServerEntryLink();
    const activeProfileSection = getActiveProfileSectionLink();
    const serverEntry = getServerEntryLink();

    debugLog('[CFTools Tools] Ban debug: ensure button state', {
      cfid,
      hasPageTitleCard: Boolean(document.querySelector('.page-title-card')),
      hasProfileContainer: Boolean(document.querySelector('.profile-container')),
      hasProfileLinks: Boolean(document.querySelector('.profile-links')),
      hasHeaderLeft: Boolean(headerLeft),
      hasIdItem: Boolean(idItem),
      hasIdSpan: Boolean(idSpan),
      hasActiveProfileSection: Boolean(activeProfileSection),
      activeProfileSectionName: activeProfileSection ? getCleanText(activeProfileSection) : '',
      hasActiveServer: Boolean(activeServer),
      hasActiveServerEntry: Boolean(activeServerEntry),
      hasServerEntry: Boolean(serverEntry),
      activeServerName: activeServer ? getCleanText(activeServer) : '',
      serverEntryName: serverEntry ? getCleanText(serverEntry) : '',
    });

    if (!cfid || !idSpan || activeProfileSection || !activeServerEntry) {
      removeBanEntryButton();
      return;
    }

    const targetContainer = idItem || idSpan.closest('.profile-container-item');
    const resolvedHeaderLeft = headerLeft || idSpan.closest('.profile-container-left') || findProfileHeaderLeft();
    if (!targetContainer || !resolvedHeaderLeft) {
      removeBanEntryButton();
      return;
    }

    let slot = document.getElementById('ban-entry-slot');
    if (!slot) {
      slot = document.createElement('div');
      slot.id = 'ban-entry-slot';
      slot.className = 'profile-container-item profile-container-data';
      slot.style.display = 'flex';
      slot.style.alignItems = 'center';
      slot.style.marginLeft = '10px';
      targetContainer.insertAdjacentElement('afterend', slot);
    } else if (slot.previousElementSibling !== targetContainer) {
      targetContainer.insertAdjacentElement('afterend', slot);
    }

    if (existing && existing.parentElement === slot) return;
    if (existing) existing.remove();
    debugLog('[CFTools Tools] Ban debug: inserting button after CFTools ID item');
    slot.replaceChildren(createBanEntryButton());
  }

  // Profile-side refreshes are also debounced so repeated rerenders do not spam DOM work.
  // The scheduler holds its debounce flag until the callback settles, so these
  // callbacks stay synchronous and the long-running jobs are started detached.
  // Awaiting resumeTraceCompareWorkflow here would block every refresh for the
  // minutes a comparison takes, leaving the buttons unattached once it ends.
  // Both jobs already guard their own reentrancy (traceCompareRunning /
  // serverLogsFilterApplying), so nothing can overlap itself.
  const scheduleProfileRefresh = makeScheduler(() => {
    ensureBanEntryButton();
    ensureTraceCompareButton();
    ensureAltCompareButton();
    ensureCheaterScanButton();
    ensureCheaterScanServersButton();
    ensureCheaterScanStopButton();
    resumeTraceCompareWorkflow().catch(err => {
      console.error('Trace comparison failed:', err);
    });
    resumeCheaterScanWorkflow().catch(err => {
      console.error('Cheater scan failed:', err);
    });
  });
  const scheduleServerLogsRefresh = makeScheduler(() => {
    if (isServerLogsPage()) {
      applyPendingServerLogsFilter().catch(err => {
        console.error('Server-log filter auto-fill failed:', err);
      });
      return;
    }

    serverLogsRefreshMutating = true;
    try {
      addServerLogsButtons();
    } finally {
      setTimeout(() => {
        serverLogsRefreshMutating = false;
      }, 0);
    }
  });

  // CFTools sometimes renders a route in multiple passes.
  // These follow-up refreshes give profile helpers another chance to attach
  // after the header/sidebar finishes painting. The dashboard needs them too now
  // that the Scan Bans button and the scan report both land on the player list,
  // so the guard only skips the one route with no profile-side helper on it.
  const PROFILE_REFRESH_RETRY_DELAYS_MS = [250, 1000, 2500, 5000, 10000, 15000];
  let profileRefreshRetryToken = 0;

  function queueProfileRefreshFollowUps() {
    if (isServerLogsPage()) return;

    const retryToken = ++profileRefreshRetryToken;
    for (const delayMs of PROFILE_REFRESH_RETRY_DELAYS_MS) {
      window.setTimeout(() => {
        if (profileRefreshRetryToken !== retryToken || isServerLogsPage()) return;
        scheduleProfileRefresh();
      }, delayMs);
    }
  }

  // Mutation observers only react when relevant parts of the page are added.
  const COORD_OBSERVER_SELECTOR = 'span.text-code, .event-details';
  // Narrowed to the containers the ensure* helpers actually anchor to. The previous
  // list carried catch-alls -- `tbody tr`, `a[href*="/profile/"]`, `.table-responsive`,
  // `.team` -- that match somewhere on every profile page, so nearly every mutation
  // counted as relevant. `.card .card-body` is now just `.card-body`: matching one
  // class is cheaper and equivalent here.
  // `.profile-link-active` needs no entry: class changes land on an element that
  // already matches `.profile-link` / `.profile-server-link`.
  const PROFILE_OBSERVER_SELECTOR = '.profile-container-left, .profile-container-item, .mobile-profile-container-item, .text-copyable.text-code, .profile-links, .profile-link, .profile-server-link, .c-page-header, .c-nav, .c-nav-item, .c-nav-link, .page-title-card, .card-body, .card-title, .menu-title';
  const SERVER_LOGS_OBSERVER_SELECTOR = 'table, tbody, tr';

  scheduleCoordRefresh();
  scheduleProfileRefresh();
  scheduleServerLogsRefresh();
  queueProfileRefreshFollowUps();

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
  const serverLogsObserver = new MutationObserver(mutations => {
    if (serverLogsRefreshMutating) return;
    if (!mutationsContainRelevantNode(mutations, SERVER_LOGS_OBSERVER_SELECTOR)) return;
    scheduleServerLogsRefresh();
  });
  serverLogsObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

  // Re-run setup when CFTools changes routes without doing a full page reload.
  installRouteWatcher(() => {
    scheduleCoordRefresh();
    scheduleProfileRefresh();
    scheduleServerLogsRefresh();
    queueProfileRefreshFollowUps();
  });
})();
