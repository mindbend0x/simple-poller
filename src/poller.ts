import { Fetcher, type FetcherOptions, type FetcherResponse } from './fetcher'

const DEFAULT_POLLING_CYCLE_COOLOFF = 3_000 // 3 seconds

export type RateLimiterOptions = {
    limit: number
    interval: number
}

export type DataPollerOptions<Q = Record<string, any>, H = Record<string, string>, M = Record<string, any>> = {
    name: string
    onFetchError: (response: FetcherResponse<any, Q, H, M>) => void
    onFetchSuccess: (response: FetcherResponse<any, Q, H, M>) => void
    onFetchCycleStart?: (cycleCount: number) => void
    onFetchCycleEnd?: (cycleCount: number, duration: number) => void
    onPollerStarted?: () => void
    onPollerStopped?: () => void
    pollingCycleCooloff?: number // in milliseconds
    maxPollingCycles?: number
    rateLimiter?: RateLimiterOptions
}

export class DataPoller<T = any, Q = Record<string, any>, H = Record<string, string>, M = Record<string, any>> {
    private dataSources: Fetcher<T, Q, H, M>[]
    private completedFetchers: Map<string, boolean> = new Map()
    private isStopped: boolean
    private onFetchError: (response: FetcherResponse<T, Q, H, M>) => void
    private onFetchSuccess: (response: FetcherResponse<T, Q, H, M>) => void
    private onFetchCycleStart?: (cycleCount: number) => void
    private onFetchCycleEnd?: (cycleCount: number, duration: number) => void
    private onPollerStarted?: () => void
    private onPollerStopped?: () => void
    private pollingCycleCooloff: number
    private maxPollingCycles?: number
    private pollingCyclesCounter: number = 0
    private wakeUpResolver: (() => void) | null = null
    
    // Rate limiter state
    private rateLimiter?: RateLimiterOptions
    private requestTimestamps: number[] = []

    constructor(options: DataPollerOptions<Q, H, M>, sources?: Fetcher<T, Q, H, M>[]) {
        this.dataSources = sources ?? []
        this.isStopped = true
        this.onFetchError = options.onFetchError
        this.onFetchSuccess = options.onFetchSuccess
        this.onFetchCycleStart = options.onFetchCycleStart
        this.onFetchCycleEnd = options.onFetchCycleEnd
        this.onPollerStarted = options.onPollerStarted
        this.onPollerStopped = options.onPollerStopped
        this.pollingCycleCooloff = options.pollingCycleCooloff ?? DEFAULT_POLLING_CYCLE_COOLOFF
        this.maxPollingCycles = options.maxPollingCycles
        this.rateLimiter = options.rateLimiter
    }

    /**
     * Start the polling cycle. This will run the loop indefinitely until the poller is stopped.
     */
    async start(): Promise<void> {
        this.isStopped = false
        this.onPollerStarted?.()

        while (this.completedFetchers.size < this.dataSources.length) {
            if (this.isStopped) {
                break
            } else if (this.maxPollingCycles && this.pollingCyclesCounter >= this.maxPollingCycles) {
                break
            }

            const startTime = Date.now()
            this.onFetchCycleStart?.(this.pollingCyclesCounter + 1)

            for (const dataSource of this.dataSources) {
                // Skip if the source is not ready to fetch or has already been marked as completed
                if (!dataSource.shouldFetch() || this.completedFetchers.has(dataSource.id)) {
                    continue
                }

                // Check rate limits before fetching
                await this.checkRateLimiter()

                try {
                    const response = await dataSource.fetch()

                    if (response.status === 'success') {
                        this.onFetchSuccess(response)
                    } else {
                        this.onFetchError(response)
                    }

                    if (dataSource.isCompleted) {
                        this.completedFetchers.set(dataSource.id, true)
                    }
                } catch (error) {
                    this.onFetchError({
                        id: dataSource.id,
                        data: undefined,
                        status: 'error',
                        headers: dataSource.options.headers ?? {} as H,
                        error: error instanceof Error ? error.message : String(error),
                        timestamp: new Date(),
                        duration: 0,
                        queryParams: dataSource.options.queryParams ?? {} as Q,
                    })
                }
            }

            await this.timeoutPromise(this.getNextFetchDelay())
            ++this.pollingCyclesCounter
            this.onFetchCycleEnd?.(this.pollingCyclesCounter, startTime - Date.now())
        }

        this.onPollerStopped?.()
    }

    private async checkRateLimiter(): Promise<void> {
        if (!this.rateLimiter) {
            return
        }

        const nowTimestamp = Date.now()
        const windowStart = nowTimestamp - this.rateLimiter.interval
        this.requestTimestamps.push(nowTimestamp)

        // Keep only the requests within the rolling window
        this.requestTimestamps = this.requestTimestamps.filter(timestamp => timestamp > windowStart)

        // If we're under the limit, no delay needed
        if (this.requestTimestamps.length <= this.rateLimiter.limit) {
            return
        }

        // We're at the limit, calculate when the oldest request will age out
        const oldestTimestamp = this.requestTimestamps.at(0)

        if (!oldestTimestamp) {
            return
        }

        const oldestRequestAgeOutTimestamp = oldestTimestamp + this.rateLimiter.interval - nowTimestamp

        if (oldestRequestAgeOutTimestamp <= 0) {
            return
        }

        // Wait until the oldest request ages out of the window
        return this.timeoutPromise(oldestRequestAgeOutTimestamp)
    }

    /**
     * Sleep that can be interrupted by wakeUp()
     */
    private async timeoutPromise(ms: number): Promise<void> {
        return new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
                this.wakeUpResolver = null
                resolve()
            }, ms)

            this.wakeUpResolver = () => {
                clearTimeout(timeout)
                resolve()
            }
        })
    }

    /**
     * Wake up the poller immediately (interrupts sleep)
     */
    private wakeUp(): void {
        if (this.wakeUpResolver) {
            this.wakeUpResolver()
        }
    }

    /**
     * Calculate the time until the next fetch should happen
     */
    private getNextFetchDelay(): number {
        const now = Date.now()
        let minDelay = Infinity

        for (const dataSource of this.dataSources) {
            if (dataSource.isFetching) {
                return this.pollingCycleCooloff
            }

            if (!dataSource.lastFetch) {
                return 0
            }

            const timeSinceLastFetch = now - dataSource.lastFetch
            const timeUntilNextFetch = dataSource.interval - timeSinceLastFetch
            
            if (timeUntilNextFetch < minDelay) {
                minDelay = timeUntilNextFetch
            }
        }

        return Math.max(0, minDelay)
    }

    /**
     * Add a data source to the poller
     * @param fetcher - The fetcher options
     * @returns The id of the new data source
     */
    async addSource(fetcher: FetcherOptions<Q, H, M>): Promise<String> {
        const newFetcher = new Fetcher<T, Q, H, M>(fetcher)
        this.dataSources.push(newFetcher)
        
        this.wakeUp()
        
        return newFetcher.id
    }

    /**
     * Stop the polling cycle. This will exit the loop and stop the poller.
     */
    async stop(): Promise<void> {
        this.isStopped = true
        this.wakeUp()
        this.onPollerStopped?.()
        this.completedFetchers.clear()
        this.requestTimestamps = []
    }
}