#!/usr/bin/env bash
#
# Register accounts with the sync, from the command line.
#
# The dashboard does not need this — it sends its own tracked list with every
# sync request, because that list lives in the browser's storage on purpose.
# This is for the other cases: seeding a fresh deploy, a scheduled job, or an
# operator who would rather write a list than click twelve times.
#
# Usage:
#   scripts/setup-tracking.sh [--site URL] [--key KEY] [--file accounts.tsv]
#   scripts/setup-tracking.sh --list
#   scripts/setup-tracking.sh --remove YouTube @somechannel
#
# The account file is tab-separated, one per line, '#' comments ignored:
#   platform<TAB>handle<TAB>category<TAB>name<TAB>profileUrl
#
#   platform    YouTube | Facebook | Instagram | Twitter/X | LinkedIn |
#               Bluesky | Mastodon | Threads
#   category    self       — an account the office runs
#               competitor — an account it is measured against
#               influencer — an account it watches
#   name        optional; defaults to the handle
#   profileUrl  optional for every platform whose URL follows from the handle.
#               REQUIRED for LinkedIn, because /in/<h> is a person and
#               /company/<h> is an organisation and the handle does not say
#               which — a wrong guess is a 404 the sync would faithfully record
#               as "this account publishes nothing".
#
# The key is SETTINGS_ACCESS_KEY, the same shared secret that gates the other
# operator surfaces. It is sent as the x-settings-key header. There is no
# fallback: with no key configured the endpoint refuses rather than opening.

set -euo pipefail

SITE="${SIGNAL_SITE:-http://localhost:8888}"
KEY="${SETTINGS_ACCESS_KEY:-}"
FILE=""
ACTION="add"
REMOVE_PLATFORM=""
REMOVE_HANDLE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --site) SITE="$2"; shift 2 ;;
    --key) KEY="$2"; shift 2 ;;
    --file) FILE="$2"; shift 2 ;;
    --list) ACTION="list"; shift ;;
    --remove) ACTION="remove"; REMOVE_PLATFORM="$2"; REMOVE_HANDLE="$3"; shift 3 ;;
    -h|--help) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

API="${SITE}/api/configure-tracking"

# Read the key out of .env if it was not supplied, so the common case is one
# argument rather than three. Never printed, here or anywhere below.
if [[ -z "$KEY" && -f .env ]]; then
  KEY="$(grep -E '^SETTINGS_ACCESS_KEY=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r")"
fi

if [[ -z "$KEY" ]]; then
  cat >&2 <<'MSG'
No settings key. Set SETTINGS_ACCESS_KEY in .env, export it, or pass --key.

This endpoint writes to shared storage and can delete an account's whole sync
history, so it refuses outright when no key is configured rather than falling
open to anyone who finds the URL.
MSG
  exit 1
fi

post() {
  curl -sS -X POST "$API" \
    -H "x-settings-key: ${KEY}" \
    -H 'Content-Type: application/json' \
    -d "$1"
}

if [[ "$ACTION" == "list" ]]; then
  curl -sS "$API" -H "x-settings-key: ${KEY}"
  echo
  exit 0
fi

if [[ "$ACTION" == "remove" ]]; then
  post "$(printf '{"action":"remove","platform":"%s","handle":"%s"}' "$REMOVE_PLATFORM" "$REMOVE_HANDLE")"
  echo
  exit 0
fi

if [[ -z "$FILE" ]]; then
  cat >&2 <<'MSG'
Nothing to add: pass --file with a tab-separated list of accounts.

This script ships with no example accounts on purpose. The version that did
carried placeholders like "your_channel" and "dkaruna", and running it as-is
registered handles that do not exist — which the sync then read, failed to
find, and recorded as accounts that publish nothing.

  # platform   handle           category    name              profileUrl
  YouTube      @BBCNews         competitor  BBC News
  Bluesky      bsky.app         competitor  Bluesky
  LinkedIn     some-person      competitor  Some Person       https://www.linkedin.com/in/some-person/
MSG
  exit 2
fi

if [[ ! -f "$FILE" ]]; then
  echo "No such file: $FILE" >&2
  exit 2
fi

json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

added=0
failed=0

while IFS=$'\t' read -r platform handle category name profileUrl || [[ -n "${platform:-}" ]]; do
  # Blank lines and comments.
  [[ -z "${platform// }" ]] && continue
  [[ "${platform:0:1}" == "#" ]] && continue

  platform="$(printf '%s' "$platform" | tr -d '\r')"
  handle="$(printf '%s' "${handle:-}" | tr -d '\r')"
  category="$(printf '%s' "${category:-competitor}" | tr -d '\r')"
  name="$(printf '%s' "${name:-}" | tr -d '\r')"
  profileUrl="$(printf '%s' "${profileUrl:-}" | tr -d '\r')"

  if [[ -z "$handle" ]]; then
    echo "  skipped: '$platform' row has no handle" >&2
    failed=$((failed + 1))
    continue
  fi

  body="$(printf '{"action":"add","platform":"%s","handle":"%s","category":"%s"' \
    "$(json_escape "$platform")" "$(json_escape "$handle")" "$(json_escape "$category")")"
  [[ -n "$name" ]] && body="${body}$(printf ',"name":"%s"' "$(json_escape "$name")")"
  [[ -n "$profileUrl" ]] && body="${body}$(printf ',"profileUrl":"%s"' "$(json_escape "$profileUrl")")"
  body="${body}}"

  response="$(post "$body")"
  if printf '%s' "$response" | grep -q '"ok":true'; then
    echo "  added   $platform $handle ($category)"
    added=$((added + 1))
  else
    echo "  FAILED  $platform $handle — $response" >&2
    failed=$((failed + 1))
  fi
done < "$FILE"

echo
echo "$added added, $failed failed."
echo
echo "Now run a sync. It reads the accounts slowly on purpose, so it takes"
echo "several passes; each call does as much as it can and reports what is left:"
echo
echo "  curl -X POST '${SITE}/api/sync-profiles'"
echo
echo "Repeat until the response says \"done\": true."

[[ $failed -gt 0 ]] && exit 1
exit 0
