import { NEXT_JS_FILE_EXTENSIONS } from "@onlook/constants";
import path from 'path';
import parserEstree from 'prettier/plugins/estree';
import parserTypescript from 'prettier/plugins/typescript';
import prettier from 'prettier/standalone';

export async function formatContent(filePath: string, content: string): Promise<string> {
    try {
        const extension = path.extname(filePath);
        if (!NEXT_JS_FILE_EXTENSIONS.includes(extension)) {
            return content;
        }

        const formattedContent = await prettier.format(content, {
            filepath: filePath,
            plugins: [parserEstree, parserTypescript],
            parser: 'typescript',
        });
        return formattedContent;
    } catch {
        return content;
    }
}
