/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
export default {
  docs: [
    'index',
    {
      type: 'category',
      label: 'Using it',
      collapsed: false,
      items: ['session', 'payloads', 'transport', 'audio']
    },
    {
      type: 'category',
      label: 'Interface',
      collapsed: false,
      items: ['elements', 'network']
    },
    'security',
    'mobile'
  ]
}
