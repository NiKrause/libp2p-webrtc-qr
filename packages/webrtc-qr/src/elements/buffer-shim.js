import { Buffer } from 'buffer'

/**
 * `@ngraveio/bc-ur` reads Buffer off the global object rather than importing it,
 * so one has to be there. This is imported first by the elements entry point and
 * bundled into the shipped file, which is the whole point: a consumer's build
 * never sees a `buffer` specifier to resolve, and so cannot resolve it one way
 * while its polyfill plugin resolves it another.
 *
 * Only if absent. An application that has its own Buffer must keep it, or two
 * implementations end up in one page and `instanceof` stops meaning anything.
 */
if (globalThis.Buffer == null) {
  globalThis.Buffer = Buffer
}
