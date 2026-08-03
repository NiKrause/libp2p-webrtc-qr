import { Buffer } from 'buffer'

/**
 * Injected into every module of the elements bundle, so that no free `Buffer`
 * identifier survives in the output.
 *
 * That is the difference between a bundle a consumer can drop in and one it
 * cannot. A polyfill plugin - which most libp2p applications run - scans for
 * bare `Buffer` references and rewrites them into an import of its own shim.
 * Pointed at a file inside our package, that import cannot be resolved from the
 * consumer's project root, and the build fails on a specifier neither of us
 * wrote.
 */
export { Buffer }
