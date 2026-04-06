import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { inspectProject } from '../project-utils';
import { type DesktopStorage } from '../storage';
import type { DesktopProjectRecord, DesktopProjectSummary, ProjectLaunchResult } from '../types';
import { RuntimeRegistry } from './registry';
import { DesktopProjectRuntime } from './runtime';

interface SwitchTargetByFolder {
    folderPath: string;
}

interface SwitchTargetByProjectId {
    projectId: string;
}

type SwitchTarget = SwitchTargetByFolder | SwitchTargetByProjectId;

type RuntimeFactory = (record: DesktopProjectRecord, summary: DesktopProjectSummary) => DesktopProjectRuntime;
type ProjectInspector = (folderPath: string) => Promise<DesktopProjectSummary>;

export class ProjectSwitchService {
    private readonly runtimeFactory: RuntimeFactory;
    private readonly projectInspector: ProjectInspector;

    constructor(
        private readonly storage: DesktopStorage,
        private readonly registry: RuntimeRegistry,
        options?: {
            createRuntime?: RuntimeFactory;
            inspectProject?: ProjectInspector;
        },
    ) {
        this.runtimeFactory = options?.createRuntime ?? ((record, summary) => {
            return new DesktopProjectRuntime(record.id, randomUUID(), summary, record);
        });
        this.projectInspector = options?.inspectProject ?? inspectProject;
    }

    async switchProject(target: SwitchTarget): Promise<ProjectLaunchResult> {
        const settings = await this.storage.getSettings();
        const appState = await this.storage.getAppState();
        const resolution = await this.resolveTarget(target);

        const existingRuntime = this.registry.getRuntimeByProjectId(resolution.record.id);
        const reusableRuntime =
            existingRuntime && existingRuntime.backendKind === resolution.record.preferredBackend
                ? existingRuntime
                : null;

        if (existingRuntime && existingRuntime !== reusableRuntime) {
            await existingRuntime.stop();
            this.registry.clearRuntimeResources(existingRuntime.id);
            this.registry.deleteRuntime(existingRuntime.id);
        }

        const runtime =
            reusableRuntime ??
            this.createRuntime(resolution.record, resolution.summary);

        runtime.updateRecord(resolution.summary, resolution.record);
        this.registry.registerRuntime(runtime);
        this.registry.registerTask(runtime, runtime.getTask('dev').id);

        const otherActiveRuntimes = this.registry
            .listActiveRuntimes()
            .filter((entry) => entry.id !== runtime.id);

        const stoppedProjectIds: string[] = [];
        const rollbackRuntime =
            otherActiveRuntimes.find((entry) => entry.projectId === appState.lastActiveProjectId) ??
            otherActiveRuntimes[0] ??
            null;

        if (settings.runtimePolicy === 'single_active') {
            for (const activeRuntime of otherActiveRuntimes) {
                await activeRuntime.stop();
                this.registry.clearRuntimeResources(activeRuntime.id);
                stoppedProjectIds.push(activeRuntime.projectId);
            }
        }

        try {
            const session = await runtime.start();
            const updatedRecord = await this.storage.upsertProjectRecord(runtime.toSession(), {
                projectId: resolution.record.id,
                markOpened: true,
            });
            await this.storage.updateAppState({
                lastActiveProjectId: updatedRecord.id,
            });
            return {
                session,
                reused: reusableRuntime !== null,
                stoppedProjectIds,
                rollbackAttempted: false,
                rollbackSucceeded: false,
            };
        } catch (error) {
            let rollbackAttempted = false;
            let rollbackSucceeded = false;

            if (settings.runtimePolicy === 'single_active' && rollbackRuntime) {
                rollbackAttempted = true;
                try {
                    this.registry.registerTask(rollbackRuntime, rollbackRuntime.getTask('dev').id);
                    await rollbackRuntime.start();
                    rollbackSucceeded = true;
                } catch {
                    rollbackSucceeded = false;
                }
            }

            throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
                rollbackAttempted,
                rollbackSucceeded,
            });
        }
    }

    async reconnectRuntime(sessionId: string) {
        const runtime = this.registry.getRuntimeBySessionId(sessionId);
        if (!runtime) {
            return null;
        }

        if (runtime.status === 'running') {
            return {
                session: runtime.toSession(),
                reused: true,
                stoppedProjectIds: [],
                rollbackAttempted: false,
                rollbackSucceeded: false,
            } satisfies ProjectLaunchResult;
        }

        const record = await this.storage.getProjectRecord(runtime.projectId);
        if (!record) {
            throw new Error('Desktop project not found');
        }

        runtime.updateRecord(await this.projectInspector(record.folderPath), record);
        this.registry.registerTask(runtime, runtime.getTask('dev').id);
        return this.switchProject({ projectId: record.id });
    }

    private async resolveTarget(target: SwitchTarget): Promise<{
        record: DesktopProjectRecord;
        summary: DesktopProjectSummary;
    }> {
        if ('projectId' in target) {
            const record = await this.storage.getProjectRecord(target.projectId);
            if (!record) {
                throw new Error('Desktop project not found');
            }

            await fs.access(record.folderPath);
            const summary = await this.projectInspector(record.folderPath);
            return {
                record,
                summary,
            };
        }

        const summary = await this.projectInspector(target.folderPath);
        const record = await this.storage.upsertProjectRecord(summary, {
            markOpened: true,
        });
        return {
            record,
            summary,
        };
    }

    private createRuntime(record: DesktopProjectRecord, summary: DesktopProjectSummary) {
        return this.runtimeFactory(record, summary);
    }
}
