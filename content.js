(() => {
  const replayedEvents = new WeakSet();
  let overlayHost = null;
  let activeDialog = null;

  function findAnchor(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    for (const node of path) {
      if (node instanceof Element && node.matches('a[href], area[href]')) return node;
    }
    return null;
  }

  function eligible(anchor, event) {
    if (!anchor || event.defaultPrevented || event.button > 1 || anchor.hasAttribute('download')) return false;
    let target;
    try { target = new URL(anchor.href, location.href); } catch { return false; }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
    if (target.username || target.password) return false;
    const sameDocument = target.origin === location.origin && target.pathname === location.pathname && target.search === location.search;
    if (sameDocument && target.href.includes('#')) return false;
    return true;
  }

  function send(message) {
    try {
      return Promise.resolve(chrome.runtime.sendMessage(message));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function describeUrl(raw) {
    try {
      const url = new URL(raw);
      return `${url.host}${url.pathname === '/' ? '' : url.pathname}${url.search}`;
    } catch {
      return raw;
    }
  }

  function showNotice(message) {
    const host = getHost();
    if (!host) return;
    let status = host.shadowRoot.querySelector('[role="status"]');
    if (!status) {
      status = document.createElement('div');
      status.setAttribute('role', 'status');
      status.className = 'status';
      host.shadowRoot.append(status);
    }
    status.textContent = message;
    window.setTimeout(() => status.isConnected && status.remove(), 5000);
  }

  function getHost() {
    if (overlayHost && overlayHost.isConnected && overlayHost.shadowRoot) return overlayHost;
    overlayHost = document.createElement('div');
    overlayHost.style.cssText = 'all:initial;position:fixed;z-index:2147483647;inset:0;pointer-events:none';
    (document.documentElement || document).append(overlayHost);
    overlayHost.attachShadow({ mode: 'open' });
    return overlayHost;
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function formatDate(value) {
    if (!value) return 'Date unavailable';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date unavailable' : `Last opened ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)}`;
  }

  function showDialog(record, url, onCancel, onContinue) {
    closeDialog();
    const host = getHost();
    const shadow = host.shadowRoot;
    const style = element('style');
    style.textContent = `
      :host{all:initial}*{box-sizing:border-box} .veil{position:fixed;inset:0;display:grid;place-items:center;padding:20px;background:rgba(17,35,58,.42);pointer-events:auto;font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#18304d}
      .card{width:min(440px,calc(100vw - 32px));background:#fff;border:1px solid #dce8f3;border-radius:16px;padding:24px;box-shadow:0 18px 64px rgba(13,35,62,.28)}
      .mark{width:36px;height:36px;border-radius:11px;background:#eff6ff;color:#334ebd;display:grid;place-items:center;font-size:19px;margin-bottom:14px}
      h2{font-size:20px;line-height:1.25;margin:0 0 8px;font-weight:700;letter-spacing:-.02em}p{margin:0 0 14px;color:#526579}
      .url{overflow-wrap:anywhere;border-radius:9px;background:#f3f7fb;padding:10px 12px;font-size:13px;color:#18304d}
      .meta{font-size:12px;color:#526579;margin-top:10px}.count{color:#9a6a0b;background:#fff6df;border-radius:99px;padding:4px 8px;display:inline-block;margin-top:12px;font-size:12px;font-weight:650}
      .actions{display:flex;justify-content:flex-end;gap:9px;margin-top:22px}button{font:inherit;font-weight:650;border:1px solid #d6e0ea;border-radius:9px;padding:9px 14px;background:#fff;color:#18304d;cursor:pointer}
      button.primary{background:#334ebd;border-color:#334ebd;color:white}button:focus-visible{outline:3px solid #9db4ff;outline-offset:2px}
      .status{position:fixed;right:16px;bottom:16px;padding:10px 14px;background:#fff;border:1px solid #dce8f3;border-radius:10px;box-shadow:0 5px 24px #18304d33;color:#18304d;font:13px system-ui,sans-serif;pointer-events:auto}`;
    const veil = element('div', null, 'veil');
    veil.setAttribute('role', 'presentation');
    const card = element('section', null, 'card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'seen-before-title');
    card.setAttribute('aria-describedby', 'seen-before-details');
    const mark = element('div', '↗', 'mark');
    mark.setAttribute('aria-hidden', 'true');
    const title = element('h2', 'You’ve opened this link before');
    title.id = 'seen-before-title';
    const details = element('p', 'This link is already in your local Seen Before list.');
    details.id = 'seen-before-details';
    const address = element('div', describeUrl(url), 'url');
    address.title = url;
    const meta = element('div', formatDate(record && record.lastClickedAt), 'meta');
    const count = Number(record && record.clickCount) || 1;
    const badge = element('div', `Opened ${count} ${count === 1 ? 'time' : 'times'}`, 'count');
    const actions = element('div', null, 'actions');
    const cancel = element('button', 'Cancel');
    const proceed = element('button', 'Open anyway', 'primary');
    cancel.type = proceed.type = 'button';
    actions.append(cancel, proceed);
    card.append(mark, title, details, address, meta, badge, actions);
    veil.append(card);
    shadow.append(style, veil);
    activeDialog = { host, veil, previousFocus: document.activeElement };

    const closeAnd = (callback) => {
      const previous = activeDialog && activeDialog.previousFocus;
      closeDialog();
      if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
      callback();
    };
    cancel.addEventListener('click', () => closeAnd(onCancel));
    proceed.addEventListener('click', () => closeAnd(onContinue));
    veil.addEventListener('click', (event) => { if (event.target === veil) closeAnd(onCancel); });
    veil.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeAnd(onCancel); return; }
      if (event.key === 'Tab') {
        event.preventDefault();
        const focusables = [cancel, proceed];
        const current = focusables.indexOf(shadow.activeElement);
        const next = (current + (event.shiftKey ? focusables.length - 1 : 1)) % focusables.length;
        focusables[next].focus();
      }
    });
    proceed.focus({ preventScroll: true });
  }

  function closeDialog() {
    if (!activeDialog) return;
    activeDialog.host.shadowRoot.replaceChildren();
    activeDialog.host.remove();
    activeDialog = null;
  }

  function replay(original, anchor, url, fallbackAux = false) {
    if (!anchor.isConnected) anchor = null;
    if (anchor) {
      const replay = new MouseEvent(original.type === 'auxclick' ? 'auxclick' : 'click', {
        bubbles: true, cancelable: true, composed: true, view: window,
        detail: original.detail, screenX: original.screenX, screenY: original.screenY,
        clientX: original.clientX, clientY: original.clientY, button: original.button,
        buttons: original.buttons, ctrlKey: original.ctrlKey, shiftKey: original.shiftKey,
        altKey: original.altKey, metaKey: original.metaKey
      });
      replayedEvents.add(replay);
      anchor.dispatchEvent(replay);
      if (fallbackAux && !replay.defaultPrevented) openTemporary(url, '_blank');
      return;
    }
    const target = original.target || '_self';
    if (fallbackAux || original.ctrlKey || original.metaKey || original.shiftKey) openTemporary(url, target === '_self' ? '_blank' : target);
    else if (target === '_top') window.top.location.assign(url);
    else if (target === '_parent') window.parent.location.assign(url);
    else if (target === '_self') location.assign(url);
    else openTemporary(url, target);
  }

  function openTemporary(url, target) {
    const temp = document.createElement('a');
    temp.href = url;
    temp.target = target || '_blank';
    temp.rel = 'noopener noreferrer';
    temp.style.display = 'none';
    // Keep the fallback activation inside our isolated shadow root so the
    // page does not observe a second click after its original auxclick.
    getHost().shadowRoot.append(temp);
    const activation = new MouseEvent('click', {
      bubbles: true, cancelable: true, composed: false, view: window, button: 0
    });
    replayedEvents.add(activation);
    temp.dispatchEvent(activation);
    temp.remove();
  }

  function handleNavigation(event) {
    if (!event.isTrusted || replayedEvents.has(event) || event.defaultPrevented) return;
    const anchor = findAnchor(event);
    if (!eligible(anchor, event)) return;
    const rawUrl = anchor.href;
    let normalized;
    try { normalized = new URL(rawUrl); normalized.hash = ''; } catch { return; }
    const url = normalized.href;
    const original = {
      type: event.type, detail: event.detail, screenX: event.screenX, screenY: event.screenY,
      clientX: event.clientX, clientY: event.clientY, button: event.button, buttons: event.buttons,
      ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey,
      target: anchor.getAttribute('target') || document.querySelector('base[target]')?.getAttribute('target') || '_self'
    };
    const isAux = event.type === 'auxclick' || event.button === 1;
    event.preventDefault();
    event.stopImmediatePropagation();
    send({ type: 'CHECK_URL', url }).then((response) => {
      if (!response || !response.ok) {
        showNotice('Seen Before could not check this link. Opening it normally.');
        replay(original, anchor, rawUrl, isAux);
      } else if (!response.enabled || !response.repeated) {
        replay(original, anchor, rawUrl, isAux);
      } else {
        showDialog(response.record, rawUrl, () => {}, () => {
          send({ type: 'RECORD_URL', url }).then((result) => {
            if (!result || !result.ok) showNotice('The link opened, but Seen Before could not update its count.');
          }).catch(() => showNotice('The link opened, but Seen Before could not update its count.')).finally(() => {
            replay(original, anchor, rawUrl, isAux);
          });
        });
      }
    }).catch(() => {
      showNotice('Seen Before is unavailable. Opening this link normally.');
      replay(original, anchor, rawUrl, isAux);
    });
  }

  window.addEventListener('click', handleNavigation, true);
  window.addEventListener('auxclick', handleNavigation, true);
})();
