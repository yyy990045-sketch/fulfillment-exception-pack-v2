import { Navigate, redirect, type RouteObject } from 'react-router-dom';
import LogisticsShell from '../features/logistics/components/logistics-shell';
import OrderPage from '../features/logistics/pages/order';
import AnalysisPage from '../features/logistics/pages/analysis';
import CarriersPage from '../features/logistics/pages/carriers';
import NegotiationPage from '../features/logistics/pages/negotiation';
import SolutionsPage from '../features/logistics/pages/solutions';
import PlanPage from '../features/logistics/pages/plan';
import ExecutionPage from '../features/logistics/pages/execution';
import ExceptionsPage from '../features/logistics/pages/exceptions';
import ReplanPage from '../features/logistics/pages/replan';
import ResultsPage from '../features/logistics/pages/results';
import TwinPage from '../features/logistics/pages/twin';
export const logisticsRoute: RouteObject = {
  path: '/frontend',
  element: <LogisticsShell />,
  children: [
    { index: true, element: <Navigate to="/frontend/city-delivery" replace /> },
    { path: 'twin', element: <TwinPage /> },
    { path: 'order', element: <OrderPage /> },
    { path: 'analysis', element: <AnalysisPage /> },
    { path: 'carriers', element: <CarriersPage /> },
    { path: 'negotiation', element: <NegotiationPage /> },
    { path: 'solutions', element: <SolutionsPage /> },
    { path: 'plan', element: <PlanPage /> },
    { path: 'execution', element: <ExecutionPage /> },
    { path: 'exceptions', element: <ExceptionsPage /> },
    { path: 'replan', element: <ReplanPage /> },
    { path: 'results', element: <ResultsPage /> },
    // 未知地址（如手误输成 /frontend/carriers1）在渲染前就重定向，
    // 否则会先画出一层“页头正常、内容全黑”的空壳再跳转。
    { path: '*', loader: () => redirect('/frontend/order') },
  ],
};
