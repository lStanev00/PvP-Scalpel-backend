const parts = workDoc.manifest.mediaParts.map(
    (innerPath) => `/mnt/s3-bucket/quarantine-uploads/${innerPath}`,
);

const concatInput = `concat:${parts.join("|")}`;