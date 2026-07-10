import { spawn } from "node:child_process";

export default async function enqueueAIValidation(path) {
    const chunks = []; // ffmpeg returned chunks;

    const ffmpeg = spawn("ffmpeg", [
        "-i",
        path,

        // 1 frame every 20 sec and resize to 720p
        "-vf",
        "fps=1/20,scale=720:-2",

        // quality of the jpeg (lower is better)
        "-q:v",
        "2",

        // Output JPEG stream to stdout
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1",
    ]);

    ffmpeg.stdout.on("data", (chunk) => {
        chunks.push(chunk);
    });

    // logs on err
    ffmpeg.stderr.on("data", (data) => {
        console.log(data.toString());
    });

    ffmpeg.on("error", reject);

    // handle the close to finilize
    ffmpeg.on("close", (code) => {
        if (code !== 0) {
            reject(new Error(`FFmpeg exited with code ${code}`));
            return;
        }

        const outputBuffer = Buffer.concat(chunks);
        const frames = splitJpegs(outputBuffer);

        
    });
}

function splitJpegs(buffer) {
    const frames = [];
    let start = -1;

    for (let i = 0; i < buffer.length - 1; i++) {
        const isStart = buffer[i] === 0xff && buffer[i + 1] === 0xd8;
        const isEnd = buffer[i] === 0xff && buffer[i + 1] === 0xd9;

        if (isStart) {
            start = i;
        }

        if (isEnd && start !== -1) {
            frames.push(buffer.subarray(start, i + 2));
            start = -1;
        }
    }

    return frames;
}
