import { useOptionalDesktopLocalProject } from '@/app/project/[id]/_components/desktop-local-context';
import { useDesktopBridge } from '@/app/desktop/use-desktop-bridge';
import { useEditorEngine } from '@/components/store/editor';
import { api } from '@/trpc/react';
import { isDesktopLocalProjectId, type DesktopRuntimeBackend } from '@/utils/desktop-local';
import { DefaultSettings } from '@onlook/constants';
import { toDbProjectSettings } from '@onlook/db';
import { Button } from '@onlook/ui/button';
import { Icons } from '@onlook/ui/icons';
import { Input } from '@onlook/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@onlook/ui/select';
import { Separator } from '@onlook/ui/separator';
import { toast } from '@onlook/ui/sonner';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';

export const ProjectTab = observer(() => {
    const editorEngine = useEditorEngine();
    const desktopLocalProject = useOptionalDesktopLocalProject();
    const isDesktopLocal = isDesktopLocalProjectId(editorEngine.projectId);
    const { desktop } = useDesktopBridge();
    const utils = api.useUtils();
    const { data: project } = api.project.get.useQuery(
        { projectId: editorEngine.projectId },
        { enabled: !isDesktopLocal },
    );
    const { mutateAsync: updateProject } = api.project.update.useMutation();
    const { data: projectSettings } = api.settings.get.useQuery(
        { projectId: editorEngine.projectId },
        { enabled: !isDesktopLocal },
    );
    const { mutateAsync: updateProjectSettings } = api.settings.upsert.useMutation();

    const installCommand = isDesktopLocal
        ? desktopLocalProject?.session.installCommand ?? DefaultSettings.COMMANDS.install
        : projectSettings?.commands?.install ?? DefaultSettings.COMMANDS.install;
    const runCommand = isDesktopLocal
        ? desktopLocalProject?.session.devCommand ?? DefaultSettings.COMMANDS.run
        : projectSettings?.commands?.run ?? DefaultSettings.COMMANDS.run;
    const buildCommand = isDesktopLocal
        ? desktopLocalProject?.session.buildCommand ?? DefaultSettings.COMMANDS.build
        : projectSettings?.commands?.build ?? DefaultSettings.COMMANDS.build;
    const name = isDesktopLocal
        ? desktopLocalProject?.session.name ?? ''
        : project?.name ?? '';

    // Form state
    const [formData, setFormData] = useState({
        name: '',
        install: '',
        run: '',
        build: '',
    });
    const [isSaving, setIsSaving] = useState(false);
    const [desktopPreferredBackend, setDesktopPreferredBackend] = useState<DesktopRuntimeBackend>('local');
    const [isSavingDesktopRuntime, setIsSavingDesktopRuntime] = useState(false);

    // Initialize and sync form data
    useEffect(() => {
        setFormData({
            name,
            install: installCommand,
            run: runCommand,
            build: buildCommand,
        });
    }, [name, installCommand, runCommand, buildCommand]);

    useEffect(() => {
        if (!isDesktopLocal || !desktop || !desktopLocalProject) {
            return;
        }

        void desktop.getProject(desktopLocalProject.desktopProjectId)
            .then((project) => {
                setDesktopPreferredBackend(project?.preferredBackend ?? desktopLocalProject.session.backend);
            })
            .catch((error: unknown) => {
                console.error('Failed to load desktop project runtime preference:', error);
                setDesktopPreferredBackend(desktopLocalProject.session.backend);
            });
    }, [desktop, desktopLocalProject, isDesktopLocal]);

    // Check if form has changes
    const isDirty = useMemo(() => {
        return (
            formData.name !== name ||
            formData.install !== installCommand ||
            formData.run !== runCommand ||
            formData.build !== buildCommand
        );
    }, [formData, name, installCommand, runCommand, buildCommand]);

    const handleSave = async () => {
        if (isDesktopLocal) {
            return;
        }

        setIsSaving(true);
        try {
            // Update project name if changed
            if (formData.name !== name) {
                await updateProject({
                    id: editorEngine.projectId,
                    name: formData.name,
                });
                // Invalidate queries to refresh UI
                await Promise.all([
                    utils.project.list.invalidate(),
                    utils.project.get.invalidate({ projectId: editorEngine.projectId }),
                ]);
            }

            // Update commands if any changed
            if (
                formData.install !== installCommand
                || formData.run !== runCommand
                || formData.build !== buildCommand
            ) {
                await updateProjectSettings({
                    projectId: editorEngine.projectId,
                    settings: toDbProjectSettings(editorEngine.projectId, {
                        commands: {
                            install: formData.install,
                            run: formData.run,
                            build: formData.build,
                        },
                    }),
                });
            }

            toast.success('Project settings updated successfully.');
        } catch (error) {
            console.error('Failed to update project settings:', error);
            toast.error('Failed to update project settings. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDiscard = () => {
        setFormData({
            name,
            install: installCommand,
            run: runCommand,
            build: buildCommand,
        });
    };

    const updateField = (field: keyof typeof formData, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const handleDesktopRuntimeChange = async (preferredBackend: DesktopRuntimeBackend) => {
        if (!desktop || !desktopLocalProject) {
            return;
        }

        setIsSavingDesktopRuntime(true);
        try {
            const updatedProject = await desktop.updateProjectRuntime({
                projectId: desktopLocalProject.desktopProjectId,
                preferredBackend,
            });
            setDesktopPreferredBackend(updatedProject?.preferredBackend ?? preferredBackend);
            toast.success('Desktop runtime preference updated. Reopen the project to apply it.');
        } catch (error) {
            console.error('Failed to update desktop project runtime:', error);
            toast.error('Failed to update desktop runtime preference.');
        } finally {
            setIsSavingDesktopRuntime(false);
        }
    };

    return (
        <div className="text-sm flex flex-col h-full">
            <div className="flex flex-col gap-4 p-6 pb-24 overflow-y-auto flex-1">
                <div className="flex flex-col gap-4">
                    <h2 className="text-lg">Metadata</h2>
                    {isDesktopLocal && (
                        <p className="text-small text-foreground-secondary">
                            These values are detected from your local project and are
                            read-only in desktop mode.
                        </p>
                    )}
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <p className="text-muted-foreground">Name</p>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) => updateField('name', e.target.value)}
                                className="w-2/3"
                                disabled={isSaving || isDesktopLocal}
                            />
                        </div>
                    </div>
                </div>
                <Separator />

                {isDesktopLocal && desktopLocalProject && (
                    <>
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-col gap-2">
                                <h2 className="text-lg">Desktop Runtime</h2>
                                <p className="text-small text-foreground-secondary">
                                    Choose which runtime backend new sessions for this desktop
                                    project should use.
                                </p>
                            </div>
                            <div className="space-y-4">
                                <div className="flex justify-between items-center gap-4">
                                    <div>
                                        <p className="text-muted-foreground">Preferred backend</p>
                                        <p className="text-small text-foreground-secondary mt-1">
                                            Current session: {desktopLocalProject.session.backend === 'container' ? 'Container (Docker)' : 'Local'}
                                        </p>
                                    </div>
                                    <Select
                                        value={desktopPreferredBackend}
                                        onValueChange={(value) => {
                                            void handleDesktopRuntimeChange(value as DesktopRuntimeBackend);
                                        }}
                                        disabled={isSavingDesktopRuntime}
                                    >
                                        <SelectTrigger className="w-52">
                                            <SelectValue placeholder="Select backend" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="local">Local (default)</SelectItem>
                                            <SelectItem value="container">Container (Docker)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>
                        <Separator />
                    </>
                )}

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <h2 className="text-lg">Commands</h2>
                        <p className="text-small text-foreground-secondary">
                            {"Only update these if you know what you're doing!"}
                        </p>
                    </div>
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <p className="text-muted-foreground">Install</p>
                            <Input
                                id="install"
                                value={formData.install}
                                onChange={(e) => updateField('install', e.target.value)}
                                className="w-2/3"
                                disabled={isSaving || isDesktopLocal}
                            />
                        </div>
                        <div className="flex justify-between items-center">
                            <p className="text-muted-foreground">Run</p>
                            <Input
                                id="run"
                                value={formData.run}
                                onChange={(e) => updateField('run', e.target.value)}
                                className="w-2/3"
                                disabled={isSaving || isDesktopLocal}
                            />
                        </div>
                        <div className="flex justify-between items-center">
                            <p className="text-muted-foreground">Build</p>
                            <Input
                                id="build"
                                value={formData.build}
                                onChange={(e) => updateField('build', e.target.value)}
                                className="w-2/3"
                                disabled={isSaving || isDesktopLocal}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {!isDesktopLocal && (
                <div
                    className="sticky bottom-0 bg-background border-t border-border/50 p-6"
                    style={{ borderTopWidth: '0.5px' }}
                >
                    <div className="flex justify-end gap-4">
                        <Button
                            variant="outline"
                            className="flex items-center gap-2 px-4 py-2 bg-background border border-border/50"
                            type="button"
                            onClick={handleDiscard}
                            disabled={!isDirty || isSaving}
                        >
                            <span>Discard changes</span>
                        </Button>
                        <Button
                            variant="secondary"
                            className="flex items-center gap-2 px-4 py-2"
                            type="button"
                            onClick={handleSave}
                            disabled={!isDirty || isSaving}
                        >
                            {isSaving && <Icons.LoadingSpinner className="h-4 w-4 animate-spin" />}
                            <span>{isSaving ? 'Saving...' : 'Save changes'}</span>
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
});
