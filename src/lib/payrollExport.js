// Payroll register CSV export — the integration path for hand-off to an
// external payroll provider (Gusto, ADP, Paychex). There is no live API
// sync: that would require a server-held OAuth secret this browser app
// can't hold. Mirrors glExport.js's downloadCSV pattern.

function downloadCSV(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportPayrollRegisterCSV(period, registerLines, employees) {
  const employeeById = Object.fromEntries((employees || []).map((e) => [e.id, e]));
  const header = ['Employee Number', 'Employee Name', 'Pay Type', 'Regular Hours', 'OT Hours', 'Regular Pay', 'OT Pay', 'Gross Pay', 'Period Start', 'Period End', 'Pay Date'];
  const rows = (registerLines || []).map((line) => {
    const emp = employeeById[line.employee_id];
    return [
      emp?.employee_number || '',
      line.employee_name || emp?.full_name || '',
      line.pay_type_snapshot || emp?.pay_type || '',
      (line.regular_hours || 0).toFixed(2),
      (line.ot_hours || 0).toFixed(2),
      ((line.regular_pay_cents || 0) / 100).toFixed(2),
      ((line.ot_pay_cents || 0) / 100).toFixed(2),
      ((line.gross_pay_cents || 0) / 100).toFixed(2),
      period?.period_start || '',
      period?.period_end || '',
      period?.pay_date || '',
    ];
  });
  const filename = `payroll_register_${period?.period_start || 'export'}_to_${period?.period_end || ''}.csv`;
  downloadCSV(filename, [header, ...rows]);
}

// Provider hand-off export for the PayrollRun/PayrollLine pipeline
// (PayrollRunPanel.jsx). Same destination as exportPayrollRegisterCSV above
// (import into Gusto/ADP/Paychex) but built against PayrollLine's schema —
// gross/tax/deductions/net are already-summed totals on the line itself
// (itemized detail lives on PayrollLineTax/PayrollLineDeduction, one row per
// tax or deduction type, which is more granularity than a flat provider
// import file needs).
export function exportPayrollRunCSV(period, run, lines, employees) {
  const employeeById = Object.fromEntries((employees || []).map((e) => [e.id, e]));
  const header = ['Employee Number', 'Employee Name', 'Pay Type', 'Regular Hours', 'OT Hours', 'Double Time Hours', 'Gross Pay', 'Tax Withheld', 'Deductions', 'Net Pay', 'Period Start', 'Period End', 'Run Date'];
  const rows = (lines || []).map((line) => {
    const emp = employeeById[line.employee_id];
    return [
      emp?.employee_number || '',
      emp?.full_name || line.employee_id,
      line.pay_type_snapshot || emp?.pay_type || '',
      (line.regular_hours || 0).toFixed(2),
      (line.ot_hours || 0).toFixed(2),
      (line.double_time_hours || 0).toFixed(2),
      (line.gross_pay || 0).toFixed(2),
      (line.tax_total || 0).toFixed(2),
      (line.deductions_total || 0).toFixed(2),
      (line.net_pay || 0).toFixed(2),
      period?.period_start || '',
      period?.period_end || '',
      run?.run_date || '',
    ];
  });
  const filename = `payroll_run_${period?.period_start || 'export'}_to_${period?.period_end || ''}.csv`;
  downloadCSV(filename, [header, ...rows]);
}
