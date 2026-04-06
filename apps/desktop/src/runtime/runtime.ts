import { randomUUID } from 'node:crypto';
import { promises as fs, watch as watchFs, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { inspectProject, isExcludedPath, isTextContent, normalizeRelativePath, resolveProjectPath } from '../project-utils';
import {
    DEFAULT_DOCKER_IMAGE_TAG,
    NODE_FS_SANDBOX_PREFIX,
    type DesktopProjectRecord,
    type DesktopProjectSession,
    type DesktopProjectSummary,
    type SessionStatus,
} from '../types';
import type { RuntimeBackend } from './backend';
import { DockerRuntimeBackend } from './docker-backend';
import { LocalRuntimeBackend } from './local-backend';
import type { ManagedProcess } from './managed-process';

interface WatchRegistration {
    id: string;
    watcher: FSWatcher;
}

export class DesktopProjectRuntime {
    readonly id: string;
    readonly sandboxId: string;
    status: SessionStatus = 'stopped';
    lastError?: string;
    private readonly watchers = new Map<string, WatchRegistration>();
    private backend: RuntimeBackend;

    constructor(
        readonly projectId: string,
        runtimeId: string,
        summary: DesktopProjectSummary,
        record: DesktopProjectRecord,
    ) {
        this.id = runtimeId;
        this.sandboxId = `${NODE_FS_SANDBOX_PREFIX}${runtimeId}`;
        this.backend = this.createBackend(summary, record);
        this.attachTaskLifecycle();
    }

    get folderPath() {
        return this.backend.toProjectSummary().folderPath;
    }

    get previewUrl() {
        return this.backend.previewUrl;
    }

    get backendKind() {
        return this.backend.kind;
    }

    updateRecord(summary: DesktopProjectSummary, record: DesktopProjectRecord) {
        if (this.backend.kind !== record.preferredBackend) {
            this.backend = this.createBackend(summary, record);
            this.attachTaskLifecycle();
            return;
        }

        this.backend.setSummary(summary);
    }

    toSession(): DesktopProjectSession {
        return {
            ...this.backend.toProjectSummary(),
            id: this.id,
            sandboxId: this.sandboxId,
            status: this.status,
            lastError: this.lastError,
            backend: this.backend.kind,
        };
    }

    getTask(taskId: string) {
        if (taskId !== 'dev') {
            throw new Error(`Unknown task: ${taskId}`);
        }
        return this.backend.task;
    }

    async start() {
        this.status = 'starting';
        this.lastError = undefined;

        try {
            await this.backend.start();
            this.status = 'running';
            return this.toSession();
        } catch (error) {
            this.status = 'error';
            this.lastError = error instanceof Error ? error.message : 'Failed to start local preview';
            throw error;
        }
    }

    async restartDevServer() {
        this.status = 'starting';
        this.lastError = undefined;

        try {
            await this.backend.restart();
            this.status = 'running';
        } catch (error) {
            this.status = 'error';
            this.lastError = error instanceof Error ? error.message : 'Failed to restart local preview';
            throw error;
        }
    }

    async stop() {
        this.status = 'stopped';
        await this.backend.stop();
        for (const watchRegistration of this.watchers.values()) {
            watchRegistration.watcher.close();
        }
        this.watchers.clear();
    }

    async createTerminal() {
        return this.backend.createTerminal();
    }

    getTerminal(terminalId: string) {
        return this.backend.getTerminal(terminalId);
    }

    async runCommand(command: string) {
        return this.backend.runCommand(command);
    }

    async createBackgroundCommand(command: string) {
        return this.backend.createBackgroundCommand(command);
    }

    getBackgroundCommand(commandId: string) {
        return this.backend.getBackgroundCommand(commandId);
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
    }, onEvent: (watcherId: string, event: { type: 'change' | 'remove'; paths: string[] }) => void) {
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

            onEvent(watcherId, event);
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

    private createBackend(summary: DesktopProjectSummary, record: DesktopProjectRecord): RuntimeBackend {
        if (record.preferredBackend === 'container') {
            return new DockerRuntimeBackend(this.id, summary, record.containerConfig ?? {
                engine: 'docker',
                imageTag: DEFAULT_DOCKER_IMAGE_TAG,
            });
        }
        return new LocalRuntimeBackend(this.id, summary);
    }

    private attachTaskLifecycle() {
        this.backend.task.onExit((code, signal) => {
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
}

