import { bumpCommentVersion, runVersionTool } from "./versionTools.js";

runVersionTool(() => bumpCommentVersion("src/bot/zugee.js"));
