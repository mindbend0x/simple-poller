import { expect, test, mock } from 'bun:test'
import { DataPoller } from './src/poller'

test('DataPoller should fetch data', async () => {
    const onFetchError = mock((value: any) => {
        console.log('onFetchError', value)
    })
    const onFetchSuccess = mock((value: any) => {
        console.log('onFetchSuccess', value)
    })
    const poller = new DataPoller({
        name: 'test',
        onFetchError: onFetchError,
        onFetchSuccess: onFetchSuccess,
        maxPollingCycles: 3,
        pollingCycleCooloff: 100, // 1 second
    })

    await poller.addSource({
        url: 'https://jsonplaceholder.typicode.com/todos/1',
        method: 'GET',
        interval: 100, // 0.1 second
    })

    await poller.start()

    expect(onFetchSuccess).toHaveBeenNthCalledWith(3, {
        id: expect.any(String),
        data: expect.objectContaining({
            userId: expect.any(Number),
            id: expect.any(Number),
            title: expect.any(String),
            completed: expect.any(Boolean),
        }),
        status: 'success',
        duration: expect.any(Number),
        timestamp: expect.any(Date),
        headers: expect.any(Object),
        error: undefined,
        queryParams: expect.any(Object),
        metadata: expect.any(Object),
    })

    expect(onFetchError).not.toHaveBeenCalled()
})

test('DataPoller should fetch data while respecting the interval', async () => {
    const onFetchError = mock((value: any) => {})
    const onFetchSuccess = mock((value: any) => {})
    const poller = new DataPoller({
        name: 'test',
        onFetchError: onFetchError,
        onFetchSuccess: onFetchSuccess,
        maxPollingCycles: 5,
        pollingCycleCooloff: 500,
    })

    await poller.addSource({
        url: 'https://jsonplaceholder.typicode.com/todos/1',
        method: 'GET',
        interval: 750, // once every 750ms at most
    })

    await poller.addSource({
        url: 'https://jsonplaceholder.typicode.com/todos/2',
        method: 'GET',
        interval: 750,
    })

    await poller.addSource({
        url: 'https://jsonplaceholder.typicode.com/todos/3',
        method: 'GET',
        interval: 750,
    })

    // stop after 3 seconds
    setTimeout(() => {
        poller.stop()
    }, 4_000)

    await poller.start()

    expect(onFetchSuccess).toHaveBeenCalled()
    expect(onFetchError).not.toHaveBeenCalled()
    
    // Check it was called at least 9 times (3 sources * 3-4 polling cycles)
    expect(onFetchSuccess.mock.calls.length).toBeGreaterThanOrEqual(9)
})

test('DataPoller with interrupted sleep should fetch data', async () => {
    const onFetchError = mock((value: any) => {})
    const onFetchSuccess = mock((value: any) => {})
    const onFetchCycleStart = mock((cycleCount: number) => {
        console.log('onFetchCycleStart', cycleCount)
    })
    const onFetchCycleEnd = mock((cycleCount: number, duration: number) => {
        console.log('onFetchCycleEnd', cycleCount, duration)
    })
    const poller = new DataPoller({
        name: 'test',
        onFetchError: onFetchError,
        onFetchSuccess: onFetchSuccess,
        maxPollingCycles: 5,
        pollingCycleCooloff: 500,
        onFetchCycleStart: onFetchCycleStart,
        onFetchCycleEnd: onFetchCycleEnd,
    })

    await poller.addSource({
        url: 'https://jsonplaceholder.typicode.com/todos/1',
        method: 'GET',
        interval: 10_000,
    })

    // stop after 3 seconds
    setTimeout(() => {
        poller.stop()
    }, 3000)

    await Promise.all([
        poller.start(),
        new Promise((resolve) => {
            // Add a source after the poller has already started
            setTimeout(() => {
                poller.addSource({
                    url: 'https://jsonplaceholder.typicode.com/todos/2',
                    method: 'GET',
                    interval: 10_000,
                })
                resolve(undefined)
            }, 500)
        }),
    ])

    expect(onFetchError).not.toHaveBeenCalled()
    expect(onFetchSuccess).toHaveBeenCalledTimes(2)
})

test('DataPoller respects rate limiter by sleeping if the limit within a specified interval is reached', async () => {
    const onFetchError = mock((value: any) => {})
    const onFetchSuccess = mock((value: any) => {})
    const poller = new DataPoller({
        name: 'test',
        onFetchError: onFetchError,
        onFetchSuccess: onFetchSuccess,
        maxPollingCycles: 5,
        pollingCycleCooloff: 500,
        rateLimiter: { // max 2 requests within 5 seconds
            limit: 2,
            interval: 5_000,
        }
    })

    await poller.addSource({
        url: 'https://jsonplaceholder.typicode.com/todos/1',
        method: 'GET',
        interval: 1_000,
    })

    await poller.addSource({
        url: 'https://jsonplaceholder.typicode.com/todos/2',
        method: 'GET',
        interval: 1_000,
    })

    await poller.addSource({
        url: 'https://jsonplaceholder.typicode.com/todos/3',
        method: 'GET',
        interval: 1_000,
    })

    poller.start()

    await new Promise((resolve) => {
        setTimeout(() => {
            expect(onFetchError).not.toHaveBeenCalled()
            expect(onFetchSuccess).toHaveBeenCalledTimes(2)
            resolve(undefined)
        }, 4_500)
    })
})