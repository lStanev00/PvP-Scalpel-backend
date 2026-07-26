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
pub struct RetainedFrame {
    pub input_index: u64,
    pub timestamp_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TimelineAction {
    Keep {
        frame: FrameSlot,
        output_index: u64,
    },
    DuplicateGap {
        source: RetainedFrame,
        first_output_index: u64,
        frame_count: u64,
        duration_ms: u64,
        slots: Vec<FrameSlot>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TimelineRejection {
    ZeroDuration { input_index: u64 },
    InternalGapTooLong { duration_ms: u64, maximum_ms: u64 },
    AlreadyFinished,
}

impl std::fmt::Display for TimelineRejection {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ZeroDuration { input_index } => {
                write!(formatter, "frame {input_index} has zero duration")
            }
            Self::InternalGapTooLong {
                duration_ms,
                maximum_ms,
            } => write!(
                formatter,
                "internal frame gap of {duration_ms} ms exceeds {maximum_ms} ms"
            ),
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
    pub trimmed_leading_frames: u64,
    pub trimmed_leading_ms: u64,
    pub trimmed_trailing_frames: u64,
    pub trimmed_trailing_ms: u64,
    pub longest_duplicated_run_ms: u64,
}

pub struct TimelineTracker {
    maximum_internal_gap_ms: u64,
    last_good: Option<RetainedFrame>,
    pending_gap: Vec<FrameSlot>,
    summary: TimelineSummary,
    finished: bool,
}

impl TimelineTracker {
    pub fn new(maximum_internal_gap_ms: u64) -> Self {
        Self {
            maximum_internal_gap_ms,
            last_good: None,
            pending_gap: Vec::new(),
            summary: TimelineSummary::default(),
            finished: false,
        }
    }

    #[cfg(test)]
    pub fn last_good(&self) -> Option<RetainedFrame> {
        self.last_good
    }

    pub fn pending_duration_ms(&self) -> u64 {
        gap_duration(&self.pending_gap)
    }

    pub fn snapshot(&self) -> TimelineSummary {
        self.summary
    }

    pub fn observe(
        &mut self,
        observation: FrameObservation,
    ) -> Result<Vec<TimelineAction>, TimelineRejection> {
        if self.finished {
            return Err(TimelineRejection::AlreadyFinished);
        }
        if observation.duration_ms == 0 {
            return Err(TimelineRejection::ZeroDuration {
                input_index: observation.input_index,
            });
        }

        self.summary.observed_frames = self.summary.observed_frames.saturating_add(1);
        let is_damaged = matches!(observation.quality, FrameQuality::Damaged);
        if is_damaged {
            self.summary.corrupt_frames = self.summary.corrupt_frames.saturating_add(1);
        }

        if self.last_good.is_none() {
            return self.observe_before_first_frame(observation);
        }

        if !self.pending_gap.is_empty() {
            return self.observe_pending_gap(observation);
        }

        match observation.quality {
            FrameQuality::Clean { .. } => Ok(vec![self.keep(observation)]),
            FrameQuality::Damaged => {
                self.pending_gap.push(observation.slot());
                Ok(Vec::new())
            }
        }
    }

    pub fn finish(mut self) -> TimelineSummary {
        self.finished = true;
        if !self.pending_gap.is_empty() {
            self.summary.trimmed_trailing_frames =
                u64::try_from(self.pending_gap.len()).unwrap_or(u64::MAX);
            self.summary.trimmed_trailing_ms = gap_duration(&self.pending_gap);
            self.pending_gap.clear();
        }
        self.summary
    }

    fn observe_before_first_frame(
        &mut self,
        observation: FrameObservation,
    ) -> Result<Vec<TimelineAction>, TimelineRejection> {
        match observation.quality {
            FrameQuality::Clean { .. } => Ok(vec![self.keep(observation)]),
            FrameQuality::Damaged => {
                self.summary.trimmed_leading_frames =
                    self.summary.trimmed_leading_frames.saturating_add(1);
                self.summary.trimmed_leading_ms = self
                    .summary
                    .trimmed_leading_ms
                    .saturating_add(observation.duration_ms);
                Ok(Vec::new())
            }
        }
    }

    fn observe_pending_gap(
        &mut self,
        observation: FrameObservation,
    ) -> Result<Vec<TimelineAction>, TimelineRejection> {
        match observation.quality {
            FrameQuality::Clean { .. } => {
                let duration_ms = gap_duration(&self.pending_gap);
                if duration_ms > self.maximum_internal_gap_ms {
                    return Err(TimelineRejection::InternalGapTooLong {
                        duration_ms,
                        maximum_ms: self.maximum_internal_gap_ms,
                    });
                }

                let duplicated_frames = u64::try_from(self.pending_gap.len()).unwrap_or(u64::MAX);
                let source = self
                    .last_good
                    .expect("a pending internal gap always has a retained frame");
                let first_output_index = self.summary.output_frames;
                let duplicate = TimelineAction::DuplicateGap {
                    source,
                    first_output_index,
                    frame_count: duplicated_frames,
                    duration_ms,
                    slots: std::mem::take(&mut self.pending_gap),
                };
                self.summary.duplicated_frames = self
                    .summary
                    .duplicated_frames
                    .saturating_add(duplicated_frames);
                self.summary.output_frames =
                    self.summary.output_frames.saturating_add(duplicated_frames);
                self.summary.longest_duplicated_run_ms =
                    self.summary.longest_duplicated_run_ms.max(duration_ms);

                let keep = self.keep(observation);
                Ok(vec![duplicate, keep])
            }
            FrameQuality::Damaged => {
                self.pending_gap.push(observation.slot());
                Ok(Vec::new())
            }
        }
    }

    fn keep(&mut self, observation: FrameObservation) -> TimelineAction {
        let frame = observation.slot();
        let output_index = self.summary.output_frames;
        self.summary.output_frames = self.summary.output_frames.saturating_add(1);
        self.summary.good_frames = self.summary.good_frames.saturating_add(1);
        self.summary
            .first_accepted_timestamp_ms
            .get_or_insert(observation.timestamp_ms);
        self.summary.last_accepted_timestamp_ms = Some(observation.timestamp_ms);
        self.last_good = Some(RetainedFrame {
            input_index: observation.input_index,
            timestamp_ms: observation.timestamp_ms,
        });
        TimelineAction::Keep {
            frame,
            output_index,
        }
    }
}

fn gap_duration(slots: &[FrameSlot]) -> u64 {
    slots
        .iter()
        .fold(0_u64, |total, slot| total.saturating_add(slot.duration_ms))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keyframe(index: u64, timestamp_ms: i64, duration_ms: u64) -> FrameObservation {
        FrameObservation::clean(index, timestamp_ms, duration_ms, true)
    }

    fn frame(index: u64, timestamp_ms: i64, duration_ms: u64) -> FrameObservation {
        FrameObservation::clean(index, timestamp_ms, duration_ms, false)
    }

    fn damaged(index: u64, timestamp_ms: i64, duration_ms: u64) -> FrameObservation {
        FrameObservation::damaged(index, timestamp_ms, duration_ms)
    }

    #[test]
    fn trims_leading_damage_until_the_first_clean_frame() {
        let mut tracker = TimelineTracker::new(250);
        assert!(tracker.observe(damaged(0, 0, 40)).unwrap().is_empty());

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

        let summary = tracker.finish();
        assert_eq!(summary.trimmed_leading_frames, 1);
        assert_eq!(summary.trimmed_leading_ms, 40);
        assert_eq!(summary.first_accepted_timestamp_ms, Some(40));
    }

    #[test]
    fn retains_the_last_good_frame_while_a_gap_is_pending() {
        let mut tracker = TimelineTracker::new(250);
        tracker.observe(keyframe(0, 0, 40)).unwrap();
        tracker.observe(frame(1, 40, 40)).unwrap();
        let retained = tracker.last_good();

        tracker.observe(damaged(2, 80, 40)).unwrap();
        assert_eq!(tracker.last_good(), retained);
        assert_eq!(
            retained,
            Some(RetainedFrame {
                input_index: 1,
                timestamp_ms: 40,
            })
        );
    }

    #[test]
    fn resumes_after_corruption_on_the_next_clean_frame() {
        let mut tracker = TimelineTracker::new(250);
        tracker.observe(keyframe(0, 0, 40)).unwrap();
        assert!(tracker.observe(damaged(1, 40, 40)).unwrap().is_empty());

        let actions = tracker.observe(frame(2, 80, 40)).unwrap();
        assert_eq!(actions.len(), 2);
        match &actions[0] {
            TimelineAction::DuplicateGap {
                source,
                first_output_index,
                frame_count,
                duration_ms,
                slots,
            } => {
                assert_eq!(source.input_index, 0);
                assert_eq!(*first_output_index, 1);
                assert_eq!(*frame_count, 1);
                assert_eq!(*duration_ms, 40);
                assert_eq!(slots.len(), 1);
            }
            TimelineAction::Keep { .. } => panic!("expected a duplicated gap"),
        }
        assert!(matches!(
            actions[1],
            TimelineAction::Keep {
                output_index: 2,
                ..
            }
        ));
    }

    #[test]
    fn emits_duplicates_for_an_internal_gap_at_the_limit() {
        let mut tracker = TimelineTracker::new(250);
        tracker.observe(keyframe(0, 0, 50)).unwrap();
        for index in 1..=5 {
            tracker
                .observe(damaged(index, i64::try_from(index * 50).unwrap(), 50))
                .unwrap();
        }

        let actions = tracker.observe(keyframe(6, 300, 50)).unwrap();
        match &actions[0] {
            TimelineAction::DuplicateGap {
                frame_count,
                duration_ms,
                slots,
                ..
            } => {
                assert_eq!(*frame_count, 5);
                assert_eq!(*duration_ms, 250);
                assert_eq!(slots.len(), 5);
            }
            TimelineAction::Keep { .. } => panic!("expected a duplicated gap"),
        }
        let summary = tracker.finish();
        assert_eq!(summary.duplicated_frames, 5);
        assert_eq!(summary.longest_duplicated_run_ms, 250);
    }

    #[test]
    fn rejects_an_internal_gap_above_the_limit() {
        let mut tracker = TimelineTracker::new(250);
        tracker.observe(keyframe(0, 0, 100)).unwrap();
        tracker.observe(damaged(1, 100, 100)).unwrap();
        tracker.observe(damaged(2, 200, 100)).unwrap();
        tracker.observe(damaged(3, 300, 100)).unwrap();

        assert_eq!(
            tracker.observe(keyframe(4, 400, 100)),
            Err(TimelineRejection::InternalGapTooLong {
                duration_ms: 300,
                maximum_ms: 250,
            })
        );
    }

    #[test]
    fn trims_an_unresolved_trailing_gap() {
        let mut tracker = TimelineTracker::new(250);
        tracker.observe(keyframe(0, 0, 40)).unwrap();
        tracker.observe(damaged(1, 40, 40)).unwrap();

        let summary = tracker.finish();
        assert_eq!(summary.output_frames, 1);
        assert_eq!(summary.duplicated_frames, 0);
        assert_eq!(summary.trimmed_trailing_frames, 1);
        assert_eq!(summary.trimmed_trailing_ms, 40);
        assert_eq!(summary.last_accepted_timestamp_ms, Some(0));
    }

    #[test]
    fn duplicate_percentage_never_gates_acceptance() {
        let mut tracker = TimelineTracker::new(250);
        tracker.observe(keyframe(0, 0, 40)).unwrap();
        tracker.observe(damaged(1, 40, 40)).unwrap();
        tracker.observe(damaged(2, 80, 40)).unwrap();
        tracker.observe(keyframe(3, 120, 40)).unwrap();

        let summary = tracker.finish();
        assert_eq!(summary.output_frames, 4);
        assert_eq!(summary.duplicated_frames, 2);
        assert_eq!(summary.longest_duplicated_run_ms, 80);
    }
}
