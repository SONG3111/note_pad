// 提醒音效:运行时合成双音提示音(880Hz → 1175Hz,平方衰减包络),不打包音频资源文件。
// 在后端提醒线程播放而非前端 Web Audio:主窗口收进托盘隐藏后 WebView 可能被节流,
// 后端播放保证"应用关闭到托盘仍驻留"的场景下音效与系统通知同样可靠。

use rodio::{OutputStream, Sink, buffer::SamplesBuffer};

const SAMPLE_RATE: u32 = 44_100;

/// 双音提示音样本(880Hz → 1175Hz 正弦,平方衰减包络):纯函数,便于单测幅度与时长
fn chime_samples() -> Vec<f32> {
    let mut samples = Vec::with_capacity((SAMPLE_RATE as f32 * 0.9) as usize);
    for &freq in &[880.0f32, 1_174.7] {
        let dur = 0.45f32;
        let n = (SAMPLE_RATE as f32 * dur) as usize;
        for i in 0..n {
            let t = i as f32 / SAMPLE_RATE as f32;
            let envelope = (1.0 - t / dur).powi(2);
            samples.push((2.0 * std::f32::consts::PI * freq * t).sin() * envelope * 0.35);
        }
    }
    samples
}

pub fn play_chime() -> Result<(), String> {
    // stream 必须活到播放结束(句柄绑定到 _stream):在提醒线程上阻塞播完(约 0.9 秒,15 秒的扫描周期内无碍)
    let (_stream, handle) = OutputStream::try_default().map_err(|e| e.to_string())?;
    let sink = Sink::try_new(&handle).map_err(|e| e.to_string())?;
    sink.append(SamplesBuffer::new(1, SAMPLE_RATE, chime_samples()));
    sink.sleep_until_end();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chime_is_two_450ms_segments_with_peak_below_full_scale() {
        let samples = chime_samples();
        // 两段各 0.45s,合计约 0.9s @ 44.1kHz(留 ±1 样本的取整余量)
        let expected = (SAMPLE_RATE as f32 * 0.9) as usize;
        assert!((samples.len() as i64 - expected as i64).abs() <= 1);
        // 峰值:0.35 增幅 × 包络 ≤ 1,不得削波;首段包络起点为 1,峰值应恰在 0.35 附近
        let peak = samples.iter().fold(0.0f32, |m, s| m.max(s.abs()));
        assert!(peak > 0.3 && peak <= 0.36, "peak = {peak}");
        // 首样本为 0(相位从 0 开始),避免段落起点爆音
        assert_eq!(samples[0], 0.0);
    }
}
