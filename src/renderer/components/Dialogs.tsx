import React, { useEffect, useState } from 'react';

// ─── In-app notifications & confirmations ────────────────────────────────────
// Replaces the native alert()/confirm() with app-styled UI: toast messages in
// the top-right corner and modal confirm dialogs (same look as SAVE SESSION).

export type ToastKind = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ConfirmRequest {
  id: number;
  title: string;
  message: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
}

const toastSubscribers = new Set<(items: ToastItem[]) => void>();
let toastItems: ToastItem[] = [];
let toastSeq = 0;

const emitToasts = () => {
  const snapshot = [...toastItems];
  toastSubscribers.forEach(fn => fn(snapshot));
};

// Show a toast message. Errors stay longer so they can actually be read.
export function showToast(message: string, kind: ToastKind = 'info') {
  const id = ++toastSeq;
  toastItems = [...toastItems, { id, kind, message }];
  emitToasts();
  const ttl = kind === 'error' ? 6000 : 3500;
  setTimeout(() => {
    toastItems = toastItems.filter(t => t.id !== id);
    emitToasts();
  }, ttl);
}

const confirmSubscribers = new Set<(req: ConfirmRequest | null) => void>();
let confirmQueue: ConfirmRequest[] = [];
let confirmSeq = 0;

const emitConfirm = () => {
  confirmSubscribers.forEach(fn => fn(confirmQueue[0] || null));
};

// Show an in-app confirm dialog; resolves true only when the user agrees.
export function showConfirm(opts: { title: string; message: string; confirmLabel?: string }): Promise<boolean> {
  return new Promise(resolve => {
    confirmQueue = [...confirmQueue, {
      id: ++confirmSeq,
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel || 'OK',
      resolve
    }];
    emitConfirm();
  });
}

const settleConfirm = (id: number, ok: boolean) => {
  const req = confirmQueue.find(q => q.id === id);
  confirmQueue = confirmQueue.filter(q => q.id !== id);
  emitConfirm();
  req?.resolve(ok);
};

// ─── Host component: mount once (in App) to render toasts and confirm modals ─
export const DialogHost: React.FC = () => {
  const [toasts, setToasts] = useState<ToastItem[]>(toastItems);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(confirmQueue[0] || null);

  useEffect(() => {
    const onToasts = (items: ToastItem[]) => setToasts(items);
    const onConfirm = (req: ConfirmRequest | null) => setConfirm(req);
    toastSubscribers.add(onToasts);
    confirmSubscribers.add(onConfirm);
    return () => {
      toastSubscribers.delete(onToasts);
      confirmSubscribers.delete(onConfirm);
    };
  }, []);

  return (
    <>
      <div className="toast-stack">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.message}</div>
        ))}
      </div>
      {confirm && (
        <div className="modal-overlay" style={{ zIndex: 2500 }}>
          <div className="modal-box" style={{ maxWidth: '380px' }}>
            <div className="modal-header">
              <span>{confirm.title}</span>
              <button className="modal-close-btn" onClick={() => settleConfirm(confirm.id, false)}>×</button>
            </div>
            <div style={{ padding: '16px 0', color: 'var(--gray-700)', fontSize: '13px' }}>{confirm.message}</div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => settleConfirm(confirm.id, false)}>CANCEL</button>
              <button className="btn btn-danger" onClick={() => settleConfirm(confirm.id, true)}>{confirm.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
