#!/usr/bin/env bash
# Shorekeeper v1.0 一键安装（T8 骨架）。真机走查 ⏸ 待 T1《替代决策清单》钉版本后执行。
#
# 前置：macOS（Mac Mini）；homebrew；git
# 产出：dsh 装好、shorekeeper profile 建好、4 个自写插件链接进 profile、
#       生态插件按《替代决策清单》安装并钉版本。
set -euo pipefail

DSH_VERSION="0.2.1-rc.5"          # 方案钉死；升级先跑 docs/compat-matrix.md
PROFILE_NAME="shorekeeper"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

say "1/5 dsh 安装（钉 ${DSH_VERSION}）"
if command -v dsh >/dev/null 2>&1 && [ "$(dsh --version)" = "$DSH_VERSION" ]; then
  echo "dsh 已就位"
else
  npm install -g "@deepseek-ai/dsh@${DSH_VERSION}"
fi

say "2/5 建 profile（${PROFILE_NAME}）"
dsh --profile "${PROFILE_NAME}" --from-default-profile web

say "3/5 生态插件安装"
# ⏸ 占位：清单与版本以 T1《替代决策清单》（docs/ 下）为准，验收通过才写死到这里。
#   dsh-mihome / dsh-weather / dsh-vitals / @doitian/dsh-music / dsh-voice-mode
#   dsh-tavern / dsh-calendar / dsh-calendar-diary / 记忆插件（T1 选型）/ dsh-mobile-notify
cat <<'LIST'
TODO(T1): 以下每行在《替代决策清单》落锤后取消注释并钉版本
# dsh plugin --profile shorekeeper add dsh-mihome@<pin>
# dsh plugin --profile shorekeeper add dsh-weather@<pin>
# ...
LIST

say "4/5 自写插件链接"
for plugin in dsh-shorekeeper-k20 dsh-keeper-voice dsh-shorekeeper-reading dsh-shorekeeper-wechat; do
  dsh plugin --profile "${PROFILE_NAME}" add "file:${REPO_DIR}/plugins/${plugin}"
done

say "5/5 cordis.patch.yml 默认值"
if [ ! -f "$HOME/.dsh/profiles/${PROFILE_NAME}/cordis.patch.yml" ] || [ "${OVERWRITE_PATCH:-0}" = "1" ]; then
  cp "${REPO_DIR}/profile/cordis.patch.yml" "$HOME/.dsh/profiles/${PROFILE_NAME}/cordis.patch.yml"
  echo "已写入默认补丁（含 k20 地址/token 占位，请编辑）"
else
  echo "已存在 cordis.patch.yml，跳过（OVERWRITE_PATCH=1 可覆盖）"
fi

say "完成。启动：dsh --profile ${PROFILE_NAME}   日常实例端口 3080 / 实验 3081"
