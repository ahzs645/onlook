import { registerOTel } from '@vercel/otel';
import { LangfuseExporter } from 'langfuse-vercel';
import { env } from './env';

export function register() {
    const shouldEnableLangfuse =
        process.env.ONLOOK_DESKTOP_MODE !== 'true' && !!env.LANGFUSE_SECRET_KEY;

    registerOTel({
        serviceName: 'Onlook Web',
        ...(shouldEnableLangfuse ? { traceExporter: new LangfuseExporter() } : {}),
    });
}
