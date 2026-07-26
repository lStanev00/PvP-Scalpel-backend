mod contract;
mod engine;
mod guard;
mod mp4;
mod timeline;

use contract::{RecoveryMethod, RecoveryResultV2, RecoveryStats};
use engine::{Capabilities, Method, OperationalError, Outcome};
use std::env;
use std::path::Path;
use std::process::ExitCode;

const VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("media-recovery: {error}");
            ExitCode::from(error.exit_code())
        }
    }
}

fn run() -> Result<(), CommandError> {
    let arguments: Vec<String> = env::args().collect();
    match arguments.as_slice() {
        [_, flag] if flag == "--version" => {
            println!("media-recovery {VERSION}");
            Ok(())
        }
        [_, flag] if flag == "--capabilities" => {
            let capabilities = engine::capabilities().map_err(CommandError::Engine)?;
            print_capabilities(&capabilities)?;
            Ok(())
        }
        [_, command, media_id, input, output] if command == "recover" => {
            let paths = guard::validate_paths(media_id, Path::new(input), Path::new(output))
                .map_err(CommandError::UnsafePath)?;
            let outcome = engine::recover(&paths).map_err(CommandError::Engine)?;
            print_outcome(outcome)?;
            Ok(())
        }
        _ => Err(CommandError::Usage(
            "usage: media-recovery recover <media-id> <input> <output>".into(),
        )),
    }
}

fn print_outcome(outcome: Outcome) -> Result<(), CommandError> {
    let stats = RecoveryStats {
        source_duration_ms: outcome.stats.source_duration_ms,
        output_duration_ms: outcome.stats.output_duration_ms,
        expected_video_frames: outcome.stats.expected_video_frames,
        decoded_video_frames: outcome.stats.decoded_video_frames,
        good_video_frames: outcome.stats.good_video_frames,
        output_video_frames: outcome.stats.output_video_frames,
        duplicated_video_frames: outcome.stats.duplicated_video_frames,
        corrupt_video_frames: outcome.stats.corrupt_video_frames,
        removed_video_frames: outcome.stats.removed_video_frames,
        removed_timeline_ms: outcome.stats.removed_timeline_ms,
        trimmed_leading_ms: outcome.stats.trimmed_leading_ms,
        trimmed_trailing_ms: outcome.stats.trimmed_trailing_ms,
        longest_duplicated_run_ms: outcome.stats.longest_duplicated_run_ms,
        longest_removed_run_ms: outcome.stats.longest_removed_run_ms,
        inserted_audio_silence_ms: outcome.stats.inserted_audio_silence_ms,
        strict_validation_passed: outcome.stats.strict_validation_passed,
    };
    let result = if outcome.succeed {
        RecoveryResultV2::success(
            engine::engine_version(),
            map_method(
                outcome
                    .method
                    .ok_or_else(|| CommandError::Contract("success has no method".into()))?,
            ),
            outcome.reason,
            outcome.video_ratio,
            outcome.audio_ratio,
            stats,
        )
    } else {
        RecoveryResultV2::rejected(
            engine::engine_version(),
            outcome.reason,
            outcome.video_ratio,
            outcome.audio_ratio,
            stats,
        )
    };
    let json = serde_json::to_string(&result)
        .map_err(|error| CommandError::Contract(format!("failed to serialize result: {error}")))?;
    println!("{json}");
    Ok(())
}

fn map_method(method: Method) -> RecoveryMethod {
    match method {
        Method::Structural => RecoveryMethod::Structural,
        Method::FrameReconstruction => RecoveryMethod::FrameReconstruction,
    }
}

fn print_capabilities(capabilities: &Capabilities) -> Result<(), CommandError> {
    let value = serde_json::json!({
        "engineVersion": engine::engine_version(),
        "mp4Demuxer": capabilities.mp4_demuxer,
        "mp4Muxer": capabilities.mp4_muxer,
        "h264Decoder": capabilities.h264_decoder,
        "libx264Encoder": capabilities.libx264_encoder,
        "aacEncoder": capabilities.aac_encoder,
        "scaling": capabilities.scaling,
        "resampling": capabilities.resampling,
    });
    let json = serde_json::to_string(&value).map_err(|error| {
        CommandError::Contract(format!("failed to serialize capabilities: {error}"))
    })?;
    println!("{json}");
    Ok(())
}

#[derive(Debug)]
enum CommandError {
    Usage(String),
    UnsafePath(String),
    Engine(OperationalError),
    Contract(String),
}

impl CommandError {
    fn exit_code(&self) -> u8 {
        match self {
            Self::Usage(_) => 2,
            Self::UnsafePath(_) => 3,
            Self::Engine(_) => 5,
            Self::Contract(_) => 6,
        }
    }
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Usage(message) | Self::UnsafePath(message) | Self::Contract(message) => {
                formatter.write_str(message)
            }
            Self::Engine(error) => std::fmt::Display::fmt(error, formatter),
        }
    }
}
