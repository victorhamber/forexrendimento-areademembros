import { useCallback, useEffect, useState } from 'react';
import type { Lang } from '../i18n/translations';
import { t } from '../i18n/translations';
import { memberFetch } from '../lib/memberSession';
import './ValidationPanel.css';

type LicenseRow = {
  id: number;
  systemId: string;
  productName?: string;
  numeroConta?: string;
  plano?: string;
  statusLicenca?: string;
  dataExpiracao?: string | null;
};

function effectiveLicenseStatus(l: LicenseRow): 'ativa' | 'expirada' | 'outro' {
  const raw = String(l.statusLicenca || '').toLowerCase();
  if (raw !== 'ativa') return raw === 'expirada' ? 'expirada' : 'outro';
  if (l.dataExpiracao && new Date(l.dataExpiracao).getTime() < Date.now()) return 'expirada';
  return 'ativa';
}

function formatDateTime(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return '—';
  const locale = lang === 'es' ? 'es-ES' : 'pt-BR';
  return new Date(iso).toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(status: ReturnType<typeof effectiveLicenseStatus>, tr: ReturnType<typeof t>): string {
  if (status === 'ativa') return tr.validation_status_active;
  if (status === 'expirada') return tr.validation_status_expired;
  return String(status);
}

export function ValidationPanel({
  userId,
  lang,
  userEmail,
  authHeaders,
}: {
  userId: string;
  lang: Lang;
  userEmail: string | null;
  authHeaders: (json?: boolean) => Record<string, string>;
}) {
  const tr = t(lang);
  const [licenses, setLicenses] = useState<LicenseRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [editingLicense, setEditingLicense] = useState<LicenseRow | null>(null);
  const [modalAccount, setModalAccount] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadLicenses = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await memberFetch('/api/me/licenses', { headers: authHeaders() });
      const d = (await res.json().catch(() => [])) as unknown;
      setLicenses(Array.isArray(d) ? (d as LicenseRow[]) : []);
    } catch {
      setLicenses([]);
    } finally {
      setListLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    void loadLicenses();
  }, [userId, loadLicenses]);

  const openEditModal = (license: LicenseRow) => {
    setEditingLicense(license);
    setModalAccount(String(license.numeroConta || '').trim());
    setToast(null);
  };

  const closeModal = () => {
    if (saving) return;
    setEditingLicense(null);
    setModalAccount('');
  };

  const saveModalAccount = async () => {
    if (!editingLicense) return;
    const account = modalAccount.trim();
    if (account.length < 3) {
      setToast({ type: 'err', text: tr.validation_account_min_length });
      return;
    }

    const status = effectiveLicenseStatus(editingLicense);

    setSaving(true);
    setToast(null);
    try {
      const putRes = await memberFetch(`/api/me/licenses/${editingLicense.id}/account`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ numero_conta: account }),
      });
      const putData = (await putRes.json().catch(() => ({}))) as { error?: string };
      if (!putRes.ok) {
        setToast({ type: 'err', text: putData.error || tr.validation_save_error });
        return;
      }

      if (status === 'ativa') {
        const valRes = await memberFetch('/api/me/validate-license', {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({
            license_id: editingLicense.id,
            system_id: editingLicense.systemId.trim(),
            numero_conta: account,
          }),
        });
        const valData = (await valRes.json().catch(() => ({}))) as { status?: string; message?: string };
        if (!valRes.ok || valData.status !== 'success') {
          setToast({ type: 'err', text: valData.message || tr.validation_invalid });
          await loadLicenses();
          return;
        }
        setToast({ type: 'ok', text: valData.message || tr.validation_valid });
      } else {
        setToast({ type: 'ok', text: tr.validation_account_saved });
      }

      await loadLicenses();
      setEditingLicense(null);
      setModalAccount('');
    } catch {
      setToast({ type: 'err', text: tr.profile_connection_error });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="validation-page">
      <header className="validation-header">
        <h1>{tr.validation_title}</h1>
        <p>{tr.validation_intro}</p>
      </header>

      {!listLoading && licenses.length > 0 && (
        <section className="validation-steps" aria-labelledby="validation-steps-title">
          <h2 id="validation-steps-title" className="validation-steps-title">
            {tr.validation_steps_title}
          </h2>
          <ol className="validation-steps-list">
            <li>{tr.validation_step_1}</li>
            <li>{tr.validation_step_2}</li>
            <li>{tr.validation_step_3}</li>
          </ol>
        </section>
      )}

      {toast && !editingLicense && (
        <p className={toast.type === 'ok' ? 'validation-toast validation-toast--ok' : 'validation-toast validation-toast--err'}>
          {toast.text}
        </p>
      )}

      {listLoading ? (
        <section className="validation-card validation-card--notice">
          <p className="validation-no-products">{tr.validation_loading_list}</p>
        </section>
      ) : licenses.length === 0 ? (
        <section className="validation-card validation-card--notice">
          <p className="validation-no-products">{tr.validation_no_products}</p>
        </section>
      ) : (
        <section className="validation-table-panel">
          <div className="validation-table-wrap">
            <table className="validation-table">
              <thead>
                <tr>
                  <th>{tr.validation_col_email}</th>
                  <th>{tr.validation_col_mt5}</th>
                  <th>{tr.validation_col_product}</th>
                  <th>{tr.validation_col_plan}</th>
                  <th>{tr.validation_col_status}</th>
                  <th>{tr.validation_col_expires}</th>
                  <th>{tr.validation_col_actions}</th>
                </tr>
              </thead>
              <tbody>
                {licenses.map((l) => {
                  const st = effectiveLicenseStatus(l);
                  const account = String(l.numeroConta || '').trim();
                  return (
                    <tr key={l.id}>
                      <td data-label={tr.validation_col_email}>{userEmail || '—'}</td>
                      <td data-label={tr.validation_col_mt5}>
                        {account ? (
                          account
                        ) : (
                          <span className="validation-account-pending">{tr.validation_account_pending}</span>
                        )}
                      </td>
                      <td data-label={tr.validation_col_product}>{l.productName || l.systemId || '—'}</td>
                      <td data-label={tr.validation_col_plan}>{l.plano || '—'}</td>
                      <td data-label={tr.validation_col_status}>
                        <span className={`validation-status-pill validation-status-pill--${st}`}>
                          {statusLabel(st, tr)}
                        </span>
                      </td>
                      <td data-label={tr.validation_col_expires}>{formatDateTime(l.dataExpiracao, lang)}</td>
                      <td data-label={tr.validation_col_actions}>
                        <button
                          type="button"
                          className={`validation-edit-btn${account ? '' : ' validation-edit-btn--primary'}`}
                          onClick={() => openEditModal(l)}
                        >
                          {account ? tr.validation_edit_btn : tr.validation_configure_btn}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {editingLicense && (
        <div className="validation-modal-overlay" role="presentation" onClick={closeModal}>
          <div
            className="validation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="validation-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="validation-modal-title">
              {String(editingLicense.numeroConta || '').trim()
                ? tr.validation_modal_title
                : tr.validation_modal_title_new}
            </h2>
            <p className="validation-modal-meta">
              {editingLicense.productName || editingLicense.systemId}
              {editingLicense.plano ? ` · ${editingLicense.plano}` : ''}
            </p>
            <p className="validation-modal-hint">{tr.validation_modal_hint}</p>
            <label className="validation-label" htmlFor="validation-mt5-account">
              {tr.validation_account_label}
            </label>
            <input
              id="validation-mt5-account"
              className="validation-input"
              value={modalAccount}
              onChange={(e) => setModalAccount(e.target.value)}
              placeholder={tr.validation_account_placeholder}
              inputMode="numeric"
              autoComplete="off"
              autoFocus
            />
            {toast && (
              <p
                className={
                  toast.type === 'ok' ? 'validation-msg validation-msg--ok' : 'validation-msg validation-msg--err'
                }
              >
                {toast.text}
              </p>
            )}
            <div className="validation-modal-actions">
              <button type="button" className="validation-modal-btn validation-modal-btn--primary" disabled={saving} onClick={() => void saveModalAccount()}>
                {saving ? tr.validation_saving : tr.validation_modal_save}
              </button>
              <button type="button" className="validation-modal-btn validation-modal-btn--ghost" disabled={saving} onClick={closeModal}>
                {tr.validation_modal_cancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
