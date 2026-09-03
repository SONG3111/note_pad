import { afterEach, describe, expect, it } from "vitest";
import { resolveInitialLocale } from "../composables/useLocale";
import { LOCALE_STORAGE_KEY } from "../i18n";

// jsdom 的 navigator.language 默认 "en-US",用 defineProperty 临时改写以模拟系统语言
function stubNavigatorLanguage(lang: string) {
  Object.defineProperty(window.navigator, "language", {
    value: lang,
    configurable: true,
  });
}

afterEach(() => {
  localStorage.removeItem(LOCALE_STORAGE_KEY);
  stubNavigatorLanguage("en-US");
});

describe("resolveInitialLocale", () => {
  it("localStorage 持久值优先于系统语言", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "en-US");
    stubNavigatorLanguage("zh-CN");
    expect(resolveInitialLocale()).toBe("en-US");

    localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    stubNavigatorLanguage("en-US");
    expect(resolveInitialLocale()).toBe("zh-CN");
  });

  it("无持久值时:zh 开头的系统语言 → 中文", () => {
    stubNavigatorLanguage("zh-CN");
    expect(resolveInitialLocale()).toBe("zh-CN");

    stubNavigatorLanguage("zh-TW");
    expect(resolveInitialLocale()).toBe("zh-CN");
  });

  it("无持久值时:非 zh 系统语言 → 英文", () => {
    stubNavigatorLanguage("en-US");
    expect(resolveInitialLocale()).toBe("en-US");

    stubNavigatorLanguage("ja-JP");
    expect(resolveInitialLocale()).toBe("en-US");
  });

  it("非法持久值被忽略,回退系统语言", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "fr-FR");
    stubNavigatorLanguage("zh-CN");
    expect(resolveInitialLocale()).toBe("zh-CN");
  });
});
