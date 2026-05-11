import { bumpCommentVersion, runVersionTool } from "./versionTools.js";

runVersionTool(() => bumpCommentVersion("src/REST.js", { insertIfMissing: true }));
