// Vitest 全局环境垫片:jsdom 缺 Tauri 注入与部分 Web API,这里补齐。
import { vi } from "vitest";

type TauriInternals = {
  invoke: ReturnType<typeof vi.fn>;
  transformCallback: (cb: unknown) => number;
  _nextCbId: number;
  metadata: { currentWindow: { label: string }; currentWebview: { label: string } };
};

function tauriInternalsWindow(): Window & { __TAURI_INTERNALS__?: TauriInternals } {
  return window as Window & { __TAURI_INTERNALS__?: TauriInternals };
}

// Tauri IPC 注入点(@tauri-apps/api/core 的 invoke 走这里)。
// 具体命令行为由各测试用 mockIPC/vi.mock 自行定义,这里只保证结构存在。
if (!tauriInternalsWindow().__TAURI_INTERNALS__) {
  tauriInternalsWindow().__TAURI_INTERNALS__ = {
    invoke: vi.fn(),
    transformCallback: vi.fn((cb: unknown) => {
      const internals = tauriInternalsWindow().__TAURI_INTERNALS__!;
      const id = internals._nextCbId++;
      (window as unknown as Record<string, unknown>)[`_${id}`] = cb;
      return id;
    }),
    _nextCbId: 0,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
  };
}

// jsdom 未实现 matchMedia(celebrate/sound/组件按偏好降级时会调用)
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// sound.ts 在勾选音效里 new AudioContext();jsdom 没有音频设备,给个最小桩
if (!(window as unknown as { AudioContext?: unknown }).AudioContext) {
  class FakeAudioContext {
    sampleRate = 44100;
    currentTime = 0;
    destination = {};
    state = "running";
    createOscillator() {
      return {
        type: "sine",
        frequency: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
    }
    createGain() {
      return {
        gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      };
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
}
