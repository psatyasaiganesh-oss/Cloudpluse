import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const project=fileURLToPath(new URL('../',import.meta.url));
export default defineConfig({root:project+'aws/web',publicDir:project+'public',plugins:[react()],resolve:{alias:{'@':project}},build:{outDir:project+'aws/dist/public',emptyOutDir:true}});
