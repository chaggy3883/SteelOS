import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { Truck, ShieldAlert, ArrowUpFromLine, Wrench, Link2, Gauge, PackageCheck, ClipboardCheck, ClipboardList } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { getEffectiveCompany, isSuperAdmin, isImpersonating } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import ModuleLocked from '@/components/shared/ModuleLocked';
import FleetRentalRegistry from '@/components/field-operations/FleetRentalRegistry';
import InspectionRadar from '@/components/field-operations/InspectionRadar';
import HookProductionTerminal from '@/components/field-operations/HookProductionTerminal';
import RepairLedger from '@/components/field-operations/RepairLedger';
import RiggingMatrix from '@/components/field-operations/RiggingMatrix';
import EquipmentUsagePanel from '@/components/field-operations/EquipmentUsagePanel';
import JobsiteReceiving from '@/components/field-operations/JobsiteReceiving';

const FLEET_WRITE_ROLES = ['admin', 'super_admin', 'Maintenance_Manager'];
const PO_MISMATCH_OVERRIDE_ROLES = ['controller', 'finance_department', 'admin', 'super_admin'];

export default function FieldOperations() {
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState('fleet');
  const [assets, setAssets] = useState([]);
  const [inspections, setInspections] = useState([]);
  const [hookLogs, setHookLogs] = useState([]);
  const [repairLogs, setRepairLogs] = useState([]);
  const [riggingLedger, setRiggingLedger] = useState([]);
  const [projects, setProjects] = useState([]);
  const [pieces, setPieces] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [usageLogs, setUsageLogs] = useState([]);
  const [canManageFleet, setCanManageFleet] = useState(false);
  const [canOverridePoMismatch, setCanOverridePoMismatch] = useState(false);
  const [fieldOpsAllowed, setFieldOpsAllowed] = useState(false);
  const [checkingModuleAccess, setCheckingModuleAccess] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    try {
      const [assetData, inspectionData, hookData, repairData, riggingData, projectData, pieceData, vendorData, poData, employeeData, usageLogData] = await Promise.all([
        db.entities.erection_fleet_assets.list('-created_date', 200),
        db.entities.heavy_equipment_inspections.list('-created_date', 200),
        db.entities.field_hook_logs.list('-created_date', 500),
        db.entities.fleet_repair_logs.list('-created_date', 200),
        db.entities.rigging_inventory_ledger.list('-created_date', 200),
        db.entities.Project.filter({ is_archived: false }, 'name', 100),
        db.entities.pieces.list('-created_date', 500),
        db.entities.Vendor.filter({ is_active: true }, 'name', 200),
        db.entities.purchase_orders.filter({ status: 'Open' }, '-created_date', 200),
        db.entities.employees.list('full_name', 500),
        db.entities.EquipmentUsageLog.list('-usage_date', 500),
      ]);
      setAssets(assetData);
      setInspections(inspectionData);
      setHookLogs(hookData);
      setRepairLogs(repairData);
      setRiggingLedger(riggingData);
      setProjects(projectData);
      setPieces(pieceData);
      setVendors(vendorData);
      setPurchaseOrders(poData);
      setEmployees(employeeData);
      setUsageLogs(usageLogData);
    } catch (e) {
      // no-op — panels render empty states when their lists are empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
    db.auth.me()
      .then((me) => {
        setCurrentUser(me || null);
        const roles = me?.roles || [];
        setCanManageFleet(roles.some((r) => FLEET_WRITE_ROLES.includes(r)));
        setCanOverridePoMismatch(roles.some((r) => PO_MISMATCH_OVERRIDE_ROLES.includes(r)));
      })
      .catch(() => {
        setCanManageFleet(false);
        setCanOverridePoMismatch(false);
      });
    getEffectiveCompany()
      .then((company) => {
        setFieldOpsAllowed(hasModule(company, '/field-operations'));
      })
      .catch(() => {
        setFieldOpsAllowed(false);
      })
      .finally(() => setCheckingModuleAccess(false));
  }, [loadAll]);

  // Deep-link target for "equipment ID" drill-downs from other tabs/dialogs
  // (repairs, inspections, hook terminal, usage log) — /field-operations?asset=<id>
  // always lands on the Fleet & Rental Registry tab and auto-opens that asset's detail.
  useEffect(() => {
    if (searchParams.get('asset')) setActiveTab('fleet');
  }, [searchParams]);

  const focusAssetId = searchParams.get('asset');

  const handleTogglePickup = async (asset) => {
    await db.entities.erection_fleet_assets.update(asset.id, { is_marked_ready_for_pickup: true });
    await loadAll();
    toast({ title: `${asset.asset_name} marked ready for pickup` });
  };

  const cranes = assets.filter((a) => a.asset_type === 'Crane');
  const isPlatformOperatorView = isSuperAdmin(currentUser) && !isImpersonating();
  const showFieldOpsSubforms = fieldOpsAllowed || isPlatformOperatorView;

  if (loading || checkingModuleAccess) return <div className="p-6"><div className="h-96 bg-muted rounded-xl animate-pulse" /></div>;

  // Route guard — a direct URL to /field-operations can't bypass the nav's
  // module-pack filtering. Fleet/rigging/equipment maintenance is Erector +
  // Enterprise Connect only (see modulePacks.js); a Fabricator-pack company
  // has no field crews or cranes, so none of this page applies to them.
  if (!showFieldOpsSubforms) {
    return <ModuleLocked modulePath="/field-operations" title="Field Operations Not Included" />;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">
      <PageHeader
        title="Field Operations"
        subtitle="Fleet & rental registry, OSHA/DOT inspection radar, crane hook production, repair ledger, and rigging matrix"
        actions={(
          <div className="flex items-center gap-2">
            <Link to="/field-operations/equipment-service">
              <Button size="sm" variant="outline" className="gap-1.5"><ClipboardList className="w-3.5 h-3.5" />New Equipment Service</Button>
            </Link>
            <Link to="/field-operations/rigging-inspection">
              <Button size="sm" className="gap-1.5 steel-gradient text-white border-0"><ClipboardCheck className="w-3.5 h-3.5" />New Rigging Inspection</Button>
            </Link>
          </div>
        )}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4 max-w-full overflow-x-auto justify-start">
          <TabsTrigger value="fleet" className="gap-1.5"><Truck className="w-3.5 h-3.5" />Fleet &amp; Rental Registry</TabsTrigger>
          <TabsTrigger value="usage" className="gap-1.5"><Gauge className="w-3.5 h-3.5" />Equipment Usage</TabsTrigger>
          <TabsTrigger value="radar" className="gap-1.5"><ShieldAlert className="w-3.5 h-3.5" />Inspection Radar</TabsTrigger>
          <TabsTrigger value="hooks" className="gap-1.5"><ArrowUpFromLine className="w-3.5 h-3.5" />Hook Production Terminal</TabsTrigger>
          <TabsTrigger value="repairs" className="gap-1.5"><Wrench className="w-3.5 h-3.5" />Repair Ledger</TabsTrigger>
          <TabsTrigger value="rigging" className="gap-1.5"><Link2 className="w-3.5 h-3.5" />Rigging Matrix</TabsTrigger>
          <TabsTrigger value="jobsite-receiving" className="gap-1.5"><PackageCheck className="w-3.5 h-3.5" />Jobsite Receiving</TabsTrigger>
        </TabsList>

        <TabsContent value="fleet">
          <FleetRentalRegistry
            assets={assets}
            projects={projects}
            vendors={vendors}
            purchaseOrders={purchaseOrders}
            usageLogs={usageLogs}
            repairLogs={repairLogs}
            canManageFleet={canManageFleet}
            canOverridePoMismatch={canOverridePoMismatch}
            currentUser={currentUser}
            onTogglePickup={handleTogglePickup}
            onReload={loadAll}
            focusAssetId={focusAssetId}
          />
        </TabsContent>

        <TabsContent value="usage">
          <EquipmentUsagePanel assets={assets} projects={projects} employees={employees} usageLogs={usageLogs} onReload={loadAll} />
        </TabsContent>

        <TabsContent value="radar">
          <InspectionRadar inspections={inspections} assets={assets} canManageFleet={canManageFleet} onReload={loadAll} />
        </TabsContent>

        <TabsContent value="hooks">
          <HookProductionTerminal
            cranes={cranes}
            pieces={pieces}
            projects={projects}
            inspections={inspections}
            hookLogs={hookLogs}
            onReload={loadAll}
          />
        </TabsContent>

        <TabsContent value="repairs">
          <RepairLedger assets={assets} repairLogs={repairLogs} projects={projects} vendors={vendors} canManageFleet={canManageFleet} onReload={loadAll} />
        </TabsContent>

        <TabsContent value="rigging">
          <RiggingMatrix ledger={riggingLedger} canManageFleet={canManageFleet} onReload={loadAll} />
        </TabsContent>

        <TabsContent value="jobsite-receiving">
          <JobsiteReceiving />
        </TabsContent>
      </Tabs>
    </div>
  );
}
