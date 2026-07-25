use std::env;
use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};

const WORK_ROOT: &str = "/mnt/work";
const VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_TOP_LEVEL_BOXES: usize = 100_000;

#[derive(Debug, PartialEq, Eq)]
struct Mp4Structure {
    has_ftyp: bool,
    has_mdat: bool,
    has_moov: bool,
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("media-recovery: {error}");
            ExitCode::from(error.exit_code())
        }
    }
}

fn run() -> Result<(), RecoveryError> {
    let arguments: Vec<String> = env::args().collect();
    if arguments.len() == 2 && arguments[1] == "--version" {
        println!("media-recovery {VERSION}");
        return Ok(());
    }

    if arguments.len() != 5 || arguments[1] != "repair" {
        return Err(RecoveryError::Usage(
            "usage: media-recovery repair <media-id> <input> <output>".into(),
        ));
    }

    repair(&arguments[2], Path::new(&arguments[3]), Path::new(&arguments[4]))
}

fn repair(media_id: &str, input: &Path, output: &Path) -> Result<(), RecoveryError> {
    let normalized_id = normalize_media_id(media_id)?;
    let work_directory = PathBuf::from(WORK_ROOT).join(&normalized_id);
    let expected_input = work_directory.join("source").join("media.mp4");
    let expected_output = work_directory.join("recovery").join("structural.mp4");

    if input != expected_input || output != expected_output {
        return Err(RecoveryError::UnsafePath(
            "input or output does not match the isolated media work directory".into(),
        ));
    }

    validate_regular_file(input)?;
    validate_output_parent(output, &work_directory)?;

    let input_file = File::open(input)
        .map_err(|error| RecoveryError::Io(format!("failed to open input: {error}")))?;
    let structure = inspect_mp4(input_file)
        .map_err(|error| RecoveryError::InvalidMp4(format!("invalid MP4 structure: {error}")))?;
    if !structure.has_ftyp || !structure.has_mdat || !structure.has_moov {
        return Err(RecoveryError::InvalidMp4(
            "MP4 requires ftyp, mdat, and moov top-level boxes".into(),
        ));
    }

    let partial_output = output.with_extension("partial.mp4");
    remove_file_if_present(&partial_output)?;
    remove_file_if_present(output)?;

    let status = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-nostdin",
            "-y",
            "-protocol_whitelist",
            "file,pipe",
            "-fflags",
            "+discardcorrupt+genpts",
            "-err_detect",
            "ignore_err",
            "-i",
        ])
        .arg(input)
        .args([
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-c",
            "copy",
            "-avoid_negative_ts",
            "make_zero",
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
        ])
        .arg(&partial_output)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| RecoveryError::Ffmpeg(format!("failed to start FFmpeg: {error}")))?;

    if !status.success() {
        let _ = fs::remove_file(&partial_output);
        return Err(RecoveryError::Ffmpeg(format!(
            "FFmpeg structural remux exited with {}",
            format_exit_status(status.code())
        )));
    }

    validate_regular_file(&partial_output).map_err(|error| {
        let _ = fs::remove_file(&partial_output);
        RecoveryError::Output(error.to_string())
    })?;
    let output_length = fs::metadata(&partial_output)
        .map_err(|error| RecoveryError::Output(format!("failed to inspect output: {error}")))?
        .len();
    if output_length < 1_024 {
        let _ = fs::remove_file(&partial_output);
        return Err(RecoveryError::Output(
            "structural repair produced an empty or truncated file".into(),
        ));
    }

    fs::rename(&partial_output, output)
        .map_err(|error| RecoveryError::Output(format!("failed to commit output: {error}")))?;
    validate_regular_file(output)?;
    println!("structural repair completed");
    Ok(())
}

fn normalize_media_id(media_id: &str) -> Result<String, RecoveryError> {
    if media_id.len() != 24 || !media_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(RecoveryError::Usage(
            "media ID must contain exactly 24 hexadecimal characters".into(),
        ));
    }

    Ok(media_id.to_ascii_lowercase())
}

fn validate_regular_file(path: &Path) -> Result<(), RecoveryError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| RecoveryError::Io(format!("failed to inspect file: {error}")))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(RecoveryError::UnsafePath(
            "media path must be a regular non-symlink file".into(),
        ));
    }

    let canonical = fs::canonicalize(path)
        .map_err(|error| RecoveryError::Io(format!("failed to resolve file: {error}")))?;
    if canonical != path {
        return Err(RecoveryError::UnsafePath(
            "media path must already be canonical".into(),
        ));
    }

    Ok(())
}

fn validate_output_parent(output: &Path, work_directory: &Path) -> Result<(), RecoveryError> {
    let output_parent = output
        .parent()
        .ok_or_else(|| RecoveryError::UnsafePath("output has no parent directory".into()))?;
    let parent_metadata = fs::symlink_metadata(output_parent)
        .map_err(|error| RecoveryError::Io(format!("failed to inspect output directory: {error}")))?;
    if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
        return Err(RecoveryError::UnsafePath(
            "output parent must be a regular directory".into(),
        ));
    }

    let canonical_parent = fs::canonicalize(output_parent)
        .map_err(|error| RecoveryError::Io(format!("failed to resolve output directory: {error}")))?;
    let canonical_work = fs::canonicalize(work_directory)
        .map_err(|error| RecoveryError::Io(format!("failed to resolve work directory: {error}")))?;
    if canonical_parent != canonical_work.join("recovery") {
        return Err(RecoveryError::UnsafePath(
            "output escaped the isolated media work directory".into(),
        ));
    }

    if let Ok(metadata) = fs::symlink_metadata(output) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(RecoveryError::UnsafePath(
                "existing output is not a regular file".into(),
            ));
        }
    }

    Ok(())
}

fn inspect_mp4<R: Read + Seek>(mut reader: R) -> io::Result<Mp4Structure> {
    let file_length = reader.seek(SeekFrom::End(0))?;
    reader.seek(SeekFrom::Start(0))?;
    if file_length < 8 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "file is smaller than one MP4 box",
        ));
    }

    let mut offset = 0_u64;
    let mut box_count = 0_usize;
    let mut structure = Mp4Structure {
        has_ftyp: false,
        has_mdat: false,
        has_moov: false,
    };

    while offset < file_length {
        box_count += 1;
        if box_count > MAX_TOP_LEVEL_BOXES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "too many top-level MP4 boxes",
            ));
        }
        if file_length - offset < 8 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "truncated top-level MP4 box header",
            ));
        }

        reader.seek(SeekFrom::Start(offset))?;
        let mut header = [0_u8; 8];
        reader.read_exact(&mut header)?;
        let short_size = u32::from_be_bytes(header[0..4].try_into().unwrap());
        let box_type = &header[4..8];
        let (box_size, header_size) = match short_size {
            0 => (file_length - offset, 8_u64),
            1 => {
                if file_length - offset < 16 {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "truncated extended MP4 box header",
                    ));
                }
                let mut extended_size = [0_u8; 8];
                reader.read_exact(&mut extended_size)?;
                (u64::from_be_bytes(extended_size), 16_u64)
            }
            size => (u64::from(size), 8_u64),
        };

        if box_size < header_size || box_size > file_length - offset {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "top-level MP4 box exceeds file bounds",
            ));
        }
        if short_size == 0 && offset + box_size != file_length {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "zero-sized MP4 box is not the final box",
            ));
        }

        match box_type {
            b"ftyp" => structure.has_ftyp = true,
            b"mdat" => structure.has_mdat = true,
            b"moov" => structure.has_moov = true,
            _ => {}
        }

        offset = offset
            .checked_add(box_size)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "MP4 offset overflow"))?;
    }

    if offset != file_length {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "MP4 boxes do not cover the complete file",
        ));
    }

    Ok(structure)
}

fn remove_file_if_present(path: &Path) -> Result<(), RecoveryError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(RecoveryError::Io(format!(
            "failed to remove stale recovery output: {error}"
        ))),
    }
}

fn format_exit_status(code: Option<i32>) -> String {
    code.map_or_else(|| "a signal".into(), |value| format!("code {value}"))
}

#[derive(Debug)]
enum RecoveryError {
    Usage(String),
    UnsafePath(String),
    Io(String),
    InvalidMp4(String),
    Ffmpeg(String),
    Output(String),
}

impl RecoveryError {
    fn exit_code(&self) -> u8 {
        match self {
            Self::Usage(_) => 2,
            Self::UnsafePath(_) => 3,
            Self::InvalidMp4(_) => 4,
            Self::Ffmpeg(_) => 5,
            Self::Io(_) | Self::Output(_) => 6,
        }
    }
}

impl std::fmt::Display for RecoveryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Usage(message)
            | Self::UnsafePath(message)
            | Self::Io(message)
            | Self::InvalidMp4(message)
            | Self::Ffmpeg(message)
            | Self::Output(message) => formatter.write_str(message),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn mp4_box(box_type: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let size = u32::try_from(payload.len() + 8).unwrap();
        let mut bytes = Vec::with_capacity(size as usize);
        bytes.extend_from_slice(&size.to_be_bytes());
        bytes.extend_from_slice(box_type);
        bytes.extend_from_slice(payload);
        bytes
    }

    #[test]
    fn accepts_bounded_required_top_level_boxes() {
        let mut bytes = mp4_box(b"ftyp", b"isom");
        bytes.extend(mp4_box(b"mdat", &[0; 32]));
        bytes.extend(mp4_box(b"moov", &[0; 8]));

        let structure = inspect_mp4(Cursor::new(bytes)).unwrap();
        assert_eq!(
            structure,
            Mp4Structure {
                has_ftyp: true,
                has_mdat: true,
                has_moov: true,
            }
        );
    }

    #[test]
    fn rejects_box_extending_past_end_of_file() {
        let bytes = [0, 0, 0, 32, b'f', b't', b'y', b'p'];
        let error = inspect_mp4(Cursor::new(bytes)).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn rejects_trailing_partial_box_header() {
        let mut bytes = mp4_box(b"ftyp", b"isom");
        bytes.extend_from_slice(&[0, 0, 0]);
        let error = inspect_mp4(Cursor::new(bytes)).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }
}
