import scanFolder from "../../../../helpers/scanFolder.js";
import MediaMeta from "../../../../Models/MediaMeta.js";

export default async function processMedia(job) {
    const { type, data } = job;
    const { _id } = data;

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

        const quarantinePath = `/quarantine-uploads/${workDoc.id}`;

        const mawareScan = await scanFolder(quarantinePath);
        if (mawareScan.infected) {
            workDoc.quarantined = true;
            await endDocProcessing(workDoc);

            console.warn(`MAWARE:\n media id: ${workDoc.id}\nuser it: ${workDoc.author}`);
        }

        if (!mawareScan.clean) {
            workDoc.quarantined = true;
            await endDocProcessing(workDoc);
            return console.warn(
                `there was a problem with media proccess : ${workDoc.id} is not maware but nor eighter clean`,
            );
        }

        console.info("maware scan passed");

        
    } catch (error) {}
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
