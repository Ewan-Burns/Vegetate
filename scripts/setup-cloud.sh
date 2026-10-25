#!/usr/bin/env bash
set -euo pipefail

cd /workspace/Vegetate
npm ci --no-audit
npm run build
npm test
