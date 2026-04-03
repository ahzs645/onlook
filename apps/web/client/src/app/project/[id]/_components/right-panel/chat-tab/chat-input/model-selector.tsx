'use client';

import { useEditorEngine } from '@/components/store/editor';
import {
    DESKTOP_LOCAL_CHAT_PROVIDER_LABELS,
    getDesktopLocalChatModelLabel,
    getDesktopLocalChatModelOptions,
    getDesktopLocalChatSelection,
    listAvailableDesktopLocalChatClis,
    setDesktopLocalChatSelection,
    type DesktopLocalChatCli,
    type DesktopLocalChatModelSelection,
} from '@/utils/desktop-local-chat';
import { Button } from '@onlook/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuShortcut,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@onlook/ui/dropdown-menu';
import { Icons } from '@onlook/ui/icons';
import { toast } from '@onlook/ui/sonner';
import { cn } from '@onlook/ui/utils';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

interface ModelSelectorProps {
    disabled?: boolean;
}

const MODEL_I18N_KEYS = {
    label: 'editor.panels.edit.tabs.chat.model.label',
    loading: 'editor.panels.edit.tabs.chat.model.loading',
    unavailable: 'editor.panels.edit.tabs.chat.model.unavailable',
    loadFailed: 'editor.panels.edit.tabs.chat.model.loadFailed',
    updateFailed: 'editor.panels.edit.tabs.chat.model.updateFailed',
} as const;

export function DesktopLocalChatModelSelector({
    disabled = false,
}: ModelSelectorProps) {
    const editorEngine = useEditorEngine();
    const t = useTranslations();
    const [availableClis, setAvailableClis] = useState<DesktopLocalChatCli[]>([]);
    const [selection, setSelection] = useState<DesktopLocalChatModelSelection | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
                setIsLoading(true);
                const [nextClis, nextSelection] = await Promise.all([
                    listAvailableDesktopLocalChatClis(editorEngine.projectId),
                    getDesktopLocalChatSelection(editorEngine.projectId),
                ]);

                if (cancelled) {
                    return;
                }

                setAvailableClis(nextClis);
                setSelection(nextSelection);
            } catch (error) {
                if (!cancelled) {
                    console.error('Failed to load desktop-local chat model selection', error);
                    toast.error(t(MODEL_I18N_KEYS.loadFailed as never));
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        };

        void load();

        return () => {
            cancelled = true;
        };
    }, [editorEngine.projectId, t]);

    const handleSelect = async (cli: DesktopLocalChatCli, model: string) => {
        try {
            const nextSelection = await setDesktopLocalChatSelection(editorEngine.projectId, {
                cli,
                model,
            });
            setSelection(nextSelection);
            setIsOpen(false);
        } catch (error) {
            console.error('Failed to update desktop-local chat model selection', error);
            toast.error(t(MODEL_I18N_KEYS.updateFailed as never));
        }
    };

    const triggerLabel = selection
        ? `${DESKTOP_LOCAL_CHAT_PROVIDER_LABELS[selection.cli]} · ${getDesktopLocalChatModelLabel(
            selection.cli,
            selection.model,
        )}`
        : isLoading
            ? t(MODEL_I18N_KEYS.loading as never)
            : t(MODEL_I18N_KEYS.unavailable as never);

    const isDisabled = disabled || isLoading || availableClis.length === 0;

    return (
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={isDisabled}
                    className={cn(
                        'h-8 max-w-[180px] px-2 text-foreground-onlook flex items-center gap-1.5',
                        isDisabled && 'opacity-50 cursor-not-allowed',
                    )}
                >
                    <Icons.Sparkles className="w-4 h-4 text-foreground-secondary" />
                    <span className="text-xs font-medium truncate">{triggerLabel}</span>
                    <Icons.ChevronDown className="w-3 h-3 text-foreground-tertiary" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[220px]">
                <DropdownMenuLabel>
                    {t(MODEL_I18N_KEYS.label as never)}
                </DropdownMenuLabel>
                {availableClis.map((cli) => (
                    <DropdownMenuSub key={cli}>
                        <DropdownMenuSubTrigger>
                            <Icons.Sparkles className="w-4 h-4" />
                            <span>{DESKTOP_LOCAL_CHAT_PROVIDER_LABELS[cli]}</span>
                            {selection?.cli === cli && (
                                <DropdownMenuShortcut>
                                    {getDesktopLocalChatModelLabel(cli, selection.model)}
                                </DropdownMenuShortcut>
                            )}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                            <DropdownMenuRadioGroup
                                value={selection?.cli === cli ? selection.model : undefined}
                                onValueChange={(value) => {
                                    void handleSelect(cli, value);
                                }}
                            >
                                {getDesktopLocalChatModelOptions(cli).map((option) => (
                                    <DropdownMenuRadioItem key={option.value} value={option.value}>
                                        {option.label}
                                    </DropdownMenuRadioItem>
                                ))}
                            </DropdownMenuRadioGroup>
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
