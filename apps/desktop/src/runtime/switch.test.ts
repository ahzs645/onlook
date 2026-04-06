import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDesktopStorage } from '../storage';
import type { DesktopProjectRecord, DesktopProjectSession, DesktopProjectSummary } from '../types';
import { RuntimeRegistry } from './registry';
import { ProjectSwitchService } from './switch';

const tempDirs: string[] = [];

async function createTempDir() {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'onlook-desktop-switch-'));
    tempDirs.push(directory);
    return directory;
}

afterEach(async () => {
    await Promise.all(
        tempDirs.splice(0).map(async (directory) => {
            await rm(directory, { recursive: true, force: true });
        }),
    );
});

function createSummary(folderPath: string, name: string): DesktopProjectSummary {
    return {
        folderPath,
        name,
        isValid: true,
        packageManager: 'bun',
        hasGit: true,
        hasNodeModules: true,
        fileCount: 3,
        sampleFiles: ['app/page.tsx'],
        port: 3000,
        previewUrl: 'http://localhost:3000',
        previewImageDataUrl: null,
        devCommand: 'bun run dev',
        buildCommand: 'bun run build',
        installCommand: 'bun install',
        scripts: {
            dev: 'next dev',
        },
    };
}

class FakeRuntime {
    readonly sandboxId: string;
    readonly taskId: string;
    lastError?: string;
    stopCount = 0;
    startCount = 0;

    constructor(
        readonly projectId: string,
        readonly id: string,
        private summary: DesktopProjectSummary,
        readonly backendKind: 'local' | 'container',
        readonly folderPath: string,
        status: DesktopProjectSession['status'],
    ) {
        this.status = status;
        this.sandboxId = `nodefs:session:${id}`;
        this.taskId = `task:${id}:dev`;
    }

    status: DesktopProjectSession['status'];

    updateRecord(summary: DesktopProjectSummary) {
        this.summary = summary;
    }

    getTask() {
        return {
            id: this.taskId,
            name: 'server',
            command: this.summary.devCommand ?? '',
        };
    }

    async start() {
        this.startCount += 1;
        this.status = 'running';
        return this.toSession();
    }

    async stop() {
        this.stopCount += 1;
        this.status = 'stopped';
    }

    toSession() {
        return {
            ...this.summary,
            id: this.id,
            sandboxId: this.sandboxId,
            status: this.status,
            backend: this.backendKind,
        } satisfies DesktopProjectSession;
    }
}

describe('ProjectSwitchService', () => {
    it('stops other active runtimes in single_active mode', async () => {
        const userDataPath = await createTempDir();
        const projectRootA = path.join(userDataPath, 'project-a');
        const projectRootB = path.join(userDataPath, 'project-b');
        await mkdir(projectRootA, { recursive: true });
        await mkdir(projectRootB, { recursive: true });

        const storage = createDesktopStorage(userDataPath);
        await storage.ensureReady();
        await storage.updateSettings({ runtimePolicy: 'single_active' });

        const summaryA = createSummary(projectRootA, 'Project A');
        const summaryB = createSummary(projectRootB, 'Project B');
        const recordA = await storage.upsertProjectRecord(summaryA, { markOpened: true });
        const recordB = await storage.upsertProjectRecord(summaryB, { markOpened: true });
        await storage.updateAppState({ lastActiveProjectId: recordA.id });

        const runtimeA = new FakeRuntime(recordA.id, 'runtime-a', summaryA, 'local', projectRootA, 'running');
        const runtimeB = new FakeRuntime(recordB.id, 'runtime-b', summaryB, 'local', projectRootB, 'stopped');

        const registry = new RuntimeRegistry();
        registry.registerRuntime(runtimeA as never);
        registry.registerTask(runtimeA as never, runtimeA.getTask().id);

        const service = new ProjectSwitchService(storage, registry, {
            createRuntime: (record: DesktopProjectRecord) => {
                return (record.id === recordB.id ? runtimeB : runtimeA) as never;
            },
            inspectProject: async (folderPath) => {
                return folderPath === projectRootA ? summaryA : summaryB;
            },
        });

        const result = await service.switchProject({ projectId: recordB.id });
        const appState = await storage.getAppState();

        expect(result.stoppedProjectIds).toEqual([recordA.id]);
        expect(runtimeA.stopCount).toBe(1);
        expect(runtimeB.startCount).toBe(1);
        expect(appState.lastActiveProjectId).toBe(recordB.id);
    });

    it('keeps other runtimes running in multi_active mode', async () => {
        const userDataPath = await createTempDir();
        const projectRootA = path.join(userDataPath, 'project-a');
        const projectRootB = path.join(userDataPath, 'project-b');
        await mkdir(projectRootA, { recursive: true });
        await mkdir(projectRootB, { recursive: true });

        const storage = createDesktopStorage(userDataPath);
        await storage.ensureReady();
        await storage.updateSettings({ runtimePolicy: 'multi_active' });

        const summaryA = createSummary(projectRootA, 'Project A');
        const summaryB = createSummary(projectRootB, 'Project B');
        const recordA = await storage.upsertProjectRecord(summaryA, { markOpened: true });
        const recordB = await storage.upsertProjectRecord(summaryB, { markOpened: true });
        await storage.updateAppState({ lastActiveProjectId: recordA.id });

        const runtimeA = new FakeRuntime(recordA.id, 'runtime-a', summaryA, 'local', projectRootA, 'running');
        const runtimeB = new FakeRuntime(recordB.id, 'runtime-b', summaryB, 'local', projectRootB, 'stopped');

        const registry = new RuntimeRegistry();
        registry.registerRuntime(runtimeA as never);
        registry.registerTask(runtimeA as never, runtimeA.getTask().id);

        const service = new ProjectSwitchService(storage, registry, {
            createRuntime: (record: DesktopProjectRecord) => {
                return (record.id === recordB.id ? runtimeB : runtimeA) as never;
            },
            inspectProject: async (folderPath) => {
                return folderPath === projectRootA ? summaryA : summaryB;
            },
        });

        const result = await service.switchProject({ projectId: recordB.id });

        expect(result.stoppedProjectIds).toEqual([]);
        expect(runtimeA.stopCount).toBe(0);
        expect(runtimeB.startCount).toBe(1);
    });
});
