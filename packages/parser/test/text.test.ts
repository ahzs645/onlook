import { describe, expect, test } from 'bun:test';
import { updateNodeTextContent } from '../src/code-edit/text';
import { t } from '../src/packages';

function createElement(children: ReturnType<typeof t.jsxElement>['children'] = []) {
    return t.jsxElement(
        t.jsxOpeningElement(t.jsxIdentifier('div'), [], false),
        t.jsxClosingElement(t.jsxIdentifier('div')),
        children,
        false,
    );
}

describe('updateNodeTextContent', () => {
    test('wraps unsafe JSX text in a string literal expression container', () => {
        const node = createElement([t.jsxText('before')]);

        updateNodeTextContent(node, 'Use <span>{x}</span> & keep it');

        expect(node.children).toHaveLength(1);
        const child = node.children[0];
        expect(t.isJSXExpressionContainer(child)).toBe(true);
        expect(
            t.isJSXExpressionContainer(child) && t.isStringLiteral(child.expression)
                ? child.expression.value
                : null,
        ).toBe('Use <span>{x}</span> & keep it');
    });

    test('removes stale editable text nodes before inserting the replacement', () => {
        const node = createElement([
            t.jsxText('stale'),
            t.jsxExpressionContainer(t.stringLiteral('also stale')),
            t.jsxElement(
                t.jsxOpeningElement(t.jsxIdentifier('br'), [], true),
                null,
                [],
                true,
            ),
        ]);

        updateNodeTextContent(node, 'fresh');

        expect(node.children).toHaveLength(1);
        expect(t.isJSXText(node.children[0])).toBe(true);
        expect(t.isJSXText(node.children[0]) ? node.children[0].value : null).toBe('fresh');
    });

    test('preserves line breaks when rebuilding text children', () => {
        const node = createElement();

        updateNodeTextContent(node, 'first\n\nthird');

        expect(node.children).toHaveLength(4);
        expect(t.isJSXText(node.children[0]) ? node.children[0].value : null).toBe('first');
        expect(
            t.isJSXElement(node.children[1]) &&
                t.isJSXIdentifier(node.children[1].openingElement.name)
                ? node.children[1].openingElement.name.name
                : null,
        ).toBe('br');
        expect(
            t.isJSXElement(node.children[2]) &&
                t.isJSXIdentifier(node.children[2].openingElement.name)
                ? node.children[2].openingElement.name.name
                : null,
        ).toBe('br');
        expect(t.isJSXText(node.children[3]) ? node.children[3].value : null).toBe('third');
    });
});
