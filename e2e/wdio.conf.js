// 灵感便签 E2E 配置:tauri-driver + WebdriverIO(Windows/WebView2)。
// 前置条件见 e2e/README.md:cargo install tauri-driver、msedgedriver-tool、关闭正在运行的 App。
import { spawn, spawnSync } from "child_process";
import path from "node:path";
import fs from "node:fs";
import net from "node:net";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_EXE = path.resolve(__dirname, "../src-tauri/target/debug/note_pad.exe");

// tauri-driver 需要 msedgedriver.exe 在 PATH 中,或用 --native-driver 指定路径。
// msedgedriver-tool 会把驱动解压到运行目录(e2e/ 或仓库根),这里自动探测。
function msEdgeDriverArgs() {
  const candidates = [
    path.join(__dirname, "msedgedriver.exe"),
    path.resolve(__dirname, "../msedgedriver.exe"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return ["--native-driver", p];
  }
  return []; // 已在 PATH 中(msedgedriver-tool 常规安装位)
}

let tauriDriver;

export const config = {
  hostname: "127.0.0.1",
  port: 4444,
  specs: ["./specs/**/*.spec.js"],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "wry",
      "tauri:options": { application: APP_EXE },
    },
  ],
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 60000 },

  // WebView2 在 chromedriver 接管时可能停在 about:blank(应用自身的初始导航被吞掉),
  // 这里显式导航到 Tauri 自定义协议地址,等主界面就绪后再跑用例
  before: async () => {
    await browser.url("http://tauri.localhost/");
    await $(".brand").waitForExist({ timeout: 20000 });
  },

  // 关键:必须用 tauri build --debug(启用 custom-protocol,内嵌前端产物)。
  // 直接 cargo build 的 debug 版不带该特性,会去连 devUrl,webview 里是白屏。
  // --no-bundle 跳过安装包打包,E2E 只需要 exe。
  onPrepare: () => {
    const result = spawnSync("npx tauri build --debug --no-bundle", {
      cwd: path.resolve(__dirname, ".."),
      stdio: "inherit",
      shell: true,
    });
    if (result.status !== 0) throw new Error("tauri build --debug 失败,无法进行 E2E 测试");
  },

  beforeSession: () => {
    tauriDriver = spawn("tauri-driver", msEdgeDriverArgs(), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    tauriDriver.stderr.on("data", (data) => process.stderr.write(data));
    // 轮询端口而非匹配 stdout 文案(tauri-driver 各版本就绪提示不一致)
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const probe = () => {
        const sock = net.connect(4444, "127.0.0.1");
        sock.once("connect", () => {
          sock.destroy();
          resolve();
        });
        sock.once("error", () => {
          sock.destroy();
          if (Date.now() - started > 15000) {
            reject(new Error("tauri-driver 15s 内未监听 4444"));
          } else {
            setTimeout(probe, 250);
          }
        });
      };
      probe();
    });
  },

  afterSession: () => {
    tauriDriver?.kill();
  },
};
