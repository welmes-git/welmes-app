import { Navigate } from 'react-router-dom';
import { useStore } from '../store/useStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireApproved?: boolean;
}

export default function ProtectedRoute({
  children,
  requireApproved = false,
}: ProtectedRouteProps) {
  const { isAuthenticated, isAdmin, currentUser, authLoading } = useStore();

  // 세션 복원 대기 중 — 빈 화면으로 대기 (로그인 리다이렉트 방지)
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f8fa]">
        <div className="w-8 h-8 border-2 border-[#4a90e2] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (isAdmin) {
    return <>{children}</>;
  }

  if (requireApproved && currentUser?.status !== 'approved') {
    return <Navigate to="/pending" replace />;
  }

  return <>{children}</>;
}
