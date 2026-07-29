import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    // antd 단독 청크(vendor-antd)는 분리해도 여전히 500kB를 넘는다 — 거의 모든 화면이
    // Table/Form/Modal 등 핵심 컴포넌트를 쓰므로 더 잘게 쪼개도 초기 진입 시 어차피 함께
    // 받아야 해 실효가 없음. 앱 코드(라우트별 청크)는 전부 수십 kB대로 내려간 상태라
    // 이 라이브러리 고유의 크기만 남은 것으로 판단해 경고 임계값만 상향한다.
    chunkSizeWarningLimit: 1200,
    // 라우트별 React.lazy 코드 스플리팅(routes/AppRoutes.tsx)과 병행해 벤더 라이브러리를
    // 별도 청크로 분리한다 — antd가 가장 커서 단독 청크, 나머지는 성격별로 묶는다.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-antd', test: /node_modules\/(antd|@ant-design)/ },
            {
              name: 'vendor-react',
              test: /node_modules\/(react|react-dom|react-router|react-router-dom)\//,
            },
            {
              name: 'vendor-i18n',
              test: /node_modules\/(i18next|react-i18next)/,
            },
            { name: 'vendor', test: /node_modules/ },
          ],
        },
      },
    },
  },
})
