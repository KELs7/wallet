
module.exports = {
  name: 'Clove Sign Plugin',
  version: '0.0.1',
  description: 'Tool for signing raw transaction in bitcoin and ethereum based networks',
  manifest_version: 2,
  icons: {
    16: 'icons/icon-clove-16.png',
    128: 'icons/icon-clove-128.png',
  },
  permissions: [
    'storage',
  ],
  browser_action: {
    default_title: 'Clove Sign Plugin',
    default_popup: 'pages/popup.html',
    default_icon: {
      19: 'icons/icon-clove-19.png',
      38: 'icons/icon-clove-38.png',
    },
  },
  background: {
    page: 'pages/background.html',
  },
  content_scripts: [{
    js: ['js/content.js'],
    run_at: 'document_end',
    matches: ['<all_urls>'],
    all_frames: true,
  }],
  content_security_policy: "script-src 'self' 'unsafe-eval'; object-src 'self'",
};
