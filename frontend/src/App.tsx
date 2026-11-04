import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Button, Result } from 'antd';
import { useAuth } from './auth/AuthProvider';
import { AppLayout } from './layout/AppLayout';
import { LoadingScreen } from './components/Common';
import { LoginPage } from './pages/LoginPage';
import { ForbiddenPage, NotFoundPage } from './pages/ResultPages';
import { errorMessage } from './lib/format';
import type { Role } from './lib/api';
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
const InventoryPage = lazy(() => import('./pages/InventoryPage'));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage'));
const MovementPage = lazy(() => import('./pages/MovementPage'));
const ScanPointsPage = lazy(() => import('./pages/ScanPointsPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));

function ProtectedRoute({ roles }: { roles?: Role[] }) {
  const { user, ready, error, refresh } = useAuth();
  const location = useLocation();
  if (!ready) return <LoadingScreen />;
  if (error) return <Result status="warning" title="Chưa kết nối được phiên đăng nhập" subTitle={errorMessage(error)} extra={<Button onClick={() => { void refresh(); }}>Thử lại</Button>} />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (roles && !roles.includes(user.role)) return <ForbiddenPage />;
  return <Outlet />;
}
export default function Application() {
  return <Suspense fallback={<LoadingScreen />}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedRoute />}><Route element={<AppLayout />}>
      <Route index element={<DashboardPage />} />
      <Route path="products" element={<ProductsPage />} />
      <Route path="inventory" element={<InventoryPage />} />
      <Route path="transactions" element={<TransactionsPage />} />
      <Route path="scan-points" element={<ScanPointsPage />} />
      <Route element={<ProtectedRoute roles={['ADMIN','KEEPER','STAFF']} />}><Route path="stock-movement" element={<MovementPage />} /></Route>
      <Route element={<ProtectedRoute roles={['ADMIN']} />}><Route path="users" element={<UsersPage />} /></Route>
      <Route path="403" element={<ForbiddenPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Route></Route>
  </Routes></Suspense>;
}
