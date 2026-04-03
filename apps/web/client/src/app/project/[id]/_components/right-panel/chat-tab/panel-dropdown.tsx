import { useEditorEngine } from '@/components/store/editor';
import { transKeys } from '@/i18n/keys';
import { api } from '@/trpc/react';
import { isDesktopLocalProjectId } from '@/utils/desktop-local';
import type { ChatSettings } from '@onlook/models';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@onlook/ui/dropdown-menu';
import { Icons } from '@onlook/ui/icons';
import { cn } from '@onlook/ui/utils';
import { debounce } from 'lodash';
import { observer } from 'mobx-react-lite';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo } from 'react';

export const ChatPanelDropdown = observer(({
    children,
    isChatHistoryOpen,
    setIsChatHistoryOpen,
}: {
    children: React.ReactNode;
    isChatHistoryOpen: boolean;
    setIsChatHistoryOpen: (isOpen: boolean) => void;
}) => {
    const t = useTranslations();
    const editorEngine = useEditorEngine();
    const isDesktopLocal = isDesktopLocalProjectId(editorEngine.projectId);
    const { mutate: updateSettings } = api.user.settings.upsert.useMutation({
        onSuccess: () => {
            void apiUtils.user.settings.get.invalidate();
        },
    });
    const apiUtils = api.useUtils();
    const { data: userSettings } = api.user.settings.get.useQuery(undefined, {
        enabled: !isDesktopLocal,
    });

    const debouncedUpdateSettings = useMemo(
        () => debounce((settings: Partial<ChatSettings>) => {
            updateSettings({
                ...settings,
            });
        }, 300),
        [updateSettings]
    );

    useEffect(() => {
        return () => {
            debouncedUpdateSettings.cancel();
        };
    }, [debouncedUpdateSettings]);

    const updateChatSettings = useCallback((e: React.MouseEvent, settings: Partial<ChatSettings>) => {
        e.preventDefault();

        if (isDesktopLocal) {
            return;
        }

        apiUtils.user.settings.get.setData(undefined, (oldData) => {
            if (!oldData) return oldData;
            return {
                ...oldData,
                chat: {
                    ...oldData.chat,
                    ...settings,
                },
            };
        });

        debouncedUpdateSettings(settings);
    }, [apiUtils.user.settings.get, debouncedUpdateSettings, isDesktopLocal]);

    return (
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <div className="flex items-center">{children}</div>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-[220px]">
                {!isDesktopLocal && (
                    <>
                        <DropdownMenuItem
                            className="flex items-center py-1.5"
                            onClick={(e) => {
                                updateChatSettings(e, {
                                    showSuggestions: !userSettings?.chat.showSuggestions,
                                });
                            }}
                        >
                            <Icons.Check
                                className={cn(
                                    'mr-2 h-4 w-4',
                                    userSettings?.chat.showSuggestions ? 'opacity-100' : 'opacity-0',
                                )}
                            />
                            {t(transKeys.editor.panels.edit.tabs.chat.settings.showSuggestions)}
                        </DropdownMenuItem>

                        <DropdownMenuItem
                            className="flex items-center py-1.5"
                            onClick={(e) => {
                                updateChatSettings(e, {
                                    showMiniChat: !userSettings?.chat.showMiniChat,
                                });
                            }}
                        >
                            <Icons.Check
                                className={cn(
                                    'mr-2 h-4 w-4',
                                    userSettings?.chat.showMiniChat ? 'opacity-100' : 'opacity-0',
                                )}
                            />
                            {t(transKeys.editor.panels.edit.tabs.chat.settings.showMiniChat)}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                    </>
                )}
                <DropdownMenuItem onClick={() => setIsChatHistoryOpen(!isChatHistoryOpen)}>
                    <Icons.CounterClockwiseClock className="mr-2 h-4 w-4" />
                    {t(transKeys.editor.panels.edit.tabs.chat.controls.history)}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
});
