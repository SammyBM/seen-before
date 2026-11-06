const enabledInput = document.getElementById('enabled');
const totalNode = document.getElementById('total');
const historyNode = document.getElementById('history');
const clearButton = document.getElementById('clear');
const statusNode = document.getElementById('status');
let records = [];
let clearConfirm = false;
let stateUnavailable = false;

function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}

function setStatus(message) {
  statusNode.textContent = message;
}

function displayUrl(value) {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}${url.search}`;
  } catch {
    return value || 'Unknown link';
  }
}

function relativeDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return 'Date unavailable';
  const delta = Math.max(0, Date.now() - date.getTime());
  if (delta < 60_000) return 'Just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} min ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} hr ago`;
  if (delta < 604_800_000) return `${Math.floor(delta / 86_400_000)} days ago`;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function makeButton(label, className, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (className) button.className = className;
  button.addEventListener('click', action);
  return button;
}

function render() {
  totalNode.textContent = String(records.length);
  historyNode.replaceChildren();
  clearButton.hidden = records.length === 0 && !stateUnavailable;
  if (records.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    const headline = document.createElement('strong');
    headline.textContent = 'Your list is ready';
    const explanation = document.createElement('span');
    explanation.textContent = 'Links you click from now on will appear here.';
    empty.append(headline, explanation);
    historyNode.append(empty);
    return;
  }

  for (const record of records.slice(0, 8)) {
    const row = document.createElement('div');
    row.className = 'row';
    const mark = document.createElement('span');
    mark.className = 'row-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '↗';
    const main = document.createElement('div');
    main.className = 'row-main';
    const url = document.createElement('span');
    url.className = 'row-url';
    url.textContent = displayUrl(record.url);
    url.title = record.url;
    const meta = document.createElement('span');
    meta.className = 'row-meta';
    const count = Number(record.clickCount) || 1;
    meta.textContent = `${relativeDate(record.lastClickedAt)} · opened ${count} ${count === 1 ? 'time' : 'times'}`;
    main.append(url, meta);
    const remove = makeButton('×', 'remove', async () => {
      remove.disabled = true;
      try {
        const response = await send('DELETE_URL', { url: record.url });
        if (!response || !response.ok) throw new Error(response && response.error || 'Could not remove this link.');
        await loadState();
        setStatus('Link removed.');
      } catch (error) {
        remove.disabled = false;
        setStatus(error.message || 'Could not remove this link. Try again.');
      }
    });
    remove.setAttribute('aria-label', `Remove ${displayUrl(record.url)}`);
    row.append(mark, main, remove);
    historyNode.append(row);
  }
  if (records.length > 8) {
    const more = document.createElement('p');
    more.className = 'row-meta';
    more.textContent = `and ${records.length - 8} more saved links`;
    more.style.margin = '9px 3px 2px';
    historyNode.append(more);
  }
}

async function loadState() {
  const response = await send('GET_STATE');
  if (!response || !response.ok) throw new Error(response && response.error || 'Could not load your saved links.');
  stateUnavailable = false;
  enabledInput.checked = Boolean(response.enabled);
  const value = response.records || [];
  records = Array.isArray(value) ? value : Object.values(value);
  records.sort((a, b) => new Date(b.lastClickedAt || 0) - new Date(a.lastClickedAt || 0));
  render();
}

enabledInput.addEventListener('change', async () => {
  enabledInput.disabled = true;
  try {
    const response = await send('SET_ENABLED', { enabled: enabledInput.checked });
    if (!response || !response.ok) throw new Error(response && response.error || 'Could not save this setting.');
    setStatus(enabledInput.checked ? 'Repeat link warnings are on.' : 'Repeat link warnings are off.');
  } catch (error) {
    enabledInput.checked = !enabledInput.checked;
    setStatus(error.message || 'Could not save this setting.');
  } finally {
    enabledInput.disabled = false;
  }
});

function renderClearConfirmation() {
  const existing = document.getElementById('clear-confirm');
  if (existing) existing.remove();
  if (!clearConfirm) return;
  const box = document.createElement('div');
  box.className = 'confirm';
  box.id = 'clear-confirm';
  const text = document.createElement('span');
  text.textContent = 'Remove all saved links?';
  const actions = document.createElement('span');
  actions.className = 'confirm-actions';
  actions.append(
    makeButton('Cancel', '', () => { clearConfirm = false; renderClearConfirmation(); clearButton.focus(); }),
    makeButton('Clear all', 'primary', async () => {
      try {
        const response = await send('CLEAR_HISTORY');
        if (!response || !response.ok) throw new Error(response && response.error || 'Could not clear your history.');
        clearConfirm = false;
        renderClearConfirmation();
        await loadState();
        setStatus('History cleared.');
      } catch (error) {
        setStatus(error.message || 'Could not clear your history.');
      }
    })
  );
  box.append(text, actions);
  clearButton.parentElement.after(box);
}

clearButton.addEventListener('click', () => {
  clearConfirm = !clearConfirm;
  renderClearConfirmation();
  if (clearConfirm) document.querySelector('#clear-confirm button')?.focus();
});

loadState().catch((error) => {
  stateUnavailable = true;
  clearButton.hidden = false;
  totalNode.textContent = '—';
  historyNode.replaceChildren();
  const message = document.createElement('div');
  message.className = 'empty';
  message.textContent = 'Your saved links are unavailable right now. Close and reopen this popup to try again.';
  historyNode.append(message);
  setStatus(error.message || 'Could not connect to Seen Before.');
});
