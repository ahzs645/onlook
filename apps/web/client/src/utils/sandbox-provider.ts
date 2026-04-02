import { env } from '@/env';
import { CodeProvider } from '@onlook/code-provider';

export function getConfiguredClientSandboxProvider(): CodeProvider {
    return env.NEXT_PUBLIC_SANDBOX_PROVIDER === CodeProvider.E2B
        ? CodeProvider.E2B
        : CodeProvider.CodeSandbox;
}
