// voice.rs
//
// Copyright (c) 2026 braids contributors
//
// braids is distributed under the GNU AGPL v3 license, see LICENSE for details.

//! Voice message recording: the default microphone to an Ogg/Opus file (the
//! format messengers use for voice notes) with GStreamer, which WebKitGTK
//! already depends on. While recording, the input level is sent to the UI as
//! `voice-level` events (0..1). Linux only for now.

#[cfg(target_os = "linux")]
mod imp {
    use gstreamer as gst;
    use gstreamer::prelude::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    pub struct Recording {
        pipeline: gst::Element,
        path: PathBuf,
        started: Instant,
        done: mpsc::Receiver<Result<(), String>>,
        stop: Arc<AtomicBool>,
    }

    static CURRENT: Mutex<Option<Recording>> = Mutex::new(None);

    /// Starts recording from `source` (a GStreamer source description, e.g.
    /// "autoaudiosrc") into `path`; `on_level` gets the input level (0..1).
    pub fn start(source: &str, path: PathBuf, on_level: impl Fn(f64) + Send + 'static) -> Result<(), String> {
        let mut current = CURRENT.lock().unwrap();
        if current.is_some() {
            return Err("already recording".into());
        }

        gst::init().map_err(|e| format!("GStreamer is not available: {e}"))?;
        let description = format!(
            "{source} ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=1 ! \
             level name=level interval=100000000 post-messages=true ! \
             opusenc bitrate=32000 ! oggmux ! filesink name=sink"
        );
        let pipeline = gst::parse::launch(&description).map_err(|e| {
            format!("Recording needs GStreamer's audio plugins (gstreamer1.0-plugins-base and -good): {e}")
        })?;
        let bin = pipeline.clone().downcast::<gst::Bin>().map_err(|_| "unexpected pipeline".to_string())?;
        let sink = bin.by_name("sink").ok_or("no file sink")?;
        sink.set_property("location", path.to_string_lossy().to_string());

        let bus = pipeline.bus().ok_or("no bus")?;
        let (tx, rx) = mpsc::channel();
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = stop.clone();
        std::thread::spawn(move || {
            // level messages until end of stream or an error
            while !stop_flag.load(Ordering::Relaxed) {
                let Some(msg) = bus.timed_pop(gst::ClockTime::from_mseconds(100)) else { continue };
                match msg.view() {
                    gst::MessageView::Eos(_) => {
                        let _ = tx.send(Ok(()));
                        return;
                    }
                    gst::MessageView::Error(err) => {
                        let _ = tx.send(Err(format!("Recording failed: {}", err.error())));
                        return;
                    }
                    gst::MessageView::Element(el) => {
                        if let Some(s) = el.structure() {
                            if s.name() == "level" {
                                if let Ok(rms) = s.get::<glib_value_array::ValueArray>("rms") {
                                    if let Some(db) = rms.first().and_then(|v| v.get::<f64>().ok()) {
                                        // -50 dB .. 0 dB to 0..1
                                        on_level(((db + 50.0) / 50.0).clamp(0.0, 1.0));
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        });

        pipeline
            .set_state(gst::State::Playing)
            .map_err(|_| "The microphone could not be opened.".to_string())?;
        *current = Some(Recording { pipeline, path, started: Instant::now(), done: rx, stop });
        Ok(())
    }

    /// Stops the recording: the file (complete, with its Ogg trailer) and the
    /// duration in ms; with `cancel` the file is deleted and None returned.
    pub fn stop(cancel: bool) -> Result<Option<(PathBuf, u64)>, String> {
        let Some(rec) = CURRENT.lock().unwrap().take() else { return Ok(None) };
        let duration = rec.started.elapsed().as_millis() as u64;
        rec.pipeline.send_event(gst::event::Eos::new());
        let result = rec.done.recv_timeout(Duration::from_secs(5)).unwrap_or(Ok(()));
        rec.stop.store(true, Ordering::Relaxed);
        let _ = rec.pipeline.set_state(gst::State::Null);
        if cancel {
            let _ = std::fs::remove_file(&rec.path);
            return Ok(None);
        }
        result?;
        Ok(Some((rec.path, duration)))
    }

    // the "rms" field of level messages is a GValueArray
    mod glib_value_array {
        pub use gstreamer::glib::ValueArray;
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn records_ogg_opus() {
            // skipped where GStreamer or its plugins are not installed
            if gst::init().is_err()
                || ["audiotestsrc", "opusenc", "oggmux", "level"].iter().any(|f| gst::ElementFactory::find(f).is_none())
            {
                eprintln!("GStreamer plugins missing, test skipped");
                return;
            }
            let path = std::env::temp_dir().join(format!("braids-voice-test-{}.ogg", std::process::id()));
            let levels = Arc::new(Mutex::new(Vec::new()));
            let l = levels.clone();
            start("audiotestsrc is-live=true freq=440", path.clone(), move |v| l.lock().unwrap().push(v)).unwrap();
            std::thread::sleep(Duration::from_millis(1500));
            let (file, ms) = stop(false).unwrap().unwrap();
            let data = std::fs::read(&file).unwrap();
            // a sample for other tests (e.g. BRAIDS_VOICE_SAMPLE=lib/mxchat/go/testdata/voice.ogg)
            if let Ok(keep) = std::env::var("BRAIDS_VOICE_SAMPLE") {
                let _ = std::fs::copy(&file, keep);
            }
            let _ = std::fs::remove_file(&file);
            assert!(ms >= 500, "duration {ms}");
            assert_eq!(&data[..4], b"OggS", "an Ogg file");
            assert!(data.windows(8).any(|w| w == b"OpusHead"), "Opus inside");
            assert!(!levels.lock().unwrap().is_empty(), "levels reported");
        }
    }
}

#[cfg(target_os = "linux")]
pub use imp::{start, stop};

#[cfg(not(target_os = "linux"))]
pub fn start(_source: &str, _path: std::path::PathBuf, _on_level: impl Fn(f64) + Send + 'static) -> Result<(), String> {
    Err("Voice messages can be recorded on Linux only for now.".into())
}

#[cfg(not(target_os = "linux"))]
pub fn stop(_cancel: bool) -> Result<Option<(std::path::PathBuf, u64)>, String> {
    Ok(None)
}
