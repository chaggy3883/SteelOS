import React, { useRef, useState, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import UnsavedChangesModal from '@/components/meeting-mode/UnsavedChangesModal';
import TurnoverReviewPanel from '@/components/projects/TurnoverReviewPanel';
import ScopeReviewPanel from '@/components/projects/ScopeReviewPanel';

// Two sub-tabs, each independently dirty-tracked (see each panel's own
// isDirty/save exposed via useImperativeHandle). Switching sub-tabs would
// otherwise unmount whichever panel is active (Radix TabsContent doesn't
// keep inactive content mounted) and silently drop unsaved edits, so every
// switch routes through attemptNavigate — same technique
// MeetingModeSession.jsx uses for its own section switches, generalized
// here from one page to two sibling sub-tabs.
const ProjectHandoffPanel = forwardRef(function ProjectHandoffPanel({ project, onExportPdf }, ref) {
  const [subTab, setSubTab] = useState('turnover');
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [savingUnsaved, setSavingUnsaved] = useState(false);
  const pendingActionRef = useRef(null);
  const turnoverRef = useRef(null);
  const scopeRef = useRef(null);

  const activeRef = useCallback(() => (subTab === 'turnover' ? turnoverRef : scopeRef), [subTab]);
  const isDirty = useCallback(() => !!activeRef().current?.isDirty?.(), [activeRef]);

  const attemptNavigate = useCallback((action) => {
    if (isDirty()) {
      pendingActionRef.current = action;
      setShowUnsavedModal(true);
    } else {
      action();
    }
  }, [isDirty]);

  const changeSubTab = (value) => {
    if (value === subTab) return;
    attemptNavigate(() => setSubTab(value));
  };

  const handleModalSave = async () => {
    setSavingUnsaved(true);
    try {
      const ok = await activeRef().current?.save?.();
      if (ok) {
        setShowUnsavedModal(false);
        pendingActionRef.current?.();
        pendingActionRef.current = null;
      }
    } finally {
      setSavingUnsaved(false);
    }
  };

  const handleModalDiscard = () => {
    setShowUnsavedModal(false);
    pendingActionRef.current?.();
    pendingActionRef.current = null;
  };

  useImperativeHandle(ref, () => ({
    isDirty,
    save: () => activeRef().current?.save?.(),
  }), [isDirty, activeRef]);

  return (
    <>
      <Tabs value={subTab} onValueChange={changeSubTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="turnover">Turnover / Contract Review</TabsTrigger>
          <TabsTrigger value="scope">Scope Review</TabsTrigger>
        </TabsList>
        <TabsContent value="turnover">
          <TurnoverReviewPanel ref={turnoverRef} project={project} onExportPdf={() => onExportPdf('turnover')} />
        </TabsContent>
        <TabsContent value="scope">
          <ScopeReviewPanel ref={scopeRef} project={project} onExportPdf={() => onExportPdf('scope')} />
        </TabsContent>
      </Tabs>

      <UnsavedChangesModal open={showUnsavedModal} onSave={handleModalSave} onDiscard={handleModalDiscard} saving={savingUnsaved} />
    </>
  );
});

export default ProjectHandoffPanel;
