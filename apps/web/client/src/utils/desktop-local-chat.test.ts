import { describe, expect, test } from 'bun:test';
import { resolveDesktopLocalChatGlobalSelection } from './desktop-local-chat';

describe('resolveDesktopLocalChatGlobalSelection', () => {
    test('returns the desktop AI defaults when auto-apply is enabled and the provider is available', () => {
        const selection = resolveDesktopLocalChatGlobalSelection(
            ['claude', 'codex'],
            {
                providerSource: 'codex',
                model: 'gpt-5.4-mini',
                autoApplyToNewChats: true,
            },
            'high',
        );

        expect(selection).toEqual({
            cli: 'codex',
            model: 'gpt-5.4-mini',
            reasoningEffort: 'high',
        });
    });

    test('falls back when desktop AI defaults are disabled or unavailable', () => {
        expect(
            resolveDesktopLocalChatGlobalSelection(
                ['claude'],
                {
                    providerSource: 'codex',
                    model: 'gpt-5.4',
                    autoApplyToNewChats: true,
                },
                'medium',
            ),
        ).toBeNull();

        expect(
            resolveDesktopLocalChatGlobalSelection(
                ['codex'],
                {
                    providerSource: 'codex',
                    model: 'gpt-5.4',
                    autoApplyToNewChats: false,
                },
                'medium',
            ),
        ).toBeNull();
    });
});
