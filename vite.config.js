import { defineConfig } from 'vite';
import { resolve } from 'path'; // adicione isso se necessário

export default defineConfig({
  // Suas configurações do Vite aqui
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: resolve(__dirname, 'index.html') // caminho absoluto
    }
  }
});
