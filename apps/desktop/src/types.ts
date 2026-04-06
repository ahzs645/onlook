export const DEFAULT_WEB_URL = 'http://localhost:4100/projects';
export const DEFAULT_PACKAGED_WEB_URL = 'https://onlook.com/projects';
export const DEFAULT_LOOPBACK_HOST = 'localhost';
export const DEFAULT_SHELL = process.env.SHELL ?? '/bin/zsh';
export const MAX_SAMPLE_FILES = 12;
export const MAX_RECENT_PROJECTS = 12;
export const PREVIEW_WAIT_TIMEOUT_MS = 120_000;
export const PREVIEW_POLL_INTERVAL_MS = 750;
export const PREVIEW_CAPTURE_WIDTH = 1280;
export const PREVIEW_CAPTURE_HEIGHT = 800;
export const PREVIEW_CAPTURE_SETTLE_MS = 1500;
export const PREVIEW_CAPTURE_TIMEOUT_MS = 15_000;
export const PREVIEW_CAPTURE_PROBE_TIMEOUT_MS = 1500;
export const NODE_FS_SANDBOX_PREFIX = 'nodefs:session:';
export const LEGACY_RECENT_PROJECTS_FILE_NAME = 'desktop-projects.json';
export const LEGACY_DESKTOP_CHAT_DIRECTORY_NAME = 'desktop-chat';
export const DESKTOP_STORAGE_DIRECTORY_NAME = 'desktop-storage';
export const DEFAULT_DOCKER_IMAGE_TAG = 'onlook-desktop-runtime:node20-bun1';

export type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn' | 'unknown';
export type SessionStatus = 'starting' | 'running' | 'stopped' | 'error';
export type RuntimePolicy = 'single_active' | 'multi_active';
export type RuntimeBackendKind = 'local' | 'container';
export type StartupRestoreMode = 'last_active';
export type ContainerEngine = 'docker';
export type DesktopAiProviderSource = 'claude' | 'codex' | 'gemini';

export interface DesktopProjectSummary {
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

export interface DesktopContainerConfig {
    engine: ContainerEngine;
    imageTag: string;
}

export interface DesktopProjectRecord extends DesktopProjectSummary {
    id: string;
    lastOpenedAt: string;
    preferredBackend: RuntimeBackendKind;
    containerConfig?: DesktopContainerConfig;
}

export interface DesktopProjectSession extends DesktopProjectSummary {
    id: string;
    sandboxId: string;
    status: SessionStatus;
    lastError?: string;
    backend: RuntimeBackendKind;
}

export interface DesktopRecentProject extends DesktopProjectRecord {
    exists: boolean;
    sessionId: string | null;
    status: SessionStatus | null;
}

export interface DesktopAppSettings {
    version: 1;
    runtimePolicy: RuntimePolicy;
    startupRestore: StartupRestoreMode;
    defaultRuntimeBackend: 'local';
    ai: DesktopAiSettings;
}

export interface DesktopAiSettings {
    providerSource: DesktopAiProviderSource;
    model: string;
    autoApplyToNewChats: boolean;
}

export interface DesktopAppState {
    lastActiveProjectId: string | null;
}

export interface ProjectLaunchResult {
    session: DesktopProjectSession;
    reused: boolean;
    stoppedProjectIds: string[];
    rollbackAttempted: boolean;
    rollbackSucceeded: boolean;
}

export interface PreviewMetadata {
    port: number;
    previewUrl: string;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopAppSettings = {
    version: 1,
    runtimePolicy: 'single_active',
    startupRestore: 'last_active',
    defaultRuntimeBackend: 'local',
    ai: {
        providerSource: 'codex',
        model: 'gpt-5.4',
        autoApplyToNewChats: true,
    },
};

export const DEFAULT_DESKTOP_APP_STATE: DesktopAppState = {
    lastActiveProjectId: null,
};
