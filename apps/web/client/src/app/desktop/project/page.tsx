'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@onlook/ui/button';
import { Icons } from '@onlook/ui/icons';
import {
    DESKTOP_LOCAL_PROJECT_QUERY_KEY,
    DESKTOP_LOCAL_SESSION_QUERY_KEY,
    getDesktopLocalProjectRoute,
} from '@/utils/desktop-local';
import { Routes } from '@/utils/constants';

export default function DesktopProjectPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const projectId = searchParams.get(DESKTOP_LOCAL_PROJECT_QUERY_KEY);
    const sessionId = searchParams.get(DESKTOP_LOCAL_SESSION_QUERY_KEY);

    useEffect(() => {
        if (!projectId) {
            return;
        }

        router.replace(getDesktopLocalProjectRoute(projectId, sessionId));
    }, [projectId, router, sessionId]);

    if (projectId) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
                <div className="flex max-w-lg flex-col items-center gap-4 text-center">
                    <Icons.LoadingSpinner className="h-6 w-6 animate-spin text-foreground-primary" />
                    <div className="space-y-1">
                        <h1 className="text-lg font-medium">Opening desktop project</h1>
                        <p className="text-sm text-foreground-secondary">
                            Redirecting to the standard project workspace.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
            <div className="max-w-lg space-y-4 text-center">
                <Icons.ExclamationTriangle className="mx-auto h-6 w-6 text-foreground-primary" />
                <div className="space-y-1">
                    <h1 className="text-lg font-medium">Desktop project unavailable</h1>
                    <p className="text-sm text-foreground-secondary">
                        No saved desktop project was provided to restore.
                    </p>
                </div>
                <Button onClick={() => router.push(Routes.PROJECTS)}>
                    Back to Projects
                </Button>
            </div>
        </div>
    );
}
