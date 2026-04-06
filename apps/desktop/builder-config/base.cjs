const path = require('node:path');

module.exports = {
    appId: 'com.onlook.desktop',
    productName: 'Onlook Desktop',
    electronVersion: '40.0.0',
    asar: true,
    directories: {
        buildResources: path.join(__dirname, '../build'),
        output: path.join(__dirname, '../release'),
    },
    files: [
        'dist/**/*',
        'package.json',
    ],
    extraMetadata: {
        main: 'dist/main.js',
    },
    mac: {
        target: ['dir'],
        category: 'public.app-category.developer-tools',
        icon: path.join(__dirname, '../build/icon.icns'),
    },
    win: {
        icon: path.join(__dirname, '../build/icon.ico'),
    },
    linux: {
        icon: path.join(__dirname, '../build/icon.png'),
    },
    npmRebuild: false,
    buildDependenciesFromSource: false,
    publish: null,
};
