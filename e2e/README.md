# 灵感便签 E2E 测试(tauri-driver + WebdriverIO)

驱动真实应用窗口做端到端冒烟。**测试数据走 UI 创建并在结束时删除,不会污染你的真实数据。**

## 前置安装(一次性)

```powershell
# 1. WebDriver 驱动桥(Tauri 官方工具)
cargo install tauri-driver --locked

# 2. Microsoft Edge Driver 下载器(Windows/WebView2 必需)
cargo install --git https://github.com/chippers/msedgedriver-tool
& "$HOME/.cargo/bin/msedgedriver-tool.exe"
```

## 运行前必读

1. **关闭正在运行的灵感便签**(含托盘)——应用启用了单实例,旧进程会劫持测试启动
2. 首次运行先 `npm install`(本目录)
3. 配置会自动 `cargo build` 出 debug 版再驱动;若想跳过编译请先手动 `npm run tauri build -- --debug`? 不需要,`cargo build` 即可

## 运行

```powershell
npm install
npm test          # 即 wdio run wdio.conf.js
```

## 冒烟覆盖

0. 自愈清理:搜索并删除上次运行残留的同名测试卡片
1. 启动 → 品牌「灵感便签」可见
2. FAB 新建待办 → 编辑器填标题 + 回车加 2 条待办 → 关闭
3. 搜索定位新卡 → 勾选一项 → 进度 0/2 → 1/2
4. 日历:选"今天"仍可见 → "清除筛选"恢复
5. 删除该卡(确认弹窗) → 列表为空态 → 清空搜索(自清理)

## 常见问题(均已内置处理,供排查参考)

| 现象 | 原因 | 现状/解决 |
|---|---|---|
| webview 白屏,DOM 为 `<body></body>` | 直接 `cargo build` 的 debug 版不带 custom-protocol,会去连 devUrl | 配置已改用 `npx tauri build --debug --no-bundle`(内嵌产物) |
| 页面停在 about:blank | chromedriver 接管 WebView2 时应用初始导航被吞 | conf 的 `before` 钩子显式导航 `http://tauri.localhost/` |
| 连接 4444 超时 | tauri-driver 未装/未就绪 | 重跑前置安装;配置已改为轮询端口(15s) |
| `can not find binary msedgedriver.exe in the PATH` | msedgedriver-tool 把驱动解压到了运行目录 | conf 自动探测 e2e/ 与仓库根并 `--native-driver` 传入;也可复制到 `%USERPROFILE%\.cargo\bin` |
| 窗口一闪而过就断言失败 | 旧实例被 single-instance 劫持 | 关闭正在运行的 App 再测 |
| 删除后列表偶尔数秒不刷新 | DevTools 附加时的调度抖动,后端删除已生效 | 用例先等 UI,超时则重载页面从持久化状态断言 |
| 卡片找不到 | 之前失败的运行留下同名脏数据 | 首个用例"自愈清理"会循环删除残留 |
