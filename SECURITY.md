# Security policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.4.x   | ✅ |
| < 0.4   | ❌ |

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Email the maintainer (see GitHub profile) with:

- Vulnerability description
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You will receive a response within 72 hours.

## Scope

We consider vulnerabilities:

- Breakage of the cryptographic scheme (ECDH, AES-GCM, PBKDF2)
- Plaintext private key leakage
- Isolation flaws (Xray bypass)
- Code injection into the content script
- Envelope corruption causing data loss

**Out of scope** (known limitations):

- Absence of forward secrecy (documented in README)
- Manual key exchange (documented)
- Metadata visible to the platform (documented)

## Responsible disclosure

We ask that you give us a reasonable window (90 days) to fix before
public disclosure.