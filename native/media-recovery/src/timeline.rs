#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameQuality {
    Clean { keyframe: bool },
    Damaged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameObservation {
    pub input_index: u64,
    pub timestamp_ms: i64,
    pub duration_ms: u64,
    pub quality: FrameQuality,
}

impl FrameObservation {
    pub fn clean(input_index: u64, timestamp_ms: i64, duration_ms: u64, keyframe: bool) -> Self {
        Self {
            input_index,
            timestamp_ms,
            duration_ms,
            quality: FrameQuality::Clean { keyframe },
        }
    }

    pub fn damaged(input_index: u64, timestamp_ms: i64, duration_ms: u64) -> Self {
        Self {
            input_index,
            timestamp_ms,
            duration_ms,
            quality: FrameQuality::Damaged,
        }
    }

    fn slot(self) -> FrameSlot {
        FrameSlot {
            input_index: self.input_index,
            timestamp_ms: self.timestamp_ms,
            duration_ms: self.duration_ms,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameSlot {
    pub input_index: u64,
    pub timestamp_ms: i64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CutInterval {
    pub start_ms: u64,
    pub end_ms: u64,
    pub frame_count: u64,
}

impl CutInterval {
    pub fn duration_ms(self) -> u64 {
        self.end_ms.saturating_sub(self.start_ms)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EditMap {
    source_duration_ms: u64,
    cuts: Vec<CutInterval>,
}

impl EditMap {
    pub fn new(
        source_duration_ms: u64,
        expected_frame_count: u64,
        mut cuts: Vec<CutInterval>,
    ) -> Self {
        cuts.retain(|cut| cut.start_ms < source_duration_ms && cut.end_ms > cut.start_ms);
        for cut in &mut cuts {
            cut.end_ms = cut.end_ms.min(source_duration_ms);
        }
        cuts.sort_by_key(|cut| cut.start_ms);

        let mut normalized: Vec<CutInterval> = Vec::with_capacity(cuts.len());
        for cut in cuts {
            if let Some(previous) = normalized.last_mut() {
                if cut.start_ms <= previous.end_ms {
                    previous.end_ms = previous.end_ms.max(cut.end_ms);
                    previous.frame_count = previous.frame_count.saturating_add(cut.frame_count);
                    continue;
                }
            }
            normalized.push(cut);
        }

        let mut remaining_frames = expected_frame_count;
        for cut in &mut normalized {
            cut.frame_count = cut.frame_count.min(remaining_frames);
            remaining_frames = remaining_frames.saturating_sub(cut.frame_count);
        }
        normalized.retain(|cut| cut.frame_count > 0);

        Self {
            source_duration_ms,
            cuts: normalized,
        }
    }

    pub fn cuts(&self) -> &[CutInterval] {
        &self.cuts
    }

    pub fn removed_duration_ms(&self) -> u64 {
        self.cuts
            .iter()
            .fold(0_u64, |total, cut| total.saturating_add(cut.duration_ms()))
    }

    pub fn longest_removed_run_ms(&self) -> u64 {
        self.cuts
            .iter()
            .map(|cut| cut.duration_ms())
            .max()
            .unwrap_or(0)
    }

    #[cfg(test)]
    pub fn output_duration_ms(&self) -> u64 {
        self.source_duration_ms
            .saturating_sub(self.removed_duration_ms())
    }

    #[cfg(test)]
    pub fn map_source_ms(&self, source_ms: u64) -> Option<u64> {
        if source_ms >= self.source_duration_ms {
            return None;
        }

        let mut removed_before = 0_u64;
        for cut in &self.cuts {
            if source_ms < cut.start_ms {
                break;
            }
            if source_ms < cut.end_ms {
                return None;
            }
            removed_before = removed_before.saturating_add(cut.duration_ms());
        }

        Some(source_ms.saturating_sub(removed_before))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TimelineAction {
    Keep { frame: FrameSlot, output_index: u64 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TimelineRejection {
    ZeroDuration { input_index: u64 },
    ZeroFrameRun { input_index: u64 },
    AlreadyFinished,
}

impl std::fmt::Display for TimelineRejection {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ZeroDuration { input_index } => {
                write!(formatter, "frame {input_index} has zero duration")
            }
            Self::ZeroFrameRun { input_index } => {
                write!(formatter, "damaged run at frame {input_index} is empty")
            }
            Self::AlreadyFinished => formatter.write_str("frame timeline is already finished"),
        }
    }
}

impl std::error::Error for TimelineRejection {}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TimelineSummary {
    pub first_accepted_timestamp_ms: Option<i64>,
    pub last_accepted_timestamp_ms: Option<i64>,
    pub observed_frames: u64,
    pub good_frames: u64,
    pub corrupt_frames: u64,
    pub output_frames: u64,
    pub duplicated_frames: u64,
    pub removed_frames: u64,
    pub removed_timeline_ms: u64,
    pub trimmed_leading_frames: u64,
    pub trimmed_leading_ms: u64,
    pub trimmed_trailing_frames: u64,
    pub trimmed_trailing_ms: u64,
    pub longest_duplicated_run_ms: u64,
    pub longest_removed_run_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimelineResult {
    pub summary: TimelineSummary,
    pub edit_map: EditMap,
}

#[derive(Debug, Clone, Copy)]
struct PendingCut {
    start_ms: i64,
    duration_ms: u64,
    frame_count: u64,
}

pub struct TimelineTracker {
    has_good_frame: bool,
    pending_cut: Option<PendingCut>,
    cuts: Vec<CutInterval>,
    summary: TimelineSummary,
    finished: bool,
}

impl TimelineTracker {
    pub fn new() -> Self {
        Self {
            has_good_frame: false,
            pending_cut: None,
            cuts: Vec::new(),
            summary: TimelineSummary::default(),
            finished: false,
        }
    }

    pub fn snapshot(&self) -> TimelineSummary {
        self.summary
    }

    pub fn observe(
        &mut self,
        observation: FrameObservation,
    ) -> Result<Vec<TimelineAction>, TimelineRejection> {
        match observation.quality {
            FrameQuality::Clean { .. } => self.observe_clean(observation),
            FrameQuality::Damaged => {
                self.observe_damaged_run(
                    observation.input_index,
                    observation.timestamp_ms,
                    observation.duration_ms,
                    1,
                )?;
                Ok(Vec::new())
            }
        }
    }

    pub fn observe_damaged_run(
        &mut self,
        input_index: u64,
        timestamp_ms: i64,
        frame_duration_ms: u64,
        frame_count: u64,
    ) -> Result<(), TimelineRejection> {
        self.observe_damaged_interval(
            input_index,
            timestamp_ms,
            frame_duration_ms.saturating_mul(frame_count),
            frame_count,
        )
    }

    pub fn observe_damaged_interval(
        &mut self,
        input_index: u64,
        timestamp_ms: i64,
        duration_ms: u64,
        frame_count: u64,
    ) -> Result<(), TimelineRejection> {
        self.ensure_active()?;
        if duration_ms == 0 {
            return Err(TimelineRejection::ZeroDuration { input_index });
        }
        if frame_count == 0 {
            return Err(TimelineRejection::ZeroFrameRun { input_index });
        }

        self.summary.observed_frames = self.summary.observed_frames.saturating_add(frame_count);
        self.summary.corrupt_frames = self.summary.corrupt_frames.saturating_add(frame_count);

        if !self.has_good_frame {
            self.summary.trimmed_leading_frames = self
                .summary
                .trimmed_leading_frames
                .saturating_add(frame_count);
            self.summary.trimmed_leading_ms =
                self.summary.trimmed_leading_ms.saturating_add(duration_ms);
        }

        match self.pending_cut.as_mut() {
            Some(pending) => {
                pending.duration_ms = pending.duration_ms.saturating_add(duration_ms);
                pending.frame_count = pending.frame_count.saturating_add(frame_count);
            }
            None => {
                self.pending_cut = Some(PendingCut {
                    start_ms: timestamp_ms,
                    duration_ms,
                    frame_count,
                });
            }
        }
        Ok(())
    }

    pub fn finish(mut self, source_duration_ms: u64, expected_frame_count: u64) -> TimelineResult {
        self.finished = true;
        if let Some(pending) = self.pending_cut.take() {
            if self.has_good_frame {
                self.summary.trimmed_trailing_frames = pending.frame_count;
                self.summary.trimmed_trailing_ms = pending.duration_ms;
            }
            self.commit_cut(pending);
        }

        let removable_frame_count = expected_frame_count.saturating_sub(self.summary.good_frames);
        let edit_map = EditMap::new(source_duration_ms, removable_frame_count, self.cuts);
        self.summary.removed_frames = edit_map
            .cuts()
            .iter()
            .fold(0_u64, |total, cut| total.saturating_add(cut.frame_count));
        self.summary.corrupt_frames = self.summary.removed_frames;
        self.summary.removed_timeline_ms = edit_map.removed_duration_ms();
        self.summary.longest_removed_run_ms = edit_map.longest_removed_run_ms();
        TimelineResult {
            summary: self.summary,
            edit_map,
        }
    }

    fn observe_clean(
        &mut self,
        observation: FrameObservation,
    ) -> Result<Vec<TimelineAction>, TimelineRejection> {
        self.ensure_active()?;
        if observation.duration_ms == 0 {
            return Err(TimelineRejection::ZeroDuration {
                input_index: observation.input_index,
            });
        }

        self.summary.observed_frames = self.summary.observed_frames.saturating_add(1);
        if let Some(pending) = self.pending_cut.take() {
            self.commit_cut(pending);
        }

        let frame = observation.slot();
        let output_index = self.summary.output_frames;
        self.summary.output_frames = self.summary.output_frames.saturating_add(1);
        self.summary.good_frames = self.summary.good_frames.saturating_add(1);
        self.summary
            .first_accepted_timestamp_ms
            .get_or_insert(observation.timestamp_ms);
        self.summary.last_accepted_timestamp_ms = Some(observation.timestamp_ms);
        self.has_good_frame = true;
        Ok(vec![TimelineAction::Keep {
            frame,
            output_index,
        }])
    }

    fn commit_cut(&mut self, pending: PendingCut) {
        let start_ms = u64::try_from(pending.start_ms.max(0)).unwrap_or(0);
        let end_ms = start_ms.saturating_add(pending.duration_ms);
        if end_ms > start_ms {
            self.cuts.push(CutInterval {
                start_ms,
                end_ms,
                frame_count: pending.frame_count,
            });
        }
    }

    fn ensure_active(&self) -> Result<(), TimelineRejection> {
        if self.finished {
            Err(TimelineRejection::AlreadyFinished)
        } else {
            Ok(())
        }
    }
}

impl Default for TimelineTracker {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(index: u64, timestamp_ms: i64, duration_ms: u64) -> FrameObservation {
        FrameObservation::clean(index, timestamp_ms, duration_ms, false)
    }

    fn damaged(index: u64, timestamp_ms: i64, duration_ms: u64) -> FrameObservation {
        FrameObservation::damaged(index, timestamp_ms, duration_ms)
    }

    #[test]
    fn trims_leading_damage_until_the_first_clean_frame() {
        let mut tracker = TimelineTracker::new();
        tracker.observe(damaged(0, 0, 40)).unwrap();
        let actions = tracker.observe(frame(1, 40, 40)).unwrap();

        assert_eq!(
            actions,
            vec![TimelineAction::Keep {
                frame: FrameSlot {
                    input_index: 1,
                    timestamp_ms: 40,
                    duration_ms: 40,
                },
                output_index: 0,
            }]
        );
        let result = tracker.finish(80, 2);
        assert_eq!(result.summary.trimmed_leading_frames, 1);
        assert_eq!(result.summary.trimmed_leading_ms, 40);
        assert_eq!(result.edit_map.cuts().len(), 1);
        assert_eq!(result.edit_map.output_duration_ms(), 40);
    }

    #[test]
    fn cuts_an_internal_gap_and_resumes_on_the_next_clean_frame() {
        let mut tracker = TimelineTracker::new();
        tracker.observe(frame(0, 0, 40)).unwrap();
        tracker.observe(damaged(1, 40, 40)).unwrap();
        let actions = tracker.observe(frame(2, 80, 40)).unwrap();

        assert_eq!(
            actions,
            vec![TimelineAction::Keep {
                frame: FrameSlot {
                    input_index: 2,
                    timestamp_ms: 80,
                    duration_ms: 40,
                },
                output_index: 1,
            }]
        );
        let result = tracker.finish(120, 3);
        assert_eq!(result.summary.output_frames, 2);
        assert_eq!(result.summary.removed_frames, 1);
        assert_eq!(result.summary.removed_timeline_ms, 40);
        assert_eq!(result.summary.duplicated_frames, 0);
    }

    #[test]
    fn stores_a_multi_minute_gap_as_one_compact_cut() {
        let mut tracker = TimelineTracker::new();
        tracker.observe(frame(0, 0, 40)).unwrap();
        tracker.observe_damaged_run(1, 40, 40, 7_500).unwrap();
        tracker.observe(frame(7_501, 300_040, 40)).unwrap();

        let result = tracker.finish(300_080, 7_502);
        assert_eq!(result.edit_map.cuts().len(), 1);
        assert_eq!(result.summary.removed_frames, 7_500);
        assert_eq!(result.summary.removed_timeline_ms, 300_000);
        assert_eq!(result.summary.longest_removed_run_ms, 300_000);
        assert_eq!(result.summary.output_frames, 2);
    }

    #[test]
    fn trims_an_unresolved_trailing_gap() {
        let mut tracker = TimelineTracker::new();
        tracker.observe(frame(0, 0, 40)).unwrap();
        tracker.observe_damaged_run(1, 40, 40, 100).unwrap();

        let result = tracker.finish(4_040, 101);
        assert_eq!(result.summary.output_frames, 1);
        assert_eq!(result.summary.trimmed_trailing_frames, 100);
        assert_eq!(result.summary.trimmed_trailing_ms, 4_000);
        assert_eq!(result.edit_map.output_duration_ms(), 40);
    }

    #[test]
    fn normalizes_overlapping_and_adjacent_cuts() {
        let map = EditMap::new(
            1_000,
            25,
            vec![
                CutInterval {
                    start_ms: 100,
                    end_ms: 300,
                    frame_count: 5,
                },
                CutInterval {
                    start_ms: 250,
                    end_ms: 400,
                    frame_count: 4,
                },
                CutInterval {
                    start_ms: 400,
                    end_ms: 500,
                    frame_count: 3,
                },
            ],
        );

        assert_eq!(map.cuts().len(), 1);
        assert_eq!(map.cuts()[0].start_ms, 100);
        assert_eq!(map.cuts()[0].end_ms, 500);
        assert_eq!(map.removed_duration_ms(), 400);
        assert_eq!(map.map_source_ms(99), Some(99));
        assert_eq!(map.map_source_ms(100), None);
        assert_eq!(map.map_source_ms(500), Some(100));
    }

    #[test]
    fn clamps_malicious_timestamp_ranges_to_the_source_duration() {
        let map = EditMap::new(
            1_000,
            25,
            vec![CutInterval {
                start_ms: 500,
                end_ms: u64::MAX,
                frame_count: u64::MAX,
            }],
        );

        assert_eq!(map.cuts()[0].end_ms, 1_000);
        assert_eq!(map.removed_duration_ms(), 500);
        assert_eq!(map.output_duration_ms(), 500);
    }
}
