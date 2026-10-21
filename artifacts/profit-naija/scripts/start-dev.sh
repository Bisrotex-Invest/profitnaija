#!/usr/bin/env bash

set -u

# The mobile artifact is mounted below a shared web preview path. Expo Router
# uses this value when generating the browser bundle URL; without it the HTML
# shell requests /node_modules/... and the shared root returns a 404.
export EXPO_BASE_URL="${BASE_PATH:-/}"

echo "Starting Expo Go tunnel preview..."
if pnpm exec expo start --clear --tunnel --port "${PORT}"; then
  exit 0
fi

echo "Expo tunnel unavailable; falling back to LAN preview."
exec pnpm exec expo start --clear --lan --port "${PORT}"