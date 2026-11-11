import { defineConfig } from 'vite';
import { projectsFolder } from './tools/projectsFolder.js';
import { chats } from './tools/chats.js';

export default defineConfig({
  // The desktop widget runs its own server alongside `npm run dev`; each gets
  // its own dependency cache so the two never rebuild the same one at once.
  cacheDir: process.env.REEF_VITE_CACHE || 'node_modules/.vite',
  plugins: [projectsFolder({ dir: 'Projects' }), chats()],
});
