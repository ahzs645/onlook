import { env } from '@/env';
import { CodeProvider, createCodeProviderClient, getStaticCodeProvider } from '@onlook/code-provider';
import { getSandboxPreviewUrl, SandboxTemplates, Templates } from '@onlook/constants';

export function getConfiguredSandboxProvider(): CodeProvider {
    if (env.SANDBOX_PROVIDER === CodeProvider.NodeFs) {
        throw new Error('SANDBOX_PROVIDER=node_fs is only supported in the desktop-local renderer path');
    }

    return env.SANDBOX_PROVIDER === CodeProvider.E2B
        ? CodeProvider.E2B
        : CodeProvider.CodeSandbox;
}

function assertCodeSandboxConfigured() {
    if (!env.CSB_API_KEY) {
        throw new Error('CSB_API_KEY is required when SANDBOX_PROVIDER=code_sandbox');
    }
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
}) {
    const sandboxProvider = getConfiguredSandboxProvider();

    if (sandboxProvider === CodeProvider.E2B) {
        return createCodeProviderClient(CodeProvider.E2B, {
            providerOptions: {
                e2b: {
                    sandboxId: params.sandboxId,
                    userId: params.userId,
                    apiKey: env.E2B_API_KEY,
                    domain: env.E2B_DOMAIN,
                },
            },
        });
    }

    assertCodeSandboxConfigured();
    return createCodeProviderClient(CodeProvider.CodeSandbox, {
        providerOptions: {
            codesandbox: {
                sandboxId: params.sandboxId,
                userId: params.userId,
            },
        },
    });
}

export async function getConfiguredSandboxStaticProvider() {
    const sandboxProvider = getConfiguredSandboxProvider();
    if (sandboxProvider === CodeProvider.CodeSandbox) {
        assertCodeSandboxConfigured();
    }
    return getStaticCodeProvider(sandboxProvider);
}
