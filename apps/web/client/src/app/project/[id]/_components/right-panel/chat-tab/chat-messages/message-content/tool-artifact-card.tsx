'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@onlook/ui/card';
import type { ToolArtifactResult } from './tool-artifacts';
import { BashCodeDisplay } from '../../code-display/bash-code-display';
import { CollapsibleCodeBlock } from '../../code-display/collapsible-code-block';
import { CodeDiff } from '../../code-display/code-diff';

export function ToolArtifactCard({
    artifact,
    messageId,
    applied,
    isStream,
}: {
    artifact: ToolArtifactResult;
    messageId: string;
    applied: boolean;
    isStream: boolean;
}) {
    if (artifact.type === 'terminal') {
        return (
            <BashCodeDisplay
                content={artifact.command}
                isStream={isStream}
                defaultStdOut={artifact.output}
                defaultStdErr={artifact.error}
            />
        );
    }

    if (artifact.type === 'code_diff') {
        if (!artifact.showDiff) {
            return (
                <CollapsibleCodeBlock
                    path={artifact.path}
                    content={artifact.newContent}
                    messageId={messageId}
                    applied={applied}
                    isStream={isStream}
                    branchId={artifact.branchId}
                />
            );
        }

        return (
            <Card className="overflow-hidden gap-0">
                <CardHeader className="border-b px-4 py-3">
                    <CardTitle className="text-sm">{artifact.path}</CardTitle>
                    <CardDescription>Code diff preview</CardDescription>
                </CardHeader>
                <CardContent className="px-0">
                    <CodeDiff
                        originalCode={artifact.originalContent}
                        modifiedCode={artifact.newContent}
                    />
                </CardContent>
            </Card>
        );
    }

    if (artifact.type === 'image_media') {
        return (
            <Card className="overflow-hidden gap-0">
                <CardHeader className="border-b px-4 py-3">
                    <CardTitle className="text-sm">{artifact.title}</CardTitle>
                    {artifact.caption ? <CardDescription>{artifact.caption}</CardDescription> : null}
                </CardHeader>
                <CardContent className="space-y-3 px-4 py-4">
                    <img
                        src={artifact.url}
                        alt={artifact.title}
                        className="max-h-72 w-full rounded-md object-contain bg-background-secondary"
                    />
                    {!artifact.url.startsWith('data:') ? (
                        <a
                            href={artifact.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-foreground-active underline underline-offset-2"
                        >
                            Open media
                        </a>
                    ) : null}
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="overflow-hidden gap-0">
            <CardHeader className="border-b px-4 py-3">
                <CardTitle className="text-sm">{artifact.title}</CardTitle>
                {artifact.subtitle ? <CardDescription>{artifact.subtitle}</CardDescription> : null}
            </CardHeader>
            <CardContent className="space-y-3 px-4 py-4">
                {artifact.previewUrl ? (
                    <img
                        src={artifact.previewUrl}
                        alt={artifact.title}
                        className="max-h-72 w-full rounded-md object-contain bg-background-secondary"
                    />
                ) : null}
                <a
                    href={artifact.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-foreground-active underline underline-offset-2"
                >
                    Open reference
                </a>
            </CardContent>
        </Card>
    );
}
