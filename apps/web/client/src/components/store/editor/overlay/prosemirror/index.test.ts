import { describe, expect, test } from 'bun:test';
import { getEditorDomStyles } from './index';

describe('getEditorDomStyles', () => {
    test('preserves white-space and text-transform styling for the text overlay', () => {
        const styles = getEditorDomStyles({
            fontSize: '16',
            lineHeight: '24',
            fontFamily: 'Arial',
            textTransform: 'uppercase',
            whiteSpace: 'pre-wrap',
            color: 'rgb(0, 0, 0)',
        });

        expect(styles.textTransform).toBe('uppercase');
        expect(styles.whiteSpace).toBe('pre-wrap');
    });
});
