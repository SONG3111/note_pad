## 目标

产品显示名统一改为中文「灵感便签」；内部英文标识（exe 名 note_pad.exe、identifier、Cargo 包名）保持不变。PublisherDisplayName 改为 **Qulv Studio**（按你的最新要求）。

## 修改清单

1. **src-tauri/tauri.conf.json**：窗口 `title` → `"灵感便签"`（productName/identifier 不变）
2. **src-tauri/src/lib.rs**（已扫描，仅 3 处）：L78 `.title("灵感便签")`；L235 `"退出灵感便签"`；L240 `.tooltip("灵感便签")`
3. **index.html**：`<title>灵感便签</title>`
4. **scripts/build-msix.ps1**：
   - `<DisplayName>灵感便签</DisplayName>`、`VisualElements DisplayName="灵感便签"`
   - `Description` → `"轻量级便签与待办应用，支持边缘贴靠。"`
   - `<PublisherDisplayName>Qulv Studio</PublisherDisplayName>`
   - 头部注释更新：含中文，必须 UTF-8 with BOM 保存
   - 打包后加防乱码自检（Select-String 校验清单含「灵感便签」，否则 throw）
   - 编辑完成后为 .ps1 补写 UTF-8 BOM
   - `$AppExeName` 保持 note_pad.exe；签名证书/Identity 相关不动
5. **docs/方案/MSIX打包与上架速查.md**：轻量说明「显示名中文、内部标识英文」

## 验证
- 全量 `grep "note pad\|Note Pad"` 残留检查（排除有意保留的内部标识）
- 确认 build-msix.ps1 头部为 UTF-8 BOM
- 你本机验证：`npm run tauri dev` 看标题/托盘；重跑 build-msix.ps1 后安装看开始菜单显示名
