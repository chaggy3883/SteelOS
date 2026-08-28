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
import PortalProtectedRoute from '@/components/portal/PortalProtectedRoute';
import PortalLayout from '@/components/portal/PortalLayout';

// Auth pages
import Login from '@/pages/Login';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';

// App pages
import Dashboard from '@/pages/Dashboard';
import Projects from '@/pages/Projects';
import ProjectNew from '@/pages/ProjectNew';
import ProjectDetail from '@/pages/ProjectDetail';
import ProjectManagement from '@/pages/ProjectManagement';
import ChangeOrders from '@/pages/ChangeOrders';
import Subcontracts from '@/pages/Subcontracts';
import CertifiedPayroll from '@/pages/CertifiedPayroll';
import Intelligence from '@/pages/Intelligence';
import IntelligenceSignals from '@/pages/IntelligenceSignals';
import IntelligenceRulesAdmin from '@/pages/IntelligenceRulesAdmin';
import IntelligenceRuleDetail from '@/pages/IntelligenceRuleDetail';
import ServiceScheduleAdmin from '@/pages/ServiceScheduleAdmin';
import ServiceScheduleDetail from '@/pages/ServiceScheduleDetail';
import Production from '@/pages/Production';
import Inventory from '@/pages/Inventory';
import Quality from '@/pages/Quality';
import QualityKpiBuilder from '@/pages/QualityKpiBuilder';
import Safety from '@/pages/Safety';
import Shipping from '@/pages/Shipping';
import RFIs from '@/pages/RFIs';
import Documents from '@/pages/Documents';
import CRM from '@/pages/CRM';
import CrmDirectories from '@/pages/CrmDirectories';
import BlueprintTakeoff from '@/pages/BlueprintTakeoff';
import ShopEfficiency from '@/pages/ShopEfficiency';
import Purchasing from '@/pages/Purchasing';
import ProcurementModule from '@/pages/ProcurementModule';
import ReceivingKiosk from '@/pages/ReceivingKiosk';
import Accounting from '@/pages/Accounting';
import Legal from '@/pages/Legal';
import Reports from '@/pages/Reports';
import Users from '@/pages/Users';
import Settings from '@/pages/Settings';
import Admin from '@/pages/Admin';
import AuditTrail from '@/pages/AuditTrail';
import CostCodesAdmin from '@/pages/CostCodesAdmin';
import DeliveryPricingAdmin from '@/pages/DeliveryPricingAdmin';
import PtoPoliciesAdmin from '@/pages/PtoPoliciesAdmin';
import CommissionSetup from '@/pages/CommissionSetup';
import SalesmanRatesAdmin from '@/pages/SalesmanRatesAdmin';
import TmLaborRatesAdmin from '@/pages/TmLaborRatesAdmin';
import SalesDashboard from '@/pages/SalesDashboard';
import Estimating from '@/pages/Estimating';
import BidNew from '@/pages/BidNew';
import BidDetail from '@/pages/BidDetail';
import EstimatingAnalytics from '@/pages/EstimatingAnalytics';
import FrontEndReview from '@/pages/FrontEndReview';
import ShopFabrication from '@/pages/ShopFabrication';
import ShopOperations from '@/pages/ShopOperations';
import DetailerImports from '@/pages/DetailerImports';
import MaterialOptimization from '@/pages/MaterialOptimization';
import ShopFloorCommandCenter from '@/pages/ShopFloorCommandCenter';
import HumanResources from '@/pages/HumanResources';
import NewEmployee from '@/pages/NewEmployee';
import AdminEmployees from '@/pages/AdminEmployees';
import PayrollHours from '@/pages/PayrollHours';
import PayrollSetup from '@/pages/PayrollSetup';
import PayrollProcessing from '@/pages/PayrollProcessing';
import GarnishmentsReport from '@/pages/GarnishmentsReport';
import Retirement401kReport from '@/pages/Retirement401kReport';
import EmployeeCenter from '@/pages/EmployeeCenter';
import SuperAdminDashboard from '@/pages/SuperAdminDashboard';
import ExecutiveAnalytics from '@/pages/ExecutiveAnalytics';
import SystemIntegrations from '@/pages/SystemIntegrations';
import FieldOperations from '@/pages/FieldOperations';
import RiggingInspectionForm from '@/pages/RiggingInspectionForm';
import EquipmentServiceForm from '@/pages/EquipmentServiceForm';
import MeetingMode from '@/pages/MeetingMode';
import MeetingModeSession from '@/pages/MeetingModeSession';
import DocumentViewer from '@/pages/DocumentViewer';

// External Portal pages
import PortalLogin from '@/pages/portal/PortalLogin';
import CustomerHub from '@/pages/portal/CustomerHub';
import VendorPanel from '@/pages/portal/VendorPanel';

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
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* External Data Portal — entirely separate auth/session from the internal app */}
      <Route path="/portal/login" element={<PortalLogin />} />
      <Route element={<PortalProtectedRoute orgType="customer" />}>
        <Route element={<PortalLayout />}>
          <Route path="/portal/customer" element={<CustomerHub />} />
        </Route>
      </Route>
      <Route element={<PortalProtectedRoute orgType="vendor" />}>
        <Route element={<PortalLayout />}>
          <Route path="/portal/vendor" element={<VendorPanel />} />
        </Route>
      </Route>

      {/* Protected app routes under AppLayout */}
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/new" element={<ProjectNew />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/projects/:id/management" element={<ProjectManagement />} />
          <Route path="/projects/change-orders" element={<ChangeOrders />} />
          <Route path="/subcontracts" element={<Subcontracts />} />
          <Route path="/certified-payroll" element={<CertifiedPayroll />} />
          <Route path="/estimating" element={<Estimating />} />
          <Route path="/estimating/new" element={<BidNew />} />
          <Route path="/estimating/:id" element={<BidDetail />} />
          <Route path="/estimating/analytics" element={<EstimatingAnalytics />} />
          <Route path="/estimating/spec-review" element={<FrontEndReview />} />
          <Route path="/intelligence" element={<Intelligence />} />
          <Route path="/intelligence-signals" element={<IntelligenceSignals />} />
          <Route path="/production" element={<Production />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/quality" element={<Quality />} />
          <Route path="/quality/kpi-builder" element={<QualityKpiBuilder />} />
          <Route path="/safety" element={<Safety />} />
          <Route path="/shipping" element={<Shipping />} />
          <Route path="/field-operations" element={<FieldOperations />} />
          <Route path="/field-operations/rigging-inspection" element={<RiggingInspectionForm />} />
          <Route path="/field-operations/equipment-service" element={<EquipmentServiceForm />} />
          <Route path="/rfis" element={<RFIs />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/crm" element={<CRM />} />
          <Route path="/crm/directory" element={<CrmDirectories />} />
          <Route path="/estimating/blueprint-takeoff" element={<BlueprintTakeoff />} />
          <Route path="/estimating/blueprint-takeoff/:id" element={<BlueprintTakeoff />} />
          <Route path="/shop-efficiency" element={<ShopEfficiency />} />
          <Route path="/purchasing" element={<Purchasing />} />
          <Route path="/purchasing/module" element={<ProcurementModule />} />
          <Route path="/purchasing/receiving-kiosk" element={<ReceivingKiosk />} />
          <Route path="/shop-fabrication" element={<ShopFabrication />} />
          <Route path="/shop-operations" element={<ShopOperations />} />
          <Route path="/detailer-imports" element={<DetailerImports />} />
          <Route path="/material-optimization" element={<MaterialOptimization />} />
          <Route path="/shop-floor-command-center" element={<ShopFloorCommandCenter />} />
          <Route path="/accounting" element={<Accounting />} />
          <Route path="/legal" element={<Legal />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/users" element={<Users />} />
          <Route path="/human-resources" element={<HumanResources />} />
          <Route path="/human-resources/new-employee" element={<NewEmployee />} />
          {/* Payroll.jsx retired — its pipeline could double-post labor to
              JobCostLedgerEntry against PayrollProcessing.jsx without either
              knowing about the other. Redirect rather than 404 for anyone
              with the old URL bookmarked. */}
          <Route path="/payroll" element={<Navigate to="/payroll/processing" replace />} />
          <Route path="/payroll/hours" element={<PayrollHours />} />
          <Route path="/payroll/setup" element={<PayrollSetup />} />
          <Route path="/payroll/processing" element={<PayrollProcessing />} />
          <Route path="/payroll/garnishments" element={<GarnishmentsReport />} />
          <Route path="/payroll/401k-contributions" element={<Retirement401kReport />} />
          <Route path="/employee-center" element={<EmployeeCenter />} />
          <Route path="/super-admin/dashboard" element={<SuperAdminDashboard />} />
          <Route path="/executive-analytics" element={<ExecutiveAnalytics />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/audit-trail" element={<AuditTrail />} />
          <Route path="/admin/employees" element={<AdminEmployees />} />
          <Route path="/admin/cost-codes" element={<CostCodesAdmin />} />
          <Route path="/admin/delivery-pricing" element={<DeliveryPricingAdmin />} />
          <Route path="/admin/intelligence-rules" element={<IntelligenceRulesAdmin />} />
          <Route path="/admin/intelligence-rules/:id" element={<IntelligenceRuleDetail />} />
          <Route path="/admin/service-schedules" element={<ServiceScheduleAdmin />} />
          <Route path="/admin/service-schedules/:id" element={<ServiceScheduleDetail />} />
          <Route path="/admin/pto-policies" element={<PtoPoliciesAdmin />} />
          <Route path="/admin/commission-setup" element={<CommissionSetup />} />
          <Route path="/admin/salesman-rates" element={<SalesmanRatesAdmin />} />
          <Route path="/admin/tm-labor-rates" element={<TmLaborRatesAdmin />} />
          <Route path="/system-integrations" element={<SystemIntegrations />} />
          <Route path="/sales" element={<SalesDashboard />} />
          <Route path="/sales/dashboard" element={<SalesDashboard />} />
        </Route>
      </Route>

      {/* Meeting Mode — a full-bleed presentation surface for projector use,
          deliberately outside AppLayout so it controls its own high-contrast
          shell instead of rendering under the normal TopBar/NavBar chrome. */}
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route path="/meeting-mode" element={<MeetingMode />} />
        <Route path="/meeting-mode/:meetingId" element={<MeetingModeSession />} />
      </Route>

      {/* Document Viewer — full-page PDF viewer opened in its own new tab
          (see openDocumentViewer), outside AppLayout so it isn't cramped by
          the normal TopBar/NavBar chrome. */}
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route path="/document-viewer" element={<DocumentViewer />} />
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