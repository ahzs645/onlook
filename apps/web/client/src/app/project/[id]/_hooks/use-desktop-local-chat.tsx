'use client';

import { useEditorEngine } from '@/components/store/editor';
import {
    getDesktopLocalConversation,
    replaceDesktopLocalConversationMessages,
    resolveDesktopLocalChatCli,
    setDesktopLocalConversationCliSession,
} from '@/utils/desktop-local-chat';
import {
    ChatType,
    type ChatMessage,
    type MessageContext,
    type QueuedMessage,
} from '@onlook/models';
import { jsonClone } from '@onlook/utility';
import { usePostHog } from 'posthog-js/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import type { EditMessage, SendMessage } from './use-chat';
import { createCheckpointsForAllBranches, getUserChatMessageFromString } from './use-chat/utils';

interface UseDesktopLocalChatProps {
    conversationId: string;
    projectId: string;
    initialMessages: ChatMessage[];
}

type ClaudeEvent =
    | {
        type: 'system';
        subtype?: string;
        session_id?: string;
    }
    | {
        type: 'assistant';
        session_id?: string;
        message?: {
            content?: Array<{ type: string; text?: string }>;
        };
    }
    | {
        type: 'result';
        subtype?: string;
        is_error?: boolean;
        result?: string;
        stop_reason?: string;
        session_id?: string;
    }
    | {
        type: 'stream_event';
        session_id?: string;
        event?: {
            type?: string;
            content_block?: {
                type?: string;
                text?: string;
            };
            delta?: {
                type?: string;
                text?: string;
            };
        };
    };

function shellQuote(value: string) {
    return JSON.stringify(value);
}

function getMessageText(parts: ChatMessage['parts']) {
    return parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('');
}

function buildDesktopLocalPrompt(input: {
    content: string;
    context: MessageContext[];
    type: ChatType;
}) {
    const sections: string[] = [];

    if (input.type === ChatType.ASK) {
        sections.push('Answer the request about this local project. Do not edit files unless the user explicitly asks for code changes.');
    } else {
        sections.push('Work directly in this local project. Inspect and edit files as needed, then summarize the concrete changes.');
    }

    const fileContexts = input.context.filter((context) => context.type === 'file');
    const highlightContexts = input.context.filter((context) => context.type === 'highlight');
    const errorContexts = input.context.filter((context) => context.type === 'error');
    const branchContexts = input.context.filter((context) => context.type === 'branch');
    const imageContexts = input.context.filter((context) => context.type === 'image');

    if (branchContexts.length > 0) {
        sections.push(
            [
                'Relevant branch context:',
                ...branchContexts.map((context) => `- ${context.displayName}: ${context.content}`),
            ].join('\n'),
        );
    }

    if (errorContexts.length > 0) {
        sections.push(
            [
                'Current project errors:',
                ...errorContexts.map((context) => `- ${context.displayName}\n${context.content}`),
            ].join('\n'),
        );
    }

    if (highlightContexts.length > 0) {
        sections.push(
            [
                'Selected code or elements:',
                ...highlightContexts.map(
                    (context) =>
                        `File: ${context.path} (${context.start}-${context.end})\n${context.content}`,
                ),
            ].join('\n\n'),
        );
    }

    if (fileContexts.length > 0) {
        sections.push(
            [
                'Relevant file context:',
                ...fileContexts.map((context) => `File: ${context.path}\n${context.content}`),
            ].join('\n\n'),
        );
    }

    if (imageContexts.length > 0) {
        sections.push(
            [
                'Referenced images:',
                ...imageContexts.map((context) => {
                    if (context.source === 'local') {
                        return `- ${context.displayName}: ${context.path ?? 'local project asset'}`;
                    }
                    return `- ${context.displayName}: external image provided in chat context`;
                }),
            ].join('\n'),
        );
    }

    sections.push(`User request:\n${input.content}`);
    return sections.join('\n\n');
}

export function useDesktopLocalChat({
    conversationId,
    projectId,
    initialMessages,
}: UseDesktopLocalChatProps) {
    const editorEngine = useEditorEngine();
    const posthog = usePostHog();

    const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
    const [error, setError] = useState<Error | undefined>(undefined);
    const [isStreaming, setIsStreaming] = useState(false);
    const [status, setStatus] = useState<'ready' | 'streaming' | 'submitted'>('ready');
    const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
    const [finishReason, setFinishReason] = useState<string | null>(null);
    const isProcessingQueue = useRef(false);
    const messagesRef = useRef(initialMessages);
    const outputBufferRef = useRef('');
    const rawOutputRef = useRef('');
    const activeCommandRef = useRef<{
        kill: () => Promise<void>;
        unsubscribe: () => void;
    } | null>(null);
    const activeAssistantMessageIdRef = useRef<string | null>(null);

    useEffect(() => {
        setMessages(initialMessages);
        messagesRef.current = initialMessages;
    }, [initialMessages]);

    useEffect(() => {
        editorEngine.chat.setIsStreaming(isStreaming);
    }, [editorEngine.chat, isStreaming]);

    const persistMessages = useCallback(
        async (nextMessages: ChatMessage[]) => {
            await replaceDesktopLocalConversationMessages(projectId, conversationId, nextMessages);
        },
        [conversationId, projectId],
    );

    const applyMessages = useCallback(
        (updater: (current: ChatMessage[]) => ChatMessage[]) => {
            let nextMessages: ChatMessage[] = [];
            setMessages((current) => {
                nextMessages = jsonClone(updater(current));
                messagesRef.current = nextMessages;
                return nextMessages;
            });
            return nextMessages;
        },
        [],
    );

    const upsertAssistantMessage = useCallback(
        (content: string, mode: 'replace' | 'append') => {
            applyMessages((currentMessages) => {
                const existingId = activeAssistantMessageIdRef.current;
                let existingIndex = existingId
                    ? currentMessages.findIndex((message) => message.id === existingId)
                    : -1;

                if (existingIndex === -1) {
                    const lastMessage = currentMessages[currentMessages.length - 1];
                    if (lastMessage?.role === 'assistant') {
                        existingIndex = currentMessages.length - 1;
                        activeAssistantMessageIdRef.current = lastMessage.id;
                    }
                }

                if (existingIndex === -1) {
                    const assistantMessageId = uuidv4();
                    activeAssistantMessageIdRef.current = assistantMessageId;
                    return [
                        ...currentMessages,
                        {
                            id: assistantMessageId,
                            role: 'assistant',
                            parts: [{ type: 'text', text: content }],
                            metadata: {
                                context: [],
                                checkpoints: [],
                                createdAt: new Date(),
                                conversationId,
                            },
                        },
                    ];
                }

                const existingMessage = currentMessages[existingIndex];
                if (!existingMessage) {
                    return currentMessages;
                }

                const existingText = getMessageText(existingMessage.parts);
                const nextText = mode === 'append' ? `${existingText}${content}` : content;
                const nextMessage: ChatMessage = {
                    ...existingMessage,
                    parts: [{ type: 'text', text: nextText }],
                };

                return currentMessages.map((message, index) =>
                    index === existingIndex ? nextMessage : message,
                );
            });
        },
        [applyMessages, conversationId],
    );

    const clearActiveCommand = useCallback(() => {
        activeCommandRef.current?.unsubscribe();
        activeCommandRef.current = null;
        outputBufferRef.current = '';
        rawOutputRef.current = '';
        activeAssistantMessageIdRef.current = null;
    }, []);

    const processEvent = useCallback(
        (event: ClaudeEvent) => {
            switch (event.type) {
                case 'system':
                    if (event.subtype === 'init' && event.session_id) {
                        void setDesktopLocalConversationCliSession(
                            projectId,
                            conversationId,
                            'claude',
                            event.session_id,
                        );
                    }
                    return;
                case 'assistant': {
                    const text = event.message?.content
                        ?.filter((part) => part.type === 'text')
                        .map((part) => part.text ?? '')
                        .join('');
                    if (text) {
                        upsertAssistantMessage(text, 'replace');
                    }
                    return;
                }
                case 'stream_event': {
                    const streamEvent = event.event;
                    if (
                        streamEvent?.type === 'content_block_delta' &&
                        streamEvent.delta?.type === 'text_delta' &&
                        streamEvent.delta.text
                    ) {
                        upsertAssistantMessage(streamEvent.delta.text, 'append');
                    }
                    return;
                }
                case 'result':
                    if (event.session_id) {
                        void setDesktopLocalConversationCliSession(
                            projectId,
                            conversationId,
                            'claude',
                            event.session_id,
                        );
                    }

                    if (event.is_error) {
                        const message = event.result?.trim() || rawOutputRef.current.trim();
                        setError(new Error(message || 'Desktop local chat failed'));
                        setFinishReason('error');
                    } else {
                        if (event.result) {
                            upsertAssistantMessage(event.result, 'replace');
                        }
                        setError(undefined);
                        setFinishReason(event.stop_reason ?? 'end_turn');
                    }
                    setIsStreaming(false);
                    setStatus('ready');
                    clearActiveCommand();
                    return;
            }
        },
        [clearActiveCommand, conversationId, projectId, upsertAssistantMessage],
    );

    const processOutputChunk = useCallback(
        (chunk: string) => {
            if (!chunk) {
                return;
            }

            outputBufferRef.current += chunk;

            while (true) {
                const newlineIndex = outputBufferRef.current.indexOf('\n');
                if (newlineIndex === -1) {
                    break;
                }

                const line = outputBufferRef.current.slice(0, newlineIndex).trim();
                outputBufferRef.current = outputBufferRef.current.slice(newlineIndex + 1);
                if (!line) {
                    continue;
                }

                try {
                    processEvent(JSON.parse(line) as ClaudeEvent);
                } catch {
                    rawOutputRef.current += `${line}\n`;
                }
            }
        },
        [processEvent],
    );

    const runCli = useCallback(
        async ({
            content,
            context,
            type,
            resetSession,
        }: {
            content: string;
            context: MessageContext[];
            type: ChatType;
            resetSession?: boolean;
        }) => {
            const cli = await resolveDesktopLocalChatCli(projectId);
            if (!cli) {
                throw new Error(
                    'No supported local AI CLI was found. Install the Claude CLI (`claude`) to use desktop-local chat.',
                );
            }

            if (cli !== 'claude') {
                throw new Error(`Unsupported desktop-local chat CLI: ${cli}`);
            }

            if (resetSession) {
                await setDesktopLocalConversationCliSession(projectId, conversationId, null, null);
            }

            const conversation = await getDesktopLocalConversation(projectId, conversationId);
            const resumeFlag = conversation?.cliSessionId
                ? ` --resume ${shellQuote(conversation.cliSessionId)}`
                : '';
            const prompt = buildDesktopLocalPrompt({
                content,
                context,
                type,
            });
            const commandText =
                `claude -p${resumeFlag} --output-format stream-json --include-partial-messages --verbose --dangerously-skip-permissions ${shellQuote(prompt)}`;
            const provider = editorEngine.activeSandbox.session.provider;
            if (!provider) {
                throw new Error('Desktop local sandbox provider is not ready');
            }

            const commandResult = await provider.runBackgroundCommand({
                args: {
                    command: commandText,
                },
            });

            const command = commandResult.command;
            const unsubscribe = command.onOutput((chunk) => {
                processOutputChunk(chunk);
            });

            activeCommandRef.current = {
                kill: () => command.kill(),
                unsubscribe,
            };
        },
        [
            conversationId,
            processOutputChunk,
            projectId,
            editorEngine.activeSandbox.session.provider,
        ],
    );

    const processMessage = useCallback(
        async (
            content: string,
            type: ChatType,
            context?: MessageContext[],
            options?: { resetSession?: boolean },
        ) => {
            setError(undefined);
            const messageContext =
                context ?? (await editorEngine.chat.context.getContextByChatType(type));
            const newMessage = getUserChatMessageFromString(content, messageContext, conversationId);
            const nextMessages = applyMessages((currentMessages) => [...currentMessages, newMessage]);
            await persistMessages(nextMessages);

            setStatus('submitted');
            setIsStreaming(true);
            await runCli({
                content,
                context: messageContext,
                type,
                resetSession: options?.resetSession,
            });
            void editorEngine.chat.conversation.generateTitle(content);
            return newMessage;
        },
        [
            applyMessages,
            conversationId,
            editorEngine.chat.context,
            editorEngine.chat.conversation,
            persistMessages,
            runCli,
        ],
    );

    const sendMessage: SendMessage = useCallback(
        async (content: string, type: ChatType) => {
            posthog.capture('user_send_message', { type, provider: 'desktop-local-cli' });

            const context = await editorEngine.chat.context.getContextByChatType(type);
            const newQueuedMessage: QueuedMessage = {
                id: uuidv4(),
                content,
                type,
                timestamp: new Date(),
                context,
            };

            if (isStreaming) {
                setQueuedMessages((currentQueue) => [...currentQueue, newQueuedMessage]);
                return getUserChatMessageFromString(content, [], conversationId);
            }

            if (queuedMessages.length > 0) {
                setQueuedMessages((currentQueue) => [newQueuedMessage, ...currentQueue]);
                return getUserChatMessageFromString(content, [], conversationId);
            }

            return processMessage(content, type, context);
        },
        [
            conversationId,
            editorEngine.chat.context,
            isStreaming,
            posthog,
            processMessage,
            queuedMessages.length,
        ],
    );

    const processNextInQueue = useCallback(async () => {
        if (isProcessingQueue.current || isStreaming || queuedMessages.length === 0) {
            return;
        }

        const nextMessage = queuedMessages[0];
        if (!nextMessage) {
            return;
        }

        isProcessingQueue.current = true;

        try {
            const refreshedContext = await editorEngine.chat.context.getRefreshedContext(
                nextMessage.context,
            );
            await processMessage(nextMessage.content, nextMessage.type, refreshedContext);
            setQueuedMessages((currentQueue) => currentQueue.slice(1));
        } catch (queueError) {
            console.error('Failed to process queued desktop-local chat message:', queueError);
            setError(
                queueError instanceof Error
                    ? queueError
                    : new Error('Failed to process queued desktop-local message'),
            );
        } finally {
            isProcessingQueue.current = false;
        }
    }, [editorEngine.chat.context, isStreaming, processMessage, queuedMessages]);

    const editMessage: EditMessage = useCallback(
        async (messageId: string, newContent: string, chatType: ChatType) => {
            posthog.capture('user_edit_message', {
                type: chatType,
                provider: 'desktop-local-cli',
            });

            if (isStreaming) {
                await activeCommandRef.current?.kill();
            }

            const messageIndex = messagesRef.current.findIndex((message) => message.id === messageId);
            const message = messagesRef.current[messageIndex];
            if (messageIndex === -1 || !message || message.role !== 'user') {
                throw new Error('Message not found.');
            }

            const updatedMessages = messagesRef.current.slice(0, messageIndex);
            const previousContext = message.metadata?.context ?? [];
            const updatedContext = await editorEngine.chat.context.getRefreshedContext(previousContext);

            const updatedMessage: ChatMessage = {
                ...message,
                parts: [{ type: 'text', text: newContent }],
                metadata: {
                    ...message.metadata,
                    context: updatedContext,
                    conversationId,
                    createdAt: message.metadata?.createdAt ?? new Date(),
                    checkpoints: message.metadata?.checkpoints ?? [],
                },
            };

            const nextMessages = jsonClone([...updatedMessages, updatedMessage]);
            setMessages(nextMessages);
            messagesRef.current = nextMessages;
            await persistMessages(nextMessages);

            setStatus('submitted');
            setIsStreaming(true);
            await runCli({
                content: newContent,
                context: updatedContext,
                type: chatType,
                resetSession: true,
            });

            return updatedMessage;
        },
        [
            conversationId,
            editorEngine.chat.context,
            isStreaming,
            persistMessages,
            posthog,
            runCli,
        ],
    );

    const removeFromQueue = useCallback((id: string) => {
        setQueuedMessages((currentQueue) => currentQueue.filter((message) => message.id !== id));
    }, []);

    const stop = useCallback(async () => {
        await activeCommandRef.current?.kill();
        clearActiveCommand();
        setIsStreaming(false);
        setStatus('ready');
        setFinishReason('stop');
        await persistMessages(messagesRef.current);
    }, [clearActiveCommand, persistMessages]);

    useEffect(() => {
        if (!finishReason) {
            return;
        }

        const finalizeTurn = async () => {
            const lastUserMessage = messagesRef.current.findLast((message) => message.role === 'user');
            if (!lastUserMessage) {
                return;
            }

            if (finishReason !== 'error') {
                const content = getMessageText(lastUserMessage.parts);
                if (content) {
                    const checkpoints = await createCheckpointsForAllBranches(editorEngine, content);
                    if (checkpoints.length > 0) {
                        const oldCheckpoints =
                            lastUserMessage.metadata?.checkpoints.map((checkpoint) => ({
                                ...checkpoint,
                                createdAt: new Date(checkpoint.createdAt),
                            })) ?? [];

                        const nextMessages = messagesRef.current.map((message) => {
                            if (message.id !== lastUserMessage.id) {
                                return message;
                            }

                            return {
                                ...message,
                                metadata: {
                                    ...message.metadata,
                                    createdAt: message.metadata?.createdAt ?? new Date(),
                                    conversationId,
                                    checkpoints: [...oldCheckpoints, ...checkpoints],
                                    context: message.metadata?.context ?? [],
                                },
                            };
                        });

                        const clonedMessages = jsonClone(nextMessages);
                        setMessages(clonedMessages);
                        messagesRef.current = clonedMessages;
                    }
                }
            }

            await editorEngine.chat.context.clearImagesFromContext();
            await persistMessages(messagesRef.current);

            if (finishReason === 'stop' && queuedMessages.length > 0) {
                window.setTimeout(() => {
                    void processNextInQueue();
                }, 500);
            }
        };

        void finalizeTurn().finally(() => {
            setFinishReason(null);
        });
    }, [
        conversationId,
        editorEngine,
        finishReason,
        persistMessages,
        processNextInQueue,
        queuedMessages.length,
    ]);

    useEffect(() => {
        editorEngine.chat.conversation.setConversationLength(messages.length);
    }, [editorEngine.chat.conversation, messages.length]);

    useEffect(() => {
        editorEngine.chat.setChatActions(sendMessage);
    }, [editorEngine.chat, sendMessage]);

    return {
        status,
        sendMessage,
        editMessage,
        messages,
        error,
        stop,
        isStreaming,
        queuedMessages,
        removeFromQueue,
    };
}
