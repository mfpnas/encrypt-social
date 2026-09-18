// app.js — Hub logic

const messageEl = document.getElementById('message');
const encryptToggle = document.getElementById('encrypt-toggle');
const cryptoStatusEl = document.getElementById('crypto-status');
const payloadPreview = document.getElementById('payload-preview');
const postBtn = document.getElementById('btn-post');
const resultLog = document.getElementById('result-log');

const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' };
const AES_PARAMS = { name: 'AES-GCM', length: 256 };

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function generateKeyPair() {
  return crypto.subtle.generateKey(ECDH_PARAMS, true, ['deriveKey', 'deriveBits']);
}

async function exportPublicKey(publicKey) {
  const raw = await crypto.subtle.exportKey('raw', publicKey);
  return bufferToBase64(raw);
}

async function importPublicKey(base64Key) {
  return crypto.subtle.importKey('raw', base64ToBuffer(base64Key), ECDH_PARAMS, true, []);
}

async function deriveSharedKey(privateKey, publicKey) {
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256
  );
  return crypto.subtle.importKey('raw', sharedBits, AES_PARAMS, false, ['encrypt', 'decrypt']);
}

async function encryptMessage(plaintext, sharedKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    encoder.encode(plaintext)
  );
  return {
    iv: bufferToBase64(iv),
    ciphertext: bufferToBase64(ciphertext),
  };
}

function formatEncryptedMessage(payload) {
  return `🔒ES:${JSON.stringify(payload)}:ES🔒`;
}

const STORAGE_KEY = 'encrypt_social_hub_keypair';

async function getOrCreateKeyPair() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        base64ToBuffer(parsed.privateKey),
        ECDH_PARAMS,
        true,
        ['deriveKey', 'deriveBits']
      );
      const publicKey = await importPublicKey(parsed.publicKey);
      return { privateKey, publicKey, publicKeyBase64: parsed.publicKey };
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  const keyPair = await generateKeyPair();
  const publicKeyBase64 = await exportPublicKey(keyPair.publicKey);
  const privateKeyRaw = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  const privateKeyBase64 = bufferToBase64(privateKeyRaw);

  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    publicKey: publicKeyBase64,
    privateKey: privateKeyBase64,
    createdAt: Date.now(),
  }));

  return { privateKey: keyPair.privateKey, publicKey: keyPair.publicKey, publicKeyBase64 };
}

const PLATFORM_URLS = {
  facebook: 'https://www.facebook.com/',
  instagram: 'https://www.instagram.com/',
  tiktok: 'https://www.tiktok.com/upload',
  twitter: 'https://x.com/compose/post',
};

function updateCryptoStatus(hasKeys) {
  if (hasKeys) {
    cryptoStatusEl.textContent = '✓ Keys ready';
    cryptoStatusEl.className = 'crypto-status ok';
  } else {
    cryptoStatusEl.textContent = '⚠ No keys — will generate on first use';
    cryptoStatusEl.className = 'crypto-status warn';
  }
}

async function updatePreview() {
  const text = messageEl.value.trim();
  if (!text || !encryptToggle.checked) {
    payloadPreview.textContent = text || '—';
    return;
  }
  try {
    const keyPair = await getOrCreateKeyPair();
    const sharedKey = await deriveSharedKey(keyPair.privateKey, keyPair.publicKey);
    const encrypted = await encryptMessage(text, sharedKey);
    const ephemeral = await generateKeyPair();
    const ephemeralPub = await exportPublicKey(ephemeral.publicKey);
    const envelope = {
      ...encrypted,
      senderPub: ephemeralPub,
      recipientPub: keyPair.publicKeyBase64,
    };
    payloadPreview.textContent = formatEncryptedMessage(envelope);
  } catch (err) {
    payloadPreview.textContent = 'Encryption error: ' + err.message;
  }
}

let previewTimeout;
messageEl.addEventListener('input', () => {
  clearTimeout(previewTimeout);
  previewTimeout = setTimeout(updatePreview, 300);
});

encryptToggle.addEventListener('change', updatePreview);

postBtn.addEventListener('click', async () => {
  const text = messageEl.value.trim();
  if (!text) { alert('Write a message.'); return; }

  const selected = Array.from(
    document.querySelectorAll('.platforms input[type="checkbox"]:checked')
  ).map((cb) => cb.value);

  if (selected.length === 0) { alert('Select at least one platform.'); return; }

  let payload = text;
  if (encryptToggle.checked) {
    try {
      const keyPair = await getOrCreateKeyPair();
      const sharedKey = await deriveSharedKey(keyPair.privateKey, keyPair.publicKey);
      const encrypted = await encryptMessage(text, sharedKey);
      const ephemeral = await generateKeyPair();
      const ephemeralPub = await exportPublicKey(ephemeral.publicKey);
      payload = formatEncryptedMessage({
        ...encrypted,
        senderPub: ephemeralPub,
        recipientPub: keyPair.publicKeyBase64,
      });
    } catch (err) {
      resultLog.innerHTML = `<div class="error">Error: ${err.message}</div>`;
      return;
    }
  }

  try { await navigator.clipboard.writeText(payload); } catch {}

  resultLog.innerHTML = '';
  selected.forEach((platform) => {
    const url = PLATFORM_URLS[platform];
    if (!url) return;
    const win = window.open(url, `_post_${platform}`, 'width=600,height=700');
    if (win) {
      resultLog.innerHTML += `<div class="success">✓ ${platform} opened — paste the payload from the clipboard.</div>`;
    } else {
      resultLog.innerHTML += `<div class="error">✗ Popup blocked for ${platform}.</div>`;
    }
  });

  resultLog.innerHTML += `<div style="margin-top:8px;color:#8b949e;font-size:12px;">
    💡 The encrypted envelope is in the clipboard. Paste it into each platform.
  </div>`;
});

(async () => {
  const keyPair = await getOrCreateKeyPair();
  updateCryptoStatus(true);
  await updatePreview();
})();