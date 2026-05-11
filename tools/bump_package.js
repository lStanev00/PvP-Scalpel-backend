import { bumpPackageVersion, runVersionTool } from "./versionTools.js";

runVersionTool(() => bumpPackageVersion());
