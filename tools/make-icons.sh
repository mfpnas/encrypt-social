#!/usr/bin/env bash
# make-icons.sh
# Generates placeholder icons (48x48 and 96x96) using ImageMagick or
# Python 3 + Pillow.

set -euo pipefail

DIR="$(dirname "$0")/../extension/icons"
mkdir -p "$DIR"

if command -v convert >/dev/null 2>&1; then
  echo "Using ImageMagick…"
  convert -size 48x48 xc:'#0f3460' \
    -gravity center -pointsize 24 -fill '#4ecca3' -annotate 0 'ES' \
    "$DIR/icon-48.png"
  convert -size 96x96 xc:'#0f3460' \
    -gravity center -pointsize 48 -fill '#4ecca3' -annotate 0 'ES' \
    "$DIR/icon-96.png"
elif command -v python3 >/dev/null 2>&1; then
  echo "Using Python + Pillow…"
  DIR="$DIR" python3 - <<'PY'
import os
from PIL import Image, ImageDraw
dir_ = os.environ["DIR"]
os.makedirs(dir_, exist_ok=True)
for size in (48, 96):
    img = Image.new("RGBA", (size, size), (15, 52, 96, 255))
    d = ImageDraw.Draw(img)
    text = "ES"
    bbox = d.textbbox((0, 0), text)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - w) / 2, (size - h) / 2 - 4), text, fill=(78, 204, 163, 255))
    img.save(f"{dir_}/icon-{size}.png")
PY
else
  echo "Install ImageMagick or Python+Pillow to generate icons."
  exit 1
fi

echo "Icons generated in $DIR"