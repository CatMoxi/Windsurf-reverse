# 已验证事实

## Windsurf Next 下载信息
- **版本**: v2.2.1017+next (windsurfVersion)
- **产品版本**: 1.110.1
- **Commit**: `a65d6c4e1fd335336d7a0b601099811667e184ca`
- **下载 URL**: `https://windsurf-stable.codeiumdata.com/win32-x64-archive/next/a65d6c4e1fd335336d7a0b601099811667e184ca/Windsurf-win32-x64-2.2.1017+next.a65d6c4e1f.zip`
- **SHA256**: `197da6e136fc5d96301af33db1322b7f5db45f5ca6436cc4991a6ab5345e37a0`
- **Update API**: `https://windsurf-next.codeium.com/api/update/win32-x64-archive/next/{commit}`

## 已知结构 (从 Stable 版探明)
- `resources/app/extensions/windsurf/dist/extension.js` (~9.6MB) — 核心扩展 webpack bundle
- `resources/app/out/vs/workbench/workbench.desktop.main.js` (~31MB) — 主渲染进程
- `resources/app/extensions/windsurf/bin/language_server_windows_x64.exe` (~170MB) — gRPC LS
- Source maps: `https://cdn.windsurf.com/sourcemaps/{commit}/extensions/windsurf/dist/extension.js.map`
- 协议栈: Protobuf + Connect-RPC
- 认证 provider: `windsurf_auth`, 命令: `windsurf.login`, `windsurf.loginWithAuthToken`

## GitHub
- 账号: CatMoxi
- 仓库: https://github.com/CatMoxi/Windsurf-reverse
- gh CLI: `C:\Program Files\GitHub CLI\gh.exe`
