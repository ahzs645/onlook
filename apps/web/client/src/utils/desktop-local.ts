import type { NodeFsDesktopProviderBridge } from '@onlook/code-provider/browser';

export const DESKTOP_LOCAL_PROJECT_PREFIX = 'desktop-local:';
export const DESKTOP_LOCAL_SESSION_QUERY_KEY = 'session';

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

export function createDesktopLocalProjectId(sessionId: string): string {
    return `${DESKTOP_LOCAL_PROJECT_PREFIX}${sessionId}`;
}

export function isDesktopLocalProjectId(projectId: string): boolean {
    return projectId.startsWith(DESKTOP_LOCAL_PROJECT_PREFIX);
}

type DesktopProviderBridge = NodeFsDesktopProviderBridge;

declare global {
    interface OnlookDesktopBridge {
        isDesktop: boolean;
        electronVersion: string;
        pickDirectory: () => Promise<string | null>;
        inspectProject: (folderPath: string) => Promise<DesktopProjectSummary>;
        launchProject: (folderPath: string) => Promise<DesktopProjectSession>;
        getProjectSession: (sessionId: string) => Promise<DesktopProjectSession | null>;
        openPath: (targetPath: string) => Promise<void>;
        openExternal: (targetUrl: string) => Promise<void>;
        provider: DesktopProviderBridge;
    }

    interface Window {
        onlookDesktop?: OnlookDesktopBridge;
    }
}
