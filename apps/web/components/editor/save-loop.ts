type SaveResult =
  | { ok: true }
  | { ok: false; error: { code: string; message: string } }

export function createSaveLoop<T>({
  save,
  delayMs = 500,
}: {
  save: (payload: T) => Promise<SaveResult>
  delayMs?: number
}) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: T | null = null

  function clear() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  async function fire() {
    if (pending === null) return
    const payload = pending
    pending = null
    clear()
    await save(payload)
  }

  return {
    schedule(payload: T) {
      pending = payload
      clear()
      timer = setTimeout(() => {
        void fire()
      }, delayMs)
    },
    async flush() {
      if (pending === null) return
      await fire()
    },
  }
}
