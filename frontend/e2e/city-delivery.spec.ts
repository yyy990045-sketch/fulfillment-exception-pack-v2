import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const fixture=JSON.parse(await readFile(path.resolve('tools/city-delivery-decision/examples-2f/legal-request.json'),'utf8'));
async function go(page:Page,name:string){const link=page.getByRole('navigation',{name:'城市配送导航'}).getByRole('link',{name:new RegExp(name)});await link.click();await expect(link).toHaveAttribute('aria-current','page');}
async function importAndPlan(page:Page){
 await page.goto('/frontend/city-delivery/orders');
 await page.getByRole('button',{name:'导入配送任务',exact:true}).click();
 await page.getByLabel('配送任务文件').setInputFiles({name:'six-store.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture.scenario))});
 await page.getByRole('button',{name:'提交后端检查',exact:true}).click();
 await expect(page.getByRole('button',{name:'开始真实规划',exact:true})).toBeEnabled();
 const response=page.waitForResponse(r=>r.url().endsWith('/plan-scene')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'开始真实规划',exact:true}).click();
 const result=await (await response).json();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(result.executable).toBe(true);return result;
}
async function confirm(page:Page){await go(page,'三维配载');await page.getByRole('button',{name:'确认采用修订方案',exact:true}).click();}

test('六店完整主线：同一计划、确认、装卸、JSON 与可打印作业单、真实结果',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const result=await importAndPlan(page);
 for(const name of ['订单与货物','智能调度','三维配载','执行与调整','优化效果']){
  await go(page,name);await expect(page.locator('.city-product')).toHaveAttribute('data-plan',result.planId);
  await expect(page.locator('.city-product')).toHaveAttribute('data-scenario',result.scenarioId);
 }
 await go(page,'智能调度');
 await expect(page.locator('.p-spatial-map')).toBeVisible();
 await expect(page.locator('.p-geo-city-map')).toHaveCount(0);
 for(const stop of fixture.scenario.stops)await expect(page.getByRole('img',{name:'等距城市配送空间场景'})).toContainText(stop.name);
 await go(page,'执行与调整');await expect(page.getByRole('button',{name:'开始执行演示',exact:true})).toBeDisabled();
 await confirm(page);await expect(page.locator('.p-result-version')).toContainText('已确认配送计划');
 const scene=await page.locator('.p-packing-layout').boundingBox();
 const controls=await page.locator('.p-playback').boundingBox();
 expect(scene!.y+scene!.height).toBeLessThanOrEqual(controls!.y);
 await page.getByRole('button',{name:'装车指导',exact:true}).click();
 await page.getByLabel('装卸播放速度').selectOption('4');
 await page.getByRole('button',{name:'播放',exact:true}).click();
 await expect(page.locator('.p-playback-title')).toContainText('装车完成',{timeout:20_000});
 await page.screenshot({path:info.outputPath('six-store-packing.png'),fullPage:true});
 await go(page,'执行与调整');await page.getByRole('button',{name:'开始执行演示',exact:true}).click();
 await expect(page.locator('.p-execution-lead h2')).toHaveText('全部车辆完成卸货演示',{timeout:30_000});
 const report=page.locator('[data-operation-plan]');
 await expect(report.locator('[data-loading-cargo]')).toHaveCount(fixture.scenario.cargo.length);
 await expect(report.locator('[data-unloading-cargo]')).toHaveCount(fixture.scenario.cargo.length);
 const loading=await report.locator('[data-loading-cargo]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-loading-cargo')));
 expect(loading).toEqual(result.result.routes.filter((r:any)=>r.active).flatMap((r:any)=>r.unloading.loadingSteps.map((s:any)=>s.cargoId)));
 const stops=await report.locator('[data-unloading-stop]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-unloading-stop')));
 expect(stops).toEqual(result.result.routes.filter((r:any)=>r.active).flatMap((r:any)=>r.stopOrder));
 const jsonDownload=page.waitForEvent('download');await page.getByRole('button',{name:'导出已确认计划 JSON',exact:true}).click();
 const jsonPath=info.outputPath('confirmed-plan.json');await (await jsonDownload).saveAs(jsonPath);
 const exported=JSON.parse(await readFile(jsonPath,'utf8'));
 expect(exported.identity.planId).toBe(result.planId);expect(exported.identity.scenarioFingerprint).toBe(result.scenarioFingerprint);
 expect(exported.calculation.result).toEqual(result.result);expect(exported.plan.totals).toEqual(result.result.totals);expect(exported.plan.assignments).toEqual(result.result.assignments);expect(exported.status.confirmed).toBe(true);
 const htmlDownload=page.waitForEvent('download');await page.getByRole('button',{name:'导出可打印作业单',exact:true}).click();
 const htmlPath=info.outputPath('operation-plan.html');await (await htmlDownload).saveAs(htmlPath);
 const printable=await page.context().newPage();await printable.setContent(await readFile(htmlPath,'utf8'));
 await expect(printable.locator('[data-loading-cargo]')).toHaveCount(12);await expect(printable.locator('[data-unloading-stop]')).toHaveCount(6);
 await expect(printable.locator('body')).toContainText(result.scenarioFingerprint);
 await printable.pdf({path:info.outputPath('operation-plan.pdf'),format:'A4',printBackground:true});await printable.close();
 await go(page,'优化效果');await expect(page.locator('[data-current-effects]')).toHaveAttribute('data-current-effects',result.planId);
 await expect(page.locator('.p-effects-lead')).toContainText('已确认');
 await expect(page.locator('.p-standard-current-grid')).toContainText('194.8');await expect(page.locator('.p-standard-current-grid')).toContainText('09:08');
 await expect(page.locator('.p-standard-current-grid')).toContainText('6 家');
 await expect(page.locator('.p-standard-current-grid')).toContainText('12 件');
 await page.screenshot({path:info.outputPath('six-store-effects.png'),fullPage:true});
 expect(errors).toEqual([]);
 await writeFile(info.outputPath('business-result.json'),JSON.stringify({planId:result.planId,fingerprint:result.scenarioFingerprint,totals:result.result.totals,returnTime:'09:08'},null,2));
});

test('车辆、出发与时间窗修改撤销确认；规划失败与显式恢复原条件',async({page})=>{
 const original=await importAndPlan(page);await confirm(page);
 for(const change of ['vehicle','departure','window']){
  await page.getByRole('button',{name:'改变条件',exact:true}).click();
  if(change==='vehicle')await page.locator('.p-standard-vehicles input').first().uncheck();
  if(change==='departure')await page.getByLabel('标准场景出发时间').fill('08:30');
  if(change==='window')await page.locator('.p-standard-stop-windows input').first().fill('08:01');
  await page.getByRole('button',{name:'关闭标准场景调整面板'}).click();
  await go(page,'执行与调整');await expect(page.getByRole('button',{name:'开始执行演示',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'导出可打印作业单',exact:true})).toBeDisabled();
  await go(page,'优化效果');await expect(page.locator('.p-effects-lead')).toContainText('条件已变化');
  await go(page,'执行与调整');await page.getByRole('button',{name:'恢复旧计划及原始条件',exact:true}).click();
  await expect(page.getByRole('button',{name:'开始执行演示',exact:true})).toBeEnabled();await go(page,'三维配载');
 }
 await page.getByRole('button',{name:'改变条件',exact:true}).click();
 await page.getByLabel('标准场景出发时间').fill('12:00');
 const response=page.waitForResponse(r=>r.url().endsWith('/plan-scene'));
 await page.getByRole('button',{name:'提交条件并重新规划',exact:true}).click();
 const failed=await (await response).json();expect(failed.executable).toBe(false);
 await go(page,'执行与调整');await expect(page.getByRole('button',{name:'开始执行演示',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'导出可打印作业单',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'恢复旧计划及原始条件',exact:true}).click();
 await expect(page.locator('.city-product')).toHaveAttribute('data-plan',original.planId);
 await expect(page.getByRole('button',{name:'开始执行演示',exact:true})).toBeEnabled();
 await go(page,'三维配载');await page.getByRole('button',{name:'改变条件',exact:true}).click();
 await expect(page.getByLabel('标准场景出发时间')).toHaveValue('08:00');
 await page.getByLabel('标准场景出发时间').fill('08:15');
 const replannedResponse=page.waitForResponse(r=>r.url().endsWith('/plan-scene'));
 await page.getByRole('button',{name:'提交条件并重新规划',exact:true}).click();
 const replanned=await (await replannedResponse).json();expect(replanned.executable).toBe(true);
 expect(replanned.scenarioFingerprint).not.toBe(original.scenarioFingerprint);
 await go(page,'执行与调整');await expect(page.getByRole('button',{name:'开始执行演示',exact:true})).toBeDisabled();
 await confirm(page);await go(page,'优化效果');
 await expect(page.locator('[data-current-effects]')).toHaveAttribute('data-current-effects',replanned.planId);
 await expect(page.locator('.p-standard-current-grid')).toContainText('09:23');
 await expect(page.locator('.p-effects-lead')).toContainText('已确认');
});

test('四店阻挡、实际修订与九店历史方案隔离',async({page})=>{
 await page.goto('/frontend/city-delivery/dispatch');await page.getByRole('button',{name:'四店单车',exact:true}).click();
 await expect(page.locator('.p-causal-verdict')).toContainText('12 km · ¥222');await expect(page.locator('.p-causal-verdict')).toContainText('首站卸货受阻');
 await page.getByRole('button',{name:/基础配送 · 卸货受阻/}).click();
 await page.getByRole('button',{name:/可执行调整方案/}).click();await expect(page.locator('.p-causal-verdict')).toContainText('16 km · ¥236');
 await page.getByRole('button',{name:'调整访问顺序',exact:true}).click();
 await page.getByLabel('S01上移').click();
 const response=page.waitForResponse(r=>r.url().endsWith('/revise-order'));
 await page.getByRole('button',{name:'提交并尝试修订',exact:true}).click();expect((await (await response).json()).executionMode).toBe('computed-per-request');
 await expect(page.getByRole('button',{name:'确认采用修订方案',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'确认采用修订方案',exact:true}).click();
 await page.getByRole('button',{name:'九店多车',exact:true}).click();await go(page,'优化效果');
 await expect(page.locator('.p-comparison')).toContainText('450.4');await expect(page.locator('.p-effects-lead')).toContainText('九店36件');
 await go(page,'智能调度');await page.getByRole('button',{name:/两车候选方案/}).click();
 await expect(page.locator('.p-map-bottom')).toContainText('38 km');await expect(page.locator('.p-map-bottom')).toContainText('450.4');
 await go(page,'执行与调整');await expect(page.getByRole('button',{name:'开始执行演示',exact:true})).toBeEnabled();
});

test('SKU 数量按声明规格生成整箱与拆零，替换当前任务后重新确认',async({page})=>{
 await importAndPlan(page);await confirm(page);await go(page,'订单与货物');
 await page.getByRole('button',{name:'按包装规格准备批次',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'按包装规格准备配送批次'});
 await dialog.getByLabel('数量',{exact:true}).fill('1.5');
 await dialog.getByRole('button',{name:'生成包装件并开始规划'}).click();
 await expect(dialog.locator('.p-error')).toContainText('正整数');
 await dialog.getByLabel('数量',{exact:true}).fill('12');
 const response=page.waitForResponse(r=>r.url().endsWith('/plan-scene'));
 await dialog.getByRole('button',{name:'生成包装件并开始规划'}).click();
 const planned=await (await response).json();expect(planned.executable).toBe(true);
 expect(planned.scenario.cargo.map((c:any)=>c.cargoId)).toEqual(['SKU-001-S01-CASE-1','SKU-001-S01-EACH-1','SKU-001-S01-EACH-2']);
 await expect(dialog).toHaveCount(0);await go(page,'执行与调整');
 await expect(page.getByRole('button',{name:'开始执行演示',exact:true})).toBeDisabled();
 await confirm(page);await go(page,'执行与调整');await expect(page.locator('[data-loading-cargo]')).toHaveCount(3);
});
