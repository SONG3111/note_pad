// 灵感便签 E2E 冒烟:启动 → 建待办 → 勾选 → 搜索 → 日历筛选 → 删除(自清理)。
// 测试数据全部走 UI 创建并删除,不直接触碰用户数据库。
import assert from "node:assert/strict";

const TITLE = "E2E 冒烟测试待办";

// 应用支持中英双语,断言一律用 data-testid/类名定位,不依赖界面语言
const BRAND_NAMES = ["灵感便签", "Inkling Notes"];

describe("灵感便签 冒烟", () => {
  it("自愈:清理上次运行残留的同名测试卡片", async () => {
    await $(".brand").waitForExist({ timeout: 20000 });
    await $(".search").setValue(TITLE);
    // 循环删除残留(上次运行中断时可能留下未清理的卡),最多 5 张
    for (let i = 0; i < 5; i++) {
      const leftover = await $(".card");
      if (!(await leftover.isExisting())) break;
      await leftover.moveTo();
      await leftover.$(".icon-btn.danger").click();
      const confirm = await $(".dialog .d-btn.danger");
      await confirm.waitForExist({ timeout: 5000 });
      await confirm.click();
      // 等 confirmId 复位、弹窗关闭再继续下一轮
      await $(".dialog").waitForExist({ timeout: 5000, reverse: true });
    }
    await $(".search").setValue("");
  });

  it("启动后主界面可见", async () => {
    const brand = await $(".brand");
    await brand.waitForExist({ timeout: 20000 });
    const brandText = await brand.getText();
    assert.ok(
      BRAND_NAMES.includes(brandText),
      `品牌名不在支持的语言集合内:${brandText}`
    );
  });

  it("FAB 新建待办,编辑器内填标题并添加 2 条待办", async () => {
    await $(".fab-main").click();
    await $(".fab-opt.todo").waitForExist({ timeout: 5000 });
    await $(".fab-opt.todo").click();

    await $(".editor").waitForExist({ timeout: 5000 });
    await $(".title-input").setValue(TITLE);
    for (const text of ["买牛奶", "还书"]) {
      await $(".new-item").setValue(text);
      await browser.keys("Enter");
    }
    const rows = await $$(".editor .item-row");
    assert.equal(rows.length, 2);

    await $(".tool-btn.close").click();
    await $(".editor").waitForExist({ timeout: 5000, reverse: true });
  });

  it("搜索定位到新卡片,勾选一项后进度变 1/2", async () => {
    await $(".search").setValue(TITLE);
    const card = await $(".card");
    await card.waitForExist({ timeout: 5000 });
    assert.equal(await card.$(".title").getText(), TITLE);

    const progress = await card.$(".progress-text").getText();
    assert.equal(progress, "0/2");

    // cb-input 是 opacity:0 的覆盖层,驱动会拒绝点击;点可见的 label 同样触发 change
    await card.$(".cb-wrap").click();
    await browser.waitUntil(
      async () => (await $(".progress-text").getText()) === "1/2",
      { timeout: 5000, timeoutMsg: "勾选后进度未变为 1/2" }
    );
  });

  it("日历筛选:选今天仍可见,清除筛选后恢复", async () => {
    await $(".dp-btn").click();
    await $(".dp-panel").waitForExist({ timeout: 5000 });
    await $('[data-testid="dp-today"]').click();
    // 该卡创建于今天,筛选后仍应可见
    await $(".card").waitForExist({ timeout: 5000 });

    await $(".dp-btn").click();
    await $(".dp-panel").waitForExist({ timeout: 5000 });
    await $('[data-testid="dp-clear"]').click();
    await $(".card").waitForExist({ timeout: 5000 });
  });

  it("删除测试卡片(确认弹窗),自清理完成", async () => {
    const card = await $(".card");
    // 卡片操作按钮悬停才显示,先把指针移到卡片上
    await card.moveTo();
    await card.$(".icon-btn.danger").click();
    const confirm = await $(".dialog .d-btn.danger");
    await confirm.waitForExist({ timeout: 5000 });
    await confirm.click();

    // DevTools 附加时 UI 刷新偶发秒级抖动:先等列表消失;
    // 超时则重载页面,从持久化状态验证删除已生效
    try {
      await $(".card").waitForExist({ timeout: 8000, reverse: true });
    } catch {
      await browser.url("http://tauri.localhost/");
      await $(".brand").waitForExist({ timeout: 15000 });
      await $(".search").setValue(TITLE);
    }
    await browser.waitUntil(async () => !(await $(".card").isExisting()), {
      timeout: 8000,
      timeoutMsg: "删除后仍能搜到该卡片",
    });
    await $(".empty").waitForExist({ timeout: 5000 });

    // 清空搜索,不留筛选痕迹
    await $(".search").setValue("");
  });
});
