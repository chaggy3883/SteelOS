import React, { useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';

// Searchable multi-select for assigning an employee's platform role(s) —
// mirrors EmployeeMultiSelect.jsx's Popover+Command composition, adapted for
// {value, label} role options (rbacConfig.jsx's getAllRoles()) instead of
// employee records. Selected roles render as removable chips so an admin can
// see (and undo) an assignment without reopening the dropdown — undo is
// deliberate, not a bug: HR is allowed to remove a role, not just add one.
export default function RoleMultiSelect({ roles = [], value = [], onChange, disabled = false, placeholder = 'Assign role(s)…', className }) {
  const [open, setOpen] = useState(false);

  const selected = roles.filter((r) => value.includes(r.value));

  const toggle = (roleValue) => {
    onChange(value.includes(roleValue) ? value.filter((v) => v !== roleValue) : [...value, roleValue]);
  };

  const remove = (roleValue) => onChange(value.filter((v) => v !== roleValue));

  return (
    <div className={cn('space-y-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" disabled={disabled} className="w-full justify-between font-normal">
            <span className="truncate">{selected.length > 0 ? `${selected.length} role${selected.length === 1 ? '' : 's'} selected` : placeholder}</span>
            <ChevronsUpDown className="w-4 h-4 opacity-50 flex-shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search roles…" />
            <CommandList>
              <CommandEmpty>No roles found.</CommandEmpty>
              <CommandGroup>
                {roles.map((r) => {
                  const isSelected = value.includes(r.value);
                  return (
                    <CommandItem key={r.value} value={r.label} onSelect={() => toggle(r.value)}>
                      <Check className={cn('mr-2 h-4 w-4 flex-shrink-0', isSelected ? 'opacity-100' : 'opacity-0')} />
                      <span className="flex-1 truncate">{r.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((r) => (
            <Badge key={r.value} variant="secondary" className="gap-1 pr-1">
              {r.label}
              {!disabled && (
                <button type="button" onClick={() => remove(r.value)} className="ml-0.5 rounded-full hover:bg-muted-foreground/20">
                  <X className="w-3 h-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
