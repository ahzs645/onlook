import { env } from '@/env';
import { CodeProvider } from '@onlook/code-provider/browser';

export function getConfiguredClientSandboxProvider(): CodeProvider {
    if (env.NEXT_PUBLIC_SANDBOX_PROVIDER === CodeProvider.E2B) {
        return CodeProvider.E2B;
    }

    if (env.NEXT_PUBLIC_SANDBOX_PROVIDER === CodeProvider.NodeFs) {
        return CodeProvider.NodeFs;
    }

    return CodeProvider.CodeSandbox;
}
