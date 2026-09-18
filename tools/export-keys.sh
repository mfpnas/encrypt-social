#!/usr/bin/env bash
# export-keys.sh
# Encrypts the JSON key backup with symmetric GPG.
#
# Usage:
#   ./export-keys.sh <backup.json path> <user email>

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <backup.json> <email>"
  exit 1
fi

BACKUP="$1"
EMAIL="$2"
DEST_DIR="$HOME/secure-keys"

if [ ! -f "$BACKUP" ]; then
  echo "File not found: $BACKUP"
  exit 1
fi

mkdir -p "$DEST_DIR"
chmod 700 "$DEST_DIR"

SAFE_EMAIL=$(echo "$EMAIL" | tr '@' '_')
OUT="$DEST_DIR/encrypt-social-${SAFE_EMAIL}-$(date +%Y%m%d).json.gpg"

echo "Encrypting with GPG (you will be asked for a password)…"
gpg --symmetric --cipher-algo AES256 --output "$OUT" "$BACKUP"
chmod 600 "$OUT"

echo "Encrypted file created at: $OUT"
echo
echo "To restore later:"
echo "  gpg -d \"$OUT\" > backup.json"
echo
echo "Removing plaintext backup…"
if command -v shred >/dev/null 2>&1; then
  shred -u "$BACKUP"
else
  rm -f "$BACKUP"
fi

echo "Done."