import { useState } from 'react';
import { Avatar, Breadcrumb, Button, Drawer, Dropdown, Layout, Menu, Space, Tooltip } from 'antd';
import { AppstoreOutlined, ArrowRightOutlined, HomeOutlined, DatabaseOutlined, DownOutlined,
  EnvironmentOutlined, HistoryOutlined, LogoutOutlined, MenuUnfoldOutlined, ReloadOutlined,
  ScanOutlined, TeamOutlined } from '@ant-design/icons';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useMutation } from '../hooks/useResource';
import { roleLabels } from '../lib/format';
import { errorMessage } from '../lib/format';
import { useAssignedScanPoints } from '../hooks/useAssignedScanPoints';
import { AssignedScanPointsProvider } from '../components/AssignedScanPointsProvider';

export function AppLayout() {
  return <AssignedScanPointsProvider><AppLayoutContent /></AssignedScanPointsProvider>;
}

function AppLayoutContent() {
  const { user, logout } = useAuth();
  const assignment = useAssignedScanPoints();
  const ambiguous = assignment.staff && assignment.points.length > 1;
  const pointLabel = assignment.loading ? 'Đang tải điểm quét…' : assignment.error ? 'Chưa tải được điểm quét'
    : ambiguous ? 'Phân công chưa hợp lệ' : assignment.points.length ? assignment.points.map(point => point.scan_point_id).join(', ') : 'Chưa gán điểm quét';
  const pointTooltip = assignment.error ? errorMessage(assignment.error) : ambiguous ? 'Tài khoản STAFF có nhiều điểm quét active. Liên hệ ADMIN để xử lý.'
    : assignment.points.length ? <div>{assignment.points.map(point => <div key={point.scan_point_id}>{point.scan_point_id} — {point.point_name}</div>)}</div>
      : assignment.loading ? 'Đang tải điểm quét được cấp từ backend.' : 'Tài khoản chưa được cấp điểm quét đang hoạt động.';
  const location = useLocation(), navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const mutation = useMutation();
  const menu = [
    { key: '/', icon: <HomeOutlined />, label: 'Trang chủ' },
    { key: '/products', icon: <AppstoreOutlined />, label: 'Sản phẩm & đơn vị' },
    { key: '/inventory', icon: <DatabaseOutlined />, label: 'Tồn kho' },
    { key: '/transactions', icon: <HistoryOutlined />, label: 'Lịch sử giao dịch' },
    ...(user?.role === 'ADMIN' || user?.role === 'STAFF' ? [{ key: '/stock-movement', icon: <ScanOutlined />, label: 'Quản lý nhập/xuất kho' }] : []),
    ...(user?.role === 'ADMIN' ? [{ key: '/scan-points', icon: <EnvironmentOutlined />, label: 'Quản lý điểm quét' }] : []),
    ...(user?.role === 'ADMIN' ? [{ key: '/users', icon: <TeamOutlined />, label: 'Quản lý người dùng' }] : []),
  ];
  const selected = menu.find(item => item.key === '/' ? location.pathname === '/' : location.pathname.startsWith(item.key));
  const navigation = <div className="sidebar-inner">
    <Link to="/" className="brand" onClick={() => setDrawer(false)} aria-label="Smart Warehouse — Trang chủ">
      <span className="brand-icon"><DatabaseOutlined /></span><span className="brand-copy">SMART<span className="brand-light">WAREHOUSE</span></span>
    </Link>
    <Menu theme="light" mode="inline" selectedKeys={selected ? [selected.key] : []} items={menu}
      onClick={({ key }) => { navigate(key); setDrawer(false); }} />
  </div>;
  return <Layout className="app-shell">
    <a href="#main-content" className="skip-link">Đến nội dung chính</a>
    <Layout.Sider width={248} className="desktop-sidebar" theme="light">{navigation}</Layout.Sider>
    <Drawer open={drawer} onClose={() => setDrawer(false)} placement="left" size={280} className="mobile-nav" styles={{ body: { padding: 0 } }} title="Điều hướng">{navigation}</Drawer>
    <Layout className="workspace-layout"><header className="topbar">
      <div className="topbar-left"><Button className="mobile-menu-button" type="text" icon={<MenuUnfoldOutlined />} aria-label="Mở menu" onClick={() => setDrawer(true)} />
        <Breadcrumb items={selected?.key === '/' ? [{ title: 'Trang chủ' }] : [
          { title: <Link to="/"><HomeOutlined /> Trang chủ</Link> }, { title: selected?.label ?? 'Hệ thống' },
        ]} />
      </div>
      <Space className="topbar-right" size={20}>
        <Tooltip title={pointTooltip}>
          <span className="station-status" role="status" aria-live="polite" aria-busy={assignment.loading} aria-label={`Điểm quét được phân công: ${pointLabel}`}>
            <EnvironmentOutlined aria-hidden="true" />
            <span className="station-status-copy"><small>{assignment.points.length > 1 && !ambiguous ? 'Điểm quét được cấp' : 'Điểm quét'}</small><strong>{pointLabel}</strong></span>
            {!!assignment.error && <Button type="text" size="small" icon={<ReloadOutlined />} aria-label="Tải lại điểm quét được phân công" onClick={assignment.reload} />}
          </span>
        </Tooltip>
        <Dropdown trigger={['click']} menu={{ items: [
          { key: 'identity', label: <span className="account-menu-identity"><strong>{user?.display_name}</strong><small>{user && roleLabels[user.role]}</small></span>, disabled: true },
          { type: 'divider' },
          { key: 'logout', label: 'Đăng xuất', icon: <LogoutOutlined />, disabled: mutation.busy },
        ], onClick: ({ key }) => { if (key === 'logout') void mutation.run(logout, 'Đã đăng xuất.', () => navigate('/login')); } }}>
          <Button type="text" className="profile-button" aria-label="Menu tài khoản"><Avatar className="user-avatar">{user?.display_name.slice(0,1).toUpperCase()}</Avatar><span className="profile-copy"><strong>{user?.display_name}</strong><small>{user && roleLabels[user.role]}</small></span><DownOutlined /></Button>
        </Dropdown>
      </Space>
    </header>
      <main id="main-content" className="main-content" tabIndex={-1}><Outlet /></main>
      <footer className="app-footer"><span>Smart Warehouse</span><span>Quản lý kho văn phòng phẩm</span><Link to="/transactions">Lịch sử hoạt động <ArrowRightOutlined /></Link></footer>
    </Layout>
  </Layout>;
}
