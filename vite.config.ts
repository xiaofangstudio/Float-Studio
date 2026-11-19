import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// 主界面构建。渲染层（vendor.js）由 vite.render.config.ts 先行产出到 public/render，
// 这里的构建会原样把它拷进 dist/render。
export default defineConfig({
  plugins: [react()],
  /* 框架代码在隔壁 FangUI/，用 @fangui/* 引用，IDE 与框架彻底分家 */
  resolve: {
    alias: { '@fangui': fileURLToPath(new URL('../fangui/FangUI/src', import.meta.url)) }
  },
  clearScreen: false,
  /* 端口必须和 Float IDE 分开：以前两边都是 1430，谁先起 dev server 谁占住，
   * 另一个（哪怕是自己编译的 exe，只要没启用 custom-protocol 就会去连 devUrl）
   * 打开后看到的其实是对方的前端——「进程是 FloatIDE、界面是 Float Studio」就是这么来的。 */
  server: { port: 1431, strictPort: true, host: '127.0.0.1' },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 9000,
    emptyOutDir: false,
    outDir: 'dist'
  }
});
