interface TailscaleLogCaptureDependencies {
  getConfiguredLogLevel: () => Promise<LogLevel>
  patchRuntimeLogLevel: (level: LogLevel) => Promise<void>
  restartLogStream: (level?: LogLevel) => Promise<void>
  onRestoreError: (error: unknown) => void
}

const includesInfoLogs = (level: LogLevel): boolean => level === 'debug' || level === 'info'

export class TailscaleLogCapture {
  private active = false
  private generation = 0
  private pendingEnable: Promise<void> | undefined
  private operation: Promise<void> = Promise.resolve()
  private restoreTimer: NodeJS.Timeout | undefined

  constructor(
    private readonly dependencies: TailscaleLogCaptureDependencies,
    private readonly durationMs: number
  ) {}

  enable(): Promise<void> {
    if (this.pendingEnable) return this.pendingEnable

    const generation = ++this.generation
    if (this.restoreTimer) {
      clearTimeout(this.restoreTimer)
      this.restoreTimer = undefined
    }

    const operation = this.operation
      .catch(() => {})
      .then(async () => this.enableCapture(generation))
    operation.catch(() => {
      if (generation === this.generation && this.active && !this.restoreTimer) {
        this.scheduleRestore(generation)
      }
    })
    this.operation = operation
    this.pendingEnable = operation
    operation.then(
      () => {
        if (this.pendingEnable === operation) this.pendingEnable = undefined
      },
      () => {
        if (this.pendingEnable === operation) this.pendingEnable = undefined
      }
    )
    return operation
  }

  cancel(): void {
    this.generation += 1
    if (this.restoreTimer) {
      clearTimeout(this.restoreTimer)
      this.restoreTimer = undefined
    }
    this.active = false
    this.pendingEnable = undefined
  }

  private async enableCapture(generation: number): Promise<void> {
    const configuredLevel = await this.dependencies.getConfiguredLogLevel()
    if (generation !== this.generation) return

    if (includesInfoLogs(configuredLevel)) {
      if (!this.active) {
        await this.dependencies.restartLogStream()
        return
      }
      await this.dependencies.patchRuntimeLogLevel(configuredLevel)
      if (generation !== this.generation) return
      await this.dependencies.restartLogStream()
      this.active = false
      return
    }

    await this.dependencies.patchRuntimeLogLevel('info')
    if (generation !== this.generation) return
    this.active = true
    try {
      await this.dependencies.restartLogStream('info')
    } finally {
      if (generation === this.generation && this.active) {
        this.scheduleRestore(generation)
      }
    }
  }

  private scheduleRestore(generation: number): void {
    if (this.restoreTimer) {
      clearTimeout(this.restoreTimer)
    }
    this.restoreTimer = setTimeout(() => {
      this.restoreTimer = undefined
      const operation = this.operation.catch(() => {}).then(async () => this.restore(generation))
      operation.catch((error) => {
        this.dependencies.onRestoreError(error)
        if (generation === this.generation && this.active && !this.restoreTimer) {
          this.scheduleRestore(generation)
        }
      })
      this.operation = operation
    }, this.durationMs)
    this.restoreTimer.unref()
  }

  private async restore(generation: number): Promise<void> {
    if (generation !== this.generation || !this.active) return

    const configuredLevel = await this.dependencies.getConfiguredLogLevel()
    if (generation !== this.generation) return

    await this.dependencies.patchRuntimeLogLevel(configuredLevel)
    if (generation !== this.generation) return

    await this.dependencies.restartLogStream()
    if (generation === this.generation) {
      this.active = false
    }
  }
}
