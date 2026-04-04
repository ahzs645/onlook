import { api } from '@/trpc/server';
import {
    DESKTOP_LOCAL_SESSION_QUERY_KEY,
    isDesktopLocalProjectId,
    parseDesktopLocalProjectId,
} from '@/utils/desktop-local';
import { DesktopLocalProjectRoute } from './_components/desktop-local-route';
import { Main } from './_components/main';
import { ProjectProviders } from './providers';

export default async function Page({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const projectId = (await params).id;
    if (!projectId) {
        return <div>Invalid project ID</div>;
    }

    if (isDesktopLocalProjectId(projectId)) {
        const desktopProjectId = parseDesktopLocalProjectId(projectId);
        if (!desktopProjectId) {
            return <div>Invalid desktop project ID</div>;
        }

        const resolvedSearchParams = await searchParams;
        const sessionParam = resolvedSearchParams[DESKTOP_LOCAL_SESSION_QUERY_KEY];
        const sessionId = Array.isArray(sessionParam) ? (sessionParam[0] ?? null) : (sessionParam ?? null);

        return (
            <DesktopLocalProjectRoute
                desktopProjectId={desktopProjectId}
                initialSessionId={sessionId}
            />
        );
    }

    try {
        // Fetch required project data before initializing providers
        const [project, branches] = await Promise.all([
            api.project.get({ projectId }),
            api.branch.getByProjectId({ projectId }),
        ]);

        if (!project) {
            return <div>Project not found</div>;
        }

        return (
            <ProjectProviders project={project} branches={branches}>
                <Main />
            </ProjectProviders>
        );
    } catch (error) {
        console.error('Failed to load project data:', error);
        return (
            <div className="h-screen w-screen flex items-center justify-center">
                <div>Failed to load project: {error instanceof Error ? error.message : 'Unknown error'}</div>
            </div>
        );
    }
}
