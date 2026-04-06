import { access, readdir } from 'node:fs/promises';
import path from 'node:path';

async function findPackagedArtifact(root: string): Promise<string | null> {
    const entries = await readdir(root, { withFileTypes: true });

    for (const entry of entries) {
        const entryPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            if (entry.name.endsWith('.app')) {
                return entryPath;
            }

            const nested = await findPackagedArtifact(entryPath);
            if (nested) {
                return nested;
            }
        }
    }

    return null;
}

async function main() {
    const releaseDir = path.join(process.cwd(), 'release');
    await access(releaseDir);

    const artifactPath = await findPackagedArtifact(releaseDir);
    if (!artifactPath) {
        throw new Error(`No packaged desktop artifact found in ${releaseDir}`);
    }

    console.log(`Packaged desktop artifact: ${artifactPath}`);
}

await main();
