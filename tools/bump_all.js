import {
    bumpCommentVersion,
    bumpPackageVersion,
    runVersionTool,
} from "./versionTools.js";

runVersionTool(() => [
    bumpPackageVersion(),
    bumpCommentVersion("src/WS.js"),
    bumpCommentVersion("src/workers/servicesWorker.js"),
    bumpCommentVersion("src/bot/zugee.js"),
    bumpCommentVersion("src/REST.js", { insertIfMissing: true }),
]);
