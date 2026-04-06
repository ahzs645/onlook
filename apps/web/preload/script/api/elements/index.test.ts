import { describe, expect, test } from 'bun:test';
import { EditorAttributes } from '@onlook/constants';
import { findNearestAnnotatedElement } from './selection';

function createElementMock(options: {
    id: string;
    annotated?: boolean;
    parent?: ReturnType<typeof createElementMock> | null;
}) {
    return {
        id: options.id,
        getAttribute(attribute: string) {
            if (attribute === EditorAttributes.DATA_ONLOOK_ID && options.annotated) {
                return options.id;
            }
            return null;
        },
        closest(selector: string) {
            if (selector !== `[${EditorAttributes.DATA_ONLOOK_ID}]`) {
                return null;
            }

            let current: ReturnType<typeof createElementMock> | null | undefined = options.parent;
            while (current) {
                if (current.getAttribute(EditorAttributes.DATA_ONLOOK_ID)) {
                    return current as unknown as Element;
                }
                current = current.parentElement;
            }
            return null;
        },
        parentElement: options.parent ?? null,
    };
}

describe('findNearestAnnotatedElement', () => {
    test('walks up to the nearest annotated ancestor', () => {
        const root = createElementMock({ id: 'root', annotated: true });
        const animated = createElementMock({ id: 'animated', parent: root });
        const leaf = createElementMock({ id: 'leaf', parent: animated });
        const resolved = findNearestAnnotatedElement(leaf as unknown as Element);

        expect(resolved?.id).toBe('root');
    });

    test('keeps the element when it is already annotated', () => {
        const target = createElementMock({ id: 'target', annotated: true });
        const resolved = findNearestAnnotatedElement(target as unknown as Element);

        expect(resolved?.id).toBe('target');
    });
});
