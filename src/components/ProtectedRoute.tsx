import { Navigate } from 'react-router-dom';
import { useStore } from '../store/useStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireApproved?: boolean; // true: approved 회원만 접근
}

export default function ProtectedRoute({
  children,
  requireApproved = false,
}: ProtectedRouteProps) {
  const { isAuthenticated, isAdmin, currentUser } = useStore();

  // 미로그인
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // 관리자는 모든 제한 없음
  if (isAdmin) {
    return <>{children}</>;
  }

  // approved 필요한데 pending/rejected인 경우
  if (requireApproved && currentUser?.status !== 'approved') {
    return <Navigate to="/pending" replace />;
  }

  return <>{children}</>;
}
