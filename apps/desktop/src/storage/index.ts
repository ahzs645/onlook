import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
    DEFAULT_DESKTOP_APP_STATE,
    DEFAULT_DESKTOP_SETTINGS,
    DEFAULT_DOCKER_IMAGE_TAG,
    DESKTOP_STORAGE_DIRECTORY_NAME,
    LEGACY_DESKTOP_CHAT_DIRECTORY_NAME,
    LEGACY_RECENT_PROJECTS_FILE_NAME,
    MAX_RECENT_PROJECTS,
    type DesktopAppSettings,
    type DesktopAppState,
    type DesktopProjectRecord,
    type DesktopProjectSummary,
    type RuntimeBackendKind,
} from '../types';
import { JsonFileStore } from './file';
import { TextDirectoryStore } from './directory';

interface LegacyDesktopProjectRecord extends DesktopProjectSummary {
    id: string;
    lastOpenedAt: string;
}

function isLegacyDesktopProjectRecord(value: unknown): value is LegacyDesktopProjectRecord {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<LegacyDesktopProjectRecord>;
    return (
        typeof candidate.id === 'string' &&
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

export class DesktopStorage {
    private readonly storageRoot: string;
    private readonly settingsStore: JsonFileStore<DesktopAppSettings>;
    private readonly appStateStore: JsonFileStore<DesktopAppState>;
    private readonly projectsStore: JsonFileStore<DesktopProjectRecord[]>;
    private readonly chatStore: TextDirectoryStore;
    private readyPromise: Promise<void> | null = null;

    constructor(private readonly userDataPath: string) {
        this.storageRoot = path.join(userDataPath, DESKTOP_STORAGE_DIRECTORY_NAME);
        this.settingsStore = new JsonFileStore(path.join(this.storageRoot, 'settings.json'));
        this.appStateStore = new JsonFileStore(path.join(this.storageRoot, 'app-state.json'));
        this.projectsStore = new JsonFileStore(path.join(this.storageRoot, 'projects.json'));
        this.chatStore = new TextDirectoryStore(path.join(this.storageRoot, 'chat'));
    }

    async ensureReady() {
        if (!this.readyPromise) {
            this.readyPromise = this.initialize();
        }
        await this.readyPromise;
    }

    private async initialize() {
        await fs.mkdir(this.storageRoot, { recursive: true });
        await this.migrateLegacyData();

        if (!(await this.settingsStore.read())) {
            await this.settingsStore.write(DEFAULT_DESKTOP_SETTINGS);
        }

        if (!(await this.appStateStore.read())) {
            await this.appStateStore.write(DEFAULT_DESKTOP_APP_STATE);
        }

        if (!(await this.projectsStore.read())) {
            await this.projectsStore.write([]);
        }
    }

    private async migrateLegacyData() {
        const existingProjects = await this.projectsStore.read();
        const existingSettings = await this.settingsStore.read();
        const existingAppState = await this.appStateStore.read();
        const legacyProjectsPath = path.join(this.userDataPath, LEGACY_RECENT_PROJECTS_FILE_NAME);
        const legacyChatPath = path.join(this.userDataPath, LEGACY_DESKTOP_CHAT_DIRECTORY_NAME);

        if (!existingProjects) {
            let migratedProjects: DesktopProjectRecord[] = [];

            try {
                const raw = await fs.readFile(legacyProjectsPath, 'utf8');
                const parsed = JSON.parse(raw) as unknown;
                if (Array.isArray(parsed)) {
                    migratedProjects = parsed.flatMap((entry) => {
                        if (!isLegacyDesktopProjectRecord(entry)) {
                            return [];
                        }

                        return [{
                            ...entry,
                            preferredBackend: 'local' as RuntimeBackendKind,
                            containerConfig: {
                                engine: 'docker' as const,
                                imageTag: DEFAULT_DOCKER_IMAGE_TAG,
                            },
                        }];
                    }).slice(0, MAX_RECENT_PROJECTS);
                }
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                    throw error;
                }
            }

            await this.projectsStore.write(migratedProjects);

            if (!existingAppState && migratedProjects.length > 0) {
                await this.appStateStore.write({
                    lastActiveProjectId: migratedProjects[0]?.id ?? null,
                });
            }
        }

        try {
            await fs.access(legacyChatPath);
            await fs.mkdir(this.chatStore.path, { recursive: true });
            const entries = await fs.readdir(legacyChatPath, { withFileTypes: true });
            await Promise.all(
                entries
                    .filter((entry) => entry.isFile())
                    .map(async (entry) => {
                        const sourcePath = path.join(legacyChatPath, entry.name);
                        const targetPath = path.join(this.chatStore.path, entry.name);
                        try {
                            await fs.access(targetPath);
                        } catch (error) {
                            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                                await fs.copyFile(sourcePath, targetPath);
                                return;
                            }
                            throw error;
                        }
                    }),
            );
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
        }

        if (!existingSettings) {
            await this.settingsStore.write(DEFAULT_DESKTOP_SETTINGS);
        }
    }

    async getSettings() {
        await this.ensureReady();
        return (await this.settingsStore.read()) ?? DEFAULT_DESKTOP_SETTINGS;
    }

    async updateSettings(input: Partial<DesktopAppSettings>) {
        await this.ensureReady();
        return this.settingsStore.update((current) => ({
            ...DEFAULT_DESKTOP_SETTINGS,
            ...(current ?? {}),
            ...input,
            ai: {
                ...DEFAULT_DESKTOP_SETTINGS.ai,
                ...(current?.ai ?? {}),
                ...(input.ai ?? {}),
            },
            version: 1,
            startupRestore: 'last_active',
            defaultRuntimeBackend: 'local',
        }));
    }

    async getAppState() {
        await this.ensureReady();
        return (await this.appStateStore.read()) ?? DEFAULT_DESKTOP_APP_STATE;
    }

    async updateAppState(input: Partial<DesktopAppState>) {
        await this.ensureReady();
        return this.appStateStore.update((current) => ({
            ...DEFAULT_DESKTOP_APP_STATE,
            ...(current ?? {}),
            ...input,
        }));
    }

    async getProjectRecords() {
        await this.ensureReady();
        return (await this.projectsStore.read()) ?? [];
    }

    async getProjectRecord(projectId: string) {
        const records = await this.getProjectRecords();
        return records.find((record) => record.id === projectId) ?? null;
    }

    async upsertProjectRecord(
        summary: DesktopProjectSummary,
        options?: {
            projectId?: string;
            markOpened?: boolean;
        },
    ) {
        await this.ensureReady();
        const records = await this.getProjectRecords();
        const existingRecord =
            (options?.projectId
                ? records.find((record) => record.id === options.projectId)
                : null) ?? records.find((record) => record.folderPath === summary.folderPath);

        const nextRecord: DesktopProjectRecord = {
            ...summary,
            previewImageDataUrl:
                summary.previewImageDataUrl ?? existingRecord?.previewImageDataUrl ?? null,
            id: existingRecord?.id ?? options?.projectId ?? crypto.randomUUID(),
            lastOpenedAt:
                options?.markOpened || !existingRecord
                    ? new Date().toISOString()
                    : existingRecord.lastOpenedAt,
            preferredBackend: existingRecord?.preferredBackend ?? 'local',
            containerConfig:
                existingRecord?.containerConfig ?? {
                    engine: 'docker',
                    imageTag: DEFAULT_DOCKER_IMAGE_TAG,
                },
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

        await this.projectsStore.write(nextRecords);
        return nextRecord;
    }

    async updateProjectRecord(
        projectId: string,
        updater: (record: DesktopProjectRecord) => DesktopProjectRecord,
    ): Promise<DesktopProjectRecord | null> {
        await this.ensureReady();
        let updatedRecord: DesktopProjectRecord | null = null;
        await this.projectsStore.update((current) => {
            const records = current ?? [];
            return records.map((record) => {
                if (record.id !== projectId) {
                    return record;
                }
                updatedRecord = updater(record);
                return updatedRecord;
            });
        });
        return updatedRecord;
    }

    async removeProjectRecord(projectId: string) {
        await this.ensureReady();
        await this.projectsStore.update((current) => {
            return (current ?? []).filter((record) => record.id !== projectId);
        });

        const appState = await this.getAppState();
        if (appState.lastActiveProjectId === projectId) {
            await this.updateAppState({ lastActiveProjectId: null });
        }
    }

    async readChat(projectId: string) {
        await this.ensureReady();
        return this.chatStore.read(projectId);
    }

    async writeChat(projectId: string, content: string) {
        await this.ensureReady();
        await this.chatStore.write(projectId, content);
    }
}

export function createDesktopStorage(userDataPath: string) {
    return new DesktopStorage(userDataPath);
}
