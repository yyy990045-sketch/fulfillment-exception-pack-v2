import type { CSSProperties, ReactNode } from 'react';
import { ArrowRight, Box, CalendarClock, CircleCheck, MapPin, Network, ShieldCheck, Truck, Wallet, Weight, Zap, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { money } from '../fixtures';
import type { Order, Solution } from '../types';

export function Panel({title,subtitle,icon:Icon=Network,actions,children,className,bodyClassName,id,style}:{title?:ReactNode;subtitle?:string;icon?:LucideIcon;actions?:ReactNode;children:ReactNode;className?:string;bodyClassName?:string;id?:string;style?:CSSProperties}) {
 return <Card className={cn('lg-panel',className)} id={id} style={style}>{title&&<CardHeader className="lg-panel-header"><div className="lg-section-heading"><span className="lg-icon-tile"><Icon size={18}/></span><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div></div>{actions}</CardHeader>}<CardContent className={cn('lg-panel-body',bodyClassName)}>{children}</CardContent></Card>;
}
export function ActionButton({className,...props}:ButtonProps){return <Button className={cn('lg-button',className)} {...props}/>;}
export function IconButton({label,children,...props}:ButtonProps&{label:string}){return <Tooltip><TooltipTrigger asChild><ActionButton variant="outline" size="icon" aria-label={label} {...props}>{children}</ActionButton></TooltipTrigger><TooltipContent className="logistics-theme">{label}</TooltipContent></Tooltip>;}
export function Status({children,tone='blue'}:{children:ReactNode;tone?:'blue'|'green'|'red'|'amber'|'purple'|'muted'}){return <Badge className={`lg-status lg-status-${tone}`}>{children}</Badge>;}
export function Letter({id,color}:{id:string;color?:string}){return <span className="lg-letter" style={color?{background:color}:undefined}>{id}</span>;}
export function FilterTabs({value,onChange,items,label}:{value:string;onChange:(value:string)=>void;items:{value:string;label:string}[];label:string}){return <Tabs value={value} onValueChange={onChange} className="lg-tabs"><TabsList aria-label={label}>{items.map(item=><TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>)}</TabsList></Tabs>;}
export function Metric({label,value,icon:Icon=Box,hint,tone='blue'}:{label:string;value:ReactNode;icon?:LucideIcon;hint?:ReactNode;tone?:string}){return <Card className={`lg-metric lg-metric-${tone}`}><Icon size={20}/><dl><dt>{label}</dt><dd>{value}</dd>{hint&&<small>{hint}</small>}</dl></Card>;}
export function OrderSummary({order,compact=false,children}:{order:Order;compact?:boolean;children?:ReactNode}) {
 const items:[string,ReactNode,LucideIcon][]=[['起点',order.origin,MapPin],['终点',order.destination,MapPin],['货物重量',`${order.weight} 吨`,Weight],['货物类型',order.cargo,Box],['装车时间',order.loadAt.slice(5).replace('T',' '),CalendarClock],['送达时间',order.deliverAt.slice(5).replace('T',' '),CalendarClock],['中转上限',`${order.maxTransfers} 次`,ArrowRight],['时效等级',order.urgent?'加急':'标准',Zap],['承运资质',order.qualification,ShieldCheck],['预算上限',money(order.budget),Wallet]];
 return <div className={cn('lg-summary',compact&&'lg-summary-compact')}>{items.map(([label,value,icon])=><Metric key={label} label={label} value={value} icon={icon}/>)}{children}</div>;
}
export function RouteTimeline({solution}:{solution:Solution}) {return <ol className="lg-route-timeline" style={{'--route-color':solution.color} as CSSProperties}>{solution.nodes.map((city,index)=><li key={city}><span className="lg-route-point">{index===solution.nodes.length-1?<CircleCheck size={16}/>:index+1}</span><strong>{city}</strong>{index<solution.nodes.length-1&&<small><Truck size={13}/>{solution.distances[index]} km</small>}<span>{index===0?'起点':index===solution.nodes.length-1?'终点':'中转'}</span></li>)}</ol>;}
export function SolutionMetrics({solution}:{solution:Solution}) {return <dl className="lg-solution-metrics">{[[money(solution.cost),'预计总成本'],[`${solution.hours} 小时`,'预计时效'],[`${solution.sla}%`,'SLA 预期'],[`${solution.nodes.length-2} 次`,'中转次数']].map(([value,label])=><div key={label}><dd>{value}</dd><dt>{label}</dt></div>)}</dl>;}
export function NextLink({to,children}:{to:string;children:ReactNode}){return <ActionButton asChild><Link to={`/frontend/${to}`}>{children}<ArrowRight size={16}/></Link></ActionButton>;}
export function EmptyState({children}:{children:ReactNode}){return <div className="lg-empty" role="status">{children}</div>;}
