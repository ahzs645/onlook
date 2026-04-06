import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDesktopStorage } from './index';
import { DEFAULT_DOCKER_IMAGE_TAG, LEGACY_DESKTOP_CHAT_DIRECTORY_NAME, LEGACY_RECENT_PROJECTS_FILE_NAME } from '../types';

const tempDirs: string[] = [];

async function createUserDataDir() {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'onlook-desktop-storage-'));
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

describe('DesktopStorage', () => {
    it('migrates legacy projects and chat data into versioned desktop storage', async () => {
        const userDataPath = await createUserDataDir();
        const legacyProject = {
            id: 'project-1',
            folderPath: '/tmp/project-1',
            name: 'Project One',
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
            lastOpenedAt: '2026-01-01T00:00:00.000Z',
        };

        await writeFile(
            path.join(userDataPath, LEGACY_RECENT_PROJECTS_FILE_NAME),
            JSON.stringify([legacyProject], null, 2),
            'utf8',
        );
        await mkdir(path.join(userDataPath, LEGACY_DESKTOP_CHAT_DIRECTORY_NAME), { recursive: true });
        await writeFile(
            path.join(
                userDataPath,
                LEGACY_DESKTOP_CHAT_DIRECTORY_NAME,
                `${encodeURIComponent(legacyProject.id)}.json`,
            ),
            '{"messages":[]}',
            'utf8',
        );

        const storage = createDesktopStorage(userDataPath);
        await storage.ensureReady();

        const settings = await storage.getSettings();
        const appState = await storage.getAppState();
        const records = await storage.getProjectRecords();
        const chat = await storage.readChat(legacyProject.id);

        expect(settings.runtimePolicy).toBe('single_active');
        expect(settings.ai.providerSource).toBe('codex');
        expect(settings.ai.model).toBe('gpt-5.4');
        expect(settings.ai.autoApplyToNewChats).toBe(true);
        expect(appState.lastActiveProjectId).toBe(legacyProject.id);
        expect(records).toHaveLength(1);
        expect(records[0]?.preferredBackend).toBe('local');
        expect(records[0]?.containerConfig?.imageTag).toBe(DEFAULT_DOCKER_IMAGE_TAG);
        expect(chat).toBe('{"messages":[]}');
    });

    it('merges AI settings updates without dropping existing desktop preferences', async () => {
        const userDataPath = await createUserDataDir();
        const storage = createDesktopStorage(userDataPath);
        await storage.ensureReady();

        const updated = await storage.updateSettings({
            runtimePolicy: 'multi_active',
            ai: {
                providerSource: 'claude',
                model: 'claude-sonnet-4-6',
                autoApplyToNewChats: false,
            },
        });

        expect(updated.runtimePolicy).toBe('multi_active');
        expect(updated.ai.providerSource).toBe('claude');
        expect(updated.ai.model).toBe('claude-sonnet-4-6');
        expect(updated.ai.autoApplyToNewChats).toBe(false);
        expect(updated.startupRestore).toBe('last_active');
        expect(updated.defaultRuntimeBackend).toBe('local');
    });
});
