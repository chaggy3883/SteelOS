import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import FormLayoutBuilder from '@/components/admin/FormLayoutBuilder';
import ReportTemplateBuilder from '@/components/admin/ReportTemplateBuilder';
import { LayoutTemplate, FileCog } from 'lucide-react';

const SUB_TABS = [
  { id: 'forms', label: 'Form Layouts', icon: LayoutTemplate, Component: FormLayoutBuilder },
  { id: 'reports', label: 'Report Templates', icon: FileCog, Component: ReportTemplateBuilder },
];

export default function FormReportSettingsPanel() {
  const [activeSubTab, setActiveSubTab] = useState('forms');
  const Active = SUB_TABS.find((t) => t.id === activeSubTab)?.Component;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-border">
        {SUB_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                activeSubTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="w-4 h-4" />{tab.label}
            </button>
          );
        })}
      </div>
      <Active />
    </div>
  );
}
