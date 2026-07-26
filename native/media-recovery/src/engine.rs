use crate::guard::{remove_file_if_present, validate_output_file, RecoveryPaths};
use crate::mp4;
use crate::timeline::{
    EditMap, FrameObservation, TimelineAction, TimelineSummary, TimelineTracker,
};
use ffmpeg::codec::{self, decoder, encoder};
use ffmpeg::format;
use ffmpeg::media;
use ffmpeg::software::{resampling, scaling};
use ffmpeg::{Dictionary, Packet, Rational};
use ffmpeg_next as ffmpeg;
use std::ffi::c_void;
use std::ffi::CString;
use std::fs;
use std::path::Path;

const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_SOURCE_PIXELS: u64 = 33_177_600;
const MIN_STRUCTURAL_DURATION_RATIO: f64 = 0.98;
const AUDIO_RATE: u32 = 48_000;
const AUDIO_BIT_RATE: usize = 192_000;
const MIN_SOURCE_AUDIO_RATE: u32 = 8_000;
const MAX_SOURCE_AUDIO_RATE: u32 = 384_000;
const MAX_SOURCE_AUDIO_CHANNELS: u32 = 32;
const MAX_SOURCE_AUDIO_FRAME_SAMPLES: usize = 262_144;
const MAX_RESAMPLED_AUDIO_FRAME_SAMPLES: usize = 2_000_000;
const MAX_AUDIO_FIFO_SAMPLES: usize = 2_000_000;
const AUDIO_SILENCE_CHUNK_SAMPLES: u64 = 4_096;
const MAX_AUDIO_FORMAT_CHANGES: u32 = 16;
const MAX_FRAME_RATE: f64 = 60.0;
const FALLBACK_FRAME_RATE: i32 = 30;
const MAX_WIDTH: u32 = 1_280;
const MAX_HEIGHT: u32 = 720;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Method {
    Structural,
    FrameReconstruction,
}

#[derive(Clone, Debug, Default)]
pub struct Stats {
    pub source_duration_ms: u64,
    pub output_duration_ms: u64,
    pub expected_video_frames: u64,
    pub decoded_video_frames: u64,
    pub good_video_frames: u64,
    pub output_video_frames: u64,
    pub duplicated_video_frames: u64,
    pub corrupt_video_frames: u64,
    pub removed_video_frames: u64,
    pub removed_timeline_ms: u64,
    pub trimmed_leading_ms: u64,
    pub trimmed_trailing_ms: u64,
    pub longest_duplicated_run_ms: u64,
    pub longest_removed_run_ms: u64,
    pub inserted_audio_silence_ms: u64,
    pub strict_validation_passed: bool,
}

#[derive(Clone, Debug)]
pub struct Outcome {
    pub succeed: bool,
    pub method: Option<Method>,
    pub reason: String,
    pub video_ratio: Option<f64>,
    pub audio_ratio: Option<f64>,
    pub stats: Stats,
}

impl Outcome {
    fn success(
        method: Method,
        reason: &'static str,
        stats: Stats,
        video_ratio: Option<f64>,
        audio_ratio: Option<f64>,
    ) -> Self {
        Self {
            succeed: true,
            method: Some(method),
            reason: reason.into(),
            video_ratio,
            audio_ratio,
            stats,
        }
    }

    fn rejected(reason: impl Into<String>, stats: Stats) -> Self {
        let video_ratio = ratio(stats.output_duration_ms, stats.source_duration_ms);
        Self {
            succeed: false,
            method: None,
            reason: reason.into(),
            video_ratio,
            audio_ratio: None,
            stats,
        }
    }
}

#[derive(Debug)]
pub struct OperationalError {
    message: String,
}

impl OperationalError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for OperationalError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for OperationalError {}

#[derive(Clone, Debug)]
pub struct Capabilities {
    pub mp4_demuxer: bool,
    pub mp4_muxer: bool,
    pub h264_decoder: bool,
    pub libx264_encoder: bool,
    pub aac_encoder: bool,
    pub scaling: bool,
    pub resampling: bool,
}

impl Capabilities {
    pub fn complete(&self) -> bool {
        self.mp4_demuxer
            && self.mp4_muxer
            && self.h264_decoder
            && self.libx264_encoder
            && self.aac_encoder
            && self.scaling
            && self.resampling
    }
}

pub fn engine_version() -> &'static str {
    ENGINE_VERSION
}

pub fn capabilities() -> Result<Capabilities, OperationalError> {
    ffmpeg::init().map_err(ffmpeg_operational("failed to initialize FFmpeg"))?;

    let mov = CString::new("mov").expect("static name");
    let mp4 = CString::new("mp4").expect("static name");
    let capabilities = Capabilities {
        mp4_demuxer: unsafe { !ffmpeg::sys::av_find_input_format(mov.as_ptr()).is_null() },
        mp4_muxer: unsafe {
            !ffmpeg::sys::av_guess_format(mp4.as_ptr(), std::ptr::null(), std::ptr::null())
                .is_null()
        },
        h264_decoder: decoder::find(codec::Id::H264).is_some(),
        libx264_encoder: encoder::find_by_name("libx264").is_some(),
        aac_encoder: encoder::find(codec::Id::AAC).is_some(),
        scaling: ffmpeg::software::scaling::version() > 0,
        resampling: ffmpeg::software::resampling::version() > 0,
    };

    if capabilities.complete() {
        Ok(capabilities)
    } else {
        Err(OperationalError::new(
            "required MP4/H.264/libx264/AAC/scaling/resampling capability is unavailable",
        ))
    }
}

pub fn recover(paths: &RecoveryPaths) -> Result<Outcome, OperationalError> {
    capabilities()?;
    remove_file_if_present(&paths.partial_output).map_err(OperationalError::new)?;
    remove_file_if_present(&paths.output).map_err(OperationalError::new)?;

    let structural_fast_path = match mp4::inspect(
        crate::guard::open_input(&paths.input).map_err(OperationalError::new)?,
    ) {
        Ok(structure) if structure.has_ftyp && structure.has_mdat && structure.has_moov => true,
        Ok(_) => {
            stage_log(
                &paths.media_id,
                "structural",
                "required MP4 boxes are incomplete; frame reconstruction selected",
            );
            false
        }
        Err(error) => {
            stage_log(
                &paths.media_id,
                "structural",
                &format!("MP4 structure is damaged ({error}); frame reconstruction selected"),
            );
            false
        }
    };

    if structural_fast_path {
        stage_log(
            &paths.media_id,
            "structural",
            "direct-library remux started",
        );
        match attempt_structural(paths) {
            Ok(Some(outcome)) => return Ok(outcome),
            Ok(None) => stage_log(
                &paths.media_id,
                "structural",
                "strict validation failed; frame reconstruction selected",
            ),
            Err(error) => stage_log(
                &paths.media_id,
                "structural",
                &format!("fast path unavailable: {error}"),
            ),
        }
    }

    remove_file_if_present(&paths.partial_output).map_err(OperationalError::new)?;
    stage_log(
        &paths.media_id,
        "reconstruction",
        "frame-level analysis started",
    );
    reconstruct(paths)
}

fn attempt_structural(paths: &RecoveryPaths) -> Result<Option<Outcome>, OperationalError> {
    remux(&paths.input, &paths.partial_output)?;
    validate_output_file(&paths.partial_output).map_err(OperationalError::new)?;

    let source_duration_ms = probe_duration_ms(&paths.input).unwrap_or(0);
    let strict = match strict_validate(&paths.partial_output) {
        Ok(strict) => strict,
        Err(_) => {
            remove_file_if_present(&paths.partial_output).map_err(OperationalError::new)?;
            return Ok(None);
        }
    };

    if source_duration_ms == 0
        || strict.duration_ms == 0
        || ratio(strict.duration_ms, source_duration_ms).unwrap_or(0.0)
            < MIN_STRUCTURAL_DURATION_RATIO
    {
        remove_file_if_present(&paths.partial_output).map_err(OperationalError::new)?;
        return Ok(None);
    }

    fs::rename(&paths.partial_output, &paths.output)
        .map_err(|error| OperationalError::new(format!("failed to commit output: {error}")))?;
    validate_output_file(&paths.output).map_err(OperationalError::new)?;

    let frame_rate = strict.frame_rate.unwrap_or_else(fallback_frame_rate);
    let expected_video_frames = expected_frames(source_duration_ms, frame_rate);
    let stats = Stats {
        source_duration_ms,
        output_duration_ms: strict.duration_ms,
        expected_video_frames,
        decoded_video_frames: strict.video_frames,
        good_video_frames: strict.video_frames,
        output_video_frames: strict.video_frames,
        strict_validation_passed: true,
        ..Stats::default()
    };
    let audio_ratio = strict
        .audio_duration_ms
        .and_then(|duration| ratio(duration, source_duration_ms));

    stage_log(&paths.media_id, "structural", "strict remux accepted");
    Ok(Some(Outcome::success(
        Method::Structural,
        "structural_repair_succeeded",
        stats,
        ratio(strict.duration_ms, source_duration_ms),
        audio_ratio,
    )))
}

fn remux(input_path: &Path, output_path: &Path) -> Result<(), OperationalError> {
    let mut input = open_local_input(input_path)?;
    let video_index = input
        .streams()
        .best(media::Type::Video)
        .map(|stream| stream.index())
        .ok_or_else(|| OperationalError::new("source has no decodable video stream"))?;
    let audio_index = input
        .streams()
        .best(media::Type::Audio)
        .map(|stream| stream.index());

    let mut output = format::output_as(output_path, "mp4")
        .map_err(ffmpeg_operational("failed to create structural output"))?;
    let mut mapping = vec![None; input.nb_streams() as usize];
    let mut input_time_bases = vec![Rational(0, 1); input.nb_streams() as usize];

    for index in [Some(video_index), audio_index].into_iter().flatten() {
        let stream = input
            .stream(index)
            .ok_or_else(|| OperationalError::new("selected input stream disappeared"))?;
        let mut output_stream = output
            .add_stream(encoder::find(codec::Id::None))
            .map_err(ffmpeg_operational("failed to add structural output stream"))?;
        output_stream.set_parameters(stream.parameters());
        output_stream.set_time_base(stream.time_base());
        unsafe {
            (*output_stream.parameters().as_mut_ptr()).codec_tag = 0;
        }
        mapping[index] = Some(output_stream.index());
        input_time_bases[index] = stream.time_base();
    }

    let mut options = Dictionary::new();
    options.set("movflags", "+faststart");
    options.set("avoid_negative_ts", "make_zero");
    output
        .write_header_with(options)
        .map_err(ffmpeg_operational("failed to write structural MP4 header"))?;
    let output_time_bases: Vec<Rational> =
        output.streams().map(|stream| stream.time_base()).collect();

    loop {
        let mut packet = Packet::empty();
        match packet.read(&mut input) {
            Ok(()) => {}
            Err(ffmpeg::Error::Eof) => break,
            Err(error) => {
                return Err(OperationalError::new(format!(
                    "structural demux failed: {error}"
                )));
            }
        }
        let input_index = packet.stream();
        let Some(output_index) = mapping.get(input_index).copied().flatten() else {
            continue;
        };
        if packet.is_corrupt() {
            return Err(OperationalError::new(
                "structural remux encountered a corrupt packet",
            ));
        }
        packet.rescale_ts(
            input_time_bases[input_index],
            output_time_bases[output_index],
        );
        packet.set_position(-1);
        packet.set_stream(output_index);
        packet
            .write_interleaved(&mut output)
            .map_err(ffmpeg_operational("failed to write structural packet"))?;
    }

    output
        .write_trailer()
        .map_err(ffmpeg_operational("failed to finish structural MP4"))?;
    Ok(())
}

#[derive(Debug)]
struct StrictStats {
    duration_ms: u64,
    video_frames: u64,
    audio_duration_ms: Option<u64>,
    frame_rate: Option<Rational>,
}

fn strict_validate(path: &Path) -> Result<StrictStats, OperationalError> {
    let mut input = open_local_input(path)?;
    let duration_ms = context_duration_ms(&input);
    let video_stream = input
        .streams()
        .best(media::Type::Video)
        .ok_or_else(|| OperationalError::new("strict validation found no video stream"))?;
    let video_index = video_stream.index();
    let video_time_base = video_stream.time_base();
    let frame_rate = valid_frame_rate(video_stream.avg_frame_rate())
        .or_else(|| valid_frame_rate(video_stream.rate()));
    let nominal_video_frame_ms = frame_rate.map(|rate| 1_000.0 / f64::from(rate));
    let mut video_decoder = strict_video_decoder(video_stream.parameters(), video_time_base)?;

    let audio_details = input
        .streams()
        .best(media::Type::Audio)
        .map(|stream| (stream.index(), stream.time_base(), stream.parameters()));
    let mut audio_decoder = match audio_details.as_ref() {
        Some((_, time_base, parameters)) => {
            Some(strict_audio_decoder(parameters.clone(), *time_base)?)
        }
        None => None,
    };

    let mut video_frames = 0_u64;
    let mut audio_samples = 0_u64;
    let mut last_video_timestamp = None;
    let mut last_audio_timestamp = None;
    let mut last_audio_frame_ms = None;
    let audio_index = audio_details.as_ref().map(|(index, _, _)| *index);
    let audio_time_base = audio_details.as_ref().map(|(_, time_base, _)| *time_base);

    loop {
        let mut packet = Packet::empty();
        match packet.read(&mut input) {
            Ok(()) => {}
            Err(ffmpeg::Error::Eof) => break,
            Err(error) => {
                return Err(OperationalError::new(format!(
                    "strict demux failed: {error}"
                )));
            }
        }
        if packet.is_corrupt() {
            return Err(OperationalError::new(
                "strict validation encountered a corrupt packet",
            ));
        }
        if packet.stream() == video_index {
            video_decoder
                .send_packet(&packet)
                .map_err(ffmpeg_operational("strict video decode rejected a packet"))?;
            drain_strict_video(
                &mut video_decoder,
                &mut video_frames,
                &mut last_video_timestamp,
                video_time_base,
                nominal_video_frame_ms,
            )?;
        } else if Some(packet.stream()) == audio_index {
            let decoder = audio_decoder
                .as_mut()
                .expect("audio index exists only with decoder");
            decoder
                .send_packet(&packet)
                .map_err(ffmpeg_operational("strict audio decode rejected a packet"))?;
            drain_strict_audio(
                decoder,
                &mut audio_samples,
                &mut last_audio_timestamp,
                &mut last_audio_frame_ms,
                audio_time_base.expect("audio decoder has a time base"),
            )?;
        }
    }

    video_decoder
        .send_eof()
        .map_err(ffmpeg_operational("failed to flush strict video decoder"))?;
    drain_strict_video(
        &mut video_decoder,
        &mut video_frames,
        &mut last_video_timestamp,
        video_time_base,
        nominal_video_frame_ms,
    )?;
    if let Some(decoder) = audio_decoder.as_mut() {
        decoder
            .send_eof()
            .map_err(ffmpeg_operational("failed to flush strict audio decoder"))?;
        drain_strict_audio(
            decoder,
            &mut audio_samples,
            &mut last_audio_timestamp,
            &mut last_audio_frame_ms,
            audio_time_base.expect("audio decoder has a time base"),
        )?;
    }
    if video_frames == 0 {
        return Err(OperationalError::new(
            "strict validation decoded no video frames",
        ));
    }

    let audio_duration_ms = audio_decoder.as_ref().and_then(|decoder| {
        let rate = u64::from(decoder.rate());
        (rate > 0).then(|| audio_samples.saturating_mul(1_000) / rate)
    });
    Ok(StrictStats {
        duration_ms,
        video_frames,
        audio_duration_ms,
        frame_rate,
    })
}

fn strict_video_decoder(
    parameters: codec::Parameters,
    time_base: Rational,
) -> Result<decoder::Video, OperationalError> {
    let mut context = codec::Context::from_parameters(parameters).map_err(ffmpeg_operational(
        "failed to configure strict video decoder",
    ))?;
    context.set_threading(codec::threading::Config {
        kind: codec::threading::Type::Frame,
        count: 2,
    });
    let mut decoder = context.decoder();
    decoder.set_packet_time_base(time_base);
    decoder.conceal(decoder::Conceal::empty());
    decoder.check(
        decoder::Check::CRC
            | decoder::Check::BISTREAM
            | decoder::Check::BUFFER
            | decoder::Check::EXPLODE
            | decoder::Check::AGGRESSIVE,
    );
    let decoder = decoder
        .video()
        .map_err(ffmpeg_operational("failed to open strict video decoder"))?;
    validate_video_decoder_limits(&decoder, "strict validation")?;
    Ok(decoder)
}

fn strict_audio_decoder(
    parameters: codec::Parameters,
    time_base: Rational,
) -> Result<decoder::Audio, OperationalError> {
    let mut context = codec::Context::from_parameters(parameters).map_err(ffmpeg_operational(
        "failed to configure strict audio decoder",
    ))?;
    context.set_threading(codec::threading::Config {
        kind: codec::threading::Type::Frame,
        count: 2,
    });
    let mut decoder = context.decoder();
    decoder.set_packet_time_base(time_base);
    decoder.conceal(decoder::Conceal::empty());
    decoder.check(
        decoder::Check::CRC
            | decoder::Check::BISTREAM
            | decoder::Check::BUFFER
            | decoder::Check::EXPLODE
            | decoder::Check::AGGRESSIVE,
    );
    let decoder = decoder
        .audio()
        .map_err(ffmpeg_operational("failed to open strict audio decoder"))?;
    validate_audio_decoder_limits(&decoder, "strict validation")?;
    Ok(decoder)
}

fn drain_strict_video(
    decoder: &mut decoder::Video,
    frame_count: &mut u64,
    last_timestamp: &mut Option<i64>,
    time_base: Rational,
    nominal_frame_ms: Option<f64>,
) -> Result<(), OperationalError> {
    loop {
        let mut frame = ffmpeg::frame::Video::empty();
        match decoder.receive_frame(&mut frame) {
            Ok(()) => {
                if !valid_video_frame(&frame) {
                    return Err(OperationalError::new(
                        "strict validation found a corrupt video frame",
                    ));
                }
                let timestamp = frame
                    .timestamp()
                    .ok_or_else(|| OperationalError::new("strict video frame has no timestamp"))?;
                if last_timestamp.is_some_and(|last| timestamp <= last) {
                    return Err(OperationalError::new(
                        "strict video timestamps are not monotonic",
                    ));
                }
                if let (Some(last), Some(expected_ms)) = (*last_timestamp, nominal_frame_ms) {
                    if material_cadence_gap(last, timestamp, time_base, expected_ms) {
                        return Err(OperationalError::new(
                            "strict validation found a video timestamp gap",
                        ));
                    }
                }
                *last_timestamp = Some(timestamp);
                *frame_count = frame_count.saturating_add(1);
            }
            Err(error) if is_again_or_eof(error) => return Ok(()),
            Err(error) => {
                return Err(OperationalError::new(format!(
                    "strict video decode failed: {error}"
                )));
            }
        }
    }
}

fn drain_strict_audio(
    decoder: &mut decoder::Audio,
    sample_count: &mut u64,
    last_timestamp: &mut Option<i64>,
    last_frame_duration_ms: &mut Option<f64>,
    time_base: Rational,
) -> Result<(), OperationalError> {
    loop {
        let mut frame = ffmpeg::frame::Audio::empty();
        match decoder.receive_frame(&mut frame) {
            Ok(()) => {
                if !valid_audio_frame(&frame) {
                    return Err(OperationalError::new(
                        "strict validation found a corrupt audio frame",
                    ));
                }
                let timestamp = frame
                    .timestamp()
                    .ok_or_else(|| OperationalError::new("strict audio frame has no timestamp"))?;
                if last_timestamp.is_some_and(|last| timestamp <= last) {
                    return Err(OperationalError::new(
                        "strict audio timestamps are not monotonic",
                    ));
                }
                if let (Some(last), Some(expected_ms)) = (*last_timestamp, *last_frame_duration_ms)
                {
                    if material_cadence_gap(last, timestamp, time_base, expected_ms) {
                        return Err(OperationalError::new(
                            "strict validation found an audio timestamp gap",
                        ));
                    }
                }
                *last_timestamp = Some(timestamp);
                *last_frame_duration_ms =
                    Some(frame.samples() as f64 * 1_000.0 / f64::from(frame.rate()));
                *sample_count = sample_count.saturating_add(frame.samples() as u64);
            }
            Err(error) if is_again_or_eof(error) => return Ok(()),
            Err(error) => {
                return Err(OperationalError::new(format!(
                    "strict audio decode failed: {error}"
                )));
            }
        }
    }
}

fn material_cadence_gap(
    previous_timestamp: i64,
    current_timestamp: i64,
    time_base: Rational,
    expected_duration_ms: f64,
) -> bool {
    if current_timestamp <= previous_timestamp
        || time_base.numerator() <= 0
        || time_base.denominator() <= 0
        || !expected_duration_ms.is_finite()
        || expected_duration_ms <= 0.0
    {
        return false;
    }
    let delta_ms = (current_timestamp - previous_timestamp) as f64
        * f64::from(time_base.numerator())
        / f64::from(time_base.denominator())
        * 1_000.0;
    delta_ms > expected_duration_ms.mul_add(1.5, 1.0)
}

fn valid_video_frame(frame: &ffmpeg::frame::Video) -> bool {
    !frame.is_corrupt()
        && frame_decode_error_flags(frame) == 0
        && !unsafe { frame.is_empty() }
        && frame.width() > 0
        && frame.height() > 0
        && u64::from(frame.width()).saturating_mul(u64::from(frame.height())) <= MAX_SOURCE_PIXELS
        && frame.format() != format::Pixel::None
}

fn valid_audio_frame(frame: &ffmpeg::frame::Audio) -> bool {
    let layout = frame.channel_layout();
    let channels = if layout.is_empty() {
        u32::from(frame.channels())
    } else {
        u32::try_from(layout.channels()).unwrap_or(0)
    };

    !frame.is_corrupt()
        && frame_decode_error_flags(frame) == 0
        && !unsafe { frame.is_empty() }
        && frame.format() != format::Sample::None
        && frame.samples() > 0
        && frame.samples() <= MAX_SOURCE_AUDIO_FRAME_SAMPLES
        && (MIN_SOURCE_AUDIO_RATE..=MAX_SOURCE_AUDIO_RATE).contains(&frame.rate())
        && (1..=MAX_SOURCE_AUDIO_CHANNELS).contains(&channels)
        && audio_samples_are_finite(frame, channels as usize)
}

fn audio_samples_are_finite(frame: &ffmpeg::frame::Audio, channels: usize) -> bool {
    let (component_width, finite_component): (usize, fn(&[u8]) -> bool) = match frame.format() {
        format::Sample::F32(_) => (std::mem::size_of::<f32>(), |bytes| {
            f32::from_ne_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]).is_finite()
        }),
        format::Sample::F64(_) => (std::mem::size_of::<f64>(), |bytes| {
            f64::from_ne_bytes([
                bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
            ])
            .is_finite()
        }),
        _ => return true,
    };
    if channels == 0 {
        return false;
    }

    let planar = frame.format().is_planar();
    let plane_count = if planar { channels } else { 1 };
    let components_per_plane = if planar {
        frame.samples()
    } else {
        match frame.samples().checked_mul(channels) {
            Some(components) => components,
            None => return false,
        }
    };
    let required_bytes = match components_per_plane.checked_mul(component_width) {
        Some(bytes) => bytes,
        None => return false,
    };
    if frame.planes() < plane_count {
        return false;
    }

    unsafe {
        let raw = frame.as_ptr();
        let line_size = usize::try_from((*raw).linesize[0]).unwrap_or(0);
        let extended_data = (*raw).extended_data;
        if line_size < required_bytes || extended_data.is_null() {
            return false;
        }

        (0..plane_count).all(|plane| {
            let data = *extended_data.add(plane);
            if data.is_null() {
                return false;
            }
            std::slice::from_raw_parts(data, required_bytes)
                .chunks_exact(component_width)
                .all(finite_component)
        })
    }
}

fn validate_video_decoder_limits(
    decoder: &decoder::Video,
    context: &'static str,
) -> Result<(), OperationalError> {
    if target_dimensions(decoder.width(), decoder.height()).is_none() {
        return Err(OperationalError::new(format!(
            "{context} video dimensions exceed the recovery safety limit"
        )));
    }
    Ok(())
}

fn validate_audio_decoder_limits(
    decoder: &decoder::Audio,
    context: &'static str,
) -> Result<(), OperationalError> {
    let layout = decoder.channel_layout();
    let channels = if layout.is_empty() {
        u32::from(decoder.channels())
    } else {
        u32::try_from(layout.channels()).unwrap_or(0)
    };
    if !(MIN_SOURCE_AUDIO_RATE..=MAX_SOURCE_AUDIO_RATE).contains(&decoder.rate())
        || !(1..=MAX_SOURCE_AUDIO_CHANNELS).contains(&channels)
    {
        return Err(OperationalError::new(format!(
            "{context} audio definition exceeds the recovery safety limit"
        )));
    }
    Ok(())
}

fn ensure_audio_frame_allocated(
    frame: &ffmpeg::frame::Audio,
    context: &'static str,
) -> Result<(), OperationalError> {
    if unsafe { frame.is_empty() } {
        Err(OperationalError::new(context))
    } else {
        Ok(())
    }
}

fn zero_audio_frame(
    frame: &mut ffmpeg::frame::Audio,
    context: &'static str,
) -> Result<(), OperationalError> {
    ensure_audio_frame_allocated(frame, context)?;
    let channels = usize::from(frame.channels());
    let sample_width = frame.format().bytes();
    if channels == 0 || sample_width == 0 {
        return Err(OperationalError::new(context));
    }

    let planar = frame.format().is_planar();
    let plane_count = if planar { channels } else { 1 };
    let components_per_plane = if planar {
        frame.samples()
    } else {
        frame
            .samples()
            .checked_mul(channels)
            .ok_or_else(|| OperationalError::new(context))?
    };
    let required_bytes = components_per_plane
        .checked_mul(sample_width)
        .ok_or_else(|| OperationalError::new(context))?;

    unsafe {
        let raw = frame.as_mut_ptr();
        let line_size =
            usize::try_from((*raw).linesize[0]).map_err(|_| OperationalError::new(context))?;
        let extended_data = (*raw).extended_data;
        if line_size < required_bytes || extended_data.is_null() {
            return Err(OperationalError::new(context));
        }
        for plane in 0..plane_count {
            let data = *extended_data.add(plane);
            if data.is_null() {
                return Err(OperationalError::new(context));
            }
            std::ptr::write_bytes(data, 0, line_size);
        }
    }
    Ok(())
}

fn frame_decode_error_flags<T>(frame: &T) -> i32
where
    T: std::ops::Deref<Target = ffmpeg::Frame>,
{
    unsafe { (*frame.as_ptr()).decode_error_flags }
}

fn open_local_input(path: &Path) -> Result<format::context::Input, OperationalError> {
    let mut options = Dictionary::new();
    options.set("protocol_whitelist", "file");
    format::input_with_dictionary(path, options)
        .map_err(ffmpeg_operational("failed to open local media input"))
}

fn probe_duration_ms(path: &Path) -> Option<u64> {
    open_local_input(path)
        .ok()
        .map(|input| context_duration_ms(&input))
        .filter(|duration| *duration > 0)
}

fn context_duration_ms(context: &format::context::Input) -> u64 {
    let duration = context.duration();
    if duration <= 0 || duration == ffmpeg::sys::AV_NOPTS_VALUE {
        0
    } else {
        u64::try_from(duration).unwrap_or(0) / 1_000
    }
}

fn valid_frame_rate(rate: Rational) -> Option<Rational> {
    let value = f64::from(rate);
    (rate.numerator() > 0 && rate.denominator() > 0 && value.is_finite() && value > 0.0)
        .then_some(rate)
}

fn fallback_frame_rate() -> Rational {
    Rational(FALLBACK_FRAME_RATE, 1)
}

fn expected_frames(duration_ms: u64, frame_rate: Rational) -> u64 {
    let frames = duration_ms as f64 * f64::from(frame_rate) / 1_000.0;
    frames.round().max(1.0) as u64
}

fn frame_slots_between(delta_ms: i64, frame_rate: Rational) -> u64 {
    if delta_ms <= 0 || frame_rate.numerator() <= 0 || frame_rate.denominator() <= 0 {
        return 0;
    }
    let numerator = u128::try_from(delta_ms)
        .unwrap_or(u128::MAX)
        .saturating_mul(u128::try_from(frame_rate.numerator()).unwrap_or(u128::MAX));
    let denominator = 1_000_u128
        .saturating_mul(u128::try_from(frame_rate.denominator()).unwrap_or(u128::MAX))
        .max(1);
    u64::try_from(numerator.saturating_add(denominator / 2) / denominator).unwrap_or(u64::MAX)
}

fn ratio(numerator: u64, denominator: u64) -> Option<f64> {
    (denominator > 0).then(|| (numerator as f64 / denominator as f64).clamp(0.0, 1.0))
}

fn ffmpeg_operational(context: &'static str) -> impl FnOnce(ffmpeg::Error) -> OperationalError {
    move |error| OperationalError::new(format!("{context}: {error}"))
}

fn is_again_or_eof(error: ffmpeg::Error) -> bool {
    error == ffmpeg::Error::Eof
        || error
            == ffmpeg::Error::Other {
                errno: ffmpeg::error::EAGAIN,
            }
}

fn is_recoverable_demux_end(error: ffmpeg::Error) -> bool {
    matches!(error, ffmpeg::Error::Eof | ffmpeg::Error::InvalidData)
}

fn stage_log(media_id: &str, stage: &str, message: &str) {
    eprintln!("[media-recovery][{media_id}][{stage}] {message}");
}

struct VideoSource {
    index: usize,
    time_base: Rational,
    parameters: codec::Parameters,
    start_time_ms: i64,
    duration_ms: u64,
    width: u32,
    height: u32,
    frame_rate: Rational,
    frame_duration_ms: u64,
    expected_frames: u64,
}

struct AudioSource {
    index: usize,
    time_base: Rational,
    parameters: codec::Parameters,
}

struct Source {
    duration_ms: u64,
    video: VideoSource,
    audio: Option<AudioSource>,
}

struct VideoAnalysis {
    source: Source,
    summary: TimelineSummary,
    edit_map: EditMap,
    stats: Stats,
    first_timestamp_ms: i64,
}

enum PipelineFailure {
    Rejected(String, Box<Stats>),
    Operational(OperationalError),
}

impl From<OperationalError> for PipelineFailure {
    fn from(error: OperationalError) -> Self {
        Self::Operational(error)
    }
}

fn reconstruct(paths: &RecoveryPaths) -> Result<Outcome, OperationalError> {
    let analysis = match analyze_video(&paths.input) {
        Ok(analysis) => analysis,
        Err(PipelineFailure::Rejected(reason, stats)) => {
            return Ok(Outcome::rejected(reason, *stats));
        }
        Err(PipelineFailure::Operational(error)) => return Err(error),
    };

    stage_log(
        &paths.media_id,
        "reconstruction",
        &format!(
            "analysis accepted decoded={} good={} corrupt={} removed={} removed_ms={} longest_cut_ms={}",
            analysis.stats.decoded_video_frames,
            analysis.stats.good_video_frames,
            analysis.stats.corrupt_video_frames,
            analysis.stats.removed_video_frames,
            analysis.stats.removed_timeline_ms,
            analysis.stats.longest_removed_run_ms,
        ),
    );

    let encoded = match encode_reconstruction(&paths.input, &paths.partial_output, &analysis) {
        Ok(encoded) => encoded,
        Err(PipelineFailure::Rejected(reason, stats)) => {
            remove_file_if_present(&paths.partial_output).map_err(OperationalError::new)?;
            let mut merged = analysis.stats.clone();
            merged.inserted_audio_silence_ms = merged
                .inserted_audio_silence_ms
                .max(stats.inserted_audio_silence_ms);
            return Ok(Outcome::rejected(reason, merged));
        }
        Err(PipelineFailure::Operational(error)) => {
            remove_file_if_present(&paths.partial_output).map_err(OperationalError::new)?;
            return Err(error);
        }
    };
    if encoded.audio_format_changes > 0 || encoded.skipped_audio_format_frames > 0 {
        stage_log(
            &paths.media_id,
            "audio",
            &format!(
                "resampler_changes={} skipped_format_frames={}",
                encoded.audio_format_changes, encoded.skipped_audio_format_frames,
            ),
        );
    }
    validate_output_file(&paths.partial_output).map_err(OperationalError::new)?;

    let strict = match strict_validate(&paths.partial_output) {
        Ok(strict) => strict,
        Err(error) => {
            remove_file_if_present(&paths.partial_output).map_err(OperationalError::new)?;
            let mut stats = encoded.stats;
            stats.strict_validation_passed = false;
            stage_log(
                &paths.media_id,
                "validation",
                &format!("strict decode rejected reconstructed output: {error}"),
            );
            return Ok(Outcome::rejected(
                "recovery_strict_validation_failed",
                stats,
            ));
        }
    };

    let mut stats = encoded.stats;
    stats.output_duration_ms = strict.duration_ms;
    stats.strict_validation_passed = true;
    if strict.video_frames != stats.output_video_frames {
        remove_file_if_present(&paths.partial_output).map_err(OperationalError::new)?;
        return Ok(Outcome::rejected(
            "recovery_output_frame_count_mismatch",
            stats,
        ));
    }
    if strict.duration_ms == 0 {
        remove_file_if_present(&paths.partial_output).map_err(OperationalError::new)?;
        return Ok(Outcome::rejected("recovery_output_has_no_duration", stats));
    }

    let video_duration_ms =
        frames_to_ms(stats.output_video_frames, analysis.source.video.frame_rate);
    if let Some(audio_duration_ms) = strict.audio_duration_ms {
        let allowed_drift_ms = analysis
            .source
            .video
            .frame_duration_ms
            .saturating_add(1_024_u64.saturating_mul(1_000) / u64::from(AUDIO_RATE));
        if video_duration_ms.abs_diff(audio_duration_ms) > allowed_drift_ms {
            remove_file_if_present(&paths.partial_output).map_err(OperationalError::new)?;
            return Ok(Outcome::rejected("recovery_av_drift_exceeded", stats));
        }
    }

    fs::rename(&paths.partial_output, &paths.output)
        .map_err(|error| OperationalError::new(format!("failed to commit output: {error}")))?;
    validate_output_file(&paths.output).map_err(OperationalError::new)?;

    let audio_ratio = strict
        .audio_duration_ms
        .and_then(|duration| ratio(duration, stats.source_duration_ms));
    let video_ratio = ratio(strict.duration_ms, stats.source_duration_ms);
    let corruption_percent = if stats.expected_video_frames == 0 {
        0.0
    } else {
        (stats.corrupt_video_frames as f64 / stats.expected_video_frames as f64) * 100.0
    };
    stage_log(
        &paths.media_id,
        "validation",
        &format!(
            "strict decode passed removed_frames={} removed_ms={} longest_cut_ms={} leading_trim_ms={} trailing_trim_ms={} inserted_silence_ms={} output_source_ratio={:.3} corruption={:.3}%",
            stats.removed_video_frames,
            stats.removed_timeline_ms,
            stats.longest_removed_run_ms,
            stats.trimmed_leading_ms,
            stats.trimmed_trailing_ms,
            stats.inserted_audio_silence_ms,
            video_ratio.unwrap_or(0.0),
            corruption_percent,
        ),
    );
    Ok(Outcome::success(
        Method::FrameReconstruction,
        "frame_reconstruction_succeeded",
        stats,
        video_ratio,
        audio_ratio,
    ))
}

fn inspect_source(path: &Path) -> Result<Source, PipelineFailure> {
    let input = open_local_input(path)?;
    let duration_ms = context_duration_ms(&input);
    if duration_ms == 0 {
        return Err(
            OperationalError::new("source duration is unavailable for bounded recovery").into(),
        );
    }

    let video_stream = input
        .streams()
        .best(media::Type::Video)
        .ok_or_else(|| OperationalError::new("source contains no video stream"))?;
    let mut decoder = tolerant_video_decoder(video_stream.parameters(), video_stream.time_base())?;
    let width = decoder.width();
    let height = decoder.height();
    if target_dimensions(width, height).is_none() {
        return Err(OperationalError::new(
            "source video dimensions exceed the recovery safety limit",
        )
        .into());
    }
    let source_rate = valid_frame_rate(video_stream.avg_frame_rate())
        .or_else(|| valid_frame_rate(video_stream.rate()))
        .or_else(|| decoder.frame_rate().and_then(valid_frame_rate))
        .unwrap_or_else(fallback_frame_rate);
    if f64::from(source_rate) > MAX_FRAME_RATE {
        return Err(PipelineFailure::Rejected(
            "recovery_frame_rate_unsupported".into(),
            Box::new(Stats {
                source_duration_ms: duration_ms,
                ..Stats::default()
            }),
        ));
    }
    if let (Some(average), Some(nominal)) = (
        valid_frame_rate(video_stream.avg_frame_rate()),
        valid_frame_rate(video_stream.rate()),
    ) {
        if materially_different_frame_rates(average, nominal) {
            return Err(PipelineFailure::Rejected(
                "recovery_variable_frame_rate_unsupported".into(),
                Box::new(Stats {
                    source_duration_ms: duration_ms,
                    ..Stats::default()
                }),
            ));
        }
    }
    let frame_rate = source_rate.reduce();
    let frame_duration_ms = (1_000.0 / f64::from(frame_rate)).round().max(1.0) as u64;
    let source_expected_frames = expected_frames(duration_ms, frame_rate);
    let start_time_ms = stream_start_ms(video_stream.start_time(), video_stream.time_base());
    let video = VideoSource {
        index: video_stream.index(),
        time_base: video_stream.time_base(),
        parameters: video_stream.parameters(),
        start_time_ms,
        duration_ms,
        width,
        height,
        frame_rate,
        frame_duration_ms,
        expected_frames: source_expected_frames,
    };
    decoder.flush();

    let audio = input
        .streams()
        .best(media::Type::Audio)
        .map(|stream| AudioSource {
            index: stream.index(),
            time_base: stream.time_base(),
            parameters: stream.parameters(),
        });
    Ok(Source {
        duration_ms,
        video,
        audio,
    })
}

fn analyze_video(path: &Path) -> Result<VideoAnalysis, PipelineFailure> {
    let source = inspect_source(path)?;
    let mut input = open_local_input(path)?;
    let mut decoder =
        tolerant_video_decoder(source.video.parameters.clone(), source.video.time_base)?;
    let mut tracker = TimelineTracker::new();
    let mut input_index = 0_u64;
    let mut actual_decoded_frames = 0_u64;
    let mut last_trustworthy_timestamp_ms = None;
    let mut consecutive_damage_ms = 0_u64;

    loop {
        let mut packet = Packet::empty();
        match packet.read(&mut input) {
            Ok(()) => {}
            Err(error) if is_recoverable_demux_end(error) => break,
            Err(error) => {
                return Err(PipelineFailure::Operational(OperationalError::new(
                    format!("recovery analysis demux failed: {error}"),
                )));
            }
        }
        if packet.stream() != source.video.index {
            continue;
        }
        if packet.is_corrupt() {
            if let Err(error) = observe_damaged(
                &mut tracker,
                &mut input_index,
                next_damage_timestamp(
                    last_trustworthy_timestamp_ms,
                    consecutive_damage_ms,
                    source.video.frame_duration_ms,
                ),
                source.video.frame_duration_ms,
                &mut consecutive_damage_ms,
            ) {
                return Err(enrich_analysis_rejection(
                    error,
                    &source,
                    &tracker,
                    actual_decoded_frames,
                ));
            }
            continue;
        }
        if let Err(error) = decoder.send_packet(&packet) {
            if !is_again_or_eof(error) {
                if let Err(error) = observe_damaged(
                    &mut tracker,
                    &mut input_index,
                    next_damage_timestamp(
                        last_trustworthy_timestamp_ms,
                        consecutive_damage_ms,
                        source.video.frame_duration_ms,
                    ),
                    source.video.frame_duration_ms,
                    &mut consecutive_damage_ms,
                ) {
                    return Err(enrich_analysis_rejection(
                        error,
                        &source,
                        &tracker,
                        actual_decoded_frames,
                    ));
                }
            }
        }
        if let Err(error) = drain_analysis_frames(
            &mut decoder,
            &source.video,
            &mut tracker,
            &mut input_index,
            &mut actual_decoded_frames,
            &mut last_trustworthy_timestamp_ms,
            &mut consecutive_damage_ms,
        ) {
            return Err(enrich_analysis_rejection(
                error,
                &source,
                &tracker,
                actual_decoded_frames,
            ));
        }
    }

    if let Err(error) = decoder.send_eof() {
        if !is_again_or_eof(error) {
            return Err(PipelineFailure::Operational(OperationalError::new(
                format!("failed to flush recovery analysis decoder: {error}"),
            )));
        }
    }
    if let Err(error) = drain_analysis_frames(
        &mut decoder,
        &source.video,
        &mut tracker,
        &mut input_index,
        &mut actual_decoded_frames,
        &mut last_trustworthy_timestamp_ms,
        &mut consecutive_damage_ms,
    ) {
        return Err(enrich_analysis_rejection(
            error,
            &source,
            &tracker,
            actual_decoded_frames,
        ));
    }

    append_unobserved_trailing_damage(
        &mut tracker,
        &mut input_index,
        last_trustworthy_timestamp_ms,
        consecutive_damage_ms,
        &source.video,
        source.duration_ms,
    )?;
    let timeline = tracker.finish(source.duration_ms, source.video.expected_frames);
    let summary = timeline.summary;
    let first_timestamp_ms = summary.first_accepted_timestamp_ms.ok_or_else(|| {
        PipelineFailure::Rejected(
            "recovery_no_trustworthy_video_frame".into(),
            Box::new(Stats {
                source_duration_ms: source.duration_ms,
                decoded_video_frames: actual_decoded_frames,
                corrupt_video_frames: summary.corrupt_frames,
                ..Stats::default()
            }),
        )
    })?;
    if summary.output_frames == 0 {
        return Err(PipelineFailure::Rejected(
            "recovery_no_output_video_frames".into(),
            Box::default(),
        ));
    }

    let output_duration_ms = frames_to_ms(summary.output_frames, source.video.frame_rate);
    let stats = Stats {
        source_duration_ms: source.duration_ms,
        output_duration_ms,
        expected_video_frames: source.video.expected_frames,
        decoded_video_frames: actual_decoded_frames,
        good_video_frames: summary.good_frames,
        output_video_frames: summary.output_frames,
        duplicated_video_frames: summary.duplicated_frames,
        corrupt_video_frames: summary.corrupt_frames,
        removed_video_frames: summary.removed_frames,
        removed_timeline_ms: summary.removed_timeline_ms,
        trimmed_leading_ms: summary.trimmed_leading_ms,
        trimmed_trailing_ms: summary.trimmed_trailing_ms,
        longest_duplicated_run_ms: summary.longest_duplicated_run_ms,
        longest_removed_run_ms: summary.longest_removed_run_ms,
        ..Stats::default()
    };

    Ok(VideoAnalysis {
        source,
        summary,
        edit_map: timeline.edit_map,
        stats,
        first_timestamp_ms,
    })
}

fn enrich_analysis_rejection(
    error: PipelineFailure,
    source: &Source,
    tracker: &TimelineTracker,
    decoded_video_frames: u64,
) -> PipelineFailure {
    let PipelineFailure::Rejected(reason, _) = error else {
        return error;
    };
    let summary = tracker.snapshot();
    let output_duration_ms = frames_to_ms(summary.output_frames, source.video.frame_rate);
    let estimated_end_ms = summary
        .first_accepted_timestamp_ms
        .unwrap_or_default()
        .saturating_add(output_duration_ms as i64);
    PipelineFailure::Rejected(
        reason,
        Box::new(Stats {
            source_duration_ms: source.duration_ms,
            output_duration_ms,
            expected_video_frames: expected_frames(source.duration_ms, source.video.frame_rate),
            decoded_video_frames,
            good_video_frames: summary.good_frames,
            output_video_frames: summary.output_frames,
            duplicated_video_frames: summary.duplicated_frames,
            corrupt_video_frames: summary.corrupt_frames,
            removed_video_frames: summary.corrupt_frames,
            trimmed_leading_ms: summary.trimmed_leading_ms,
            trimmed_trailing_ms: summary.trimmed_trailing_ms.max(
                source
                    .duration_ms
                    .saturating_sub(estimated_end_ms.max(0) as u64),
            ),
            longest_duplicated_run_ms: summary.longest_duplicated_run_ms,
            ..Stats::default()
        }),
    )
}

fn drain_analysis_frames(
    decoder: &mut decoder::Video,
    source: &VideoSource,
    tracker: &mut TimelineTracker,
    input_index: &mut u64,
    actual_decoded_frames: &mut u64,
    last_trustworthy_timestamp_ms: &mut Option<i64>,
    consecutive_damage_ms: &mut u64,
) -> Result<(), PipelineFailure> {
    loop {
        let mut frame = ffmpeg::frame::Video::empty();
        match decoder.receive_frame(&mut frame) {
            Ok(()) => {
                *actual_decoded_frames = actual_decoded_frames.saturating_add(1);
                let timestamp_ms = frame
                    .timestamp()
                    .map(|timestamp| {
                        timestamp_to_ms(timestamp, source.time_base)
                            .saturating_sub(source.start_time_ms)
                    })
                    .unwrap_or_else(|| {
                        next_damage_timestamp(
                            *last_trustworthy_timestamp_ms,
                            *consecutive_damage_ms,
                            source.frame_duration_ms,
                        )
                    });
                let timestamp_valid = timestamp_is_trustworthy(
                    timestamp_ms,
                    *last_trustworthy_timestamp_ms,
                    source.duration_ms,
                );
                let clean = valid_video_frame(&frame)
                    && timestamp_valid
                    && *input_index < source.expected_frames;
                if clean {
                    infer_missing_observations(
                        tracker,
                        input_index,
                        *last_trustworthy_timestamp_ms,
                        timestamp_ms,
                        source.frame_duration_ms,
                        source.frame_rate,
                        source.expected_frames,
                        source.duration_ms,
                        consecutive_damage_ms,
                    )?;
                }
                let observation = if clean {
                    *consecutive_damage_ms = 0;
                    FrameObservation::clean(
                        *input_index,
                        timestamp_ms,
                        source.frame_duration_ms,
                        frame.is_key(),
                    )
                } else {
                    let damage_timestamp_ms = next_damage_timestamp(
                        *last_trustworthy_timestamp_ms,
                        *consecutive_damage_ms,
                        source.frame_duration_ms,
                    );
                    *consecutive_damage_ms =
                        consecutive_damage_ms.saturating_add(source.frame_duration_ms);
                    FrameObservation::damaged(
                        *input_index,
                        damage_timestamp_ms,
                        source.frame_duration_ms,
                    )
                };
                tracker.observe(observation).map_err(timeline_rejection)?;
                *last_trustworthy_timestamp_ms = retain_trustworthy_timestamp(
                    *last_trustworthy_timestamp_ms,
                    timestamp_ms,
                    clean,
                );
                *input_index = input_index.saturating_add(1);
            }
            Err(error) if is_again_or_eof(error) => return Ok(()),
            Err(_) => {
                let timestamp_ms = next_damage_timestamp(
                    *last_trustworthy_timestamp_ms,
                    *consecutive_damage_ms,
                    source.frame_duration_ms,
                );
                observe_damaged(
                    tracker,
                    input_index,
                    timestamp_ms,
                    source.frame_duration_ms,
                    consecutive_damage_ms,
                )?;
                return Ok(());
            }
        }
    }
}

fn observe_damaged(
    tracker: &mut TimelineTracker,
    input_index: &mut u64,
    timestamp_ms: i64,
    duration_ms: u64,
    consecutive_damage_ms: &mut u64,
) -> Result<(), PipelineFailure> {
    *consecutive_damage_ms = consecutive_damage_ms.saturating_add(duration_ms);
    tracker
        .observe(FrameObservation::damaged(
            *input_index,
            timestamp_ms,
            duration_ms,
        ))
        .map_err(timeline_rejection)?;
    *input_index = input_index.saturating_add(1);
    Ok(())
}

fn infer_missing_observations(
    tracker: &mut TimelineTracker,
    input_index: &mut u64,
    previous_timestamp_ms: Option<i64>,
    current_timestamp_ms: i64,
    frame_duration_ms: u64,
    frame_rate: Rational,
    maximum_frames: u64,
    maximum_timeline_ms: u64,
    consecutive_damage_ms: &mut u64,
) -> Result<(), PipelineFailure> {
    let Some(previous_timestamp_ms) = previous_timestamp_ms else {
        return Ok(());
    };
    let delta_ms = current_timestamp_ms.saturating_sub(previous_timestamp_ms);
    if delta_ms <= 0 {
        return Ok(());
    }
    let nominal_slots = frame_slots_between(delta_ms, frame_rate);
    let missing_slots = nominal_slots.saturating_sub(1);
    let already_observed = *consecutive_damage_ms / frame_duration_ms.max(1);
    let requested_additional = missing_slots.saturating_sub(already_observed);
    let additional =
        requested_additional.min(maximum_frames.saturating_sub(input_index.saturating_add(1)));
    if additional > 0 {
        let total_gap_duration_ms = u64::try_from(delta_ms)
            .unwrap_or(u64::MAX)
            .min(maximum_timeline_ms)
            .saturating_sub(frame_duration_ms);
        let mut additional_duration_ms =
            total_gap_duration_ms.saturating_sub(*consecutive_damage_ms);
        if additional < requested_additional {
            additional_duration_ms =
                additional_duration_ms.min(frames_to_ms(additional, frame_rate));
        }
        if additional_duration_ms == 0 {
            return Ok(());
        }
        let timestamp_ms = previous_timestamp_ms.saturating_add(
            i64::try_from(frame_duration_ms.saturating_add(*consecutive_damage_ms))
                .unwrap_or(i64::MAX),
        );
        tracker
            .observe_damaged_interval(
                *input_index,
                timestamp_ms,
                additional_duration_ms,
                additional,
            )
            .map_err(timeline_rejection)?;
        *input_index = input_index.saturating_add(additional);
        *consecutive_damage_ms = consecutive_damage_ms.saturating_add(additional_duration_ms);
    }
    Ok(())
}

fn append_unobserved_trailing_damage(
    tracker: &mut TimelineTracker,
    input_index: &mut u64,
    last_trustworthy_timestamp_ms: Option<i64>,
    consecutive_damage_ms: u64,
    source: &VideoSource,
    source_duration_ms: u64,
) -> Result<(), PipelineFailure> {
    let observed_end_ms = u64::try_from(last_trustworthy_timestamp_ms.unwrap_or(0).max(0))
        .unwrap_or(0)
        .saturating_add(source.frame_duration_ms)
        .saturating_add(consecutive_damage_ms);
    let remaining_ms = source_duration_ms.saturating_sub(observed_end_ms);
    let remaining_frames = remaining_ms.saturating_add(source.frame_duration_ms.saturating_sub(1))
        / source.frame_duration_ms.max(1);
    let additional = remaining_frames.min(source.expected_frames.saturating_sub(*input_index));
    if additional > 0 {
        tracker
            .observe_damaged_run(
                *input_index,
                i64::try_from(observed_end_ms).unwrap_or(i64::MAX),
                source.frame_duration_ms,
                additional,
            )
            .map_err(timeline_rejection)?;
        *input_index = input_index.saturating_add(additional);
    }
    Ok(())
}

fn timeline_rejection(error: crate::timeline::TimelineRejection) -> PipelineFailure {
    PipelineFailure::Rejected(
        format!("recovery_timeline_rejected: {error}"),
        Box::default(),
    )
}

fn tolerant_video_decoder(
    parameters: codec::Parameters,
    time_base: Rational,
) -> Result<decoder::Video, OperationalError> {
    let mut context = codec::Context::from_parameters(parameters).map_err(ffmpeg_operational(
        "failed to configure tolerant video decoder",
    ))?;
    context.set_threading(codec::threading::Config {
        kind: codec::threading::Type::Frame,
        count: 2,
    });
    let mut decoder = context.decoder();
    decoder.set_packet_time_base(time_base);
    decoder.conceal(
        decoder::Conceal::GUESS_MVS | decoder::Conceal::DEBLOCK | decoder::Conceal::FAVOR_INTER,
    );
    decoder.check(decoder::Check::BISTREAM | decoder::Check::BUFFER | decoder::Check::CAREFUL);
    let decoder = decoder
        .video()
        .map_err(ffmpeg_operational("failed to open tolerant video decoder"))?;
    validate_video_decoder_limits(&decoder, "tolerant recovery")?;
    Ok(decoder)
}

fn materially_different_frame_rates(average: Rational, nominal: Rational) -> bool {
    let average = f64::from(average);
    let nominal = f64::from(nominal);
    let maximum = average.max(nominal);
    maximum > 0.0 && (average - nominal).abs() / maximum > 0.05
}

fn frames_to_ms(frames: u64, frame_rate: Rational) -> u64 {
    if frame_rate.numerator() <= 0 || frame_rate.denominator() <= 0 {
        return 0;
    }
    ((frames as f64 / f64::from(frame_rate)) * 1_000.0)
        .round()
        .max(0.0) as u64
}

fn timestamp_to_ms(timestamp: i64, time_base: Rational) -> i64 {
    let numerator = i128::from(timestamp)
        .saturating_mul(i128::from(time_base.numerator()))
        .saturating_mul(1_000);
    let denominator = i128::from(time_base.denominator()).max(1);
    i64::try_from(numerator / denominator).unwrap_or_else(|_| {
        if numerator.is_negative() {
            i64::MIN
        } else {
            i64::MAX
        }
    })
}

fn timestamp_to_samples(timestamp: i64, time_base: Rational, rate: u32) -> i64 {
    let numerator = i128::from(timestamp)
        .saturating_mul(i128::from(time_base.numerator()))
        .saturating_mul(i128::from(rate));
    let denominator = i128::from(time_base.denominator()).max(1);
    i64::try_from(numerator / denominator).unwrap_or_else(|_| {
        if numerator.is_negative() {
            i64::MIN
        } else {
            i64::MAX
        }
    })
}

fn stream_start_ms(timestamp: i64, time_base: Rational) -> i64 {
    if timestamp == ffmpeg::sys::AV_NOPTS_VALUE {
        0
    } else {
        timestamp_to_ms(timestamp, time_base)
    }
}

fn retain_trustworthy_timestamp(
    previous: Option<i64>,
    candidate: i64,
    trustworthy: bool,
) -> Option<i64> {
    if trustworthy {
        Some(candidate)
    } else {
        previous
    }
}

fn timestamp_is_trustworthy(timestamp_ms: i64, previous: Option<i64>, duration_ms: u64) -> bool {
    timestamp_ms >= 0
        && u64::try_from(timestamp_ms).is_ok_and(|timestamp| timestamp < duration_ms)
        && previous.is_none_or(|last| timestamp_ms > last)
}

fn next_damage_timestamp(
    last_trustworthy_timestamp_ms: Option<i64>,
    consecutive_damage_ms: u64,
    frame_duration_ms: u64,
) -> i64 {
    let base = last_trustworthy_timestamp_ms.map_or(0_i64, |last| {
        last.saturating_add(i64::try_from(frame_duration_ms).unwrap_or(i64::MAX))
    });
    base.saturating_add(i64::try_from(consecutive_damage_ms).unwrap_or(i64::MAX))
}

fn milliseconds_to_samples_floor(milliseconds: u64) -> u64 {
    milliseconds.saturating_mul(u64::from(AUDIO_RATE)) / 1_000
}

fn milliseconds_to_samples_ceil(milliseconds: u64) -> u64 {
    milliseconds
        .saturating_mul(u64::from(AUDIO_RATE))
        .saturating_add(999)
        / 1_000
}

struct EncodedRecovery {
    stats: Stats,
    audio_format_changes: u32,
    skipped_audio_format_frames: u64,
}

fn encode_reconstruction(
    input_path: &Path,
    output_path: &Path,
    analysis: &VideoAnalysis,
) -> Result<EncodedRecovery, PipelineFailure> {
    let (target_width, target_height) = target_dimensions(
        analysis.source.video.width,
        analysis.source.video.height,
    )
    .ok_or_else(|| {
        PipelineFailure::Operational(OperationalError::new("invalid reconstruction dimensions"))
    })?;
    let mut muxer = NativeMuxer::new(
        output_path,
        target_width,
        target_height,
        analysis.source.video.frame_rate,
        analysis.source.audio.is_some(),
    )?;
    let mut input = open_local_input(input_path)?;
    let mut video_decoder = tolerant_video_decoder(
        analysis.source.video.parameters.clone(),
        analysis.source.video.time_base,
    )?;
    let mut video_rebuilder = VideoRebuilder::new(
        analysis.source.video.frame_duration_ms,
        target_width,
        target_height,
    );
    let mut audio_decoder = match analysis.source.audio.as_ref() {
        Some(source) => Some(tolerant_audio_decoder(
            source.parameters.clone(),
            source.time_base,
        )?),
        None => None,
    };
    let target_audio_samples = analysis
        .stats
        .output_duration_ms
        .saturating_mul(u64::from(AUDIO_RATE))
        / 1_000;
    let mut audio_rebuilder = match (analysis.source.audio.as_ref(), muxer.audio_format()) {
        (Some(source), Some(format)) => Some(AudioRebuilder::new(
            source.time_base,
            analysis.source.video.start_time_ms,
            analysis.first_timestamp_ms,
            target_audio_samples,
            format,
            &analysis.edit_map,
        )?),
        _ => None,
    };

    loop {
        let mut packet = Packet::empty();
        match packet.read(&mut input) {
            Ok(()) => {}
            Err(error) if is_recoverable_demux_end(error) => break,
            Err(error) => {
                return Err(PipelineFailure::Operational(OperationalError::new(
                    format!("reconstruction demux failed: {error}"),
                )));
            }
        }
        if packet.stream() == analysis.source.video.index {
            video_rebuilder.consume_packet(
                &packet,
                &mut video_decoder,
                &analysis.source.video,
                &mut muxer,
            )?;
        } else if analysis
            .source
            .audio
            .as_ref()
            .is_some_and(|source| source.index == packet.stream())
        {
            if let (Some(decoder), Some(rebuilder)) =
                (audio_decoder.as_mut(), audio_rebuilder.as_mut())
            {
                rebuilder.consume_packet(&packet, decoder, &mut muxer)?;
            }
        }
    }

    video_rebuilder.finish(
        &mut video_decoder,
        &analysis.source.video,
        analysis.source.duration_ms,
        &mut muxer,
    )?;
    if let (Some(decoder), Some(rebuilder)) = (audio_decoder.as_mut(), audio_rebuilder.as_mut()) {
        rebuilder.finish(decoder, &mut muxer)?;
    }
    muxer.finish()?;

    let rebuilt_summary = video_rebuilder.summary.ok_or_else(|| {
        PipelineFailure::Operational(OperationalError::new(
            "video reconstruction did not finalize its timeline",
        ))
    })?;
    if rebuilt_summary.output_frames != analysis.summary.output_frames
        || rebuilt_summary.removed_frames != analysis.summary.removed_frames
        || video_rebuilder.edit_map.as_ref() != Some(&analysis.edit_map)
    {
        return Err(PipelineFailure::Operational(OperationalError::new(
            "video decode changed between analysis and reconstruction passes",
        )));
    }

    let mut stats = analysis.stats.clone();
    stats.inserted_audio_silence_ms = audio_rebuilder
        .as_ref()
        .map_or(0, |rebuilder| rebuilder.inserted_silence_ms);
    Ok(EncodedRecovery {
        stats,
        audio_format_changes: audio_rebuilder
            .as_ref()
            .map_or(0, |rebuilder| rebuilder.format_changes),
        skipped_audio_format_frames: audio_rebuilder
            .as_ref()
            .map_or(0, |rebuilder| rebuilder.skipped_format_change_frames),
    })
}

struct NativeMuxer {
    output: format::context::Output,
    video_encoder: encoder::Video,
    video_stream_index: usize,
    video_encoder_time_base: Rational,
    video_stream_time_base: Rational,
    audio: Option<AudioWriter>,
}

struct AudioWriter {
    encoder: encoder::Audio,
    stream_index: usize,
    encoder_time_base: Rational,
    stream_time_base: Rational,
    sample_format: format::Sample,
    frame_size: usize,
}

impl NativeMuxer {
    fn new(
        output_path: &Path,
        width: u32,
        height: u32,
        frame_rate: Rational,
        include_audio: bool,
    ) -> Result<Self, OperationalError> {
        let mut output = format::output_as(output_path, "mp4")
            .map_err(ffmpeg_operational("failed to create reconstructed MP4"))?;
        let global_header = output
            .format()
            .flags()
            .contains(format::Flags::GLOBAL_HEADER);
        let x264 = encoder::find_by_name("libx264")
            .ok_or_else(|| OperationalError::new("libx264 encoder is unavailable"))?;
        let video_encoder_time_base = frame_rate.invert();
        let mut video = codec::Context::new_with_codec(x264)
            .encoder()
            .video()
            .map_err(ffmpeg_operational("failed to configure libx264 encoder"))?;
        video.set_width(width);
        video.set_height(height);
        video.set_format(format::Pixel::YUV420P);
        video.set_time_base(video_encoder_time_base);
        video.set_frame_rate(Some(frame_rate));
        video.set_gop(
            (f64::from(frame_rate) * 2.0)
                .round()
                .clamp(1.0, u32::MAX as f64) as u32,
        );
        video.set_max_b_frames(2);
        video.set_threading(codec::threading::Config {
            kind: codec::threading::Type::Frame,
            count: 2,
        });
        if global_header {
            video.set_flags(codec::Flags::GLOBAL_HEADER);
        }
        let mut video_options = Dictionary::new();
        video_options.set("preset", "veryfast");
        video_options.set("crf", "18");
        video_options.set("threads", "2");
        let video_encoder = video
            .open_as_with(x264, video_options)
            .map_err(ffmpeg_operational("failed to open libx264 encoder"))?;
        let video_stream_index;
        {
            let mut stream = output.add_stream(x264).map_err(ffmpeg_operational(
                "failed to add reconstructed video stream",
            ))?;
            stream.set_parameters(&video_encoder);
            stream.set_time_base(video_encoder_time_base);
            stream.set_rate(frame_rate);
            stream.set_avg_frame_rate(frame_rate);
            video_stream_index = stream.index();
        }

        let audio = if include_audio {
            let aac = encoder::find(codec::Id::AAC)
                .ok_or_else(|| OperationalError::new("AAC encoder is unavailable"))?;
            let descriptor = aac
                .audio()
                .map_err(ffmpeg_operational("failed to inspect AAC encoder"))?;
            let preferred = format::Sample::F32(format::sample::Type::Planar);
            let sample_format = descriptor
                .formats()
                .and_then(|formats| {
                    let supported: Vec<_> = formats.collect();
                    supported
                        .iter()
                        .copied()
                        .find(|format| *format == preferred)
                        .or_else(|| supported.first().copied())
                })
                .ok_or_else(|| OperationalError::new("AAC exposes no sample format"))?;
            let encoder_time_base = Rational(1, AUDIO_RATE as i32);
            let mut audio_encoder = codec::Context::new_with_codec(aac)
                .encoder()
                .audio()
                .map_err(ffmpeg_operational("failed to configure AAC encoder"))?;
            audio_encoder.set_rate(AUDIO_RATE as i32);
            audio_encoder.set_channel_layout(ffmpeg::ChannelLayout::STEREO);
            audio_encoder.set_format(sample_format);
            audio_encoder.set_bit_rate(AUDIO_BIT_RATE);
            audio_encoder.set_time_base(encoder_time_base);
            audio_encoder.set_threading(codec::threading::Config {
                kind: codec::threading::Type::Frame,
                count: 2,
            });
            if global_header {
                audio_encoder.set_flags(codec::Flags::GLOBAL_HEADER);
            }
            let encoder = audio_encoder
                .open_as(aac)
                .map_err(ffmpeg_operational("failed to open AAC encoder"))?;
            let stream_index;
            {
                let mut stream = output.add_stream(aac).map_err(ffmpeg_operational(
                    "failed to add reconstructed audio stream",
                ))?;
                stream.set_parameters(&encoder);
                stream.set_time_base(encoder_time_base);
                stream_index = stream.index();
            }
            let frame_size = usize::try_from(encoder.frame_size())
                .unwrap_or(1_024)
                .max(1);
            Some(AudioWriter {
                encoder,
                stream_index,
                encoder_time_base,
                stream_time_base: encoder_time_base,
                sample_format,
                frame_size,
            })
        } else {
            None
        };

        let mut header_options = Dictionary::new();
        header_options.set("movflags", "+faststart");
        header_options.set("avoid_negative_ts", "make_zero");
        output
            .write_header_with(header_options)
            .map_err(ffmpeg_operational(
                "failed to write reconstructed MP4 header",
            ))?;
        let video_stream_time_base = output
            .stream(video_stream_index)
            .ok_or_else(|| OperationalError::new("video output stream disappeared"))?
            .time_base();
        let mut audio = audio;
        if let Some(writer) = audio.as_mut() {
            writer.stream_time_base = output
                .stream(writer.stream_index)
                .ok_or_else(|| OperationalError::new("audio output stream disappeared"))?
                .time_base();
        }

        Ok(Self {
            output,
            video_encoder,
            video_stream_index,
            video_encoder_time_base,
            video_stream_time_base,
            audio,
        })
    }

    fn audio_format(&self) -> Option<format::Sample> {
        self.audio.as_ref().map(|writer| writer.sample_format)
    }

    fn audio_frame_size(&self) -> Option<usize> {
        self.audio.as_ref().map(|writer| writer.frame_size)
    }

    fn write_video_frame(&mut self, frame: &ffmpeg::frame::Video) -> Result<(), OperationalError> {
        self.video_encoder
            .send_frame(frame)
            .map_err(ffmpeg_operational("libx264 rejected a reconstructed frame"))?;
        self.drain_video()
    }

    fn drain_video(&mut self) -> Result<(), OperationalError> {
        loop {
            let mut packet = Packet::empty();
            match self.video_encoder.receive_packet(&mut packet) {
                Ok(()) => {
                    packet.set_stream(self.video_stream_index);
                    packet.rescale_ts(self.video_encoder_time_base, self.video_stream_time_base);
                    packet
                        .write_interleaved(&mut self.output)
                        .map_err(ffmpeg_operational(
                            "failed to mux reconstructed video packet",
                        ))?;
                }
                Err(error) if is_again_or_eof(error) => return Ok(()),
                Err(error) => {
                    return Err(OperationalError::new(format!(
                        "failed to receive encoded video packet: {error}"
                    )));
                }
            }
        }
    }

    fn write_audio_frame(&mut self, frame: &ffmpeg::frame::Audio) -> Result<(), OperationalError> {
        let writer = self
            .audio
            .as_mut()
            .ok_or_else(|| OperationalError::new("audio writer is unavailable"))?;
        writer
            .encoder
            .send_frame(frame)
            .map_err(ffmpeg_operational(
                "AAC rejected a reconstructed audio frame",
            ))?;
        self.drain_audio()
    }

    fn drain_audio(&mut self) -> Result<(), OperationalError> {
        let Some(writer) = self.audio.as_mut() else {
            return Ok(());
        };
        loop {
            let mut packet = Packet::empty();
            match writer.encoder.receive_packet(&mut packet) {
                Ok(()) => {
                    packet.set_stream(writer.stream_index);
                    packet.rescale_ts(writer.encoder_time_base, writer.stream_time_base);
                    packet
                        .write_interleaved(&mut self.output)
                        .map_err(ffmpeg_operational(
                            "failed to mux reconstructed audio packet",
                        ))?;
                }
                Err(error) if is_again_or_eof(error) => return Ok(()),
                Err(error) => {
                    return Err(OperationalError::new(format!(
                        "failed to receive encoded audio packet: {error}"
                    )));
                }
            }
        }
    }

    fn finish(&mut self) -> Result<(), OperationalError> {
        self.video_encoder
            .send_eof()
            .map_err(ffmpeg_operational("failed to flush libx264 encoder"))?;
        self.drain_video()?;
        if let Some(writer) = self.audio.as_mut() {
            writer
                .encoder
                .send_eof()
                .map_err(ffmpeg_operational("failed to flush AAC encoder"))?;
            self.drain_audio()?;
        }
        self.output
            .write_trailer()
            .map_err(ffmpeg_operational("failed to finish reconstructed MP4"))
    }
}

struct VideoRebuilder {
    tracker: Option<TimelineTracker>,
    input_index: u64,
    last_trustworthy_timestamp_ms: Option<i64>,
    consecutive_damage_ms: u64,
    scaler: Option<scaling::Context>,
    target_width: u32,
    target_height: u32,
    output_index: u64,
    summary: Option<TimelineSummary>,
    edit_map: Option<EditMap>,
    frame_duration_ms: u64,
}

impl VideoRebuilder {
    fn new(frame_duration_ms: u64, target_width: u32, target_height: u32) -> Self {
        Self {
            tracker: Some(TimelineTracker::new()),
            input_index: 0,
            last_trustworthy_timestamp_ms: None,
            consecutive_damage_ms: 0,
            scaler: None,
            target_width,
            target_height,
            output_index: 0,
            summary: None,
            edit_map: None,
            frame_duration_ms,
        }
    }

    fn consume_packet(
        &mut self,
        packet: &Packet,
        decoder: &mut decoder::Video,
        source: &VideoSource,
        muxer: &mut NativeMuxer,
    ) -> Result<(), PipelineFailure> {
        if packet.is_corrupt() {
            self.observe_damage(self.synthetic_timestamp())?;
            return Ok(());
        }
        if let Err(error) = decoder.send_packet(packet) {
            if !is_again_or_eof(error) {
                self.observe_damage(self.synthetic_timestamp())?;
            }
        }
        self.drain_frames(decoder, source, muxer)
    }

    fn drain_frames(
        &mut self,
        decoder: &mut decoder::Video,
        source: &VideoSource,
        muxer: &mut NativeMuxer,
    ) -> Result<(), PipelineFailure> {
        loop {
            let mut frame = ffmpeg::frame::Video::empty();
            match decoder.receive_frame(&mut frame) {
                Ok(()) => {
                    let timestamp_ms = frame
                        .timestamp()
                        .map(|timestamp| {
                            timestamp_to_ms(timestamp, source.time_base)
                                .saturating_sub(source.start_time_ms)
                        })
                        .unwrap_or_else(|| self.synthetic_timestamp());
                    let timestamp_valid = timestamp_is_trustworthy(
                        timestamp_ms,
                        self.last_trustworthy_timestamp_ms,
                        source.duration_ms,
                    );
                    let clean = valid_video_frame(&frame)
                        && timestamp_valid
                        && self.input_index < source.expected_frames;
                    if clean {
                        self.infer_missing(timestamp_ms, source)?;
                        self.consecutive_damage_ms = 0;
                        let observation = FrameObservation::clean(
                            self.input_index,
                            timestamp_ms,
                            source.frame_duration_ms,
                            frame.is_key(),
                        );
                        let actions = self
                            .tracker
                            .as_mut()
                            .expect("active tracker")
                            .observe(observation)
                            .map_err(timeline_rejection)?;
                        self.apply_actions(actions, Some(&frame), muxer)?;
                        self.input_index = self.input_index.saturating_add(1);
                    } else {
                        let damage_timestamp_ms = if timestamp_valid {
                            timestamp_ms
                        } else {
                            self.synthetic_timestamp()
                        };
                        self.observe_damage(damage_timestamp_ms)?;
                    }
                    self.last_trustworthy_timestamp_ms = retain_trustworthy_timestamp(
                        self.last_trustworthy_timestamp_ms,
                        timestamp_ms,
                        clean,
                    );
                }
                Err(error) if is_again_or_eof(error) => return Ok(()),
                Err(_) => {
                    let timestamp_ms = self.synthetic_timestamp();
                    self.observe_damage(timestamp_ms)?;
                    return Ok(());
                }
            }
        }
    }

    fn observe_damage(&mut self, timestamp_ms: i64) -> Result<(), PipelineFailure> {
        self.consecutive_damage_ms = self
            .consecutive_damage_ms
            .saturating_add(self.frame_duration_ms);
        let actions = self
            .tracker
            .as_mut()
            .expect("active tracker")
            .observe(FrameObservation::damaged(
                self.input_index,
                timestamp_ms,
                self.frame_duration_ms,
            ))
            .map_err(timeline_rejection)?;
        debug_assert!(actions.is_empty());
        self.input_index = self.input_index.saturating_add(1);
        Ok(())
    }

    fn apply_actions(
        &mut self,
        actions: Vec<TimelineAction>,
        current: Option<&ffmpeg::frame::Video>,
        muxer: &mut NativeMuxer,
    ) -> Result<(), PipelineFailure> {
        for action in actions {
            match action {
                TimelineAction::Keep { output_index, .. } => {
                    if output_index != self.output_index {
                        return Err(PipelineFailure::Operational(OperationalError::new(
                            "timeline output index diverged while cutting damaged frames",
                        )));
                    }
                    let source = current.ok_or_else(|| {
                        PipelineFailure::Operational(OperationalError::new(
                            "timeline requested a clean frame without decoded pixels",
                        ))
                    })?;
                    let scaled = self.scale(source)?;
                    let mut encoded = scaled.clone();
                    encoded.set_pts(Some(self.output_index as i64));
                    muxer.write_video_frame(&encoded)?;
                    self.output_index = self.output_index.saturating_add(1);
                }
            }
        }
        Ok(())
    }

    fn scale(
        &mut self,
        source: &ffmpeg::frame::Video,
    ) -> Result<ffmpeg::frame::Video, PipelineFailure> {
        if self.scaler.is_none() {
            self.scaler = Some(
                scaling::Context::get(
                    source.format(),
                    source.width(),
                    source.height(),
                    format::Pixel::YUV420P,
                    self.target_width,
                    self.target_height,
                    scaling::Flags::BILINEAR,
                )
                .map_err(|error| {
                    PipelineFailure::Operational(OperationalError::new(format!(
                        "failed to initialize video scaler: {error}"
                    )))
                })?,
            );
        }
        let mut output = ffmpeg::frame::Video::empty();
        self.scaler
            .as_mut()
            .expect("initialized scaler")
            .run(source, &mut output)
            .map_err(|error| {
                PipelineFailure::Operational(OperationalError::new(format!(
                    "failed to scale recovered frame: {error}"
                )))
            })?;
        output.set_kind(ffmpeg::picture::Type::None);
        Ok(output)
    }

    fn synthetic_timestamp(&self) -> i64 {
        next_damage_timestamp(
            self.last_trustworthy_timestamp_ms,
            self.consecutive_damage_ms,
            self.frame_duration_ms,
        )
    }

    fn infer_missing(
        &mut self,
        current_timestamp_ms: i64,
        source: &VideoSource,
    ) -> Result<(), PipelineFailure> {
        infer_missing_observations(
            self.tracker.as_mut().expect("active tracker"),
            &mut self.input_index,
            self.last_trustworthy_timestamp_ms,
            current_timestamp_ms,
            source.frame_duration_ms,
            source.frame_rate,
            source.expected_frames,
            source.duration_ms,
            &mut self.consecutive_damage_ms,
        )
    }

    fn finish(
        &mut self,
        decoder: &mut decoder::Video,
        source: &VideoSource,
        source_duration_ms: u64,
        muxer: &mut NativeMuxer,
    ) -> Result<(), PipelineFailure> {
        if let Err(error) = decoder.send_eof() {
            if !is_again_or_eof(error) {
                return Err(PipelineFailure::Operational(OperationalError::new(
                    format!("failed to flush reconstruction decoder: {error}"),
                )));
            }
        }
        self.drain_frames(decoder, source, muxer)?;
        append_unobserved_trailing_damage(
            self.tracker.as_mut().expect("active tracker"),
            &mut self.input_index,
            self.last_trustworthy_timestamp_ms,
            self.consecutive_damage_ms,
            source,
            source_duration_ms,
        )?;
        let timeline = self
            .tracker
            .take()
            .expect("active tracker")
            .finish(source_duration_ms, source.expected_frames);
        let summary = timeline.summary;
        if summary.output_frames != self.output_index {
            return Err(PipelineFailure::Operational(OperationalError::new(
                "timeline and encoder output frame counts diverged",
            )));
        }
        self.summary = Some(summary);
        self.edit_map = Some(timeline.edit_map);
        Ok(())
    }
}

fn tolerant_audio_decoder(
    parameters: codec::Parameters,
    time_base: Rational,
) -> Result<decoder::Audio, OperationalError> {
    let mut context = codec::Context::from_parameters(parameters).map_err(ffmpeg_operational(
        "failed to configure tolerant audio decoder",
    ))?;
    context.set_threading(codec::threading::Config {
        kind: codec::threading::Type::Frame,
        count: 2,
    });
    let mut decoder = context.decoder();
    decoder.set_packet_time_base(time_base);
    decoder.conceal(
        decoder::Conceal::GUESS_MVS | decoder::Conceal::DEBLOCK | decoder::Conceal::FAVOR_INTER,
    );
    decoder.check(decoder::Check::BISTREAM | decoder::Check::BUFFER | decoder::Check::CAREFUL);
    let decoder = decoder
        .audio()
        .map_err(ffmpeg_operational("failed to open tolerant audio decoder"))?;
    validate_audio_decoder_limits(&decoder, "tolerant recovery")?;
    Ok(decoder)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct AudioCut {
    start_sample: i64,
    end_sample: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct AudioSlice {
    source_offset: usize,
    sample_count: usize,
    target_start: u64,
}

#[derive(Clone, Debug)]
struct AudioEditMap {
    origin_sample: i64,
    cuts: Vec<AudioCut>,
}

impl AudioEditMap {
    fn new(video_start_ms: i64, edit_map: &EditMap) -> Self {
        let origin_sample = video_start_ms.max(0).saturating_mul(i64::from(AUDIO_RATE)) / 1_000;
        let mut cuts = Vec::new();
        for cut in edit_map.cuts() {
            let start_sample =
                i64::try_from(milliseconds_to_samples_floor(cut.start_ms)).unwrap_or(i64::MAX);
            let end_sample =
                i64::try_from(milliseconds_to_samples_ceil(cut.end_ms)).unwrap_or(i64::MAX);
            let start_sample = start_sample.max(origin_sample);
            if end_sample > start_sample {
                cuts.push(AudioCut {
                    start_sample,
                    end_sample,
                });
            }
        }
        Self {
            origin_sample,
            cuts,
        }
    }

    fn retained_slices(&self, source_start: i64, sample_count: usize) -> Vec<AudioSlice> {
        if sample_count == 0 {
            return Vec::new();
        }
        let source_end =
            source_start.saturating_add(i64::try_from(sample_count).unwrap_or(i64::MAX));
        let mut cursor = source_start.max(self.origin_sample);
        if cursor >= source_end {
            return Vec::new();
        }

        let mut slices = Vec::new();
        for cut in &self.cuts {
            if cut.end_sample <= cursor {
                continue;
            }
            if cut.start_sample >= source_end {
                break;
            }
            if cursor < cut.start_sample {
                self.push_slice(
                    source_start,
                    cursor,
                    cut.start_sample.min(source_end),
                    &mut slices,
                );
            }
            cursor = cursor.max(cut.end_sample);
            if cursor >= source_end {
                break;
            }
        }
        if cursor < source_end {
            self.push_slice(source_start, cursor, source_end, &mut slices);
        }
        slices
    }

    fn push_slice(
        &self,
        source_start: i64,
        slice_start: i64,
        slice_end: i64,
        slices: &mut Vec<AudioSlice>,
    ) {
        if slice_end <= slice_start {
            return;
        }
        let Some(target_start) = self.compacted_sample(slice_start) else {
            return;
        };
        let Ok(source_offset) = usize::try_from(slice_start.saturating_sub(source_start)) else {
            return;
        };
        let Ok(sample_count) = usize::try_from(slice_end.saturating_sub(slice_start)) else {
            return;
        };
        if sample_count > 0 {
            slices.push(AudioSlice {
                source_offset,
                sample_count,
                target_start,
            });
        }
    }

    fn compacted_sample(&self, source_sample: i64) -> Option<u64> {
        if source_sample < self.origin_sample {
            return None;
        }
        let mut removed_before = 0_i64;
        for cut in &self.cuts {
            if source_sample < cut.start_sample {
                break;
            }
            if source_sample < cut.end_sample {
                return None;
            }
            removed_before =
                removed_before.saturating_add(cut.end_sample.saturating_sub(cut.start_sample));
        }
        u64::try_from(
            source_sample
                .saturating_sub(self.origin_sample)
                .saturating_sub(removed_before),
        )
        .ok()
    }
}

struct AudioRebuilder {
    source_time_base: Rational,
    source_timeline_start_sample: i64,
    edit_map: AudioEditMap,
    target_samples: u64,
    output_format: format::Sample,
    resampler: Option<resampling::Context>,
    resampler_input: Option<(format::Sample, ffmpeg::ChannelLayout, u32)>,
    fifo: AudioFifo,
    next_sample: u64,
    emitted_samples: u64,
    inserted_silence_samples: u64,
    inserted_silence_ms: u64,
    last_timestamp: Option<i64>,
    resampler_source_cursor: Option<i64>,
    format_changes: u32,
    skipped_format_change_frames: u64,
}

impl AudioRebuilder {
    fn new(
        source_time_base: Rational,
        source_timeline_start_ms: i64,
        video_start_ms: i64,
        target_samples: u64,
        output_format: format::Sample,
        edit_map: &EditMap,
    ) -> Result<Self, OperationalError> {
        Ok(Self {
            source_time_base,
            source_timeline_start_sample: source_timeline_start_ms
                .saturating_mul(i64::from(AUDIO_RATE))
                / 1_000,
            edit_map: AudioEditMap::new(video_start_ms, edit_map),
            target_samples,
            output_format,
            resampler: None,
            resampler_input: None,
            fifo: AudioFifo::new(output_format, ffmpeg::ChannelLayout::STEREO)?,
            next_sample: 0,
            emitted_samples: 0,
            inserted_silence_samples: 0,
            inserted_silence_ms: 0,
            last_timestamp: None,
            resampler_source_cursor: None,
            format_changes: 0,
            skipped_format_change_frames: 0,
        })
    }

    fn consume_packet(
        &mut self,
        packet: &Packet,
        decoder: &mut decoder::Audio,
        muxer: &mut NativeMuxer,
    ) -> Result<(), PipelineFailure> {
        if packet.is_corrupt() {
            return Ok(());
        }
        if let Err(error) = decoder.send_packet(packet) {
            if !is_again_or_eof(error) {
                return Ok(());
            }
        }
        self.drain_decoder(decoder, muxer)
    }

    fn drain_decoder(
        &mut self,
        decoder: &mut decoder::Audio,
        muxer: &mut NativeMuxer,
    ) -> Result<(), PipelineFailure> {
        loop {
            let mut frame = ffmpeg::frame::Audio::empty();
            match decoder.receive_frame(&mut frame) {
                Ok(()) => {
                    if !valid_audio_frame(&frame) || frame.timestamp().is_none() {
                        continue;
                    }
                    let timestamp = frame.timestamp().expect("checked");
                    if self.last_timestamp.is_some_and(|last| timestamp <= last) {
                        continue;
                    }
                    self.last_timestamp = Some(timestamp);
                    self.process_frame(&frame, timestamp, muxer)?;
                }
                Err(error) if is_again_or_eof(error) => return Ok(()),
                Err(_) => return Ok(()),
            }
        }
    }

    fn process_frame(
        &mut self,
        frame: &ffmpeg::frame::Audio,
        timestamp: i64,
        muxer: &mut NativeMuxer,
    ) -> Result<(), PipelineFailure> {
        let layout = if frame.channel_layout().is_empty() {
            ffmpeg::ChannelLayout::default(i32::from(frame.channels()))
        } else {
            frame.channel_layout()
        };
        let definition = (frame.format(), layout, frame.rate());
        if self
            .resampler_input
            .is_some_and(|current| current != definition)
        {
            if self.format_changes >= MAX_AUDIO_FORMAT_CHANGES {
                self.skipped_format_change_frames =
                    self.skipped_format_change_frames.saturating_add(1);
                return Ok(());
            }
            self.flush_resampler(muxer)?;
            self.resampler = None;
            self.resampler_input = None;
            self.format_changes = self.format_changes.saturating_add(1);
        }
        if self.resampler.is_none() {
            self.resampler = Some(
                resampling::Context::get(
                    frame.format(),
                    layout,
                    frame.rate(),
                    self.output_format,
                    ffmpeg::ChannelLayout::STEREO,
                    AUDIO_RATE,
                )
                .map_err(|error| {
                    PipelineFailure::Operational(OperationalError::new(format!(
                        "failed to initialize audio resampler: {error}"
                    )))
                })?,
            );
            self.resampler_input = Some(definition);
        }

        let delayed_samples = self
            .resampler
            .as_ref()
            .and_then(|resampler| resampler.delay())
            .map_or(Ok(0_u64), |delay| {
                u64::try_from(delay.output).map_err(|_| {
                    PipelineFailure::Operational(OperationalError::new(
                        "audio resampler reported a negative delay",
                    ))
                })
            })?;
        let input_samples = u64::try_from(frame.samples()).map_err(|_| {
            PipelineFailure::Operational(OperationalError::new(
                "decoded audio sample count cannot be represented",
            ))
        })?;
        let converted_capacity = input_samples
            .checked_mul(u64::from(AUDIO_RATE))
            .and_then(|value| value.checked_add(u64::from(frame.rate()).saturating_sub(1)))
            .map(|value| value / u64::from(frame.rate()))
            .and_then(|value| value.checked_add(delayed_samples))
            .and_then(|value| value.checked_add(32))
            .ok_or_else(|| {
                PipelineFailure::Operational(OperationalError::new(
                    "resampled audio capacity overflowed",
                ))
            })?;
        let converted_capacity = usize::try_from(converted_capacity).map_err(|_| {
            PipelineFailure::Operational(OperationalError::new(
                "resampled audio capacity cannot be represented",
            ))
        })?;
        if converted_capacity == 0 || converted_capacity > MAX_RESAMPLED_AUDIO_FRAME_SAMPLES {
            return Err(PipelineFailure::Rejected(
                "recovery_audio_frame_exceeds_limits".into(),
                Box::default(),
            ));
        }
        let mut converted = ffmpeg::frame::Audio::new(
            self.output_format,
            converted_capacity,
            ffmpeg::ChannelLayout::STEREO,
        );
        ensure_audio_frame_allocated(&converted, "failed to allocate the resampled audio frame")
            .map_err(PipelineFailure::Operational)?;
        converted.set_rate(AUDIO_RATE);
        self.resampler
            .as_mut()
            .expect("initialized resampler")
            .run(frame, &mut converted)
            .map_err(|error| {
                PipelineFailure::Operational(OperationalError::new(format!(
                    "failed to resample recovered audio: {error}"
                )))
            })?;
        let delayed_samples = i64::try_from(delayed_samples).map_err(|_| {
            PipelineFailure::Operational(OperationalError::new(
                "audio resampler delay cannot be represented",
            ))
        })?;
        let source_start = timestamp_to_samples(timestamp, self.source_time_base, AUDIO_RATE)
            .saturating_sub(self.source_timeline_start_sample)
            .saturating_sub(delayed_samples);
        self.resampler_source_cursor = Some(
            source_start.saturating_add(i64::try_from(converted.samples()).unwrap_or(i64::MAX)),
        );
        if converted.samples() == 0 {
            return Ok(());
        }
        if converted.samples() > converted_capacity
            || converted.samples() > MAX_RESAMPLED_AUDIO_FRAME_SAMPLES
        {
            return Err(PipelineFailure::Operational(OperationalError::new(
                "audio resampler exceeded its bounded output frame",
            )));
        }
        if !audio_samples_are_finite(&converted, 2) {
            return Ok(());
        }

        let slices = self
            .edit_map
            .retained_slices(source_start, converted.samples());
        for slice in slices {
            self.write_edited_slice(&converted, slice, muxer)?;
        }
        Ok(())
    }

    fn write_edited_slice(
        &mut self,
        converted: &ffmpeg::frame::Audio,
        slice: AudioSlice,
        muxer: &mut NativeMuxer,
    ) -> Result<(), PipelineFailure> {
        let mut target_start = slice.target_start;
        let mut source_offset = slice.source_offset as u64;
        let mut count = slice.sample_count as u64;
        if target_start < self.next_sample {
            let overlap = self.next_sample - target_start;
            source_offset = source_offset.saturating_add(overlap);
            count = count.saturating_sub(overlap);
            target_start = self.next_sample;
        }
        if target_start > self.next_sample {
            self.insert_silence(target_start - self.next_sample, muxer)?;
        }
        if count == 0
            || source_offset >= converted.samples() as u64
            || self.next_sample >= self.target_samples
        {
            return Ok(());
        }
        let available = (converted.samples() as u64).saturating_sub(source_offset);
        let remaining = self.target_samples - self.next_sample;
        count = count.min(available).min(remaining);
        let source_offset = usize::try_from(source_offset).map_err(|_| {
            PipelineFailure::Operational(OperationalError::new(
                "resampled audio offset cannot be represented",
            ))
        })?;
        let count = usize::try_from(count).map_err(|_| {
            PipelineFailure::Operational(OperationalError::new(
                "resampled audio count cannot be represented",
            ))
        })?;
        self.fifo
            .write_frame(&converted, source_offset, count)
            .map_err(PipelineFailure::Operational)?;
        self.next_sample = self.next_sample.saturating_add(count as u64);
        self.drain_full_frames(muxer)
    }

    fn insert_silence(
        &mut self,
        requested_samples: u64,
        muxer: &mut NativeMuxer,
    ) -> Result<(), PipelineFailure> {
        let mut remaining =
            requested_samples.min(self.target_samples.saturating_sub(self.next_sample));
        while remaining > 0 {
            let chunk = bounded_audio_silence_chunk(remaining);
            self.fifo
                .write_silence(chunk)
                .map_err(PipelineFailure::Operational)?;
            self.next_sample = self.next_sample.saturating_add(chunk as u64);
            self.inserted_silence_samples =
                self.inserted_silence_samples.saturating_add(chunk as u64);
            remaining = remaining.saturating_sub(chunk as u64);
            self.drain_full_frames(muxer)?;
        }
        self.inserted_silence_ms =
            self.inserted_silence_samples.saturating_mul(1_000) / u64::from(AUDIO_RATE);
        Ok(())
    }

    fn drain_full_frames(&mut self, muxer: &mut NativeMuxer) -> Result<(), PipelineFailure> {
        let frame_size = muxer.audio_frame_size().ok_or_else(|| {
            PipelineFailure::Operational(OperationalError::new("audio frame size is unavailable"))
        })?;
        while self.fifo.len() >= frame_size {
            let frame = self
                .fifo
                .read(frame_size, frame_size, self.emitted_samples)
                .map_err(PipelineFailure::Operational)?;
            muxer.write_audio_frame(&frame)?;
            self.emitted_samples = self.emitted_samples.saturating_add(frame_size as u64);
        }
        Ok(())
    }

    fn finish(
        &mut self,
        decoder: &mut decoder::Audio,
        muxer: &mut NativeMuxer,
    ) -> Result<(), PipelineFailure> {
        if let Err(error) = decoder.send_eof() {
            if !is_again_or_eof(error) {
                return Err(PipelineFailure::Operational(OperationalError::new(
                    format!("failed to flush recovered audio decoder: {error}"),
                )));
            }
        }
        self.drain_decoder(decoder, muxer)?;
        self.flush_resampler(muxer)?;
        if self.next_sample < self.target_samples {
            self.insert_silence(self.target_samples - self.next_sample, muxer)?;
        }
        self.drain_full_frames(muxer)?;
        let remaining = self.fifo.len();
        if remaining > 0 {
            let frame_size = muxer.audio_frame_size().ok_or_else(|| {
                PipelineFailure::Operational(OperationalError::new(
                    "audio frame size is unavailable",
                ))
            })?;
            let frame = self
                .fifo
                .read(remaining, frame_size, self.emitted_samples)
                .map_err(PipelineFailure::Operational)?;
            muxer.write_audio_frame(&frame)?;
            self.emitted_samples = self.emitted_samples.saturating_add(remaining as u64);
        }
        self.inserted_silence_samples = self
            .inserted_silence_samples
            .saturating_add(self.fifo.replaced_non_finite_samples);
        self.inserted_silence_ms =
            self.inserted_silence_samples.saturating_mul(1_000) / u64::from(AUDIO_RATE);
        Ok(())
    }

    fn flush_resampler(&mut self, muxer: &mut NativeMuxer) -> Result<(), PipelineFailure> {
        if self.resampler.is_none() {
            return Ok(());
        }
        loop {
            let mut converted =
                ffmpeg::frame::Audio::new(self.output_format, 4_096, ffmpeg::ChannelLayout::STEREO);
            ensure_audio_frame_allocated(
                &converted,
                "failed to allocate the audio resampler flush frame",
            )
            .map_err(PipelineFailure::Operational)?;
            converted.set_rate(AUDIO_RATE);
            let remaining = self
                .resampler
                .as_mut()
                .expect("checked resampler")
                .flush(&mut converted)
                .map_err(|error| {
                    PipelineFailure::Operational(OperationalError::new(format!(
                        "failed to flush audio resampler: {error}"
                    )))
                })?;
            let count = converted.samples() as u64;
            if count > 0 {
                let count = usize::try_from(count).map_err(|_| {
                    PipelineFailure::Operational(OperationalError::new(
                        "flushed audio count cannot be represented",
                    ))
                })?;
                let source_start = self.resampler_source_cursor.unwrap_or(0);
                let slices = self.edit_map.retained_slices(source_start, count);
                self.resampler_source_cursor =
                    Some(source_start.saturating_add(i64::try_from(count).unwrap_or(i64::MAX)));
                if audio_samples_are_finite(&converted, 2) {
                    for slice in slices {
                        self.write_edited_slice(&converted, slice, muxer)?;
                    }
                }
            }
            if remaining.is_none() || count == 0 {
                break;
            }
        }
        Ok(())
    }
}

fn bounded_audio_silence_chunk(remaining_samples: u64) -> usize {
    usize::try_from(remaining_samples.min(AUDIO_SILENCE_CHUNK_SAMPLES))
        .expect("the configured audio-silence chunk fits usize")
}

struct AudioFifo {
    pointer: *mut ffmpeg::sys::AVAudioFifo,
    format: format::Sample,
    layout: ffmpeg::ChannelLayout,
    channels: usize,
    replaced_non_finite_samples: u64,
}

impl AudioFifo {
    fn new(
        format: format::Sample,
        layout: ffmpeg::ChannelLayout,
    ) -> Result<Self, OperationalError> {
        if format == format::Sample::None || format.bytes() == 0 {
            return Err(OperationalError::new("invalid audio FIFO sample format"));
        }
        let channels = usize::try_from(layout.channels())
            .map_err(|_| OperationalError::new("invalid audio channel count"))?;
        if channels == 0 || channels > MAX_SOURCE_AUDIO_CHANNELS as usize {
            return Err(OperationalError::new(
                "audio FIFO channel count exceeds the safety limit",
            ));
        }
        let channels_i32 = i32::try_from(channels)
            .map_err(|_| OperationalError::new("invalid audio FIFO channel count"))?;
        let pointer = unsafe { ffmpeg::sys::av_audio_fifo_alloc(format.into(), channels_i32, 1) };
        if pointer.is_null() {
            return Err(OperationalError::new("failed to allocate audio FIFO"));
        }
        Ok(Self {
            pointer,
            format,
            layout,
            channels,
            replaced_non_finite_samples: 0,
        })
    }

    fn len(&self) -> usize {
        usize::try_from(unsafe { ffmpeg::sys::av_audio_fifo_size(self.pointer) }).unwrap_or(0)
    }

    fn write_silence(&mut self, samples: usize) -> Result<(), OperationalError> {
        if samples == 0 || samples > MAX_AUDIO_FIFO_SAMPLES {
            return Err(OperationalError::new(
                "audio silence allocation exceeds the safety limit",
            ));
        }
        let mut frame = ffmpeg::frame::Audio::new(self.format, samples, self.layout);
        ensure_audio_frame_allocated(&frame, "failed to allocate an audio silence frame")?;
        frame.set_rate(AUDIO_RATE);
        zero_audio_frame(&mut frame, "failed to zero an audio silence frame")?;
        self.write_frame(&frame, 0, samples)
    }

    fn write_frame(
        &mut self,
        frame: &ffmpeg::frame::Audio,
        offset: usize,
        samples: usize,
    ) -> Result<(), OperationalError> {
        if samples == 0 {
            return Ok(());
        }
        ensure_audio_frame_allocated(frame, "audio FIFO received an unallocated frame")?;
        let source_end = offset
            .checked_add(samples)
            .ok_or_else(|| OperationalError::new("audio FIFO source range overflowed"))?;
        if source_end > frame.samples() {
            return Err(OperationalError::new(
                "audio FIFO write exceeded the source frame",
            ));
        }
        let required = self
            .len()
            .checked_add(samples)
            .ok_or_else(|| OperationalError::new("audio FIFO capacity overflowed"))?;
        if required > MAX_AUDIO_FIFO_SAMPLES {
            return Err(OperationalError::new(
                "audio FIFO capacity exceeds the safety limit",
            ));
        }
        let required_i32 = i32::try_from(required)
            .map_err(|_| OperationalError::new("audio FIFO capacity cannot be represented"))?;
        let resize = unsafe { ffmpeg::sys::av_audio_fifo_realloc(self.pointer, required_i32) };
        if resize < 0 {
            return Err(OperationalError::new(
                "failed to expand reconstructed audio FIFO",
            ));
        }

        let plane_count = if self.format.is_planar() {
            self.channels
        } else {
            1
        };
        if frame.planes() < plane_count {
            return Err(OperationalError::new(
                "audio FIFO source frame has incomplete planes",
            ));
        }
        let bytes_per_plane_sample = self.format.bytes()
            * if self.format.is_planar() {
                1
            } else {
                self.channels
            };
        let byte_offset = offset
            .checked_mul(bytes_per_plane_sample)
            .ok_or_else(|| OperationalError::new("audio FIFO byte offset overflowed"))?;
        let sample_count_i32 = i32::try_from(samples)
            .map_err(|_| OperationalError::new("audio FIFO write count cannot be represented"))?;
        let mut pointers = Vec::with_capacity(plane_count);
        unsafe {
            let extended_data = (*frame.as_ptr()).extended_data;
            if extended_data.is_null() {
                return Err(OperationalError::new(
                    "audio FIFO source frame has no plane table",
                ));
            }
            for plane in 0..plane_count {
                let base = *extended_data.add(plane);
                if base.is_null() {
                    return Err(OperationalError::new(
                        "audio FIFO source frame contains a null plane",
                    ));
                }
                pointers.push(base.add(byte_offset) as *mut c_void);
            }
        }
        let written = unsafe {
            ffmpeg::sys::av_audio_fifo_write(self.pointer, pointers.as_mut_ptr(), sample_count_i32)
        };
        if written != sample_count_i32 {
            return Err(OperationalError::new(
                "audio FIFO accepted an incomplete frame",
            ));
        }
        Ok(())
    }

    fn read(
        &mut self,
        samples: usize,
        frame_samples: usize,
        pts: u64,
    ) -> Result<ffmpeg::frame::Audio, OperationalError> {
        if samples == 0 || samples > frame_samples || samples > self.len() {
            return Err(OperationalError::new("invalid audio FIFO read"));
        }
        if frame_samples > MAX_AUDIO_FIFO_SAMPLES {
            return Err(OperationalError::new(
                "audio FIFO output frame exceeds the safety limit",
            ));
        }
        let mut frame = ffmpeg::frame::Audio::new(self.format, frame_samples, self.layout);
        ensure_audio_frame_allocated(&frame, "failed to allocate an audio encoder frame")?;
        frame.set_rate(AUDIO_RATE);
        frame.set_pts(Some(i64::try_from(pts).map_err(|_| {
            OperationalError::new("audio frame timestamp cannot be represented")
        })?));
        zero_audio_frame(&mut frame, "failed to zero an audio encoder frame")?;
        let sample_count_i32 = i32::try_from(samples)
            .map_err(|_| OperationalError::new("audio FIFO read count cannot be represented"))?;
        let read = unsafe {
            ffmpeg::sys::av_audio_fifo_read(
                self.pointer,
                (*frame.as_mut_ptr()).extended_data as *mut *mut c_void,
                sample_count_i32,
            )
        };
        if read != sample_count_i32 {
            return Err(OperationalError::new(
                "audio FIFO returned an incomplete frame",
            ));
        }
        if !audio_samples_are_finite(&frame, self.channels) {
            zero_audio_frame(
                &mut frame,
                "failed to replace non-finite reconstructed audio",
            )?;
            self.replaced_non_finite_samples = self
                .replaced_non_finite_samples
                .saturating_add(samples as u64);
        }
        Ok(frame)
    }
}

impl Drop for AudioFifo {
    fn drop(&mut self) {
        unsafe {
            ffmpeg::sys::av_audio_fifo_free(self.pointer);
        }
    }
}

fn target_dimensions(width: u32, height: u32) -> Option<(u32, u32)> {
    if width == 0
        || height == 0
        || u64::from(width).saturating_mul(u64::from(height)) > MAX_SOURCE_PIXELS
    {
        return None;
    }
    let scale = f64::min(
        1.0,
        f64::min(
            MAX_WIDTH as f64 / width as f64,
            MAX_HEIGHT as f64 / height as f64,
        ),
    );
    let even = |value: f64| ((value.floor() as u32).max(2)) & !1;
    Some((even(width as f64 * scale), even(height as f64 * scale)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_small_even_dimensions() {
        assert_eq!(target_dimensions(640, 360), Some((640, 360)));
    }

    #[test]
    fn constrains_large_dimensions_without_upscaling() {
        assert_eq!(target_dimensions(2_560, 1_440), Some((1_280, 720)));
        assert_eq!(target_dimensions(720, 1_280), Some((404, 720)));
    }

    #[test]
    fn rejects_invalid_dimensions() {
        assert_eq!(target_dimensions(0, 720), None);
        assert_eq!(target_dimensions(8_192, 8_192), None);
    }

    #[test]
    fn audio_edit_map_splits_a_frame_crossing_a_cut() {
        let edit_map = EditMap::new(
            30,
            1,
            vec![crate::timeline::CutInterval {
                start_ms: 10,
                end_ms: 20,
                frame_count: 1,
            }],
        );
        let audio = AudioEditMap::new(0, &edit_map);

        assert_eq!(
            audio.retained_slices(0, 1_440),
            vec![
                AudioSlice {
                    source_offset: 0,
                    sample_count: 480,
                    target_start: 0,
                },
                AudioSlice {
                    source_offset: 960,
                    sample_count: 480,
                    target_start: 480,
                },
            ]
        );
    }

    #[test]
    fn audio_edit_map_compacts_multiple_cuts() {
        let edit_map = EditMap::new(
            50,
            2,
            vec![
                crate::timeline::CutInterval {
                    start_ms: 10,
                    end_ms: 20,
                    frame_count: 1,
                },
                crate::timeline::CutInterval {
                    start_ms: 30,
                    end_ms: 40,
                    frame_count: 1,
                },
            ],
        );
        let audio = AudioEditMap::new(0, &edit_map);

        assert_eq!(
            audio.retained_slices(0, 2_400),
            vec![
                AudioSlice {
                    source_offset: 0,
                    sample_count: 480,
                    target_start: 0,
                },
                AudioSlice {
                    source_offset: 960,
                    sample_count: 480,
                    target_start: 480,
                },
                AudioSlice {
                    source_offset: 1_920,
                    sample_count: 480,
                    target_start: 960,
                },
            ]
        );
    }

    #[test]
    fn audio_edit_map_trims_samples_before_the_first_video_frame() {
        let edit_map = EditMap::new(
            40,
            1,
            vec![crate::timeline::CutInterval {
                start_ms: 0,
                end_ms: 20,
                frame_count: 1,
            }],
        );
        let audio = AudioEditMap::new(20, &edit_map);

        assert_eq!(
            audio.retained_slices(0, 1_920),
            vec![AudioSlice {
                source_offset: 960,
                sample_count: 960,
                target_start: 0,
            }]
        );
    }

    #[test]
    fn caps_a_malicious_inferred_gap_to_the_remaining_timeline() {
        let mut tracker = TimelineTracker::new();
        tracker
            .observe(FrameObservation::clean(0, 0, 40, false))
            .unwrap();
        let mut input_index = 1;
        let mut consecutive_damage_ms = 0;

        let inference = infer_missing_observations(
            &mut tracker,
            &mut input_index,
            Some(0),
            i64::MAX,
            40,
            Rational(25, 1),
            100,
            4_000,
            &mut consecutive_damage_ms,
        );
        assert!(inference.is_ok());

        let result = tracker.finish(4_000, 100);
        assert_eq!(input_index, 99);
        assert_eq!(result.edit_map.cuts().len(), 1);
        assert_eq!(result.summary.corrupt_frames, 98);
        assert_eq!(result.summary.longest_removed_run_ms, 3_920);
    }

    #[test]
    fn infers_multi_minute_gaps_with_the_rational_frame_rate() {
        assert_eq!(frame_slots_between(300_300, Rational(30_000, 1_001)), 9_000,);
    }

    #[test]
    fn writes_long_audio_silence_in_bounded_chunks() {
        assert_eq!(bounded_audio_silence_chunk(1), 1);
        assert_eq!(
            bounded_audio_silence_chunk(AUDIO_SILENCE_CHUNK_SAMPLES * 100),
            AUDIO_SILENCE_CHUNK_SAMPLES as usize,
        );
    }

    #[test]
    fn rejects_non_finite_planar_audio_samples() {
        let mut frame = ffmpeg::frame::Audio::new(
            format::Sample::F32(format::sample::Type::Planar),
            8,
            ffmpeg::ChannelLayout::STEREO,
        );
        frame.set_rate(AUDIO_RATE);
        for plane in 0..frame.planes() {
            frame.plane_mut::<f32>(plane).fill(0.0);
        }
        assert!(audio_samples_are_finite(&frame, 2));

        frame.plane_mut::<f32>(1)[1] = f32::NAN;
        assert!(!audio_samples_are_finite(&frame, 2));
    }

    #[test]
    fn zeroes_every_planar_audio_plane() {
        let mut frame = ffmpeg::frame::Audio::new(
            format::Sample::F32(format::sample::Type::Planar),
            8,
            ffmpeg::ChannelLayout::STEREO,
        );
        frame.set_rate(AUDIO_RATE);
        frame.plane_mut::<f32>(0).fill(1.0);
        frame.plane_mut::<f32>(1).fill(f32::NAN);

        zero_audio_frame(&mut frame, "test frame must be allocated").unwrap();

        for plane in 0..frame.planes() {
            assert!(frame.plane::<f32>(plane).iter().all(|sample| *sample == 0.0));
        }
        assert!(audio_samples_are_finite(&frame, 2));
    }

    #[test]
    fn rejects_non_finite_packed_audio_samples() {
        let mut frame = ffmpeg::frame::Audio::new(
            format::Sample::F64(format::sample::Type::Packed),
            8,
            ffmpeg::ChannelLayout::STEREO,
        );
        frame.set_rate(AUDIO_RATE);
        frame.plane_mut::<(f64, f64)>(0).fill((0.0, 0.0));
        assert!(audio_samples_are_finite(&frame, 2));

        frame.plane_mut::<(f64, f64)>(0)[0].1 = f64::INFINITY;
        assert!(!audio_samples_are_finite(&frame, 2));
    }

    #[test]
    fn identifies_materially_variable_frame_rate_metadata() {
        assert!(!materially_different_frame_rates(
            Rational(30_000, 1_001),
            Rational(30, 1)
        ));
        assert!(materially_different_frame_rates(
            Rational(24, 1),
            Rational(60, 1)
        ));
    }

    #[test]
    fn accepts_only_eof_and_invalid_data_as_a_bounded_demux_end() {
        assert!(is_recoverable_demux_end(ffmpeg::Error::Eof));
        assert!(is_recoverable_demux_end(ffmpeg::Error::InvalidData));
        assert!(!is_recoverable_demux_end(ffmpeg::Error::Unknown));
    }

    #[test]
    fn damaged_timestamp_does_not_replace_the_last_trustworthy_timestamp() {
        let last = Some(1_000);
        assert_eq!(retain_trustworthy_timestamp(last, 900_000, false), last);
        assert_eq!(retain_trustworthy_timestamp(last, 1_033, true), Some(1_033));
    }

    #[test]
    fn detects_material_video_and_audio_cadence_gaps() {
        assert!(!material_cadence_gap(
            0,
            3_003,
            Rational(1, 90_000),
            1_000.0 * 1_001.0 / 30_000.0
        ));
        assert!(material_cadence_gap(
            0,
            6_006,
            Rational(1, 90_000),
            1_000.0 * 1_001.0 / 30_000.0
        ));
        assert!(!material_cadence_gap(
            0,
            1_024,
            Rational(1, 48_000),
            1_024.0 * 1_000.0 / 48_000.0
        ));
        assert!(material_cadence_gap(
            0,
            2_048,
            Rational(1, 48_000),
            1_024.0 * 1_000.0 / 48_000.0
        ));
    }
}
