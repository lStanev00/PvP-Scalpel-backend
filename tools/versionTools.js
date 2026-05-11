import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const toolsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(toolsDir, "..");
const semverPattern = /^\d+\.\d+\.\d+$/;

function targetPath(pathFromRoot) {
    return resolve(repoRoot, pathFromRoot);
}

function label(pathFromRoot) {
    return relative(repoRoot, targetPath(pathFromRoot)).replaceAll("\\", "/");
}

function assertSemver(version, location) {
    if (!semverPattern.test(version)) {
        throw new Error(`${location} has invalid version "${version}". Expected number.number.number.`);
    }
}

export function incrementPatch(version, location = "version") {
    assertSemver(version, location);

    const [major, minor, patch] = version.split(".").map(Number);
    return `${major}.${minor}.${patch + 1}`;
}

export function bumpCommentVersion(pathFromRoot, options = {}) {
    const { insertIfMissing = false, initialVersion = "0.0.0" } = options;
    const filePath = targetPath(pathFromRoot);
    const fileLabel = label(pathFromRoot);
    const text = readFileSync(filePath, "utf8");
    const versionLinePattern = /^\/\/\s*version:\s*(.+)$/m;
    const match = text.match(versionLinePattern);

    if (!match) {
        if (!insertIfMissing) {
            throw new Error(`${fileLabel} is missing a "// version: number.number.number" marker.`);
        }

        assertSemver(initialVersion, `${fileLabel} initial version`);
        const nextVersion = incrementPatch(initialVersion, `${fileLabel} initial version`);
        writeFileSync(filePath, `// version: ${nextVersion}\n${text}`);
        return { file: fileLabel, from: initialVersion, to: nextVersion };
    }

    const currentVersion = match[1].trim();
    assertSemver(currentVersion, fileLabel);

    const nextVersion = incrementPatch(currentVersion, fileLabel);
    const updatedText = text.replace(versionLinePattern, `// version: ${nextVersion}`);
    writeFileSync(filePath, updatedText);

    return { file: fileLabel, from: currentVersion, to: nextVersion };
}

export function bumpPackageVersion() {
    const packagePath = targetPath("package.json");
    const lockPath = targetPath("package-lock.json");
    const packageData = JSON.parse(readFileSync(packagePath, "utf8"));
    const lockData = JSON.parse(readFileSync(lockPath, "utf8"));
    const packageVersion = packageData.version;

    assertSemver(packageVersion, "package.json");
    if (!lockData.packages || !lockData.packages[""]) {
        throw new Error('package-lock.json is missing packages[""].');
    }

    const lockVersion = lockData.version;
    const lockRootVersion = lockData.packages[""].version;
    assertSemver(lockVersion, "package-lock.json");
    assertSemver(lockRootVersion, 'package-lock.json packages[""]');

    const nextVersion = incrementPatch(packageVersion, "package.json");

    packageData.version = nextVersion;
    lockData.version = nextVersion;
    lockData.packages[""].version = nextVersion;

    writeFileSync(packagePath, `${JSON.stringify(packageData, null, 2)}\n`);
    writeFileSync(lockPath, `${JSON.stringify(lockData, null, 2)}\n`);

    return [
        { file: "package.json", from: packageVersion, to: nextVersion },
        { file: "package-lock.json", from: lockVersion, to: nextVersion },
    ];
}

export function printResults(results) {
    for (const result of results.flat()) {
        console.log(`${result.file}: ${result.from} -> ${result.to}`);
    }
}

export function runVersionTool(action) {
    try {
        printResults(action());
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
