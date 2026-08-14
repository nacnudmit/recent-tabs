#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

rm -f recent-tabs.zip

zip -r recent-tabs.zip \
  manifest.json \
  background.js \
  popup.html \
  popup.js \
  options.html \
  options.js \
  icons

echo "Built recent-tabs.zip"
