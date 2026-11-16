import type { ReactNode } from 'react';
import { AssignedScanPointsContext, useAssignedScanPointsResource } from '../hooks/useAssignedScanPoints';

export function AssignedScanPointsProvider({ children }: { children: ReactNode }) {
  const assignment = useAssignedScanPointsResource();
  return <AssignedScanPointsContext.Provider value={assignment}>{children}</AssignedScanPointsContext.Provider>;
}
