'use client';

import { useDesktopBridge } from '@/app/desktop/use-desktop-bridge';
import {
    DESKTOP_LOCAL_CHAT_MODEL_OPTIONS,
    DESKTOP_LOCAL_CHAT_PROVIDER_LABELS,
} from '@/utils/desktop-local-chat';
import type {
    DesktopAiProviderSource,
    DesktopAppSettings,
    DesktopRuntimePolicy,
} from '@/utils/desktop-local';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@onlook/ui/select';
import { Switch } from '@onlook/ui/switch';
import { toast } from '@onlook/ui/sonner';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { UserDeleteSection } from './user-delete-section';

export const PreferencesTab = observer(() => {
    const { desktop, isDesktop } = useDesktopBridge();
    const [settings, setSettings] = useState<DesktopAppSettings | null>(null);
    const [isUpdatingPolicy, setIsUpdatingPolicy] = useState(false);
    const [isUpdatingAi, setIsUpdatingAi] = useState(false);

    useEffect(() => {
        if (!desktop || !isDesktop) {
            return;
        }

        void desktop.getSettings().then(setSettings).catch((error: unknown) => {
            console.error('Failed to load desktop settings:', error);
        });
    }, [desktop, isDesktop]);

    const handlePolicyChange = async (runtimePolicy: DesktopRuntimePolicy) => {
        if (!desktop) {
            return;
        }

        setIsUpdatingPolicy(true);
        try {
            const nextSettings = await desktop.updateSettings({ runtimePolicy });
            setSettings(nextSettings);
            toast.success('Desktop runtime policy updated.');
        } catch (error) {
            console.error('Failed to update desktop settings:', error);
            toast.error('Failed to update desktop runtime policy.');
        } finally {
            setIsUpdatingPolicy(false);
        }
    };

    const handleAiChange = async (input: Partial<DesktopAppSettings['ai']>) => {
        if (!desktop || !settings) {
            return;
        }

        setIsUpdatingAi(true);
        try {
            const nextSettings = await desktop.updateSettings({
                ai: {
                    ...settings.ai,
                    ...input,
                },
            });
            setSettings(nextSettings);
            toast.success('Desktop AI defaults updated.');
        } catch (error) {
            console.error('Failed to update desktop AI defaults:', error);
            toast.error('Failed to update desktop AI defaults.');
        } finally {
            setIsUpdatingAi(false);
        }
    };

    const handleProviderChange = async (providerSource: DesktopAiProviderSource) => {
        const defaultModel = DESKTOP_LOCAL_CHAT_MODEL_OPTIONS[providerSource][0]?.value;
        if (!defaultModel) {
            return;
        }

        await handleAiChange({
            providerSource,
            model: defaultModel,
        });
    };

    return (
        <div className="flex flex-col gap-8 p-6">
            {isDesktop && settings && (
                <>
                    <section className="space-y-4">
                        <div className="space-y-1">
                            <h2 className="text-lg">Desktop Runtime</h2>
                            <p className="text-small text-foreground-secondary">
                                Choose whether opening a desktop project should stop any other
                                active desktop runtime first.
                            </p>
                        </div>

                        <div className="flex items-center justify-between gap-6">
                            <div className="space-y-1">
                                <p className="text-muted-foreground">Runtime policy</p>
                                <p className="text-small text-foreground-secondary">
                                    Startup restore stays pinned to the last active project.
                                </p>
                            </div>
                            <Select
                                value={settings.runtimePolicy}
                                onValueChange={(value) => {
                                    void handlePolicyChange(value as DesktopRuntimePolicy);
                                }}
                                disabled={isUpdatingPolicy}
                            >
                                <SelectTrigger className="w-52">
                                    <SelectValue placeholder="Select policy" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="single_active">Single active</SelectItem>
                                    <SelectItem value="multi_active">Multiple active</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </section>

                    <section className="space-y-4">
                        <div className="space-y-1">
                            <h2 className="text-lg">Desktop AI Defaults</h2>
                            <p className="text-small text-foreground-secondary">
                                Set the default provider and model that new desktop-local chats
                                should start with.
                            </p>
                        </div>

                        <div className="flex items-center justify-between gap-6">
                            <div className="space-y-1">
                                <p className="text-muted-foreground">Default provider</p>
                                <p className="text-small text-foreground-secondary">
                                    New chats can still override this per conversation.
                                </p>
                            </div>
                            <Select
                                value={settings.ai.providerSource}
                                onValueChange={(value) => {
                                    void handleProviderChange(value as DesktopAiProviderSource);
                                }}
                                disabled={isUpdatingAi}
                            >
                                <SelectTrigger className="w-52">
                                    <SelectValue placeholder="Select provider" />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(DESKTOP_LOCAL_CHAT_PROVIDER_LABELS).map(
                                        ([value, label]) => (
                                            <SelectItem key={value} value={value}>
                                                {label}
                                            </SelectItem>
                                        ),
                                    )}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="flex items-center justify-between gap-6">
                            <div className="space-y-1">
                                <p className="text-muted-foreground">Default model</p>
                                <p className="text-small text-foreground-secondary">
                                    The model is stored with the provider above.
                                </p>
                            </div>
                            <Select
                                value={settings.ai.model}
                                onValueChange={(value) => {
                                    void handleAiChange({ model: value });
                                }}
                                disabled={isUpdatingAi}
                            >
                                <SelectTrigger className="w-52">
                                    <SelectValue placeholder="Select model" />
                                </SelectTrigger>
                                <SelectContent>
                                    {DESKTOP_LOCAL_CHAT_MODEL_OPTIONS[settings.ai.providerSource].map(
                                        (option) => (
                                            <SelectItem key={option.value} value={option.value}>
                                                {option.label}
                                            </SelectItem>
                                        ),
                                    )}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="flex items-center justify-between gap-6">
                            <div className="space-y-1">
                                <p className="text-muted-foreground">Auto-apply defaults</p>
                                <p className="text-small text-foreground-secondary">
                                    When enabled, new chats start from these desktop defaults until
                                    a conversation picks its own provider or model.
                                </p>
                            </div>
                            <Switch
                                checked={settings.ai.autoApplyToNewChats}
                                onCheckedChange={(checked) => {
                                    void handleAiChange({ autoApplyToNewChats: checked });
                                }}
                                disabled={isUpdatingAi}
                            />
                        </div>
                    </section>
                </>
            )}

            <UserDeleteSection />
        </div>
    );
});
