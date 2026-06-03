import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { AuthModalProvider } from './context/AuthModalContext';
import AuthModal from './components/auth/AuthModal';
import Spinner from './components/ui/Spinner';

// User pages
const AccountPage = lazy(() => import('./pages/AccountPage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const FAQPage = lazy(() => import('./pages/FAQPage'));
const CommunityPage = lazy(() => import('./pages/CommunityPage'));
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage'));
const SavedKnowledgePage = lazy(() => import('./pages/SavedKnowledgePage'));

// Admin pages
const AdminLogin = lazy(() => import('./admin/pages/AdminLogin'));
const AdminDashboard = lazy(() => import('./admin/pages/AdminDashboard'));
const AdminFAQs = lazy(() => import('./admin/pages/AdminFAQs'));
const AdminUsers = lazy(() => import('./admin/pages/AdminUsers'));
const AdminSettings = lazy(() => import('./admin/pages/AdminSettings'));
const AdminCommunity = lazy(() => import('./admin/pages/AdminCommunity'));
const AdminModeration = lazy(() => import('./admin/pages/AdminModeration'));
const AdminLeaderboard = lazy(() => import('./admin/pages/AdminLeaderboard'));
const AdminUnresolvedSearch = lazy(() => import('./admin/pages/AdminUnresolvedSearch'));
const AdminZoomMeetings = lazy(() => import('./admin/pages/AdminZoomMeetings'));
const AdminZoomInsights = lazy(() => import('./admin/pages/AdminZoomInsights'));
const AdminAISettings = lazy(() => import('./admin/pages/AdminAISettings'));
const FaqReview = lazy(() => import('./admin/pages/FaqReview'));
const AdminLayout = lazy(() => import('./admin/components/layout/AdminLayout'));

interface AccountRouteProps {
  children: React.ReactNode;
}

// Account/settings is the only member-only page now — it's a logged-in
// user's own profile. Anonymous visitors get bounced to home (where the
// auth modal is mounted and they can sign in).
function AccountRoute({ children }: AccountRouteProps) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }
  return isAuthenticated ? <>{children}</> : <Navigate to="/" replace />;
}

interface AdminRouteProps {
  children: React.ReactNode;
}

function AdminRoute({ children }: AdminRouteProps) {
  const { user, isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  return isAuthenticated && (user?.role === 'admin' || user?.role === 'moderator')
    ? children
    : <Navigate to="/" replace />;
}

// Component defining all available URLs in the app.
// All "content" routes (home, faq, community, leaderboard) are now public —
// read access is universal, write actions open the auth modal in place.
function AppRoutes() {
  const { loading } = useAuth();

  // Prevent route flashing by waiting for the initial auth check to finish
  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <Routes>
      {/* Public content routes — anonymous users can browse freely */}
      <Route path="/" element={<HomePage />} />
      <Route path="/faq" element={<FAQPage />} />
      <Route path="/faq/:id" element={<FAQPage />} />
      <Route path="/community" element={<CommunityPage />} />
      <Route path="/leaderboard" element={<LeaderboardPage />} />
      <Route path="/saved" element={<SavedKnowledgePage />} />

      {/* Member-only: a user's own settings */}
      <Route
        path="/account"
        element={
          <AccountRoute>
            <AccountPage />
          </AccountRoute>
        }
      />

      {/* Admin Panel dedicated routes (guarded by AdminRoute) */}
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin" element={<AdminRoute><AdminLayout><AdminDashboard /></AdminLayout></AdminRoute>} />
      <Route path="/admin/faqs" element={<AdminRoute><AdminLayout><AdminFAQs /></AdminLayout></AdminRoute>} />
      <Route path="/admin/users" element={<AdminRoute><AdminLayout><AdminUsers /></AdminLayout></AdminRoute>} />
      <Route path="/admin/settings" element={<AdminRoute><AdminLayout><AdminSettings /></AdminLayout></AdminRoute>} />
      <Route path="/admin/community" element={<AdminRoute><AdminLayout><AdminCommunity /></AdminLayout></AdminRoute>} />
      <Route path="/admin/moderation" element={<AdminRoute><AdminLayout><AdminModeration /></AdminLayout></AdminRoute>} />
      <Route path="/admin/leaderboard" element={<AdminRoute><AdminLayout><AdminLeaderboard /></AdminLayout></AdminRoute>} />
      <Route path="/admin/unresolved-search" element={<AdminRoute><AdminLayout><AdminUnresolvedSearch /></AdminLayout></AdminRoute>} />
      <Route path="/admin/zoom-meetings" element={<AdminRoute><AdminLayout><AdminZoomMeetings /></AdminLayout></AdminRoute>} />
      <Route path="/admin/zoom-insights" element={<AdminRoute><AdminLayout><AdminZoomInsights /></AdminLayout></AdminRoute>} />
      <Route path="/admin/settings/ai" element={<AdminRoute><AdminLayout><AdminAISettings /></AdminLayout></AdminRoute>} />
      <Route path="/admin/faqs/review" element={<AdminRoute><AdminLayout><FaqReview /></AdminLayout></AdminRoute>} />

      {/* Catch-all fallback: redirect any unknown URL to home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// Inner wrapper that subscribes to isAuthenticated so the AuthModalProvider
// can detect the false→true flip and replay any pending gated action.
function AuthModalHost({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  return (
    <AuthModalProvider isAuthenticated={isAuthenticated}>
      {children}
      <AuthModal />
    </AuthModalProvider>
  );
}

// The absolute root of the React tree
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AuthModalHost>
          <Suspense fallback={<div className="min-h-screen bg-bg flex items-center justify-center"><Spinner size="md" /></div>}>
            <AppRoutes />
          </Suspense>
        </AuthModalHost>
      </AuthProvider>
    </BrowserRouter>
  );
}
