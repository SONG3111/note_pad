// 待办勾选音效:Web Audio 实时合成,不打包音频文件。
// AudioContext 在首次用户点击(即勾选动作本身)时创建,满足浏览器自动播放策略。

let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function blip(
  ac: AudioContext,
  opts: { at: number; from: number; to: number; dur: number; peak: number; type?: OscillatorType }
) {
  const t = ac.currentTime + opts.at;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(opts.from, t);
  osc.frequency.exponentialRampToValueAtTime(opts.to, t + opts.dur);
  // 包络:1~2ms 内起音防爆音,随后指数衰减到静音
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(opts.peak, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur + 0.03);
  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + opts.dur + 0.05);
}

/// 勾选:900→1400Hz 上扬的清脆短音;复用单例 AudioContext,避免每次勾选新建上下文
export function playCheckSound() {
  try {
    const ac = ensureCtx();
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(900, t);
    osc.frequency.exponentialRampToValueAtTime(1400, t + 0.06);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  } catch {
    // 音效非核心功能,音频不可用时静默降级
  }
}

/// 取消勾选:低音量短促轻响,与勾选形成方向对比
export function playUncheckSound() {
  try {
    const ac = ensureCtx();
    blip(ac, { at: 0, from: 240, to: 140, dur: 0.06, peak: 0.08 });
  } catch {}
}

/// 全部完成:上行三音琶音(G5→B5→E6),比单击勾选更隆重但依然克制,
/// 与勾选音叠加时形成"叮—叮叮叮"的小节奏
export function playAllDoneSound() {
  try {
    const ac = ensureCtx();
    blip(ac, { at: 0, from: 784, to: 784, dur: 0.1, peak: 0.09 });
    blip(ac, { at: 0.09, from: 988, to: 988, dur: 0.1, peak: 0.09 });
    blip(ac, { at: 0.18, from: 1319, to: 1319, dur: 0.22, peak: 0.11 });
  } catch {}
}
