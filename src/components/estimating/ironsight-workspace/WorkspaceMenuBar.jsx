import React from 'react';
import {
  Menubar, MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem, MenubarSeparator, MenubarShortcut,
  MenubarCheckboxItem, MenubarSub, MenubarSubTrigger, MenubarSubContent, MenubarLabel,
} from '@/components/ui/menubar';

// One menu entry. Item shapes (built by workspaceMenus.js):
//   { label, keys?, onSelect, disabled?, hint? }          plain command
//   { label, checked, onSelect, keys? }                   toggle
//   { label, items: [...] }                               submenu
//   { separator: true } / { heading: 'text' }
// A disabled item shows its `hint` (e.g. "Not available") so it's clear
// why it can't be used.
function MenuEntry({ item }) {
  if (!item) return null;
  if (item.separator) return <MenubarSeparator />;
  if (item.heading) return <MenubarLabel className="text-[11px] text-muted-foreground">{item.heading}</MenubarLabel>;
  if (item.items) {
    return (
      <MenubarSub>
        <MenubarSubTrigger disabled={item.disabled} className="text-xs">{item.label}</MenubarSubTrigger>
        <MenubarSubContent className="max-h-[70vh] overflow-y-auto">
          {item.items.length === 0 && <MenubarItem disabled className="text-xs">{item.empty || 'Nothing here yet'}</MenubarItem>}
          {item.items.map((sub, i) => <MenuEntry key={sub.id || sub.label || i} item={sub} />)}
        </MenubarSubContent>
      </MenubarSub>
    );
  }
  const shortcut = item.keys ? <MenubarShortcut>{item.keys}</MenubarShortcut> : null;
  const hint = item.disabled && item.hint ? <span className="ml-2 text-[10px] text-muted-foreground italic">{item.hint}</span> : null;
  if (typeof item.checked === 'boolean') {
    return (
      <MenubarCheckboxItem checked={item.checked} disabled={item.disabled} onSelect={() => item.onSelect?.()} className="text-xs">
        {item.label}{hint}{shortcut}
      </MenubarCheckboxItem>
    );
  }
  return (
    <MenubarItem disabled={item.disabled} onSelect={() => item.onSelect?.()} className="text-xs" title={item.hint || undefined}>
      {item.label}{hint}{shortcut}
    </MenubarItem>
  );
}

// The workspace's top menu bar (File, Edit, View, Document, Batch, Tools,
// Window). Every entry is a real action or is disabled with a reason.
export default function WorkspaceMenuBar({ menus }) {
  return (
    <Menubar className="h-8 rounded-none border-0 border-b bg-muted/40 px-1 py-0 space-x-0">
      {menus.map((menu) => (
        <MenubarMenu key={menu.id}>
          <MenubarTrigger className="text-xs px-2.5 py-1">{menu.label}</MenubarTrigger>
          <MenubarContent className="min-w-[260px] max-h-[80vh] overflow-y-auto">
            {menu.items.map((item, i) => <MenuEntry key={item?.id || item?.label || `s${i}`} item={item} />)}
          </MenubarContent>
        </MenubarMenu>
      ))}
    </Menubar>
  );
}
