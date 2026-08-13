import React from 'react';
import { cn } from '@/lib/utils';

const statusConfig = {
  // Project statuses
  lead: { label: 'Lead', class: 'bg-gray-500/10 text-gray-500 border-gray-500/20' },
  estimating: { label: 'Estimating', class: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
  awarded: { label: 'Awarded', class: 'bg-green-500/10 text-green-500 border-green-500/20' },
  engineering: { label: 'Engineering', class: 'bg-purple-500/10 text-purple-500 border-purple-500/20' },
  fabrication: { label: 'Fabrication', class: 'bg-orange-500/10 text-orange-500 border-orange-500/20' },
  erection: { label: 'Erection', class: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' },
  complete: { label: 'Complete', class: 'bg-green-500/10 text-green-600 border-green-500/20' },
  cancelled: { label: 'Cancelled', class: 'bg-red-500/10 text-red-500 border-red-500/20' },
  // Bid statuses
  draft: { label: 'Draft', class: 'bg-gray-500/10 text-gray-500 border-gray-500/20' },
  in_progress: { label: 'In Progress', class: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
  submitted: { label: 'Submitted', class: 'bg-purple-500/10 text-purple-500 border-purple-500/20' },
  won: { label: 'Won', class: 'bg-green-500/10 text-green-500 border-green-500/20' },
  lost: { label: 'Lost', class: 'bg-red-500/10 text-red-500 border-red-500/20' },
  // Risk levels
  low: { label: 'Low Risk', class: 'bg-green-500/10 text-green-500 border-green-500/20' },
  medium: { label: 'Medium Risk', class: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' },
  high: { label: 'High Risk', class: 'bg-red-500/10 text-red-500 border-red-500/20' },
  critical: { label: 'Critical', class: 'bg-red-600/20 text-red-600 border-red-600/30' },
  // AI Finding statuses
  pass: { label: 'Pass', class: 'bg-green-500/10 text-green-500 border-green-500/20' },
  warning: { label: 'Warning', class: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' },
  fail: { label: 'Fail', class: 'bg-red-500/10 text-red-500 border-red-500/20' },
  not_found: { label: 'Not Found', class: 'bg-gray-500/10 text-gray-500 border-gray-500/20' },
  manual_review: { label: 'Manual Review', class: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
  // Piece statuses
  not_started: { label: 'Not Started', class: 'bg-gray-500/10 text-gray-500 border-gray-500/20' },
  in_fabrication: { label: 'In Fabrication', class: 'bg-orange-500/10 text-orange-500 border-orange-500/20' },
  fabricated: { label: 'Fabricated', class: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
  inspected: { label: 'Inspected', class: 'bg-purple-500/10 text-purple-500 border-purple-500/20' },
  painted: { label: 'Painted', class: 'bg-teal-500/10 text-teal-500 border-teal-500/20' },
  shipped: { label: 'Shipped', class: 'bg-green-500/10 text-green-500 border-green-500/20' },
  erected: { label: 'Erected', class: 'bg-green-600/10 text-green-600 border-green-600/20' },
  rejected: { label: 'Rejected', class: 'bg-red-500/10 text-red-500 border-red-500/20' },
  // RFI statuses
  under_review: { label: 'Under Review', class: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
  answered: { label: 'Answered', class: 'bg-green-500/10 text-green-500 border-green-500/20' },
  closed: { label: 'Closed', class: 'bg-gray-500/10 text-gray-600 border-gray-500/20' },
  void: { label: 'Void', class: 'bg-red-500/10 text-red-500 border-red-500/20' },
};

export default function StatusBadge({ status, label, className }) {
  const config = statusConfig[status] || { label: label || status, class: 'bg-gray-500/10 text-gray-500 border-gray-500/20' };
  return (
    <span className={cn(
      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border',
      config.class,
      className
    )}>
      {label || config.label}
    </span>
  );
}