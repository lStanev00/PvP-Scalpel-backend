use std::io::{self, Read, Seek, SeekFrom};

const MAX_TOP_LEVEL_BOXES: usize = 100_000;

#[derive(Debug, PartialEq, Eq)]
pub struct Structure {
    pub has_ftyp: bool,
    pub has_mdat: bool,
    pub has_moov: bool,
}

pub fn inspect<R: Read + Seek>(mut reader: R) -> io::Result<Structure> {
    let file_length = reader.seek(SeekFrom::End(0))?;
    reader.seek(SeekFrom::Start(0))?;
    if file_length < 8 {
        return Err(invalid_data("file is smaller than one MP4 box"));
    }

    let mut offset = 0_u64;
    let mut box_count = 0_usize;
    let mut structure = Structure {
        has_ftyp: false,
        has_mdat: false,
        has_moov: false,
    };

    while offset < file_length {
        box_count += 1;
        if box_count > MAX_TOP_LEVEL_BOXES {
            return Err(invalid_data("too many top-level MP4 boxes"));
        }
        if file_length - offset < 8 {
            return Err(invalid_data("truncated top-level MP4 box header"));
        }

        reader.seek(SeekFrom::Start(offset))?;
        let mut header = [0_u8; 8];
        reader.read_exact(&mut header)?;
        let short_size = u32::from_be_bytes(header[0..4].try_into().expect("fixed slice"));
        let box_type = &header[4..8];
        let (box_size, header_size) = match short_size {
            0 => (file_length - offset, 8_u64),
            1 => {
                if file_length - offset < 16 {
                    return Err(invalid_data("truncated extended MP4 box header"));
                }
                let mut extended_size = [0_u8; 8];
                reader.read_exact(&mut extended_size)?;
                (u64::from_be_bytes(extended_size), 16_u64)
            }
            size => (u64::from(size), 8_u64),
        };

        if box_size < header_size || box_size > file_length - offset {
            return Err(invalid_data("top-level MP4 box exceeds file bounds"));
        }
        if short_size == 0 && offset + box_size != file_length {
            return Err(invalid_data("zero-sized MP4 box is not the final box"));
        }

        match box_type {
            b"ftyp" => structure.has_ftyp = true,
            b"mdat" => structure.has_mdat = true,
            b"moov" => structure.has_moov = true,
            _ => {}
        }

        offset = offset
            .checked_add(box_size)
            .ok_or_else(|| invalid_data("MP4 offset overflow"))?;
    }

    if offset != file_length {
        return Err(invalid_data("MP4 boxes do not cover the complete file"));
    }

    Ok(structure)
}

fn invalid_data(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
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

        let structure = inspect(Cursor::new(bytes)).unwrap();
        assert_eq!(
            structure,
            Structure {
                has_ftyp: true,
                has_mdat: true,
                has_moov: true,
            }
        );
    }

    #[test]
    fn rejects_box_extending_past_end_of_file() {
        let bytes = [0, 0, 0, 32, b'f', b't', b'y', b'p'];
        let error = inspect(Cursor::new(bytes)).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn rejects_trailing_partial_box_header() {
        let mut bytes = mp4_box(b"ftyp", b"isom");
        bytes.extend_from_slice(&[0, 0, 0]);
        let error = inspect(Cursor::new(bytes)).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }
}
