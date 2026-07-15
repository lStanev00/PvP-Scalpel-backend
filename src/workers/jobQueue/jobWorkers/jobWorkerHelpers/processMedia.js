import { detectMimeFromFile, scanFolder } from "./processMedia/bucketFSWorkerOps.js";
import MediaMeta from "../../../../Models/MediaMeta.js";
import enqueueAIValidation from "./processMedia/enqueueAIValidation.js";
import concatToStream from "./processMedia/concatToStream.js";

export default async function processMedia(job) {
    const { type, data } = job;
    const { _id } = data;
    const quarantineBucket = "/quarantine-uploads";
    try {
        const workDoc = await MediaMeta.findById(_id);
        // validations
        if (!workDoc) return console.warn(`nodoc at deepest processMedia`);
        if (workDoc.state !== "need_process")
            return console.warn(
                `the media is at state : ${workDoc.state}\nneed to be at "need_process"`,
            );

        workDoc.state = "processing";
        await workDoc.save();

        const subFolder = workDoc.type === "video" ? "videos" : "";
        const quarantinePath = `${quarantineBucket}/${subFolder}/${workDoc.id}`;

        // step 1 virus/harmfull check
        const mawareScan = await scanFolder(quarantinePath);
        if (mawareScan.infected) {
            workDoc.quarantined = true;
            await endDocProcessing(workDoc);

            return console.warn(`MAWARE:\n media id: ${workDoc.id}\nuser it: ${workDoc.author}`);
        }

        if (!mawareScan.clean) {
            workDoc.quarantined = true;
            await endDocProcessing(workDoc);
            return console.warn(
                `there was a problem with media proccess : ${workDoc.id} is not maware but nor eighter clean`,
            );
        }

        console.info("maware scan passed");
        // step 2 mime type pass
        for (const innerPath of workDoc.manifest.mediaParts) {
            // innerPath example => videos/6a467f2086a1dea21699bd1e/part_0
            const path = `${quarantineBucket}/${innerPath}`;
            const mimeFormat = await detectMimeFromFile(path);
            if (mimeFormat.startsWith("application/octet-stream")) {
                workDoc.quarantined = true;
                await endDocProcessing(workDoc);

                console.warn(
                    `The file is with incorrect mime type and will be quarantined.\n=> path:${path}\n=> owner ID: ${workDoc.author}`,
                );

                return;
            }
        }

        // step 3 content clarity check with local ai
        for (const innerPath of workDoc.manifest.mediaParts) {
            const path = `${quarantineBucket}/${innerPath}`;
            const validation = await enqueueAIValidation(path);
            console.info(
                `conclusion for: ${path}\n${validation.reasons.join("\n  => ")}\n results in: ${validation.decision} \nwith confidence: ${validation.confidence}`,
            );

            if (validation.decision === "allow") continue;

            if (validation.pornography) {
                console.warn(path + ` is pornography!`);
            }

            if (validation.decision === "manual_review")
                console.warn(workDoc.id + " needs manual review");
            workDoc.censored = true;
            await workDoc.save();
            await endDocProcessing(workDoc);
        }

        // STEP 6 Render/export pipeline into streamable format

        const result = await concatToStream(workDoc.id, workDoc.manifest.mediaParts);
        console.info(result);
    } catch (error) {console.warn(error)}
}

async function endDocProcessing(workDoc) {
    try {
        workDoc.state = "done";
        return await workDoc.save();
    } catch (error) {
        console.warn(error);
        return null;
    }
}
