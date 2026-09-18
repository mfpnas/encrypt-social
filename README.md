# Encrypt Social

**End-to-end encryption for social media posts.**
A Firefox extension plus a web Hub that encrypt text before it is
published on Facebook, Instagram, TikTok, and X/Twitter. Only
recipients with the correct public key can decrypt.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Firefox](https://img.shields.io/badge/Firefox-109%2B-orange.svg)](https://www.mozilla.org/firefox/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/manifest.json)

---

## Table of contents

1. [What it does](#what-it-does)
2. [Architecture](#architecture)
3. [Quick install](#quick-install)
4. [Key generation — step by step](#key-generation--step-by-step)
5. [Key exchange with contacts](#key-exchange-with-contacts)
6. [Daily usage](#daily-usage)
7. [Two-user test on a single computer](#two-user-test-on-a-single-computer)
8. [Encrypted key backup](#encrypted-key-backup)
9. [Envelope format](#envelope-format)
10. [Size limits and thread fragmentation](#size-limits-and-thread-fragmentation)
11. [Security notes](#security-notes)
12. [Known limitations](#known-limitations)
13. [Contributing](#contributing)
14. [License](#license)

---

## What it does

- **Firefox extension** that detects the platform (Facebook, Instagram,
  TikTok, X/Twitter) and injects a toolbar with encrypt/decrypt actions.
- **Web Hub** to compose one message and open pre-filled posts across
  several platforms at once.
- **ECDH P-256** for key exchange, **AES-GCM 256-bit** for encryption.
- **Password-protected private key** (PBKDF2 100,000 iterations +
  AES-GCM). It never leaves your computer in plaintext.
- **Compact binary envelope** (`ES2:...`) that reduces overhead to
  ~58 characters for short messages — small enough to fit on X/Twitter.
- **Automatic thread fragmentation** when the envelope exceeds the
  platform limit.

---

## Architecture

```
┌────────────────┐   ECDH P-256   ┌────────────────┐
│  Aurion (A)    │ ─────────────▶ │  Cida (B)      │
│  priv_A        │                │  priv_B        │
│  pub_A         │ ◀───────────── │  pub_B         │
└────────┬───────┘                └────────┬───────┘
         │                                 │
         │  shared = ECDH(priv_A, pub_B)   │
         │  shared = ECDH(priv_B, pub_A)   │
         │        (same key)               │
         ▼                                 ▼
   AES-GCM(shared, msg)  ────────▶  AES-GCM⁻¹(shared, ct)
```

### Components

| File | Role |
|------|------|
| `crypto.js` | Primitives: ECDH, AES-GCM, v2 envelope, fragmentation |
| `content.js` | Toolbar injection, post field detection, encrypt/decrypt |
| `background.js` | Platform detection, key storage, contacts |
| `popup.html/js` | Toolbar popup, key generation |
| `options.html/js` | Settings, contacts, fingerprint, backup |
| `hub/` | Static cross-posting site |

---

## Quick install

### Prerequisites

- Firefox 109 or later (desktop)
- A pair of emails to identify two users in the trust network

### Load the extension

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**
3. Select `extension/manifest.json`.
4. Click the **puzzle** icon in the toolbar → **Encrypt Social** →
   ⚙ → **Pin to Toolbar**.

### Web Hub

Open `hub/index.html` in any modern browser.

---

## Key generation — step by step

### 1. Open Settings

Click the 🔐 **Encrypt Social** icon → **Open Settings**.

### 2. Set your identity

Under **Identity**, enter your registered email (e.g.
`aurionps@gmail.com`) and click **Save identity**.

This email is the human-readable label you will use in the trust
network and the contact ID others will use for you.

### 3. Generate the key pair

1. Click **Generate New Key Pair**.
2. Enter a password with **at least 8 characters** (12+ recommended).
3. The extension runs internally:

   ```js
   const keyPair = await crypto.subtle.generateKey(
     { name: 'ECDH', namedCurve: 'P-256' },
     true,
     ['deriveKey', 'deriveBits']
   );
   const pub = await CryptoModule.exportPublicKey(keyPair.publicKey);
   const wrapped = await CryptoModule.wrapPrivateKey(keyPair.privateKey, password);
   ```

4. Confirm that the following appear:
   - ✓ **Key pair active**
   - Public key in base64
   - SHA-256 fingerprint

> ⚠️ **The password is not stored.** If you forget it, the private
> key becomes useless and you will need to generate a new pair.

### 4. Note the fingerprint

The fingerprint is the SHA-256 of the public key, shown in groups of
4 characters:

```
a3f1 9b2c 88de 4f01 7c5a ...
```

Communicate the first 8–12 letters/digits to your contacts via a
**channel separate** from the one used to send the key (e.g. key by
email, fingerprint by Signal/phone).

### 5. Export the public key

Click **Export Public Key**. Firefox downloads
`encrypt-social-public-key.txt`.

Send the contents to whoever you want to decrypt your messages.

---

## Key exchange with contacts

The POC **does not include automatic key exchange**. Do it manually.

### Send your key

1. Share `encrypt-social-public-key.txt` over any channel you prefer.
2. Share the **fingerprint** over a **separate channel**.

### Receive someone's key

1. Receive the public key.
2. Receive the fingerprint on another channel.
3. Compare. **If they do not match, discard and redo.**

### Add the contact

1. **Settings → Trusted Contacts**.
2. **Contact name / ID**: the contact's registered email (e.g.
   `cidamelfaria@gmail.com`).
3. **Public key (base64)**: paste the key.
4. Click **Add Contact**.

Repeat for each contact.

---

## Daily usage

### Encrypt a message

1. Open X (or another supported network).
2. **Click Post** (the main sidebar button) to open the composer.
   **Do not click Reply on an existing tweet** — X may hide
   auto-replies from third parties.
3. Type the message.
4. In the toolbar:
   - **Recipient**: select the contact
   - **Password**: type it and click **Unlock**
5. Click **Encrypt selected text field**.
6. Post normally.

### Decrypt a message

1. Leave the `ES2:...` message visible on the page (tweet, DM, email).
2. Toolbar → **Password** → **Unlock**.
3. Click **Decrypt visible ES messages**.
4. The encrypted text is replaced with `🔓 <original text>`.

---

## Two-user test on a single computer

Use isolated **Firefox Profiles**.

### Create the second profile

1. `about:profiles` → **Create a New Profile**.
2. Name: `cidamelfaria`.
3. **Launch profile in new browser**.

### Full flow

| Step | Profile A (`aurionps@gmail.com`) | Profile B (`cidamelfaria@gmail.com`) |
|------|--------------------------------|-------------------------------------|
| 1 | Install extension, generate keys, save identity | — |
| 2 | — | Install extension, generate keys, save identity |
| 3 | Export `pub_A`, send to B + fingerprint | — |
| 4 | — | Export `pub_B`, send to A + fingerprint |
| 5 | Add B under **Contacts** | — |
| 6 | — | Add A under **Contacts** |
| 7 | Encrypt message, post on X | — |
| 8 | — | Decrypt message |
| 9 | — | Encrypt reply, post on X |
| 10 | Decrypt reply | — |

Detailed guide in
[`docs/TWO-USER-TEST-GUIDE.md`](docs/TWO-USER-TEST-GUIDE.md).

---

## Encrypted key backup

The extension **does not write to disk directly** due to Firefox
sandbox restrictions. The flow is:

1. **Export backup (JSON)** in the settings → saves
   `encrypt-social-backup-<email>.json`.
2. **Encrypt with GPG**:

   ```bash
   ./tools/export-keys.sh \
     ~/Downloads/encrypt-social-backup-aurionps@gmail.com.json \
     aurionps@gmail.com
   ```

   The script creates `~/secure-keys/encrypt-social-<email>-<date>.json.gpg`
   and shreds the plaintext JSON.

3. **Restore**:

   ```bash
   gpg -d ~/secure-keys/encrypt-social-aurionps_gmail.com-20260115.json.gpg > backup.json
   ```

   Then, in the extension settings console (F12):

   ```js
   const backup = JSON.parse(/* backup.json contents */);
   await browser.storage.local.set({
     identity: backup.identity,
     public_key: backup.public_key,
     wrapped_private_key: backup.wrapped_private_key,
     contacts: backup.contacts,
   });
   location.reload();
   ```

**Two layers of protection**: the private key is already encrypted by
your password (PBKDF2 + AES-GCM); the JSON is encrypted again by GPG.

---

## Envelope format

Binary structure (base64url-encoded in text):

| Offset | Field | Size | Description |
|--------|-------|------|-------------|
| 0 | version | 1 byte | `0x02` |
| 1 | flags | 1 byte | bit 0 = payload compressed with gzip |
| 2 | IV | 12 bytes | AES-GCM initialization vector |
| 14 | senderKeyId | 8 bytes | `SHA-256(pub_sender)[:8]` |
| 22 | ciphertext | variable | AES-GCM output (includes auth tag) |

Textual prefix: `ES2:`. Example:

```
ES2:AQIBvG9i3sH8kK...
```

Messages encrypted with the old format (`🔒ES:{json}:ES🔒`) are still
decryptable for backward compatibility.

---

## Size limits and thread fragmentation

| Platform | Limit | Approx. usable payload |
|----------|-------|------------------------|
| X/Twitter | 240 | ~180 characters |
| Facebook | 63,206 | ~47,000 characters |
| Instagram | 2,200 | ~1,600 characters |
| TikTok | 2,200 | ~1,600 characters |

For X, envelopes longer than **200 characters** are automatically
fragmented into a thread:

```
1/3 ES2:xxxxx
2/3 yyyyy
3/3 zzzzz
```

- The `ES2:` prefix appears **only on the first fragment**.
- Fragments 2 through N are plain base64url.
- When decrypting, the extension automatically reassembles
  `1/N`, `2/N`, ..., `N/N`.

**Important**: publish each fragment as a **reply to the previous one**,
forming a chained thread. Do not post each fragment as a standalone
tweet.

---

## Security notes

- **No external servers.** All crypto happens locally.
- **Private key** protected by PBKDF2 (100,000 iterations) + AES-GCM.
  The password is never stored.
- **Metadata is visible.** The platform still sees *that* you posted,
  *when*, and *to whom* — it just cannot read the content.
- **Manual key exchange.** Without it, there is no authenticity
  guarantee. Always confirm the fingerprint over a separate channel.
- **No forward secrecy.** The POC does not implement per-message
  ephemeral key rotation.

---

## Known limitations

- [ ] Has not undergone a cryptographic audit
- [ ] No automatic key exchange (key server / QR code)
- [ ] No forward secrecy (ratchet)
- [ ] Fragile DOM selectors — break when platforms change
- [ ] No Chromium support (Edge, Chrome, Brave)
- [ ] No media support (images, videos)
- [ ] No automatic decryption on page load
- [ ] Private key must be manually unlocked per session

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT — see [LICENSE](LICENSE).

---

## Disclaimer

This software is provided for educational and research purposes. The
authors are not responsible for any misuse or for any security
vulnerabilities in this proof-of-concept code. **Do not use it to
protect real secrets without a prior security audit.**