import type { NodeFsDesktopProviderBridge } from '@onlook/code-provider/browser';

export const DESKTOP_LOCAL_PROJECT_PREFIX = 'desktop-local:';
export const DESKTOP_LOCAL_SESSION_QUERY_KEY = 'session';
export const DESKTOP_LOCAL_PROJECT_QUERY_KEY = 'project';

export type DesktopProjectSessionStatus = 'starting' | 'running' | 'stopped' | 'error';

export interface DesktopProjectSummary {
    folderPath: string;
    name: string;
    isValid: boolean;
    error?: string;
    routerType?: 'app' | 'pages';
    packageManager: 'bun' | 'npm' | 'pnpm' | 'yarn' | 'unknown';
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

export interface DesktopProjectSession extends DesktopProjectSummary {
    id: string;
    sandboxId: string;
    status: DesktopProjectSessionStatus;
    lastError?: string;
}

export interface DesktopRecentProject extends DesktopProjectSummary {
    id: string;
    lastOpenedAt: string;
    exists: boolean;
    sessionId: string | null;
    status: DesktopProjectSessionStatus | null;
}

export function normalizeDesktopLocalProjectId(projectId: string): string {
    try {
        return decodeURIComponent(projectId);
    } catch {
        return projectId;
    }
}

export function createDesktopLocalProjectId(projectId: string): string {
    return `${DESKTOP_LOCAL_PROJECT_PREFIX}${projectId}`;
}

export function isDesktopLocalProjectId(projectId: string): boolean {
    return normalizeDesktopLocalProjectId(projectId).startsWith(DESKTOP_LOCAL_PROJECT_PREFIX);
}

export function parseDesktopLocalProjectId(projectId: string): string | null {
    const normalizedProjectId = normalizeDesktopLocalProjectId(projectId);
    return isDesktopLocalProjectId(normalizedProjectId)
        ? normalizedProjectId.slice(DESKTOP_LOCAL_PROJECT_PREFIX.length)
        : null;
}

export function getDesktopLocalProjectRoute(projectId: string, sessionId?: string | null) {
    const params = new URLSearchParams();
    if (sessionId) {
        params.set(DESKTOP_LOCAL_SESSION_QUERY_KEY, sessionId);
    }

    const query = params.toString();
    return `/project/${createDesktopLocalProjectId(projectId)}${query ? `?${query}` : ''}`;
}

type DesktopProviderBridge = NodeFsDesktopProviderBridge;

declare global {
    interface OnlookDesktopBridge {
        isDesktop: boolean;
        electronVersion: string;
        pickDirectory: () => Promise<string | null>;
        inspectProject: (folderPath: string) => Promise<DesktopProjectSummary>;
        saveProject: (folderPath: string) => Promise<DesktopRecentProject>;
        getProject: (projectId: string) => Promise<DesktopRecentProject | null>;
        readChatStore: (projectId: string) => Promise<string | null>;
        writeChatStore: (projectId: string, content: string) => Promise<void>;
        saveProjectPreview: (
            projectId: string,
            previewImageDataUrl: string,
        ) => Promise<void>;
        launchProject: (folderPath: string) => Promise<DesktopProjectSession>;
        launchProjectById: (projectId: string) => Promise<DesktopProjectSession>;
        getProjectSession: (sessionId: string) => Promise<DesktopProjectSession | null>;
        listProjects: () => Promise<DesktopRecentProject[]>;
        onProjectsUpdated: (callback: (payload: { projectId: string }) => void) => () => void;
        removeProject: (projectId: string) => Promise<DesktopRecentProject[]>;
        openPath: (targetPath: string) => Promise<void>;
        openExternal: (targetUrl: string) => Promise<void>;
        provider: DesktopProviderBridge;
    }

    interface Window {
        onlookDesktop?: OnlookDesktopBridge;
    }
}
