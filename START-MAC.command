#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then echo "Install Node.js LTS from https://nodejs.org/"; read -r; exit 1; fi
(sleep 2; open http://localhost:3000) &
node server.js
