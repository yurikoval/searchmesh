export type AdapterOriginPolicy = {
    origin: string;
    basePath: string;
    path: string;
    method: 'GET' | 'POST';
};
export declare function getAdapterPolicy(adapter: string): AdapterOriginPolicy | undefined;
export declare function isAllowedAdapterUrl(adapter: string, value: string): boolean;
