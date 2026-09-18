// options.js

const keyStatusEl = document.getElementById('key-status');
const publicKeyDisplay = document.getElementById('public-key-display');
const fingerprintDisplay = document.getElementById('fingerprint-display');
const contactsListEl = document.getElementById('contacts-list');

async function computeFingerprint(publicKeyBase64) {
  const raw = CryptoModule.base64ToBuffer(publicKeyBase64);
  const hash = await crypto.subtle.digest('SHA-256', raw);
  const hex = [...new Uint8Array(hash)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.match(/.{1,4}/g).join(' ');
}

async function refreshKeyStatus() {
  const result = await browser.storage.local.get(['public_key', 'wrapped_private_key']);
  if (result.public_key) {
    keyStatusEl.innerHTML = '<span style="color:#4ecca3;">✓ Key pair active</span>';
    publicKeyDisplay.style.display = 'block';
    publicKeyDisplay.textContent = result.public_key;

    const fp = await computeFingerprint(result.public_key);
    fingerprintDisplay.style.display = 'block';
    fingerprintDisplay.textContent = 'Fingerprint (SHA-256): ' + fp;
  } else {
    keyStatusEl.innerHTML = '<span style="color:#ffa500;">⚠ No key pair</span>';
    publicKeyDisplay.style.display = 'none';
    fingerprintDisplay.style.display = 'none';
  }
}

async function loadIdentity() {
  const r = await browser.storage.local.get('identity');
  if (r.identity) document.getElementById('identity').value = r.identity;
}

document.getElementById('btn-save-identity').addEventListener('click', async () => {
  const id = document.getElementById('identity').value.trim();
  if (!id) { alert('Enter an email.'); return; }
  await browser.storage.local.set({ identity: id });
  alert('Identity saved.');
});

document.getElementById('btn-generate').addEventListener('click', async () => {
  const password = prompt(
    'Choose a strong password (at least 8 characters).\n' +
    'You will need it to decrypt. There is no recovery.'
  );
  if (!password || password.length < 8) {
    alert('Password too short.');
    return;
  }

  try {
    const keyPair = await CryptoModule.generateKeyPair();
    const publicKeyBase64 = await CryptoModule.exportPublicKey(keyPair.publicKey);
    const wrapped = await CryptoModule.wrapPrivateKey(keyPair.privateKey, password);

    await browser.runtime.sendMessage({
      type: 'STORE_KEYS',
      publicKey: publicKeyBase64,
      wrappedPrivateKey: wrapped,
    });

    await refreshKeyStatus();
    alert('Key pair generated and stored.');
  } catch (err) {
    console.error('Error generating keys', err);
    alert('Error: ' + err.message);
  }
});

document.getElementById('btn-export').addEventListener('click', async () => {
  const result = await browser.storage.local.get('public_key');
  if (!result.public_key) { alert('No public key.'); return; }

  const blob = new Blob([result.public_key], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'encrypt-social-public-key.txt';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('btn-export-backup').addEventListener('click', async () => {
  const r = await browser.storage.local.get([
    'identity', 'public_key', 'wrapped_private_key', 'contacts'
  ]);
  if (!r.public_key) { alert('Nothing to export.'); return; }

  const payload = {
    identity: r.identity || null,
    algorithm: 'ECDH-P256 + AES-GCM-256',
    public_key: r.public_key,
    wrapped_private_key: r.wrapped_private_key,
    contacts: r.contacts || {},
    exported_at: new Date().toISOString(),
    warning: 'This file contains your ENCRYPTED PRIVATE KEY. Store it safely.',
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `encrypt-social-backup-${r.identity || 'user'}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function refreshContacts() {
  const r = await browser.runtime.sendMessage({ type: 'LIST_CONTACTS' });
  const contacts = r?.contacts || {};
  const entries = Object.entries(contacts);

  if (entries.length === 0) {
    contactsListEl.innerHTML = '<p class="small">No contacts yet.</p>';
    return;
  }

  contactsListEl.innerHTML = entries.map(([id, data]) => `
    <div class="contact-item">
      <span>${escapeHtml(id)}</span>
      <span style="color:#888;font-size:11px;">${data.publicKey.slice(0, 16)}…</span>
      <button data-remove="${escapeHtml(id)}" style="padding:4px 8px;font-size:11px;background:#7a1a2e;">Remove</button>
    </div>
  `).join('');

  contactsListEl.querySelectorAll('button[data-remove]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-remove');
      await browser.runtime.sendMessage({ type: 'REMOVE_CONTACT', contactId: id });
      refreshContacts();
    });
  });
}

document.getElementById('btn-add-contact').addEventListener('click', async () => {
  const id = document.getElementById('contact-id').value.trim();
  const key = document.getElementById('contact-key').value.trim();
  if (!id || !key) { alert('Fill in email and public key.'); return; }

  try {
    await CryptoModule.importPublicKey(key);
  } catch {
    alert('Invalid public key.');
    return;
  }

  await browser.runtime.sendMessage({
    type: 'STORE_CONTACT',
    contactId: id,
    publicKey: key,
  });

  document.getElementById('contact-id').value = '';
  document.getElementById('contact-key').value = '';
  refreshContacts();
});

document.getElementById('btn-clear').addEventListener('click', async () => {
  if (!confirm('Permanently delete ALL keys and contacts?')) return;
  await browser.storage.local.clear();
  await refreshKeyStatus();
  await refreshContacts();
  alert('Everything cleared.');
});

loadIdentity();
refreshKeyStatus();
refreshContacts();