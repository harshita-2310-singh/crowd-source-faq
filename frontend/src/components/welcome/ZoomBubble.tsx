import { useState } from 'react';
import ZoomAssessmentModal from './ZoomAssessmentModal';
import { useAuth } from '../../hooks/useAuth';

export default function ZoomBubble() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { user } = useAuth();

  // If user is admin, they don't need to take the assessment
  if (user?.role === 'admin') return null;

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border-[1.5px] border-[rgb(var(--border-rgb)_/_0.6)] bg-[rgb(var(--bg-card-rgb)_/_0.85)] backdrop-blur-[24px] shadow-sm transition-all duration-300 hover:bg-[rgb(var(--bg-card-rgb)_/_0.95)] hover:-translate-y-0.5 hover:shadow-md z-50 text-ink text-sm font-semibold"
      >
        <span className="w-2 h-2 rounded-full bg-[#2D8CFF] animate-pulse" />
        Zoom
      </button>

      {isModalOpen && (
        <ZoomAssessmentModal onClose={() => setIsModalOpen(false)} />
      )}
    </>
  );
}
