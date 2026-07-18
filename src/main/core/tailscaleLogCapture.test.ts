import { afterEach, describe, expect, it, vi } from 'vitest'
import { TailscaleLogCapture } from './tailscaleLogCapture'

function createDependencies(level: LogLevel = 'warning') {
  return {
    getConfiguredLogLevel: vi.fn<() => Promise<LogLevel>>().mockResolvedValue(level),
    patchRuntimeLogLevel: vi.fn<(level: LogLevel) => Promise<void>>().mockResolvedValue(),
    restartLogStream: vi.fn<(level?: LogLevel) => Promise<void>>().mockResolvedValue(),
    onRestoreError: vi.fn<(error: unknown) => void>()
  }
}

describe('TailscaleLogCapture', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('temporarily captures info logs and restores the configured level', async () => {
    vi.useFakeTimers()
    const dependencies = createDependencies('warning')
    const capture = new TailscaleLogCapture(dependencies, 45_000)

    await capture.enable()

    expect(dependencies.patchRuntimeLogLevel).toHaveBeenNthCalledWith(1, 'info')
    expect(dependencies.restartLogStream).toHaveBeenNthCalledWith(1, 'info')

    await vi.advanceTimersByTimeAsync(45_000)

    expect(dependencies.patchRuntimeLogLevel).toHaveBeenNthCalledWith(2, 'warning')
    expect(dependencies.restartLogStream).toHaveBeenNthCalledWith(2)
  })

  it('waits for a ready log stream when the configured level already includes info logs', async () => {
    const dependencies = createDependencies('debug')
    const capture = new TailscaleLogCapture(dependencies, 45_000)

    await capture.enable()

    expect(dependencies.patchRuntimeLogLevel).not.toHaveBeenCalled()
    expect(dependencies.restartLogStream).toHaveBeenCalledOnce()
    expect(dependencies.restartLogStream).toHaveBeenCalledWith()
  })

  it('coalesces concurrent initialization requests into one capture setup', async () => {
    vi.useFakeTimers()
    const dependencies = createDependencies('warning')
    const capture = new TailscaleLogCapture(dependencies, 45_000)

    await Promise.all([capture.enable(), capture.enable(), capture.enable()])

    expect(dependencies.patchRuntimeLogLevel).toHaveBeenCalledOnce()
    expect(dependencies.restartLogStream).toHaveBeenCalledOnce()
  })

  it('extends the capture window after repeated initialization', async () => {
    vi.useFakeTimers()
    const dependencies = createDependencies('error')
    const capture = new TailscaleLogCapture(dependencies, 45_000)

    await capture.enable()
    await vi.advanceTimersByTimeAsync(30_000)
    await capture.enable()
    await vi.advanceTimersByTimeAsync(30_000)

    expect(dependencies.patchRuntimeLogLevel).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(15_000)

    expect(dependencies.patchRuntimeLogLevel).toHaveBeenLastCalledWith('error')
    expect(dependencies.patchRuntimeLogLevel).toHaveBeenCalledTimes(3)
  })

  it('still restores after a repeated initialization fails', async () => {
    vi.useFakeTimers()
    const dependencies = createDependencies('warning')
    dependencies.getConfiguredLogLevel
      .mockResolvedValueOnce('warning')
      .mockRejectedValueOnce(new Error('config unavailable'))
      .mockResolvedValueOnce('warning')
    const capture = new TailscaleLogCapture(dependencies, 45_000)

    await capture.enable()
    await expect(capture.enable()).rejects.toThrow('config unavailable')
    await vi.advanceTimersByTimeAsync(45_000)

    expect(dependencies.patchRuntimeLogLevel).toHaveBeenNthCalledWith(2, 'warning')
    expect(dependencies.restartLogStream).toHaveBeenNthCalledWith(2)
  })

  it('restores the latest configured level and reports asynchronous restore failures', async () => {
    vi.useFakeTimers()
    const dependencies = createDependencies('warning')
    dependencies.getConfiguredLogLevel
      .mockResolvedValueOnce('warning')
      .mockResolvedValueOnce('silent')
    dependencies.patchRuntimeLogLevel
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('core stopped'))
    const capture = new TailscaleLogCapture(dependencies, 45_000)

    await capture.enable()
    await vi.advanceTimersByTimeAsync(45_000)

    expect(dependencies.patchRuntimeLogLevel).toHaveBeenLastCalledWith('silent')
    expect(dependencies.onRestoreError).toHaveBeenCalledWith(expect.any(Error))

    await vi.advanceTimersByTimeAsync(45_000)

    expect(dependencies.patchRuntimeLogLevel).toHaveBeenCalledTimes(3)
    expect(dependencies.restartLogStream).toHaveBeenLastCalledWith()
  })

  it('cancels an active restore window', async () => {
    vi.useFakeTimers()
    const dependencies = createDependencies('warning')
    const capture = new TailscaleLogCapture(dependencies, 45_000)

    await capture.enable()
    capture.cancel()
    await vi.advanceTimersByTimeAsync(45_000)

    expect(dependencies.patchRuntimeLogLevel).toHaveBeenCalledOnce()
    expect(dependencies.restartLogStream).toHaveBeenCalledOnce()
  })

  it('supersedes an in-flight enable and permits a fresh capture', async () => {
    let resolveFirstPatch: (() => void) | undefined
    const firstPatch = new Promise<void>((resolve) => {
      resolveFirstPatch = resolve
    })
    const dependencies = createDependencies('warning')
    dependencies.patchRuntimeLogLevel.mockImplementationOnce(async () => firstPatch)
    const capture = new TailscaleLogCapture(dependencies, 45_000)

    const firstEnable = capture.enable()
    await vi.waitFor(() => expect(dependencies.patchRuntimeLogLevel).toHaveBeenCalledOnce())
    capture.cancel()
    const secondEnable = capture.enable()

    expect(secondEnable).not.toBe(firstEnable)
    resolveFirstPatch?.()
    await Promise.all([firstEnable, secondEnable])

    expect(dependencies.patchRuntimeLogLevel).toHaveBeenCalledTimes(2)
    expect(dependencies.restartLogStream).toHaveBeenCalledOnce()
    expect(dependencies.restartLogStream).toHaveBeenCalledWith('info')
  })
})
