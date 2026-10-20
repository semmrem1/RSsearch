import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import path from 'node:path';
export default defineConfig({
  root: '/home/claude/rssearch',
  plugins: [react(), { name: 'mock-supabase', enforce: 'pre', resolveId(src, importer) { if (src.endsWith('lib/supabase') && importer && !importer.includes('scratchpad')) { return '/tmp/claude-0/-home-claude/1cd6ef17-2d61-5b62-bfe8-5d4efdb51361/scratchpad/mock/supabase.ts'; } return null; } }],
  server: { fs: { allow: ['/home/claude/rssearch', '/tmp/claude-0/-home-claude/1cd6ef17-2d61-5b62-bfe8-5d4efdb51361/scratchpad'] } },
});
