'use client';

import { useEffect, useState } from 'react';

const BRIDGE_POLL_INTERVAL_MS = 50;
const BRIDGE_TIMEOUT_MS = 3000;

export function useDesktopBridge() {
    const [desktop, setDesktop] = useState<Window['onlookDesktop'] | null>(null);
    const [isResolving, setIsResolving] = useState(true);

    useEffect(() => {
        if (typeof window === 'undefined') {
            setIsResolving(false);
            return;
        }

        const existingBridge = window.onlookDesktop;
        if (existingBridge) {
            setDesktop(existingBridge);
            setIsResolving(false);
            return;
        }

        const startedAt = window.performance.now();
        const pollId = window.setInterval(() => {
            const bridge = window.onlookDesktop;
            if (bridge) {
                setDesktop(bridge);
                setIsResolving(false);
                window.clearInterval(pollId);
                return;
            }

            if (window.performance.now() - startedAt >= BRIDGE_TIMEOUT_MS) {
                setIsResolving(false);
                window.clearInterval(pollId);
            }
        }, BRIDGE_POLL_INTERVAL_MS);

        return () => {
            window.clearInterval(pollId);
        };
    }, []);

    return {
        desktop,
        isDesktop: Boolean(desktop?.isDesktop),
        isResolving,
    };
}
