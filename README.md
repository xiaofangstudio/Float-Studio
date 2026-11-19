# Float Studio

小方工作室的 **Copper UI 一体化开发环境**：左边写前端 `.cui`，右边写后端 `.co`，改完直接构建、直接跑。语言与编译器来自 [Copper](https://github.com/xiaofangstudio/Copper)，编辑器与预览器来自 Float 系。

- 版本：0.1.0
- 技术栈：Tauri 2 + React 18 + Monaco + xterm
- 许可：MIT © 2026 小方工作室

---

## 是什么

Copper UI（`.cui`）写界面，Copper（`.co`）写逻辑。Float Studio 把两件事放在同一个窗口里：

- **CUI 实时预览**：改一行 `.cui`，右边立刻重排，不用手动刷新
- **Monaco 编辑体验**：Copper 语法高亮、补全、悬浮提示、符号索引、括号与缩进规则
- **工程管理**：文件树、全局搜索、Git 面板、集成终端
- **构建**：一键把工程编成原生程序，带进度与日志
- **MCP 服务**：外部 AI 可以通过 MCP 直接读写工程、跑脚本
- **插件**：内置插件 + 运行时加载，面板里可启停

## 目录

```
src/                    前端（React）
  ide/                  编辑器、文件树、终端、搜索、Git、索引
  workspace/            主工作区布局
  ui/                   标题栏、菜单、设置、外观、构建对话框
  plugins/              插件运行时与内置插件
  mcp/                  MCP 面板
  web/                  浏览器版后端（渐进增强）
  core/                 Tauri 桥、模板、类型
  docs/                 内置教程
src-tauri/              后端（Rust / Tauri 2）
  src/commands/         文件、Git、终端、构建、Copper 环境、MCP、插件、监听
  resources/            随包资源
scripts/                开发脚本
tests/                  语言、补全、索引、指针、标准库、教程的行为测试
```

## 开发

```bash
npm install
npm run tauri dev          # 桌面开发
npm run build              # 类型检查 + 前端构建
npm run test:all           # 语言 / 索引 / 压力测试
```

## 与另外两个仓库的关系

| 仓库 | 职责 |
|---|---|
| [Copper](https://github.com/xiaofangstudio/Copper) | 语言、编译器、运行时。Float Studio 通过 Copper 环境调用它 |
| [Float IDE](https://github.com/xiaofangstudio/Float-IDE) | 纯 Copper 代码编辑器（面向 .co 脚本） |
| **Float Studio**（本仓） | Copper UI 一体化环境（.cui + .co 一起写、一起调） |

编译器不随本仓分发：从 Copper 的 Release 下载，或让 Float Studio 通过 `copper_env_set` 指向已装好的环境。
