import { createContext, useContext, useEffect, useReducer, useState, type Dispatch, type ReactNode } from 'react';
import { z } from 'zod';
import { initialState, solutions } from './fixtures';
import { orderSchema } from './form-schema';
import { workflowReducer } from './workflow-reducer';
import type { Action, LogisticsState } from './types';
export const STORAGE_KEY = 'logistics.synthetic.v1';
const savedSchema = z.object({version:z.literal(1),order:orderSchema,rawText:z.string().max(500),parsed:z.boolean(),confirmed:z.boolean(),selectedCarrier:z.string(),selectedSolution:z.string(),negotiated:z.boolean(),submitted:z.boolean(),running:z.boolean(),ticks:z.number().int().nonnegative(),messages:z.array(z.object({id:z.string(),author:z.string(),text:z.string(),time:z.string(),kind:z.enum(['platform','carrier','user'])})).max(100)});
function load():LogisticsState {
 try { const saved=savedSchema.safeParse(JSON.parse(localStorage.getItem(STORAGE_KEY)??'null')); if(saved.success&&solutions.some(s=>s.id===saved.data.selectedSolution))return {...saved.data,running:false}; } catch { /* Storage may be unavailable; the demo remains usable in memory. */ }
 return structuredClone(initialState);
}
const Context=createContext<{state:LogisticsState;dispatch:Dispatch<Action>;notice:string;notify:(message:string)=>void}|null>(null);
export function LogisticsProvider({children}:{children:ReactNode}) {
 const [state,dispatch]=useReducer(workflowReducer,undefined,load);
 const [notice,notify]=useState('');
 useEffect(()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch{notify('浏览器未允许本地保存；当前演示仍可使用，刷新后可能重置。');}},[state]);
 useEffect(()=>{if(!state.running)return;const timer=window.setInterval(()=>{if(!document.hidden)dispatch({type:'tick'});},2500);return()=>window.clearInterval(timer);},[state.running]);
 useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>notify(''),7000);return()=>window.clearTimeout(timer);},[notice]);
 return <Context.Provider value={{state,dispatch,notice,notify}}>{children}</Context.Provider>;
}
export function useLogistics(){const value=useContext(Context);if(!value)throw new Error('LogisticsProvider required');return value;}
