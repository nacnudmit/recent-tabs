#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

usage() {
  echo "Usage: $0 [chrome|firefox|all]" >&2
  exit 1
}

write_store_manifest() {
  local dest="$1"
  local flavor="$2"
  python3 - "$dest" "$flavor" <<'PY'
import json
import sys

dest, flavor = sys.argv[1], sys.argv[2]
with open("manifest.json", encoding="utf-8") as handle:
    manifest = json.load(handle)

if flavor == "chrome":
    # Chrome Web Store / older Chromium validators reject MV3 background.scripts.
    manifest["background"] = {"service_worker": "background.js"}
    manifest.pop("browser_specific_settings", None)
    manifest.pop("options_ui", None)
elif flavor == "firefox":
    # Firefox MV3 does not run background.service_worker; it needs background.scripts.
    manifest["background"] = {"scripts": ["background.js"]}
    manifest.pop("options_page", None)
    manifest["options_ui"] = {"page": "options.html"}
    manifest.setdefault(
        "browser_specific_settings",
        {
            "gecko": {
                "id": "recent-tabs@nacnudmit",
                "strict_min_version": "140.0",
                "data_collection_permissions": {"required": ["none"]},
            },
            "gecko_android": {"strict_min_version": "142.0"},
        },
    )
else:
    raise SystemExit(f"unknown flavor: {flavor}")

with open(dest, "w", encoding="utf-8") as handle:
    json.dump(manifest, handle, indent=2)
    handle.write("\n")
PY
}

package() {
  local flavor="$1"
  local zipname="$2"
  local tmp
  tmp="$(mktemp -d)"
  write_store_manifest "$tmp/manifest.json" "$flavor"
  cp background.js popup.html popup.js options.html options.js "$tmp/"
  cp -R icons "$tmp/icons"
  rm -f "$zipname"
  (
    cd "$tmp"
    zip -r "$OLDPWD/$zipname" \
      manifest.json \
      background.js \
      popup.html \
      popup.js \
      options.html \
      options.js \
      icons \
      -x '*.DS_Store'
  )
  rm -rf "$tmp"
  echo "Built $zipname ($flavor)"
}

target="${1:-chrome}"
case "$target" in
  chrome)
    package chrome recent-tabs.zip
    ;;
  firefox)
    package firefox recent-tabs-firefox.zip
    ;;
  all)
    package chrome recent-tabs.zip
    package firefox recent-tabs-firefox.zip
    ;;
  *)
    usage
    ;;
esac
