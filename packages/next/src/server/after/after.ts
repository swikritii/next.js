import { DetachedPromise } from '../../lib/detached-promise'

import {
  requestAsyncStorage,
  type RequestStore,
} from '../../client/components/request-async-storage.external'
import { staticGenerationAsyncStorage } from '../../client/components/static-generation-async-storage.external'

import { BaseServerSpan } from '../lib/trace/constants'
import { getTracer } from '../lib/trace/tracer'
import type { CacheScope } from './react-cache-scope'
import { ResponseCookies } from '../web/spec-extension/cookies'
import { markCurrentScopeAsDynamic } from '../app-render/dynamic-rendering'
import type { RequestLifecycleOpts } from '../base-server'

type AfterTask<T = unknown> = Promise<T> | AfterCallback<T>
type AfterCallback<T = unknown> = () => T | Promise<T>

type WaitUntilFn = <T>(promise: Promise<T>) => void

/**
 * This function allows you to schedule callbacks to be executed after the current request finishes.
 */
export function unstable_after<T>(task: AfterTask<T>) {
  const requestStore = requestAsyncStorage.getStore()
  if (!requestStore) {
    throw new Error(
      'Invalid unstable_after() call. unstable_after() can only be called:\n' +
        '  - from within a server component\n' +
        '  - in a route handler\n' +
        '  - in a server action\n' +
        '  - in middleware\n'
    )
  }

  const { afterContext } = requestStore
  if (!afterContext) {
    throw new Error('Invariant: No afterContext in requestStore')
  }
  if (!afterContext.enabled) {
    throw new Error(
      'unstable_after() must be explicitly enabled by setting `experimental.after: true` in your next.config.js.'
    )
  }

  const callingExpression = 'unstable_after'
  const staticGenerationStore = staticGenerationAsyncStorage.getStore()

  if (staticGenerationStore) {
    if (staticGenerationStore.forceStatic) {
      // When we are forcing static, after() is a no-op
      return
    } else {
      markCurrentScopeAsDynamic(staticGenerationStore, callingExpression)
    }
  }

  return afterContext.after(task)
}

export type AfterContext =
  | ReturnType<typeof createAfterContext>
  | ReturnType<typeof createDisabledAfterContext>

export function createAfterContext({
  waitUntil,
  onClose,
  cacheScope,
}: {
  waitUntil: WaitUntilFn
  onClose: RequestLifecycleOpts['onClose']
  cacheScope?: CacheScope
}) {
  const keepAliveLock = createKeepAliveLock(waitUntil)

  const afterCallbacks: AfterCallback[] = []
  const addCallback = (callback: AfterCallback) => {
    if (afterCallbacks.length === 0) {
      keepAliveLock.acquire()
      firstCallbackAdded.resolve()
    }
    afterCallbacks.push(callback)
  }

  // `onClose` has some overhead in WebNextResponse, so we don't want to call it unless necessary.
  // we also have to avoid calling it if we're in static generation (because it doesn't exist there).
  //   (the ordering is a bit convoluted -- in static generation, calling after() will cause a bailout and fail anyway,
  //    but we can't know that at the point where we call `onClose`.)
  // this trick means that we'll only ever try to call `onClose` if an `after()` call successfully went through.
  const firstCallbackAdded = new DetachedPromise<void>()
  const onCloseLazy = (callback: () => void): Promise<void> => {
    return firstCallbackAdded.promise.then(() => onClose(callback))
  }

  const afterImpl = (task: AfterTask) => {
    if (isPromise(task)) {
      task.catch(() => {}) // avoid unhandled rejection crashes
      waitUntil(task)
    } else if (typeof task === 'function') {
      // TODO(after): will this trace correctly?
      addCallback(() => getTracer().trace(BaseServerSpan.after, () => task()))
    } else {
      throw new Error('after() must receive a promise or a function')
    }
  }

  const runCallbacks = (requestStore: RequestStore) => {
    if (afterCallbacks.length === 0) return

    const runCallbacksImpl = () => {
      while (afterCallbacks.length) {
        const afterCallback = afterCallbacks.shift()!

        const onError = (err: unknown) => {
          // TODO(after): how do we properly report errors here?
          console.error(
            'An error occurred in a function passed to after()',
            err
          )
        }

        // try-catch in case the callback throws synchronously or does not return a promise.
        try {
          const ret = afterCallback()
          if (isPromise(ret)) {
            waitUntil(ret.catch(onError))
          }
        } catch (err) {
          onError(err)
        }
      }

      keepAliveLock.release()
    }

    const readonlyRequestStore: RequestStore =
      wrapRequestStoreForAfterCallbacks(requestStore)

    return requestAsyncStorage.run(readonlyRequestStore, () =>
      cacheScope ? cacheScope.run(runCallbacksImpl) : runCallbacksImpl()
    )
  }

  return {
    enabled: true as const,
    after: afterImpl,
    run: async <T>(requestStore: RequestStore, callback: () => T) => {
      try {
        return await (cacheScope
          ? cacheScope.run(() => callback())
          : callback())
      } finally {
        // NOTE: it's likely that the callback is doing streaming rendering,
        // which means that nothing actually happened yet,
        // and we have to wait until the request closes to do anything.
        // (this also means that this outer try-finally may not catch much).

        // don't await -- it may never resolve if no callbacks are passed.
        void onCloseLazy(() => runCallbacks(requestStore)).catch(
          (err: unknown) => {
            console.error(err)
            // as a last resort -- if something fails here, something's probably broken really badly,
            // so make sure we release the lock -- at least we'll avoid hanging a `waitUntil` forever.
            keepAliveLock.release()
          }
        )
      }
    },
  }
}

export function createDisabledAfterContext() {
  return { enabled: false as const }
}

/** Disable mutations of `requestStore` within `after()` and disallow nested after calls.  */
function wrapRequestStoreForAfterCallbacks(
  requestStore: RequestStore
): RequestStore {
  return {
    get headers() {
      return requestStore.headers
    },
    get cookies() {
      return requestStore.cookies
    },
    get draftMode() {
      return requestStore.draftMode
    },
    assetPrefix: requestStore.assetPrefix,
    reactLoadableManifest: requestStore.reactLoadableManifest,
    // make cookie writes go nowhere
    mutableCookies: new ResponseCookies(new Headers()),
    afterContext: {
      enabled: true,
      after: () => {
        throw new Error('Cannot call after() from within after()')
      },
      run: () => {
        throw new Error('Cannot call run() from within an after() callback')
      },
    },
  }
}

function createKeepAliveLock(waitUntil: WaitUntilFn) {
  // callbacks can't go directly into waitUntil,
  // and we don't want a function invocation to get stopped *before* we execute the callbacks,
  // so block with a dummy promise that we'll resolve when we're done.
  let keepAlivePromise: DetachedPromise<void> | undefined
  return {
    isLocked() {
      return !!keepAlivePromise
    },
    acquire() {
      if (!keepAlivePromise) {
        keepAlivePromise = new DetachedPromise<void>()
        waitUntil(keepAlivePromise.promise)
      }
    },
    release() {
      if (keepAlivePromise) {
        keepAlivePromise.resolve(undefined)
        keepAlivePromise = undefined
      }
    },
  }
}

function isPromise(p: unknown): p is Promise<unknown> {
  return (
    p !== null &&
    typeof p === 'object' &&
    'then' in p &&
    typeof p.then === 'function'
  )
}
