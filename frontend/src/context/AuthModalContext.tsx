import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * AuthModalContext — global modal trigger + pending-action queue.
 *
 * Pages/components that need auth-gated write actions call `gate(action)`.
 * - If the user is already authenticated, `action` runs immediately.
 * - If not, we stash the action and open the modal; on successful login/register
 *   the action fires once and the pending slot clears.
 *
 * The action is a no-arg function. It can read the current auth state via
 * `useAuth()` at the moment it runs.
 */

type PendingAction = () => void | Promise<void>;

interface AuthModalContextValue {
  isOpen: boolean;
  initialTab: 'signin' | 'register';
  openModal: (tab?: 'signin' | 'register') => void;
  closeModal: () => void;
  // `setPendingAction` is called by the gate when auth is required; the
  // provider watches isAuthenticated and fires the action on a 0→1 transition.
  setPendingAction: (action: PendingAction | null) => void;
  // Optional text shown above the form (e.g. "Sign in to ask a question").
  prompt: string;
  setPrompt: (text: string) => void;
}

const AuthModalContext = createContext<AuthModalContextValue | null>(null);

interface ProviderProps {
  children: ReactNode;
  // Subscribe to auth state — when this flips false→true, drain pending action.
  isAuthenticated: boolean;
}

export function AuthModalProvider({ children, isAuthenticated }: ProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<'signin' | 'register'>('signin');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [prompt, setPrompt] = useState('');

  const openModal = useCallback((tab: 'signin' | 'register' = 'signin') => {
    setInitialTab(tab);
    setIsOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsOpen(false);
    // Don't clear pendingAction here — if auth fails we may want to retry.
    // The AuthModal component clears it explicitly on a successful auth.
    setPrompt('');
  }, []);

  // Bridge for callers that can't import the hook (e.g. axios interceptor).
  // The api.ts 401 handler dispatches 'authmodal:open' with optional prompt.
  useEffect(() => {
    const openHandler = (e: Event) => {
      const ce = e as CustomEvent<{ tab?: 'signin' | 'register'; prompt?: string }>;
      setInitialTab(ce.detail?.tab ?? 'signin');
      if (ce.detail?.prompt) setPrompt(ce.detail.prompt);
      setIsOpen(true);
    };
    // The gate dispatches 'authmodal:prompt' separately so it can attach a
    // custom message without rebuilding the whole event detail object.
    const promptHandler = (e: Event) => {
      const ce = e as CustomEvent<string>;
      if (ce.detail) setPrompt(ce.detail);
    };
    window.addEventListener('authmodal:open', openHandler);
    window.addEventListener('authmodal:prompt', promptHandler);
    return () => {
      window.removeEventListener('authmodal:open', openHandler);
      window.removeEventListener('authmodal:prompt', promptHandler);
    };
  }, []);

  // Whenever the user is authenticated, the modal should not be open.
  // The pending action (if any) fires on the false→true transition.
  useEffect(() => {
    if (isAuthenticated) {
      if (isOpen) setIsOpen(false);
      if (pendingAction) {
        setPrompt('');
        const action = pendingAction;
        setPendingAction(null);
        // Run after a microtask so the modal close animation can start cleanly.
        queueMicrotask(() => {
          Promise.resolve(action()).catch(() => {
            // Swallow — gate callers should be best-effort.
          });
        });
      }
    }
  }, [isAuthenticated, isOpen, pendingAction]);

  const value = useMemo<AuthModalContextValue>(() => ({
    isOpen,
    initialTab,
    openModal,
    closeModal,
    setPendingAction,
    prompt,
    setPrompt,
  }), [isOpen, initialTab, openModal, closeModal, prompt]);

  return <AuthModalContext.Provider value={value}>{children}</AuthModalContext.Provider>;
}

export function useAuthModal(): AuthModalContextValue {
  const ctx = useContext(AuthModalContext);
  if (!ctx) throw new Error('useAuthModal must be used within AuthModalProvider');
  return ctx;
}

/**
 * useAuthGate — wraps an action so that unauthenticated users get the modal
 * instead of a 401. Returns a function you can wire to onClick.
 *
 * Usage:
 *   const gate = useAuthGate();
 *   <button onClick={gate(() => submitPost())}>Ask Question</button>
 *
 * The optional `prompt` is shown in the modal so the user knows why they
 * need to sign in ("Sign in to ask a question").
 */
export function useAuthGate() {
  const { openModal, setPendingAction } = useAuthModal();

  return useCallback((action: PendingAction, prompt?: string) => {
    return () => {
      // Read auth state lazily so the gate doesn't need to be re-bound on
      // auth changes — it just consults the latest value at call time.
      const isAuthed = !!window.localStorage.getItem('yaksha_token');
      if (isAuthed) {
        action();
        return;
      }
      if (prompt) {
        // We deliberately reach into the same module-level state via a
        // custom event to keep `gate` simple. The provider listens for
        // 'authmodal:prompt' and updates the prompt state.
        window.dispatchEvent(new CustomEvent('authmodal:prompt', { detail: prompt }));
      }
      setPendingAction(action);
      openModal('signin');
    };
  }, [openModal, setPendingAction]);
}

/**
 * Bridge hook — the gate dispatches a 'authmodal:prompt' CustomEvent when
 * it wants to set a prompt, and the AuthModalProvider listens via this
 * hook to update internal state. Keeps the gate signature small.
 */
export function useAuthPromptBridge(setPrompt: (text: string) => void): void {
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<string>;
      setPrompt(ce.detail ?? '');
    };
    window.addEventListener('authmodal:prompt', handler);
    return () => window.removeEventListener('authmodal:prompt', handler);
  }, [setPrompt]);
}
