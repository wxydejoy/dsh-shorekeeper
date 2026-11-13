#!/usr/bin/env bash
# 打印 dsh web 当前有效的激活链接（token 每次重启轮换，新设备激活前先跑这个）。
# 已激活过的设备不用管：cookie 签名密钥持久，30 天内重启也有效。
T=$(grep -o "token=[A-Za-z0-9_-]*" "$HOME/.dsh/logs/dsh-web.out.log" | tail -1 | cut -d= -f2)
HOST="${1:-10.14.14.117}"
PORT="${2:-3090}"
echo "http://$HOST:$PORT/?token=$T"
