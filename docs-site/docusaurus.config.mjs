// Documentation site for @le-space/libp2p-webrtc-qr.
//
// The audience is somebody who arrived from npm and has to decide, in a few
// minutes, whether this transport fits their problem. That is a different reader
// from the one `docs/` serves - the engineering record of why the design is what
// it is - so this site links to those documents rather than absorbing them.
//
// English is the default locale because a library's readers are wherever npm is.
// German is a full second locale, not a fallback, because Le-Space's own
// consumers read it. Flipping the two is one line: `defaultLocale`.

import { themes } from 'prism-react-renderer'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Which build of the documentation this is.
//
// The package ships on its own schedule and this site rebuilds on every change,
// so a reader comparing a page against their installed version needs both facts:
// the version the page documents, and when the page itself was published. Read
// from the *package's* manifest, because that is the number a reader has in their
// own package.json.
const pkg = JSON.parse(readFileSync(new URL('../packages/webrtc-qr/package.json', import.meta.url), 'utf8'))

function currentCommit () {
  // Actions checks out a detached HEAD but hands the sha over in the
  // environment, which describes what triggered the build rather than what git
  // happens to be pointing at.
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)

  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    // Built from a tarball with no repository. One fact fewer, not a failure.
    return ''
  }
}

// UTC, because one published page is read from everywhere and a local timezone
// would give two readers two different answers about the same build.
const buildStamp = [
  `v${pkg.version}`,
  currentCommit(),
  `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`
].filter(Boolean).join(' · ')

/** @type {import('@docusaurus/types').Config} */
export default {
  title: 'libp2p WebRTC over QR',
  tagline: 'Two browsers, no relay, no signaling server',
  favicon: 'img/favicon.svg',

  // Set from the environment rather than hard-coded: a Docusaurus site with the
  // wrong baseUrl builds happily and then serves a page whose every asset 404s.
  url: process.env.DOCS_URL ?? 'https://nikrause.github.io',
  baseUrl: process.env.DOCS_BASE_URL ?? '/libp2p-webrtc-qr/',

  organizationName: 'NiKrause',
  projectName: 'libp2p-webrtc-qr',

  // A broken link in documentation sends somebody looking for an answer to a
  // 404, so it fails the build rather than warning into a log nobody reads.
  onBrokenLinks: 'throw',
  markdown: { hooks: { onBrokenMarkdownLinks: 'throw' } },

  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'de'],
    localeConfigs: {
      en: { label: 'English', htmlLang: 'en-GB' },
      de: { label: 'Deutsch', htmlLang: 'de-DE' }
    }
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.mjs',
          editUrl: 'https://github.com/NiKrause/libp2p-webrtc-qr/tree/main/docs-site/'
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' }
      })
    ]
  ],

  themeConfig: {
    colorMode: { defaultMode: 'dark', respectPrefersColorScheme: true },
    navbar: {
      title: 'libp2p WebRTC over QR',
      items: [
        { type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Docs' },
        { href: 'https://webrtc-qr.le-space.de', label: 'Demo', position: 'left' },
        { type: 'localeDropdown', position: 'right' },
        { href: 'https://github.com/NiKrause/libp2p-webrtc-qr', label: 'GitHub', position: 'right' }
      ]
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Package',
          items: [
            { label: 'npm', href: 'https://www.npmjs.com/package/@le-space/libp2p-webrtc-qr' },
            { label: 'Live demo', href: 'https://webrtc-qr.le-space.de' }
          ]
        },
        {
          title: 'Engineering record',
          items: [
            { label: 'Roadmap', href: 'https://github.com/NiKrause/libp2p-webrtc-qr/blob/main/ROADMAP.md' },
            { label: 'Notes for agents', href: 'https://github.com/NiKrause/libp2p-webrtc-qr/blob/main/AGENTS.md' },
            { label: 'Connection security', href: 'https://github.com/NiKrause/libp2p-webrtc-qr/blob/main/docs/connection-security.md' }
          ]
        }
      ],
      copyright: `Le-Space · Apache-2.0 OR MIT<br/><small>${buildStamp}</small>`
    },
    prism: { theme: themes.github, darkTheme: themes.dracula }
  }
}
