'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
    type DesktopRecentProject,
    getDesktopLocalProjectRoute,
} from '@/utils/desktop-local';
import { useDesktopBridge } from '@/app/desktop/use-desktop-bridge';

function formatOpenedAt(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return 'Recently';
    }

    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(date);
}

function getProjectBadge(project: DesktopRecentProject | null) {
    if (!project) {
        return {
            label: 'No project selected',
            className: 'bg-white/8 text-white/60',
        };
    }

    if (!project.exists) {
        return {
            label: 'Folder missing',
            className: 'bg-amber-400/15 text-amber-100',
        };
    }

    if (!project.isValid) {
        return {
            label: 'Needs attention',
            className: 'bg-amber-400/15 text-amber-100',
        };
    }

    if (project.status === 'running') {
        return {
            label: 'Running',
            className: 'bg-cyan-300/15 text-cyan-100',
        };
    }

    if (project.status === 'starting') {
        return {
            label: 'Starting',
            className: 'bg-cyan-300/15 text-cyan-100',
        };
    }

    return {
        label: 'Ready to open',
        className: 'bg-emerald-400/15 text-emerald-100',
    };
}

function EmptyProjectsState({
    isDesktop,
    isResolving,
    isInspecting,
    isLaunching,
    onChooseFolder,
}: {
    isDesktop: boolean;
    isResolving: boolean;
    isInspecting: boolean;
    isLaunching: boolean;
    onChooseFolder: () => Promise<void>;
}) {
    return (
        <section className="mt-24 max-w-4xl">
            <div className="max-w-2xl">
                <h1 className="text-5xl font-semibold tracking-tight text-white">Projects</h1>
                <p className="mt-4 text-base leading-7 text-white/72">
                    Open a local Next.js project and keep it as a first-class desktop project, even
                    when there is no active editor session running yet.
                </p>
            </div>

            <div className="mt-12 grid gap-6 md:grid-cols-2">
                <button
                    type="button"
                    onClick={() => {
                        void onChooseFolder();
                    }}
                    disabled={!isDesktop || isResolving || isInspecting || isLaunching}
                    className="group rounded-[2rem] border border-white/10 bg-white/6 p-8 text-left shadow-[0_20px_80px_rgba(0,0,0,0.32)] transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/4"
                >
                    <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-white/55">
                        Local
                    </div>
                    <h2 className="mt-6 text-2xl font-medium text-white">Open local project</h2>
                    <p className="mt-3 text-sm leading-6 text-white/70">
                        Choose a folder from disk, save it as a desktop project, then launch the
                        editor with local preview, file access, and chat.
                    </p>
                </button>

                <Link
                    href="/"
                    prefetch={false}
                    className="rounded-[2rem] border border-white/10 bg-black/20 p-8 shadow-[0_20px_80px_rgba(0,0,0,0.32)] transition hover:border-white/20 hover:bg-black/30"
                >
                    <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-white/55">
                        Web
                    </div>
                    <h2 className="mt-6 text-2xl font-medium text-white">Open web landing page</h2>
                    <p className="mt-3 text-sm leading-6 text-white/70">
                        Stay in the hosted web flow instead of the local desktop editor.
                    </p>
                </Link>
            </div>
        </section>
    );
}

export function DesktopProjectsHome() {
    const router = useRouter();
    const [recentProjects, setRecentProjects] = useState<DesktopRecentProject[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoadingProjects, setIsLoadingProjects] = useState(false);
    const [isInspecting, setIsInspecting] = useState(false);
    const [launchingProjectId, setLaunchingProjectId] = useState<string | null>(null);
    const [removingProjectId, setRemovingProjectId] = useState<string | null>(null);
    const { desktop, isDesktop, isResolving } = useDesktopBridge();

    async function refreshProjects(preferredProjectId?: string | null) {
        if (!desktop) {
            return [];
        }

        try {
            setIsLoadingProjects(true);
            const projects = await desktop.listProjects();
            setRecentProjects(projects);
            setSelectedProjectId((current) => {
                if (preferredProjectId && projects.some((entry) => entry.id === preferredProjectId)) {
                    return preferredProjectId;
                }

                if (current && projects.some((entry) => entry.id === current)) {
                    return current;
                }

                return projects[0]?.id ?? null;
            });
            return projects;
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Failed to load recent projects');
            return [];
        } finally {
            setIsLoadingProjects(false);
        }
    }

    useEffect(() => {
        if (!desktop) {
            return;
        }

        void refreshProjects();
    }, [desktop]);

    const selectedProject = selectedProjectId
        ? recentProjects.find((entry) => entry.id === selectedProjectId) ?? null
        : null;
    const selectedBadge = getProjectBadge(selectedProject);
    const canOpenSelectedProject = Boolean(
        selectedProject && selectedProject.isValid && selectedProject.exists,
    );
    const isLaunchingProject = Boolean(launchingProjectId);

    const handleChooseFolder = async () => {
        if (!desktop) {
            setError('Desktop bridge is not available in this browser context.');
            return;
        }

        try {
            setIsInspecting(true);
            setError(null);

            const folderPath = await desktop.pickDirectory();
            if (!folderPath) {
                return;
            }

            const project = await desktop.saveProject(folderPath);
            setSelectedProjectId(project.id);
            await refreshProjects(project.id);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Failed to save local project');
        } finally {
            setIsInspecting(false);
        }
    };

    const handleLaunch = async (projectId?: string) => {
        if (!desktop) {
            setError('Desktop bridge is not available in this browser context.');
            return;
        }

        const targetProjectId = projectId ?? selectedProject?.id;
        if (!targetProjectId) {
            return;
        }

        try {
            setLaunchingProjectId(targetProjectId);
            setError(null);
            const activeSessionId =
                recentProjects.find((entry) => entry.id === targetProjectId)?.sessionId ?? null;
            router.push(getDesktopLocalProjectRoute(targetProjectId, activeSessionId));
        } catch (cause) {
            setLaunchingProjectId(null);
            setError(cause instanceof Error ? cause.message : 'Failed to launch local project');
        }
    };

    const handleRemoveProject = async (projectId: string) => {
        if (!desktop) {
            return;
        }

        try {
            setRemovingProjectId(projectId);
            setError(null);

            const projects = await desktop.removeProject(projectId);
            setRecentProjects(projects);
            setSelectedProjectId((current) => {
                if (current === projectId) {
                    return projects[0]?.id ?? null;
                }

                return current;
            });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Failed to remove project');
        } finally {
            setRemovingProjectId(null);
        }
    };

    return (
        <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(108,190,255,0.14),_transparent_30%),linear-gradient(180deg,_#08090b,_#111317)] text-white">
            <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-8 py-10">
                <div className="flex flex-wrap items-start justify-between gap-5">
                    <div className="max-w-3xl">
                        <p className="mb-3 text-xs uppercase tracking-[0.28em] text-white/45">
                            Onlook Desktop
                        </p>
                        <h1 className="text-5xl font-semibold tracking-tight text-white">
                            Projects
                        </h1>
                        <p className="mt-4 text-base leading-7 text-white/68">
                            Open local projects, return to recent work, and launch the editor from
                            the current monorepo instead of the old desktop spike.
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            onClick={() => {
                                void handleChooseFolder();
                            }}
                            disabled={!isDesktop || isResolving || isInspecting || Boolean(launchingProjectId)}
                            className="rounded-full bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/45"
                        >
                            {isInspecting ? 'Inspecting project...' : 'Open local project'}
                        </button>
                        <Link
                            href="/"
                            prefetch={false}
                            className="rounded-full border border-white/12 px-5 py-3 text-sm font-medium text-white/82 transition hover:border-white/24 hover:text-white"
                        >
                            Web landing page
                        </Link>
                    </div>
                </div>

                {!isDesktop && !isResolving && (
                    <div className="mt-8 rounded-2xl border border-amber-300/18 bg-amber-300/8 px-4 py-3 text-sm text-amber-100/88">
                        Open this route inside the Electron shell to inspect, save, and launch
                        local projects.
                    </div>
                )}

                {error && (
                    <div className="mt-8 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100 whitespace-pre-wrap">
                        {error}
                    </div>
                )}

                {recentProjects.length === 0 ? (
                    <EmptyProjectsState
                        isDesktop={isDesktop}
                        isResolving={isResolving}
                        isInspecting={isInspecting}
                        isLaunching={Boolean(launchingProjectId)}
                        onChooseFolder={handleChooseFolder}
                    />
                ) : (
                    <section className="mt-10 grid gap-6 xl:grid-cols-[0.92fr,1.08fr]">
                        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur">
                            <div className="flex items-center justify-between gap-4 px-2 pb-4">
                                <div>
                                    <p className="text-xs uppercase tracking-[0.24em] text-white/42">
                                        Your Projects
                                    </p>
                                    <p className="mt-2 text-sm text-white/65">
                                        Saved local folders in the desktop shell.
                                    </p>
                                </div>
                                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/55">
                                    {isLoadingProjects ? 'Refreshing...' : `${recentProjects.length} saved`}
                                </div>
                            </div>

                            <div className="space-y-3">
                                {recentProjects.map((entry) => {
                                    const badge = getProjectBadge(entry);

                                    return (
                                        <button
                                            key={entry.id}
                                            type="button"
                                            onClick={() => setSelectedProjectId(entry.id)}
                                            className={`w-full rounded-[1.5rem] border p-4 text-left transition ${
                                                selectedProjectId === entry.id
                                                    ? 'border-cyan-300/35 bg-cyan-300/12 shadow-[0_18px_50px_rgba(24,92,140,0.18)]'
                                                    : 'border-white/8 bg-black/18 hover:border-white/16 hover:bg-black/24'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="min-w-0">
                                                    <h2 className="truncate text-lg font-medium text-white">
                                                        {entry.name}
                                                    </h2>
                                                    <p className="mt-1 text-xs uppercase tracking-[0.24em] text-white/38">
                                                        {entry.routerType === 'app'
                                                            ? 'App Router'
                                                            : entry.routerType === 'pages'
                                                              ? 'Pages Router'
                                                              : 'Next.js'}
                                                    </p>
                                                </div>
                                                <span
                                                    className={`rounded-full px-3 py-1 text-xs font-medium ${badge.className}`}
                                                >
                                                    {badge.label}
                                                </span>
                                            </div>

                                            <p className="mt-3 truncate text-sm text-white/62">
                                                {entry.folderPath}
                                            </p>

                                            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-white/48">
                                                <span>{entry.previewUrl}</span>
                                                <span>Opened {formatOpenedAt(entry.lastOpenedAt)}</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="rounded-[2rem] border border-white/10 bg-black/22 p-6 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur">
                            {selectedProject ? (
                                <>
                                    <div className="flex flex-wrap items-start justify-between gap-6">
                                        <div className="max-w-2xl">
                                            <p className="text-xs uppercase tracking-[0.24em] text-white/42">
                                                Project Details
                                            </p>
                                            <h2 className="mt-3 text-3xl font-semibold text-white">
                                                {selectedProject.name}
                                            </h2>
                                            <p className="mt-3 break-all text-sm leading-6 text-white/66">
                                                {selectedProject.folderPath}
                                            </p>
                                            <p className="mt-3 text-sm text-white/52">
                                                Last opened {formatOpenedAt(selectedProject.lastOpenedAt)}
                                            </p>
                                        </div>

                                        <div className="flex flex-wrap gap-3">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    void handleLaunch(selectedProject.id);
                                                }}
                                                disabled={
                                                    !isDesktop ||
                                                    isResolving ||
                                                    !canOpenSelectedProject ||
                                                    Boolean(launchingProjectId)
                                                }
                                                className="rounded-full bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/45"
                                            >
                                                {launchingProjectId === selectedProject.id
                                                    ? 'Launching editor...'
                                                    : 'Open in editor'}
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    void handleChooseFolder();
                                                }}
                                                disabled={!isDesktop || isResolving || isInspecting || Boolean(launchingProjectId)}
                                                className="rounded-full border border-white/12 px-5 py-3 text-sm font-medium text-white/82 transition hover:border-white/24 hover:text-white disabled:cursor-not-allowed disabled:border-white/8 disabled:text-white/38"
                                            >
                                                Choose another folder
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    void desktop?.openPath(selectedProject.folderPath);
                                                }}
                                                disabled={!isDesktop || isResolving}
                                                className="rounded-full border border-white/12 px-5 py-3 text-sm font-medium text-white/82 transition hover:border-white/24 hover:text-white disabled:cursor-not-allowed disabled:border-white/8 disabled:text-white/38"
                                            >
                                                Reveal folder
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    void handleRemoveProject(selectedProject.id);
                                                }}
                                                disabled={
                                                    !isDesktop ||
                                                    isResolving ||
                                                    removingProjectId === selectedProject.id
                                                }
                                                className="rounded-full border border-red-300/20 px-5 py-3 text-sm font-medium text-red-100/84 transition hover:border-red-200/35 hover:text-red-50 disabled:cursor-not-allowed disabled:border-white/8 disabled:text-white/38"
                                            >
                                                {removingProjectId === selectedProject.id
                                                    ? 'Removing...'
                                                    : 'Forget project'}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="mt-6">
                                        <span
                                            className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${selectedBadge.className}`}
                                        >
                                            {selectedBadge.label}
                                        </span>
                                    </div>

                                    <div className="mt-8 grid gap-6 lg:grid-cols-[1.05fr,0.95fr]">
                                        <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5">
                                            <p className="text-xs uppercase tracking-[0.24em] text-white/42">
                                                Environment
                                            </p>
                                            <dl className="mt-5 grid gap-4 text-sm text-white/72 sm:grid-cols-2">
                                                <div>
                                                    <dt className="mb-1 text-white/42">Router</dt>
                                                    <dd>{selectedProject.routerType ?? 'unknown'}</dd>
                                                </div>
                                                <div>
                                                    <dt className="mb-1 text-white/42">Package manager</dt>
                                                    <dd>{selectedProject.packageManager}</dd>
                                                </div>
                                                <div>
                                                    <dt className="mb-1 text-white/42">Preview URL</dt>
                                                    <dd>{selectedProject.previewUrl}</dd>
                                                </div>
                                                <div>
                                                    <dt className="mb-1 text-white/42">Git repository</dt>
                                                    <dd>{selectedProject.hasGit ? 'yes' : 'no'}</dd>
                                                </div>
                                                <div>
                                                    <dt className="mb-1 text-white/42">Dependencies</dt>
                                                    <dd>
                                                        {selectedProject.hasNodeModules
                                                            ? 'installed'
                                                            : 'will install on launch'}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt className="mb-1 text-white/42">Dev command</dt>
                                                    <dd>{selectedProject.devCommand ?? 'missing'}</dd>
                                                </div>
                                            </dl>

                                            {selectedProject.error && (
                                                <div className="mt-5 rounded-2xl border border-amber-300/18 bg-amber-300/10 px-4 py-3 text-sm text-amber-100/88">
                                                    {selectedProject.error}
                                                </div>
                                            )}

                                            {!selectedProject.exists && (
                                                <div className="mt-5 rounded-2xl border border-amber-300/18 bg-amber-300/10 px-4 py-3 text-sm text-amber-100/88">
                                                    The saved folder path is no longer available on disk.
                                                </div>
                                            )}
                                        </div>

                                        <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5">
                                            <p className="text-xs uppercase tracking-[0.24em] text-white/42">
                                                Sample Files
                                            </p>
                                            <div className="mt-5 space-y-2">
                                                {selectedProject.sampleFiles.length > 0 ? (
                                                    selectedProject.sampleFiles.map((file) => (
                                                        <div
                                                            key={file}
                                                            className="rounded-xl border border-white/8 bg-black/22 px-3 py-2 text-sm text-white/70"
                                                        >
                                                            {file}
                                                        </div>
                                                    ))
                                                ) : (
                                                    <div className="rounded-xl border border-white/8 bg-black/22 px-3 py-2 text-sm text-white/52">
                                                        No files were indexed for this project yet.
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="flex min-h-[28rem] items-center justify-center rounded-[1.5rem] border border-dashed border-white/10 bg-white/4">
                                    <div className="max-w-md text-center">
                                        <h2 className="text-2xl font-medium text-white">
                                            Select a project
                                        </h2>
                                        <p className="mt-3 text-sm leading-6 text-white/66">
                                            Choose a saved local project or pick a new folder to add
                                            it to the desktop workspace.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>
                )}
            </div>
            {isLaunchingProject && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#08090b]/92 backdrop-blur-sm">
                    <div className="flex max-w-lg flex-col items-center gap-4 px-6 text-center text-white">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                        <div className="space-y-1">
                            <h1 className="text-lg font-medium">Loading desktop project</h1>
                            <p className="text-sm text-white/68">
                                Preparing the local editor and preview before the project page loads.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}

export default DesktopProjectsHome;
