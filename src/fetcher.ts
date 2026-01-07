import Axios from 'axios'

const DEFAULT_TIMEOUT = 30_000; // 30 seconds
const DEFAULT_INTERVAL = 15 * 60 * 1000; // 15 minutes

export type FetcherOptions<Q = any, H = any, M = any> = {
    id?: string;
    url: string;
    method: 'GET' | 'POST';
    headers?: H;
    body?: any;
    queryParams?: Q;
    timeout?: number;
    validateStatuses?: number[];
    interval?: number; // in milliseconds
    metadata?: M; // attach to the response on callbacks
    
    // a method to update the params based on the page and limit
    paginationParamsUpdater?: (iteration: number, params: Q) => Q;
    paginationCompletionChecker?: (iteration: number, params: Q) => boolean;
}

export type FetcherResponse<T = any, Q = any, H = any, M = any> = {
    id: string;
    data: T|T[]|undefined;
    status: 'success' | 'error';
    headers: H;
    queryParams: Q;
    error?: string;
    timestamp: Date;
    duration: number;
    metadata?: M;
}

export class Fetcher<T = any, Q = any, H = any, M = any> {
    public id: string;
    public options: FetcherOptions<Q, H, M>;
    public isFetching: boolean;
    public lastFetch: number | undefined;
    public interval: number;
    public metadata: M;
    public currentIteration: number = 0;
    public isCompleted: boolean = false;
    private paginationParamsUpdater?: (iteration: number, params: Q) => Q;
    private paginationCompletionChecker?: (iteration: number, params: Q) => boolean;

    constructor(options: FetcherOptions<Q, H, M>) {
        this.id = options.id ?? crypto.randomUUID();
        this.options = options;
        this.isFetching = false;
        this.lastFetch = undefined;
        this.interval = options.interval ?? DEFAULT_INTERVAL;
        this.metadata = options.metadata ?? {} as M;
        this.paginationParamsUpdater = options.paginationParamsUpdater;
        this.paginationCompletionChecker = options.paginationCompletionChecker;
    }

    shouldFetch(): boolean {
        // Currently fetching
        if (this.isFetching) {
            return false;
        }

        // Never fetched before
        if (!this.lastFetch) {
            return true;
        }

        // Fetched too recently
        if (Date.now() - this.lastFetch < this.interval) {
            return false;
        }

        return true;
    }

    async fetch(): Promise<FetcherResponse<T, Q, H, M>> {
        const startTime = Date.now();
        this.isFetching = true;
        
        try {
            // update the params with the pagination method if provided
            this.options.queryParams = this.paginationParamsUpdater ? 
                this.paginationParamsUpdater(this.currentIteration, this.options.queryParams ?? {} as Q) : 
                this.options.queryParams;

            const response = await Axios.request({
                url: this.options.url,
                method: this.options.method,
                headers: this.options.headers ?? {},
                data: this.options.body,
                timeout: this.options.timeout ?? DEFAULT_TIMEOUT, // 30 seconds
                params: this.options.queryParams,
            });

            const { data, status, headers, statusText } = response;

            if (!(this.options.validateStatuses || [200]).includes(status)) {
                throw new Error(data?.error || `Failed to fetch ${this.options.url}: ${statusText}`);
            }

            const responseData = Array.isArray(data) ? data as T[] : data as T;
            
            return {
                id: this.id,
                data: responseData,
                status: 'success',
                headers: this.options.headers ?? {} as H,
                error: undefined,
                timestamp: new Date(),
                duration: Date.now() - startTime,
                metadata: this.metadata,
                queryParams: this.options.queryParams ?? {} as Q,
            };
        } catch (error: unknown) {
            return {
                id: this.id,
                data: undefined,
                status: 'error',
                headers: this.options.headers ?? {} as H,
                queryParams: this.options.queryParams ?? {} as Q,
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date(),
                duration: Date.now() - startTime,
                metadata: this.metadata,
            };
        } finally {
            this.isFetching = false;
            this.lastFetch = Date.now();
            this.currentIteration++;
            
            if (this.paginationCompletionChecker) {
                this.isCompleted = this.paginationCompletionChecker(this.currentIteration, this.options.queryParams ?? {} as Q);
            }
        }
    }
}
