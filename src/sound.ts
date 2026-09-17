// 手账音效(勾选 / 撕纸手势):Web Audio 实时合成,不打包音频文件。
// AudioContext 在首次用户交互(勾选 / 拖动本身)时创建,满足浏览器自动播放策略。

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

// ─── 撕纸手势音效 ───
// 纸是纤维,折痕/撕裂天然是宽频噪声,振荡器拟不出来——
// 全部由白噪声 + 滤波实时合成,三个声音对应手势三段:
// 起折(嚓)→ 撕离(胶带"啪" + 纸"刺啦")→ 平复/落回(嗒)。
// 音量与勾选音(peak 0.12)同一量级,克制、不抢戏。

/** 白噪声缓冲(单例复用,0.3s 覆盖最长的撕裂尾音) */
let noiseBuf: AudioBuffer | null = null;

function ensureNoise(ac: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    const len = Math.floor(ac.sampleRate * 0.3);
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** 一次滤波噪声:频率从 from 指数滑向 to;attack 极短时是"啪"的瞬时起音 */
function noise(
  ac: AudioContext,
  opts: {
    at: number;
    dur: number;
    peak: number;
    type: BiquadFilterType;
    from: number;
    to: number;
    q?: number;
    attack?: number;
  }
) {
  const t = ac.currentTime + opts.at;
  const src = ac.createBufferSource();
  src.buffer = ensureNoise(ac);
  const filter = ac.createBiquadFilter();
  filter.type = opts.type;
  filter.Q.value = opts.q ?? 0.8;
  filter.frequency.setValueAtTime(opts.from, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.to), t + opts.dur);
  const gain = ac.createGain();
  const attack = opts.attack ?? 0.006;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(opts.peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur + 0.025);
  src.connect(filter).connect(gain).connect(ac.destination);
  // 随机缓冲起点:同一手势反复听不机械
  src.start(t, Math.random() * 0.1);
  src.stop(t + opts.dur + 0.06);
}

/// 起折:纸面被折起的轻"嚓"——高通噪声快速衰减,轻到近乎触觉反馈;
/// 折角首次出现时响一次,方向回摆重折不重复响
export function playFoldCreaseSound() {
  try {
    const ac = ensureCtx();
    noise(ac, { at: 0, dur: 0.05, peak: 0.045, type: "highpass", from: 2600, to: 900 });
  } catch {}
}

/// 撕离:胶带从纸面崩脱的一记"啪"——瞬时起音的带通噪声向低频快速滑落,
/// 短促干脆,不带撕裂尾音
export function playTearOffSound() {
  try {
    const ac = ensureCtx();
    noise(ac, { at: 0, dur: 0.05, peak: 0.2, type: "bandpass", from: 2600, to: 500, q: 0.7, attack: 0.001 });
  } catch {}
}

/// 平复/弹回:纸拍回手账面的轻"嗒"——低通噪声 + 低频短音,把手势收住
export function playPaperSettleSound() {
  try {
    const ac = ensureCtx();
    noise(ac, { at: 0, dur: 0.06, peak: 0.05, type: "lowpass", from: 900, to: 300 });
    blip(ac, { at: 0, from: 150, to: 95, dur: 0.05, peak: 0.04 });
  } catch {}
}
