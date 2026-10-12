import {expect,test,type Page} from '@playwright/test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const evidence='artifacts/phase9-functional';
const six=JSON.parse(await readFile('tools/city-delivery-decision/examples-2f/legal-request.json','utf8')).scenario;
const go=async(page:Page,name:string)=>page.getByRole('navigation',{name:'城市配送导航'}).getByRole('link',{name:new RegExp(name)}).click();
async function importTask(page:Page,scenario:any=six,strategy='joint-feedback'){
 await go(page,'订单与货物');await page.getByRole('button',{name:'导入配送任务',exact:true}).click();
 await page.getByLabel('配送任务文件').setInputFiles({name:'task.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(scenario))});
 await page.getByRole('button',{name:'提交后端检查',exact:true}).click();await page.locator('.p-import-strategy select').selectOption(strategy);
 const pending=page.waitForResponse(r=>r.url().endsWith('/plan-scene')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'开始真实规划',exact:true}).click();const res=await pending;
 await expect(page.getByRole('dialog')).toHaveCount(0);return {request:res.request().postDataJSON(),result:await res.json()};
}
test('Phase9 P0 SKU covers historical, pending, confirmed, row order and invalid packaging',async({page},info)=>{
 await mkdir(evidence,{recursive:true});const records:any[]=[];
 for(const mode of ['nine','four','pending','confirmed']){
  await page.goto('/frontend/city-delivery/orders');
  if(mode==='four')await page.getByRole('button',{name:'四店单车',exact:true}).click();
  if(mode==='pending'||mode==='confirmed'){await importTask(page);if(mode==='confirmed'){await go(page,'三维配载');await page.getByRole('button',{name:'确认采用修订方案',exact:true}).click();await go(page,'订单与货物');}}
  const base=mode==='nine'?JSON.parse(await readFile('frontend/public/demo/city-delivery/v2/scenario.json','utf8')):mode==='four'?JSON.parse(await readFile('frontend/public/demo/city-delivery/v1/scenario.json','utf8')):six;
  await page.getByRole('button',{name:'按包装规格准备批次',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'按包装规格准备配送批次'});
  await dialog.locator('.p-sku-grid select').selectOption('S02');await dialog.getByLabel('数量',{exact:true}).fill('12');
  if(mode==='nine'){await dialog.getByLabel('易碎，顶部禁堆',{exact:true}).check();await expect(dialog.getByLabel('上方承重',{exact:true})).toHaveValue('0');}
  await dialog.getByRole('button',{name:'增加商品',exact:true}).click();
  await dialog.getByLabel('SKU',{exact:true}).nth(1).fill('SKU-002');await dialog.getByLabel('数量',{exact:true}).nth(1).fill('12');
  if(mode==='four'){await dialog.getByLabel('SKU',{exact:true}).nth(1).fill('SKU-001');await dialog.locator('.p-sku-grid select').nth(1).selectOption('S02');await dialog.getByRole('button',{name:'生成包装件并开始规划'}).click();await expect(dialog.locator('.p-error')).toContainText('重复');await dialog.getByLabel('SKU',{exact:true}).nth(1).fill('SKU-002');await dialog.locator('.p-sku-grid select').nth(1).selectOption('S01');}
  const pending=page.waitForResponse(r=>r.url().endsWith('/plan-scene')&&r.request().method()==='POST');
  await dialog.getByRole('button',{name:'生成包装件并开始规划'}).click();const response=await pending;const request=response.request().postDataJSON();const result=await response.json();
  expect(response.ok()).toBe(true);expect(result.executable).toBe(true);expect(result.executionMode).toBe('computed-per-request');
  const scenario=request.scenario;expect(scenario.cargo).toHaveLength(6);expect(scenario.routing.nodeIds).toEqual(['DEPOT','S01','S02']);expect(scenario.stops.map((s:any)=>s.stopId)).toEqual(['S01','S02']);
  for(const field of ['distanceMatrixKm','travelTimeMatrixMinutes']){const indices=scenario.routing.nodeIds.map((id:string)=>base.routing.nodeIds.indexOf(id));expect(scenario.routing[field]).toEqual(indices.map((i:number)=>indices.map((j:number)=>base.routing[field][i][j])));}
  expect(Object.keys(scenario.routing).sort()).toEqual(['distanceMatrixKm','nodeIds','returnToDepot','travelTimeMatrixMinutes']);
  if(mode==='nine')expect(scenario.cargo.filter((c:any)=>c.fragile).every((c:any)=>c.maxTopLoadKg===0)).toBe(true);
  expect(scenario.vehicles.map((v:any)=>v.costs)).toEqual(base.vehicles.map((v:any)=>v.costs??{vehicleFixedCost:base.costs.vehicleFixedCost,drivingCostPerKm:base.costs.drivingCostPerKm}));
  expect(result.result.routes.every((r:any)=>r.feasibility.executable)).toBe(true);records.push({mode,request,result});
  await go(page,'执行与调整');await expect(page.getByRole('button',{name:'开始执行演示',exact:true})).toBeDisabled();
 }
 await go(page,'三维配载');await page.getByRole('button',{name:'确认采用修订方案',exact:true}).click();const keptPlan=await page.locator('.city-product').getAttribute('data-plan');
 await go(page,'订单与货物');await page.getByRole('button',{name:'按包装规格准备批次',exact:true}).click();const dialog=page.getByRole('dialog',{name:'按包装规格准备配送批次'});
 await dialog.getByLabel('整箱重量',{exact:true}).fill('0');const invalid=page.waitForResponse(r=>r.url().endsWith('/validate-scene')&&r.request().method()==='POST');
 await dialog.getByRole('button',{name:'生成包装件并开始规划'}).click();const rejected=await invalid;expect(rejected.status()).toBe(422);await expect(dialog.locator('.p-error')).toContainText('weightKg');expect(await page.locator('.city-product').getAttribute('data-plan')).toBe(keptPlan);
 records.push({invalid:rejected.request().postDataJSON(),status:rejected.status(),result:await rejected.json()});await page.screenshot({path:`${evidence}/p0-invalid.png`});
 await dialog.getByRole('button',{name:'关闭包装批次编辑'}).click();await go(page,'三维配载');await expect(page.getByRole('button',{name:'确认采用修订方案',exact:true})).toHaveCount(0);await expect(page.locator('.city-product')).toHaveAttribute('data-plan',keptPlan!);await go(page,'执行与调整');await expect(page.getByRole('button',{name:'开始执行演示',exact:true})).toBeEnabled();
 // A valid contract can still fail geometry: retain the confirmed plan, never invent success.
 await go(page,'订单与货物');await page.getByRole('button',{name:'按包装规格准备批次',exact:true}).click();await dialog.getByLabel('整箱尺寸 L×W×H').fill('15 × 15 × 15');
 const failed=page.waitForResponse(r=>r.url().endsWith('/plan-scene')&&r.request().method()==='POST');await dialog.getByRole('button',{name:'生成包装件并开始规划'}).click();const failedResponse=await failed;const failure=await failedResponse.json();expect(failure.executable).toBe(false);expect(failure.actualExecutablePlanCost).toBeNull();records.push({geometryFailure:failedResponse.request().postDataJSON(),result:failure});
 await go(page,'执行与调整');await expect(page.getByRole('button',{name:'开始执行演示',exact:true})).toBeDisabled();await expect(page.locator('.p-planning-failure')).toBeVisible();await page.getByRole('button',{name:'恢复旧计划及原始条件',exact:true}).click();await expect(page.locator('.city-product')).toHaveAttribute('data-plan',keptPlan!);await expect(page.getByRole('button',{name:'开始执行演示',exact:true})).toBeEnabled();
 await writeFile(`${evidence}/p0-requests-results.json`,JSON.stringify(records,null,2));await page.screenshot({path:info.outputPath('p0-restored.png')});
});
for(const width of [1440,1920])test(`Phase9 real feedback, constraints and truthful failure ${width}`,async({page})=>{
 await page.setViewportSize({width,height:width===1440?900:1080});await mkdir(evidence,{recursive:true});const records:any[]=[];
 const shot=async(name:string)=>{await page.waitForTimeout(400);await page.screenshot({path:`${evidence}/${width}-${name}.png`});};
 await page.goto('/frontend/city-delivery/orders');
 for(const strategy of ['route-first','layout-repair','joint-feedback']){
  const record=await importTask(page,six,strategy);records.push(record);await go(page,'智能调度');
  await expect(page.locator('[data-decision-process]')).toHaveAttribute('data-decision-process',record.result.planId);
  await expect(page.locator('[data-feedback-phase]')).toHaveCount(record.result.search.trace.length);
  if(strategy==='joint-feedback'){
   expect(record.result.executable).toBe(true);expect(record.result.actualExecutablePlanCost).toBe(194.8);
   await expect(page.locator('[data-feedback-phase=route-first-check]')).toContainText('V01');
   await expect(page.locator('[data-feedback-phase=layout-feedback-routing]')).toContainText('整套检查通过');
   await shot('03-six-default-process');await page.locator('[data-feedback-phase=layout-feedback-routing] summary').click();await expect(page.locator('[data-decision-process]')).toContainText('V01 → V02');
   await expect(page.locator('.p-feedback')).toContainText('新生成 12 件货位');await expect(page.locator('.p-feedback')).not.toContainText('移动 12');await shot('03-six-feedback');
  }else expect(record.result.executable).toBe(false);
 }
 await page.getByRole('button',{name:'确认采用修订方案',exact:true}).click();await go(page,'三维配载');await page.locator('.p-cargo-scene canvas').waitFor();
 await page.locator('.p-check-details').first().locator('summary').click();
 for(const id of ['boundary','collision','weight','orientation','fragile','support','loadBearing','loading_path','unloading_blocked'])await expect(page.locator(`[data-constraint="${id}"]`)).toContainText('通过');
 await shot('04-independent-checks');await page.getByRole('button',{name:/查看已检查的装载候选/}).click();const panel=page.getByRole('dialog',{name:/装载候选/});
 const failed=records.at(-1).result.search.candidateEvaluations.filter((c:any)=>!c.feasible);await expect(panel.locator('[data-candidate-failures]')).toHaveCount(failed.length);await expect(panel.locator('[data-candidate-failures]').first()).not.toBeEmpty();
 const canvas=page.locator('.p-packing-layout .cd-scene canvas');const open=await canvas.boundingBox();expect(open!.height).toBeGreaterThanOrEqual(350);await shot('04-candidate-failures');await page.keyboard.press('Escape');const closed=await canvas.boundingBox();expect(closed!.height).toBeCloseTo(open!.height,0);
 // A newly prepared simple batch can pass initially; do not invent feedback.
 await go(page,'订单与货物');await page.getByRole('button',{name:'按包装规格准备批次',exact:true}).click();const dialog=page.getByRole('dialog',{name:'按包装规格准备配送批次'});
 const p=page.waitForResponse(r=>r.url().endsWith('/plan-scene')&&r.request().method()==='POST');await dialog.getByRole('button',{name:'生成包装件并开始规划'}).click();const simpleResponse=await p;const simple=await simpleResponse.json();records.push({request:simpleResponse.request().postDataJSON(),result:simple});expect(simple.initialCheck.feasibility.executable).toBe(true);
 await go(page,'智能调度');await expect(page.locator('[data-decision-process]')).toContainText('初始方案已通过，无需反馈');
 await page.getByRole('button',{name:'确认采用修订方案',exact:true}).click();await go(page,'三维配载');await page.getByRole('button',{name:'装车指导',exact:true}).click();await page.getByLabel('装卸播放速度').selectOption('4');await page.getByRole('button',{name:'播放',exact:true}).click();await expect(page.locator('.p-playback-title')).toContainText('装车完成',{timeout:15000});
 await go(page,'执行与调整');await shot('05-current-guidance');await page.getByRole('button',{name:'开始执行演示',exact:true}).click();await expect(page.locator('.p-execution-lead h2')).toHaveText('全部车辆完成卸货演示',{timeout:40000});await expect(page.getByTestId('product-remaining')).toHaveText('0');
 await page.getByRole('button',{name:'恢复发车前规划',exact:true}).click();
 const duration=JSON.parse(await readFile('tools/city-delivery-decision/examples-2f/max-route-duration-request.json','utf8')).scenario;const durationResult=await importTask(page,duration);records.push(durationResult);expect(durationResult.result.executable).toBe(false);
  expect(durationResult.request.scenario.rules.maxRouteDurationMinutes).toBe(480);await go(page,'优化效果');await expect(page.locator('.p-planning-failure')).toContainText('有限搜索失败不等于全局无解');
 const late=structuredClone(duration);late.departureTime='14:00';const lateResult=await importTask(page,late);records.push(lateResult);expect(lateResult.result.result).toBeNull();expect(lateResult.result.initialCheck).toBeNull();
 for(const name of ['配送驾驶舱','执行与调整','优化效果']){await go(page,name);await expect(page.locator('.p-planning-failure')).toContainText('310 分钟');if(name==='配送驾驶舱'){await expect(page.locator('.p-overview-next')).toContainText('尚无有效规划结果');await expect(page.locator('.p-overview-next')).not.toContainText('¥0');await expect(page.locator('.p-overview-strip')).not.toContainText('返仓');await shot('01-no-valid-plan');}else{await expect(page.getByRole('button',{name:'导出已确认计划',exact:true})).toBeDisabled();if(name==='执行与调整')await expect(page.getByRole('button',{name:'开始执行演示',exact:true})).toBeDisabled();await shot(name==='执行与调整'?'05-failure':'06-failure');}}
 await writeFile(`${evidence}/${width}-requests-results.json`,JSON.stringify({records,canvasHeightOpen:open!.height,canvasHeightClosed:closed!.height},null,2));
});
