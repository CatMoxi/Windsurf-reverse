# Windsurf-Reverse

逆向分析 Windsurf Next IDE，研究其代码臃肿原因，提取登录协议，实现 API 反代理。

## 目标

1. **臃肿分析** — 为什么 Windsurf 体积和内存占用如此大？
2. **登录协议** — 逆向账号密码登录和 Auth Token 登录流程
3. **API 反代理** — 提取并代理 Windsurf 后端 API

## 目标版本

- **Windsurf Next v2.2.1017** (commit `a65d6c4e1f`)
- 支持 subagent 的最新 Next 版本

## 项目结构

```
docs/           逆向分析文档
src/            反代理实现代码
tools/          逆向辅助工具/脚本
windsurf-next/  下载的 Windsurf Next (gitignored)
```

## 使用方法

### 1. 下载 Windsurf Next
```bash
# 自动下载脚本
python tools/download_windsurf.py
```

### 2. 运行反代理 (待实现)
```bash
# 待 Phase 4 完成后补充
```

## 约束

- 仅用于学习研究目的
- 不硬编码任何真实凭据
- 详见 [AGENTS.md](./AGENTS.md)

## License

MIT
