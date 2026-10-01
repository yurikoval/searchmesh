import { type ValidationError } from './schema.js';
export declare function parseProviderYaml(file: string, bytes: Uint8Array): {
    ok: true;
    value: unknown;
} | {
    ok: false;
    errors: ValidationError[];
};
