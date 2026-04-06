import { safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

interface SecureStorageRecord {
    version: 1;
    values: Record<string, string>;
}

const DEFAULT_SECURE_STORAGE_RECORD: SecureStorageRecord = {
    version: 1,
    values: {},
};

export class DesktopSecureStorage {
    private readonly filePath: string;

    constructor(storageRoot: string) {
        this.filePath = path.join(storageRoot, 'secure-storage.json');
    }

    async ensureReady() {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        try {
            await fs.access(this.filePath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
            await this.writeRecord(DEFAULT_SECURE_STORAGE_RECORD);
        }
    }

    async get(key: string) {
        const record = await this.readRecord();
        const encryptedValue = record.values[key];
        if (!encryptedValue) {
            return null;
        }

        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error('Desktop secure storage encryption is not available on this system.');
        }

        return safeStorage.decryptString(Buffer.from(encryptedValue, 'base64'));
    }

    async set(key: string, value: string) {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error('Desktop secure storage encryption is not available on this system.');
        }

        const record = await this.readRecord();
        record.values[key] = safeStorage.encryptString(value).toString('base64');
        await this.writeRecord(record);
    }

    async delete(key: string) {
        const record = await this.readRecord();
        delete record.values[key];
        await this.writeRecord(record);
    }

    private async readRecord() {
        await this.ensureReady();
        const raw = await fs.readFile(this.filePath, 'utf8');
        try {
            const parsed = JSON.parse(raw) as SecureStorageRecord;
            return {
                version: 1 as const,
                values: parsed.values ?? {},
            };
        } catch {
            return DEFAULT_SECURE_STORAGE_RECORD;
        }
    }

    private async writeRecord(record: SecureStorageRecord) {
        await fs.writeFile(this.filePath, JSON.stringify(record, null, 2), 'utf8');
    }
}

export function createDesktopSecureStorage(storageRoot: string) {
    return new DesktopSecureStorage(storageRoot);
}
