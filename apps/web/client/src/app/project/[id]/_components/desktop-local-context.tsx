'use client';

import type { DesktopProjectSession } from '@/utils/desktop-local';
import { createContext, useContext } from 'react';

interface DesktopLocalProjectContextValue {
    desktopProjectId: string;
    session: DesktopProjectSession;
    isProjectReady: boolean;
    error: string | null;
}

export const DesktopLocalProjectContext =
    createContext<DesktopLocalProjectContextValue | null>(null);

export function useOptionalDesktopLocalProject() {
    return useContext(DesktopLocalProjectContext);
}

export function useDesktopLocalProject() {
    const value = useOptionalDesktopLocalProject();
    if (!value) {
        throw new Error('Desktop local project context is not available');
    }
    return value;
}
