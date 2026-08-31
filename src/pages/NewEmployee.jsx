import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { hasFullEmployeeAccess } from '@/lib/employeesApi';
import { getAllRoles } from '@/components/dashboard/rbacConfig';
import { POSITIONS, JOB_TITLES } from '@/pages/HumanResources';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import AddEmployeeWizard from '@/components/hr/AddEmployeeWizard';

export default function NewEmployee() {
  const [roles, setRoles] = useState(['user']);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [allRoles, setAllRoles] = useState([]);

  useEffect(() => { init(); }, []);

  const init = async () => {
    let currentRoles = ['user'];
    try {
      const me = await db.auth.me();
      currentRoles = me?.roles || me?.user?.roles || ['user'];
    } catch (e) {}
    setRoles(currentRoles);
    // super_admin is a platform-operator role, not an assignable HR role —
    // never offer it in the Platform Role dropdown, matching HumanResources.jsx.
    getAllRoles().then((r) => setAllRoles(r.filter((role) => role.value !== 'super_admin'))).catch(() => setAllRoles([]));
    setCheckingAccess(false);
  };

  const isFullAccess = hasFullEmployeeAccess(roles);

  if (checkingAccess) {
    return <div className="p-6"><div className="h-96 bg-muted rounded-xl animate-pulse" /></div>;
  }

  if (!isFullAccess) {
    return (
      <div className="p-6 max-w-lg mx-auto text-center space-y-3">
        <ShieldAlert className="w-8 h-8 text-amber-500 mx-auto" />
        <h1 className="text-lg font-semibold">Restricted</h1>
        <p className="text-sm text-muted-foreground">Only HR Admin, Payroll Admin, or Admin roles can create employees.</p>
        <Link to="/human-resources"><Button variant="outline">Back to Human Resources</Button></Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/human-resources">
          <Button variant="ghost" size="icon" className="rounded-lg">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">New Employee</h1>
          <p className="text-sm text-muted-foreground">New employees start with employee-center access only — an admin assigns their platform role afterward.</p>
        </div>
      </div>

      <AddEmployeeWizard
        positions={POSITIONS}
        jobTitles={JOB_TITLES}
        allRoles={allRoles}
        onEmployeeCreated={() => {}}
      />
    </div>
  );
}
