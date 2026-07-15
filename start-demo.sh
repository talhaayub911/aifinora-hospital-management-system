#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  npm install
fi
export DATABASE_URL="${DATABASE_URL:-file:./dev.db}"
npm run db:bootstrap:demo
npm run dev
