const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    ignore: (file) => {
      // Allow root dir
      if (!file) return false;
      // Allow vite build output
      if (file.startsWith('/.vite')) return false;
      // Allow package.json
      if (file === '/package.json') return false;
      // Allow node_modules dir itself
      if (file === '/node_modules') return false;
      // Allow node-addon-api (required by node-pty's native rebuild)
      if (file.startsWith('/node_modules/node-addon-api')) return false;
      // Allow node-pty but filter heavy dev/build files
      if (file.startsWith('/node_modules/node-pty')) {
        const ext = file.split('.').pop().toLowerCase();
        if (['pdb', 'obj', 'lib', 'tlog'].includes(ext)) {
          return true; // Ignore debug symbols and Windows compilation artifacts
        }
        if (file.includes('/build/Release/obj')) {
          return true;
        }
        if (file.includes('/prebuilds/')) {
          return true; // Ignore prebuilt binaries for other platforms, we use the local build
        }
        return false;
      }
      // Ignore everything else
      return true;
    },
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    {
      name: '@electron-forge/plugin-vite',
      config: {
        // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
        // If you are familiar with Vite configuration, it will look really familiar.
        build: [
          {
            // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
            entry: 'src/main.js',
            config: 'vite.main.config.mjs',
            target: 'main',
          },
          {
            entry: 'src/preload.js',
            config: 'vite.preload.config.mjs',
            target: 'preload',
          },
        ],
        renderer: [
          {
            name: 'main_window',
            config: 'vite.renderer.config.mjs',
          },
        ],
      },
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
