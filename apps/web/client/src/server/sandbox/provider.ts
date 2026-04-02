import { env } from '@/env';
import {
    CodeProvider,
    CodesandboxProvider,
    NodeFsProvider,
    type Provider,
} from '@onlook/code-provider';
import { getSandboxPreviewUrl, SandboxTemplates, Templates } from '@onlook/constants';

export function getConfiguredSandboxProvider(): CodeProvider {
    return env.SANDBOX_PROVIDER === CodeProvider.E2B
        ? CodeProvider.E2B
        : CodeProvider.CodeSandbox;
}

export function getConfiguredSandboxTemplate(template: Templates) {
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
    if (getConfiguredSandboxProvider() === CodeProvider.E2B) {
        const { E2BProvider } = await import('@onlook/code-provider/src/providers/e2b');
        return E2BProvider;
    }

    if (getConfiguredSandboxProvider() === CodeProvider.NodeFs) {
        return NodeFsProvider;
    }

    return CodesandboxProvider;
}
