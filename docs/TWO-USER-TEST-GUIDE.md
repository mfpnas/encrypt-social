# Test guide — two users on a single computer

Goal: simulate encrypted message exchange between
`aurionps@gmail.com` (Aurion) and `cidamelfaria@gmail.com` (Cida) using
isolated **Firefox Profiles**.

## Prerequisites

- Firefox 109+ desktop
- Repository cloned locally (e.g. `~/projects/encrypt-social/`)
- Icons generated (run `tools/make-icons.sh` or manually place PNGs in
  `extension/icons/`)

---

## Part 1 — Profile A (Aurion)

### 1.1 Create the profile

1. `about:profiles` → **Create a New Profile**.
2. Name: `aurionps`.
3. **Launch profile in new browser**.

### 1.2 Install the extension

1. `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → select
   `~/projects/encrypt-social/extension/manifest.json`.
3. Click the puzzle icon → **Encrypt Social** → ⚙ →
   **Pin to Toolbar**.

### 1.3 Generate keys

1. 🔐 icon → **Open settings**.
2. **Identity**: `aurionps@gmail.com` → **Save**.
3. **Generate new key pair**.
4. Password: `Aurion#2026!Secure` (at least 8 characters).
5. Note the displayed **fingerprint**.
6. **Export public key** → saves `encrypt-social-public-key.txt`.

### 1.4 Backup

1. **Export backup (JSON)** → saves
   `encrypt-social-backup-aurionps@gmail.com.json`.
2. In the terminal:

   ```bash
   ~/projects/encrypt-social/tools/export-keys.sh \
     ~/Downloads/encrypt-social-backup-aurionps@gmail.com.json \
     aurionps@gmail.com
   ```

3. Store the `.gpg` file in `~/secure-keys/`.

---

## Part 2 — Profile B (Cida)

### 2.1 Create profile

1. `about:profiles` → **Create a New Profile** → name `cidamelfaria`.
2. **Launch profile in new browser**.

### 2.2 Install and generate keys

Repeat 1.2 and 1.3 with:

- Identity: `cidamelfaria@gmail.com`
- Password: `Cida#2026!Secure` (different from Aurion's)
- Backup: `encrypt-social-backup-cidamelfaria@gmail.com.json`

---

## Part 3 — Key exchange

1. Aurion sends `pub_A` to Cida + **fingerprint on a separate channel**.
2. Cida sends `pub_B` to Aurion + **fingerprint on a separate channel**.
3. Both verify the fingerprint.

### Aurion adds Cida

Settings → **Trusted Contacts**:

- **Email / ID**: `cidamelfaria@gmail.com`
- **Public key**: paste `pub_B`
- **Add contact**

### Cida adds Aurion

Same, with `aurionps@gmail.com` and `pub_A`.

---

## Part 4 — Aurion encrypts

1. Open X at https://x.com.
2. **Click Post** (not Reply).
3. Type: `Hello Cida, this is a secret message from Aurion.`
4. Toolbar:
   - **Recipient**: `cidamelfaria@gmail.com`
   - **Password**: `Aurion#2026!Secure` → **Unlock**
5. **Encrypt selected text field**.
6. **Post**. If the message was fragmented, publish the fragments as a
   chained reply.

---

## Part 5 — Cida decrypts

1. Open Aurion's tweet (or thread).
2. **Do not click Reply**.
3. Toolbar:
   - **Password**: `Cida#2026!Secure` → **Unlock**
4. **Decrypt visible ES messages**.
5. The `ES2:...` text is replaced by `🔓 <original>`.

---

## Part 6 — Cida replies

1. **Post** (new tweet).
2. Type: `Got it, Aurion! Let's set up the meeting.`
3. Toolbar:
   - **Recipient**: `aurionps@gmail.com`
   - **Password**: `Cida#2026!Secure` → **Unlock**
4. **Encrypt selected text field**.
5. **Post**.

---

## Part 7 — Aurion decrypts

1. Open Cida's tweet.
2. Aurion's **password** → **Unlock**.
3. **Decrypt visible ES messages**.
4. Sees `🔓 Got it, Aurion! Let's set up the meeting.`

---

## Troubleshooting checklist

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Icon doesn't appear | Extension not pinned | Puzzle menu → Pin |
| `Permission denied to access property constructor` | Old `content.js` version | Use v5 or later |
| `The post you are trying to reply to...` | Post not visible to the other profile | Use Post (not Reply); check account privacy |
| Envelope truncated | Fragmentation not triggered | Reduce `THREAD_SAFE_LIMIT` |
| "Select a recipient" | Contact not added | Settings → Add contact |
| "Public key of X not found" | Contact not saved | Same as above |
| Decryption fails | Wrong profile / message for a different recipient | Verify you're in the correct recipient's profile |