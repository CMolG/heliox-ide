/**
 * forge.config.ts — Project runtime
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { existsSync } from 'fs';

const playwrightBrowsersPath = './node_modules/playwright/.local-browsers';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Heliox IDE',
    icon: './assets/icon',
    extraResource: [
      ...(existsSync(playwrightBrowsersPath) ? [playwrightBrowsersPath] : []),
      './assets/icon.png',
    ],
    asar: true,
  },
  makers: [
    new MakerSquirrel({ name: 'HelioxIDE' }),
    new MakerDMG({ format: 'ULFO' }),
    new MakerDeb({
      options: {
        maintainer: 'Heliox',
        homepage: 'https://heliox.dev',
      },
    }),
    new MakerRpm({ options: { name: 'heliox-ide' } }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main/index.ts', config: 'vite.main.config.ts' },
        { entry: 'src/preload/index.ts', config: 'vite.preload.config.ts' },
      ],
      renderer: [
        { name: 'main_window', config: 'vite.renderer.config.ts' },
      ],
    }),
  ],
  publishers: [
    new PublisherGithub({
      repository: {
        owner: 'CMolG',
        name: 'heliox-ide',
      },
      prerelease: true,
      draft: false,
    }),
  ],
};

export default config;
