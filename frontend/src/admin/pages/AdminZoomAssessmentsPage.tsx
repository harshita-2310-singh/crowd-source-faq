import React from 'react';
import AdminZoomTab from '../components/welcome/AdminZoomTab';

export default function AdminZoomAssessmentsPage() {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Zoom Assessments</h1>
          <p className="text-sm text-ink-faint mt-1">
            Manage onboarding assessments, transcripts, question pools, passing rules, attempt resets, and Zoom session access.
          </p>
        </div>
      </div>

      <AdminZoomTab mode="assessments" />
    </div>
  );
}
