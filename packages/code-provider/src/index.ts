import type { Provider } from './types';
import { CodeProvider } from './providers';
import type { CodesandboxProviderOptions } from './providers/codesandbox';
import type { E2BProviderOptions, E2BSession } from './providers/e2b/shared';
import type {
    NodeFsDesktopProviderBridge,
    NodeFsProviderOptions,
} from './providers/nodefs';

export * from './providers';
export type { CodesandboxProviderOptions } from './providers/codesandbox';
export type { E2BProviderOptions, E2BSession } from './providers/e2b/shared';
export type { NodeFsDesktopProviderBridge, NodeFsProviderOptions } from './providers/nodefs';
export * from './types';

type StaticCodeProvider =
    | typeof import('./providers/codesandbox').CodesandboxProvider
    | typeof import('./providers/e2b').E2BProvider
    | typeof import('./providers/nodefs').NodeFsProvider;

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
    const provider = await newProviderInstance(codeProvider, providerOptions);
    await provider.initialize({});
    return provider;
}

export async function getStaticCodeProvider(codeProvider: CodeProvider): Promise<StaticCodeProvider> {
    if (codeProvider === CodeProvider.CodeSandbox) {
        const mod = await import('./providers/codesandbox');
        return mod.CodesandboxProvider;
    }

    if (codeProvider === CodeProvider.E2B) {
        const mod = await import('./providers/e2b');
        return mod.E2BProvider;
    }

    if (codeProvider === CodeProvider.NodeFs) {
        const mod = await import('./providers/nodefs');
        return mod.NodeFsProvider;
    }

    throw new Error(`Unimplemented code provider: ${codeProvider}`);
}

export interface ProviderInstanceOptions {
    codesandbox?: CodesandboxProviderOptions;
    e2b?: E2BProviderOptions;
    nodefs?: NodeFsProviderOptions;
}

async function newProviderInstance(
    codeProvider: CodeProvider,
    providerOptions: ProviderInstanceOptions,
): Promise<Provider> {
    if (codeProvider === CodeProvider.CodeSandbox) {
        if (!providerOptions.codesandbox) {
            throw new Error('Codesandbox provider options are required.');
        }
        const mod = await import('./providers/codesandbox');
        return new mod.CodesandboxProvider(providerOptions.codesandbox);
    }

    if (codeProvider === CodeProvider.E2B) {
        if (!providerOptions.e2b) {
            throw new Error('E2B provider options are required.');
        }
        const mod = await import('./providers/e2b');
        return new mod.E2BProvider(providerOptions.e2b);
    }

    if (codeProvider === CodeProvider.NodeFs) {
        if (!providerOptions.nodefs) {
            throw new Error('NodeFs provider options are required.');
        }
        const mod = await import('./providers/nodefs');
        return new mod.NodeFsProvider(providerOptions.nodefs);
    }

    throw new Error(`Unimplemented code provider: ${codeProvider}`);
}
