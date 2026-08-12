// Local, dependency-free "export to CSV": builds a CSV string in-memory and
// triggers a browser download via a Blob + temporary <a download> — the same
// no-backend, no-library approach requisitionPdfExport.js uses for its print
// window, just producing a raw data file instead of an HTML print sheet.
const escapeCsvCell = (value) => {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

export function exportRowsToCsv({ filename, columns, rows }) {
  const lines = [
    columns.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
