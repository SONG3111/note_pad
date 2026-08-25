# note pad

一款轻量的随手记录软件:记 idea、列待办、多端同步,桌面端支持贴边隐藏。

![Tauri](https://img.shields.io/badge/Tauri-2.x-blue) ![Vue](https://img.shields.io/badge/Vue-3.x-green) ![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20iOS%20%7C%20Android-lightgrey)

## ✨ 功能特性

- **便签与待办**:纯想法用便签,清单事项用待办;待办可勾选、带进度条
- **智能排序**:置顶优先,其余按时间倒序;「全部 / 待办 / 便签」分类切换
- **贴边隐藏**(Windows):窗口拖到屏幕左/右边缘自动收起成 6px 露出条,鼠标靠近丝滑弹出
- **全局快捷键**:`Ctrl+Alt+T` 快速新建待办、`Ctrl+Alt+N` 快速新建便签(任何界面下生效)
- **托盘常驻**:关闭即最小化到托盘,后台随叫随到
- **本地存储**:SQLite 本地数据库,数据完全在自己手里

安装包仅 ~3MB,内存占用极小。

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 + TypeScript + Pinia + Vite |
| 桌面/移动壳 | Tauri 2(Rust) |
| 本地存储 | SQLite(rusqlite) |
| 系统集成 | 托盘、全局快捷键、Win32 窗口停靠 |

## 🚀 开发

```powershell
# 前置要求:Node.js ≥18、Rust stable-msvc、VS Build Tools(C++)
npm install
npm run tauri dev      # 开发调试(热更新)
```

## 📦 打包

```powershell
npm run tauri build                    # 全部格式
npm run tauri build -- --bundles nsis  # 仅 Windows 安装向导
```

产物位于 `src-tauri/target/release/bundle/`。详细排障见 `docs/方案/打包指南.md`。

## 🗺 路线图

- [x] M1 便签 CRUD + Todo 打勾 + SQLite 本地存储
- [x] M2 贴边吸附/隐藏/悬停弹出 + 托盘常驻 + 全局快捷键
- [ ] M3 手机 ↔ 电脑 多端同步(Supabase 或自建服务端)
- [ ] M4 搜索增强、主题、自动更新、移动端发布

## 📄 许可

本项目采用自定义许可证:**允许个人学习、研究与非营利用途的自由使用、修改和分发;未经作者书面授权,禁止任何形式的商业使用**。详见 [LICENSE](LICENSE)。
