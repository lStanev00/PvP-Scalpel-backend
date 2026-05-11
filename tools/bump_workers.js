import { bumpCommentVersion, runVersionTool } from "./versionTools.js";

runVersionTool(() => bumpCommentVersion("src/workers/servicesWorker.js"));
