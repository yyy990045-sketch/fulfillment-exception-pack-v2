import {expect,test,type Page} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
const task=JSON.parse(await readFile('frontend/public/demo/city-delivery/geo-city/v1/berlin/task.json','utf8'));
async function go(page:Page,name:string){const link=page.getByRole('navigation',{name:'城市配送导航'}).getByRole('link',{name:new RegExp(name)});await link.click();await expect(link).toHaveAttribute('aria-current','page');}
async function geoRoutes(page:Page){return JSON.parse((await page.locator('[data-geo-region=berlin]').getAttribute('data-geo-routes'))!);}
function checkRoadPlan(routes:any[],response:any){
 expect(routes.length).toBe(response.result.routes.length);
 for(const route of routes){const actual=response.result.routes.find((r:any)=>r.vehicleId===route.vehicleId);expect(route.stopOrder).toEqual(actual.stopOrder);expect(route.km).toBeCloseTo(actual.distanceKm,5);expect(route.minutes).toBeCloseTo(actual.drivingMinutes,2);expect(route.points).toBeGreaterThan(100);}
}
test('真实路网导入、三车→两车、相机保持、配载确认、全车卸货与作业导出',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/frontend/city-delivery/orders');
 await page.getByRole('button',{name:'导入配送任务',exact:true}).click();
 await page.getByLabel('配送任务文件').setInputFiles({name:'berlin-mitte-task.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(task))});
 await page.getByRole('button',{name:'提交后端检查',exact:true}).click();await expect(page.getByRole('button',{name:'开始真实规划',exact:true})).toBeEnabled();
 const firstRequest=page.waitForResponse(r=>r.url().endsWith('/plan-scene')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'开始真实规划',exact:true}).click();const three=await(await firstRequest).json();expect(three.executable).toBe(true);expect(three.result.totals.vehicleCount).toBe(3);
 await go(page,'智能调度');await page.locator('[data-geo-region=berlin] canvas').waitFor();await expect(page.locator('.p-geo-loading')).toHaveCount(0);
 const threeRoads=await geoRoutes(page);checkRoadPlan(threeRoads,three);await page.getByRole('button',{name:'确认采用修订方案',exact:true}).click();
 await expect(page.locator('.city-product')).toHaveAttribute('data-plan',three.planId);
 await page.getByRole('button',{name:'复位城市地图',exact:true}).click();await page.waitForTimeout(600);
 await page.screenshot({path:info.outputPath('01-city-panorama.png')});
 const map=await page.locator('.p-geo-city-map').boundingBox(),layout=await page.locator('.p-dispatch-layout').boundingBox();expect(map!.width/layout!.width).toBeGreaterThan(.59);expect(map!.height).toBeGreaterThan(430);expect(map!.y+map!.height).toBeLessThan(info.project.use.viewport!.height);
 await page.locator('.p-geo-city-host canvas').evaluate((el:any)=>el.__testCanvasIdentity='same');
 const camera=await page.locator('.p-geo-city-host').getAttribute('data-camera');
 await page.locator('.p-map-legend').getByRole('button',{name:/V02/}).click();await expect(page.locator('.city-product')).toHaveAttribute('data-vehicle','V02');
 await expect(page.locator('.p-route-inspector')).toContainText('V02');await expect(page.locator('.p-route-stops')).toContainText('地理门店 08');
 await expect(page.locator('.p-geo-stop-card')).toContainText('4 件包装件');await expect(page.locator('.p-geo-stop-card')).toContainText(three.result.routes.find((r:any)=>r.vehicleId==='V02').arrivals[0].arrivalTime);
 await page.waitForTimeout(400);expect(await page.locator('.p-geo-city-host').getAttribute('data-camera')).toBe(camera);expect(await page.locator('.p-geo-city-host canvas').evaluate((el:any)=>el.__testCanvasIdentity)).toBe('same');
 await page.screenshot({path:info.outputPath('04-selected-vehicle.png')});
 await page.locator('.p-map-legend').getByRole('button',{name:/V03/}).click();await page.waitForTimeout(300);await page.screenshot({path:info.outputPath('03-multiple-routes.png')});
 await page.locator('[data-geo-stop=S09]').click();await expect(page.locator('.city-product')).toHaveAttribute('data-vehicle','V03');await expect(page.locator('.p-route-stops .is-current')).toContainText('地理门店 09');
 await page.getByRole('button',{name:'倾斜近景',exact:true}).click();await page.waitForTimeout(600);await page.screenshot({path:info.outputPath('02-inclined-close.png')});
 // Actual pointer gestures, beyond the toolbar presets.
 const canvas=await page.locator('.p-geo-city-host canvas').boundingBox();await page.mouse.move(canvas!.x+canvas!.width*.5,canvas!.y+canvas!.height*.4);await page.mouse.down();await page.mouse.move(canvas!.x+canvas!.width*.57,canvas!.y+canvas!.height*.45,{steps:8});await page.mouse.up();await page.mouse.wheel(0,-100);await page.waitForTimeout(1600);
 let settled:string|null=null;
 await expect.poll(async()=>{const next=await page.locator('.p-geo-city-host').getAttribute('data-camera');const same=next===settled;settled=next;return same;},{timeout:12000,intervals:[400]}).toBe(true);
 const rotated=await page.locator('.p-geo-city-host').getAttribute('data-camera');expect(rotated).not.toBe(camera);
 await page.getByRole('button',{name:'改变条件',exact:true}).click();await page.locator('.p-standard-vehicles label').filter({hasText:'V01'}).getByRole('checkbox').uncheck();
 const secondRequest=page.waitForResponse(r=>r.url().endsWith('/plan-scene')&&r.request().method()==='POST');await page.getByRole('button',{name:'提交条件并重新规划',exact:true}).click();const two=await(await secondRequest).json();expect(two.executable).toBe(true);expect(two.result.totals.vehicleCount).toBe(2);
 await expect(page.locator('[data-geo-plan]')).toHaveAttribute('data-geo-plan',two.planId);checkRoadPlan(await geoRoutes(page),two);expect(await geoRoutes(page)).not.toEqual(threeRoads);
 expect(await page.locator('.p-geo-city-host canvas').evaluate((el:any)=>el.__testCanvasIdentity)).toBe('same');await page.waitForTimeout(500);const after=(await page.locator('.p-geo-city-host').getAttribute('data-camera'))!.split(',').map(Number),before=rotated!.split(',').map(Number);expect(Math.hypot(...after.map((n,i)=>n-before[i]))).toBeLessThan(1);
 await page.getByRole('button',{name:'复位城市地图',exact:true}).click();await page.getByRole('button',{name:'确认采用修订方案',exact:true}).click();await page.waitForTimeout(500);await page.screenshot({path:info.outputPath('05-changed-plan.png')});
 await page.locator('.p-map-legend').getByRole('button',{name:/V03/}).click();await page.locator('.p-geo-source summary').click();await expect(page.locator('.p-geo-source')).toContainText('地图路径与本次规划距离矩阵同源');await page.waitForTimeout(300);await page.screenshot({path:info.outputPath('06-new-geographic-task.png')});
 for(const name of ['订单与货物','三维配载','执行与调整','优化效果']){await go(page,name);await expect(page.locator('.city-product')).toHaveAttribute('data-plan',two.planId);await expect(page.locator('.city-product')).toHaveAttribute('data-scenario',task.scenarioId);}
 await go(page,'三维配载');await expect(page.locator('.p-cargo-scene canvas')).toBeVisible();await page.getByRole('button',{name:'装车指导',exact:true}).click();await page.getByLabel('装卸播放速度').selectOption('4');await page.getByRole('button',{name:'播放',exact:true}).click();await expect(page.locator('.p-playback-title')).toContainText('装车完成',{timeout:25000});
 await go(page,'执行与调整');await page.getByRole('button',{name:'开始执行演示',exact:true}).click();await expect(page.locator('.p-execution-lead h2')).toHaveText('全部车辆完成卸货演示',{timeout:40000});
 await expect(page.locator('[data-loading-cargo]')).toHaveCount(36);await expect(page.locator('[data-unloading-cargo]')).toHaveCount(36);await expect(page.locator('[data-unloading-stop]')).toHaveCount(9);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出已确认计划 JSON',exact:true}).click();const json=info.outputPath('geo-confirmed-plan.json');await(await download).saveAs(json);const exported=JSON.parse(await readFile(json,'utf8'));expect(exported.calculation.result).toEqual(two.result);expect(exported.status.confirmed).toBe(true);
 const htmlDownload=page.waitForEvent('download');await page.getByRole('button',{name:'导出可打印作业单',exact:true}).click();await(await htmlDownload).saveAs(info.outputPath('geo-operation-plan.html'));
 await go(page,'优化效果');await expect(page.locator('[data-current-effects]')).toHaveAttribute('data-current-effects',two.planId);await expect(page.locator('.p-standard-current-grid')).toContainText('364.45');await expect(page.locator('.p-effects-lead')).toContainText('已确认');
 await writeFile(info.outputPath('actual-plans.json'),JSON.stringify({three,two},null,2));expect(errors).toEqual([]);
});
test('历史九店保持50/38km口径，方案切换重组道路并识别空闲车辆',async({page},info)=>{
 await page.goto('/frontend/city-delivery/dispatch');await page.locator('[data-geo-region=hangzhou] canvas').waitFor();await expect(page.locator('.p-geo-loading')).toHaveCount(0);
 const map=page.locator('[data-geo-region=hangzhou]'),canvas=page.locator('.p-geo-city-host canvas');await canvas.evaluate((el:any)=>el.__testCanvasIdentity='historical');
 await expect(page.locator('.p-map-bottom')).toContainText('50 km');await expect(page.locator('.p-map-bottom')).toContainText('592');const before=await map.getAttribute('data-geo-routes');await expect(page.locator('.p-planbar')).toContainText('历史预先计算方案');await expect(page.locator('.p-planbar')).toContainText('切换不触发重新优化');
 await page.getByRole('button',{name:/两车候选方案/}).click();await expect(page.locator('.p-map-bottom')).toContainText('38 km');await expect(page.locator('.p-map-bottom')).toContainText('450.4');
 expect(await map.getAttribute('data-geo-routes')).not.toBe(before);expect(await canvas.evaluate((el:any)=>el.__testCanvasIdentity)).toBe('historical');
 await page.locator('.p-map-legend').getByRole('button',{name:/V01/}).click();await expect(page.locator('.p-route-inspector')).toContainText('空闲');await expect(page.locator('.p-route-stops')).toContainText('本车空闲');
 await page.locator('.p-geo-source summary').click();await expect(page.locator('.p-geo-source')).toContainText('计划 38 km；示意路网');await expect(page.locator('.p-geo-source')).toContainText('未检查单行或转向规则');
 await page.screenshot({path:info.outputPath('07-historical-idle-vehicle.png')});
});
