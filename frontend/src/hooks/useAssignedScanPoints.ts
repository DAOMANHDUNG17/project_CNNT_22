import { createContext, useCallback, useContext, useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { listMyScanPoints } from '../lib/scan-points-api';
import { useResource } from './useResource';

export const AssignedScanPointsContext = createContext<ReturnType<typeof useAssignedScanPointsResource> | null>(null);

export function useAssignedScanPoints() {
  const context = useContext(AssignedScanPointsContext);
  if (!context) throw new Error('Assigned scan points provider is required');
  return context;
}

export function useAssignedScanPointsResource() {
  const { user } = useAuth();
  const resource = useResource(useCallback(signal => listMyScanPoints({ signal }), [user?.user_id, user?.role]));
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') resource.reload(); };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); window.clearInterval(timer); };
  }, [resource.reload]);
  const points = resource.data?.data ?? [];
  const ready = !resource.loading && !resource.error && !!resource.data;
  const single = ready && points.length === 1 ? points[0] : undefined;
  return { ...resource, points, ready, single, staff: user?.role === 'STAFF' };
}
