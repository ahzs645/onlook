import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectProject, findAvailablePort } from './project-utils';
import { createDesktopStorage } from './storage';
import { DEFAULT_DOCKER_IMAGE_TAG, type RuntimeBackendKind } from './types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const previewText = 'Onlook Desktop Fixture';
const webUrl = 'http://localhost:4100/projects';
const webServerHeapSize = '8192';
const desktopContainerNamePrefix = 'onlook-desktop-';

class OutputBuffer {
    value = '';

    append(chunk: string) {
        this.value += chunk;
    }

    tail(maxLength = 4000) {
        return this.value.slice(-maxLength);
    }

    includes(pattern: string) {
        return this.value.includes(pattern);
    }
}

class ManagedChild {
    readonly output = new OutputBuffer();

    constructor(
        readonly name: string,
        readonly child: ChildProcessByStdio<null, Readable, Readable>,
    ) {
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
            this.output.append(chunk);
        });
        child.stderr.on('data', (chunk: string) => {
            this.output.append(chunk);
        });
    }

    get isRunning() {
        return this.child.exitCode === null && this.child.signalCode === null;
    }

    async waitForExit() {
        return await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
            this.child.once('error', reject);
            this.child.once('close', (code, signal) => resolve({ code, signal }));
        });
    }

    async stop(signal: NodeJS.Signals = 'SIGTERM') {
        if (!this.isRunning) {
            return;
        }

        try {
            process.kill(-this.child.pid!, signal);
        } catch {}

        const exit = await Promise.race([
            this.waitForExit(),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
        ]);

        if (exit !== null) {
            return;
        }

        try {
            process.kill(-this.child.pid!, 'SIGKILL');
        } catch {}

        await this.waitForExit().catch(() => undefined);
    }
}

function getBackend() {
    const backendFlagIndex = process.argv.indexOf('--backend');
    const backendArg = backendFlagIndex >= 0 ? process.argv[backendFlagIndex + 1] : undefined;
    if (backendArg === 'container') {
        return 'container' as const;
    }
    return 'local' as const;
}

function spawnManaged(
    name: string,
    command: string,
    args: string[],
    options?: {
        cwd?: string;
        env?: NodeJS.ProcessEnv;
    },
) {
    const child = spawn(command, args, {
        cwd: options?.cwd ?? repoRoot,
        env: options?.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
    });

    return new ManagedChild(name, child);
}

async function runCommand(
    name: string,
    command: string,
    args: string[],
    options?: {
        cwd?: string;
        env?: NodeJS.ProcessEnv;
    },
) {
    const managed = spawnManaged(name, command, args, options);
    const exit = await managed.waitForExit();
    if (exit.code !== 0 || exit.signal !== null) {
        throw new Error(
            `${name} failed.\n${managed.output.tail() || `${command} ${args.join(' ')} exited with code ${exit.code ?? 'unknown'}`}`,
        );
    }
    return managed.output.value;
}

async function waitFor(
    label: string,
    predicate: () => Promise<boolean>,
    timeoutMs: number,
    intervalMs = 500,
) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (await predicate()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`Timed out waiting for ${label}`);
}

async function canFetch(url: string) {
    try {
        const response = await fetch(url);
        return response.ok || response.status >= 300;
    } catch {
        return false;
    }
}

async function listDesktopContainers() {
    const output = await runCommand('list desktop containers', 'docker', [
        'ps',
        '-a',
        '--format',
        '{{.Names}}',
    ]).catch(() => '');

    return output
        .split('\n')
        .map((entry) => entry.trim())
        .filter((entry) => entry.startsWith(desktopContainerNamePrefix));
}

async function waitForHttp(url: string, expectedText?: string) {
    await waitFor(url, async () => {
        try {
            const response = await fetch(url);
            if (!(response.ok || response.status >= 300)) {
                return false;
            }

            if (!expectedText) {
                return true;
            }

            const body = await response.text();
            return body.includes(expectedText);
        } catch {
            return false;
        }
    }, 120_000);
}

async function createFixtureProject(port: number) {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'onlook-desktop-fixture-'));
    await mkdir(path.join(fixtureRoot, 'app'), { recursive: true });

    await writeFile(
        path.join(fixtureRoot, 'package.json'),
        JSON.stringify(
            {
                name: 'onlook-desktop-next-fixture',
                private: true,
                packageManager: 'bun@1.3.11',
                scripts: {
                    dev: `next dev --port ${port}`,
                    build: 'next build',
                },
                dependencies: {
                    next: '16.0.7',
                    react: '19.2.0',
                    'react-dom': '19.2.0',
                },
            },
            null,
            2,
        ),
        'utf8',
    );

    await writeFile(
        path.join(fixtureRoot, 'app/layout.js'),
        `export const metadata = { title: 'Onlook Desktop Fixture' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'sans-serif', margin: 0, padding: 24 }}>
        {children}
      </body>
    </html>
  );
}
`,
        'utf8',
    );

    await writeFile(
        path.join(fixtureRoot, 'app/page.js'),
        `export default function Page() {
  return (
    <main>
      <h1>${previewText}</h1>
      <p>This page is used for local desktop runtime smoke tests.</p>
    </main>
  );
}
`,
        'utf8',
    );

    return fixtureRoot;
}

async function seedDesktopProjectRecord(
    userDataPath: string,
    fixturePath: string,
    backend: RuntimeBackendKind,
) {
    const storage = createDesktopStorage(userDataPath);
    const summary = await inspectProject(fixturePath);
    const record = await storage.upsertProjectRecord(summary, {
        markOpened: true,
    });

    if (backend === 'container') {
        await storage.updateProjectRecord(record.id, (current) => ({
            ...current,
            preferredBackend: 'container',
            containerConfig: current.containerConfig ?? {
                engine: 'docker',
                imageTag: DEFAULT_DOCKER_IMAGE_TAG,
            },
        }));
    }
}

function formatFailureBuffer(label: string, value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
        return `${label}: <no output>`;
    }
    return `${label}:\n${trimmed}`;
}

async function main() {
    const backend = getBackend();
    const previewPort = await findAvailablePort(3300);
    const previewUrl = `http://localhost:${previewPort}`;
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'onlook-desktop-smoke-'));
    const userDataPath = path.join(tempRoot, 'user-data');
    const fixturePath = await createFixtureProject(previewPort);
    const existingDesktopContainers =
        backend === 'container' ? new Set(await listDesktopContainers()) : new Set<string>();

    let webProcess: ManagedChild | null = null;
    let electronProcess: ManagedChild | null = null;

    try {
        await runCommand('desktop build', 'bun', ['--filter', '@onlook/desktop', 'build'], {
            cwd: repoRoot,
            env: process.env,
        });

        await runCommand('fixture install', 'bun', ['install'], {
            cwd: fixturePath,
            env: process.env,
        });

        await seedDesktopProjectRecord(userDataPath, fixturePath, backend);

        webProcess = spawnManaged(
            'desktop web',
            'bun',
            ['run', 'apps/desktop/src/with-desktop-env.ts', 'bun', '--filter', '@onlook/web-client', 'dev'],
            {
                cwd: repoRoot,
                env: {
                    ...process.env,
                    NODE_OPTIONS: `--max-old-space-size=${webServerHeapSize}`,
                },
            },
        );

        await waitFor('desktop web UI', async () => {
            if (!webProcess?.isRunning) {
                throw new Error(
                    `Desktop web server exited early.\n${formatFailureBuffer('desktop web output', webProcess?.output.value ?? '')}`,
                );
            }
            return await canFetch(webUrl);
        }, 120_000);

        electronProcess = spawnManaged(
            'desktop electron',
            'bun',
            ['run', 'apps/desktop/src/with-desktop-env.ts', 'electron', 'apps/desktop/dist/main.js'],
            {
                cwd: repoRoot,
                env: {
                    ...process.env,
                    ONLOOK_DESKTOP_AUTOLAUNCH_PATH: fixturePath,
                    ONLOOK_DESKTOP_USER_DATA_PATH: userDataPath,
                    ONLOOK_DESKTOP_WEB_URL: webUrl,
                },
            },
        );

        await waitForHttp(previewUrl, previewText);

        await waitFor('desktop project route request', async () => {
            if (!webProcess?.isRunning) {
                throw new Error(
                    `Desktop web server exited before project route loaded.\n${formatFailureBuffer('desktop web output', webProcess?.output.value ?? '')}`,
                );
            }
            return webProcess.output.includes('/project/desktop-local');
        }, 120_000);

        await new Promise((resolve) => setTimeout(resolve, 3_000));

        if (!electronProcess.isRunning) {
            throw new Error(
                `Electron exited unexpectedly.\n${formatFailureBuffer('electron output', electronProcess.output.value)}`,
            );
        }

        if (electronProcess.output.includes('Failed to auto-launch project')) {
            throw new Error(formatFailureBuffer('electron output', electronProcess.output.value));
        }

        console.log(
            [
                `Smoke test passed.`,
                `backend: ${backend}`,
                `fixture: ${fixturePath}`,
                `preview: ${previewUrl}`,
            ].join('\n'),
        );
    } catch (error) {
        const details = [
            error instanceof Error ? error.message : String(error),
            webProcess ? formatFailureBuffer('desktop web output', webProcess.output.tail()) : null,
            electronProcess ? formatFailureBuffer('electron output', electronProcess.output.tail()) : null,
        ]
            .filter(Boolean)
            .join('\n\n');
        throw new Error(details);
    } finally {
        await electronProcess?.stop();
        await webProcess?.stop();

        await waitFor(
            `preview port ${previewPort} to close`,
            async () => !(await canFetch(previewUrl)),
            15_000,
            300,
        ).catch(() => undefined);

        if (backend === 'container') {
            const currentDesktopContainers = await listDesktopContainers().catch(() => []);
            for (const containerName of currentDesktopContainers) {
                if (existingDesktopContainers.has(containerName)) {
                    continue;
                }

                await runCommand('remove desktop container', 'docker', ['rm', '-f', containerName]).catch(() => '');
            }
        }

        await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
        await rm(fixturePath, { recursive: true, force: true }).catch(() => undefined);
    }
}

await main();
