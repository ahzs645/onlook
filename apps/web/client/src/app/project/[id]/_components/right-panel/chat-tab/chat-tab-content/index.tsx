import { type ChatMessage } from '@onlook/models';
import { isDesktopLocalProjectId } from '@/utils/desktop-local';
import { useChat } from '../../../../_hooks/use-chat';
import { useDesktopLocalChat } from '../../../../_hooks/use-desktop-local-chat';
import { ChatInput } from '../chat-input';
import { ChatMessages } from '../chat-messages';
import { ErrorSection } from '../error';

interface ChatTabContentProps {
    conversationId: string;
    projectId: string;
    initialMessages: ChatMessage[];
}

function ChatTabBody({
    chatState,
}: {
    chatState: ReturnType<typeof useChat>;
}) {
    const {
        isStreaming,
        sendMessage,
        editMessage,
        messages,
        error,
        stop,
        queuedMessages,
        removeFromQueue,
    } = chatState;

    return (
        <div className="flex flex-col h-full justify-end gap-2 pt-2">
            <ChatMessages
                messages={messages}
                isStreaming={isStreaming}
                error={error}
                onEditMessage={editMessage}
            />
            <ErrorSection isStreaming={isStreaming} onSendMessage={sendMessage} />
            <ChatInput
                messages={messages}
                isStreaming={isStreaming}
                onStop={stop}
                onSendMessage={sendMessage}
                queuedMessages={queuedMessages}
                removeFromQueue={removeFromQueue}
            />
        </div>
    );
}

function HostedChatTabContent({
    conversationId,
    projectId,
    initialMessages,
}: ChatTabContentProps) {
    const chatState = useChat({
        conversationId,
        projectId,
        initialMessages,
    });

    return <ChatTabBody chatState={chatState} />;
}

function DesktopLocalChatTabContent({
    conversationId,
    projectId,
    initialMessages,
}: ChatTabContentProps) {
    const chatState = useDesktopLocalChat({
        conversationId,
        projectId,
        initialMessages,
    });

    return <ChatTabBody chatState={chatState} />;
}

export const ChatTabContent = (props: ChatTabContentProps) => {
    if (isDesktopLocalProjectId(props.projectId)) {
        return <DesktopLocalChatTabContent {...props} />;
    }

    return <HostedChatTabContent {...props} />;
};
