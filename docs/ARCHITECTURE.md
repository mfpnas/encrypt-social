# Architecture

## Overview

┌────────────────────────────────────┐
│ Firefox                            │
│ ┌──────────────┐  ┌──────────────┐  │
│ │ content.js  │◀──▶│ background.js│ │
│ │ (per tab) │ │ (global) │ │
│ └──────┬───────┘ └──────┬───────┘ │
│ │ │ │
│ │ crypto.js │ crypto.js │
│ │ (isolated) │ (isolated) │
│ ▼ ▼ │
│ Page DOM browser.storage.local │
└───────────────────────────────────────────────────────────┘
text


## Encryption flow

1. User A types the message into the post field.
2. `content.js` reads the text.
3. `content.js` asks the user for the unlocked private key
   (toolbar input).
4. `content.js` calls
   `CryptoModule.encryptForRecipient(text, privA, pubA, pubB)`.
5. `CryptoModule` derives `shared = ECDH(privA, pubB)` and encrypts
   with AES-GCM.
6. The binary envelope is packed as `ES2:<base64url>`.
7. If the envelope fits within the platform limit, it is inserted in
   the field. Otherwise, it is fragmented into `1/N`, `2/N`, ...

## Decryption flow

1. User B sees `ES2:...` on the page.
2. `content.js` scans the body `innerText`.
3. It detects complete envelopes or fragmented threads (`n/N`).
4. For each envelope, it tries to decrypt with:
   - User B's own public key.
   - Each saved contact public key.
5. On success, it replaces the page text with `🔓 <plain>`.

## v2 envelope

Offset Field Bytes Description
0 version 1 0x02
1 flags 1 bit 0 = compressed
2 IV 12 AES-GCM nonce
14 senderKeyId 8 SHA-256(pub_sender)[:8]
22 ciphertext N AES-GCM output + auth tag
text


## Fragmentation

Envelopes larger than `THREAD_SAFE_LIMIT` (200 chars) or exceeding
the platform limit are fragmented:

1/3 ES2:<first part>
2/3 <second part>
3/3 <third part>
text


Only the first fragment carries the `ES2:` prefix. During decryption,
`handleDecrypt` reassembles fragments automatically.

## Storage

| storage.local key     | Contents |
|-----------------------|----------|
| `identity`            | user's registered email |
| `public_key`          | public key in base64 |
| `wrapped_private_key` | { salt, iv, wrapped } — encrypted PKCS#8 |
| `contacts`            | { email: { publicKey, addedAt } } |

## Xray isolation

Firefox content scripts run in an isolated world. Page objects
(including `TypedArray` and strings returned by `prompt()`/`confirm()`)
belong to the page context and cannot be accessed directly.

Rules followed in this project:

1. Never call `prompt()`, `confirm()`, or `alert()` in content scripts.
2. Always convert page values with `safeString()`.
3. Always copy `TypedArray` field-by-field before exposing to another
   context.
4. Compare elements via `wrappedJSObject` when identity matters.