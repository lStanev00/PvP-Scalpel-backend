use std::fs::{self, File};
use std::io;
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::path::{Path, PathBuf};

pub const WORK_ROOT: &str = "/mnt/work";

#[derive(Debug)]
pub struct RecoveryPaths {
    pub media_id: String,
    pub input: PathBuf,
    pub output: PathBuf,
    pub partial_output: PathBuf,
}

pub fn validate_paths(
    media_id: &str,
    input: &Path,
    output: &Path,
) -> Result<RecoveryPaths, String> {
    let normalized_id = normalize_media_id(media_id)?;
    let work_directory = PathBuf::from(WORK_ROOT).join(&normalized_id);
    let expected_input = work_directory.join("source").join("media.mp4");
    let expected_output = work_directory.join("recovery").join("recovered.mp4");

    if input != expected_input || output != expected_output {
        return Err("input or output does not match the isolated media work directory".into());
    }

    validate_regular_file(input)?;
    prepare_recovery_directory(&work_directory)?;
    validate_output_parent(output, &work_directory)?;

    Ok(RecoveryPaths {
        media_id: normalized_id,
        input: expected_input,
        partial_output: expected_output.with_file_name("recovered.partial.mp4"),
        output: expected_output,
    })
}

fn prepare_recovery_directory(work_directory: &Path) -> Result<(), String> {
    let work_metadata = fs::symlink_metadata(work_directory)
        .map_err(|error| format!("failed to inspect work directory: {error}"))?;
    if work_metadata.file_type().is_symlink() || !work_metadata.is_dir() {
        return Err("media work path must be a regular directory".into());
    }
    let canonical_work = fs::canonicalize(work_directory)
        .map_err(|error| format!("failed to resolve work directory: {error}"))?;
    if canonical_work != work_directory {
        return Err("media work path must already be canonical".into());
    }

    let recovery_directory = work_directory.join("recovery");
    match fs::symlink_metadata(&recovery_directory) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("recovery path must be a regular non-symlink directory".into());
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let mut builder = fs::DirBuilder::new();
            #[cfg(unix)]
            builder.mode(0o700);
            builder
                .create(&recovery_directory)
                .map_err(|error| format!("failed to create recovery directory: {error}"))?;
        }
        Err(error) => {
            return Err(format!("failed to inspect recovery directory: {error}"));
        }
    }

    #[cfg(unix)]
    fs::set_permissions(&recovery_directory, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("failed to secure recovery directory: {error}"))?;

    let canonical_recovery = fs::canonicalize(&recovery_directory)
        .map_err(|error| format!("failed to resolve recovery directory: {error}"))?;
    if canonical_recovery != work_directory.join("recovery") {
        return Err("recovery directory escaped the isolated media work directory".into());
    }

    Ok(())
}

pub fn open_input(path: &Path) -> Result<File, String> {
    File::open(path).map_err(|error| format!("failed to open input: {error}"))
}

pub fn validate_regular_file(path: &Path) -> Result<(), String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|error| format!("failed to inspect file: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("media path must be a regular non-symlink file".into());
    }

    let canonical =
        fs::canonicalize(path).map_err(|error| format!("failed to resolve file: {error}"))?;
    if canonical != path {
        return Err("media path must already be canonical".into());
    }

    Ok(())
}

pub fn validate_output_file(path: &Path) -> Result<(), String> {
    validate_regular_file(path)?;
    let length = fs::metadata(path)
        .map_err(|error| format!("failed to inspect output: {error}"))?
        .len();
    if length < 1_024 {
        return Err("recovery produced an empty or truncated file".into());
    }
    Ok(())
}

pub fn remove_file_if_present(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("failed to remove stale recovery output: {error}")),
    }
}

fn normalize_media_id(media_id: &str) -> Result<String, String> {
    if media_id.len() != 24 || !media_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("media ID must contain exactly 24 hexadecimal characters".into());
    }
    Ok(media_id.to_ascii_lowercase())
}

fn validate_output_parent(output: &Path, work_directory: &Path) -> Result<(), String> {
    let output_parent = output
        .parent()
        .ok_or_else(|| "output has no parent directory".to_string())?;
    let parent_metadata = fs::symlink_metadata(output_parent)
        .map_err(|error| format!("failed to inspect output directory: {error}"))?;
    if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
        return Err("output parent must be a regular directory".into());
    }

    let canonical_parent = fs::canonicalize(output_parent)
        .map_err(|error| format!("failed to resolve output directory: {error}"))?;
    let canonical_work = fs::canonicalize(work_directory)
        .map_err(|error| format!("failed to resolve work directory: {error}"))?;
    if canonical_parent != canonical_work.join("recovery") {
        return Err("output escaped the isolated media work directory".into());
    }

    if let Ok(metadata) = fs::symlink_metadata(output) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("existing output is not a regular file".into());
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::normalize_media_id;

    #[test]
    fn normalizes_valid_media_ids() {
        assert_eq!(
            normalize_media_id("ABCDEFABCDEFABCDEFABCDEF").unwrap(),
            "abcdefabcdefabcdefabcdef"
        );
    }

    #[test]
    fn rejects_invalid_media_ids() {
        assert!(normalize_media_id("not-an-object-id").is_err());
        assert!(normalize_media_id("abcdefabcdefabcdefabcdeg").is_err());
    }
}
