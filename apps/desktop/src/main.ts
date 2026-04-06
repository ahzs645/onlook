import { app, BrowserWindow, shell } from 'electron';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PREVIEW_CAPTURE_HEIGHT, PREVIEW_CAPTURE_PROBE_TIMEOUT_MS, PREVIEW_CAPTURE_SETTLE_MS, PREVIEW_CAPTURE_TIMEOUT_MS, PREVIEW_CAPTURE_WIDTH, DEFAULT_PACKAGED_WEB_URL, DEFAULT_WEB_URL, DESKTOP_STORAGE_DIRECTORY_NAME, LEGACY_DESKTOP_CHAT_DIRECTORY_NAME, LEGACY_RECENT_PROJECTS_FILE_NAME, type DesktopProjectSession, type DesktopRecentProject } from './types';
import { createDesktopStorage, type DesktopStorage } from './storage';
import { createDesktopSecureStorage, type DesktopSecureStorage } from './storage/secure';
import { inspectProject } from './project-utils';
import { RuntimeRegistry } from './runtime/registry';
import { ProjectSwitchService } from './runtime/switch';
import type { ManagedProcess, StreamKind } from './runtime/managed-process';
import type { ManagedTerminal } from './runtime/managed-terminal';
import { desktopIpcChannels, getProviderStreamChannel } from './ipc/channels';
import { registerDesktopIpcHandlers } from './ipc/register-handlers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DESKTOP_LOCAL_PROJECT_PREFIX = 'desktop-local:';
const userDataPathOverride = process.env.ONLOOK_DESKTOP_USER_DATA_PATH?.trim();

if (userDataPathOverride) {
    app.setPath('userData', userDataPathOverride);
}

let mainWindow: BrowserWindow | null = null;
let desktopStorage: DesktopStorage | null = null;
let desktopSecureStorage: DesktopSecureStorage | null = null;
const runtimeRegistry = new RuntimeRegistry();
const previewCapturesInFlight = new Set<string>();
const boundTaskProcessIds = new Set<string>();

function getDesktopStorage() {
    if (!desktopStorage) {
        desktopStorage = createDesktopStorage(app.getPath('userData'));
    }
    return desktopStorage;
}

function getDesktopSecureStorage() {
    if (!desktopSecureStorage) {
        desktopSecureStorage = createDesktopSecureStorage(
            path.join(app.getPath('userData'), DESKTOP_STORAGE_DIRECTORY_NAME),
        );
    }
    return desktopSecureStorage;
}

function getSwitchService() {
    return new ProjectSwitchService(getDesktopStorage(), runtimeRegistry);
}

function isDestroyedWindowError(error: unknown) {
    return error instanceof Error && error.message.includes('Object has been destroyed');
}

function isUsableWindow(window: BrowserWindow | null): window is BrowserWindow {
    return Boolean(window && !window.isDestroyed() && !window.webContents.isDestroyed());
}

function getMainWindow() {
    if (!isUsableWindow(mainWindow)) {
        mainWindow = null;
        return null;
    }
    return mainWindow;
}

function sendToMainWindow(channel: string, payload: unknown) {
    const window = getMainWindow();
    if (!window) {
        return false;
    }

    try {
        window.webContents.send(channel, payload);
        return true;
    } catch (error) {
        if (isDestroyedWindowError(error) && mainWindow === window) {
            mainWindow = null;
            return false;
        }
        throw error;
    }
}

async function loadBrowserWindow(window: BrowserWindow, url: string, label: string) {
    if (!isUsableWindow(window)) {
        if (mainWindow === window) {
            mainWindow = null;
        }
        return false;
    }

    try {
        await window.loadURL(url);
        return true;
    } catch (error) {
        if (isDestroyedWindowError(error) && mainWindow === window) {
            mainWindow = null;
            return false;
        }

        console.error(`[desktop] Failed to load ${label}:`, error);
        return false;
    }
}

function ensureMainWindow() {
    const window = getMainWindow();
    if (window) {
        return window;
    }

    return createWindow();
}

async function loadMainWindow(url: string, label: string) {
    return loadBrowserWindow(ensureMainWindow(), url, label);
}

function getWebUrl() {
    return process.env.ONLOOK_DESKTOP_WEB_URL
        ?? process.env.ONLOOK_WEB_URL
        ?? (app.isPackaged ? DEFAULT_PACKAGED_WEB_URL : DEFAULT_WEB_URL);
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

function hasActiveRuntimeSession(runtime: ReturnType<RuntimeRegistry['getRuntimeBySessionId']>) {
    return runtime?.status === 'starting' || runtime?.status === 'running';
}

function notifyProjectsUpdated(projectId?: string) {
    sendToMainWindow(desktopIpcChannels.events.projectsUpdated, {
        projectId: projectId ?? null,
    });
}

function bindStreamOutput(kind: StreamKind, process: ManagedProcess | ManagedTerminal) {
    process.onOutput((data) => {
        sendToMainWindow(getProviderStreamChannel(kind, process.id), data);
    });
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
    const updated = await getDesktopStorage().updateProjectRecord(projectId, (record) => ({
        ...record,
        previewImageDataUrl,
    }));

    if (updated) {
        notifyProjectsUpdated(projectId);
    }
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

async function listRecentProjects(): Promise<DesktopRecentProject[]> {
    const records = await getDesktopStorage().getProjectRecords();

    return Promise.all(
        records.map(async (record) => {
            const exists = await fs
                .access(record.folderPath)
                .then(() => true)
                .catch(() => false);
            const runtime = runtimeRegistry.getRuntimeByProjectId(record.id);
            const hasActiveSession = hasActiveRuntimeSession(runtime);

            if (!record.previewImageDataUrl) {
                void maybeCaptureRecentProjectPreview(
                    record.id,
                    runtime?.previewUrl ?? record.previewUrl,
                );
            }

            return {
                ...record,
                exists,
                sessionId: hasActiveSession ? runtime?.id ?? null : null,
                status: runtime?.status ?? null,
            };
        }),
    );
}

async function getRecentProject(projectId: string) {
    const projects = await listRecentProjects();
    return projects.find((entry) => entry.id === projectId) ?? null;
}

async function attachRuntime(runtime: NonNullable<ReturnType<RuntimeRegistry['getRuntimeByProjectId']>>) {
    const task = runtime.getTask('dev');
    if (!boundTaskProcessIds.has(task.id)) {
        bindStreamOutput('task', task);
        boundTaskProcessIds.add(task.id);
    }
    runtimeRegistry.registerTask(runtime, task.id);
}

async function launchProjectByFolder(folderPath: string) {
    const result = await getSwitchService().switchProject({ folderPath });
    const runtime = runtimeRegistry.getRuntimeBySessionId(result.session.id);
    if (runtime) {
        await attachRuntime(runtime);
    }
    const projectId = runtime?.projectId ?? null;
    notifyProjectsUpdated(projectId ?? undefined);
    if (projectId && !result.session.previewImageDataUrl) {
        void captureAndPersistRecentProjectPreview(projectId, result.session.previewUrl);
    }
    return result.session;
}

async function launchProjectById(projectId: string) {
    const result = await getSwitchService().switchProject({ projectId });
    const runtime = runtimeRegistry.getRuntimeBySessionId(result.session.id);
    if (runtime) {
        await attachRuntime(runtime);
    }
    notifyProjectsUpdated(projectId);
    if (!result.session.previewImageDataUrl) {
        void captureAndPersistRecentProjectPreview(projectId, result.session.previewUrl);
    }
    return result.session;
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

    win.on('closed', () => {
        if (mainWindow === win) {
            mainWindow = null;
        }
    });

    mainWindow = win;

    if (initialUrl) {
        void loadBrowserWindow(win, initialUrl, 'initial desktop URL');
    }

    return win;
}

async function maybeAutoLaunchProject() {
    const folderPath = process.env.ONLOOK_DESKTOP_AUTOLAUNCH_PATH;
    if (!folderPath) {
        return false;
    }

    try {
        const session = await launchProjectByFolder(folderPath);
        return loadMainWindow(
            getDesktopProjectUrl(session.id, runtimeRegistry.getRuntimeBySessionId(session.id)?.projectId),
            'desktop project route',
        );
    } catch (error) {
        console.error('[desktop] Failed to auto-launch project:', error);
        return false;
    }
}

async function maybeRestoreLastActiveProject() {
    const settings = await getDesktopStorage().getSettings();
    if (settings.startupRestore !== 'last_active') {
        return false;
    }

    const appState = await getDesktopStorage().getAppState();
    if (!appState.lastActiveProjectId) {
        return false;
    }

    try {
        const record = await getDesktopStorage().getProjectRecord(appState.lastActiveProjectId);
        if (!record) {
            return false;
        }

        await fs.access(record.folderPath);
        const summary = await inspectProject(record.folderPath);
        if (!summary.isValid) {
            return false;
        }

        const session = await launchProjectById(record.id);
        return loadMainWindow(getDesktopProjectUrl(session.id, record.id), 'desktop project route');
    } catch (error) {
        console.error('[desktop] Failed to restore the last active project:', error);
        return false;
    }
}

async function stopAllRuntimes() {
    await Promise.all(
        runtimeRegistry.listRuntimes().map(async (runtime) => {
            await runtime.stop();
            runtimeRegistry.clearRuntimeResources(runtime.id);
        }),
    );
}

function hydratePathFromLoginShell() {
    if (process.platform === 'win32') {
        return;
    }

    const shellPath = process.env.SHELL?.trim();
    if (!shellPath) {
        return;
    }

    const result = spawnSync(shellPath, ['-lic', 'printf %s "$PATH"'], {
        encoding: 'utf8',
    });
    const nextPath = result.stdout?.trim();
    if (result.status === 0 && nextPath) {
        process.env.PATH = nextPath;
    }
}

hydratePathFromLoginShell();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        const window = ensureMainWindow();
        if (window.isMinimized()) {
            window.restore();
        }
        window.show();
        window.focus();
    });
}

registerDesktopIpcHandlers({
    getDesktopStorage,
    runtimeRegistry,
    inspectProject,
    listRecentProjects,
    getRecentProject,
    launchProjectByFolder,
    launchProjectById,
    notifyProjectsUpdated,
    updateRecentProjectPreview,
    bindStreamOutput,
    sendToMainWindow,
    reconnectRuntime: async (runtimeId: string) => {
        return getSwitchService().reconnectRuntime(runtimeId);
    },
});

app.whenReady().then(async () => {
    await getDesktopStorage().ensureReady();
    await getDesktopSecureStorage().ensureReady();

    const shouldAutoLaunch = Boolean(process.env.ONLOOK_DESKTOP_AUTOLAUNCH_PATH);
    createWindow();

    const launched = shouldAutoLaunch
        ? await maybeAutoLaunchProject()
        : await maybeRestoreLastActiveProject();

    if (!launched) {
        await loadMainWindow(getWebUrl(), 'desktop home');
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow(getWebUrl());
        }
    });
});

let cleanupComplete = false;

app.on('before-quit', (event) => {
    if (cleanupComplete) {
        return;
    }

    event.preventDefault();
    sendToMainWindow(desktopIpcChannels.events.prepareToQuit, { reason: 'app-quit' as const });
    const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(resolve, 10_000);
    });

    void Promise.race([stopAllRuntimes(), timeoutPromise]).finally(() => {
        cleanupComplete = true;
        app.quit();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
