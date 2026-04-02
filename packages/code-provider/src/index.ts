import { CodeProvider } from './providers';
import { CodesandboxProvider, type CodesandboxProviderOptions } from './providers/codesandbox';
import type { E2BProviderOptions, E2BSession } from './providers/e2b/types';
import { NodeFsProvider, type NodeFsProviderOptions } from './providers/nodefs';
export * from './providers';
export { CodesandboxProvider } from './providers/codesandbox';
export type { E2BProviderOptions, E2BSession } from './providers/e2b/types';
export { NodeFsProvider } from './providers/nodefs';
export * from './types';

export interface CreateClientOptions {
    providerOptions: ProviderInstanceOptions;
}

/**
 * Providers are designed to be singletons; be mindful of this when creating multiple clients
 * or when instantiating in the backend (stateless vs stateful).
 */
export async function createCodeProviderClient(
    codeProvider: CodeProvider,
    { providerOptions }: CreateClientOptions,
) {
    const provider = newProviderInstance(codeProvider, providerOptions);
    await provider.initialize({});
    return provider;
}

export async function getStaticCodeProvider(
    codeProvider: CodeProvider,
): Promise<typeof CodesandboxProvider | typeof NodeFsProvider> {
    if (codeProvider === CodeProvider.CodeSandbox) {
        return CodesandboxProvider;
    }

    if (codeProvider === CodeProvider.E2B) {
        throw new Error('E2B provider must be loaded from a server-only module');
    }

    if (codeProvider === CodeProvider.NodeFs) {
        return NodeFsProvider;
    }
    throw new Error(`Unimplemented code provider: ${codeProvider}`);
}

export interface ProviderInstanceOptions {
    codesandbox?: CodesandboxProviderOptions;
    e2b?: E2BProviderOptions;
    nodefs?: NodeFsProviderOptions;
}

function newProviderInstance(codeProvider: CodeProvider, providerOptions: ProviderInstanceOptions) {
    if (codeProvider === CodeProvider.CodeSandbox) {
        if (!providerOptions.codesandbox) {
            throw new Error('Codesandbox provider options are required.');
        }
        return new CodesandboxProvider(providerOptions.codesandbox);
    }

    if (codeProvider === CodeProvider.E2B) {
        throw new Error('E2B provider must be instantiated from a server-only module');
    }

    if (codeProvider === CodeProvider.NodeFs) {
        if (!providerOptions.nodefs) {
            throw new Error('NodeFs provider options are required.');
        }
        return new NodeFsProvider(providerOptions.nodefs);
    }

    throw new Error(`Unimplemented code provider: ${codeProvider}`);
}
