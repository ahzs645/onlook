'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
    type DesktopProjectSession,
    type DesktopProjectSummary,
    DESKTOP_LOCAL_SESSION_QUERY_KEY,
} from '@/utils/desktop-local';
import { useDesktopBridge } from './use-desktop-bridge';

const cards = [
    {
        title: 'Desktop Runtime',
        body: 'Electron now launches a local Next.js project directly from disk and keeps the current repo UI wrapped around it.',
    },
    {
        title: 'Native Project Access',
        body: 'File sync, terminal output, and preview loading run through the preload bridge instead of uploading source files to a hosted sandbox.',
    },
    {
        title: 'Current Monorepo',
        body: 'The shell stays inside this workspace. There is no dependency on the stale desktop spike anymore.',
    },
];

export default function DesktopPage() {
    const router = useRouter();
    const [project, setProject] = useState<DesktopProjectSummary | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isInspecting, setIsInspecting] = useState(false);
    const [isLaunching, setIsLaunching] = useState(false);
    const { desktop, isDesktop, isResolving } = useDesktopBridge();

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

            const summary = await desktop.inspectProject(folderPath);
            setProject(summary);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Failed to inspect project');
        } finally {
            setIsInspecting(false);
        }
    };

    const handleLaunch = async () => {
        if (!desktop || !project) {
            return;
        }

        try {
            setIsLaunching(true);
            setError(null);

            const session: DesktopProjectSession = await desktop.launchProject(project.folderPath);
            router.push(`/desktop/project?${DESKTOP_LOCAL_SESSION_QUERY_KEY}=${session.id}`);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Failed to launch local project');
        } finally {
            setIsLaunching(false);
        }
    };

    return (
        <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(138,180,248,0.16),_transparent_32%),linear-gradient(180deg,_#0a0a0b,_#131417)] text-white">
            <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-8 py-10">
                <div className="mb-16 flex items-center justify-between gap-6">
                    <div>
                        <p className="mb-3 text-xs uppercase tracking-[0.28em] text-white/50">
                            Onlook Desktop Shell
                        </p>
                        <h1 className="max-w-3xl text-5xl font-semibold tracking-tight text-balance">
                            Current monorepo, native local preview.
                        </h1>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70">
                        Workspace: apps/desktop
                    </div>
                </div>

                <div className="grid gap-5 md:grid-cols-3">
                    {cards.map((card) => (
                        <section
                            key={card.title}
                            className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur"
                        >
                            <h2 className="mb-3 text-xl font-medium">{card.title}</h2>
                            <p className="text-sm leading-6 text-white/72">{card.body}</p>
                        </section>
                    ))}
                </div>

                <section className="mt-10 rounded-3xl border border-white/10 bg-black/20 p-6 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur">
                    <div className="flex flex-wrap items-start justify-between gap-6">
                        <div className="max-w-2xl">
                            <p className="mb-2 text-xs uppercase tracking-[0.28em] text-cyan-200/65">
                                Native Bridge
                            </p>
                            <h2 className="text-2xl font-medium">Open a local Next.js project</h2>
                            <p className="mt-3 text-sm leading-6 text-white/72">
                                The shell reads the selected folder from disk, detects its local dev
                                command, starts the app, and opens the current editor UI against the
                                running preview.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={handleChooseFolder}
                                disabled={!isDesktop || isResolving || isInspecting || isLaunching}
                                className="rounded-full bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/45"
                            >
                                {isInspecting ? 'Inspecting project...' : 'Choose folder'}
                            </button>
                            <button
                                type="button"
                                onClick={handleLaunch}
                                disabled={
                                    !isDesktop ||
                                    isResolving ||
                                    !project?.isValid ||
                                    isInspecting ||
                                    isLaunching
                                }
                                className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-5 py-3 text-sm font-medium text-cyan-100 transition hover:border-cyan-200/45 hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-white/35"
                            >
                                {isLaunching ? 'Launching editor...' : 'Open in editor'}
                            </button>
                        </div>
                    </div>

                    {!isDesktop && !isResolving && (
                        <p className="mt-4 text-sm text-amber-200/80">
                            Open this route inside the Electron shell to use native project selection.
                        </p>
                    )}

                    {error && (
                        <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100 whitespace-pre-wrap">
                            {error}
                        </div>
                    )}

                    {project && (
                        <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                                <div className="mb-4 flex items-center justify-between gap-4">
                                    <div>
                                        <p className="text-xs uppercase tracking-[0.24em] text-white/45">
                                            Project Summary
                                        </p>
                                        <h3 className="mt-2 text-xl font-medium">{project.name}</h3>
                                    </div>
                                    <div
                                        className={`rounded-full px-3 py-1 text-xs font-medium ${
                                            project.isValid
                                                ? 'bg-emerald-400/15 text-emerald-200'
                                                : 'bg-amber-400/15 text-amber-200'
                                        }`}
                                    >
                                        {project.isValid ? 'Ready to launch' : 'Needs work'}
                                    </div>
                                </div>

                                <dl className="grid gap-3 text-sm text-white/75">
                                    <div>
                                        <dt className="mb-1 text-white/45">Folder</dt>
                                        <dd className="break-all">{project.folderPath}</dd>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <dt className="mb-1 text-white/45">Router</dt>
                                            <dd>{project.routerType ?? 'unknown'}</dd>
                                        </div>
                                        <div>
                                            <dt className="mb-1 text-white/45">Package manager</dt>
                                            <dd>{project.packageManager}</dd>
                                        </div>
                                        <div>
                                            <dt className="mb-1 text-white/45">Preview URL</dt>
                                            <dd>{project.previewUrl}</dd>
                                        </div>
                                        <div>
                                            <dt className="mb-1 text-white/45">Dependencies</dt>
                                            <dd>{project.hasNodeModules ? 'installed' : 'will install on launch'}</dd>
                                        </div>
                                        <div>
                                            <dt className="mb-1 text-white/45">Dev command</dt>
                                            <dd>{project.devCommand ?? 'missing'}</dd>
                                        </div>
                                        <div>
                                            <dt className="mb-1 text-white/45">Git repository</dt>
                                            <dd>{project.hasGit ? 'yes' : 'no'}</dd>
                                        </div>
                                    </div>
                                    {project.error && (
                                        <div>
                                            <dt className="mb-1 text-white/45">Validation</dt>
                                            <dd className="text-amber-200">{project.error}</dd>
                                        </div>
                                    )}
                                </dl>
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                                <p className="mb-3 text-xs uppercase tracking-[0.24em] text-white/45">
                                    Sample Files
                                </p>
                                <div className="space-y-2">
                                    {project.sampleFiles.map((file) => (
                                        <div
                                            key={file}
                                            className="rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-sm text-white/72"
                                        >
                                            {file}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </section>

                <div className="mt-16 flex flex-wrap items-center gap-4">
                    <Link
                        href="/"
                        prefetch={false}
                        className="rounded-full bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-white/90"
                    >
                        Open web landing page
                    </Link>
                    <a
                        href="https://github.com/onlook-dev/onlook"
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-white/15 px-5 py-3 text-sm font-medium text-white/80 transition hover:border-white/30 hover:text-white"
                    >
                        View upstream repo
                    </a>
                </div>
            </div>
        </main>
    );
}
