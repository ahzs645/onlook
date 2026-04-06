import { promises as fs } from 'node:fs';
import path from 'node:path';

export class JsonFileStore<T> {
    constructor(private readonly filePath: string) {}

    get path() {
        return this.filePath;
    }

    async read(): Promise<T | null> {
        try {
            const raw = await fs.readFile(this.filePath, 'utf8');
            if (!raw.trim()) {
                return null;
            }
            return JSON.parse(raw) as T;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    }

    async write(value: T) {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const tempPath = `${this.filePath}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
        await fs.rename(tempPath, this.filePath);
    }

    async update(updater: (current: T | null) => T) {
        const current = await this.read();
        const next = updater(current);
        await this.write(next);
        return next;
    }
}

