'use client';

import { useDesktopLocalProject } from '../desktop-local-context';
import { Hotkey } from '@/components/hotkey';
import { useEditorEngine } from '@/components/store/editor';
import { useStateManager } from '@/components/store/state';
import { CurrentUserAvatar } from '@/components/ui/avatar-dropdown';
import { SettingsTabValue } from '@/components/ui/settings-modal/helpers';
import { transKeys } from '@/i18n/keys';
import { isDesktopLocalProjectId } from '@/utils/desktop-local';
import { Routes } from '@/utils/constants';
import { Button } from '@onlook/ui/button';
import { HotkeyLabel } from '@onlook/ui/hotkey-label';
import { Icons } from '@onlook/ui/icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@onlook/ui/tooltip';
import { observer } from 'mobx-react-lite';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Members } from '../members';
import { BranchDisplay } from './branch';
import { ModeToggle } from './mode-toggle';
import { ProjectBreadcrumb } from './project-breadcrumb';
import { PublishButton } from './publish';

const DesktopLocalTopBar = observer(() => {
    const router = useRouter();
    const editorEngine = useEditorEngine();
    const stateManager = useStateManager();
    const { session } = useDesktopLocalProject();
    const t = useTranslations();
    const [isReturningToProjects, setIsReturningToProjects] = useState(false);

    const undoRedoButtons = [
        {
            click: () => editorEngine.action.undo(),
            isDisabled: !editorEngine.history.canUndo || editorEngine.chat.isStreaming,
            hotkey: Hotkey.UNDO,
            icon: <Icons.Reset className="h-4 w-4 mr-1" />,
        },
        {
            click: () => editorEngine.action.redo(),
            isDisabled: !editorEngine.history.canRedo || editorEngine.chat.isStreaming,
            hotkey: Hotkey.REDO,
            icon: <Icons.Reset className="h-4 w-4 mr-1 scale-x-[-1]" />,
        },
    ];

    return (
        <div className="flex flex-row h-10 p-0 justify-center items-center bg-background-onlook/60 backdrop-blur-xl">
            <div className="flex flex-row flex-grow basis-0 justify-start items-center">
                <Button
                    variant="ghost"
                    className="ml-1 gap-2 text-foreground-onlook text-small hover:text-foreground-active hover:!bg-transparent cursor-pointer"
                    disabled={isReturningToProjects}
                    onClick={async () => {
                        setIsReturningToProjects(true);

                        try {
                            await editorEngine.screenshot.captureDesktopLocalProjectPreview({
                                maxAttempts: 1,
                                retryDelayMs: 0,
                            });
                        } finally {
                            router.push(Routes.PROJECTS);
                            setIsReturningToProjects(false);
                        }
                    }}
                >
                    {isReturningToProjects ? (
                        <Icons.LoadingSpinner className="h-4 w-4 animate-spin" />
                    ) : (
                        <Icons.ArrowLeft className="h-4 w-4" />
                    )}
                    Projects
                </Button>
                <span className="text-foreground-secondary/50 text-small">/</span>
                <span className="mx-2 max-w-[60px] md:max-w-[100px] lg:max-w-[240px] text-foreground-onlook text-small truncate">
                    {session.name}
                </span>
                <span className="text-foreground-secondary/50 text-small">/</span>
                <BranchDisplay />
            </div>
            <ModeToggle />
            <div className="flex flex-grow basis-0 justify-end items-center gap-1.5 mr-2">
                <motion.div
                    className="space-x-0 hidden lg:block -mr-1"
                    layout
                    transition={{
                        type: 'spring',
                        stiffness: 300,
                        damping: 30,
                        delay: 0,
                    }}
                >
                    {undoRedoButtons.map(({ click, hotkey, icon, isDisabled }) => (
                        <Tooltip key={hotkey.description}>
                            <TooltipTrigger asChild>
                                <span>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8"
                                        onClick={click}
                                        disabled={isDisabled}
                                    >
                                        {icon}
                                    </Button>
                                </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" hideArrow className="mt-2">
                                <HotkeyLabel hotkey={hotkey} />
                            </TooltipContent>
                        </Tooltip>
                    ))}
                </motion.div>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8"
                            onClick={() => {
                                void window.onlookDesktop?.openPath(session.folderPath);
                            }}
                        >
                            <Icons.MoveToFolder className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="mt-1" hideArrow>
                        Reveal Folder
                    </TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8"
                            onClick={() => {
                                void window.onlookDesktop?.openExternal(session.previewUrl);
                            }}
                        >
                            <Icons.ExternalLink className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="mt-1" hideArrow>
                        Open Preview
                    </TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8"
                            onClick={() => {
                                stateManager.settingsTab = SettingsTabValue.VERSIONS;
                                stateManager.isSettingsModalOpen = true;
                            }}
                        >
                            <Icons.Gear className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="mt-1" hideArrow>
                        {t(transKeys.help.menu.openSettings)}
                    </TooltipContent>
                </Tooltip>
            </div>
        </div>
    );
});

export const TopBar = observer(() => {
    const editorEngine = useEditorEngine();
    if (isDesktopLocalProjectId(editorEngine.projectId)) {
        return <DesktopLocalTopBar />;
    }

    const stateManager = useStateManager();
    const [isMembersPopoverOpen, setIsMembersPopoverOpen] = useState(false);
    const t = useTranslations();

    const UNDO_REDO_BUTTONS = [
        {
            click: () => editorEngine.action.undo(),
            isDisabled: !editorEngine.history.canUndo || editorEngine.chat.isStreaming,
            hotkey: Hotkey.UNDO,
            icon: <Icons.Reset className="h-4 w-4 mr-1" />,
        },
        {
            click: () => editorEngine.action.redo(),
            isDisabled: !editorEngine.history.canRedo || editorEngine.chat.isStreaming,
            hotkey: Hotkey.REDO,
            icon: <Icons.Reset className="h-4 w-4 mr-1 scale-x-[-1]" />,
        },
    ];

    return (
        <div className="flex flex-row h-10 p-0 justify-center items-center bg-background-onlook/60 backdrop-blur-xl">
            <div className="flex flex-row flex-grow basis-0 justify-start items-center">
                <ProjectBreadcrumb />
                <span className="text-foreground-secondary/50 text-small">/</span>
                <BranchDisplay />
            </div>
            <ModeToggle />
            <div className="flex flex-grow basis-0 justify-end items-center gap-1.5 mr-2">
                <div className="flex items-center group">
                    <div className={`transition-all duration-200 ${isMembersPopoverOpen ? 'mr-2' : '-mr-2 group-hover:mr-2'}`}>
                        <Members onPopoverOpenChange={setIsMembersPopoverOpen} />
                    </div>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div className="flex items-center">
                                <CurrentUserAvatar className="size-8 cursor-pointer hover:border-foreground-primary" />
                            </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="mt-1" hideArrow>
                            <p>Profile</p>
                        </TooltipContent>
                    </Tooltip>
                </div>
                <motion.div
                    className="space-x-0 hidden lg:block -mr-1"
                    layout
                    transition={{
                        type: 'spring',
                        stiffness: 300,
                        damping: 30,
                        delay: 0,
                    }}
                >
                    {UNDO_REDO_BUTTONS.map(({ click, hotkey, icon, isDisabled }) => (
                        <Tooltip key={hotkey.description}>
                            <TooltipTrigger asChild>
                                <span>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8"
                                        onClick={click}
                                        disabled={isDisabled}
                                    >
                                        {icon}
                                    </Button>
                                </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" hideArrow className="mt-2">
                                <HotkeyLabel hotkey={hotkey} />
                            </TooltipContent>
                        </Tooltip>
                    ))}
                </motion.div>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8"
                            onClick={() => {
                                stateManager.settingsTab = SettingsTabValue.VERSIONS;
                                stateManager.isSettingsModalOpen = true;
                            }}
                        >
                            <Icons.CounterClockwiseClock className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="mt-1" hideArrow>
                        {t(transKeys.editor.toolbar.versionHistory)}
                    </TooltipContent>
                </Tooltip>
                <PublishButton />
            </div>
        </div>
    );
});
