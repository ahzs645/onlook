import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs, watch as watchFs, type FSWatcher } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_WEB_URL = 'http://localhost:4100/projects';
const DEFAULT_LOOPBACK_HOST = 'localhost';
const DESKTOP_LOCAL_PROJECT_PREFIX = 'desktop-local:';
const DEFAULT_SHELL = process.env.SHELL ?? '/bin/zsh';
const MAX_SAMPLE_FILES = 12;
const MAX_RECENT_PROJECTS = 12;
const PREVIEW_WAIT_TIMEOUT_MS = 120_000;
const PREVIEW_POLL_INTERVAL_MS = 750;
const PREVIEW_CAPTURE_WIDTH = 1280;
const PREVIEW_CAPTURE_HEIGHT = 800;
const PREVIEW_CAPTURE_SETTLE_MS = 1500;
const PREVIEW_CAPTURE_TIMEOUT_MS = 15_000;
const PREVIEW_CAPTURE_PROBE_TIMEOUT_MS = 1500;
const NODE_FS_SANDBOX_PREFIX = 'nodefs:session:';
const RECENT_PROJECTS_FILE_NAME = 'desktop-projects.json';
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

type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn' | 'unknown';
type SessionStatus = 'starting' | 'running' | 'stopped' | 'error';

interface DesktopProjectSummary {
    folderPath: string;
    name: string;
    isValid: boolean;
    error?: string;
    routerType?: 'app' | 'pages';
    packageManager: PackageManager;
    hasGit: boolean;
    hasNodeModules: boolean;
    fileCount: number;
    sampleFiles: string[];
    port: number;
    previewUrl: string;
    previewImageDataUrl?: string | null;
    devCommand: string | null;
    buildCommand: string | null;
    installCommand: string | null;
    scripts: {
        dev?: string;
        build?: string;
        start?: string;
    };
}

interface DesktopProjectSession extends DesktopProjectSummary {
    id: string;
    sandboxId: string;
    status: SessionStatus;
    lastError?: string;
}

interface DesktopRecentProjectRecord extends DesktopProjectSummary {
    id: string;
    lastOpenedAt: string;
}

interface DesktopRecentProject extends DesktopProjectSummary {
    id: string;
    lastOpenedAt: string;
    exists: boolean;
    sessionId: string | null;
    status: SessionStatus | null;
}

function toProjectSummary(summary: DesktopProjectSummary): DesktopProjectSummary {
    return {
        folderPath: summary.folderPath,
        name: summary.name,
        isValid: summary.isValid,
        error: summary.error,
        routerType: summary.routerType,
        packageManager: summary.packageManager,
        hasGit: summary.hasGit,
        hasNodeModules: summary.hasNodeModules,
        fileCount: summary.fileCount,
        sampleFiles: summary.sampleFiles,
        port: summary.port,
        previewUrl: summary.previewUrl,
        previewImageDataUrl: summary.previewImageDataUrl ?? null,
        devCommand: summary.devCommand,
        buildCommand: summary.buildCommand,
        installCommand: summary.installCommand,
        scripts: summary.scripts,
    };
}

interface WatchRegistration {
    id: string;
    watcher: FSWatcher;
}

type StreamKind = 'terminal' | 'task' | 'command';

class OutputBuffer {
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

class ManagedProcess {
    readonly id: string;
    readonly buffer = new OutputBuffer();
    private child: ChildProcessWithoutNullStreams | null = null;
    private expectedStop = false;
    private exitCallbacks = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>();

    constructor(
        id: string,
        readonly name: string,
        readonly command: string,
        private readonly cwd: string,
        private env: NodeJS.ProcessEnv,
        private readonly kind: StreamKind,
    ) {
        this.id = id;
    }

    get isRunning() {
        return this.child !== null && !this.child.killed;
    }

    setEnv(nextEnv: NodeJS.ProcessEnv) {
        if (this.isRunning) {
            throw new Error('Cannot update process environment while the process is running');
        }

        this.env = nextEnv;
    }

    private emitOutput(data: string) {
        this.buffer.append(data);
        getMainWindow()?.webContents.send(getStreamChannel(this.kind, this.id), data);
    }

    async start() {
        if (this.child) {
            return;
        }

        this.expectedStop = false;
        const child = spawn(this.command, {
            cwd: this.cwd,
            env: this.env,
            shell: true,
            stdio: 'pipe',
        });

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => this.emitOutput(chunk));
        child.stderr.on('data', (chunk: string) => this.emitOutput(chunk));
        child.on('close', (code, signal) => {
            this.child = null;
            for (const callback of this.exitCallbacks) {
                callback(code, signal);
            }

            if (!this.expectedStop && (code !== 0 || signal)) {
                const reason =
                    signal !== null
                        ? `Process terminated with signal ${signal}\n`
                        : `Process exited with code ${code ?? 'unknown'}\n`;
                this.emitOutput(reason);
            }
        });
        child.on('error', (error) => {
            this.emitOutput(`${error.message}\n`);
        });

        this.child = child;
    }

    onExit(callback: (code: number | null, signal: NodeJS.Signals | null) => void) {
        this.exitCallbacks.add(callback);
        return () => {
            this.exitCallbacks.delete(callback);
        };
    }

    async open() {
        await this.start();
        return this.buffer.value;
    }

    async write(input: string) {
        await this.start();
        this.child?.stdin.write(input);
    }

    async run(input: string) {
        await this.write(`${input}\n`);
    }

    async kill() {
        if (!this.child) {
            return;
        }

        this.expectedStop = true;
        const child = this.child;
        child.kill('SIGTERM');

        await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
                if (!child.killed) {
                    child.kill('SIGKILL');
                }
                resolve();
            }, 3_000);

            child.once('close', () => {
                clearTimeout(timeout);
                resolve();
            });
        });
    }

    async restart() {
        await this.kill();
        await this.start();
    }
}

class DesktopProjectRuntime {
    readonly id: string;
    readonly sandboxId: string;
    status: SessionStatus = 'stopped';
    lastError?: string;
    private readonly terminals = new Map<string, ManagedProcess>();
    private readonly commands = new Map<string, ManagedProcess>();
    private readonly watchers = new Map<string, WatchRegistration>();
    private readonly task: ManagedProcess;

    constructor(
        id: string,
        private summary: DesktopProjectSummary,
    ) {
        this.id = id;
        this.sandboxId = `${NODE_FS_SANDBOX_PREFIX}${id}`;
        this.task = new ManagedProcess(
            `task:${id}:dev`,
            'server',
            this.summary.devCommand ?? '',
            this.summary.folderPath,
            this.createProcessEnv(),
            'task',
        );
        this.task.onExit((code, signal) => {
            if (this.status === 'stopped') {
                return;
            }

            if (code === 0 && signal === null) {
                this.status = 'stopped';
                return;
            }

            this.status = 'error';
            this.lastError =
                signal !== null
                    ? `Dev server stopped with signal ${signal}`
                    : `Dev server exited with code ${code ?? 'unknown'}`;
        });
    }

    private createProcessEnv(): NodeJS.ProcessEnv {
        return {
            ...process.env,
            PORT: this.summary.port.toString(),
            HOST: DEFAULT_LOOPBACK_HOST,
            HOSTNAME: DEFAULT_LOOPBACK_HOST,
            BROWSER: 'none',
            FORCE_COLOR: '1',
        };
    }

    toSession(): DesktopProjectSession {
        return {
            ...this.summary,
            id: this.id,
            sandboxId: this.sandboxId,
            status: this.status,
            lastError: this.lastError,
        };
    }

    get folderPath() {
        return this.summary.folderPath;
    }

    get previewUrl() {
        return this.summary.previewUrl;
    }

    private updatePreviewPort(port: number) {
        this.summary = {
            ...this.summary,
            port,
            previewUrl: `http://${DEFAULT_LOOPBACK_HOST}:${port}`,
        };
        this.task.setEnv(this.createProcessEnv());
    }

    private async ensureLaunchPort() {
        if (await isPortAvailable(this.summary.port)) {
            return;
        }

        if (scriptSpecifiesPort(this.summary.scripts.dev)) {
            throw new Error(
                `Port ${this.summary.port} is already in use by another process. Stop that process or change the project's configured dev port before launching it in desktop mode.`,
            );
        }

        const availablePort = await findAvailablePort(this.summary.port + 1);
        this.updatePreviewPort(availablePort);
    }

    async start() {
        if (!this.summary.isValid) {
            throw new Error(this.summary.error ?? 'Project is not a valid Next.js app');
        }

        if (!this.summary.devCommand) {
            throw new Error('No dev command was detected for this project');
        }

        await this.ensureLaunchPort();
        this.status = 'starting';
        this.lastError = undefined;

        if (!this.summary.hasNodeModules && this.summary.installCommand) {
            await this.installDependencies();
        }

        if (!this.task.isRunning) {
            await this.task.start();
        }

        try {
            await waitForPreview(this.previewUrl, async () => !this.task.isRunning, this.task.buffer);
            this.status = 'running';
        } catch (error) {
            this.status = 'error';
            this.lastError = error instanceof Error ? error.message : 'Failed to start local preview';
            throw error;
        }
    }

    async restartDevServer() {
        if (!this.summary.devCommand) {
            throw new Error('No dev command was detected for this project');
        }

        this.status = 'starting';
        this.lastError = undefined;
        await this.task.restart();
        try {
            await waitForPreview(this.previewUrl, async () => !this.task.isRunning, this.task.buffer);
            this.status = 'running';
        } catch (error) {
            this.status = 'error';
            this.lastError = error instanceof Error ? error.message : 'Failed to restart local preview';
            throw error;
        }
    }

    async stop() {
        this.status = 'stopped';
        await Promise.all([
            this.task.kill(),
            ...Array.from(this.terminals.values()).map((terminal) => terminal.kill()),
            ...Array.from(this.commands.values()).map((command) => command.kill()),
        ]);
        for (const watchRegistration of this.watchers.values()) {
            watchRegistration.watcher.close();
        }
        this.terminals.clear();
        this.commands.clear();
        this.watchers.clear();
    }

    getTask(taskId: string) {
        if (taskId !== 'dev') {
            throw new Error(`Unknown task: ${taskId}`);
        }
        return this.task;
    }

    async createTerminal() {
        const terminalId = `terminal:${this.id}:${randomUUID()}`;
        const terminal = new ManagedProcess(
            terminalId,
            'terminal',
            `${DEFAULT_SHELL} -l`,
            this.folderPath,
            this.createProcessEnv(),
            'terminal',
        );
        await terminal.start();
        this.terminals.set(terminalId, terminal);
        return terminal;
    }

    getTerminal(terminalId: string) {
        const terminal = this.terminals.get(terminalId);
        if (!terminal) {
            throw new Error(`Terminal not found: ${terminalId}`);
        }
        return terminal;
    }

    async runCommand(command: string) {
        const proc = new ManagedProcess(
            `exec:${this.id}:${randomUUID()}`,
            'command',
            command,
            this.folderPath,
            this.createProcessEnv(),
            'command',
        );
        await proc.start();
        await new Promise<void>((resolve) => {
            proc.onExit(() => {
                resolve();
            });
        });
        return {
            output: proc.buffer.value,
        };
    }

    async createBackgroundCommand(command: string) {
        const commandId = `command:${this.id}:${randomUUID()}`;
        const proc = new ManagedProcess(
            commandId,
            'command',
            command,
            this.folderPath,
            this.createProcessEnv(),
            'command',
        );
        await proc.start();
        this.commands.set(commandId, proc);
        return proc;
    }

    getBackgroundCommand(commandId: string) {
        const command = this.commands.get(commandId);
        if (!command) {
            throw new Error(`Background command not found: ${commandId}`);
        }
        return command;
    }

    async gitStatus() {
        const { output } = await this.runCommand('git status --porcelain');
        return {
            changedFiles: output
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => line.slice(3).trim())
                .filter(Boolean),
        };
    }

    async createWatcher(input: {
        path: string;
        recursive?: boolean;
        excludes?: string[];
    }) {
        const { fullPath } = resolveProjectPath(this.folderPath, input.path);
        const watcherId = `watch:${this.id}:${randomUUID()}`;
        const excludes = input.excludes ?? [];
        const watcher = watchFs(fullPath, { recursive: input.recursive ?? true }, async (_type, filename) => {
            const relativePath = filename ? normalizeRelativePath(filename) : '';
            if (!relativePath || isExcludedPath(relativePath, excludes)) {
                return;
            }

            const targetPath = path.join(this.folderPath, relativePath);
            const event = await fs
                .stat(targetPath)
                .then(() => ({
                    type: 'change' as const,
                    paths: [relativePath],
                }))
                .catch(() => ({
                    type: 'remove' as const,
                    paths: [relativePath],
                }));

            getMainWindow()?.webContents.send(getWatchChannel(watcherId), event);
        });

        const registration: WatchRegistration = {
            id: watcherId,
            watcher,
        };
        this.watchers.set(watcherId, registration);
        return registration;
    }

    async removeWatcher(watcherId: string) {
        const registration = this.watchers.get(watcherId);
        if (!registration) {
            return;
        }
        registration.watcher.close();
        this.watchers.delete(watcherId);
    }

    async inspectPath(inputPath: string) {
        return inspectProject(inputPath);
    }

    async listFiles(inputPath: string) {
        const { fullPath } = resolveProjectPath(this.folderPath, inputPath);
        const entries = await fs.readdir(fullPath, { withFileTypes: true }).catch((error) => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return [];
            }
            throw error;
        });
        return {
            files: entries
                .map((entry) => ({
                    name: entry.name,
                    type: entry.isDirectory() ? 'directory' : 'file',
                    isSymlink: entry.isSymbolicLink(),
                }))
                .sort((a, b) => {
                    if (a.type !== b.type) {
                        return a.type === 'directory' ? -1 : 1;
                    }
                    return a.name.localeCompare(b.name);
                }),
        };
    }

    async readFile(inputPath: string) {
        const normalizedPath = normalizeRelativePath(inputPath);
        const { fullPath } = resolveProjectPath(this.folderPath, normalizedPath);
        const buffer = await fs.readFile(fullPath);
        const isText = isTextContent(buffer);
        const content = isText ? buffer.toString('utf8') : new Uint8Array(buffer);
        return {
            file: {
                path: normalizedPath,
                content,
                type: isText ? 'text' : 'binary',
            },
        };
    }

    async writeFile(input: {
        path: string;
        content: string | Uint8Array;
    }) {
        const { fullPath } = resolveProjectPath(this.folderPath, input.path);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, input.content);
        return {
            success: true,
        };
    }

    async renameFile(oldPath: string, newPath: string) {
        const source = resolveProjectPath(this.folderPath, oldPath).fullPath;
        const target = resolveProjectPath(this.folderPath, newPath).fullPath;
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.rename(source, target);
        return {};
    }

    async statFile(inputPath: string) {
        const { fullPath } = resolveProjectPath(this.folderPath, inputPath);
        const stat = await fs.lstat(fullPath);
        return {
            type: stat.isDirectory() ? 'directory' : 'file',
            isSymlink: stat.isSymbolicLink(),
            size: stat.size,
            mtime: stat.mtimeMs,
            ctime: stat.ctimeMs,
            atime: stat.atimeMs,
        };
    }

    async deleteFiles(input: {
        path: string;
        recursive?: boolean;
    }) {
        const { fullPath } = resolveProjectPath(this.folderPath, input.path);
        await fs.rm(fullPath, { recursive: input.recursive ?? true, force: true });
        return {};
    }

    async copyFiles(input: {
        sourcePath: string;
        targetPath: string;
        recursive?: boolean;
        overwrite?: boolean;
    }) {
        const source = resolveProjectPath(this.folderPath, input.sourcePath).fullPath;
        const target = resolveProjectPath(this.folderPath, input.targetPath).fullPath;
        await fs.cp(source, target, {
            recursive: input.recursive ?? true,
            force: input.overwrite ?? true,
            errorOnExist: input.overwrite === false,
        });
        return {};
    }

    async createDirectory(inputPath: string) {
        const { fullPath } = resolveProjectPath(this.folderPath, inputPath);
        await fs.mkdir(fullPath, { recursive: true });
        return {};
    }

    async installDependencies() {
        if (!this.summary.installCommand) {
            return;
        }

        const install = await this.runCommand(this.summary.installCommand);
        try {
            await fs.access(path.join(this.summary.folderPath, 'node_modules'));
            this.summary = {
                ...this.summary,
                hasNodeModules: true,
            };
        } catch {
            throw new Error(
                install.output || 'Failed to install dependencies for the local project',
            );
        }
    }
}

let mainWindow: BrowserWindow | null = null;
const runtimesById = new Map<string, DesktopProjectRuntime>();
const runtimeIdByFolderPath = new Map<string, string>();
const terminalsById = new Map<string, DesktopProjectRuntime>();
const commandsById = new Map<string, DesktopProjectRuntime>();
const tasksById = new Map<string, DesktopProjectRuntime>();
const previewCapturesInFlight = new Set<string>();

function getMainWindow() {
    return mainWindow;
}

function getStreamChannel(kind: StreamKind, id: string) {
    return `desktop:provider:${kind}:${id}:output`;
}

function getWatchChannel(watcherId: string) {
    return `desktop:provider:watch:${watcherId}:event`;
}

function getProjectsUpdatedChannel() {
    return 'desktop:projects:updated';
}

function getWebUrl() {
    return process.env.ONLOOK_DESKTOP_WEB_URL ?? process.env.ONLOOK_WEB_URL ?? DEFAULT_WEB_URL;
}

function getDesktopProjectUrl(sessionId: string, projectId?: string) {
    const url = new URL(getWebUrl());
    if (!projectId) {
        url.pathname = '/projects';
        return url.toString();
    }

    url.pathname = `/project/${encodeURIComponent(`${DESKTOP_LOCAL_PROJECT_PREFIX}${projectId}`)}`;
    const searchParams = new URLSearchParams({
        session: sessionId,
    });
    url.search = `?${searchParams.toString()}`;
    return url.toString();
}

function getRecentProjectsStoragePath() {
    return path.join(app.getPath('userData'), RECENT_PROJECTS_FILE_NAME);
}

function isDesktopProjectRecord(value: unknown): value is DesktopRecentProjectRecord | Omit<DesktopRecentProjectRecord, 'id'> {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<DesktopRecentProjectRecord>;
    return (
        typeof candidate.folderPath === 'string' &&
        typeof candidate.name === 'string' &&
        typeof candidate.isValid === 'boolean' &&
        typeof candidate.packageManager === 'string' &&
        typeof candidate.hasGit === 'boolean' &&
        typeof candidate.hasNodeModules === 'boolean' &&
        typeof candidate.fileCount === 'number' &&
        Array.isArray(candidate.sampleFiles) &&
        typeof candidate.port === 'number' &&
        typeof candidate.previewUrl === 'string' &&
        typeof candidate.lastOpenedAt === 'string'
    );
}

async function readRecentProjects(): Promise<DesktopRecentProjectRecord[]> {
    try {
        const raw = await fs.readFile(getRecentProjectsStoragePath(), 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }
        let didMigrate = false;
        const records = parsed.flatMap((entry) => {
            if (!isDesktopProjectRecord(entry)) {
                return [];
            }

            const candidate = entry as Partial<DesktopRecentProjectRecord>;
            if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
                didMigrate = true;
            }

            return [
                {
                    ...candidate,
                    id: typeof candidate.id === 'string' && candidate.id.length > 0
                        ? candidate.id
                        : randomUUID(),
                } as DesktopRecentProjectRecord,
            ];
        });

        if (didMigrate) {
            await writeRecentProjects(records);
        }

        return records;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }

        console.warn('[desktop] Failed to read recent projects:', error);
        return [];
    }
}

async function writeRecentProjects(records: DesktopRecentProjectRecord[]) {
    const storagePath = getRecentProjectsStoragePath();
    await fs.mkdir(path.dirname(storagePath), { recursive: true });
    await fs.writeFile(storagePath, JSON.stringify(records, null, 2), 'utf8');
}

async function capturePreviewImageDataUrl(previewUrl: string): Promise<string | null> {
    let captureWindow: BrowserWindow | null = null;

    try {
        captureWindow = new BrowserWindow({
            show: false,
            width: PREVIEW_CAPTURE_WIDTH,
            height: PREVIEW_CAPTURE_HEIGHT,
            backgroundColor: '#0b0b0c',
            paintWhenInitiallyHidden: true,
            webPreferences: {
                sandbox: false,
            },
        });

        captureWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

        await new Promise<void>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`Timed out loading preview for ${previewUrl}`));
            }, PREVIEW_CAPTURE_TIMEOUT_MS);

            captureWindow!
                .loadURL(previewUrl)
                .then(() => {
                    clearTimeout(timeoutId);
                    resolve();
                })
                .catch((error) => {
                    clearTimeout(timeoutId);
                    reject(error);
                });
        });

        await new Promise((resolve) => setTimeout(resolve, PREVIEW_CAPTURE_SETTLE_MS));

        const image = await captureWindow.webContents.capturePage();
        if (image.isEmpty()) {
            return null;
        }

        const resizedImage = image.resize({ width: PREVIEW_CAPTURE_WIDTH });
        return `data:image/jpeg;base64,${resizedImage.toJPEG(72).toString('base64')}`;
    } catch (error) {
        console.warn('[desktop] Failed to capture preview image:', error);
        return null;
    } finally {
        if (captureWindow && !captureWindow.isDestroyed()) {
            captureWindow.destroy();
        }
    }
}

async function isPreviewReachable(previewUrl: string): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PREVIEW_CAPTURE_PROBE_TIMEOUT_MS);

    try {
        const response = await fetch(previewUrl, {
            method: 'GET',
            signal: controller.signal,
        });
        return response.ok || response.status >= 300;
    } catch {
        return false;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function updateRecentProjectPreview(projectId: string, previewImageDataUrl: string) {
    const records = await readRecentProjects();
    const nextRecords = records.map((record) =>
        record.id === projectId
            ? { ...record, previewImageDataUrl }
            : record,
    );

    await writeRecentProjects(nextRecords);
    getMainWindow()?.webContents.send(getProjectsUpdatedChannel(), { projectId });
}

async function captureAndPersistRecentProjectPreview(projectId: string, previewUrl: string) {
    if (previewCapturesInFlight.has(projectId)) {
        return;
    }

    previewCapturesInFlight.add(projectId);

    try {
        const previewImageDataUrl = await capturePreviewImageDataUrl(previewUrl);
        if (!previewImageDataUrl) {
            return;
        }

        await updateRecentProjectPreview(projectId, previewImageDataUrl);
    } finally {
        previewCapturesInFlight.delete(projectId);
    }
}

async function maybeCaptureRecentProjectPreview(projectId: string, previewUrl: string) {
    if (previewCapturesInFlight.has(projectId)) {
        return;
    }

    if (!(await isPreviewReachable(previewUrl))) {
        return;
    }

    await captureAndPersistRecentProjectPreview(projectId, previewUrl);
}

async function getStoredProjectRecord(projectId: string) {
    const records = await readRecentProjects();
    return records.find((record) => record.id === projectId) ?? null;
}

async function upsertRecentProject(
    summary: DesktopProjectSummary,
    options?: {
        projectId?: string;
        markOpened?: boolean;
    },
) {
    const records = await readRecentProjects();
    const existingRecord =
        (options?.projectId
            ? records.find((record) => record.id === options.projectId)
            : null) ?? records.find((record) => record.folderPath === summary.folderPath);
    const nextSummary = toProjectSummary(summary);
    const nextRecord: DesktopRecentProjectRecord = {
        ...nextSummary,
        previewImageDataUrl:
            nextSummary.previewImageDataUrl ?? existingRecord?.previewImageDataUrl ?? null,
        id: existingRecord?.id ?? options?.projectId ?? randomUUID(),
        lastOpenedAt:
            options?.markOpened || !existingRecord
                ? new Date().toISOString()
                : existingRecord.lastOpenedAt,
    };
    const deduped = records.filter(
        (record) =>
            record.id !== nextRecord.id && record.folderPath !== nextRecord.folderPath,
    );

    const nextRecords =
        options?.markOpened
            ? [nextRecord, ...deduped].slice(0, MAX_RECENT_PROJECTS)
            : [...deduped, nextRecord]
                  .sort((left, right) => {
                      return (
                          new Date(right.lastOpenedAt).getTime() -
                          new Date(left.lastOpenedAt).getTime()
                      );
                  })
                  .slice(0, MAX_RECENT_PROJECTS);

    await writeRecentProjects(nextRecords);
    return nextRecord;
}

async function saveRecentProject(summary: DesktopProjectSummary, projectId?: string) {
    const record = await upsertRecentProject(summary, {
        projectId,
        markOpened: true,
    });

    if (!record.previewImageDataUrl && summary.previewUrl) {
        void captureAndPersistRecentProjectPreview(record.id, summary.previewUrl);
    }

    return record;
}

async function saveProjectRecord(folderPath: string) {
    const summary = await inspectProject(folderPath);
    const record = await upsertRecentProject(summary, {
        markOpened: true,
    });
    return {
        ...summary,
        id: record.id,
    };
}

async function listRecentProjects(): Promise<DesktopRecentProject[]> {
    const records = await readRecentProjects();

    return Promise.all(
        records.map(async (record) => {
            const exists = await fs
                .access(record.folderPath)
                .then(() => true)
                .catch(() => false);
            const runtimeId = runtimeIdByFolderPath.get(record.folderPath) ?? null;
            const runtime = runtimeId ? (runtimesById.get(runtimeId) ?? null) : null;

            if (!record.previewImageDataUrl) {
                void maybeCaptureRecentProjectPreview(
                    record.id,
                    runtime?.previewUrl ?? record.previewUrl,
                );
            }

            return {
                ...record,
                exists,
                sessionId: runtime?.id ?? null,
                status: runtime?.status ?? null,
            };
        }),
    );
}

async function removeRecentProject(projectId: string) {
    const records = await readRecentProjects();
    await writeRecentProjects(records.filter((record) => record.id !== projectId));
}

function normalizeRelativePath(inputPath: string) {
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

function resolveProjectPath(rootPath: string, inputPath: string) {
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

function isExcludedPath(relativePath: string, excludes: string[]) {
    return excludes.some((exclude) => {
        const normalizedExclude = exclude.replace('/**', '').replace(/^\.\/+/, '');
        return (
            relativePath === normalizedExclude ||
            relativePath.startsWith(`${normalizedExclude}/`) ||
            relativePath.split('/').includes(normalizedExclude)
        );
    });
}

function isTextContent(buffer: Buffer) {
    const checkLength = Math.min(512, buffer.length);

    for (let index = 0; index < checkLength; index++) {
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

function detectPortFromScript(script?: string) {
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

function scriptSpecifiesPort(script?: string) {
    return /(?:PORT=|--port[=\s]|-p\s*?)(\d+)/.test(script ?? '');
}

async function isPortAvailable(port: number, host = DEFAULT_LOOPBACK_HOST): Promise<boolean> {
    return await new Promise((resolve) => {
        const server = net.createServer();

        server.once('error', () => {
            resolve(false);
        });

        server.once('listening', () => {
            server.close(() => resolve(true));
        });

        server.listen(port, host);
    });
}

async function findAvailablePort(startPort: number, host = DEFAULT_LOOPBACK_HOST) {
    let port = Math.max(startPort, 1);

    while (port <= 65535) {
        if (await isPortAvailable(port, host)) {
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

async function inspectProject(folderPath: string): Promise<DesktopProjectSummary> {
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

async function waitForPreview(
    previewUrl: string,
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
            const response = await fetch(previewUrl, {
                method: 'GET',
            });
            if (response.ok || response.status >= 300) {
                return;
            }
        } catch {}

        await new Promise((resolve) => setTimeout(resolve, PREVIEW_POLL_INTERVAL_MS));
    }

    throw new Error(
        `Timed out waiting for ${previewUrl}.\n${output.tail() || 'No process output was captured.'}`,
    );
}

function getOrCreateRuntime(
    folderPath: string,
    summary: DesktopProjectSummary,
) {
    const existingId = runtimeIdByFolderPath.get(folderPath);
    if (existingId) {
        const existing = runtimesById.get(existingId);
        if (existing) {
            return existing;
        }
    }

    const runtimeId = randomUUID();
    const runtime = new DesktopProjectRuntime(runtimeId, summary);
    runtimesById.set(runtimeId, runtime);
    runtimeIdByFolderPath.set(folderPath, runtimeId);
    tasksById.set(runtime.getTask('dev').id, runtime);
    return runtime;
}

function getRuntimeBySandboxId(sandboxId: string) {
    if (!sandboxId.startsWith(NODE_FS_SANDBOX_PREFIX)) {
        throw new Error(`Invalid desktop sandbox id: ${sandboxId}`);
    }

    const runtimeId = sandboxId.slice(NODE_FS_SANDBOX_PREFIX.length);
    const runtime = runtimesById.get(runtimeId);
    if (!runtime) {
        throw new Error(`Desktop project session not found: ${runtimeId}`);
    }
    return runtime;
}

function getRuntimeBySessionId(sessionId: string) {
    return runtimesById.get(sessionId) ?? null;
}

function createWindow(initialUrl?: string) {
    const win = new BrowserWindow({
        width: 1440,
        height: 960,
        minWidth: 1100,
        minHeight: 720,
        title: 'Onlook Desktop',
        autoHideMenuBar: true,
        backgroundColor: '#0b0b0c',
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            void shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    if (initialUrl) {
        void win.loadURL(initialUrl);
    }
    mainWindow = win;
}

async function maybeAutoLaunchProject() {
    const folderPath = process.env.ONLOOK_DESKTOP_AUTOLAUNCH_PATH;
    if (!folderPath || !mainWindow) {
        return false;
    }

    try {
        const summary = await inspectProject(folderPath);
        if (!summary.isValid) {
            throw new Error(summary.error ?? 'Project is not valid');
        }

        const runtime = getOrCreateRuntime(folderPath, summary);
        await runtime.start();
        const record = await saveRecentProject(runtime.toSession());
        await mainWindow.loadURL(getDesktopProjectUrl(runtime.id, record.id));
        return true;
    } catch (error) {
        console.error('[desktop] Failed to auto-launch project:', error);
        return false;
    }
}

async function maybeResumeRecentProject() {
    if (!mainWindow) {
        return false;
    }

    const records = await readRecentProjects();
    for (const record of records) {
        const exists = await fs
            .access(record.folderPath)
            .then(() => true)
            .catch(() => false);
        if (!exists) {
            continue;
        }

        try {
            const summary = await inspectProject(record.folderPath);
            if (!summary.isValid) {
                continue;
            }

            const runtime = getOrCreateRuntime(record.folderPath, summary);
            await runtime.start();
            const savedRecord = await saveRecentProject(runtime.toSession(), record.id);
            await mainWindow.loadURL(getDesktopProjectUrl(runtime.id, savedRecord.id));
            return true;
        } catch (error) {
            console.error('[desktop] Failed to resume recent project:', error);
        }
    }

    return false;
}

ipcMain.handle('desktop:pick-directory', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled) {
        return null;
    }

    return result.filePaths[0] ?? null;
});

ipcMain.handle('desktop:inspect-project', async (_event, folderPath: string) => {
    if (!folderPath) {
        throw new Error('Folder path is required');
    }

    return inspectProject(folderPath);
});

ipcMain.handle('desktop:save-project', async (_event, folderPath: string) => {
    if (!folderPath) {
        throw new Error('Folder path is required');
    }

    const record = await saveProjectRecord(folderPath);
    const projects = await listRecentProjects();
    return projects.find((entry) => entry.id === record.id) ?? null;
});

ipcMain.handle('desktop:get-project', async (_event, projectId: string) => {
    if (!projectId) {
        throw new Error('Project id is required');
    }

    const projects = await listRecentProjects();
    return projects.find((entry) => entry.id === projectId) ?? null;
});

ipcMain.handle(
    'desktop:save-project-preview',
    async (_event, projectId: string, previewImageDataUrl: string) => {
        if (!projectId) {
            throw new Error('Project id is required');
        }

        if (
            !previewImageDataUrl ||
            !previewImageDataUrl.startsWith('data:image/')
        ) {
            throw new Error('A valid preview image is required');
        }

        const record = await getStoredProjectRecord(projectId);
        if (!record) {
            throw new Error('Desktop project not found');
        }

        await updateRecentProjectPreview(projectId, previewImageDataUrl);
    },
);

ipcMain.handle('desktop:launch-project', async (_event, folderPath: string) => {
    if (!folderPath) {
        throw new Error('Folder path is required');
    }

    const summary = await inspectProject(folderPath);
    if (!summary.isValid) {
        throw new Error(summary.error ?? 'Project is not valid');
    }

    const runtime = getOrCreateRuntime(folderPath, summary);
    await runtime.start();
    await saveRecentProject(runtime.toSession());
    return runtime.toSession();
});

ipcMain.handle('desktop:launch-project-by-id', async (_event, projectId: string) => {
    if (!projectId) {
        throw new Error('Project id is required');
    }

    const record = await getStoredProjectRecord(projectId);
    if (!record) {
        throw new Error('Desktop project not found');
    }

    const summary = await inspectProject(record.folderPath);
    if (!summary.isValid) {
        throw new Error(summary.error ?? 'Project is not valid');
    }

    const runtime = getOrCreateRuntime(record.folderPath, summary);
    await runtime.start();
    await saveRecentProject(runtime.toSession(), record.id);
    return runtime.toSession();
});

ipcMain.handle('desktop:get-project-session', async (_event, sessionId: string) => {
    return getRuntimeBySessionId(sessionId)?.toSession() ?? null;
});

ipcMain.handle('desktop:list-projects', async () => {
    return listRecentProjects();
});

ipcMain.handle('desktop:remove-project', async (_event, projectId: string) => {
    if (!projectId) {
        throw new Error('Project id is required');
    }

    await removeRecentProject(projectId);
    return listRecentProjects();
});

ipcMain.handle('desktop:open-path', async (_event, targetPath: string) => {
    await shell.openPath(targetPath);
});

ipcMain.handle('desktop:open-external', async (_event, targetUrl: string) => {
    await shell.openExternal(targetUrl);
});

ipcMain.handle('desktop:provider:write-file', async (_event, input) => {
    return getRuntimeBySandboxId(`${NODE_FS_SANDBOX_PREFIX}${input.sessionId}`).writeFile(input);
});

ipcMain.handle('desktop:provider:rename-file', async (_event, input) => {
    return getRuntimeBySandboxId(`${NODE_FS_SANDBOX_PREFIX}${input.sessionId}`).renameFile(
        input.oldPath,
        input.newPath,
    );
});

ipcMain.handle('desktop:provider:stat-file', async (_event, input) => {
    return getRuntimeBySandboxId(`${NODE_FS_SANDBOX_PREFIX}${input.sessionId}`).statFile(input.path);
});

ipcMain.handle('desktop:provider:delete-files', async (_event, input) => {
    return getRuntimeBySandboxId(`${NODE_FS_SANDBOX_PREFIX}${input.sessionId}`).deleteFiles(input);
});

ipcMain.handle('desktop:provider:list-files', async (_event, input) => {
    return getRuntimeBySandboxId(`${NODE_FS_SANDBOX_PREFIX}${input.sessionId}`).listFiles(input.path);
});

ipcMain.handle('desktop:provider:read-file', async (_event, input) => {
    return getRuntimeBySandboxId(`${NODE_FS_SANDBOX_PREFIX}${input.sessionId}`).readFile(input.path);
});

ipcMain.handle('desktop:provider:download-files', async () => {
    return {
        url: '',
    };
});

ipcMain.handle('desktop:provider:copy-files', async (_event, input) => {
    return getRuntimeBySandboxId(`${NODE_FS_SANDBOX_PREFIX}${input.sessionId}`).copyFiles(input);
});

ipcMain.handle('desktop:provider:create-directory', async (_event, input) => {
    return getRuntimeBySandboxId(`${NODE_FS_SANDBOX_PREFIX}${input.sessionId}`).createDirectory(
        input.path,
    );
});

ipcMain.handle('desktop:provider:watch-files', async (_event, input) => {
    const runtime = getRuntimeBySandboxId(`${NODE_FS_SANDBOX_PREFIX}${input.sessionId}`);
    const registration = await runtime.createWatcher(input);
    return {
        watcherId: registration.id,
    };
});

ipcMain.handle('desktop:provider:unwatch-files', async (_event, watcherId: string) => {
    for (const runtime of runtimesById.values()) {
        await runtime.removeWatcher(watcherId);
    }
});

ipcMain.handle('desktop:provider:create-terminal', async (_event, input) => {
    const runtime = getRuntimeBySandboxId(`${NODE_FS_SANDBOX_PREFIX}${input.sessionId}`);
    const terminal = await runtime.createTerminal();
    terminalsById.set(terminal.id, runtime);
    return {
        terminalId: terminal.id,
        name: terminal.name,
    };
});

ipcMain.handle('desktop:provider:terminal-open', async (_event, input) => {
    const runtime = terminalsById.get(input.terminalId);
    if (!runtime) {
        throw new Error(`Terminal session not found: ${input.terminalId}`);
    }
    return runtime.getTerminal(input.terminalId).open();
});

ipcMain.handle('desktop:provider:terminal-write', async (_event, input) => {
    const runtime = terminalsById.get(input.terminalId);
    if (!runtime) {
        throw new Error(`Terminal session not found: ${input.terminalId}`);
    }
    await runtime.getTerminal(input.terminalId).write(input.value);
});

ipcMain.handle('desktop:provider:terminal-run', async (_event, input) => {
    const runtime = terminalsById.get(input.terminalId);
    if (!runtime) {
        throw new Error(`Terminal session not found: ${input.terminalId}`);
    }
    await runtime.getTerminal(input.terminalId).run(input.value);
});

ipcMain.handle('desktop:provider:terminal-kill', async (_event, input) => {
    const runtime = terminalsById.get(input.terminalId);
    if (!runtime) {
        return;
    }
    await runtime.getTerminal(input.terminalId).kill();
});

ipcMain.handle('desktop:provider:get-task', async (_event, input) => {
    const runtime = getRuntimeBySandboxId(`${NODE_FS_SANDBOX_PREFIX}${input.sessionId}`);
    const task = runtime.getTask(input.id);
    tasksById.set(task.id, runtime);
    return {
        taskId: task.id,
        name: task.name,
        command: task.command,
    };
});

ipcMain.handle('desktop:provider:task-open', async (_event, input) => {
    const runtime = tasksById.get(input.taskId);
    if (!runtime) {
        throw new Error(`Task not found: ${input.taskId}`);
    }
    return runtime.getTask('dev').open();
});

ipcMain.handle('desktop:provider:task-run', async (_event, input) => {
    const runtime = tasksById.get(input.taskId);
    if (!runtime) {
        throw new Error(`Task not found: ${input.taskId}`);
    }
    await runtime.start();
});

ipcMain.handle('desktop:provider:task-restart', async (_event, input) => {
    const runtime = tasksById.get(input.taskId);
    if (!runtime) {
        throw new Error(`Task not found: ${input.taskId}`);
    }
    await runtime.restartDevServer();
});

ipcMain.handle('desktop:provider:task-stop', async (_event, input) => {
    const runtime = tasksById.get(input.taskId);
    if (!runtime) {
        return;
    }
    await runtime.stop();
});

ipcMain.handle('desktop:provider:run-command', async (_event, input) => {
    return getRuntimeBySandboxId(`${NODE_FS_SANDBOX_PREFIX}${input.sessionId}`).runCommand(
        input.command,
    );
});

ipcMain.handle('desktop:provider:run-background-command', async (_event, input) => {
    const runtime = getRuntimeBySandboxId(`${NODE_FS_SANDBOX_PREFIX}${input.sessionId}`);
    const command = await runtime.createBackgroundCommand(input.command);
    commandsById.set(command.id, runtime);
    return {
        commandId: command.id,
        name: command.name,
        command: command.command,
    };
});

ipcMain.handle('desktop:provider:background-command-open', async (_event, input) => {
    const runtime = commandsById.get(input.commandId);
    if (!runtime) {
        throw new Error(`Background command not found: ${input.commandId}`);
    }
    return runtime.getBackgroundCommand(input.commandId).open();
});

ipcMain.handle('desktop:provider:background-command-restart', async (_event, input) => {
    const runtime = commandsById.get(input.commandId);
    if (!runtime) {
        throw new Error(`Background command not found: ${input.commandId}`);
    }
    await runtime.getBackgroundCommand(input.commandId).restart();
});

ipcMain.handle('desktop:provider:background-command-kill', async (_event, input) => {
    const runtime = commandsById.get(input.commandId);
    if (!runtime) {
        return;
    }
    await runtime.getBackgroundCommand(input.commandId).kill();
});

ipcMain.handle('desktop:provider:git-status', async (_event, input) => {
    return getRuntimeBySandboxId(`${NODE_FS_SANDBOX_PREFIX}${input.sessionId}`).gitStatus();
});

ipcMain.handle('desktop:provider:reload', async (_event, input) => {
    const runtime = getRuntimeBySandboxId(`${NODE_FS_SANDBOX_PREFIX}${input.sessionId}`);
    await runtime.restartDevServer();
    return true;
});

ipcMain.handle('desktop:provider:reconnect', async (_event, input) => {
    const runtime = getRuntimeBySandboxId(`${NODE_FS_SANDBOX_PREFIX}${input.sessionId}`);
    if (runtime.status !== 'running') {
        await runtime.start();
    }
});

ipcMain.handle('desktop:provider:ping', async (_event, input) => {
    const runtime = getRuntimeBySandboxId(`${NODE_FS_SANDBOX_PREFIX}${input.sessionId}`);
    return runtime.status === 'running';
});

ipcMain.handle('desktop:provider:pause-project', async () => {
    return {};
});

ipcMain.handle('desktop:provider:stop-project', async (_event, input) => {
    const runtime = getRuntimeBySandboxId(`${NODE_FS_SANDBOX_PREFIX}${input.sessionId}`);
    await runtime.stop();
    return {};
});

ipcMain.handle('desktop:provider:list-projects', async () => {
    return {
        projects: await listRecentProjects(),
    };
});

app.whenReady().then(() => {
    const shouldAutoLaunch = Boolean(process.env.ONLOOK_DESKTOP_AUTOLAUNCH_PATH);
    createWindow();

    void (shouldAutoLaunch ? maybeAutoLaunchProject() : Promise.resolve(false)).then(
        (launched) => {
            if (!launched && mainWindow) {
                void mainWindow.loadURL(getWebUrl());
            }
        },
    );

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            const shouldAutoLaunch = Boolean(process.env.ONLOOK_DESKTOP_AUTOLAUNCH_PATH);
            createWindow();

            void (shouldAutoLaunch ? maybeAutoLaunchProject() : Promise.resolve(false)).then(
                (launched) => {
                    if (!launched && mainWindow) {
                        void mainWindow.loadURL(getWebUrl());
                    }
                },
            );
        }
    });
});

app.on('before-quit', () => {
    for (const runtime of runtimesById.values()) {
        void runtime.stop();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
