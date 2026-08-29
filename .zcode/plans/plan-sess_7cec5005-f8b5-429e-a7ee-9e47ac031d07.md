## 目标

待办编辑器（`NoteEditor.vue`）三条改进：
1. **"+ 添加待办"输入框固定在编辑器底部**，待办项再多也始终可见
2. **隐藏滚动条**（滚轮/触摸板滚动照常，只是不显示滚动条 UI）
3. **统一编辑器四个圆角**：面板四角始终保持 `--radius-l` 一致，不再因滚动/滚动条出现直角或被裁切

## 现状问题

- `.editor` 整个面板 `overflow-y: auto`：标题、待办列表、输入框一起滚 → 项多时输入框滚出视野
- 滚动条占据面板右缘，把右侧两个圆角"顶掉"，且滚动时内容边缘让底部两角看起来是直角

## 修改内容（仅 `src/components/NoteEditor.vue`）

**1. 布局重构（编辑器分三段：固定头部 / 可滚动列表 / 固定底部输入框）**
```
.editor            display:flex; flex-direction:column; max-height:80vh;
                   overflow:hidden  ← 面板自身不再滚动,四角圆角恒定
  ├ .toolbar       固定(flex:none)
  ├ .title-input   固定(flex:none)
  ├ .todo-list     新增包裹层: flex:1; min-height:0; overflow-y:auto ← 只有待办项列表滚动
  │   └ .item-row × N
  └ .new-item      固定底部(flex:none),脱离滚动流,始终贴底可见
```
- 模板：给 `v-for` 的待办项外面包一层 `<div class="todo-list">`；`.new-item` 移到 `.todo-list` 外（仍在 `.todo-editor` 内）
- 笔记型（`content-input` textarea）不受影响：面板 overflow 改 hidden 后其 `resize: vertical` 可能溢出，改为 `flex:1; min-height:220px; resize:none` 顺带修正

**2. 隐藏滚动条（作用于新的 `.todo-list`）**
```css
.todo-list { scrollbar-width: none; }        /* 标准 */
.todo-list::-webkit-scrollbar { display: none; }  /* WebView2/Chromium */
```

**3. 圆角统一**
- `.editor` 保留 `border-radius: var(--radius-l)`，因 `overflow: hidden`，滚动内容与隐藏的滚动条都不会再破坏四角

**4. 新增待办后自动滚到底部**
- 输入框固定后，新项追加在列表末尾；在 `addOnEnter()` 里 `nextTick` 后把 `.todo-list` 的 `scrollTop` 设为 `scrollHeight`，保证回车后新项立即可见（与"输入框贴底"的体验一致）

## 不改动
- 工具栏、颜色点、删除按钮等其余 UI；App.vue/NoteWindowApp.vue 调用方式

## 验证
- `npm run build` 通过
- 本机验证：创建待办 → 添加 15+ 项：输入框始终贴底、列表滚动无滚动条、面板四角圆角一致；回车添加后列表自动滚到最新项
