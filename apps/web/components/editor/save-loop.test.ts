import { describe, it, expect, vi } from "vitest"
import { createSaveLoop } from "./save-loop"

describe("createSaveLoop", () => {
  it("debounces saves", async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockResolvedValue({ ok: true })
    const loop = createSaveLoop({ save, delayMs: 500 })

    loop.schedule({ doc: { v: 1 } })
    loop.schedule({ doc: { v: 2 } })
    loop.schedule({ doc: { v: 3 } })
    expect(save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith({ doc: { v: 3 } })
    vi.useRealTimers()
  })

  it("flush() forces immediate save", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true })
    const loop = createSaveLoop({ save, delayMs: 500 })
    loop.schedule({ doc: { v: 1 } })
    await loop.flush()
    expect(save).toHaveBeenCalledOnce()
  })

  it("flush() is a no-op if nothing pending", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true })
    const loop = createSaveLoop({ save, delayMs: 500 })
    await loop.flush()
    expect(save).not.toHaveBeenCalled()
  })
})
