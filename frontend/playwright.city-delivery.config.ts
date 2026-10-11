import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
 testDir:'./e2e',testMatch:['city-delivery.spec.ts','city-delivery-screening.spec.ts'],workers:1,timeout:90_000,
 reporter:'list',use:{baseURL:'http://127.0.0.1:8111',trace:'retain-on-failure'},
 projects:[{name:'city-delivery-desktop',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:900}}}],
 webServer:[
  {command:`"${process.env.CITY_DELIVERY_PYTHON??'python'}" tools/city-delivery-decision/server.py --port 8114`,url:'http://127.0.0.1:8114/health',env:{PYTHONUTF8:'1'},reuseExistingServer:!process.env.CI},
  {command:'npm run frontend:dev -- --host 127.0.0.1 --port 8111 --strictPort',url:'http://127.0.0.1:8111/frontend/city-delivery/orders',env:{VITE_LOGISTICS_DIRECT:'true'},reuseExistingServer:!process.env.CI},
 ],
});
