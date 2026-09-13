// 提醒音效:运行时合成双音提示音(880Hz → 1175Hz,平方衰减包络),不打包音频资源文件。
// 在后端提醒线程播放而非前端 Web Audio:主窗口收进托盘隐藏后 WebView 可能被节流,
// 后端播放保证"应用关闭到托盘仍驻留"的场景下音效与系统通知同样可靠。

use rodio::{OutputStream, Sink, buffer::SamplesBuffer};

const SAMPLE_RATE: u32 = 44_100;

pub fn play_chime() -> Result<(), String> {
    let mut samples: Vec<f32> = Vec::with_capacity((SAMPLE_RATE as f32 * 0.9) as usize);
    for &freq in &[880.0f32, 1_174.7] {
        let dur = 0.45f32;
        let n = (SAMPLE_RATE as f32 * dur) as usize;
        for i in 0..n {
            let t = i as f32 / SAMPLE_RATE as f32;
            let envelope = (1.0 - t / dur).powi(2);
            samples.push((2.0 * std::f32::consts::PI * freq * t).sin() * envelope * 0.35);
        }
    }

    // stream 必须活到播放结束(句柄绑定到 _stream):在提醒线程上阻塞播完(约 0.9 秒,15 秒的扫描周期内无碍)
    let (_stream, handle) = OutputStream::try_default().map_err(|e| e.to_string())?;
    let sink = Sink::try_new(&handle).map_err(|e| e.to_string())?;
    sink.append(SamplesBuffer::new(1, SAMPLE_RATE, samples));
    sink.sleep_until_end();
    Ok(())
}
