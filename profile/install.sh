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

say "3/5 生态插件安装（T1 钉版清单 2026-11-03 · D4–D15）"
# 判死/不装名单与依据见 T1 验收记录（docs/decisions.md）与 profile/README.md
for pkg in \
  dsh-glass-weather@0.3.0 \
  dsh-weather-panel@1.8.0 \
  dsh-vitals@0.1.19 \
  '@doitian/dsh-music@1.2.0' \
  dsh-voice-mode@0.7.34 \
  dsh-tavern@2.7.26 \
  dsh-mijia-sidebar@1.0.1 \
  feiyu-memory@4.0.2 \
  dsh-calendar@0.14.3 \
  dsh-notify-me@1.17.0 \
; do
  dsh plugin --profile "${PROFILE_NAME}" add "${pkg}"
done

# T1 实测教训（D3）：pnpm-workspace.yaml 删模板默认的 nodeLinker: hoisted（保 isolated linker），
# 否则老版 @deepseek-ai/* 依赖劫持 base 工具行。--from-default-profile 重建后要重查一次。
WS_FILE="$HOME/.dsh/profiles/${PROFILE_NAME}/pnpm-workspace.yaml"
if [ -f "$WS_FILE" ] && grep -q 'nodeLinker' "$WS_FILE"; then
  echo "⚠️ pnpm-workspace.yaml 里仍有 nodeLinker 行，请按 T1 D3 配方手工删除后重启 profile"
fi

say "4/5 自写插件链接"
# T9 踩坑（对全部自写 TS 插件生效）：链接前必须在插件目录先 npm install——
# isolated linker 从插件自身路径解析 @deepseek-ai/*，缺本地 node_modules 即
# failed to import（boot 静默降级、工具不注册）；且运行时依赖须在 dependencies 段。
# W2 踩坑（2026-11-03，Node 25 实证）：必须用 link: 不能用 file:——file: 会被 pnpm
# 拷进 .pnpm store，源码落到 node_modules 下，Node 的 TS strip-only 模式直接拒载
# （ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING），症状同样是 boot 静默降级。
# 同理插件源码不得用 TS 参数属性（constructor(readonly x)），strip-only 不支持。
for plugin in dsh-shorekeeper-desk-mi dsh-shorekeeper-k20 dsh-keeper-voice dsh-shorekeeper-reading dsh-shorekeeper-wechat; do
  if [ ! -d "${REPO_DIR}/plugins/${plugin}/node_modules" ]; then
    echo "  ↳ ${plugin} 缺 node_modules，先装本地依赖…"
    (cd "${REPO_DIR}/plugins/${plugin}" && npm install --silent)
  fi
  dsh plugin --profile "${PROFILE_NAME}" add "link:${REPO_DIR}/plugins/${plugin}"
done

say "5/5 cordis.patch.yml 默认值"
if [ ! -f "$HOME/.dsh/profiles/${PROFILE_NAME}/cordis.patch.yml" ] || [ "${OVERWRITE_PATCH:-0}" = "1" ]; then
  cp "${REPO_DIR}/profile/cordis.patch.yml" "$HOME/.dsh/profiles/${PROFILE_NAME}/cordis.patch.yml"
  echo "已写入默认补丁（含 k20 地址/token 占位，请编辑）"
else
  echo "已存在 cordis.patch.yml，跳过（OVERWRITE_PATCH=1 可覆盖）"
fi

say "完成。启动：dsh --profile ${PROFILE_NAME}   日常实例端口 3080 / 实验 3081"
