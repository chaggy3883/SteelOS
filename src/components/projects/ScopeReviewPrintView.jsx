import React from 'react';

// Scope Review has no "completed" status — it's an always-open running list —
// so unlike TurnoverReviewPrintView's completed_by, the signature line here
// is "Prepared By", stamped with whoever is signed in at export time.
//
// `questions`/`generalNotes` are passed in from the panel's own live state
// (see ScopeReviewPanel.jsx's getPrintData(), wired through
// ProjectHandoffPanel.jsx and ProjectDetail.jsx) rather than fetched here —
// an earlier version of this component self-fetched by project_id on mount,
// but since it's mounted once and never re-fetches, that snapshot went stale
// (usually empty) the moment the user added/saved a question after this
// component's initial mount, silently exporting a PDF with no data. Reading
// the panel's actual state at export time is what's actually current.
export default function ScopeReviewPrintView({ project, preparedBy, questions, generalNotes }) {
  if (!project) return null;

  return (
    <div className="scope-review-print-sheet bg-white text-black p-10 max-w-[8.5in] mx-auto text-sm">
      <div className="flex items-center justify-between border-b-2 border-red-600 pb-4 mb-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold tracking-tight">SteelOS</span>
          <span className="text-2xl font-light text-gray-400">|</span>
          <span className="text-sm text-gray-600">Scope Review</span>
        </div>
      </div>

      <div className="flex justify-between mb-6">
        <div>
          <p className="font-semibold text-base">{project.name}</p>
          <p className="text-gray-600">{project.project_number}</p>
        </div>
        <p className="text-gray-600">Printed {new Date().toLocaleDateString()}</p>
      </div>

      <h4 className="font-semibold border-b border-gray-300 pb-1 mb-3">Questions</h4>
      {(questions || []).length === 0 ? (
        <p className="text-gray-500 mb-6">No questions recorded.</p>
      ) : (
        <div className="space-y-4 mb-6">
          {questions.map((q, i) => (
            <div key={q.id || i} className="border-b border-gray-200 pb-3">
              <p className="font-medium">{i + 1}. {q.question_text || '(no question text)'}</p>
              <p className="text-xs text-gray-500 mt-0.5">Raised by {q.raised_by || 'Unknown'} on {q.raised_date || '—'}</p>
              <p className="text-xs mt-1"><span className="text-gray-500">Answer: </span>{q.answer_text || 'Pending customer response.'}</p>
              {q.answered_date && <p className="text-xs text-gray-500">Answered {q.answered_date}</p>}
            </div>
          ))}
        </div>
      )}

      <h4 className="font-semibold border-b border-gray-300 pb-1 mb-1">General Notes</h4>
      <p className="whitespace-pre-wrap text-xs mb-10">{generalNotes || 'None.'}</p>

      <div className="grid grid-cols-2 gap-10 mt-10 pt-6 border-t border-gray-300">
        <div>
          <p className="font-semibold mb-8">Prepared By</p>
          <div className="border-b border-black h-8 mb-1" />
          <p className="text-xs">{preparedBy || '—'}</p>
          <p className="text-xs text-gray-500">Print Name</p>
        </div>
        <div>
          <p className="font-semibold mb-8">Date</p>
          <div className="border-b border-black h-8 mb-1" />
          <p className="text-xs">{new Date().toLocaleDateString()}</p>
        </div>
      </div>
    </div>
  );
}
