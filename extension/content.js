// content.js — v5
// Cross-user encryption with inline UI (no prompt/confirm/alert).
// All TypedArray manipulation uses defensive copies.

(async () => {
  'use strict';

  const PLATFORM_SELECTORS = {
    facebook: {
      textFields: [
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"][data-lexical-editor="true"]',
        'textarea[data-testid="status-attachment-mentions-input"]',
      ],
    },
    instagram: {
      textFields: [
        'textarea[aria-label="Write a caption..."]',
        'textarea[placeholder="Write a caption..."]',
        'div[contenteditable="true"][role="textbox"]',
      ],
    },
    tiktok: {
      textFields: [
        'div[contenteditable="true"][data-e2e="caption-input"]',
        'textarea[placeholder*="caption"]',
        'div[contenteditable="true"][role="textbox"]',
      ],
    },
    twitter: {
      textFields: [
        'div[contenteditable="true"][data-testid="tweetTextarea_0"]',
        'div[contenteditable="true"][role="textbox"]',
      ],
    },
  };

  const PLATFORM_LIMITS = {
    twitter: 240,
    facebook: 63206,
    instagram: 2200,
    tiktok: 2200,
  };

  const THREAD_SAFE_LIMIT = 200;

  let currentPlatform = null;
  let cachedPublicKey = null;
  let cachedPrivateKey = null;

  // ---------- Helpers ----------
  function safeString(v) {
    if (v === null || v === undefined) return '';
    try { return String(v); } catch { return ''; }
  }

  function isFocused(el) {
    try {
      const active = document.activeElement;
      if (!active) return false;
      if (active === el) return true;
      try { return active.wrappedJSObject === el.wrappedJSObject; }
      catch { return false; }
    } catch { return false; }
  }

  function containsActive(el) {
    try {
      const active = document.activeElement;
      if (!active) return false;
      try { return el.contains(active); } catch { return false; }
    } catch { return false; }
  }

  function isVisible(el) {
    try { return !!el && el.offsetParent !== null; } catch { return false; }
  }

  // ---------- Toolbar ----------
  function injectToolbar() {
    try {
      if (document.getElementById('encrypt-social-toolbar')) return;
      if (!document.body) return;

      const toolbar = document.createElement('div');
      toolbar.id = 'encrypt-social-toolbar';
      toolbar.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
        background: #1a1a2e; color: #e0e0e0; padding: 12px;
        border-radius: 12px; font-family: system-ui, sans-serif;
        font-size: 13px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        display: flex; flex-direction: column; gap: 8px;
        width: 300px; border: 1px solid #0f3460;
      `;

      const header = document.createElement('div');
      header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:12px;';
      const title = document.createElement('strong');
      title.textContent = '🔐 Encrypt Social';
      title.style.color = '#4ecca3';
      const badge = document.createElement('span');
      badge.id = 'es-platform-badge';
      badge.textContent = '—';
      badge.style.cssText = `
        background:#16213e; padding:2px 8px; border-radius:6px;
        font-size:11px; text-transform:uppercase; color:#8b949e;
      `;
      header.appendChild(title);
      header.appendChild(badge);

      const recipientRow = document.createElement('div');
      recipientRow.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
      const recipientLabel = document.createElement('label');
      recipientLabel.textContent = 'Recipient:';
      recipientLabel.style.cssText = 'font-size:11px; color:#8b949e;';
      const recipientSelect = document.createElement('select');
      recipientSelect.id = 'es-recipient';
      recipientSelect.style.cssText = `
        padding:6px 8px; border-radius:6px; border:1px solid #0f3460;
        background:#0d1117; color:#e0e0e0; font-size:12px;
      `;
      recipientSelect.innerHTML = '<option value="">— select —</option>';
      recipientRow.appendChild(recipientLabel);
      recipientRow.appendChild(recipientSelect);

      const passwordRow = document.createElement('div');
      passwordRow.style.cssText = 'display:flex; gap:6px; align-items:center;';
      const passwordInput = document.createElement('input');
      passwordInput.id = 'es-password';
      passwordInput.type = 'password';
      passwordInput.placeholder = 'Private key password';
      passwordInput.style.cssText = `
        flex:1; padding:6px 8px; border-radius:6px; border:1px solid #0f3460;
        background:#0d1117; color:#e0e0e0; font-size:12px; font-family:inherit;
      `;
      const unlockBtn = document.createElement('button');
      unlockBtn.id = 'es-unlock-btn';
      unlockBtn.textContent = 'Unlock';
      unlockBtn.style.cssText = `
        background:#238636; color:#fff; border:none; padding:6px 10px;
        border-radius:6px; cursor:pointer; font-size:11px; font-weight:600;
      `;
      passwordRow.appendChild(passwordInput);
      passwordRow.appendChild(unlockBtn);

      const encryptBtn = document.createElement('button');
      encryptBtn.id = 'es-encrypt-btn';
      encryptBtn.textContent = 'Encrypt selected text field';
      encryptBtn.style.cssText = `
        background:#0f3460; color:#fff; border:none; padding:8px 12px;
        border-radius:8px; cursor:pointer; font-size:12px; font-weight:600;
      `;

      const decryptBtn = document.createElement('button');
      decryptBtn.id = 'es-decrypt-btn';
      decryptBtn.textContent = 'Decrypt visible ES messages';
      decryptBtn.style.cssText = `
        background:#16213e; color:#e0e0e0; border:1px solid #0f3460;
        padding:8px 12px; border-radius:8px; cursor:pointer; font-size:12px;
      `;

      const status = document.createElement('div');
      status.id = 'es-status';
      status.textContent = '';
      status.style.cssText = 'font-size:11px; color:#8b949e; min-height:16px;';

      toolbar.appendChild(header);
      toolbar.appendChild(recipientRow);
      toolbar.appendChild(passwordRow);
      toolbar.appendChild(encryptBtn);
      toolbar.appendChild(decryptBtn);
      toolbar.appendChild(status);
      document.body.appendChild(toolbar);

      unlockBtn.addEventListener('click', handleUnlock);
      passwordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); handleUnlock(); }
      });
      encryptBtn.addEventListener('click', handleEncrypt);
      decryptBtn.addEventListener('click', handleDecrypt);

      refreshRecipients();

      console.log('[EncryptSocial] toolbar injected');
    } catch (err) {
      console.error('[EncryptSocial] injectToolbar error', err);
    }
  }

  function setStatus(msg, isError = false) {
    try {
      const el = document.getElementById('es-status');
      if (el) {
        el.textContent = safeString(msg);
        el.style.color = isError ? '#ff6b6b' : '#4ecca3';
      }
    } catch { /* ignore */ }
  }

  function setPlatformBadge(platform) {
    try {
      const badge = document.getElementById('es-platform-badge');
      if (badge) badge.textContent = safeString(platform) || '—';
    } catch { /* ignore */ }
  }

  function getPasswordInput() {
    return document.getElementById('es-password');
  }

  function getRecipientSelect() {
    return document.getElementById('es-recipient');
  }

  function clearPasswordInput() {
    const i = getPasswordInput();
    if (i) i.value = '';
  }

  async function refreshRecipients() {
    try {
      const r = await browser.runtime.sendMessage({ type: 'LIST_CONTACTS' });
      const contacts = r?.contacts || {};
      const select = getRecipientSelect();
      if (!select) return;
      const current = select.value;
      select.innerHTML = '<option value="">— select —</option>';
      for (const id of Object.keys(contacts).sort()) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id;
        select.appendChild(opt);
      }
      if (current && contacts[current]) select.value = current;
    } catch (err) {
      console.warn('[EncryptSocial] refreshRecipients error', err);
    }
  }

  // ---------- Unlock ----------
  async function handleUnlock() {
    const input = getPasswordInput();
    if (!input) return;
    const password = safeString(input.value);
    if (!password) {
      setStatus('Type the password first.', true);
      return;
    }
    setStatus('Unlocking…');
    try {
      const stored = await browser.storage.local.get('wrapped_private_key');
      if (!stored.wrapped_private_key) {
        setStatus('No private key found.', true);
        return;
      }
      cachedPrivateKey = await CryptoModule.unwrapPrivateKey(stored.wrapped_private_key, password);
      clearPasswordInput();
      setStatus('Key unlocked ✓');
    } catch (err) {
      console.error('[EncryptSocial] unlock error', err);
      cachedPrivateKey = null;
      setStatus('Wrong password.', true);
    }
  }

  async function ensurePrivateKeyUnlocked() {
    if (cachedPrivateKey) return cachedPrivateKey;
    setStatus('Type the password and click Unlock.', true);
    const input = getPasswordInput();
    if (input) input.focus();
    return null;
  }

  // ---------- Fields ----------
  function findActiveTextField() {
    try {
      if (!currentPlatform) {
        return document.querySelector('div[contenteditable="true"][role="textbox"]') || null;
      }
      const selectors = PLATFORM_SELECTORS[currentPlatform]?.textFields || [];
      for (const selector of selectors) {
        let elements;
        try { elements = document.querySelectorAll(selector); } catch { continue; }
        for (const el of elements) {
          if (isFocused(el) || containsActive(el)) return el;
        }
      }
      for (const selector of selectors) {
        let elements;
        try { elements = document.querySelectorAll(selector); } catch { continue; }
        for (const el of elements) {
          if (isVisible(el)) return el;
        }
      }
      return null;
    } catch (err) {
      console.error('[EncryptSocial] findActiveTextField error', err);
      return null;
    }
  }

  function getTextFromField(el) {
    try {
      if (!el) return '';
      const tag = el.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return safeString(el.value);
      return safeString(el.innerText || el.textContent);
    } catch { return ''; }
  }

  function setTextInField(el, text) {
    if (!el) return false;
    const value = safeString(text);
    try {
      const tag = el.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') {
        try { el.focus(); } catch {}
        try { el.value = value; }
        catch {
          try {
            Object.defineProperty(el, 'value', {
              value, configurable: true, writable: true,
            });
          } catch (e2) {
            console.error('[EncryptSocial] defineProperty failed', e2);
            return false;
          }
        }
        dispatchInputEvents(el);
        return true;
      }

      try { el.focus(); } catch {}
      try {
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } catch {}

      let inserted = false;
      try { inserted = document.execCommand('insertText', false, value); } catch {}
      if (!inserted) {
        try { el.textContent = value; } catch (e) {
          console.error('[EncryptSocial] contenteditable set failed', e);
          return false;
        }
      }
      dispatchInputEvents(el);
      return true;
    } catch (err) {
      console.error('[EncryptSocial] setTextInField error', err);
      return false;
    }
  }

  function dispatchInputEvents(el) {
    try { el.dispatchEvent(new Event('input', { bubbles: true, composed: true })); } catch {}
    try { el.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } catch {}
  }

  // ---------- Keys ----------
  async function ensurePublicKeyLoaded() {
    if (cachedPublicKey) return cachedPublicKey;
    try {
      const stored = await browser.storage.local.get('public_key');
      if (!stored.public_key) {
        setStatus('No keys. Open options to generate.', true);
        return null;
      }
      cachedPublicKey = stored.public_key;
      return cachedPublicKey;
    } catch {
      setStatus('Storage error.', true);
      return null;
    }
  }

  // ---------- Encrypt ----------
  async function handleEncrypt() {
    try {
      const field = findActiveTextField();
      if (!field) {
        setStatus('No text field. Click into a post box first.', true);
        return;
      }

      const plaintext = getTextFromField(field).trim();
      if (!plaintext) {
        setStatus('Field is empty.', true);
        return;
      }

      if (CryptoModule.parseFormatted(plaintext)) {
        setStatus('Field already contains an encrypted message.', true);
        return;
      }

      const select = getRecipientSelect();
      const recipientId = safeString(select?.value);
      if (!recipientId) {
        setStatus('Select a recipient.', true);
        return;
      }

      const pubKey = await ensurePublicKeyLoaded();
      if (!pubKey) return;

      const privateKey = await ensurePrivateKeyUnlocked();
      if (!privateKey) return;

      const r = await browser.runtime.sendMessage({
        type: 'GET_CONTACT',
        contactId: recipientId,
      });
      const recipientPubKey = r?.contact?.publicKey;
      if (!recipientPubKey) {
        setStatus(`Public key of ${recipientId} not found.`, true);
        return;
      }

      setStatus('Encrypting…');

      const formatted = await CryptoModule.encryptForRecipient(
        plaintext,
        privateKey,
        pubKey,
        recipientPubKey
      );

      const limit = PLATFORM_LIMITS[currentPlatform] || Infinity;

      if (formatted.length <= THREAD_SAFE_LIMIT && formatted.length <= limit) {
        const ok = setTextInField(field, formatted);
        setStatus(ok
          ? `Encrypted ✓ (${formatted.length}/${limit} chars)`
          : 'Failed to write to field.',
          !ok
        );
        return;
      }

      const safeLimit = currentPlatform === 'twitter' ? 230 : limit - 10;
      const fragments = CryptoModule.fragmentForThread(formatted, safeLimit);

      setStatus(
        `Payload of ${formatted.length} chars — splitting into ${fragments.length} posts…`
      );

      const ok = setTextInField(field, fragments[0]);
      if (!ok) {
        setStatus('Failed to insert first fragment.', true);
        return;
      }

      try {
        await navigator.clipboard.writeText(fragments.slice(1).join('\n---\n'));
        setStatus(
          `Fragment 1/${fragments.length} inserted. ` +
          `The remaining ${fragments.length - 1} are in the clipboard. ` +
          `Publish this one, then paste each following fragment as a reply to the previous.`
        );
      } catch {
        setStatus(
          `Fragment 1/${fragments.length} inserted (clipboard failed). ` +
          `Copy the rest manually.`,
          true
        );
      }
    } catch (err) {
      console.error('[EncryptSocial] encrypt error', err);
      setStatus('Encrypt error: ' + safeString(err?.message || err), true);
    }
  }

  // ---------- Decrypt ----------
  async function handleDecrypt() {
    try {
      const pubKey = await ensurePublicKeyLoaded();
      if (!pubKey) return;

      const privateKey = await ensurePrivateKeyUnlocked();
      if (!privateKey) return;

      let bodyText = '';
      try {
        bodyText = safeString(document.body?.innerText || document.body?.textContent);
      } catch {}

      // Step 1: fragmented threads
      const threadFragments = {};
      const threadRegex = /(\d+)\/(\d+)\s+(ES2:[A-Za-z0-9_-]+)/g;
      let match;
      while ((match = threadRegex.exec(bodyText)) !== null) {
        const idx = parseInt(match[1], 10);
        const total = parseInt(match[2], 10);
        const fragment = match[3];
        if (!threadFragments[total]) threadFragments[total] = {};
        threadFragments[total][idx] = fragment;
      }

      const fullEnvelopes = [];
      for (const total of Object.keys(threadFragments)) {
        const parts = threadFragments[total];
        const ordered = [];
        let complete = true;
        for (let i = 1; i <= parseInt(total, 10); i++) {
          if (!parts[i]) { complete = false; break; }
          ordered.push(parts[i]);
        }
        if (complete) {
          const first = ordered[0];
          const rest = ordered.slice(1).map(s => s.replace(/^ES2:/, ''));
          fullEnvelopes.push(first + rest.join(''));
        }
      }

      // Step 2: standalone envelopes
      const singleMatches = [...bodyText.matchAll(/ES2:[A-Za-z0-9_-]+/g)]
        .map(m => m[0])
        .filter(e => !fullEnvelopes.some(f => f.includes(e.replace('ES2:', ''))));

      const all = [...fullEnvelopes, ...singleMatches];

      if (all.length === 0) {
        setStatus('No ES message found on the page.', true);
        return;
      }

      const contactsResp = await browser.runtime.sendMessage({ type: 'LIST_CONTACTS' });
      const contacts = contactsResp?.contacts || {};
      const candidatePubKeys = [pubKey, ...Object.values(contacts).map(c => c.publicKey)];

      let count = 0;
      let lastErr = null;
      for (const needle of all) {
        let decrypted = false;
        for (const candidate of candidatePubKeys) {
          try {
            const plain = await CryptoModule.decryptFromSender(needle, privateKey, candidate);
            replaceTextInPage(needle, `🔓 ${plain}`);
            console.log('[EncryptSocial] decrypted:', plain);
            count++;
            decrypted = true;
            break;
          } catch (e) {
            lastErr = e;
          }
        }
        if (!decrypted) {
          console.warn('[EncryptSocial] failed to decrypt envelope', lastErr);
        }
      }

      setStatus(`Decrypted ${count}/${all.length} message(s).`);
    } catch (err) {
      console.error('[EncryptSocial] decrypt error', err);
      setStatus('Decrypt error: ' + safeString(err?.message || err), true);
    }
  }

  function replaceTextInPage(needle, replacement) {
    try {
      const needleStr = safeString(needle);
      const replStr = safeString(replacement);
      if (!needleStr) return;

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      const nodes = [];
      let n;
      while ((n = walker.nextNode())) nodes.push(n);

      for (const node of nodes) {
        let text;
        try { text = safeString(node.nodeValue); } catch { continue; }
        if (text && text.indexOf(needleStr) !== -1) {
          try { node.nodeValue = text.split(needleStr).join(replStr); } catch {}
        }
      }
    } catch (err) {
      console.warn('[EncryptSocial] replaceTextInPage error', err);
    }
  }

  // ---------- Detection ----------
  browser.runtime.onMessage.addListener((message) => {
    try {
      if (message?.type === 'PLATFORM_DETECTED') {
        currentPlatform = message.platform;
        setPlatformBadge(message.platform);
        setStatus(`Connected to ${message.platform}`);
      }
    } catch {}
  });

  try {
    const response = await browser.runtime.sendMessage({ type: 'DETECT_PLATFORM' });
    if (response?.platform) {
      currentPlatform = response.platform;
      setPlatformBadge(response.platform);
      setStatus(`Connected to ${response.platform}`);
    } else {
      setStatus('Platform not recognized.');
    }
  } catch {}

  injectToolbar();

  const observer = new MutationObserver(() => {
    try {
      if (!document.getElementById('encrypt-social-toolbar')) {
        injectToolbar();
        if (currentPlatform) setPlatformBadge(currentPlatform);
      }
    } catch {}
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  console.log('[EncryptSocial] content script v5 loaded. Platform:', currentPlatform);
})();