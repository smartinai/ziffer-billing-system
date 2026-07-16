#!/bin/sh
set -eu

subject=${1:-"[Ziffer] Operations alert"}
body=${2:-"Ziffer generated an operational alert."}
recipient_file="${OPS_RECIPIENT_FILE:-/var/lib/ziffer-monitor/admin-emails}"

command -v msmtp >/dev/null 2>&1 || { printf 'msmtp is not installed.\n' >&2; exit 1; }
[ -s "$recipient_file" ] || { printf 'No cached administrator recipients in %s.\n' "$recipient_file" >&2; exit 1; }

recipients=$(paste -sd, "$recipient_file")
{
  printf 'To: %s\n' "$recipients"
  printf 'Subject: %s\n' "$subject"
  printf 'Content-Type: text/plain; charset=UTF-8\n'
  printf '\n%b\n' "$body"
} | msmtp -t
