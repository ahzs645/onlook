import { api } from '@/trpc/client';
import { getConfiguredClientSandboxProvider } from '@/utils/sandbox-provider';
import {
    CodeProvider,
    createCodeProviderClient,
    type E2BSession,
    type Provider,
} from '@onlook/code-provider/browser';

export async function createHostedSessionProvider(
    sandboxId: string,
    userId?: string,
): Promise<Provider> {
    const sandboxProvider = getConfiguredClientSandboxProvider();

    if (sandboxProvider === CodeProvider.NodeFs) {
        throw new Error('NodeFs sessions are only supported for desktop-local projects');
    }

    if (sandboxProvider === CodeProvider.E2B) {
        return createCodeProviderClient(CodeProvider.E2B, {
            providerOptions: {
                e2b: {
                    sandboxId,
                    userId,
                    initClient: true,
                    getSession: async (targetSandboxId: string) => {
                        return api.sandbox.start.mutate({
                            sandboxId: targetSandboxId,
                        }) as Promise<E2BSession>;
                    },
                },
            },
        });
    }

    return createCodeProviderClient(CodeProvider.CodeSandbox, {
        providerOptions: {
            codesandbox: {
                sandboxId,
                userId,
                initClient: true,
                getSession: async (targetSandboxId: string) => {
                    return api.sandbox.start.mutate({
                        sandboxId: targetSandboxId,
                    });
                },
            },
        },
    });
}

export async function hibernateHostedSession(sandboxId: string): Promise<void> {
    await api.sandbox.hibernate.mutate({ sandboxId });
}
