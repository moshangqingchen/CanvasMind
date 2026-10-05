import type { LocalizedRunError } from "../lib/error-localization";
import { failureDiagnosis } from "../lib/failure-diagnosis";
import styles from "./failure-diagnosis.module.css";

export function FailureDiagnosis({ error, status, providerTaskStatus, recoveryAction }: {
  error?: LocalizedRunError | null;
  status?: string;
  providerTaskStatus?: string;
  recoveryAction?: string;
}) {
  const diagnosis = failureDiagnosis(error, { status, providerTaskStatus, recoveryAction });
  return <div className={styles.diagnosis} role="group" aria-label={diagnosis.regionLabel}>
    <dl className={styles.rows}>
      <div className={styles.reason}>
        <dt>{diagnosis.reasonLabel}</dt>
        <dd><strong>{diagnosis.categoryLabel}</strong><p className="result-info-error">{diagnosis.reason}</p></dd>
      </div>
      <div>
        <dt>扣费状态</dt>
        <dd><span className={styles.charge} data-charge={diagnosis.chargeStatus}>{diagnosis.chargeLabel}</span></dd>
      </div>
      <div>
        <dt>金额</dt>
        <dd>{diagnosis.amountLabel}<small>{diagnosis.chargeSource}</small></dd>
      </div>
      <div className={styles.next}>
        <dt>下一步</dt>
        <dd>{diagnosis.nextStep}</dd>
      </div>
    </dl>
  </div>;
}
