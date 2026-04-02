import { env } from '@/env';
import {
    CodeProvider,
    CodesandboxProvider,
    NodeFsProvider,
    type Provider,
} from '@onlook/code-provider';
import { getSandboxPreviewUrl, SandboxTemplates, Templates } from '@onlook/constants';

const PLACEHOLDER_CODE_SANDBOX_KEYS = new Set([
    'replace-me-csb',
    'changeme',
    'example',
    'test',
]);

const SEEDED_PLACEHOLDER_SANDBOX_IDS = new Set(['123456']);

export function isPlaceholderSandboxId(sandboxId: string): boolean {
    return SEEDED_PLACEHOLDER_SANDBOX_IDS.has(sandboxId);
}

export function getSandboxConfigurationError(): string | null {
    const provider = getConfiguredSandboxProvider();

    if (provider === CodeProvider.E2B) {
        const missingKeys = [
            !env.E2B_API_KEY && 'E2B_API_KEY',
            !env.E2B_DOMAIN && 'E2B_DOMAIN',
            !env.E2B_TEMPLATE_EMPTY_NEXTJS && 'E2B_TEMPLATE_EMPTY_NEXTJS',
        ].filter(Boolean);

        if (missingKeys.length > 0) {
            return `Sandbox provider is not configured for self-hosting. Missing ${missingKeys.join(', ')}.`;
        }

        return null;
    }

    const apiKey = env.CSB_API_KEY?.trim();
    if (!apiKey || PLACEHOLDER_CODE_SANDBOX_KEYS.has(apiKey.toLowerCase())) {
        return 'Sandbox provider is not configured for self-hosting. Configure E2B or provide a valid CodeSandbox API key.';
    }

    return null;
}

export function assertSandboxConfiguration(): void {
    const error = getSandboxConfigurationError();
    if (error) {
        throw new Error(error);
    }
}

export function assertSandboxIdIsUsable(sandboxId: string): void {
    if (!sandboxId) {
        throw new Error('Sandbox ID is missing.');
    }

    if (isPlaceholderSandboxId(sandboxId)) {
        throw new Error(
            'This sample project does not have a real sandbox. Create a new project after configuring a sandbox provider.',
        );
    }
}

export function getConfiguredSandboxProvider(): CodeProvider {
    return env.SANDBOX_PROVIDER === CodeProvider.E2B
        ? CodeProvider.E2B
        : CodeProvider.CodeSandbox;
}

export function getConfiguredSandboxTemplate(template: Templates) {
    assertSandboxConfiguration();

    if (getConfiguredSandboxProvider() === CodeProvider.E2B) {
        const templateId =
            template === Templates.BLANK
                ? env.E2B_TEMPLATE_BLANK ?? env.E2B_TEMPLATE_EMPTY_NEXTJS
                : env.E2B_TEMPLATE_EMPTY_NEXTJS;

        if (!templateId) {
            throw new Error(`E2B template is not configured for ${template}`);
        }

        return {
            id: templateId,
            port: SandboxTemplates[template].port,
        };
    }

    return SandboxTemplates[template];
}

export function getConfiguredSandboxPreviewUrl(
    sandboxId: string,
    port: number,
    sandboxDomain?: string,
) {
    if (getConfiguredSandboxProvider() === CodeProvider.E2B) {
        const domain = sandboxDomain ?? env.E2B_DOMAIN;
        if (!domain) {
            throw new Error('E2B_DOMAIN is required when SANDBOX_PROVIDER=e2b');
        }
        return `https://${port}-${sandboxId}.${domain}`;
    }

    return getSandboxPreviewUrl(sandboxId, port);
}

export async function createConfiguredSandboxProviderClient(params: {
    sandboxId: string;
    userId?: string;
}): Promise<Provider> {
    assertSandboxConfiguration();
    assertSandboxIdIsUsable(params.sandboxId);

    if (getConfiguredSandboxProvider() === CodeProvider.E2B) {
        const { E2BProvider } = await import('@onlook/code-provider/src/providers/e2b');
        const provider = new E2BProvider({
            sandboxId: params.sandboxId,
            userId: params.userId,
            apiKey: env.E2B_API_KEY,
            domain: env.E2B_DOMAIN,
        });
        await provider.initialize({});
        return provider;
    }

    const provider = new CodesandboxProvider({
        sandboxId: params.sandboxId,
        userId: params.userId,
    });
    await provider.initialize({});
    return provider;
}

export async function getConfiguredSandboxStaticProvider() {
    assertSandboxConfiguration();

    if (getConfiguredSandboxProvider() === CodeProvider.E2B) {
        const { E2BProvider } = await import('@onlook/code-provider/src/providers/e2b');
        return E2BProvider;
    }

    if (getConfiguredSandboxProvider() === CodeProvider.NodeFs) {
        return NodeFsProvider;
    }

    return CodesandboxProvider;
}
