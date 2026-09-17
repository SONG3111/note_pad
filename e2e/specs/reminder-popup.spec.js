// 独立窗口提醒功能 E2E:建待办 → 拖出为独立便签窗口 → 点铃铛弹出独立提醒小窗 →
// 选择日期写入提醒 → 跨窗口同步回便签窗口(角标出现)→ Escape 关闭小窗 → 清理数据。
// 覆盖面:多窗口句柄路由(main.ts 按 label 分流)、弹窗 ACL(capabilities 覆盖
// reminder-pop-*)、set_todo_reminder 全链路、notes-changed 跨窗口回拉、set_focus 回归。
// 测试数据全部走 UI 创建并删除,不直接触碰用户数据库。
import assert from "node:assert/strict";

const TITLE = "E2E 提醒弹窗测试待办";

describe("独立窗口提醒", () => {
  let mainHandle;
  let noteHandle;
  let popupHandle;

  it("自愈:清理上次运行残留的同名测试卡片", async () => {
    mainHandle = await browser.getWindowHandle();
    await $(".search").setValue(TITLE);
    for (let i = 0; i < 5; i++) {
      if (!(await $(".card").isExisting())) break;
      const before = (await $$(".card")).length;
      const leftover = await $(".card");
      await leftover.moveTo();
      await leftover.$(".icon-btn.danger").click();
      const confirm = await $(".dialog .d-btn.danger");
      await confirm.waitForExist({ timeout: 5000 });
      await confirm.click();
      await $(".dialog").waitForExist({ timeout: 5000, reverse: true });
      // 删除触发的回拉会重渲染列表使旧句柄失效:等卡片数减少后重查再进下一轮
      await browser.waitUntil(
        async () => (await $$(".card")).length < before,
        { timeout: 5000, timeoutMsg: "残留卡片删除未生效" },
      );
    }
    await $(".search").setValue("");
  });

  it("FAB 新建待办:标题 + 1 条待办,关闭编辑器", async () => {
    await $(".fab-main").click();
    await $(".fab-opt.todo").waitForExist({ timeout: 5000 });
    await $(".fab-opt.todo").click();
    await $(".editor").waitForExist({ timeout: 5000 });
    await $(".title-input").setValue(TITLE);
    await $(".new-item").setValue("被提醒的事");
    await browser.keys("Enter");
    await $(".tool-btn.close").click();
    await $(".editor").waitForExist({ timeout: 5000, reverse: true });
  });

  it("拖出为独立便签窗口:窗口创建、内容一致并持有焦点", async () => {
    await $(".search").setValue(TITLE);
    const card = await $(".card");
    await card.waitForExist({ timeout: 5000 });
    await card.moveTo();
    // 卡片操作区:edit(0) / detach(1) / pin(2) / delete(3)
    await (await card.$$(".icon-btn"))[1].click();

    // 后端建窗 label = note-<id>:句柄 1 → 2
    await browser.waitUntil(
      async () => (await browser.getWindowHandles()).length === 2,
      { timeout: 15000, timeoutMsg: "拖出后独立便签窗口未创建" },
    );
    noteHandle = (await browser.getWindowHandles()).find((h) => h !== mainHandle);
    await browser.switchWindow(noteHandle);

    // 窗口隐身创建、首帧绘制完成后才 show;missing 提示不出现 = 笔记加载成功
    await $(".title-input").waitForExist({ timeout: 15000 });
    await browser.waitUntil(
      async () => !(await $(".missing").isExisting()),
      { timeout: 10000, timeoutMsg: "独立便签窗口内容未加载" },
    );
    assert.equal(await $(".title-input").getValue(), TITLE);
    // set_focus 回归:窗口挂载完成即持有焦点。曾因 capabilities 缺
    // core:window:allow-set-focus 而 ACL 静默拒绝,窗口永远不被聚焦
    await browser.waitUntil(
      async () => browser.execute(() => document.hasFocus()),
      { timeout: 5000, timeoutMsg: "独立窗口未获得焦点(set_focus 权限回归)" },
    );
  });

  it("点铃铛:独立提醒小窗弹出,面板可交互(弹窗窗口 ACL 回归)", async () => {
    await $(".rp-btn").waitForExist({ timeout: 5000 });
    await $(".rp-btn").click();
    // 后端建窗 label = reminder-pop-<itemId>:句柄 2 → 3
    await browser.waitUntil(
      async () => (await browser.getWindowHandles()).length === 3,
      { timeout: 15000, timeoutMsg: "提醒弹窗小窗未创建" },
    );
    popupHandle = (await browser.getWindowHandles()).find(
      (h) => h !== mainHandle && h !== noteHandle,
    );
    await browser.switchWindow(popupHandle);
    // 弹窗内 get_todo_item / 面板渲染:若 capability 未覆盖 reminder-pop-*,
    // invoke 全被拒,面板永远出不来
    await $(".rp-panel").waitForExist({ timeout: 15000 });
    await $(".cal-day.today").waitForExist({ timeout: 5000 });
  });

  it("弹窗内选今天:提醒经 set_todo_reminder 跨窗口同步回便签窗口", async () => {
    await $(".cal-day.today").click();
    // 选择即生效且弹窗保留(仅清除才关闭),便于继续微调
    await browser.waitUntil(
      async () => (await browser.getWindowHandles()).length === 3,
      { timeout: 5000, timeoutMsg: "设置提醒后弹窗意外关闭" },
    );

    // 便签窗口收到 notes-changed 广播后回拉,待办行下出现提醒角标
    await browser.switchWindow(noteHandle);
    await $(".reminder-badge").waitForExist({ timeout: 10000 });
  });

  it("Escape 关闭提醒小窗:句柄数回落,便签窗口不受影响", async () => {
    await browser.switchWindow(popupHandle);
    await browser.keys("Escape");
    await browser.waitUntil(
      async () => (await browser.getWindowHandles()).length === 2,
      { timeout: 10000, timeoutMsg: "Escape 后提醒小窗未关闭" },
    );
    await browser.switchWindow(noteHandle);
    await $(".title-input").waitForExist({ timeout: 5000 });
  });

  it("清理:关闭独立窗口并删除测试卡片", async () => {
    // 有内容(标题+待办)的便签关闭即回主界面,不触发空笔记清理
    await $(".tool-btn.close").click();
    await browser.waitUntil(
      async () => (await browser.getWindowHandles()).length === 1,
      { timeout: 10000, timeoutMsg: "关闭后独立便签窗口未销毁" },
    );
    await browser.switchWindow(mainHandle);

    // 搜索仍保留 TITLE 过滤:卡片已从 detached 列表恢复可见,删除它
    await $(".card").waitForExist({ timeout: 10000 });
    const card = await $(".card");
    await card.moveTo();
    await card.$(".icon-btn.danger").click();
    const confirm = await $(".dialog .d-btn.danger");
    await confirm.waitForExist({ timeout: 5000 });
    await confirm.click();
    await browser.waitUntil(
      async () => !(await $(".card").isExisting()),
      { timeout: 10000, timeoutMsg: "测试卡片未删除干净" },
    );
    await $(".search").setValue("");
  });
});
