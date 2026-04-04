'use client';

import { useDesktopBridge } from '@/app/desktop/use-desktop-bridge';
import { useEditorEngine } from '@/components/store/editor';
import { Routes } from '@/utils/constants';
import {
    createDesktopLocalProjectId,
    getDesktopLocalProjectRoute,
    type DesktopProjectSession,
} from '@/utils/desktop-local';
import { Button } from '@onlook/ui/button';
import { Icons } from '@onlook/ui/icons';
import { debounce } from 'lodash';
import { reaction } from 'mobx';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ProjectProviders } from '../providers';
import { type Branch, type Canvas as ProjectCanvas, type Frame, type Project } from '@onlook/models';
import { Main } from './main';
import { DesktopLocalProjectContext } from './desktop-local-context';

const DESKTOP_PREVIEW_WATCH_EXCLUDES = ['.git', '.next', '.turbo', 'node_modules', 'dist', 'build'];
const DESKTOP_PREVIEW_IGNORE_FILES = new Set([
    '.DS_Store',
    'Thumbs.db',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
]);

function shouldReloadDesktopPreview(paths: string[]) {
    return paths.some((entry) => {
        const normalizedPath = entry.replace(/^\.\/+/, '').trim();
        if (!normalizedPath) {
            return false;
        }

        if (DESKTOP_PREVIEW_IGNORE_FILES.has(normalizedPath)) {
            return false;
        }

        return true;
    });
}

function createDesktopProject(session: DesktopProjectSession, desktopProjectId: string): Project {
    const now = new Date();

    return {
        id: createDesktopLocalProjectId(desktopProjectId),
        name: session.name,
        metadata: {
            createdAt: now,
            updatedAt: now,
            previewImg: null,
            description: session.folderPath,
            tags: ['desktop-local'],
        },
    };
}

function createDesktopBranch(projectId: string, session: DesktopProjectSession): Branch {
    const now = new Date();

    return {
        id: `desktop-branch:${session.id}`,
        projectId,
        name: 'main',
        description: 'Local desktop branch',
        createdAt: now,
        updatedAt: now,
        isDefault: true,
        git: null,
        sandbox: {
            id: session.sandboxId,
        },
    };
}

function createDesktopCanvas(projectId: string, session: DesktopProjectSession): ProjectCanvas {
    return {
        id: `desktop-canvas:${session.id}`,
        userId: `desktop-user:${projectId}`,
        scale: 0.56,
        position: {
            x: 120,
            y: 120,
        },
    };
}

function createDesktopFrame(canvasId: string, branchId: string, session: DesktopProjectSession): Frame {
    return {
        id: `desktop-frame:${session.id}`,
        canvasId,
        branchId,
        position: {
            x: 150,
            y: 40,
        },
        dimension: {
            width: 1536,
            height: 960,
        },
        url: session.previewUrl,
    };
}

function DesktopLoadingState({
    title,
    body,
}: {
    title: string;
    body: string;
}) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
            <div className="flex max-w-lg flex-col items-center gap-4 text-center">
                <Icons.LoadingSpinner className="h-6 w-6 animate-spin text-foreground-primary" />
                <div className="space-y-1">
                    <h1 className="text-lg font-medium">{title}</h1>
                    <p className="text-sm text-foreground-secondary">{body}</p>
                </div>
            </div>
        </div>
    );
}

function DesktopUnavailableState({ error }: { error: string | null }) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
            <div className="max-w-lg space-y-4 text-center">
                <Icons.ExclamationTriangle className="mx-auto h-6 w-6 text-foreground-primary" />
                <div className="space-y-1">
                    <h1 className="text-lg font-medium">Desktop project unavailable</h1>
                    <p className="text-sm text-foreground-secondary">
                        {error ?? 'The local editor session could not be restored.'}
                    </p>
                </div>
                <Button onClick={() => window.location.assign(Routes.PROJECTS)}>
                    Back to Projects
                </Button>
            </div>
        </div>
    );
}

function DesktopLocalProjectBootstrap({
    desktopProjectId,
    session,
    onReadyChange,
}: {
    desktopProjectId: string;
    session: DesktopProjectSession;
    onReadyChange: (isReady: boolean) => void;
}) {
    const editorEngine = useEditorEngine();
    const initializedSessionRef = useRef<string | null>(null);
    const [isSandboxReady, setIsSandboxReady] = useState(false);
    const [isChatReady, setIsChatReady] = useState(false);

    useEffect(() => {
        if (initializedSessionRef.current === session.id) {
            return;
        }

        const projectId = createDesktopLocalProjectId(desktopProjectId);
        const branch = createDesktopBranch(projectId, session);
        const canvas = createDesktopCanvas(projectId, session);
        const frame = createDesktopFrame(canvas.id, branch.id, session);

        editorEngine.canvas.applyCanvas(canvas);
        editorEngine.frames.clear();
        editorEngine.frames.applyFrames([frame]);

        initializedSessionRef.current = session.id;
        setIsSandboxReady(false);
        setIsChatReady(false);
        onReadyChange(false);
    }, [desktopProjectId, editorEngine, onReadyChange, session]);

    useEffect(() => {
        const dispose = reaction(
            () => editorEngine.activeSandbox.session.provider,
            (provider) => {
                setIsSandboxReady(Boolean(provider));
            },
            { fireImmediately: true },
        );

        return () => {
            dispose();
        };
    }, [editorEngine]);

    useEffect(() => {
        if (!isSandboxReady) {
            return;
        }

        let cancelled = false;

        const initializeChat = async () => {
            try {
                const conversations = await editorEngine.chat.conversation.getConversations(
                    createDesktopLocalProjectId(desktopProjectId),
                );
                if (cancelled) {
                    return;
                }
                await editorEngine.chat.conversation.applyConversations(conversations);
            } catch (error) {
                console.error('[desktop] Failed to initialize local chat:', error);
            } finally {
                if (!cancelled) {
                    setIsChatReady(true);
                }
            }
        };

        void initializeChat();

        return () => {
            cancelled = true;
        };
    }, [desktopProjectId, editorEngine, isSandboxReady]);

    useEffect(() => {
        onReadyChange(isSandboxReady && isChatReady);
    }, [isChatReady, isSandboxReady, onReadyChange]);

    useEffect(() => {
        if (!isSandboxReady) {
            return;
        }

        const timeout = window.setTimeout(() => {
            editorEngine.frames.reloadAllViews();
        }, 1500);

        return () => {
            window.clearTimeout(timeout);
        };
    }, [editorEngine, isSandboxReady, session.id]);

    useEffect(() => {
        if (!isSandboxReady) {
            return;
        }

        const provider = editorEngine.activeSandbox.session.provider;
        if (!provider) {
            return;
        }

        let followUpReloadTimeout: number | null = null;
        const reloadPreview = debounce(() => {
            editorEngine.frames.reloadAllViews();
            if (followUpReloadTimeout !== null) {
                window.clearTimeout(followUpReloadTimeout);
            }

            followUpReloadTimeout = window.setTimeout(() => {
                editorEngine.frames.reloadAllViews();
                followUpReloadTimeout = null;
            }, 1500);
        }, 500);

        let disposed = false;
        let stopWatcher: (() => Promise<void>) | null = null;

        const startWatching = async () => {
            try {
                const { watcher } = await provider.watchFiles({
                    args: {
                        path: './',
                        recursive: true,
                        excludes: DESKTOP_PREVIEW_WATCH_EXCLUDES,
                    },
                    onFileChange: async (event) => {
                        if (!shouldReloadDesktopPreview(event.paths)) {
                            return;
                        }

                        reloadPreview();
                    },
                });

                if (disposed) {
                    await watcher.stop();
                    return;
                }

                stopWatcher = () => watcher.stop();
            } catch (error) {
                console.error('[desktop] Failed to watch preview files:', error);
            }
        };

        void startWatching();

        return () => {
            disposed = true;
            reloadPreview.cancel();
            if (followUpReloadTimeout !== null) {
                window.clearTimeout(followUpReloadTimeout);
            }
            if (stopWatcher) {
                void stopWatcher();
            }
        };
    }, [editorEngine, isSandboxReady, session.id]);

    return null;
}

export function DesktopLocalProjectRoute({
    desktopProjectId,
    initialSessionId,
}: {
    desktopProjectId: string;
    initialSessionId: string | null;
}) {
    const router = useRouter();
    const { desktop, isResolving } = useDesktopBridge();
    const [session, setSession] = useState<DesktopProjectSession | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isProjectReady, setIsProjectReady] = useState(false);

    useEffect(() => {
        if (isResolving) {
            return;
        }

        if (!desktop) {
            setError('Desktop bridge is not available in this browser context.');
            setIsLoading(false);
            return;
        }

        let cancelled = false;

        const loadProject = async () => {
            if (initialSessionId) {
                const existingSession = await desktop.getProjectSession(initialSessionId);
                if (existingSession) {
                    return existingSession;
                }
            }

            return desktop.launchProjectById(desktopProjectId);
        };

        void loadProject()
            .then((result) => {
                if (cancelled) {
                    return;
                }

                setSession(result);
                setError(null);
                if (initialSessionId !== result.id) {
                    router.replace(getDesktopLocalProjectRoute(desktopProjectId, result.id));
                }
            })
            .catch((cause: unknown) => {
                if (cancelled) {
                    return;
                }
                setError(cause instanceof Error ? cause.message : 'Failed to load desktop project');
            })
            .finally(() => {
                if (!cancelled) {
                    setIsLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [desktop, desktopProjectId, initialSessionId, isResolving, router]);

    const project = useMemo(() => {
        if (!session) {
            return null;
        }

        return createDesktopProject(session, desktopProjectId);
    }, [desktopProjectId, session]);

    const branches = useMemo(() => {
        if (!project || !session) {
            return [];
        }

        return [createDesktopBranch(project.id, session)];
    }, [project, session]);

    if (isLoading) {
        return (
            <DesktopLoadingState
                title="Loading desktop project"
                body="Restoring the saved desktop project from the Electron shell."
            />
        );
    }

    if (!project || !session || branches.length === 0) {
        return <DesktopUnavailableState error={error} />;
    }

    return (
        <DesktopLocalProjectContext.Provider
            value={{
                desktopProjectId,
                session,
                isProjectReady,
                error,
            }}
        >
            <ProjectProviders project={project} branches={branches}>
                <DesktopLocalProjectBootstrap
                    desktopProjectId={desktopProjectId}
                    session={session}
                    onReadyChange={setIsProjectReady}
                />
                <Main />
            </ProjectProviders>
        </DesktopLocalProjectContext.Provider>
    );
}
