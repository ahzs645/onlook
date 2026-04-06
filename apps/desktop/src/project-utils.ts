import { promises as fs } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
    DEFAULT_LOOPBACK_HOST,
    MAX_SAMPLE_FILES,
    PREVIEW_POLL_INTERVAL_MS,
    PREVIEW_WAIT_TIMEOUT_MS,
    type DesktopProjectSummary,
    type PackageManager,
} from './types';

const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.git', '.next', '.next-prod']);
const IGNORED_FILES = new Set([
    '.DS_Store',
    'Thumbs.db',
    'yarn.lock',
    'package-lock.json',
    'pnpm-lock.yaml',
    'bun.lockb',
    '.env.local',
    '.env.development.local',
    '.env.production.local',
    '.env.test.local',
]);

export class OutputBuffer {
    private output = '';

    append(data: string) {
        if (!data) {
            return;
        }
        this.output += data;
    }

    get value() {
        return this.output;
    }

    tail(maxLength = 4000) {
        return this.output.slice(-maxLength);
    }
}

export function normalizeRelativePath(inputPath: string) {
    const normalized = inputPath.replaceAll('\\', '/');
    if (normalized === '.' || normalized === './' || normalized === '/') {
        return '';
    }
    const resolved = path.posix.normalize(normalized).replace(/^\/+/, '').replace(/^\.\/+/, '');
    if (resolved === '..' || resolved.startsWith('../')) {
        throw new Error(`Path escapes project root: ${inputPath}`);
    }
    return resolved;
}

export function resolveProjectPath(rootPath: string, inputPath: string) {
    const relativePath = normalizeRelativePath(inputPath);
    const fullPath = path.resolve(rootPath, relativePath);
    const normalizedRoot = path.resolve(rootPath);
    if (fullPath !== normalizedRoot && !fullPath.startsWith(`${normalizedRoot}${path.sep}`)) {
        throw new Error(`Path escapes project root: ${inputPath}`);
    }
    return {
        relativePath,
        fullPath,
    };
}

export function isExcludedPath(relativePath: string, excludes: string[]) {
    return excludes.some((exclude) => {
        const normalizedExclude = exclude.replace('/**', '').replace(/^\.\/+/, '');
        return (
            relativePath === normalizedExclude ||
            relativePath.startsWith(`${normalizedExclude}/`) ||
            relativePath.split('/').includes(normalizedExclude)
        );
    });
}

export function isTextContent(buffer: Buffer) {
    const checkLength = Math.min(512, buffer.length);

    for (let index = 0; index < checkLength; index += 1) {
        const byte = buffer[index];
        if (byte === 0 || byte === undefined) {
            return false;
        }
        if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
            return false;
        }
    }

    return true;
}

export function detectPortFromScript(script?: string) {
    const defaultPort = 3000;
    if (!script) {
        return defaultPort;
    }

    const match = /(?:PORT=|--port[=\s]|-p\s*?)(\d+)/.exec(script);
    if (!match?.[1]) {
        return defaultPort;
    }

    const port = Number.parseInt(match[1], 10);
    return Number.isFinite(port) && port > 0 && port <= 65535 ? port : defaultPort;
}

export function scriptSpecifiesPort(script?: string) {
    return /(?:PORT=|--port[=\s]|-p\s*?)(\d+)/.test(script ?? '');
}

function parsePort(value: string) {
    const port = Number.parseInt(value, 10);
    return Number.isFinite(port) && port > 0 && port <= 65535 ? port : null;
}

export function detectPortFromOutput(output: string) {
    const patterns = [
        /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i,
        /\bLocal:\s*https?:\/\/[^:\s]+:(\d+)/i,
        /\b(?:starting on|started on)\s+(\d+)\b/i,
        /\bport\s+\d+\s+is in use,\s+starting on\s+(\d+)\s+instead\b/i,
        /\bready\b.*?:([0-9]{2,5})\b/i,
    ];

    for (const pattern of patterns) {
        const match = pattern.exec(output);
        if (!match?.[1]) {
            continue;
        }

        const port = parsePort(match[1]);
        if (port) {
            return port;
        }
    }

    return null;
}

async function canBindToPort(port: number, host: string): Promise<boolean> {
    return await new Promise((resolve) => {
        const server = net.createServer();

        server.once('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'EADDRINUSE') {
                resolve(false);
                return;
            }

            if (
                error.code === 'EAFNOSUPPORT' ||
                error.code === 'EADDRNOTAVAIL' ||
                error.code === 'EINVAL'
            ) {
                resolve(true);
                return;
            }

            resolve(false);
        });

        server.once('listening', () => {
            server.close(() => resolve(true));
        });

        server.listen(port, host);
    });
}

export async function isPortAvailable(port: number): Promise<boolean> {
    const hosts = ['127.0.0.1', '0.0.0.0', '::1', '::'];
    const results = await Promise.all(hosts.map((host) => canBindToPort(port, host)));
    return results.every(Boolean);
}

export async function findAvailablePort(startPort: number) {
    let port = Math.max(startPort, 1);

    while (port <= 65535) {
        if (await isPortAvailable(port)) {
            return port;
        }
        port += 1;
    }

    throw new Error('Unable to find an available localhost port for the local preview');
}

function getInstallCommand(packageManager: PackageManager) {
    switch (packageManager) {
        case 'bun':
            return 'bun install';
        case 'pnpm':
            return 'pnpm install';
        case 'yarn':
            return 'yarn install';
        case 'npm':
        case 'unknown':
        default:
            return 'npm install';
    }
}

function getScriptCommand(packageManager: PackageManager, scriptName: string) {
    switch (packageManager) {
        case 'bun':
            return `bun run ${scriptName}`;
        case 'pnpm':
            return `pnpm ${scriptName}`;
        case 'yarn':
            return `yarn ${scriptName}`;
        case 'npm':
        case 'unknown':
        default:
            return `npm run ${scriptName}`;
    }
}

async function detectPackageManager(
    folderPath: string,
    packageJson?: Record<string, unknown>,
): Promise<PackageManager> {
    const lockFiles: Array<{ name: string; manager: PackageManager }> = [
        { name: 'bun.lock', manager: 'bun' },
        { name: 'bun.lockb', manager: 'bun' },
        { name: 'package-lock.json', manager: 'npm' },
        { name: 'pnpm-lock.yaml', manager: 'pnpm' },
        { name: 'yarn.lock', manager: 'yarn' },
    ];

    for (const lockFile of lockFiles) {
        try {
            await fs.access(path.join(folderPath, lockFile.name));
            return lockFile.manager;
        } catch {
            continue;
        }
    }

    const packageManagerField =
        typeof packageJson?.packageManager === 'string'
            ? packageJson.packageManager.split('@')[0]
            : null;

    if (
        packageManagerField === 'bun' ||
        packageManagerField === 'npm' ||
        packageManagerField === 'pnpm' ||
        packageManagerField === 'yarn'
    ) {
        return packageManagerField;
    }

    return 'unknown';
}

async function collectProjectFiles(folderPath: string): Promise<string[]> {
    const files: string[] = [];

    const walk = async (currentPath: string, prefix = ''): Promise<void> => {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });

        for (const entry of entries) {
            const relativePath = prefix ? path.posix.join(prefix, entry.name) : entry.name;

            if (entry.isDirectory()) {
                if (IGNORED_DIRECTORIES.has(entry.name)) {
                    continue;
                }
                await walk(path.join(currentPath, entry.name), relativePath);
                continue;
            }

            if (IGNORED_FILES.has(entry.name)) {
                continue;
            }

            files.push(relativePath);
        }
    };

    await walk(folderPath);
    files.sort();
    return files;
}

export async function inspectProject(folderPath: string): Promise<DesktopProjectSummary> {
    const files = await collectProjectFiles(folderPath);
    const packageJsonPath = path.join(folderPath, 'package.json');
    const fallbackName = path.basename(folderPath);
    let packageJson: Record<string, unknown>;

    try {
        packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as Record<string, unknown>;
    } catch {
        return {
            folderPath,
            name: fallbackName,
            isValid: false,
            error: 'package.json not found or unreadable',
            packageManager: 'unknown',
            hasGit: false,
            hasNodeModules: false,
            fileCount: files.length,
            sampleFiles: files.slice(0, MAX_SAMPLE_FILES),
            port: 3000,
            previewUrl: `http://${DEFAULT_LOOPBACK_HOST}:3000`,
            devCommand: null,
            buildCommand: null,
            installCommand: null,
            scripts: {},
        };
    }

    const packageManager = await detectPackageManager(folderPath, packageJson);
    const scripts = (packageJson.scripts ?? {}) as Record<string, string>;
    const name = typeof packageJson.name === 'string' ? packageJson.name : fallbackName;
    const port = detectPortFromScript(typeof scripts.dev === 'string' ? scripts.dev : undefined);
    const previewUrl = `http://${DEFAULT_LOOPBACK_HOST}:${port}`;
    const summaryBase: Omit<DesktopProjectSummary, 'isValid' | 'error' | 'routerType'> = {
        folderPath,
        name,
        packageManager,
        hasGit: await fs
            .access(path.join(folderPath, '.git'))
            .then(() => true)
            .catch(() => false),
        hasNodeModules: await fs
            .access(path.join(folderPath, 'node_modules'))
            .then(() => true)
            .catch(() => false),
        fileCount: files.length,
        sampleFiles: files.slice(0, MAX_SAMPLE_FILES),
        port,
        previewUrl,
        devCommand: typeof scripts.dev === 'string' ? getScriptCommand(packageManager, 'dev') : null,
        buildCommand:
            typeof scripts.build === 'string' ? getScriptCommand(packageManager, 'build') : null,
        installCommand: getInstallCommand(packageManager),
        scripts: {
            dev: typeof scripts.dev === 'string' ? scripts.dev : undefined,
            build: typeof scripts.build === 'string' ? scripts.build : undefined,
            start: typeof scripts.start === 'string' ? scripts.start : undefined,
        },
    };

    const dependencies = (packageJson.dependencies ?? {}) as Record<string, string>;
    const devDependencies = (packageJson.devDependencies ?? {}) as Record<string, string>;
    const hasNext = Boolean(dependencies.next ?? devDependencies.next);
    const hasReact = Boolean(dependencies.react ?? devDependencies.react);

    if (!hasNext || !hasReact) {
        return {
            ...summaryBase,
            isValid: false,
            error: !hasNext ? 'Next.js dependency not found' : 'React dependency not found',
        };
    }

    const hasAppRouter = files.some(
        (file) =>
            file === 'app/layout.tsx' ||
            file === 'app/layout.ts' ||
            file === 'app/layout.jsx' ||
            file === 'app/layout.js' ||
            file === 'src/app/layout.tsx' ||
            file === 'src/app/layout.ts' ||
            file === 'src/app/layout.jsx' ||
            file === 'src/app/layout.js',
    );
    const hasPagesRouter = files.some(
        (file) => file.startsWith('pages/') || file.startsWith('src/pages/'),
    );

    if (!hasAppRouter && !hasPagesRouter) {
        return {
            ...summaryBase,
            isValid: false,
            error: 'No app/ or pages/ router structure found',
        };
    }

    if (!summaryBase.devCommand) {
        return {
            ...summaryBase,
            isValid: false,
            routerType: hasAppRouter ? 'app' : 'pages',
            error: 'No dev script found in package.json',
        };
    }

    return {
        ...summaryBase,
        isValid: true,
        routerType: hasAppRouter ? 'app' : 'pages',
    };
}

export async function waitForPreview(
    getPreviewUrl: () => string,
    hasProcessExited: () => Promise<boolean>,
    output: OutputBuffer,
) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < PREVIEW_WAIT_TIMEOUT_MS) {
        if (await hasProcessExited()) {
            const tail = output.tail();
            throw new Error(
                `Local dev server exited before preview became ready.\n${tail || 'No process output was captured.'}`,
            );
        }

        try {
            const previewUrl = getPreviewUrl();
            const response = await fetch(previewUrl, {
                method: 'GET',
            });
            if (response.ok || response.status >= 300) {
                return;
            }
        } catch {}

        await new Promise((resolve) => setTimeout(resolve, PREVIEW_POLL_INTERVAL_MS));
    }

    const previewUrl = getPreviewUrl();
    throw new Error(
        `Timed out waiting for ${previewUrl}.\n${output.tail() || 'No process output was captured.'}`,
    );
}
