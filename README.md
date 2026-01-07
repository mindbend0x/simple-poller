# Simple Poller

A lightweight, flexible polling utility for periodically fetching data from APIs and other sources. Built for Node.js and Bun environments.

Simple Poller is ideal when you need a basic polling mechanism with lifecycle controls without the overhead of a full-featured queue system.

## Features

- **Typed Specifications** - Full generic support for response data, query params, headers, and metadata types
- **Rate Limiting** - Built-in rolling window rate limiter to respect API limits
- **Pagination Control** - Automatic pagination handling with customizable iteration logic
- **Flexible Configuration** - Easily configure multiple data sources with custom intervals, HTTP methods, and parameters
- **Event-Driven Architecture** - Respond to lifecycle events, fetch successes, and errors through callbacks
- **Worker-Friendly** - Designed to run in worker threads or processes to avoid blocking the main thread

## Installation

Install the package along with its peer dependency:

```bash
npm install simple-poller axios
```

or with Bun:

```bash
bun add simple-poller axios
```

## Quick Start

```typescript
import { DataPoller, FetcherResponse } from 'simple-poller'

// (optional) Define your types
type ApiResponse = { items: string[]; total: number }
type QueryParams = { page: number; limit: number }
type Headers = { 'Authorization': string }
type Metadata = { source: string }

// Define callbacks with typed responses
const onFetchError = (response: FetcherResponse<ApiResponse, QueryParams, Headers, Metadata>) => {
    console.error('Fetch error:', response.error)
}


const onFetchSuccess = (response: FetcherResponse<ApiResponse, QueryParams, Headers, Metadata>) => {
    console.log('Fetch success:', response.data)
}

// Initialize the poller with types
const poller = new DataPoller<ApiResponse, QueryParams, Headers, Metadata>({
    name: 'my-data-poller',
    onFetchError,
    onFetchSuccess,
    maxPollingCycles: 5, // (optional) maximum number of polling cycles before stopping
    pollingCycleCooloff: 500, // (optional) delay between polling cycles in milliseconds
    rateLimiter: { // (optional) rate limiting configuration
        limit: 10,       // Max 10 requests
        interval: 60000, // Per 60 seconds
    },
})

// Add a data source
const fetcherId = await poller.addSource({
    url: 'https://api.example.com/data',
    method: 'GET',
    interval: 1000,
})

// Start polling
await poller.start()
```

> Note: Defining the generics here is optional. The default behavior will use the following types:
> `DataPoller<T = any, Q = Record<string, any>, H = Record<string, string>, M = Record<string, any>>` and can be simply
> defined as `DataPoller` without any generics.

### Quick Start without Generics

```typescript
import { DataPoller } from 'simple-poller'

const poller = new DataPoller({
    name: 'my-data-poller',
    onFetchSuccess: (response) => {
        // The type of `response` here will be any
        console.log(response.data)
    },
    onFetchError: (error) => {
        // Handle fetch error
    },
    //...
})

await poller.addSource({
    url: 'https://api.example.com/data',
    method: 'GET',
    interval: 1000,
})

await poller.start()
```

## Usage Details

### Creating a Poller

Create a `DataPoller` instance with configuration options:

```typescript
const poller = new DataPoller<ResponseType, QueryType, HeaderType, MetadataType>({
    name: 'my-poller',
    pollingCycleCooloff: 3000,
    onFetchSuccess: (response) => {
        // Handle successful fetch - response is fully typed
        console.log(response.data)
    },
    onFetchError: (error) => {
        // Handle fetch error
    },
    onPollerStarted: () => {
        // Optional: poller lifecycle hook
    },
    onPollerStopped: () => {
        // Optional: poller lifecycle hook
    },
    rateLimiter: {
        limit: 30,        // Maximum requests allowed
        interval: 60000,  // Within this time window (ms)
    },
})
```

### Rate Limiting

The poller includes a built-in rolling window rate limiter that automatically throttles requests to stay within API limits:

```typescript
const poller = new DataPoller({
    name: 'rate-limited-poller',
    onFetchSuccess: handleSuccess,
    onFetchError: handleError,
    rateLimiter: {
        limit: 30,        // Allow 30 requests
        interval: 60000,  // Per 60 seconds (rolling window)
    },
})
```

The rate limiter uses a sliding window algorithm:
- Tracks timestamps of all requests within the interval
- Automatically delays requests when the limit is reached
- Resumes as soon as older requests age out of the window

### Pagination

Fetchers support automatic pagination through two callback functions:

```typescript
type QueryParams = { page: number; per_page: number }

await poller.addSource<ResponseType, QueryParams>({
    url: 'https://api.example.com/items',
    method: 'GET',
    interval: 5000,
    queryParams: { page: 1, per_page: 100 },
    
    // Update query params for each iteration
    paginationParamsUpdater: (currentIteration, previousParams) => ({
        ...previousParams,
        page: currentIteration + 1, // iterations are 0-indexed
    }),
    
    // Optionally use a completion checker to stop the polling this 
    // fetcher when the pagination is complete. Return false here would stop
    // this source from being polled for this iteration and future ones.
    paginationCompletionChecker: (currentIteration, previousParams) => {
        return currentIteration >= 10  // Stop after 10 pages
    },
})
```

You can alternatively simple use the `previousParams` parameter to update the query params.

```typescript
type QueryParams = { page: number; per_page: number }

await poller.addSource<ResponseType, QueryParams>({
    url: 'https://api.example.com/items',
    method: 'GET',
    interval: 5000,
    queryParams: { page: 1, per_page: 100 },
    
    // Update query params for each iteration
    paginationParamsUpdater: (iteration, previousParams) => ({
        ...previousParams,
        page: previousParams.page + 1,  // Increment page number
    }),

    //...
})
```

> Note: These query parameters type can be defined as anything. Those values will be passed to the `Axios.request` method as the `params` option.

For APIs with offset-based pagination:

```typescript
type QueryParams = { offset: number; limit: number }

await poller.addSource<ResponseType, QueryParams>({
    url: 'https://api.example.com/items',
    method: 'GET',
    interval: 1000,
    queryParams: { offset: 0, limit: 250 },
    
    paginationParamsUpdater: (iteration, params) => ({
        ...params,
        offset: (iteration + 1) * params.limit,
    }),
    
    paginationCompletionChecker: (iteration, params) => {
        // Stop when offset exceeds expected total
        return params.offset >= 10000
    },
})
```

When a fetcher's `paginationCompletionChecker` returns `true`, the fetcher is marked as completed and will no longer be polled. Once all fetchers are completed, the poller stops automatically.

### Adding Data Sources

Add one or more sources to poll:

```typescript
await poller.addSource({
    url: 'https://api.example.com/endpoint',
    method: 'GET',
    interval: 5000,                    // Poll every 5 seconds
    metadata: {                        // Optional: custom metadata
        asset: 'BTC',
        platform: 'exchange-1'
    },
    validateStatuses: [200, 201],     // Optional: valid status codes
    headers: {                         // Optional: custom headers
        'Authorization': 'Bearer token',
        'Content-Type': 'application/json'
    },
    body: {                            // Optional: request body
        symbol: 'BTCUSD'
    },
    timeout: 10000                     // Optional: request timeout (ms)
})
```

### Controlling the Poller

```typescript
// Start polling
await poller.start()

// Stop polling
await poller.stop()
```

## API Reference

### `DataPoller<T, Q, H, M>(options)`

Creates a new poller instance with generic type parameters.

**Type Parameters:**

| Parameter | Description |
|-----------|-------------|
| `T` | Response data type (default: `any`) |
| `Q` | Query parameters type (default: `Record<string, any>`) |
| `H` | Headers type (default: `Record<string, string>`) |
| `M` | Metadata type (default: `Record<string, any>`) |

**Options:**

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | Yes | Identifier for the poller instance |
| `pollingCycleCooloff` | `number` | No | Delay in milliseconds between polling cycles (default: 3000) |
| `onFetchSuccess` | `function` | Yes | Callback invoked when data is successfully fetched |
| `onFetchError` | `function` | Yes | Callback invoked when a fetch fails |
| `onPollerStarted` | `function` | No | Lifecycle hook called when poller starts |
| `onPollerStopped` | `function` | No | Lifecycle hook called when poller stops |
| `onFetchCycleStart` | `function` | No | Hook called at the start of each polling cycle |
| `onFetchCycleEnd` | `function` | No | Hook called at the end of each polling cycle |
| `maxPollingCycles` | `number` | No | Maximum number of polling cycles before stopping |
| `rateLimiter` | `RateLimiterOptions` | No | Rate limiting configuration |

### `RateLimiterOptions`

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `limit` | `number` | Yes | Maximum number of requests allowed within the interval |
| `interval` | `number` | Yes | Time window in milliseconds for the rate limit |

### `poller.addSource(options)`

Adds a new data source to poll. Returns a Promise resolving to a UUID string identifying the source.

**Parameters:**

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `url` | `string` | Yes | Endpoint URL to fetch from |
| `method` | `string` | Yes | HTTP method (`GET`, `POST`) |
| `interval` | `number` | No | Polling interval in milliseconds (default: 15 minutes) |
| `metadata` | `M` | No | Custom metadata passed to callbacks |
| `validateStatuses` | `number[]` | No | HTTP status codes considered successful (default: [200]) |
| `queryParams` | `Q` | No | Query parameters to append to URL |
| `headers` | `H` | No | Custom HTTP headers |
| `body` | `object` | No | Request body for POST requests |
| `timeout` | `number` | No | Request timeout in milliseconds (default: 30000) |
| `paginationParamsUpdater` | `function` | No | Function to update params on each iteration |
| `paginationCompletionChecker` | `function` | No | Function to determine when pagination is complete |

### `poller.start()`

Starts the polling process. Returns a Promise that resolves when the poller is stopped or all fetchers complete.

### `poller.stop()`

Stops the polling process and clears all state.

## Type Definitions

### `FetcherResponse<T, Q, H, M>`

The response object passed to callbacks:

```typescript
type FetcherResponse<T, Q, H, M> = {
    id: string
    data: T | T[] | undefined
    status: 'success' | 'error'
    headers: H
    queryParams: Q
    error?: string
    timestamp: Date
    duration: number
    metadata?: M
}
```

### `FetcherOptions<T, Q, H, M>`

Configuration for individual fetchers:

```typescript
type FetcherOptions<T, Q, H, M> = {
    id?: string
    url: string
    method: 'GET' | 'POST'
    headers?: H
    body?: any
    queryParams?: Q
    timeout?: number
    validateStatuses?: number[]
    interval?: number
    metadata?: M
    paginationParamsUpdater?: (iteration: number, params: Q) => Q
    paginationCompletionChecker?: (iteration: number, params: Q) => boolean
}
```

### `RateLimiterOptions`

Rate limiter configuration:

```typescript
type RateLimiterOptions = {
    limit: number    // Maximum requests in the window
    interval: number // Time window in milliseconds
}
```

### `DataPollerOptions<T, Q, H, M>`

Poller configuration:

```typescript
type DataPollerOptions<T, Q, H, M> = {
    name: string
    onFetchError: (response: FetcherResponse<T, Q, H, M>) => void
    onFetchSuccess: (response: FetcherResponse<T, Q, H, M>) => void
    onFetchCycleStart?: (cycleCount: number) => void
    onFetchCycleEnd?: (cycleCount: number, duration: number) => void
    onPollerStarted?: () => void
    onPollerStopped?: () => void
    pollingCycleCooloff?: number
    maxPollingCycles?: number
    rateLimiter?: RateLimiterOptions
}
```

## Requirements

- **Runtime**: Node.js >= 16 or Bun
- **Dependencies**: axios (peer dependency)
- **Recommended**: TypeScript for full type safety

## License

MIT
