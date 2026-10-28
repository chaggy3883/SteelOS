import { useCallback, useMemo, useRef, useState } from 'react';
import { db } from '@/api/apiClient';
import { estimateWeightPerFt } from '@/data/steelShapeSelector';
import { createToolSet } from '@/lib/takeoffToolSets';
import { mergeColumns, computeColumnValues, normalizeColumns } from '@/lib/takeoffColumns';
import { makeRowWeightLookup, toolForRow } from '@/lib/takeoffRowHelpers';

const weightLookup = makeRowWeightLookup(estimateWeightPerFt);

// Per-session IRONSIGHT settings that sit next to the measurements but
// aren't rows: which company tool set was loaded (a frozen copy of it, so a
// later edit/delete in the library never changes a takeoff mid-job — the same
// promise the library's delete prompt makes), this job's own extra columns,
// legend placement per page, the drawing-revision compare results, and which
// older session (if any) this one is a revision of.
//
// Like useTakeoffScales: every setter saves straight to blueprint_takeoffs
// (these change rarely); loadFrom/reset never write.
export function useTakeoffSessionExtras(takeoffId) {
  const [toolSet, setToolSetState] = useState(null);
  const [customColumns, setCustomColumnsState] = useState([]);
  const [legendSettings, setLegendSettingsState] = useState({});
  // Latest legend settings, so a per-page patch can be saved outside the
  // state updater (updaters must stay side-effect free).
  const legendRef = useRef({});
  const [revisionCompare, setRevisionCompareState] = useState(null);
  const [previousTakeoffId, setPreviousTakeoffIdState] = useState(null);

  const save = useCallback((patch) => {
    if (!takeoffId) return;
    db.entities.blueprint_takeoffs.update(takeoffId, patch).catch((e) => {
      console.error('Failed to save takeoff session settings', Object.keys(patch), e);
    });
  }, [takeoffId]);

  const loadFrom = useCallback((takeoff) => {
    setToolSetState(takeoff?.tool_set_snapshot ? createToolSet(takeoff.tool_set_snapshot) : null);
    setCustomColumnsState(normalizeColumns(takeoff?.custom_columns || []));
    legendRef.current = takeoff?.legend_settings || {};
    setLegendSettingsState(legendRef.current);
    setRevisionCompareState(takeoff?.revision_compare || null);
    setPreviousTakeoffIdState(takeoff?.previous_takeoff_id || null);
  }, []);

  const reset = useCallback(() => loadFrom(null), [loadFrom]);

  // A whole tool set loaded from the library (or the Tool Chest picker).
  const setToolSet = useCallback((set) => {
    const snapshot = set ? createToolSet(set) : null;
    setToolSetState(snapshot);
    save({ tool_set_id: set?.id || null, tool_set_snapshot: snapshot });
  }, [save]);

  const setCustomColumns = useCallback((cols) => {
    const next = normalizeColumns(cols);
    setCustomColumnsState(next);
    save({ custom_columns: next });
  }, [save]);

  const setLegendSetting = useCallback((pageNum, patch) => {
    const prev = legendRef.current;
    const next = { ...prev, [pageNum]: { ...(prev[pageNum] || {}), ...patch } };
    legendRef.current = next;
    setLegendSettingsState(next);
    save({ legend_settings: next });
  }, [save]);

  const setRevisionCompare = useCallback((value) => {
    setRevisionCompareState(value);
    save({ revision_compare: value });
  }, [save]);

  const setPreviousTakeoffId = useCallback((id) => {
    setPreviousTakeoffIdState(id || null);
    save({ previous_takeoff_id: id || null });
  }, [save]);

  // Company columns first, then this job's own (a job column with the same
  // id/alias replaces the company one — see takeoffColumns.mergeColumns).
  const columns = useMemo(() => mergeColumns(toolSet?.columns || [], customColumns), [toolSet, customColumns]);

  const computeRow = useCallback(
    (row) => computeColumnValues(row, columns, { tool: toolForRow(row, toolSet) || undefined, weightLookup }),
    [columns, toolSet],
  );

  return {
    toolSet, customColumns, legendSettings, revisionCompare, previousTakeoffId, columns, weightLookup,
    loadFrom, reset, setToolSet, setCustomColumns, setLegendSetting, setRevisionCompare, setPreviousTakeoffId, computeRow,
  };
}
