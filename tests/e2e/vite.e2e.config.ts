// Servidor local para testes ponta a ponta com PostgREST (sem Supabase na nuvem).
import { defineConfig, mergeConfig } from 'vite'
import base from '../../vite.config'

export default mergeConfig(
  base,
  defineConfig({
    server: {
      port: 5173,
      proxy: { '/rest/v1': { target: 'http://127.0.0.1:3001', rewrite: (p) => p.replace(/^\/rest\/v1/, '') } },
    },
  }),
)
