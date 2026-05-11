import { bumpCommentVersion, runVersionTool } from "./versionTools.js";

runVersionTool(() => bumpCommentVersion("src/WS.js"));
