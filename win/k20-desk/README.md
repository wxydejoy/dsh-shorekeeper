# k20 屏在线心跳

Windows 开着就让 k20 保持亮，并带上 CPU 占用、内存、GPU（有 nvidia-smi 才有显卡占用和温度）。不再经过旧 hub，也不要管理员权限。CPU 温度只有 WMI 热区读得到才带上，读不到手机上那一格就是空的。

锁屏和离开座位不压黑。睡眠、关机、进程退出超过 20 秒，屏再按自己的等待压黑。

## 配置

`%APPDATA%\k20-desk\desk.json`：

```json
{
  "url": "http://10.14.14.117:3090/v1/desk",
  "token": "",
  "interval_sec": 5
}
```

`url` 和 `token` 必填。`token` 与 k20 插件、安卓设置页是同一枚。`interval_sec` 缺省 5，小于 1 按 1。

## 安装

在 Windows 上，配置写好之后：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\desk.ps1 -Install
```

会做三件事：把脚本拷到 `%LOCALAPPDATA%\k20-desk\`、注册计划任务 `k20-desk`（登录时 Interactive 拉起，SSH 里 `Start-ScheduledTask` 也能活过会话）、并立刻启动一次。启动文件夹里还会留一份 `k20-desk.vbs` 备用。

托盘文字是「k20 屏：在线」或「k20 屏：上报失败」，菜单只有「退出」。

卸掉计划任务、启动项和脚本副本，配置和日志保留：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\desk.ps1 -Uninstall
```

日志在 `%LOCALAPPDATA%\k20-desk\desk.log`。

旧的 `DockHub --probe` / 计划任务 `HelmDockHub` 不再需要：本脚本已直连 `POST /v1/desk` 上报在线与 CPU/内存/GPU。
