import {defineConfig,devices} from '@playwright/test';
import city from './playwright.city-delivery.config';
export default defineConfig({...city,testMatch:'city-delivery-geo.spec.ts',timeout:120_000,projects:[
 {name:'gis-1440',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:900}}},
 {name:'gis-1920',use:{...devices['Desktop Chrome'],viewport:{width:1920,height:1080}}},
]});
