## 问题诊断

1. **日历面板显示不全**：主窗口固定 400px 宽。日历按钮在页签右侧（x≈150 起），面板 259px 宽从按钮处 `left:0` **向右**展开 → 右边缘伸出窗口外约 10~40px 被裁掉
2. **按钮位置**：单独占一格挤压搜索框宽度，且视觉上突兀

## 参照 skills/ 规范的整改方案

skills/ 下有 4 份设计工程规范（apple-design、emil-design-eng、animation-vocabulary、review-animations），与本问题直接相关的条款：
- **弹层必须 origin-aware**：从触发器方向缩放（`transform-origin: top right`），不得从中心
- 下拉类时长 150-250ms + 强 ease-out；禁止从 `scale(0)` 出现（0.95-0.97 起步）
- 可按压元素必须有 `:active` 缩放反馈；reduced-motion 时降级为仅透明度过渡

### 布局（窗口 400×720 不变）

- 日历按钮**收进搜索框右端内部**（Linear/Notion 的"筛选入口在搜索条内"模式）：
  - 页签、搜索框宽度都不被挤压（旧方案插入独立按钮会吃掉 32px+gap，搜索框只剩 ~90px）
  - 按钮天然靠右 → 面板锚定 `right: 0` **向左展开**，右缘与搜索框对齐（≈窗口内 382px 处），259px 宽完整落在窗口内
  - `.search` 输入框加 `padding-right: 42px` 防止文字压住图标
- 添加按钮（FAB）、页签布局无需变动

### 动效与细节（按 skills 修正）

| 项 | Before | After |
|---|---|---|
| 面板展开 | `translateY(-4px)` + 0.15s | `scale(0.96)→1` + opacity，`transform-origin: top right`，0.16s 强 ease-out |
| 按压反馈 | dp-btn/nav/act 无 `:active` | `:active { transform: scale(0.94-0.96) }`，0.12s |
| reduced-motion | 未处理 | 面板动画降级为仅 opacity |
| 按钮样式 | 32px 带边框独立按钮 | 28px 无边框图标按钮（hover 出浅底），激活态 accent-soft 底 + 勾标 |

### 修改文件
- `src/components/DatePicker.vue`：根节点改为绝对定位于搜索框内右端；面板右锚定 + origin-aware 动画 + `:active` 反馈 + reduced-motion 降级
- `src/App.vue`：`<DatePicker />` 移入 `.search-wrap` 内部；`.search` 加 `padding-right`

## 验证
- `npm run build` 通过
- 400px 窗口内：面板完整可见、不遮搜索文字；筛选激活态清晰；按压/悬停反馈符合 skills 标准
