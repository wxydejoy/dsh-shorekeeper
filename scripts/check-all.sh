#!/usr/bin/env bash
# 一条命令跑全部套件（docs/compat-matrix.md「升级流程」第 2 步的落地）。
# CI（.github/workflows/ci.yml）跑的就是本脚本；本地升级前先跑它，绿了才动版本钉。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0

say() { printf '%s\n' "$*"; }

for p in dsh-shorekeeper-desk-mi dsh-shorekeeper-k20 dsh-keeper-voice dsh-shorekeeper-reading dsh-shorekeeper-wechat; do
  cd "$ROOT/plugins/$p"
  if [ ! -d node_modules ]; then
    npm install --no-fund --no-audit --legacy-peer-deps >/dev/null 2>&1
  fi
  TSC_OUT=$(npx tsc --noEmit 2>&1)
  if [ -n "$TSC_OUT" ]; then
    say "❌ $p typecheck"; echo "$TSC_OUT" | head -5; FAIL=1
  else
    say "✅ $p typecheck"
  fi
  V=$(npx vitest run 2>&1 | grep -E '^ *Tests ' | head -1)
  case "$V" in
    *failed*|*"no tests"*|"") say "❌ $p vitest: ${V:-无输出}"; FAIL=1 ;;
    *) say "✅ $p $V" ;;
  esac
done

cd "$ROOT/migration"
O=$(python3 -m unittest discover -s tests 2>&1 | grep -E '^(OK|FAILED)' | head -1)
if echo "$O" | grep -q '^OK'; then say "✅ migration $O"; else say "❌ migration ${O:-无输出}"; FAIL=1; fi

cd "$ROOT/plugins/dsh-shorekeeper-wechat/bridge/tests"
O=$(python3 -m unittest test_bridge 2>&1 | grep -E '^(OK|FAILED)' | head -1)
if echo "$O" | grep -q '^OK'; then say "✅ bridge $O"; else say "❌ bridge ${O:-无输出}"; FAIL=1; fi

cd "$ROOT/plugins/dsh-shorekeeper-desk-mi/py"
O=$(python3 -m unittest test_mi_bridge 2>&1 | grep -E '^(OK|FAILED)' | head -1)
if echo "$O" | grep -q '^OK'; then say "✅ desk-mi py $O"; else say "❌ desk-mi py ${O:-无输出}"; FAIL=1; fi

if [ "$FAIL" -eq 0 ]; then say "════ 全部绿色"; else say "════ 有失败项"; fi
exit $FAIL
