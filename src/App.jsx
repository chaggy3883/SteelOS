import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';
import AppLayout from '@/components/layout/AppLayout';

// Auth pages
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';

// App pages
import Dashboard from '@/pages/Dashboard';
import Projects from '@/pages/Projects';
import ProjectNew from '@/pages/ProjectNew';
import ProjectDetail from '@/pages/ProjectDetail';
import Intelligence from '@/pages/Intelligence';
import Production from '@/pages/Production';
import Inventory from '@/pages/Inventory';
import Quality from '@/pages/Quality';
import Safety from '@/pages/Safety';
import Shipping from '@/pages/Shipping';
import RFIs from '@/pages/RFIs';
import Documents from '@/pages/Documents';
import CRM from '@/pages/CRM';
import Purchasing from '@/pages/Purchasing';
import Accounting from '@/pages/Accounting';
import Reports from '@/pages/Reports';
import Users from '@/pages/Users';
import Settings from '@/pages/Settings';
import Admin from '@/pages/Admin';
import Estimating from '@/pages/Estimating';
import BidNew from '@/pages/BidNew';
import BidDetail from '@/pages/BidDetail';
import EstimatingAnalytics from '@/pages/EstimatingAnalytics';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-steel-blue/20 border-t-steel-blue rounded-full animate-spin"></div>
          <p className="text-sm text-muted-foreground">Loading SteelOS...</p>
        </div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') return <UserNotRegisteredError />;
    if (authError.type === 'auth_required') { navigateToLogin(); return null; }
  }

  return (
    <Routes>
      {/* Public auth routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Protected app routes under AppLayout */}
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/new" element={<ProjectNew />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/estimating" element={<Estimating />} />
          <Route path="/estimating/new" element={<BidNew />} />
          <Route path="/estimating/:id" element={<BidDetail />} />
          <Route path="/estimating/analytics" element={<EstimatingAnalytics />} />
          <Route path="/intelligence" element={<Intelligence />} />
          <Route path="/production" element={<Production />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/quality" element={<Quality />} />
          <Route path="/safety" element={<Safety />} />
          <Route path="/shipping" element={<Shipping />} />
          <Route path="/rfis" element={<RFIs />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/crm" element={<CRM />} />
          <Route path="/purchasing" element={<Purchasing />} />
          <Route path="/accounting" element={<Accounting />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/users" element={<Users />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/admin" element={<Admin />} />
        </Route>
      </Route>

      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;