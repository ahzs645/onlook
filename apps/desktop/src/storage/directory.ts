import { promises as fs } from 'node:fs';
import path from 'node:path';

export class TextDirectoryStore {
    constructor(private readonly directoryPath: string) {}

    get path() {
        return this.directoryPath;
    }

    private getFilePath(id: string) {
        return path.join(this.directoryPath, `${encodeURIComponent(id)}.json`);
    }

    async read(id: string): Promise<string | null> {
        try {
            return await fs.readFile(this.getFilePath(id), 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    }

    async write(id: string, content: string) {
        const filePath = this.getFilePath(id);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const tempPath = `${filePath}.tmp`;
        await fs.writeFile(tempPath, content, 'utf8');
        await fs.rename(tempPath, filePath);
    }
}

