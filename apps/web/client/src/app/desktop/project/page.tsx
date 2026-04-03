'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { debounce } from 'lodash';
import { reaction } from 'mobx';

import { EditorEngineProvider, useEditorEngine } from '@/components/store/editor';
import { Icons } from '@onlook/ui/icons';
import { Button } from '@onlook/ui/button';
import { TooltipProvider } from '@onlook/ui/tooltip';
import { cn } from '@onlook/ui/utils';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

import { BottomBar } from '@/app/project/[id]/_components/bottom-bar';
import { Canvas } from '@/app/project/[id]/_components/canvas';
import { EditorBar } from '@/app/project/[id]/_components/editor-bar';
import { LeftPanel } from '@/app/project/[id]/_components/left-panel';
import { ModeToggle } from '@/app/project/[id]/_components/top-bar/mode-toggle';
import { usePanelMeasurements } from '@/app/project/[id]/_hooks/use-panel-measure';
import type { Branch, Canvas as ProjectCanvas, Frame, Project } from '@onlook/models';

import {
    createDesktopLocalProjectId,
    type DesktopProjectSession,
    DESKTOP_LOCAL_SESSION_QUERY_KEY,
} from '@/utils/desktop-local';
import { useDesktopBridge } from '../use-desktop-bridge';

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

function DesktopProjectProviders({
    children,
    project,
    branches,
}: {
    children: React.ReactNode;
    project: Project;
    branches: Branch[];
}) {
    return (
        <DndProvider backend={HTML5Backend}>
            <EditorEngineProvider project={project} branches={branches}>
                {children}
            </EditorEngineProvider>
        </DndProvider>
    );
}

function createDesktopProject(session: DesktopProjectSession): Project {
    const now = new Date();
    return {
        id: createDesktopLocalProjectId(session.id),
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

function DesktopProjectHeader({ session }: { session: DesktopProjectSession }) {
    const router = useRouter();

    return (
        <div className="flex h-10 items-center justify-between bg-background-onlook/60 px-2 backdrop-blur-xl">
            <div className="min-w-0 flex flex-1 items-center gap-3">
                <button
                    type="button"
                    onClick={() => router.push('/desktop')}
                    className="inline-flex h-8 items-center rounded-md border border-border/60 px-2 text-xs text-foreground-secondary transition hover:border-border hover:text-foreground"
                >
                    Choose Another Folder
                </button>
                <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{session.name}</div>
                    <div className="truncate text-xs text-foreground-secondary">{session.folderPath}</div>
                </div>
            </div>
            <ModeToggle />
            <div className="flex flex-1 items-center justify-end gap-2">
                <button
                    type="button"
                    onClick={() => {
                        void window.onlookDesktop?.openPath(session.folderPath);
                    }}
                    className="inline-flex h-8 items-center rounded-md border border-border/60 px-2 text-xs text-foreground-secondary transition hover:border-border hover:text-foreground"
                >
                    Reveal Folder
                </button>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    onClick={() => {
                        void window.onlookDesktop?.openExternal(session.previewUrl);
                    }}
                >
                    Open Preview
                </Button>
            </div>
        </div>
    );
}

function DesktopProjectShell({ session }: { session: DesktopProjectSession }) {
    const editorEngine = useEditorEngine();
    const leftPanelRef = useRef<HTMLDivElement | null>(null);
    const rightPanelRef = useRef<HTMLDivElement | null>(null);
    const initializedSessionRef = useRef<string | null>(null);
    const [isReady, setIsReady] = useState(false);
    const { toolbarLeft, toolbarRight, editorBarAvailableWidth } = usePanelMeasurements(
        leftPanelRef,
        rightPanelRef,
    );

    useEffect(() => {
        if (initializedSessionRef.current === session.id) {
            return;
        }

        const project = createDesktopProject(session);
        const branch = createDesktopBranch(project.id, session);
        const canvas = createDesktopCanvas(project.id, session);
        const frame = createDesktopFrame(canvas.id, branch.id, session);

        editorEngine.canvas.applyCanvas(canvas);
        editorEngine.frames.clear();
        editorEngine.frames.applyFrames([frame]);

        initializedSessionRef.current = session.id;
        setIsReady(false);
    }, [editorEngine, session]);

    useEffect(() => {
        const dispose = reaction(
            () => editorEngine.activeSandbox.session.provider,
            (provider) => {
                setIsReady(Boolean(provider));
            },
            { fireImmediately: true },
        );

        return () => {
            dispose();
        };
    }, [editorEngine]);

    useEffect(() => {
        if (!isReady) {
            return;
        }

        const timeout = window.setTimeout(() => {
            editorEngine.frames.reloadAllViews();
        }, 1500);

        return () => {
            window.clearTimeout(timeout);
        };
    }, [editorEngine, isReady, session.id]);

    useEffect(() => {
        if (!isReady) {
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
    }, [editorEngine, isReady, session.id]);

    if (!isReady) {
        return (
            <DesktopLoadingState
                title="Preparing local editor"
                body="Connecting the desktop file bridge, syncing project files, and waiting for the local preview to stabilize."
            />
        );
    }

    return (
        <TooltipProvider>
            <div className="relative flex h-screen w-screen select-none overflow-hidden">
                <Canvas />

                <div className="absolute top-0 w-full">
                    <DesktopProjectHeader session={session} />
                </div>

                <div
                    ref={leftPanelRef}
                    className="absolute top-10 left-0 z-50 h-[calc(100%-40px)]"
                >
                    <LeftPanel />
                </div>

                <div
                    className="absolute top-10 z-49 flex items-start justify-center overflow-hidden"
                    style={{
                        left: toolbarLeft,
                        right: toolbarRight,
                        maxWidth: editorBarAvailableWidth,
                        pointerEvents: 'none',
                    }}
                >
                    <div style={{ pointerEvents: 'auto' }}>
                        <EditorBar availableWidth={editorBarAvailableWidth} />
                    </div>
                </div>

                <div
                    ref={rightPanelRef}
                    className={cn('pointer-events-none absolute top-10 right-0 z-0 h-0 w-0')}
                />

                <BottomBar />
            </div>
        </TooltipProvider>
    );
}

export default function DesktopProjectPage() {
    const searchParams = useSearchParams();
    const sessionId = searchParams.get(DESKTOP_LOCAL_SESSION_QUERY_KEY);
    const [session, setSession] = useState<DesktopProjectSession | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const { desktop, isResolving } = useDesktopBridge();

    useEffect(() => {
        if (isResolving) {
            return;
        }

        if (!desktop) {
            setError('Desktop bridge is not available in this browser context.');
            setIsLoading(false);
            return;
        }

        if (!sessionId) {
            setError('No desktop project session was provided.');
            setIsLoading(false);
            return;
        }

        let cancelled = false;

        void desktop
            .getProjectSession(sessionId)
            .then((result: DesktopProjectSession | null) => {
                if (cancelled) {
                    return;
                }

                if (!result) {
                    setError('This desktop project session is no longer available.');
                    return;
                }

                setSession(result);
                setError(null);
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
    }, [desktop, isResolving, sessionId]);

    const project = useMemo(() => {
        if (!session) {
            return null;
        }
        return createDesktopProject(session);
    }, [session]);

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
                body="Restoring the local project session from the Electron shell."
            />
        );
    }

    if (!project || !session || branches.length === 0) {
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
                    <Button onClick={() => window.location.assign('/desktop')}>Back to Desktop</Button>
                </div>
            </div>
        );
    }

    return (
        <DesktopProjectProviders project={project} branches={branches}>
            <DesktopProjectShell session={session} />
        </DesktopProjectProviders>
    );
}
