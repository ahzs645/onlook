import { EditorAttributes } from '@onlook/constants';

export const findNearestAnnotatedElement = (element: Element | null | undefined) => {
    if (!element) {
        return null;
    }

    if (element.getAttribute(EditorAttributes.DATA_ONLOOK_ID)) {
        return element;
    }

    return element.closest(`[${EditorAttributes.DATA_ONLOOK_ID}]`);
};
