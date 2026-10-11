import { initialState, solutions, solutionIssues } from './fixtures';
import type { Action, LogisticsState } from './types';
export function workflowReducer(state:LogisticsState,action:Action):LogisticsState {
 switch(action.type) {
 case 'reset':return structuredClone(initialState);
 case 'raw':return {...state,rawText:action.value,parsed:false,confirmed:false,negotiated:false,submitted:false,running:false,ticks:0};
 case 'order':return {...state,order:action.order,rawText:action.rawText??state.rawText,parsed:action.parsed??true,confirmed:false,negotiated:false,submitted:false,running:false,ticks:0,messages:structuredClone(initialState.messages)};
 case 'confirm':return state.parsed?{...state,confirmed:true}:state;
 case 'carrier':return {...state,selectedCarrier:action.id};
 case 'solution':return solutions.some(s=>s.id===action.id)?{...state,selectedSolution:action.id,submitted:false,running:false,ticks:0}:state;
 case 'message':return {...state,messages:[...state.messages,action.message].slice(-100)};
 case 'negotiate':return state.parsed?{...state,negotiated:true}:state;
 case 'submit':{ const s=solutions.find(s=>s.id===state.selectedSolution);return state.parsed&&state.confirmed&&state.negotiated&&s&&!solutionIssues(s,state.order).length?{...state,submitted:true,running:true}:state; }
 case 'running':return {...state,running:state.submitted&&action.value};
 case 'tick':return state.running?{...state,ticks:state.ticks+1}:state;
 }
}
