import { getDesktopLocalConversationMessages } from '@/utils/desktop-local-chat';
import { isDesktopLocalProjectId } from '@/utils/desktop-local';
import { api } from '@/trpc/react';
import { type ChatMessage } from '@onlook/models';
import { Icons } from '@onlook/ui/icons/index';
import { useEffect, useState } from 'react';
import { ChatTabContent } from './chat-tab-content';

interface ChatTabProps {
    conversationId: string;
    projectId: string;
}

export const ChatTab = ({ conversationId, projectId }: ChatTabProps) => {
    const isDesktopLocal = isDesktopLocalProjectId(projectId);
    const { data: initialMessages, isLoading } = api.chat.message.getAll.useQuery(
        { conversationId: conversationId },
        { enabled: !!conversationId && !isDesktopLocal },
    );
    const [desktopMessages, setDesktopMessages] = useState<ChatMessage[] | null>(null);
    const [isDesktopLoading, setIsDesktopLoading] = useState(isDesktopLocal);

    useEffect(() => {
        if (!isDesktopLocal) {
            return;
        }

        let cancelled = false;
        setIsDesktopLoading(true);
        void getDesktopLocalConversationMessages(projectId, conversationId)
            .then((messages) => {
                if (!cancelled) {
                    setDesktopMessages(messages);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setIsDesktopLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [conversationId, isDesktopLocal, projectId]);

    const resolvedMessages = isDesktopLocal ? desktopMessages : initialMessages;
    const resolvedLoading = isDesktopLocal ? isDesktopLoading : isLoading;

    if (!resolvedMessages || resolvedLoading) {
        return (
            <div className="flex-1 flex items-center justify-center w-full h-full text-foreground-secondary" >
                <Icons.LoadingSpinner className="animate-spin mr-2" />
                <p>Loading messages...</p>
            </div >
        );
    }

    return (
        <ChatTabContent
            // Used to force re-render the use-chat hook when the conversationId changes
            key={conversationId}
            conversationId={conversationId}
            projectId={projectId}
            initialMessages={resolvedMessages}
        />
    );
};
