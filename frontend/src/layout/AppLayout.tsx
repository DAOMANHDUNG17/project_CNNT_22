import { useCallback, useState } from 'react';
import { Avatar, Badge, Button, Drawer, Dropdown, Layout, Menu, Space, Tag } from 'antd';
import { AppstoreOutlined, ArrowRightOutlined, BarChartOutlined, DashboardOutlined, DatabaseOutlined, DownOutlined,
  EnvironmentOutlined, HistoryOutlined, LogoutOutlined, MenuFoldOutlined, ScanOutlined, TeamOutlined } from '@ant-design/icons';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useMutation, useResource } from '../hooks/useResource';
import { api } from '../lib/api';
import { roleLabels } from '../lib/format';

export function AppLayout() {
  const { user, logout } = useAuth();
  const location = useLocation(), navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const mutation = useMutation();
  const health = useResource(useCallback(signal => api.health({ signal }), []));
  const menu = [
    { key: '/', icon: <DashboardOutlined />, label: 'Tổng quan' },
    { key: '/products', icon: <AppstoreOutlined />, label: 'Sản phẩm & đơn vị' },
    { key: '/inventory', icon: <DatabaseOutlined />, label: 'Tồn kho' },
    { key: '/transactions', icon: <HistoryOutlined />, label: 'Lịch sử giao dịch' },
    ...(user?.role !== 'VIEWER' ? [{ key: '/stock-movement', icon: <ScanOutlined />, label: 'Nhập / Xuất kho' }] : []),
    { key: '/scan-points', icon: <EnvironmentOutlined />, label: 'Điểm quét' },
    ...(user?.role === 'ADMIN' ? [{ key: '/users', icon: <TeamOutlined />, label: 'Người dùng' }] : []),
  ];
  const selected = menu.find(item => item.key === '/' ? location.pathname === '/' : location.pathname.startsWith(item.key))?.key;
  const navigation = <div className="sidebar-inner">
    <Link to="/" className="brand" onClick={() => setDrawer(false)}><span className="brand-icon"><DatabaseOutlined /></span><span>smart<span className="brand-light">warehouse</span><small>STATIONERY MANAGEMENT</small></span></Link>
    <div className="sidebar-section-label">KHÔNG GIAN LÀM VIỆC</div>
    <Menu theme="dark" mode="inline" selectedKeys={selected ? [selected] : []} items={menu}
      onClick={({ key }) => { navigate(key); setDrawer(false); }} />
    <div className="sidebar-bottom"><div className="sidebar-callout"><BarChartOutlined /><h3>Mọi chuyển động.<br />Một góc nhìn.</h3><p>Theo dõi văn phòng phẩm, từ lần nhập đầu tiên đến lần xuất cuối cùng.</p></div><span className="sidebar-version">SMART STATIONERY · v1.0</span></div>
  </div>;
  return <Layout className="app-shell">
    <Layout.Sider width={252} className="desktop-sidebar" theme="dark">{navigation}</Layout.Sider>
    <Drawer open={drawer} onClose={() => setDrawer(false)} placement="left" size={280} className="mobile-nav" styles={{ body: { padding: 0 } }} title="Điều hướng">{navigation}</Drawer>
    <Layout className="workspace-layout"><header className="topbar">
      <div className="topbar-left"><Button className="mobile-menu-button" type="text" icon={<MenuFoldOutlined />} aria-label="Mở menu" onClick={() => setDrawer(true)} /><span className="workspace-label">Không gian quản lý</span><span className="topbar-separator">/</span><strong>Kho văn phòng phẩm</strong></div>
      <Space size={18}><Tag className="connection-tag" color={health.error ? 'error' : health.loading ? 'default' : 'success'}><Badge status={health.error ? 'error' : health.loading ? 'default' : 'success'} /> {health.error ? 'Mất kết nối' : health.loading ? 'Đang kết nối' : 'Đã kết nối'}</Tag>
        <Dropdown trigger={['click']} menu={{ items: [{ key: 'logout', label: 'Đăng xuất', icon: <LogoutOutlined />, disabled: mutation.busy }],
          onClick: () => { void mutation.run(logout, 'Đã đăng xuất.', () => navigate('/login')); } }}>
          <Button type="text" className="profile-button"><Avatar style={{ background: '#e3efeb', color: '#17634f' }}>{user?.display_name.slice(0,1).toUpperCase()}</Avatar><span className="profile-copy"><strong>{user?.display_name}</strong><small>{user && roleLabels[user.role]}</small></span><DownOutlined /></Button>
        </Dropdown></Space>
    </header>
      <main className="main-content"><Outlet /></main>
      <footer className="app-footer"><span>Smart Stationery Warehouse</span><span><Badge status="processing" color="#21816b" /> Dữ liệu từ hệ thống kho</span><Link to="/transactions">Lịch sử hoạt động <ArrowRightOutlined /></Link></footer>
    </Layout>
  </Layout>;
}
