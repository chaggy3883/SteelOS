import React, { useCallback, useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Truck, ShieldAlert, ArrowUpFromLine, Wrench, Link2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import FleetRentalRegistry from '@/components/field-operations/FleetRentalRegistry';
import InspectionRadar from '@/components/field-operations/InspectionRadar';
import HookProductionTerminal from '@/components/field-operations/HookProductionTerminal';
import RepairLedger from '@/components/field-operations/RepairLedger';
import RiggingMatrix from '@/components/field-operations/RiggingMatrix';

const FLEET_WRITE_ROLES = ['admin', 'super_admin', 'Maintenance_Manager'];

export default function FieldOperations() {
  const { toast } = useToast();
  const [assets, setAssets] = useState([]);
  const [inspections, setInspections] = useState([]);
  const [hookLogs, setHookLogs] = useState([]);
  const [repairLogs, setRepairLogs] = useState([]);
  const [riggingLedger, setRiggingLedger] = useState([]);
  const [projects, setProjects] = useState([]);
  const [pieces, setPieces] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [canManageFleet, setCanManageFleet] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    try {
      const [assetData, inspectionData, hookData, repairData, riggingData, projectData, pieceData, vendorData, poData] = await Promise.all([
        db.entities.erection_fleet_assets.list('-created_date', 200),
        db.entities.heavy_equipment_inspections.list('-created_date', 200),
        db.entities.field_hook_logs.list('-created_date', 500),
        db.entities.fleet_repair_logs.list('-created_date', 200),
        db.entities.rigging_inventory_ledger.list('-created_date', 200),
        db.entities.Project.filter({ is_archived: false }, 'name', 100),
        db.entities.pieces.list('-created_date', 500),
        db.entities.Vendor.filter({ vendor_type: 'equipment_rental', is_active: true }, 'name', 50),
        db.entities.purchase_orders.filter({ status: 'Open' }, '-created_date', 200),
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
    } catch (e) {
      // no-op — panels render empty states when their lists are empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
    db.auth.me()
      .then((me) => setCanManageFleet((me?.roles || []).some((r) => FLEET_WRITE_ROLES.includes(r))))
      .catch(() => setCanManageFleet(false));
  }, [loadAll]);

  const handleTogglePickup = async (asset) => {
    await db.entities.erection_fleet_assets.update(asset.id, { is_marked_ready_for_pickup: true });
    await loadAll();
    toast({ title: `${asset.asset_name} marked ready for pickup` });
  };

  const cranes = assets.filter((a) => a.asset_type === 'Crane');

  if (loading) return <div className="p-6"><div className="h-96 bg-muted rounded-xl animate-pulse" /></div>;

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">
      <PageHeader title="Field Operations" subtitle="Fleet & rental registry, OSHA/DOT inspection radar, crane hook production, repair ledger, and rigging matrix" />

      <Tabs defaultValue="fleet">
        <TabsList className="mb-4 max-w-full overflow-x-auto justify-start">
          <TabsTrigger value="fleet" className="gap-1.5"><Truck className="w-3.5 h-3.5" />Fleet &amp; Rental Registry</TabsTrigger>
          <TabsTrigger value="radar" className="gap-1.5"><ShieldAlert className="w-3.5 h-3.5" />Inspection Radar</TabsTrigger>
          <TabsTrigger value="hooks" className="gap-1.5"><ArrowUpFromLine className="w-3.5 h-3.5" />Hook Production Terminal</TabsTrigger>
          <TabsTrigger value="repairs" className="gap-1.5"><Wrench className="w-3.5 h-3.5" />Repair Ledger</TabsTrigger>
          <TabsTrigger value="rigging" className="gap-1.5"><Link2 className="w-3.5 h-3.5" />Rigging Matrix</TabsTrigger>
        </TabsList>

        <TabsContent value="fleet">
          <FleetRentalRegistry assets={assets} projects={projects} vendors={vendors} purchaseOrders={purchaseOrders} canManageFleet={canManageFleet} onTogglePickup={handleTogglePickup} onReload={loadAll} />
        </TabsContent>

        <TabsContent value="radar">
          <InspectionRadar inspections={inspections} assets={assets} />
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
          <RepairLedger assets={assets} repairLogs={repairLogs} canManageFleet={canManageFleet} onReload={loadAll} />
        </TabsContent>

        <TabsContent value="rigging">
          <RiggingMatrix ledger={riggingLedger} canManageFleet={canManageFleet} onReload={loadAll} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
