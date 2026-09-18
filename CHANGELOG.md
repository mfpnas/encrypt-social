# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/).

## [0.4.0] — 2026-01-15

### Added
- Compact v2 binary envelope (`ES2:...`) — reduces overhead from
  ~250 to ~58 characters for short messages.
- Automatic thread fragmentation for X/Twitter.
- Automatic reassembly of fragments during decryption.
- Optional gzip compression before encryption (payload > 40 bytes).
- Recipient selector directly in the toolbar.
- SHA-256 fingerprint displayed in settings.
- JSON backup export for external encryption with GPG.
- `tools/export-keys.sh` script for encrypted backup.
- Identity detection (registered email) in settings.
- Multi-contact support with add/remove from the UI.

### Fixed
- Firefox error `Permission denied to access property "constructor"`
  caused by:
  - Use of `prompt()`, `confirm()`, and `alert()` in content scripts.
  - Copying `TypedArray` across contexts (Xray vision).
- Toolbar disappearing on SPA navigation — MutationObserver re-injects.
- Long envelopes being truncated by X without fragmentation.

### Changed
- X limit reduced from 280 to 240 characters (headroom so X itself
  does not truncate).
- Fragmentation threshold reduced to 200 characters on any platform.
- Message format migrated from `🔒ES:{json}:ES🔒` to `ES2:<base64url>`.
- Toolbar now includes a password input (eliminates `prompt()`).

### Removed
- Calls to `prompt()`, `confirm()`, and `alert()` inside
  `content.js`.

## [0.3.0] — 2026-01-10

### Added
- Web Hub for cross-posting.
- Initial support for Facebook, Instagram, and TikTok.

### Fixed
- Xray errors in the DOM (first attempt).

## [0.1.0] — 2026-01-05

### Added
- Initial proof of concept.
- ECDH P-256 + AES-GCM encryption.
- X/Twitter support.