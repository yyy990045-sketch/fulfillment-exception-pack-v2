// Existing UI only. No application files, backend service, or scenario writes.
const task=await taskSpace(6),page=task.page('p1');
const fs=await import('node:fs/promises');
const root='/Users/xieweikai/Projects/company-ai-platform/fulfillment-exception-pack/artifacts/judge-evidence/';
const observations=[];
async function observe(name){
 const state=await page.evaluate(()=>({url:location.href,scenario:document.querySelector('.city-product')?.getAttribute('data-scenario'),
  plan:document.querySelector('.city-product')?.getAttribute('data-plan'),vehicle:document.querySelector('.city-product')?.getAttribute('data-vehicle'),
  version:document.querySelector('.p-result-version')?.innerText,feedback:document.querySelector('.p-feedback')?.innerText,
  service:document.querySelector('.p-service-offline')?.innerText,
  executionButton:[...document.querySelectorAll('.p-execution-lead button')].map(b=>({label:b.textContent,disabled:b.disabled})),
  calls:window.__judgeCalls??[],remaining:document.querySelector('[data-testid=product-remaining]')?.textContent,
  error:document.querySelector('.p-error')?.textContent, unexpectedError:document.body.innerText.includes('Unexpected Application Error')}));
 observations.push({name,...state});console.log(JSON.stringify({name,...state,calls:state.calls.map(c=>({url:c.url,body:c.body,status:c.status}))}));
 await fs.writeFile(root+'browser-observations.json',JSON.stringify({time:new Date().toISOString(),scope:'ephemeral browser state; offline simulated in page, not actual server shutdown',observations},null,2)+'\n');
}
await page.goto('http://127.0.0.1:8111/frontend/city-delivery/dispatch');
await page.waitForFunction(()=>!document.querySelector('.p-dispatch-actions button.p-primary').disabled);
await page.evaluate(()=>{
 const original=window.fetch.bind(window);
 window.__judgeCalls=[];
 window.fetch=async(...args)=>{
  const url=String(args[0]);
  if(!url.includes('revise-'))return original(...args);
  const call={url,body:JSON.parse(args[1]?.body||'{}')};window.__judgeCalls.push(call);
  const response=await original(...args);call.status=response.status;
  const payload=await response.clone().json();call.executable=payload.executable;call.mode=payload.executionMode;return response;
 };
});
await page.click('loc=css:.p-plan-options button:nth-child(2)');await observe('saved-plan-switch-no-compute');
await page.click('loc=role:button[name=模拟装载冲突]');await page.waitForSelector('.p-feedback.is-conflict');await observe('fleet-wrong-width');
await page.click('loc=role:button[name=允许重新分配]');await page.waitForFunction(()=>document.body.innerText.includes('修订已校验，等待确认采用'));await observe('candidate-pending-confirmation');
await page.click('loc=css:.p-sidebar nav a[href$=execution]');await observe('candidate-execution-disabled');
await page.click('loc=role:button[name=确认采用修订方案]');await observe('candidate-explicitly-confirmed');
await page.click('loc=css:.p-sidebar nav a[href$=dispatch]');await page.waitForSelector('canvas[data-ready=true]');
for(const name of ['overview','orders','dispatch','packing','execution','effects']){
 await page.click('loc=css:.p-sidebar nav a[href$='+name+']');await observe('six-pages-'+name);
}
await page.click('loc=css:.p-sidebar nav a[href$=packing]');await page.click('loc=css:.p-scenario-switch button:nth-child(2)');
await page.click('loc=css:.p-plan-options button:nth-child(2)');await page.click('loc=css:.p-packing-top button.p-primary');
await page.click('loc=css:button[aria-label=S01上移]');await page.click('loc=role:button[name=提交并尝试修订]');
await page.waitForFunction(()=>document.body.innerText.includes('修订已校验，等待确认采用'));await observe('order-live-repair');
await page.click('loc=role:button[name=确认采用修订方案]');await page.waitForSelector('canvas[data-ready=true]');
await page.click('loc=css:.p-packing-top button.p-primary');await page.click('loc=css:input[aria-label=出发时间]');
await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type('09:00');
await page.click('loc=role:button[name=提交并尝试修订]');await page.waitForSelector('.p-feedback.is-conflict');await observe('late-departure-infeasible');
await page.click('loc=role:button[name=保留原计划]');await observe('failure-preserves-confirmed');
// Reversible page-local offline simulation, not a real process shutdown.
await page.evaluate(()=>{const original=window.fetch;window.fetch=(...args)=>String(args[0]).includes('8112/health')?Promise.reject(new TypeError('controlled offline audit')):original(...args);});
await page.waitForSelector('.p-service-offline',{timeout:10000});await observe('page-local-service-offline-simulation');
observations.push({name:'offline-controls',state:await page.evaluate(()=>({adjustDisabled:document.querySelector('.p-packing-top button.p-primary').disabled,
 playDisabled:document.querySelector('.p-playback-controls button.p-primary').disabled}))});
await fs.writeFile(root+'browser-observations.json',JSON.stringify({time:new Date().toISOString(),scope:'ephemeral browser state only; health failure is simulated in page, not real server shutdown',observations},null,2)+'\n');
await page.goto('http://127.0.0.1:8111/frontend/city-delivery/dispatch');
await task.finish({keep:[]});
