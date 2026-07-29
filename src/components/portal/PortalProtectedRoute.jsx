import { Navigate, Outlet } from 'react-router-dom';
import { getPortalSession } from '@/lib/portalAuth';

export default function PortalProtectedRoute({ orgType }) {
  const session = getPortalSession();

  if (!session) {
    return <Navigate to="/portal/login" replace />;
  }
  if (orgType && session.orgType !== orgType) {
    return <Navigate to="/portal/login" replace />;
  }

  return <Outlet />;
}
