/**
 * A process stand-in, injected so that no free `process` identifier survives the
 * bundle - for the same reason as Buffer: a consumer's polyfill plugin rewrites
 * bare references into imports of its own shim, which cannot be resolved from
 * inside this package.
 *
 * Deliberately minimal. The only things the bundled dependencies reach for are
 * deprecation flags and `env`, and inventing more would be pretending this code
 * runs somewhere it does not.
 */
export const process = {
  env: {},
  browser: true,
  noDeprecation: false,
  throwDeprecation: false,
  traceDeprecation: false,
  nextTick: (callback, ...args) => queueMicrotask(() => callback(...args))
}
