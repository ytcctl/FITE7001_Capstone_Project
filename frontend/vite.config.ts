import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

export default defineConfig({
  plugins: [
    react(),
    // Serve Hardhat artifacts at /artifacts/<ContractName>.json
    {
      name: 'serve-hardhat-artifacts',
      configureServer(server) {
        server.middlewares.use('/artifacts', (req, res, next) => {
          // req.url is e.g. "/HKSTPGovernor.json"
          const contractName = (req.url || '').replace(/^\//, '').replace(/\.json$/, '');
          if (!contractName) return next();
          // Search in artifacts/contracts/**/
          const artifactsRoot = path.resolve(__dirname, '..', 'artifacts', 'contracts');
          const findArtifact = (dir: string): string | null => {
            if (!fs.existsSync(dir)) return null;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              if (entry.isDirectory()) {
                const result = findArtifact(path.join(dir, entry.name));
                if (result) return result;
              } else if (entry.name === `${contractName}.json` && !entry.name.includes('.dbg.')) {
                return path.join(dir, entry.name);
              }
            }
            return null;
          };
          const artifactPath = findArtifact(artifactsRoot);
          if (artifactPath) {
            res.setHeader('Content-Type', 'application/json');
            res.end(fs.readFileSync(artifactPath, 'utf-8'));
          } else {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: `Artifact ${contractName} not found` }));
          }
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 3000,
    open: false,
    hmr: {
      // When accessed via VS Code Dev Tunnels / port forwarding,
      // the tunnel URL uses HTTPS on port 443. Tell the HMR client
      // to connect back through the tunnel instead of localhost:3000.
      clientPort: process.env.VITE_TUNNEL ? 443 : undefined,
    },
    proxy: {
      '/rpc': {
        target: 'http://127.0.0.1:8545',
        changeOrigin: true,
        rewrite: () => '/',
        timeout: 300000,       // 5 min — large hardhat_mine calls can be slow
      },
    },
  },
});
