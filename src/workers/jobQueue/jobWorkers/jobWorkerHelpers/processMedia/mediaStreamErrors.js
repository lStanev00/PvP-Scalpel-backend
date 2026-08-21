const INVALID_MEDIA_STREAM_PATTERN =
    /(?:invalid data found when processing input|invalid nal unit(?: size)?|error splitting the input into nal units|missing picture in access unit|corrupt decoded frame|error submitting packet to decoder|error while decoding stream|decode_slice_header error|packet corrupt|channel element \d+\.\d+ is not allocated|input buffer exhausted before end element found|input contains \(near\) nan|could not find codec parameters|stream map .* matches no streams|output file does not contain any stream|nothing was written into output file)/i;

/**
 * Indicates that a media decoder rejected the uploaded stream itself.
 */
export class InvalidMediaStreamError extends Error {
    constructor(message) {
        super(message);
        this.name = "InvalidMediaStreamError";
    }
}

/**
 * Identifies FFmpeg diagnostics caused by invalid media bytes.
 *
 * @param {string} details
 * @returns {boolean}
 */
export function isInvalidMediaStreamFailure(details) {
    return INVALID_MEDIA_STREAM_PATTERN.test(details);
}
