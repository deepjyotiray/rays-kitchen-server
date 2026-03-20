#!/bin/bash
# Usage: ./scripts/healthcheck.sh [url]
# Defaults to production site

URL="${1:-https://healthymealspot.com}"
LOG="logs/healthcheck.log"

ts() { date '+%Y-%m-%d %H:%M:%S'; }

HTTP=$(curl -o /dev/null -s -w "%{http_code}" --max-time 10 "$URL")

if [ "$HTTP" = "200" ]; then
  echo "$(ts) OK $HTTP $URL" >> "$LOG"
  exit 0
fi

echo "$(ts) DOWN $HTTP $URL — restarting all" >> "$LOG"
pm2 restart all >> "$LOG" 2>&1
echo "$(ts) restarted all" >> "$LOG"
