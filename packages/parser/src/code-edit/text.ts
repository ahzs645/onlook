import type { T } from '../packages';
import { t } from '../packages';

function isEditableTextChild(child: T.JSXElement['children'][number]) {
    return t.isJSXText(child) ||
        (t.isJSXExpressionContainer(child) && t.isStringLiteral(child.expression)) ||
        (t.isJSXElement(child) &&
            t.isJSXIdentifier(child.openingElement.name) &&
            child.openingElement.name.name === 'br');
}

function createSafeJsxTextNode(textContent: string) {
    return /[<>{}&]/.test(textContent)
        ? t.jsxExpressionContainer(t.stringLiteral(textContent))
        : t.jsxText(textContent);
}

export function updateNodeTextContent(node: T.JSXElement, textContent: string): void {
    const parts = textContent.split('\n');

    node.children = node.children.filter((child) => !isEditableTextChild(child));

    const nextChildren: T.JSXElement['children'] = [];
    parts.forEach((part, index) => {
        if (part.length > 0 || parts.length === 1) {
            nextChildren.push(createSafeJsxTextNode(part));
        }

        if (index < parts.length - 1) {
            nextChildren.push(
                t.jsxElement(
                    t.jsxOpeningElement(t.jsxIdentifier('br'), [], true),
                    null,
                    [],
                    true,
                ),
            );
        }
    });

    node.children.unshift(...nextChildren);
}
