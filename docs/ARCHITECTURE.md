# Architecture

This document describes the internal design of Encrypt Social: how the
Firefox extension and the Hub are organized, how messages flow between
users, and the constraints imposed by the browser environment.

---

## Table of contents

1. [Component overview](#component-overview)
2. [Extension architecture](#extension-architecture)
3. [Encryption flow](#encryption-flow)
4. [Decryption flow](#decryption-flow)
5. [Envelope format](#envelope-format)
6. [Fragmentation for long messages](#fragmentation-for-long-messages)
7. [Storage layout](#storage-layout)
8. [Xray isolation (Firefox)](#xray-isolation-firefox)
9. [Threat model](#threat-model)

---

## Component overview

Encrypt Social is composed of three independent pieces:

```
+---------------------------------------------------------------+
|  Firefox (desktop 109+)                                       |
|                                                               |
|   +----------------+     +------------------+                 |
|   |  content.js    |<--->|  background.js   |                 |
|   |  (per tab)     |     |  (global)        |                 |
|   +--------+-------+     +---------+--------+                 |
|            |                       |                          |
|            |  crypto.js            |  crypto.js               |
|            |  (isolated)           |  (isolated)              |
|            v                       v                          |
|      Page DOM              browser.storage.local              |
+---------------------------------------------------------------+

+---------------------------------------------------------------+
|  Static web Hub (hub/)                                        |
|    - runs in any browser, no extension required               |
|    - generates a local key pair in localStorage               |
|    - opens platform compose windows with the payload copied   |
+---------------------------------------------------------------+
```

| Component        | Runs in               | Responsibility                              |
|------------------|-----------------------|---------------------------------------------|
| `content.js`     | Each supported tab    | DOM injection, encrypt/decrypt actions      |
| `background.js`  | Extension background  | Platform detection, key/contact storage     |
| `crypto.js`      | Both contexts         | ECDH, AES-GCM, envelope pack/unpack         |
| `popup.html/js`  | Extension popup       | Key generation, settings shortcut           |
| `options.html/js`| Extension tab         | Identity, contacts, fingerprint, backup     |
| `hub/`           | Any browser           | Cross-posting, standalone key pair          |

---

## Extension architecture

```
                   +-------------------------+
                   |   Social media page     |
                   |   (X, FB, IG, TikTok)   |
                   +------------+------------+
                                |
                                | content_scripts
                                v
+--------------------------------------------------------------+
|  content.js                                                  |
|                                                              |
|  - detects the platform via background query                |
|  - injects the toolbar (bottom-right corner)                |
|  - reads/writes the post text field                         |
|  - calls crypto primitives for encrypt/decrypt              |
+---------------------+----------------------------------------+
                      |  browser.runtime.sendMessage
                      v
+--------------------------------------------------------------+
|  background.js                                               |
|                                                              |
|  - detects platform from tab URL                            |
|  - stores public key, wrapped private key, contacts         |
|  - exposes message API: DETECT_PLATFORM, STORE_KEYS, ...    |
+---------------------+----------------------------------------+
                      |  browser.storage.local
                      v
+--------------------------------------------------------------+
|  Persistent storage                                          |
|                                                              |
|  identity             user's registered email                |
|  public_key           base64 public key                      |
|  wrapped_private_key  { salt, iv, wrapped } — AES-GCM        |
|  contacts             { email: { publicKey, addedAt } }      |
+--------------------------------------------------------------+
```

Key design choices:

- **The content script never persists anything by itself.** All state
  lives in `browser.storage.local`, accessed through the background.
- **The private key is unlocked in memory only.** Once the user types
  their password in the toolbar and clicks **Unlock**, the resulting
  `CryptoKey` object lives in `cachedPrivateKey` (per tab) until the
  tab is closed or reloaded.
- **The content script avoids native dialogs.** `prompt()`, `confirm()`,
  and `alert()` are never called from `content.js` — they return
  page-owned objects that break under Xray (see
  [Xray isolation](#xray-isolation-firefox)).

---

## Encryption flow

```
User A                                              User B
------                                              ------

1. Types plaintext in post field
   |
   v
2. content.js reads the text
   |
   v
3. User A enters password, clicks Unlock
   |
   v
4. cachedPrivateKey = unwrap(wrapped, password)
   |
   v
5. content.js asks background for recipient public key
   |
   v
6. sharedKey = ECDH(privA, pubB)
   |
   v
7. envelope = AES-GCM(sharedKey, plaintext)
   |
   v
8. text = "ES2:" + base64url(envelope)
   |
   v
9. If text fits in platform limit:
       write to field
   Else:
       fragment into "1/N ...", "2/N ...", ...
   |
   v
10. User A posts normally
```

Step-by-step:

1. **Compose.** User A opens the platform composer (e.g. X → **Post**,
   not **Reply** — see [Threat model](#threat-model)).
2. **Read.** `content.js` reads the current field content.
3. **Unlock.** The password typed into the toolbar input is used to
   `unwrapKey` the stored PKCS#8 private key.
4. **Resolve recipient.** The selected contact's public key is fetched
   from `browser.storage.local`.
5. **Derive.** `shared = ECDH(privA, pubB)` produces a 256-bit shared
   secret, imported as an AES-GCM key.
6. **Encrypt.** Plaintext is compressed (optional gzip) and encrypted
   with AES-GCM using a random 12-byte IV.
7. **Package.** The output is a binary envelope, base64url-encoded and
   prefixed with `ES2:`.
8. **Fit or fragment.** If the envelope is under the safe limit
   (`THREAD_SAFE_LIMIT`, 200 chars), it is written to the field.
   Otherwise, it is split into a numbered thread.
9. **Publish.** The user posts normally.

---

## Decryption flow

```
User B
------

1. Opens the page containing "ES2:..."
   |
   v
2. content.js scans document.body.innerText
   |
   v
3. Splits into:
       - fragmented threads   (matches "n/N ES2:...")
       - standalone envelopes (matches "ES2:...")
   |
   v
4. Reassembles complete threads from their fragments
   |
   v
5. User B enters password, clicks Unlock
   |
   v
6. cachedPrivateKey = unwrap(wrapped, password)
   |
   v
7. For each envelope, tries candidates in order:
       a) user's own public key
       b) each contact's public key
   |
   v
8. On first successful AES-GCM decrypt:
       replaces envelope with "🔓 <plaintext>"
```

Design notes:

- **Candidate keys are tried until one succeeds.** This lets a single
  user decrypt messages from anyone in their contact list, without
  prior sender identification.
- **Fragments are re-joined before decryption.** Only the first
  fragment carries the `ES2:` prefix; the rest are raw base64url.
- **Failed decryptions are logged and skipped**, never surfaced as
  errors — a page may contain envelopes for other users.

---

## Envelope format

The v2 envelope is a compact binary structure, base64url-encoded in
text with the `ES2:` prefix.

```
+--------+--------+---------+--------------+-------------------+
| offset | field  | size    | type         | description       |
+--------+--------+---------+--------------+-------------------+
|   0    | version| 1 byte  | uint8        | 0x02              |
|   1    | flags  | 1 byte  | uint8        | bit 0 = gzip      |
|   2    | IV     | 12 bytes| random       | AES-GCM nonce     |
|   14   | keyId  | 8 bytes | SHA-256[:8]  | sender key id     |
|   22   | data   | N bytes | ciphertext   | AES-GCM + tag     |
+--------+--------+---------+--------------+-------------------+
```

- **Version** — 1 byte, currently `0x02`. Lets the parser reject
  unknown formats cleanly.
- **Flags** — 1 byte. Bit 0 signals that the payload was gzip-compressed
  before encryption; other bits reserved.
- **IV** — 12 random bytes generated per message. AES-GCM requires a
  unique IV per key; 12 bytes is the recommended length for the 96-bit
  counter mode.
- **keyId** — first 8 bytes of `SHA-256(public_key_sender)`. Lets the
  recipient quickly identify which sender public key to try first, but
  the implementation tries all contacts anyway, so a mismatch is not
  fatal.
- **data** — the AES-GCM ciphertext, including the 16-byte authentication
  tag appended by the Web Crypto API.

Textual representation:

```
ES2:AQIBvG9i3sH8kK...
```

Envelopes produced by older versions (`🔒ES:{json}:ES🔒`) are still
accepted by the parser for backward compatibility.

---

## Fragmentation for long messages

When the envelope exceeds the platform-specific safe limit, it is
split into a numbered thread:

```
1/3 ES2:xxxxx
2/3 yyyyy
3/3 zzzzz
```

Rules:

- Only the **first fragment** carries the `ES2:` prefix.
- Fragments 2 through N are raw base64url continuation.
- The `n/N` prefix lets the reassembler know when a thread is complete.
- The reassembler ignores incomplete threads (e.g. user scrolls past
  the middle of a thread).

Thresholds:

| Constant            | Value | Purpose                                     |
|---------------------|-------|---------------------------------------------|
| `THREAD_SAFE_LIMIT` | 200   | Split even if platform would allow more     |
| X safe limit        | 230   | Practical limit so X itself does not truncate |
| `PLATFORM_LIMITS`   | 240 (X) / 63206 (FB) / 2200 (IG, TikTok) |

Why the X limit is 240, not 280:

- X counts characters in its own way (URLs are shortened, some Unicode
  counts differently).
- The platform sometimes silently truncates tweets near the limit.
- Leaving ~40 chars of headroom prevents that.

---

## Storage layout

All persistent state lives in `browser.storage.local` under a small
set of keys.

| Key                   | Type     | Contents                                        |
|-----------------------|----------|-------------------------------------------------|
| `identity`            | `string` | User's registered email (e.g. `user@example.org`) |
| `public_key`          | `string` | Base64-encoded ECDH P-256 public key             |
| `wrapped_private_key` | `object` | `{ salt, iv, wrapped }` — PKCS#8 encrypted with PBKDF2 + AES-GCM |
| `contacts`            | `object` | Map of `email -> { publicKey, addedAt }`         |

Not stored:

- The **password** used to unwrap the private key.
- Any **decrypted** form of the private key on disk.
- The **shared secret** between any two users.

In-memory only (per tab):

- `cachedPublicKey` — the user's own public key, loaded once.
- `cachedPrivateKey` — the unwrapped `CryptoKey` object. Cleared on
  tab close, page reload, or manual lock.

---

## Xray isolation (Firefox)

Firefox extensions run content scripts in an **isolated world** (also
called Xray vision). The content script can read and modify the page's
DOM, but **objects created by the page belong to a different context**.
Accessing their properties from the content script triggers an Xray
barrier, which Firefox enforces with errors like:

```
Permission denied to access property "constructor"
```

This is not a permissions problem on your machine — it is a security
boundary. The following practices are mandatory in this project:

### Rules

1. **Never call `prompt()`, `confirm()`, or `alert()` from a content
   script.**
   The values returned by these dialogs are page-owned. Trying to
   read `.length` on the string returned by `prompt()`, or to use it
   in template literals, throws the `constructor` error. Use inline
   HTML inputs instead.

2. **Always wrap page strings with `safeString()`** before comparing,
   slicing, or passing them to crypto functions:

   ```js
   function safeString(v) {
     if (v === null || v === undefined) return '';
     try { return String(v); } catch { return ''; }
   }
   ```

3. **Always copy `TypedArray` values field by field** before handing
   them to another context. Passing a `Uint8Array` directly from a
   page object into a `crypto.subtle` call may expose the internal
   `constructor` to the wrong side of the barrier:

   ```js
   const copy = new Uint8Array(value.length);
   for (let i = 0; i < value.length; i++) copy[i] = value[i];
   ```

4. **Compare DOM nodes via `wrappedJSObject`** when identity matters,
   because two Xray wrappers pointing to the same node compare
   unequal with `===`:

   ```js
   function isFocused(el) {
     const active = document.activeElement;
     if (active === el) return true;
     try { return active.wrappedJSObject === el.wrappedJSObject; }
     catch { return false; }
   }
   ```

5. **Never inject inline event handlers** (`onclick="..."`) into the
   page. Attach listeners from the content script scope instead.

### Anti-patterns to avoid

| Anti-pattern                                  | Why it fails                                   |
|-----------------------------------------------|------------------------------------------------|
| `const p = prompt('Password')` in content.js  | Returns a page-owned string; `.length` throws  |
| `el.value = await getFromPage()`              | If value is page-owned, assigning may throw    |
| `pageArray.map(fn)` on a page-owned array     | `map` accesses `constructor` across the barrier |
| `someNode.constructor === HTMLElement`        | Cross-context identity mismatch                |
| `document.execCommand('insertText', ...)` with page ranges | Same class of issue                  |

The version shipped in `extension/content.js` (v5) already follows all
of these. Future contributions must as well.

---

## Threat model

### In scope

- **Content confidentiality.** Social platforms and their CDNs must
  not be able to read the plaintext of encrypted posts.
- **Recipient authenticity (with caveats).** Only the intended
  recipient can decrypt, provided they verify the sender's public key
  fingerprint over an out-of-band channel.
- **Local private key at rest.** The private key on disk is protected
  by a password-derived key (PBKDF2 100,000 iterations + AES-GCM).

### Out of scope (documented limitations)

- **Metadata.** The platform still sees *that* a post happened,
  *when*, and *to whom*. Encrypt Social does not attempt to hide
  this.
- **Forward secrecy.** There is no per-message ephemeral key ratchet.
  Compromise of a long-term private key compromises all past messages
  that used it.
- **Trust-on-first-use.** Users must verify fingerprints out of band.
  If they skip that step, a MITM at the key-exchange stage is
  possible.
- **Endpoint compromise.** Malware on the user's machine, or a
  malicious browser extension with `storage` permission, can read
  everything.
- **Platform reply visibility.** On X, auto-replies and replies from
  protected accounts may be hidden from some viewers. Users should
  publish encrypted messages as **top-level posts**, not as replies.

### Trust boundaries

```
+------------------+     untrusted      +------------------+
|  User A device   |  ------------------| Social platform  |
|  (holds privA)   |      (network)     |  (sees cipher)   |
+------------------+                    +------------------+
        ^                                       ^
        | trusted (local)                       | untrusted
        v                                       v
+------------------+                    +------------------+
|  Firefox storage |                    |  Other users     |
|  (encrypted)     |                    |  (see cipher)    |
+------------------+                    +------------------+
```

The only fully trusted surface is the user's device, and even there
only the extension and the local storage it controls. Every other
participant — the platform, the network, and other viewers — is
assumed hostile.

---

*Last updated: 2026-01-15 · Version 0.4.0*