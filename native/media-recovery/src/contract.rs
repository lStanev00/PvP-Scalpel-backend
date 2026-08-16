use serde::{Deserialize, Serialize};

pub const RECOVERY_RESULT_VERSION: u32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryMethod {
    Structural,
    FrameReconstruction,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryStats {
    #[serde(rename = "sourceDurationMs")]
    pub source_duration_ms: u64,
    #[serde(rename = "outputDurationMs")]
    pub output_duration_ms: u64,
    #[serde(rename = "expectedVideoFrames")]
    pub expected_video_frames: u64,
    #[serde(rename = "decodedVideoFrames")]
    pub decoded_video_frames: u64,
    #[serde(rename = "goodVideoFrames")]
    pub good_video_frames: u64,
    #[serde(rename = "outputVideoFrames")]
    pub output_video_frames: u64,
    #[serde(rename = "duplicatedVideoFrames")]
    pub duplicated_video_frames: u64,
    #[serde(rename = "corruptVideoFrames")]
    pub corrupt_video_frames: u64,
    #[serde(rename = "removedVideoFrames")]
    pub removed_video_frames: u64,
    #[serde(rename = "removedTimelineMs")]
    pub removed_timeline_ms: u64,
    #[serde(rename = "trimmedLeadingMs")]
    pub trimmed_leading_ms: u64,
    #[serde(rename = "trimmedTrailingMs")]
    pub trimmed_trailing_ms: u64,
    #[serde(rename = "longestDuplicatedRunMs")]
    pub longest_duplicated_run_ms: u64,
    #[serde(rename = "longestRemovedRunMs")]
    pub longest_removed_run_ms: u64,
    #[serde(rename = "insertedAudioSilenceMs")]
    pub inserted_audio_silence_ms: u64,
    #[serde(rename = "strictValidationPassed")]
    pub strict_validation_passed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecoveryResultV2 {
    pub version: u32,
    #[serde(rename = "engineVersion")]
    pub engine_version: String,
    pub succeed: bool,
    pub method: Option<RecoveryMethod>,
    pub reason: String,
    #[serde(rename = "videoRatio")]
    pub video_ratio: Option<f64>,
    #[serde(rename = "audioRatio")]
    pub audio_ratio: Option<f64>,
    pub stats: RecoveryStats,
}

impl RecoveryResultV2 {
    pub fn success(
        engine_version: impl Into<String>,
        method: RecoveryMethod,
        reason: impl Into<String>,
        video_ratio: Option<f64>,
        audio_ratio: Option<f64>,
        stats: RecoveryStats,
    ) -> Self {
        Self {
            version: RECOVERY_RESULT_VERSION,
            engine_version: engine_version.into(),
            succeed: true,
            method: Some(method),
            reason: reason.into(),
            video_ratio,
            audio_ratio,
            stats,
        }
    }

    pub fn rejected(
        engine_version: impl Into<String>,
        reason: impl Into<String>,
        video_ratio: Option<f64>,
        audio_ratio: Option<f64>,
        stats: RecoveryStats,
    ) -> Self {
        Self {
            version: RECOVERY_RESULT_VERSION,
            engine_version: engine_version.into(),
            succeed: false,
            method: None,
            reason: reason.into(),
            video_ratio,
            audio_ratio,
            stats,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_the_version_two_javascript_contract() {
        let result = RecoveryResultV2::success(
            "0.2.0",
            RecoveryMethod::FrameReconstruction,
            "frame_reconstruction_succeeded",
            Some(0.75),
            None,
            RecoveryStats {
                source_duration_ms: 1_000,
                output_duration_ms: 900,
                expected_video_frames: 30,
                decoded_video_frames: 29,
                good_video_frames: 27,
                output_video_frames: 27,
                duplicated_video_frames: 0,
                corrupt_video_frames: 2,
                removed_video_frames: 2,
                removed_timeline_ms: 67,
                trimmed_leading_ms: 50,
                trimmed_trailing_ms: 50,
                longest_duplicated_run_ms: 0,
                longest_removed_run_ms: 67,
                inserted_audio_silence_ms: 0,
                strict_validation_passed: true,
            },
        );

        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["version"], 2);
        assert_eq!(value["engineVersion"], "0.2.0");
        assert_eq!(value["succeed"], true);
        assert_eq!(value["method"], "frame_reconstruction");
        assert!(!value.as_object().unwrap().contains_key("sourceDurationMs"));
        assert_eq!(value["stats"]["sourceDurationMs"], 1_000);
        assert_eq!(value["stats"]["strictValidationPassed"], true);
        assert_eq!(value["audioRatio"], serde_json::Value::Null);
    }

    #[test]
    fn rejected_result_has_a_null_method() {
        let result = RecoveryResultV2::rejected(
            "0.2.0",
            "recovery_no_trustworthy_video_frame",
            Some(0.2),
            Some(1.0),
            RecoveryStats::default(),
        );

        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["succeed"], false);
        assert_eq!(value["method"], serde_json::Value::Null);
    }
}
