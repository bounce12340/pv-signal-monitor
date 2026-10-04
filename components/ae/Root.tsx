// 路由層：以 hash 分流「業務手機通報端」與主系統，並依角色決定誰能進主系統。從 PV-Link 搬入。
//
//   #/report → 業務通報表單（手機優先，獨立全螢幕，不載入主系統的資料與工作流）
//   其他      → 主系統（標籤 AE 主檔、季度監測、文獻監測）
//
// ⚠️ hash 路由**無法**用 Cloudflare Access 的路徑規則分權：`#` 後面的片段不會送到伺服器。
// 因此分權在應用層做：這裡向 /api/me 問角色，業務（rep）一律導向通報表單。
// 這一層只是體驗，不是防線。真正的守門在 Worker：AE API 自己查角色，/llm/* 只放行 PV。
//
// 與 PV-Link 的差異：
//   • 只有 AE 畫面包在 AEScope（.ae-theme）裡，主系統的樣式不受影響。
//   • 建檔關卡只擋「要進通報表單的人」。PV 同仁用主系統不必先填通報者資料——否則部署當天
//     所有現有使用者都會先被擋在建檔畫面。
//   • 身分查詢失敗時直接給通報表單、不擋建檔（PV-Link 會卡在存不了的建檔畫面，業務反而報不出來）。
import React, { useEffect, useState } from 'react';
import App from '../../App';
import AEReportMobile from './AEReportMobile';
import ProfileSetup from './ProfileSetup';
import { LangProvider, useT } from '../../i18n/LangContext';
import { AEScope, ThemeProvider } from '../../theme/ThemeContext';
import { fetchIdentity } from '../../services/ae/aeApi';
import type { AEIdentity, AEProfile } from '../../services/ae/aeApi';

export function useHashRoute(): string {
  const [hash, setHash] = useState(() => (typeof window === 'undefined' ? '' : window.location.hash));
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

const EMPTY_PROFILE: AEProfile = { displayName: '', employeeId: '', phone: '', contactEmail: '', org: '', territory: '' };

/**
 * /api/me 查不到時的身分。
 *
 * 正式環境降級為 rep：通報是安全關鍵路徑（表單本身有離線佇列），主系統則是敏感路徑；
 * 不確定身分時，讓人能通報、不讓人進主系統。profileComplete 設 true 是刻意的：建檔畫面在
 * 這種情況下也存不了，擋在那裡只會讓業務報不出來；通報者欄位改由業務在表單裡手動填。
 *
 * `vite` 開發伺服器沒有 Worker，/api/me 一定失敗；這時當成 PV，否則本機根本進不了主系統。
 * import.meta.env.DEV 在正式 build 會被換成 false，這個分支不會出現在部署的程式裡。
 */
export function fallbackIdentity(dev: boolean): AEIdentity {
  return { email: '', role: dev ? 'pv' : 'rep', profile: EMPTY_PROFILE, profileComplete: true };
}

function useIdentity(): [AEIdentity | 'loading', (p: AEProfile) => void] {
  const [identity, setIdentity] = useState<AEIdentity | 'loading'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await fetchIdentity();
        if (!cancelled) setIdentity(me);
      } catch {
        if (!cancelled) setIdentity(fallbackIdentity(import.meta.env.DEV));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 建檔完成後就地更新，不必重新整理頁面
  const applyProfile = (profile: AEProfile) =>
    setIdentity(prev => (prev === 'loading' ? prev : { ...prev, profile, profileComplete: true }));

  return [identity, applyProfile];
}

// 等待畫面要有文字：螢幕閱讀器使用者聽到一片空白，分不出「正在載入」與「壞掉了」。
const Splash: React.FC = () => {
  const t = useT();
  return (
    <div role="status" className="min-h-[100dvh] flex items-center justify-center bg-canvas">
      <div aria-hidden="true" className="w-8 h-8 rounded-full border-[3px] border-brand-600 border-t-transparent animate-spin" />
      <span className="sr-only">{t('app.loading')}</span>
    </div>
  );
};

export const Routes: React.FC = () => {
  const hash = useHashRoute();
  const [identity, applyProfile] = useIdentity();
  const [editingProfile, setEditingProfile] = useState(false);

  // 身分未定前不渲染任何一邊：先畫主系統再抽掉，等於讓不該看到的人瞄到一眼。
  if (identity === 'loading') return <AEScope><Splash /></AEScope>;

  // 業務無論打哪個 hash 都只會拿到通報表單；startsWith 容許 #/report?src=qr 之類的查詢字串。
  const wantsReport = identity.role === 'rep' || hash.startsWith('#/report');
  if (!wantsReport) return <App />;

  // 首次通報前先建檔。刻意不給跳過：檔案沒填，第一次通報就會卡在「可辨識的通報者」驗證上，
  // 而那時業務人在客戶端、手上有個真實個案，是最不該讓他停下來填基本資料的時刻。
  if (!identity.profileComplete || editingProfile) {
    return (
      <AEScope>
        <ProfileSetup
          email={identity.email}
          initial={identity.profile}
          onDone={p => { applyProfile(p); setEditingProfile(false); }}
          onCancel={identity.profileComplete ? () => setEditingProfile(false) : undefined}
        />
      </AEScope>
    );
  }

  return (
    <AEScope>
      <AEReportMobile profile={identity.profile} onEditProfile={() => setEditingProfile(true)} />
    </AEScope>
  );
};

const Root: React.FC = () => (
  <LangProvider>
    <ThemeProvider>
      <Routes />
    </ThemeProvider>
  </LangProvider>
);

export default Root;
