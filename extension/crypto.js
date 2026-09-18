// crypto.js — v2
// Compact binary envelope + ECDH/AES-GCM operations.
// All functions create and consume TypedArrays in the caller's own
// context to avoid the Firefox error "Permission denied to access
// property constructor" (Xray vision).

const CryptoModule = (() => {
  'use strict';

  const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' };
  const AES_PARAMS = { name: 'AES-GCM', length: 256 };
  const PBKDF2_ITERATIONS = 100000;
  const SALT_LENGTH = 16;
  const IV_LENGTH = 12;
  const KEY_ID_LENGTH = 8;
  const VERSION = 0x02;
  const FLAG_COMPRESSED = 0x01;
  const X_THREAD_MAX = 230;

  // ---------- Base64 ----------
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

  function bufferToBase64Url(buffer) {
    return bufferToBase64(buffer)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  function base64UrlToBuffer(str) {
    let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return base64ToBuffer(s);
  }

  // ---------- ECDH keys ----------
  async function generateKeyPair() {
    return crypto.subtle.generateKey(ECDH_PARAMS, true, ['deriveKey', 'deriveBits']);
  }

  async function exportPublicKey(publicKey) {
    const raw = await crypto.subtle.exportKey('raw', publicKey);
    return bufferToBase64(raw);
  }

  async function importPublicKey(base64Key) {
    const raw = base64ToBuffer(base64Key);
    return crypto.subtle.importKey('raw', raw, ECDH_PARAMS, true, []);
  }

  async function deriveSharedKey(privateKey, publicKey) {
    const sharedBits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: publicKey },
      privateKey,
      256
    );
    return crypto.subtle.importKey('raw', sharedBits, AES_PARAMS, false, ['encrypt', 'decrypt']);
  }

  // ---------- Key identifier ----------
  async function publicKeyIdBytes(publicKeyBase64) {
    const raw = base64ToBuffer(publicKeyBase64);
    const hash = await crypto.subtle.digest('SHA-256', raw);
    const full = new Uint8Array(hash);
    const out = new Uint8Array(KEY_ID_LENGTH);
    for (let i = 0; i < KEY_ID_LENGTH; i++) out[i] = full[i];
    return out;
  }

  async function publicKeyId(publicKeyBase64) {
    const bytes = await publicKeyIdBytes(publicKeyBase64);
    return bufferToBase64Url(bytes.buffer);
  }

  // ---------- gzip ----------
  async function gzipCompress(bytes) {
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const chunks = [];
    const reader = cs.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const copy = new Uint8Array(value.length);
      for (let i = 0; i < value.length; i++) copy[i] = value[i];
      chunks.push(copy);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { out.set(c, offset); offset += c.length; }
    return out;
  }

  async function gzipDecompress(bytes) {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const chunks = [];
    const reader = ds.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const copy = new Uint8Array(value.length);
      for (let i = 0; i < value.length; i++) copy[i] = value[i];
      chunks.push(copy);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { out.set(c, offset); offset += c.length; }
    return out;
  }

  // ---------- v2 envelope ----------
  async function buildEnvelopeV2(plaintext, sharedKey, senderPubBase64) {
    const encoder = new TextEncoder();
    let payload = encoder.encode(plaintext);
    let flags = 0;

    if (payload.length > 40) {
      try {
        const compressed = await gzipCompress(payload);
        if (compressed.length < payload.length - 10) {
          payload = compressed;
          flags |= FLAG_COMPRESSED;
        }
      } catch { /* no compression */ }
    }

    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, payload);
    const cipherRaw = new Uint8Array(cipherBuf);
    const ciphertext = new Uint8Array(cipherRaw.length);
    for (let i = 0; i < cipherRaw.length; i++) ciphertext[i] = cipherRaw[i];

    const keyId = await publicKeyIdBytes(senderPubBase64);

    const total = 1 + 1 + IV_LENGTH + KEY_ID_LENGTH + ciphertext.length;
    const out = new Uint8Array(total);
    let o = 0;
    out[o++] = VERSION;
    out[o++] = flags;
    for (let i = 0; i < IV_LENGTH; i++) out[o++] = iv[i];
    for (let i = 0; i < KEY_ID_LENGTH; i++) out[o++] = keyId[i];
    for (let i = 0; i < ciphertext.length; i++) out[o++] = ciphertext[i];
    return out;
  }

  function parseEnvelopeV2(bytes) {
    if (bytes[0] !== VERSION) throw new Error('Envelope v2: unknown version');
    const flags = bytes[1];
    const iv = new Uint8Array(IV_LENGTH);
    for (let i = 0; i < IV_LENGTH; i++) iv[i] = bytes[2 + i];
    const keyId = new Uint8Array(KEY_ID_LENGTH);
    for (let i = 0; i < KEY_ID_LENGTH; i++) keyId[i] = bytes[2 + IV_LENGTH + i];
    const ciphertext = new Uint8Array(bytes.length - (2 + IV_LENGTH + KEY_ID_LENGTH));
    for (let i = 0; i < ciphertext.length; i++) {
      ciphertext[i] = bytes[2 + IV_LENGTH + KEY_ID_LENGTH + i];
    }
    return { flags, iv, keyId, ciphertext };
  }

  async function decryptEnvelopeV2(bytes, sharedKey) {
    const { flags, iv, ciphertext } = parseEnvelopeV2(bytes);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sharedKey, ciphertext);
    let plaintextBytes = new Uint8Array(plainBuf);
    if (flags & FLAG_COMPRESSED) {
      plaintextBytes = await gzipDecompress(plaintextBytes);
    }
    return new TextDecoder().decode(plaintextBytes);
  }

  // ---------- Text formatting ----------
  const TAG_PREFIX = 'ES2:';

  function formatEnvelope(bytes) {
    return TAG_PREFIX + bufferToBase64Url(bytes.buffer);
  }

  function parseFormatted(text) {
    if (!text) return null;
    const v2 = String(text).match(/ES2:([A-Za-z0-9_-]+)/);
    if (v2) {
      return { version: 2, bytes: new Uint8Array(base64UrlToBuffer(v2[1])) };
    }
    const v1 = String(text).match(/🔒ES:(\{.+?\}):ES🔒/s);
    if (v1) {
      try { return { version: 1, json: JSON.parse(v1[1]) }; }
      catch { return null; }
    }
    return null;
  }

  // ---------- Fragmentation ----------
  function fragmentForThread(formattedEnvelope, maxChars = X_THREAD_MAX) {
    const maxPayload = maxChars - 8;
    const fragments = [];
    for (let i = 0; i < formattedEnvelope.length; i += maxPayload) {
      fragments.push(formattedEnvelope.slice(i, i + maxPayload));
    }
    const total = fragments.length;
    return fragments.map((f, i) => `${i + 1}/${total} ${f}`);
  }

  // ---------- User keys ----------
  async function deriveWrappingKey(password, salt) {
    const encoder = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['wrapKey', 'unwrapKey']
    );
  }

  async function wrapPrivateKey(privateKey, password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const wrappingKey = await deriveWrappingKey(password, salt);
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const wrapped = await crypto.subtle.wrapKey(
      'pkcs8',
      privateKey,
      wrappingKey,
      { name: 'AES-GCM', iv }
    );
    return {
      salt: bufferToBase64(salt.buffer),
      iv: bufferToBase64(iv.buffer),
      wrapped: bufferToBase64(wrapped),
    };
  }

  async function unwrapPrivateKey(wrappedData, password) {
    const salt = new Uint8Array(base64ToBuffer(wrappedData.salt));
    const iv = new Uint8Array(base64ToBuffer(wrappedData.iv));
    const wrapped = base64ToBuffer(wrappedData.wrapped);
    const wrappingKey = await deriveWrappingKey(password, salt);
    return crypto.subtle.unwrapKey(
      'pkcs8',
      wrapped,
      wrappingKey,
      { name: 'AES-GCM', iv },
      ECDH_PARAMS,
      true,
      ['deriveKey', 'deriveBits']
    );
  }

  // ---------- High-level ----------
  async function encryptForRecipient(plaintext, senderPrivateKey, senderPubBase64, recipientPubBase64) {
    const recipientPub = await importPublicKey(recipientPubBase64);
    const sharedKey = await deriveSharedKey(senderPrivateKey, recipientPub);
    const envelopeBytes = await buildEnvelopeV2(plaintext, sharedKey, senderPubBase64);
    return formatEnvelope(envelopeBytes);
  }

  async function decryptFromSender(formatted, recipientPrivateKey, senderPubBase64) {
    const parsed = parseFormatted(formatted);
    if (!parsed) throw new Error('No recognized envelope');

    if (parsed.version === 1) {
      const senderPub = await importPublicKey(parsed.json.senderPub);
      const sharedKey = await deriveSharedKey(recipientPrivateKey, senderPub);
      const iv = new Uint8Array(base64ToBuffer(parsed.json.iv));
      const ciphertext = base64ToBuffer(parsed.json.ciphertext);
      const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sharedKey, ciphertext);
      return new TextDecoder().decode(plainBuf);
    }

    const senderPub = await importPublicKey(senderPubBase64);
    const sharedKey = await deriveSharedKey(recipientPrivateKey, senderPub);
    return decryptEnvelopeV2(parsed.bytes, sharedKey);
  }

  return {
    generateKeyPair,
    exportPublicKey,
    importPublicKey,
    deriveSharedKey,
    publicKeyId,
    publicKeyIdBytes,
    buildEnvelopeV2,
    parseEnvelopeV2,
    decryptEnvelopeV2,
    formatEnvelope,
    parseFormatted,
    fragmentForThread,
    wrapPrivateKey,
    unwrapPrivateKey,
    encryptForRecipient,
    decryptFromSender,
    bufferToBase64Url,
    base64UrlToBuffer,
    bufferToBase64,
    base64ToBuffer,
  };
})();

if (typeof window !== 'undefined') {
  window.CryptoModule = CryptoModule;
}
if (typeof self !== 'undefined' && !self.CryptoModule) {
  self.CryptoModule = CryptoModule;
}