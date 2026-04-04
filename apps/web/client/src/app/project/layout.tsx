import { isDesktopLocalProjectId } from "@/utils/desktop-local";
import { Routes } from "@/utils/constants";
import { createClient } from "@/utils/supabase/server";
import { checkUserSubscriptionAccess } from "@/utils/subscription";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function Layout({
    children,
    params,
}: Readonly<{
    children: React.ReactNode;
    params?: Promise<{ id?: string }>;
}>) {
    if (process.env.ONLOOK_DESKTOP_MODE === "true") {
        return <>{children}</>;
    }

    const projectId = (await params)?.id;
    const headersList = await headers();
    const pathname = headersList.get("x-pathname") ?? "";
    const pathnameProjectId = pathname.startsWith(`${Routes.PROJECT}/`)
        ? pathname.slice(`${Routes.PROJECT}/`.length)
        : null;

    const resolvedProjectId = projectId ?? pathnameProjectId;
    if (resolvedProjectId && isDesktopLocalProjectId(resolvedProjectId)) {
        return <>{children}</>;
    }

    const supabase = await createClient();
    const {
        data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
        redirect(Routes.LOGIN);
    }

    // Check if user has an active subscription
    const { hasActiveSubscription, hasLegacySubscription } = await checkUserSubscriptionAccess(
        session.user.id,
        session.user.email,
    );

    // If no subscription, redirect to demo page
    if (!hasActiveSubscription && !hasLegacySubscription) {
        redirect(Routes.DEMO_ONLY);
    }

    return <>{children}</>;
}
