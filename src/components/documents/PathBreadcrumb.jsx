import React from 'react';
import { Home } from 'lucide-react';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

// currentPath is a virtual_path string like "/Drawings/Approved/Beams/"
export default function PathBreadcrumb({ currentPath, onNavigate }) {
  const segments = currentPath.split('/').filter(Boolean);

  const pathAt = (index) => `/${segments.slice(0, index + 1).join('/')}/`;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="flex items-center gap-1 hover:text-foreground"
            >
              <Home className="w-3.5 h-3.5" /> Documents
            </button>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {segments.map((segment, index) => (
          <React.Fragment key={index}>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {index === segments.length - 1 ? (
                <BreadcrumbPage>{segment}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <button type="button" onClick={() => onNavigate(pathAt(index))}>
                    {segment}
                  </button>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
